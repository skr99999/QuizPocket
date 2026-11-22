"use strict";

const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { webkit, devices } = require("playwright-core");

async function main() {
  const output = path.resolve(process.argv[2] ?? path.join(__dirname, "dist"));
  const mount = "/test-organization/QuizPocket/";
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png" };
  let online = true;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const name = pathname.slice(mount.length) || "index.html";
    if (!online || !pathname.startsWith(mount) || !/^[\w.-]+$/.test(name) || name === "." || name === "..") {
      response.writeHead(503).end();
      return;
    }
    try {
      const content = await readFile(path.join(output, name));
      response.writeHead(200, { "Content-Type": mime[path.extname(name)] ?? "text/plain", "Cache-Control": "no-store" });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  const browser = await webkit.launch();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}${mount}`;
  const errors = [];
  try {
    const context = await browser.newContext(devices["iPhone 15"]);
    let page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.getByText("已可离线使用", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), `${url}sw.js`);
    const manifest = await (await context.request.get(`${url}manifest.webmanifest`)).json();
    assert.equal(new URL(manifest.start_url, `${url}manifest.webmanifest`).href, url);

    await page.locator("#file").setInputFiles(path.join(__dirname, "../templates/Word题库示例.docx"));
    await page.getByText(/^已导入「Word题库示例」/).waitFor();
    await page.locator("#file").setInputFiles(path.join(__dirname, "../templates/Excel题库示例.xlsx"));
    await page.getByText(/^已导入「Excel题库示例」，共 4 题。$/).waitFor();
    assert.equal(await page.locator("#banks option").count(), 3);
    await page.locator("#start").click();
    await page.locator(".option").first().click();
    await page.getByText("已答 1 / 4", { exact: false }).waitFor();
    await page.close();

    online = false;
    page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${url}?offline=1`);
    await page.getByText("继续练习", { exact: true }).click();
    await page.getByText("已答 1 / 4", { exact: false }).waitFor();
    assert.equal(await page.locator("#banks option").count(), 3);
    await page.locator("#file").setInputFiles(path.join(__dirname, "../templates/Word题库示例.docx"));
    await page.getByText("已打开同名题库，保留原有进度。", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log("iPhone-sized WebKit: subpath, Word/Excel import, offline reopen, and saved progress passed.");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
