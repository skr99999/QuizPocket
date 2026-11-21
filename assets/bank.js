"use strict";

const types = { single: "单选题", multi: "多选题", tf: "判断题", short: "问答题" };
const aliases = new Map([
  ...Object.keys(types).map(key => [key, key]),
  ...Object.entries(types).map(([key, label]) => [label, key]),
  ["单选", "single"], ["多选", "multi"], ["判断", "tf"],
  ["简答题", "short"], ["简答", "short"], ["问答", "short"], ["填空题", "short"]
]);

function readCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      row.push(field);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      field = "";
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else field += char;
  }
  if (quoted) throw new Error("CSV 有未闭合的双引号。");
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  const headers = rows.shift()?.map(value => value.trim()) ?? [];
  if (!["题型", "题干", "答案"].every(key => headers.includes(key))) {
    throw new Error("CSV 表头须包含「题型」「题干」「答案」。");
  }
  return rows.map((columns, index) => {
    if (columns.length !== headers.length) throw new Error("CSV 第 " + (index + 1) + " 条题目的列数与表头不一致。");
    const value = header => columns[headers.indexOf(header)] ?? "";
    return {
      id: value("编号"),
      type: value("题型"),
      question: value("题干"),
      answer: value("答案"),
      options: Array.from("ABCDEF").filter(key => value(key).trim()).map(key => ({ key, text: value(key) })),
      subject: value("科目"),
      category: value("分类"),
      explanation: value("解析"),
      source: value("来源")
    };
  });
}

function parseBank(text, filename) {
  let data;
  if (/\.csv$/i.test(filename)) data = readCsv(text);
  else if (/\.json$/i.test(filename)) data = JSON.parse(text);
  else if (/\.html?$/i.test(filename)) {
    // Extract only the inert data block. Imported HTML never enters the document.
    const dataBlock = text.match(/<script\s+(?=[^>]*\sid\s*=\s*["']bank-data["']|id\s*=\s*["']bank-data["'])(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/i);
    if (!dataBlock) throw new Error("HTML 内找不到兼容的题库数据。");
    data = JSON.parse(dataBlock[1]);
  } else throw new Error("请选择旧刷题 HTML、JSON 或 UTF-8 CSV 文件。");
  if (!Array.isArray(data) || !data.length) throw new Error("题库须包含题目数组，且至少有一题。");
  return normalize(data);
}

function normalize(data) {
  const string = value => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  const idCounts = new Map();
  for (const row of data) {
    const id = string(row?.id);
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  return data.map((row, index) => {
    const value = row ?? {};
    const type = aliases.get(string(value.type)) ?? "";
    let options = Array.isArray(value.options) ? value.options.map(option => ({
      key: string(option?.key), text: string(option?.text)
    })) : [];
    if (type === "tf" && !options.length) options = [{ key: "对", text: "对" }, { key: "错", text: "错" }];
    const originalId = string(value.id);
    const question = string(value.question);
    const answer = Array.isArray(value.answer) ? value.answer.map(string).join("、") : string(value.answer);
    const keys = Array.isArray(value.answer) ? value.answer.map(string) :
      type === "multi" ? (/^[A-Z]+$/.test(answer) ? Array.from(answer) : answer.split(/[、,，;；\s]+/).filter(Boolean)) : [answer];
    const issues = [];
    if (!question) issues.push("缺少题干");
    if (!type) issues.push("题型无法识别");
    if (!answer) issues.push("缺少答案");
    if (["multi", "single", "tf"].includes(type)) {
      const labels = new Set(options.map(option => option.key));
      if (labels.size < 2 || labels.size !== options.length || options.some(option => !option.key || !option.text)) {
        issues.push("选项缺失、为空或标签重复");
      }
      if (answer && keys.some(key => !labels.has(key))) issues.push("答案引用了不存在的选项");
      if (type === "multi" && new Set(keys).size !== keys.length) issues.push("答案标签重复");
    }
    const duplicate = idCounts.get(originalId) > 1;
    if (duplicate) issues.push("原编号重复");
    return {
      id: originalId && !duplicate ? "id:" + originalId : "row:" + (index + 1),
      originalId, question, answer, keys, options, type, issues,
      subject: string(value.subject),
      category: string(value.category) || types[type] || "待核题",
      section: string(value.section),
      explanation: string(value.explanation),
      source: string(value.source)
    };
  });
}

function grade(keys, picked) {
  if (picked.some(key => !keys.includes(key))) return "wrong";
  return picked.length === keys.length ? "correct" : "partial";
}

const example = normalize([
  { type: "single", subject: "示例", question: "一昼夜通常有多少小时？", answer: "B", options: [{ key: "A", text: "12 小时" }, { key: "B", text: "24 小时" }, { key: "C", text: "48 小时" }], explanation: "一昼夜通常按 24 小时计算。" },
  { type: "multi", subject: "示例", question: "以下哪些数字是偶数？", answer: "AC", options: [{ key: "A", text: "2" }, { key: "B", text: "3" }, { key: "C", text: "8" }] },
  { type: "tf", subject: "示例", question: "1 米等于 100 厘米。", answer: "对" },
  { type: "short", subject: "示例", question: "简述为什么水结成冰后会浮在液态水面上。", answer: "在通常条件下，冰的密度比液态水小。" }
]);
