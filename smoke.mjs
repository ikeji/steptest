import { chromium } from "playwright";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

// File System Access API を無効化してDL/アップロードのフォールバック経路をテストする
await page.addInitScript(() => {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
});

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto("http://localhost:5199/");

// OCCT の初期化とメッシュ計算を待つ(最大60秒)
try {
  await page.waitForFunction(
    () => document.getElementById("status")?.textContent?.includes("個の形状"),
    { timeout: 60000 },
  );
} catch {
  console.log("STATUS TIMEOUT:", await page.textContent("#status"));
}

console.log("status:", await page.textContent("#status"));
console.log(
  "blockly blocks:",
  await page.evaluate(() => document.querySelectorAll(".blocklyDraggable").length),
);

// --- 選択プレビュー: 円柱ブロックをクリック → そのブロックだけ表示される ---
await page.evaluate(() => {
  const ws = window.blockcadWorkspace;
  const block = ws.getAllBlocks().find((b) => b.type === "cad_cylinder");
  ws.centerOnBlock(block.id);
});
await page.locator(".blocklyText", { hasText: "円柱" }).first().click();
await page
  .waitForFunction(
    () => document.getElementById("status")?.textContent?.includes("プレビュー中"),
    { timeout: 15000 },
  )
  .catch(() => {});
console.log("after select:", await page.textContent("#status"));
await page.waitForTimeout(500); // メッシュ描画を待つ
await page.screenshot({ path: "screen-preview.png" });

// 空きスペースをクリックして選択解除 → 全体表示に戻る
await page.locator(".blocklyWorkspace > .blocklyBlockCanvas").first().page().mouse.click(400, 600);
await page
  .waitForFunction(
    () => document.getElementById("status")?.textContent?.includes("個の形状"),
    { timeout: 15000 },
  )
  .catch(() => {});
console.log("after deselect:", await page.textContent("#status"));

// --- 移動ギズモ: 移動ブロック選択でXYZ矢印が出て、ドラッグで数値が変わる ---
await page.evaluate(() => {
  const ws = window.blockcadWorkspace;
  const block = ws.getAllBlocks().find((b) => b.type === "cad_translate");
  ws.centerOnBlock(block.id);
});
await page.locator(".blocklyText", { hasText: "移動" }).first().click();
await page.waitForFunction(() => window.blockcadViewer?.gizmoVisible === true, {
  timeout: 15000,
});
console.log("gizmo visible:", await page.evaluate(() => window.blockcadViewer.gizmoVisible));
await page.waitForTimeout(500);
await page.screenshot({ path: "screen-gizmo.png" });

// ドラッグ相当のコールバックを直接呼び、ブロックの数値へ反映されるか確認
await page.evaluate(() => {
  window.blockcadViewer.onGizmoMove({ x: 5, y: 3, z: -1 });
});
const xyz = await page.evaluate(() => {
  const ws = window.blockcadWorkspace;
  const block = ws.getAllBlocks().find((b) => b.type === "cad_translate");
  return ["X", "Y", "Z"].map((n) =>
    block.getInputTargetBlock(n).getFieldValue("NUM"),
  );
});
console.log("after gizmo drag xyz:", xyz.join(","));

// --- 3Dビューを操作してもブロックの選択が解除されない ---
await page.mouse.move(1050, 450);
await page.mouse.down();
await page.mouse.move(1150, 500, { steps: 5 }); // カメラ回転ドラッグ
await page.mouse.up();
await page.waitForTimeout(300);
console.log(
  "after viewer drag - selected:",
  await page.evaluate(() => document.querySelector(".blocklySelected") != null),
  "gizmo:",
  await page.evaluate(() => window.blockcadViewer.gizmoVisible),
  "status:",
  await page.textContent("#status"),
);

// 移動ブロック以外を選択するとギズモが消える
await page.evaluate(() => {
  const ws = window.blockcadWorkspace;
  const block = ws.getAllBlocks().find((b) => b.type === "cad_cylinder");
  ws.centerOnBlock(block.id);
});
await page.locator(".blocklyText", { hasText: "円柱" }).first().click();
await page.waitForFunction(() => window.blockcadViewer?.gizmoVisible === false, {
  timeout: 15000,
});
console.log("gizmo hidden on other block: true");

// --- プロジェクト保存 (フォールバック: ダウンロード) ---
const workDir = await mkdtemp(join(tmpdir(), "blockcad-"));
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click("#save"),
]);
const savedPath = join(workDir, download.suggestedFilename());
await download.saveAs(savedPath);
const saved = JSON.parse(await readFile(savedPath, "utf8"));
console.log("saved project:", download.suggestedFilename(), "blocks:", !!saved.blocks);

// --- プロジェクト読み込み (フォールバック: ファイル選択) ---
// 球だけの別プロジェクトを読み込ませて反映を確認
const sphereProject = {
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
              type: "cad_sphere",
              inputs: {
                R: { shadow: { type: "math_number", fields: { NUM: 8 } } },
              },
            },
          },
        },
      },
    ],
  },
};
const spherePath = join(workDir, "sphere.json");
await writeFile(spherePath, JSON.stringify(sphereProject));
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.click("#open"),
]);
await chooser.setFiles(spherePath);
await page.waitForFunction(
  () => document.querySelectorAll(".blocklyDraggable").length === 3,
  { timeout: 15000 },
);
await page.waitForFunction(
  () => document.getElementById("status")?.textContent?.includes("個の形状"),
  { timeout: 15000 },
);
console.log(
  "after open blocks:",
  await page.evaluate(() => document.querySelectorAll(".blocklyDraggable").length),
  "status:",
  await page.textContent("#status"),
);

// --- 回転ギズモ: 回転ブロック選択でリングが出て、ドラッグで角度が変わる ---
const rotateProject = {
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
              type: "cad_rotate",
              fields: { AXIS: "[1, 0, 0]" },
              inputs: {
                ANGLE: { shadow: { type: "math_number", fields: { NUM: 30 } } },
                SHAPE: {
                  block: {
                    type: "cad_cylinder",
                    inputs: {
                      R: { shadow: { type: "math_number", fields: { NUM: 5 } } },
                      H: { shadow: { type: "math_number", fields: { NUM: 20 } } },
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
const rotatePath = join(workDir, "rotate.json");
await writeFile(rotatePath, JSON.stringify(rotateProject));
const [rotateChooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.click("#open"),
]);
await rotateChooser.setFiles(rotatePath);
await page.waitForFunction(
  () => document.querySelectorAll(".blocklyDraggable").length === 6,
  { timeout: 15000 },
);
await page.evaluate(() => {
  const ws = window.blockcadWorkspace;
  const block = ws.getAllBlocks().find((b) => b.type === "cad_rotate");
  ws.centerOnBlock(block.id);
});
await page.locator(".blocklyText", { hasText: "回転" }).first().click();
await page.waitForFunction(() => window.blockcadViewer?.gizmoVisible === true, {
  timeout: 15000,
});
console.log("rotate gizmo visible:", true);
await page.waitForTimeout(500);
await page.screenshot({ path: "screen-rotate-gizmo.png" });
await page.evaluate(() => {
  window.blockcadViewer.onGizmoRotate(45);
});
const angle = await page.evaluate(() => {
  const ws = window.blockcadWorkspace;
  const block = ws.getAllBlocks().find((b) => b.type === "cad_rotate");
  return block.getInputTargetBlock("ANGLE").getFieldValue("NUM");
});
console.log("after rotate drag angle:", angle);
await page.screenshot({ path: new URL("./screen.png", import.meta.url).pathname });
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
