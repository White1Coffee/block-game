import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : { channel: "msedge" }),
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:8800", {
    waitUntil: "networkidle",
  });
  await page.locator("#character").click();
  await page.locator("#skin-preview canvas").waitFor();
  await page.locator("#skin-upload").setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await page.waitForFunction(() =>
    document.querySelector("#skin-status").textContent.includes("geen PNG"),
  );
  const makePNG = async (height) =>
    Buffer.from(
      await page.evaluate((h) => {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#bad389";
        ctx.fillRect(0, 0, 64, h);
        ctx.clearRect(32, 0, 32, 16);
        ctx.fillStyle = "#4d7194";
        ctx.fillRect(16, 16, 24, 16);
        ctx.fillStyle = "#b76b4b";
        ctx.fillRect(8, 8, 8, 8);
        ctx.fillStyle = "#202f30";
        ctx.fillRect(9, 10, 2, 2);
        ctx.fillRect(13, 10, 2, 2);
        ctx.fillStyle = "#ddac55";
        ctx.fillRect(40, 8, 8, 2);
        if (h === 64) {
          ctx.clearRect(0, 32, 56, 16);
          ctx.clearRect(0, 48, 16, 16);
          ctx.clearRect(48, 48, 16, 16);
          ctx.fillStyle = "#467d83";
          ctx.fillRect(32, 48, 16, 16);
        }
        return c.toDataURL().split(",")[1];
      }, height),
      "base64",
    );
  await page.locator("#skin-upload").setInputFiles({
    name: "legacy.png",
    mimeType: "image/png",
    buffer: await makePNG(32),
  });
  await page.waitForFunction(
    () => document.querySelector("#skin-status").textContent === "legacy.png",
  );
  await page.locator("#apply-skin").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("wildbrick-skin")).name === "legacy.png",
  );
  await page.locator("#skin-model").selectOption("slim");
  await page.locator("#skin-layers").uncheck();
  await page.locator("#apply-skin").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("wildbrick-skin")).model === "slim" &&
      !JSON.parse(localStorage.getItem("wildbrick-skin")).layers,
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#character").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#skin-model").value === "slim" &&
      !document.querySelector("#skin-layers").checked,
  );
  await page.locator("#skin-upload").setInputFiles({
    name: "modern.png",
    mimeType: "image/png",
    buffer: await makePNG(64),
  });
  await page.waitForFunction(
    () => document.querySelector("#skin-status").textContent === "modern.png",
  );
  await page.locator("#skin-layers").check();
  await page.locator("#skin-model").selectOption("classic");
  await page.waitForTimeout(500);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/skin-classic.png" });
  await page.locator("#skin-model").selectOption("slim");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/skin-slim.png" });
  await page.locator("#username").fill("bad!");
  await page.locator("#lookup").click();
  await page.waitForFunction(() =>
    document.querySelector("#skin-status").textContent.includes("3–16"),
  );
  await page.locator("#username").fill("Notch");
  await page.locator("#lookup").click();
  await page.waitForFunction(
    () => !document.querySelector("#lookup").disabled,
    {},
    { timeout: 30000 },
  );
  assert.equal(
    await page.locator("#skin-status").textContent(),
    "Notch",
    "The live public lookup must succeed",
  );
  await page.locator("#apply-skin").click();
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem("wildbrick-skin")).name === "Notch",
  );
  await page.route("**/api/skin/**", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "Te veel verzoeken. Wacht een minuut." }),
    }),
  );
  await page.locator("#lookup").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#skin-status")
      .textContent.includes("Te veel verzoeken"),
  );
  await page.locator("#skin-upload").setInputFiles({
    name: "fallback.png",
    mimeType: "image/png",
    buffer: await makePNG(64),
  });
  await page.waitForFunction(
    () => document.querySelector("#skin-status").textContent === "fallback.png",
  );
  await page.locator("#apply-skin").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("wildbrick-skin")).name ===
      "fallback.png",
  );
  await page.locator("#character-back").click();
  await page.locator("#new").click();
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForTimeout(1500);
  await page.keyboard.press("F5");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/third-person-back.png" });
  await page.keyboard.press("F5");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/third-person-front.png" });
  await page.keyboard.press("F5");
  assert.deepEqual(errors, []);
  console.log(
    "Skin browser QA passed: invalid PNG, legacy, modern, classic/slim, layers, persistence, live Notch lookup, API-error upload fallback and F5 cameras.",
  );
} finally {
  await browser.close();
}
