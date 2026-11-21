"use strict";

const $ = id => document.getElementById(id);
const prefix = "quiz-pocket:v1:";
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open("QuizPocket", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("banks", { keyPath: "id" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function storedBanks(mode, operation) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("banks", mode);
    const request = operation(transaction.objectStore("banks"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}
const exampleBank = { id: "example", name: "体验题库", questions: example };
const labels = { correct: "答对", wrong: "答错", partial: "部分正确" };
const banks = new Map([[exampleBank.id, exampleBank]]);
let bank, record, byId, timer;
let view = "home";
let cardOpen = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, handler, className) {
  const item = node("button", text, className);
  item.addEventListener("click", handler);
  return item;
}

function notice(text, isError = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", isError);
  $("message").hidden = !text;
}

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function save() {
  try { localStorage.setItem(prefix + "state:" + bank.id, JSON.stringify(record)); }
  catch { notice("保存进度失败。请释放设备存储空间后重试。", true); }
}

function selectOptions(select, values, selected) {
  select.replaceChildren(...values.map(([key, label]) => {
    const item = node("option", label);
    item.value = key;
    return item;
  }));
  select.value = selected;
  if (select.selectedIndex < 0) select.selectedIndex = 0;
}

function loadBank(id) {
  bank = banks.get(id) ?? exampleBank;
  byId = new Map(bank.questions.map(question => [question.id, question]));
  record = read(prefix + "state:" + bank.id, { wrong: [], favorites: [], session: null });
  try { localStorage.setItem(prefix + "active", JSON.stringify(bank.id)); }
  catch { notice("保存题库选择失败。", true); }
  showHome();
}

function subjectQuestions() {
  const subject = $("subject").value;
  return bank.questions.filter(q => !subject || q.subject === subject);
}

function fillCategories(selected = "") {
  const values = [...new Set(subjectQuestions().flatMap(q => [q.category, types[q.type]]).filter(Boolean))];
  selectOptions($("category"), [["", "全部题型和分类"], ...values.map(value => [value, value])], selected);
}

function filters() {
  return Object.fromEntries(["subject", "category", "scope", "order"].map(key => [key, $(key).value]));
}

function matchingQuestions({ subject, category, scope }) {
  return bank.questions.filter(q =>
    (!subject || q.subject === subject) &&
    (!category || q.category === category || types[q.type] === category) &&
    (scope === "all" || record[scope].includes(q.id))
  );
}

function sameFilters() {
  return record.session && Object.entries(filters()).every(([key, value]) => record.session.filters[key] === value);
}

function renderStart() {
  const current = filters();
  $("start").textContent = sameFilters() ? "继续练习" : "开始练习";
  $("start").disabled = !sameFilters() && !matchingQuestions(current).length;
  $("restart").hidden = !sameFilters();
  $("restart").disabled = !matchingQuestions(current).length;
}

function showHome() {
  clearTimeout(timer);
  view = "home";
  cardOpen = false;
  $("practice").hidden = true;
  $("setup").hidden = false;
  $("guide").hidden = false;
  $("import").hidden = false;
  const current = record.session?.filters;
  const bankNames = new Map();
  selectOptions($("banks"), [...banks.values()].map(item => {
    const count = (bankNames.get(item.name) ?? 0) + 1;
    bankNames.set(item.name, count);
    return [item.id, item.name + (count > 1 ? "（" + count + "）" : "")];
  }), bank.id);
  const subjects = [...new Set(bank.questions.map(q => q.subject).filter(Boolean))];
  selectOptions($("subject"), [["", "全部科目"], ...subjects.map(value => [value, value])], current?.subject ?? "");
  fillCategories(current?.category);
  $("scope").value = current?.scope ?? "all";
  $("order").value = current?.order ?? "original";
  $("scope").options[1].textContent = "错题（" + record.wrong.length + "）";
  $("scope").options[2].textContent = "收藏（" + record.favorites.length + "）";
  const counts = Object.entries(types).map(([key, type]) => [type, bank.questions.filter(q => q.type === key).length])
    .filter(([, count]) => count).map(([type, count]) => type + " " + count);
  const issues = bank.questions.filter(q => q.issues.length);
  $("summary").textContent = [bank.questions.length + " 题", ...counts, ...(issues.length ? ["待核 " + issues.length] : [])].join(" · ");
  const warnings = bank.warnings ?? [];
  $("issues").hidden = !issues.length && !warnings.length;
  $("issues").open = false;
  $("issues").querySelector("ul").replaceChildren(...warnings.map(text => node("li", text)), ...issues.map(q => node("li",
    [q.originalId || "第 " + (bank.questions.indexOf(q) + 1) + " 题", q.issues.join("、"), q.source].filter(Boolean).join(" · "))));
  renderStart();
}

window.quizBack = () => {
  if (view === "home") return false;
  if (cardOpen) {
    cardOpen = false;
    renderCard();
  } else showHome();
  return true;
};

function begin(restart) {
  notice("");
  if (restart || !sameFilters()) {
    const current = filters();
    const ids = matchingQuestions(current).map(q => q.id);
    if (!ids.length) return;
    if (current.order === "random") {
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    }
    record.session = { filters: current, ids, index: 0, status: {}, picks: {}, drafts: {}, revealed: {} };
    save();
  }
  view = "practice";
  $("setup").hidden = true;
  $("guide").hidden = true;
  $("import").hidden = true;
  $("practice").hidden = false;
  render();
}

function move(index) {
  clearTimeout(timer);
  record.session.index = index;
  save();
  render();
}

function mark(q, status) {
  record.session.status[q.id] = status;
  record.wrong = record.wrong.filter(id => id !== q.id);
  if (status !== "correct") record.wrong.push(q.id);
  save();
  render();
  const index = record.session.index;
  if (status === "correct" && (q.type === "single" || q.type === "tf") && index + 1 < record.session.ids.length) {
    timer = setTimeout(() => move(index + 1), 750);
  }
}

function toggleFavorite(q, control) {
  const current = record.favorites.includes(q.id);
  if (current) record.favorites = record.favorites.filter(id => id !== q.id);
  else record.favorites.push(q.id);
  save();
  control.textContent = current ? "收藏" : "已收藏";
  control.setAttribute("aria-pressed", String(!current));
}

function renderCard() {
  const { ids, index, status } = record.session;
  $("card").hidden = !cardOpen;
  $("card-toggle").setAttribute("aria-expanded", String(cardOpen));
  if (!cardOpen) return;
  $("grid").replaceChildren(...ids.map((id, i) => {
    const item = button(i + 1, () => move(i), status[id]);
    item.setAttribute("aria-label", "第 " + (i + 1) + " 题 · " + (labels[status[id]] ?? "未做"));
    if (i === index) item.setAttribute("aria-current", "true");
    return item;
  }));
}

function reference(q) {
  const validOptions = !q.issues.length && q.type !== "short" && q.type !== "tf";
  const answer = validOptions ? q.keys.map(key => {
    const item = q.options.find(option => option.key === key);
    return key + ". " + item.text;
  }).join("；") : q.answer;
  return ["参考答案　" + (answer || "原题未提供"), q.explanation && "解析　" + q.explanation, q.source && "来源　" + q.source]
    .filter(Boolean).join("\n");
}

function render() {
  const state = record.session;
  const q = byId.get(state.ids[state.index]);
  const status = state.status[q.id];
  const chosen = state.picks[q.id] ?? [];
  const shown = status || state.revealed[q.id];
  const review = q.issues.length > 0;
  const total = state.ids.length;
  const answered = Object.keys(state.status).length;
  const correct = Object.values(state.status).filter(value => value === "correct").length;
  $("position").textContent = "第 " + (state.index + 1) + " / " + total + " 题";
  $("stats").textContent = "已答 " + answered + " / " + total + " · 正确率 " + (answered ? Math.round(correct / answered * 100) : "0") + "% · 错题 " + record.wrong.length + " · 收藏 " + record.favorites.length;
  $("previous").disabled = state.index === 0;
  $("next").disabled = state.index + 1 === total;
  const question = $("question");
  const top = node("div", undefined, "question-top");
  const favorite = button(record.favorites.includes(q.id) ? "已收藏" : "收藏", () => toggleFavorite(q, favorite), "secondary");
  favorite.setAttribute("aria-pressed", String(record.favorites.includes(q.id)));
  top.append(node("span", [q.subject, q.category, q.section].filter(Boolean).join(" · ")), favorite);
  question.replaceChildren(top, node("h2", q.question || "题干缺失"));

  if (review) question.append(node("p", "待核 · " + q.issues.join("、"), "feedback wrong"));
  if (q.options.length && (q.type !== "short" || review)) {
    const options = node("div", undefined, "options");
    let submit;
    for (const item of q.options) {
      const option = button(undefined, () => {
        if (q.type === "multi") {
          const index = chosen.indexOf(item.key);
          if (index >= 0) chosen.splice(index, 1);
          else chosen.push(item.key);
          option.setAttribute("aria-pressed", String(index < 0));
          state.picks[q.id] = chosen;
          submit.disabled = !chosen.length;
          save();
        } else {
          const picked = [item.key];
          state.picks[q.id] = picked;
          mark(q, grade(q.keys, picked));
        }
      }, "option");
      option.append(node("span", item.key), node("span", item.key === item.text ? "" : item.text));
      option.setAttribute("aria-pressed", String(chosen.includes(item.key)));
      option.disabled = Boolean(status || review);
      if (status && q.keys.includes(item.key)) option.classList.add("answer");
      if (status && chosen.includes(item.key) && !q.keys.includes(item.key)) option.classList.add("incorrect");
      options.append(option);
    }
    if (q.type === "multi" && !status && !review) {
      submit = button("提交答案", () => mark(q, grade(q.keys, chosen)));
      submit.disabled = !chosen.length;
      options.append(submit);
    }
    question.append(options);
  }

  if (q.type === "short" && !review) {
    const label = node("label", "我的答案（可选）");
    const draft = node("textarea");
    draft.value = state.drafts[q.id] ?? "";
    draft.readOnly = Boolean(status);
    draft.addEventListener("input", () => {
      state.drafts[q.id] = draft.value;
      save();
    });
    label.append(draft);
    question.append(label);
  }
  if ((q.type === "short" || review) && !shown) {
    question.append(button("查看参考答案", () => {
      state.revealed[q.id] = true;
      save();
      render();
    }, "secondary"));
  }
  if (shown) {
    const feedback = node("div", [status && labels[status], reference(q)].filter(Boolean).join("\n"), "feedback " + (status || "muted"));
    feedback.setAttribute("role", "status");
    question.append(feedback);
    if (q.type === "short" && !status && !review) {
      const actions = node("div", undefined, "actions");
      actions.append(button("自评答对", () => mark(q, "correct")), button("自评答错", () => mark(q, "wrong"), "secondary"));
      question.append(actions);
    }
  }
  renderCard();
}

$("banks").addEventListener("change", event => { notice(""); loadBank(event.target.value); });
$("subject").addEventListener("change", () => { fillCategories($("category").value); renderStart(); });
for (const id of ["category", "scope", "order"]) $(id).addEventListener("change", renderStart);
$("start").addEventListener("click", () => begin(false));
$("restart").addEventListener("click", () => begin(true));
$("home").addEventListener("click", showHome);
$("previous").addEventListener("click", () => move(record.session.index - 1));
$("next").addEventListener("click", () => move(record.session.index + 1));
$("card-toggle").addEventListener("click", () => { cardOpen = !cardOpen; renderCard(); });
$("import").addEventListener("click", () => $("file").click());

let importing = false;

async function importFile(file) {
  if (importing) {
    notice("正在导入一份题库，请稍后再试。", true);
    return;
  }
  importing = true;
  $("import").disabled = true;
  try {
    if (!file.size || file.size > 32 * 1024 * 1024) throw new Error("请选择大于 0 且不超过 32 MB 的文件。");
    let name = file.name.replace(/\.[^.]+$/, "") || "未命名题库";
    let questions, warnings = [];
    if (/\.(xlsx|xls|docx|doc)$/i.test(file.name)) {
      const result = await window.parseOffice(file);
      if (!Array.isArray(result.questions) || !result.questions.length) throw new Error("找不到可导入的题目。");
      questions = normalize(result.questions);
      name = result.title?.trim() || name;
      warnings = result.warnings ?? [];
    } else {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      questions = parseBank(text, file.name);
    }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(questions))));
    const fingerprint = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    await ready;
    const existing = [...banks.values()].find(item => item.name === name && item.fingerprint === fingerprint);
    if (existing) {
      loadBank(existing.id);
      notice("已打开同名题库，保留原有进度。");
      return;
    }
    const item = { id: crypto.randomUUID(), name, questions, warnings, fingerprint, importedAt: Date.now() };
    await storedBanks("readwrite", store => store.add(item));
    banks.set(item.id, item);
    loadBank(item.id);
    $("issues").open = !$("issues").hidden;
    notice("已导入「" + item.name + "」，共 " + questions.length + " 题。");
  } catch (error) {
    const message = {
      QuotaExceededError: "本机题库存储空间不足。现有题库已保留。",
      SyntaxError: "题库中的 JSON 格式不正确。",
      TypeError: error.message.includes("UTF-8") ? "请确认 HTML、JSON 或 CSV 文件为 UTF-8 编码。" : error.message
    }[error.name] ?? error.message;
    notice("导入失败 · " + message, true);
  } finally {
    importing = false;
    $("import").disabled = false;
  }
}

window.importSharedFile = importFile;

$("file").addEventListener("change", event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) importFile(file);
});

const ready = (async () => {
  try {
    const items = await storedBanks("readonly", store => store.getAll());
    items.sort((a, b) => (a.importedAt ?? 0) - (b.importedAt ?? 0));
    for (const item of items) banks.set(item.id, item);
  } catch {
    notice("无法读取本机保存的题库。", true);
  }
  loadBank(read(prefix + "active", "example"));
})();

window.addEventListener("DOMContentLoaded", () => window.consumeSharedFile?.());


