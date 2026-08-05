import * as Blockly from "blockly";
import * as Ja from "blockly/msg/ja";
import { javascriptGenerator } from "blockly/javascript";
import { toolbox } from "./blocks";
import { Viewer } from "./viewer";

Blockly.setLocale(Ja as unknown as Record<string, string>);

const STORAGE_KEY = "blockcad-workspace";

// 初期サンプル: 直方体から円柱をくり抜いてフィレット
const defaultWorkspace = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: "cad_show",
        x: 30,
        y: 30,
        inputs: {
          SHAPE: {
            block: {
              type: "cad_fillet",
              inputs: {
                R: { shadow: { type: "math_number", fields: { NUM: 1 } } },
                SHAPE: {
                  block: {
                    type: "cad_difference",
                    inputs: {
                      A: {
                        block: {
                          type: "cad_box",
                          inputs: {
                            W: { shadow: { type: "math_number", fields: { NUM: 30 } } },
                            D: { shadow: { type: "math_number", fields: { NUM: 20 } } },
                            H: { shadow: { type: "math_number", fields: { NUM: 10 } } },
                          },
                        },
                      },
                      B: {
                        block: {
                          type: "cad_translate",
                          inputs: {
                            X: { shadow: { type: "math_number", fields: { NUM: 0 } } },
                            Y: { shadow: { type: "math_number", fields: { NUM: 0 } } },
                            Z: { shadow: { type: "math_number", fields: { NUM: -1 } } },
                            SHAPE: {
                              block: {
                                type: "cad_cylinder",
                                inputs: {
                                  R: { shadow: { type: "math_number", fields: { NUM: 5 } } },
                                  H: { shadow: { type: "math_number", fields: { NUM: 12 } } },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
};

// ---- UI要素 ---------------------------------------------------------------

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}秒`;
}

const statusEl = document.getElementById("status")!;
function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

const viewer = new Viewer(document.getElementById("viewer-area")!);

// ---- Blockly --------------------------------------------------------------

const workspace = Blockly.inject("blockly-area", {
  toolbox,
  grid: { spacing: 20, length: 3, colour: "#ccc", snap: true },
  zoom: { controls: true, wheel: true },
  trashcan: true,
});

// デバッグ・テスト用に公開
declare global {
  interface Window {
    blockcadWorkspace?: Blockly.WorkspaceSvg;
    blockcadViewer?: Viewer;
  }
}
window.blockcadWorkspace = workspace;
window.blockcadViewer = viewer;

const saved = localStorage.getItem(STORAGE_KEY);
Blockly.serialization.workspaces.load(
  saved ? JSON.parse(saved) : defaultWorkspace,
  workspace,
);

// ---- Worker ---------------------------------------------------------------

const worker = new Worker(new URL("./cad-worker.ts", import.meta.url), {
  type: "module",
});

let requestId = 0;
let latestRunId = 0;
let workerReady = false;
const pendingExports = new Map<number, string>();

worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "ready") {
    workerReady = true;
    setStatus("準備完了");
    rebuild();
    return;
  }
  if (msg.type === "result") {
    if (msg.id !== latestRunId) return; // 古い結果は捨てる
    viewer.updateShapes(msg.meshes);
    const time = formatElapsed(msg.elapsedMs);
    if (latestRunIsPreview) {
      setStatus(`選択ブロックをプレビュー中 (${time})`);
    } else {
      setStatus(
        msg.meshes.length > 0
          ? `${msg.meshes.length}個の形状 (${time})`
          : "「表示する」ブロックを置いてください",
      );
    }
    return;
  }
  if (msg.type === "export") {
    const filename = pendingExports.get(msg.id) ?? "model";
    pendingExports.delete(msg.id);
    const url = URL.createObjectURL(msg.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("書き出し完了");
    return;
  }
  if (msg.type === "error") {
    pendingExports.delete(msg.id);
    setStatus(`エラー: ${msg.message}`, true);
  }
};

function generateCode(): string {
  return javascriptGenerator.workspaceToCode(workspace);
}

// 選択中のブロック(またはその親をたどって最初に見つかる形状ブロック)だけを
// 表示するコードを生成する。形状に関係ないブロックなら null。
let previewBlockId: string | null = null;

function findPreviewTarget(): Blockly.Block | null {
  if (!previewBlockId) return null;
  let target: Blockly.Block | null = workspace.getBlockById(previewBlockId);
  while (target) {
    if (target.type === "cad_show") {
      target = target.getInputTargetBlock("SHAPE");
      break;
    }
    if (target.outputConnection?.getCheck()?.includes("Shape")) break;
    target = target.getParent();
  }
  return target;
}

function generatePreviewCode(): string | null {
  const target = findPreviewTarget();
  if (!target) return null;
  const g = javascriptGenerator;
  g.init(workspace);
  const result = g.blockToCode(target);
  const expr = Array.isArray(result) ? result[0] : String(result);
  if (!expr) return null;
  return g.finish(`shapes.push(${expr});\n`);
}

// ---- 移動ギズモ: 移動ブロック選択時にXYZ矢印で数値を編集 -------------------

let gizmoBlockId: string | null = null;

// 指定入力に繋がっているのが単純な数値ブロックならそれを返す (式なら null)
function numberInputBlock(
  block: Blockly.Block,
  name: string,
): Blockly.Block | null {
  const target = block.getInputTargetBlock(name);
  return target?.type === "math_number" ? target : null;
}

function updateGizmo() {
  if (viewer.gizmoDragging) return; // ドラッグ中はギズモ位置が正
  const target = findPreviewTarget();
  if (target?.type === "cad_translate") {
    const inputs = ["X", "Y", "Z"].map((n) => numberInputBlock(target, n));
    if (inputs.every((b) => b !== null)) {
      const [x, y, z] = inputs.map((b) => Number(b!.getFieldValue("NUM")) || 0);
      gizmoBlockId = target.id;
      viewer.showGizmo({ x, y, z });
      return;
    }
  }
  gizmoBlockId = null;
  viewer.hideGizmo();
}

viewer.onGizmoChange = (pos) => {
  if (!gizmoBlockId) return;
  const block = workspace.getBlockById(gizmoBlockId);
  if (!block) return;
  const values: Record<string, number> = { X: pos.x, Y: pos.y, Z: pos.z };
  for (const [name, value] of Object.entries(values)) {
    // 0.1単位に丸めてブロックの数値へ書き戻す (変更イベント経由で再計算される)
    numberInputBlock(block, name)?.setFieldValue(
      String(Math.round(value * 10) / 10),
      "NUM",
    );
  }
};

let latestRunIsPreview = false;

function rebuild() {
  if (!workerReady) return;
  updateGizmo();
  const previewCode = generatePreviewCode();
  latestRunIsPreview = previewCode !== null;
  latestRunId = ++requestId;
  setStatus("計算中…");
  worker.postMessage({
    id: latestRunId,
    type: "run",
    code: previewCode ?? generateCode(),
  });
}

let debounceTimer: number | undefined;
function scheduleRebuild(delay: number) {
  clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(rebuild, delay);
}

workspace.addChangeListener((event) => {
  if (event.type === Blockly.Events.SELECTED) {
    const e = event as Blockly.Events.Selected;
    previewBlockId = e.newElementId ?? null;
    scheduleRebuild(100);
    return;
  }
  if (event.isUiEvent) return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(Blockly.serialization.workspaces.save(workspace)),
  );
  scheduleRebuild(300);
});

// ---- プロジェクトファイルの読み書き ---------------------------------------
// Chrome系: File System Access API で上書き保存。非対応ブラウザ: DL/アップロード。

declare global {
  interface Window {
    showOpenFilePicker?: (options?: object) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: object) => Promise<FileSystemFileHandle>;
  }
}

const FILE_TYPES = [
  {
    description: "BlockCADプロジェクト",
    accept: { "application/json": [".json"] },
  },
];

let fileHandle: FileSystemFileHandle | null = null;

const filenameEl = document.getElementById("filename")!;
function setFileName(name: string) {
  filenameEl.textContent = name;
}

function workspaceJson(): string {
  return JSON.stringify(
    Blockly.serialization.workspaces.save(workspace),
    null,
    2,
  );
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function saveProject(saveAs: boolean) {
  if (!window.showSaveFilePicker) {
    // フォールバック: ダウンロード
    const blob = new Blob([workspaceJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "project.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("ダウンロードしました");
    return;
  }
  try {
    if (!fileHandle || saveAs) {
      fileHandle = await window.showSaveFilePicker({
        types: FILE_TYPES,
        suggestedName: fileHandle?.name ?? "project.json",
      });
    }
    const writable = await fileHandle.createWritable();
    await writable.write(workspaceJson());
    await writable.close();
    setFileName(fileHandle.name);
    setStatus(`${fileHandle.name} に保存しました`);
  } catch (error) {
    if (!isAbort(error)) setStatus(`保存エラー: ${error}`, true);
  }
}

function loadProjectText(text: string, handle: FileSystemFileHandle | null) {
  try {
    const json = JSON.parse(text);
    Blockly.serialization.workspaces.load(json, workspace);
    fileHandle = handle;
    setFileName(handle?.name ?? "");
    setStatus("読み込みました");
  } catch (error) {
    setStatus(`読み込みエラー: ${error}`, true);
  }
}

async function openProject() {
  if (!window.showOpenFilePicker) {
    // フォールバック: ファイル選択ダイアログ
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) loadProjectText(await file.text(), null);
    };
    input.click();
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
    const file = await handle.getFile();
    loadProjectText(await file.text(), handle);
  } catch (error) {
    if (!isAbort(error)) setStatus(`読み込みエラー: ${error}`, true);
  }
}

document.getElementById("open")!.addEventListener("click", openProject);
document.getElementById("save")!.addEventListener("click", () => saveProject(false));
document.getElementById("save-as")!.addEventListener("click", () => saveProject(true));

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === "s") {
    event.preventDefault();
    saveProject(event.shiftKey);
  } else if (event.key === "o") {
    event.preventDefault();
    openProject();
  }
});

// ---- ツールバー -----------------------------------------------------------

function requestExport(type: "export-stl" | "export-step", filename: string) {
  if (!workerReady) return;
  const id = ++requestId;
  pendingExports.set(id, filename);
  setStatus("書き出し中…");
  worker.postMessage({ id, type, code: generateCode() });
}

document.getElementById("export-stl")!.addEventListener("click", () => {
  requestExport("export-stl", "model.stl");
});
document.getElementById("export-step")!.addEventListener("click", () => {
  requestExport("export-step", "model.step");
});
document.getElementById("clear")!.addEventListener("click", () => {
  if (confirm("すべてのブロックを削除しますか?")) {
    workspace.clear();
  }
});
