"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const xlsx = require("../assets/xlsx.full.min.js");
const { readVocabularyFile, nextReview, dueWords } = require("../assets/vocabulary.js");

function file(name, content) {
  return new File([content], name);
}

test("TXT imports Tab-separated definitions and merges case-insensitive duplicates", async () => {
  const words = await readVocabularyFile(file("wordlist.txt", "\uFEFFadapt\t适应\r\nADAPT\t改编\r\nlook up\n"), xlsx);
  assert.deepEqual(words, [
    { term: "adapt", meaning: "适应\n改编", phonetic: "", example: "" },
    { term: "look up", meaning: "", phonetic: "", example: "" }
  ]);
});

test("CSV and Excel keep quoted commas, example lines and optional columns", async () => {
  const rows = [["单词", "释义", "音标", "例句"], ["adapt", "适应, 改编", "/əˈdæpt/", "One example\nAnother example"]];
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, sheet, "生词本");
  for (const bookType of ["xlsx", "xls", "csv"]) {
    const data = bookType === "csv" ? xlsx.utils.sheet_to_csv(sheet) : xlsx.write(workbook, { bookType, type: "array" });
    const words = await readVocabularyFile(file("生词本." + bookType, data), xlsx);
    assert.deepEqual(words, [{ term: "adapt", meaning: "适应, 改编", phonetic: "/əˈdæpt/", example: "One example\nAnother example" }]);
  }
  await assert.rejects(readVocabularyFile(file("bad.txt", new Uint8Array([0xff])), xlsx), TypeError);
  await assert.rejects(readVocabularyFile(file("empty.csv", "单词,释义\n"), xlsx), /没有可导入的单词/);
});

test("reviews come before new cards and forgotten cards return after ten minutes", () => {
  const now = 1000;
  const day = 86400000;
  const learned = nextReview(null, true, now);
  assert.deepEqual(learned, { streak: 1, due: now + day });
  assert.deepEqual(nextReview(learned, true, now), { streak: 2, due: now + 3 * day });
  assert.deepEqual(nextReview({ streak: 5 }, true, now), { streak: 5, due: now + 30 * day });
  const forgotten = nextReview(learned, false, now);
  assert.deepEqual(forgotten, { streak: 0, due: now + 600000 });
  const words = ["new", "forgotten", "learned"];
  const progress = { 1: forgotten, 2: learned };
  assert.deepEqual(dueWords(words, progress, now), [0]);
  assert.deepEqual(dueWords(words, progress, forgotten.due), [1, 0]);
});
