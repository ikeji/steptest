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
    setStatus(
      msg.meshes.length > 0 ? `${msg.meshes.length}個の形状` : "「表示する」ブロックを置いてください",
    );
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

function rebuild() {
  if (!workerReady) return;
  latestRunId = ++requestId;
  setStatus("計算中…");
  worker.postMessage({ id: latestRunId, type: "run", code: generateCode() });
}

let debounceTimer: number | undefined;
workspace.addChangeListener((event) => {
  if (event.isUiEvent) return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(Blockly.serialization.workspaces.save(workspace)),
  );
  clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(rebuild, 300);
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
