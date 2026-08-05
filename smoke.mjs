import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

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
await page.screenshot({ path: new URL("./screen.png", import.meta.url).pathname });
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
