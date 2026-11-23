"use strict";

function vocabularyWords(rows) {
  const fields = value => String(value ?? "").trim();
  const header = /^(单词|词条|英文|word|term)$/i;
  const words = new Map();
  for (const row of rows) {
    const [term, meaning = "", phonetic = "", example = ""] = row.slice(0, 4).map(fields);
    if (!term) continue;
    if (!words.size && header.test(term) && (/^(单词|词条|英文)$/.test(term)
        || /^(释义|中文释义|中文|翻译|definition|meaning|translation)$/i.test(meaning))) continue;
    if (term.length > 200 || meaning.length > 6000 || phonetic.length > 500 || example.length > 6000) {
      throw new Error("单个词条或释义过长，请检查文件格式。");
    }
    const id = term.toLowerCase();
    const previous = words.get(id);
    if (!previous) words.set(id, { term, meaning, phonetic, example });
    else {
      for (const [key, value] of Object.entries({ meaning, phonetic, example })) {
        if (value && !previous[key].split("\n").includes(value)) previous[key] = [previous[key], value].filter(Boolean).join("\n");
      }
    }
    if (words.size > 20000) throw new Error("每个词库最多 20,000 个单词，请拆分后导入。");
  }
  if (!words.size) throw new Error("没有可导入的单词，请检查第一列。");
  return [...words.values()];
}

async function readVocabularyFile(file, xlsx) {
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("请选择大于 0 且不超过 8 MB 的文件。");
  if (!/\.(xlsx|xls|csv|txt|tsv)$/i.test(file.name)) throw new Error("请选择 Excel、CSV、TXT 或 TSV 文件。");
  const buffer = await file.arrayBuffer();
  if (/\.(txt|tsv)$/i.test(file.name)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return vocabularyWords(text.split(/\r\n|\n|\r/).map(line => line.split("\t")));
  }
  const csv = /\.csv$/i.test(file.name);
  const source = csv ? new TextDecoder("utf-8", { fatal: true }).decode(buffer) : buffer;
  const workbook = xlsx.read(source, { type: csv ? "string" : "array", FS: ",", raw: true, cellFormula: false, cellHTML: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return vocabularyWords(xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false }));
}

const reviewDays = [1, 3, 7, 14, 30];

function nextReview(previous, known, now) {
  const streak = known ? Math.min((previous?.streak ?? 0) + 1, reviewDays.length) : 0;
  const minutes = known ? reviewDays[streak - 1] * 1440 : 10;
  return { streak, due: now + minutes * 60000 };
}

function dueWords(words, progress, now) {
  const review = [], fresh = [];
  words.forEach((_, index) => {
    if (!progress[index]) fresh.push(index);
    else if (progress[index].due <= now) review.push(index);
  });
  return review.concat(fresh);
}

if (typeof module !== "undefined") module.exports = { readVocabularyFile, nextReview, dueWords };

