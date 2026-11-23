"use strict";
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { webkit } = require("playwright-core");

async function main() {
  if (!process.argv[2] || !process.argv[3]) throw new Error("Pass previous and new web build directories");
  let output = path.resolve(process.argv[2]);
  const mount = "/test/QuizPocket/";
  const server = createServer(async (request, response) => {
    const name = new URL(request.url, "http://localhost").pathname.slice(mount.length) || "index.html";
    if (!/^[\w.-]+$/.test(name)) return response.writeHead(404).end();
    try {
      const data = await readFile(path.join(output, name));
      const type = name.endsWith(".html") ? "text/html" : name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "application/octet-stream";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(data);
    } catch { response.writeHead(404).end(); }
  });
  const browser = await webkit.launch();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}${mount}`;
  try {
    const context = await browser.newContext();
    const oldPage = await context.newPage();
    await oldPage.goto(url);
    await oldPage.waitForFunction(() => navigator.serviceWorker.controller);
    const oldCache = await oldPage.evaluate(() => caches.keys());
    await oldPage.evaluate(() => localStorage.setItem("quiz-pocket:v1:upgrade-test", "quiz-progress"));
    await oldPage.locator("#open-vocabulary").click();
    await oldPage.locator("#word-start:not([disabled])").waitFor();
    await oldPage.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("QuizPocketVocabulary");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("state", "readwrite");
        transaction.objectStore("state").put({ key: "progress:sample", value: { 0: { streak: 1, due: 9999999999999 } } });
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
      db.close();
      localStorage.setItem("quiz-pocket:vocabulary:api-key", "test-key");
    });
    output = path.resolve(process.argv[3]);
    const updatePage = await context.newPage();
    await updatePage.goto(url + "update.html");
    await updatePage.locator("#update").click();
    await updatePage.getByText("更新检查完成", { exact: false }).waitFor({ timeout: 70000 });
    const newCache = await updatePage.evaluate(() => caches.keys());
    assert.notDeepEqual(newCache, oldCache);
    assert.equal(await oldPage.evaluate(() => localStorage.getItem("quiz-pocket:v1:upgrade-test")), "quiz-progress");
    await updatePage.locator("a").click();
    await updatePage.locator("#open-vocabulary").click();
    await updatePage.locator("#word-start:not([disabled])").waitFor();
    assert.match(await updatePage.locator("#word-summary").textContent(), /当前可学或复习 7 词/);
    await updatePage.locator("#word-start").click();
    await updatePage.locator("#word-ai summary").click();
    assert.equal(await updatePage.locator("#word-key").inputValue(), "test-key");
    assert.equal(await updatePage.locator("#word-remember").isChecked(), true);
    assert.equal(await oldPage.locator("h1").textContent(), "背单词");
    console.log("Previous worker updated with an old page open; quiz and word progress and remembered key preserved.");
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
