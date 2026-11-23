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
    await page.getByText("题库", { exact: true }).first().click();
    await page.locator("#open-vocabulary").click();
    await page.locator("#word-start:not([disabled])").waitFor();
    await page.locator("#word-file").setInputFiles(path.join(__dirname, "../templates/生词本示例.csv"));
    await page.getByText(/^已导入「生词本示例」/).waitFor();
    await page.locator("#word-start").click();
    await page.locator("#word-reveal").click();
    await page.locator("#word-known").click();
    await page.waitForFunction(() => document.querySelector("#word-position").textContent.startsWith("2 /"));
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
    await page.locator("#open-vocabulary").click();
    await page.locator("#word-start:not([disabled])").waitFor();
    assert.equal(await page.locator("#word-books option").count(), 2);
    await page.locator("#word-file").setInputFiles(path.join(__dirname, "../templates/生词本示例.csv"));
    await page.getByText("已打开同一份词库，保留了原有进度。", { exact: true }).waitFor();
    await page.locator("#word-start").click();
    assert.notEqual(await page.locator("#word-term").textContent(), "adapt");
    await page.locator("#word-ai summary").click();
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (url !== "https://api.deepseek.com/chat/completions") return originalFetch(url, options);
        window.mockRequest = { url, options };
        return new Response(JSON.stringify({ choices: [{ message: { content: "测试解析" } }] }), { status: 200 });
      };
    });
    await page.locator("#word-key").fill("test-key");
    await page.locator("#word-explain").click();
    await page.getByText("测试解析", { exact: true }).waitFor();
    const request = await page.evaluate(() => window.mockRequest);
    assert.equal(request.url, "https://api.deepseek.com/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer test-key");
    assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.redirect, "error");
    assert.match(JSON.parse(request.options.body).messages[1].content, /当前词条：.+\n/);
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
