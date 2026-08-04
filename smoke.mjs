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
await page.screenshot({ path: new URL("./screen.png", import.meta.url).pathname });
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