if (typeof document !== "undefined" && (window.QuizAndroid || document.querySelector('meta[name="quizpocket-web"]'))) {
  const $ = id => document.getElementById(id);
  const sample = { id: "sample", name: "体验词库", words: vocabularyWords([
    ["adapt", "v. 适应；改编", "/əˈdæpt/", "It takes time to adapt to a new routine."],
    ["clarify", "v. 说明；澄清", "/ˈklærəfaɪ/", "Could you clarify what you mean?"],
    ["consistent", "adj. 一致的；持续的", "/kənˈsɪstənt/", "Her results were consistent across all three tests."],
    ["derive", "v. 获得；源自", "/dɪˈraɪv/", "The word derives from Latin."],
    ["maintain", "v. 保持；维护", "/meɪnˈteɪn/", "We need to maintain a regular sleep schedule."],
    ["preserve", "v. 保护；保存", "/prɪˈzɜːrv/", "The archive helps preserve the town's history."],
    ["reliable", "adj. 可靠的", "/rɪˈlaɪəbəl/", "We need a reliable source of information."],
    ["retrieve", "v. 取回；检索", "/rɪˈtriːv/", "You can retrieve the document from the archive."]
  ]) };
  const books = new Map([[sample.id, sample]]);
  const states = new Map();
  const bridge = window.QuizAndroid;
  const web = !bridge;
  let book, progress, queue = [], position = 0, pending = "", reviewTimer, saving = false;
  let database;

  function notice(text, error = false) {
    $("message").textContent = text;
    $("message").classList.toggle("error", error);
    $("message").hidden = !text;
  }

  function store(name, mode, operation) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(name, mode);
      const request = operation(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function showBook(id) {
    book = books.get(id) ?? sample;
    progress = states.get("progress:" + book.id) ?? {};
    $("word-books").replaceChildren(...[...books.values()].map(item => new Option(item.name, item.id)));
    $("word-books").value = book.id;
    updateDueCount();
    $("word-practice").hidden = true;
    $("word-setup").hidden = false;
    $("guide").hidden = false;
    pending = "";
  }

  async function saveState(key, value) {
    await store("state", "readwrite", object => object.put({ key, value }));
    states.set(key, value);
  }

  async function selectBook(id) {
    $("word-books").disabled = $("word-start").disabled = true;
    try {
      await saveState("active", id);
    } finally {
      $("word-books").disabled = false;
    }
    showBook(id);
  }

  function updateDueCount() {
    clearTimeout(reviewTimer);
    const now = Date.now();
    const due = dueWords(book.words, progress, now).length;
    $("word-summary").textContent = book.words.length + " 词 · 当前可学或复习 " + due + " 词";
    $("word-start").disabled = !due || $("word-import").disabled;
    const next = Object.values(progress).reduce((earliest, item) =>
      item.due > now ? Math.min(earliest, item.due) : earliest, Infinity);
    if (Number.isFinite(next)) reviewTimer = setTimeout(updateDueCount, Math.min(next - now, 2147483647));
  }

  function renderCard() {
    const word = book.words[queue[position]];
    $("word-position").textContent = (position + 1) + " / " + queue.length;
    $("word-term").textContent = word.term;
    $("word-phonetic").textContent = word.phonetic;
    $("word-phonetic").hidden = !word.phonetic;
    $("word-answer").textContent = [word.meaning || "该词条没有释义。", word.example].filter(Boolean).join("\n");
    $("word-answer").hidden = $("word-grade").hidden = true;
    $("word-reveal").hidden = false;
    $("word-ai").open = false;
    $("word-question").value = "";
    $("word-reply").hidden = true;
    pending = "";
    $("word-explain").disabled = $("word-ask").disabled = false;
  }

  async function grade(known) {
    if (saving) return;
    saving = true;
    $("word-known").disabled = $("word-forgot").disabled = $("word-home").disabled = true;
    const index = queue[position];
    const updated = { ...progress, [index]: nextReview(progress[index], known, Date.now()) };
    try {
      await saveState("progress:" + book.id, updated);
    } catch {
      notice("保存背词进度失败，请释放存储空间后重试。", true);
      return;
    } finally {
      saving = false;
      $("word-known").disabled = $("word-forgot").disabled = $("word-home").disabled = false;
    }
    progress = updated;
    notice("");
    position++;
    if (position < queue.length) renderCard();
    else {
      showBook(book.id);
      notice("本组已完成，共 " + queue.length + " 词。");
    }
  }

  function ask(explain) {
    const key = $("word-key").value.trim();
    const question = explain ? "请解释这个单词的常用含义、典型搭配和容易混淆的用法。" : $("word-question").value.trim();
    $("word-reply").className = "feedback muted";
    $("word-reply").hidden = false;
    if (!key || !question) {
      $("word-reply").textContent = key ? "请先输入问题。" : "请先填写 DeepSeek API Key。";
      return;
    }
    pending = crypto.randomUUID();
    $("word-explain").disabled = $("word-ask").disabled = true;
    $("word-reply").textContent = "正在请求 DeepSeek…";
    if (bridge) bridge.askDeepSeek(pending, key, book.words[queue[position]].term, question);
    else {
      const id = pending;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      fetch("https://api.deepseek.com/chat/completions", {
        method: "POST", credentials: "omit", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: "deepseek-flash", thinking: { type: "disabled" }, max_tokens: 900, stream: false, messages: [{ role: "system", content: "你是英语词汇老师。用简体中文解释英文用法，给出简短的英语例句和中文翻译。" }, { role: "user", content: "当前词条：" + book.words[queue[position]].term + "\n" + question }] })
      }).then(async response => {
        if (!response.ok) throw new Error(({ 401: "API Key 无效，请检查后重试。", 402: "API 账户余额不足。", 429: "请求过于频繁，请稍后重试。" })[response.status] || "DeepSeek 请求失败，请稍后重试。");
        const data = await response.json();
        const answer = data.choices?.[0]?.message?.content;
        if (!answer) throw new Error("DeepSeek 返回内容为空。");
        window.receiveVocabularyAnswer(id, answer, false);
      }).catch(error => window.receiveVocabularyAnswer(id, error.name === "AbortError" ? "请求超时，请检查网络后重试。" : error.message || "网络请求失败，请稍后重试。", true))
        .finally(() => clearTimeout(timeout));
    }
  }

  window.receiveVocabularyAnswer = (id, answer, error) => {
    if (id !== pending) return;
    pending = "";
    $("word-reply").classList.toggle("wrong", error);
    $("word-reply").classList.toggle("muted", !error);
    $("word-reply").textContent = answer;
    $("word-explain").disabled = $("word-ask").disabled = false;
  };

  $("quiz-home").onclick = () => web ? location.href = "index.html" : bridge.openVocabulary(false);
  $("word-home").onclick = () => { notice(""); showBook(book.id); };
  $("word-books").onchange = async event => {
    notice("");
    try {
      await selectBook(event.target.value);
    } catch {
      showBook(book.id);
      notice("保存词库选择失败，请重试。", true);
    }
  };
  $("word-start").onclick = () => {
    queue = dueWords(book.words, progress, Date.now()).slice(0, 20);
    if (!queue.length) return;
    position = 0;
    notice("");
    $("word-setup").hidden = $("guide").hidden = true;
    $("word-practice").hidden = false;
    clearTimeout(reviewTimer);
    renderCard();
  };
  $("word-reveal").onclick = () => {
    $("word-reveal").hidden = true;
    $("word-answer").hidden = $("word-grade").hidden = false;
  };
  $("word-known").onclick = () => grade(true);
  $("word-forgot").onclick = () => grade(false);
  $("word-explain").onclick = () => ask(true);
  $("word-ask").onclick = () => ask(false);
  $("word-downloads").querySelectorAll("button").forEach((control, index) => {
    control.onclick = () => {
      if (bridge) bridge.openWordList(index);
      else window.open("https://github.com/KyleBing/english-vocabulary/blob/master/" + encodeURIComponent(["3 四级-乱序.txt", "4 六级-乱序.txt", "5 考研-乱序.txt"][index]), "_blank", "noopener,noreferrer");
    };
  });
  $("word-import").onclick = () => $("word-file").click();

  const ready = (async () => {
    try {
      database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("QuizPocketVocabulary", 2);
        request.onupgradeneeded = event => {
          if (event.oldVersion < 1) request.result.createObjectStore("books", { keyPath: "id" });
          request.result.createObjectStore("state", { keyPath: "key" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const item of await store("books", "readonly", object => object.getAll())) books.set(item.id, item);
      for (const item of await store("state", "readonly", object => object.getAll())) states.set(item.key, item.value);
      showBook(states.get("active"));
    } catch {
      showBook(sample.id);
      notice("无法读取本机词库。", true);
    }
  })();

  $("word-file").onchange = async event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file || $("word-import").disabled) return;
    $("word-import").disabled = $("word-start").disabled = true;
    try {
      const words = await readVocabularyFile(file, window.XLSX);
      const name = file.name.replace(/\.[^.]+$/, "") || "未命名词库";
      const bytes = new TextEncoder().encode(JSON.stringify([name, words]));
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const id = [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
      await ready;
      const existing = books.has(id);
      if (!existing) {
        const item = { id, name, words };
        await store("books", "readwrite", object => object.add(item));
        books.set(id, item);
      }
      await selectBook(id);
      notice(existing ? "已打开同一份词库，保留了原有进度。" : "已导入「" + name + "」，共 " + words.length + " 词。");
    } catch (error) {
      showBook(book?.id);
      notice("导入失败 · " + (error.name === "TypeError" ? "请检查文件编码，文本文件须为 UTF-8。" : error.message), true);
    } finally {
      $("word-import").disabled = false;
      updateDueCount();
    }
  };
}
