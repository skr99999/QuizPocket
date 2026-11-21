"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const assets = path.join(__dirname, "../assets");
const window = { XLSX: require(path.join(assets, "xlsx.full.min.js")) };
const context = vm.createContext({ window });
for (const script of ["bank.js", "office.js"]) {
  vm.runInContext(fs.readFileSync(path.join(assets, script), "utf8"), context);
}
const normalize = vm.runInContext("normalize", context);
const file = (buffer, name) => new File([buffer], name);

(async () => {
  const contents = fs.readFileSync(path.join(__dirname, "../templates/Excel题库示例.xlsx"));
  const sample = await window.parseOffice(file(contents, "Excel题库示例.xlsx"));
  const questions = normalize(sample.questions);
  assert.deepEqual(Array.from(questions, row => row.type), ["single", "multi", "tf", "short"]);
  assert.deepEqual(Array.from(questions, row => row.answer), ["B", "AC", "对", "H₂O"]);
  assert(questions.every(row => !row.issues.length));

  const workbook = window.XLSX.utils.book_new();
  const sheet = window.XLSX.utils.aoa_to_sheet([
    ["题目内容", "选项", "", "", "标准答案"],
    ["哪两个是偶数？", "A.2", "B.3", "C.4", "A#C"],
    ["测试通过了。", "", "", "", "Y"],
    ["无选项的答案需要待核。", "A.1", "B.2", "", "AC"]
  ]);
  window.XLSX.utils.book_append_sheet(workbook, sheet, "题目");
  const binary = window.XLSX.write(workbook, { type: "buffer", bookType: "biff8" });
  const legacy = normalize((await window.parseOffice(file(binary, "旧格式.xls"))).questions);
  assert.deepEqual(Array.from(legacy, row => row.answer), ["AC", "对", "AC"]);
  assert(legacy[2].issues.includes("答案引用了不存在的选项"));
  await assert.rejects(window.parseOffice(file(Buffer.alloc(1), "旧格式.doc")), /另存为 .docx/);
  console.log("Office import assertions passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
