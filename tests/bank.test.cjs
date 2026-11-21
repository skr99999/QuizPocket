const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const bankSource = fs.readFileSync(path.join(__dirname, "../assets/bank.js"), "utf8");
const { parseBank, grade } = vm.runInNewContext(bankSource + "\n({ parseBank, grade })");

test("legacy HTML preserves a malformed answer for review", () => {
  const question = { id: "q1", type: "multi", question: "多选例题", answer: "AC", options: [
    { key: "A", text: "甲" }, { key: "B", text: "乙" }
  ] };
  const html = '<script>throw Error("must not execute")</script>' +
    '<script type="application/json" id="bank-data">' + JSON.stringify([question]) + '</script>';
  const [parsed] = parseBank(html, "old.html");
  assert.equal(parsed.answer, "AC");
  assert.equal(parsed.issues[0], "答案引用了不存在的选项");
});

test("CSV reads quoted multiline content and preserves formulas as text", () => {
  const [parsed] = parseBank('题型,题干,答案,A,B\r\n单选题,"引号 ""内文""\n新行",B,=1+1,四', "questions.csv");
  assert.equal(parsed.question, '引号 "内文"\n新行');
  assert.equal(parsed.options[0].text, "=1+1");
  assert.equal(parsed.issues.length, 0);
});

test("multi-select distinguishes exact, incomplete and incorrect answers", () => {
  assert.equal(grade(["A", "C"], ["C", "A"]), "correct");
  assert.equal(grade(["A", "C"], ["C"]), "partial");
  assert.equal(grade(["A", "C"], ["A", "B"]), "wrong");
});

