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
await page.screenshot({ path: new URL("./screen.png", import.meta.url).pathname });
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
