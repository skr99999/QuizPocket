(() => {
  "use strict";

  const clean = value => String(value ?? "").trim();
  const optionPattern = /^([A-Za-zＡ-Ｚａ-ｚ])[.．、:：)）]\s*(.+)$/su;
  const answerPattern = /^(?:【?(?:参考|正确|标准)?答案】?)\s*[:：]?\s*(.*)$/u;
  const explanationPattern = /^(?:【?(?:答案解析|答案说明|解析|解答)】?)\s*[:：]?\s*(.*)$/u;
  const numberPattern = /^(?:第\s*(\d+)\s*题\s*[:：.、]?\s*|[（(](\d+)[）)]\s*|(\d+)\s*[.．、)）]\s*)(.+)$/u;

  function questionType(value) {
    if (/^(?:multi|多选|多项选择|不定项)/i.test(value)) return "multi";
    if (/^(?:single|单[项选])/i.test(value)) return "single";
    if (/^(?:tf|判断|是非|对错)/i.test(value)) return "tf";
    if (/^(?:short|问答|简答|填空|论述|实作|实操|操作)/i.test(value)) return "short";
    return "";
  }

  function optionParts(text) {
    const pattern = /(?:^|[\s;；])([A-Za-zＡ-Ｚａ-ｚ])[.．、:：)）]\s*/gu;
    const hits = [...text.matchAll(pattern)];
    if (!hits.length || hits[0].index !== 0) return [];
    return hits.map((hit, index) => ({
      key: hit[1].normalize("NFKC").toUpperCase(),
      text: text.slice(hit.index + hit[0].length, hits[index + 1]?.index).trim()
    }));
  }

  function finalize(row) {
    const truth = { 对: "对", 正确: "对", 是: "对", "√": "对", "✔": "对", true: "对", y: "对", 错: "错", 错误: "错", 否: "错", "×": "错", "✗": "错", false: "错", n: "错" };
    const marker = row.answer.replace(/^[（(]\s*|\s*[）)]$/g, "").normalize("NFKC").toLowerCase();
    const bool = Object.prototype.hasOwnProperty.call(truth, marker) ? truth[marker] : "";
    const labels = marker.replace(/[#，,、；;\s]+/g, "").toUpperCase();
    if (!row.type) {
      if (!row.options.length) row.type = bool ? "tf" : row.answer ? "short" : "";
      else if (/^[A-Z]+$/.test(labels)) row.type = labels.length === 1 ? "single" : "multi";
    }
    if (row.type === "tf" && !row.options.length && bool) row.answer = bool;
    if (/^(single|multi)$/.test(row.type) && /^[A-Z]+$/.test(labels)) row.answer = labels;
    return row;
  }

  function fromTable(rows, section, title, warnings) {
    const questions = [];
    let headers = null;
    for (const { cells, index } of rows) {
      const keys = cells.map(cell => clean(cell).normalize("NFKC").replace(/[\s*：:]+/g, "").toUpperCase());
      if (keys.some(key => /^(题干|题目|题目内容|题目名称|问题|试题|试题内容|题干内容|QUESTION)$/.test(key))) {
        const col = pattern => keys.findIndex(key => pattern.test(key));
        headers = {
          question: col(/^(题干|题目|题目内容|题目名称|问题|试题|试题内容|题干内容|QUESTION)$/),
          answer: col(/^(?:标准|参考|正确)?答案$|^ANSWER$/),
          explanation: col(/^(解析|题目解析|答案解析|试题解析|答案说明|说明|备注|EXPLANATION)$/),
          id: col(/^(题号|序号|编号|ID)$/),
          subject: col(/^(科目|主题|SUBJECT)$/),
          type: col(/^(题型|类型|试题类型|TYPE)$/),
          category: col(/^(分类|类别|CATEGORY)$/),
          section: col(/^(章节|分组|SECTION)$/),
          options: col(/^(选项|OPTIONS)$/),
          individual: keys.map(key => key.match(/^(?:选项|OPTION)?([A-Z])$/)?.[1] || "")
        };
        continue;
      }
      if (!headers || !cells.some(cell => clean(cell))) continue;

      const at = column => clean(cells[column]);
      const question = at(headers.question);
      const source = title + " / " + section + " / 第" + index + "行";
      if (!question) {
        if (at(headers.answer) || at(headers.id)) warnings.push(source + "缺少题干，未导入");
        continue;
      }

      let options = headers.individual.flatMap((key, column) => {
        const value = at(column);
        return key && value ? [{ key, text: value.match(optionPattern)?.[2] ?? value }] : [];
      });
      if (!options.length && headers.options >= 0) {
        const end = headers.answer > headers.options ? headers.answer : cells.length;
        options = cells.slice(headers.options, end).flatMap((cell, index) => {
          const content = clean(cell);
          if (!content) return [];
          const parsed = optionParts(content);
          return parsed.length ? parsed : [{ key: String.fromCharCode(65 + index), text: content }];
        });
      }
      questions.push(finalize({
        id: source + (at(headers.id) ? "（原题号 " + at(headers.id) + "）" : ""),
        subject: at(headers.subject) || title, category: at(headers.category),
        section: at(headers.section) || section,
        type: questionType(at(headers.type) || section),
        question, options, answer: at(headers.answer), explanation: at(headers.explanation), source
      }));
    }
    return questions;
  }

  function fromParagraphs(lines, title, warnings) {
    const questions = [];
    let row, field, section = "", type = "";
    const finish = () => {
      if (row) questions.push(finalize(row));
      row = null;
    };

    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      const heading = line.match(/^(?:[一二三四五六七八九十\d]+[、.．]\s*)?[（(【]?\s*([单多](?:选|项选择)题?|不定项(?:选择)?题?|判断题?|是非题|问答题|简答题?|填空题?|论述题|实作题)\s*(?:[（(][^）)]*[）)])?[）)】]?\s*[:：]?$/);
      if (heading) {
        finish();
        section = line;
        type = questionType(heading[1]);
        continue;
      }

      const explanation = line.match(explanationPattern);
      const answer = line.match(answerPattern);
      const numbered = line.match(numberPattern);
      const options = optionParts(line);
      const nextLine = lines[index + 1] || "";
      const unnumbered = row?.answer && field === "answer" && !options.length && optionPattern.test(nextLine);
      if (row && explanation) {
        row.explanation = explanation[1];
        field = "explanation";
      } else if (row && answer) {
        if (row.answer) warnings.push(row.source + "出现多条答案，请核对");
        row.answer = row.answer ? row.answer + "\n" + answer[1] : answer[1];
        field = "answer";
      } else if (numbered || unnumbered || /^题干[:：]\s*\S/.test(line)) {
        finish();
        const originalId = numbered ? numbered[1] || numbered[2] || numbered[3] : "";
        const source = title + " / 第" + (index + 1) + "段";
        let question = numbered ? numbered[4] : line.replace(/^题干[:：]\s*/, "");
        const inlineAnswer = question.match(/\s+[（(]?(?:参考|正确|标准)?答案[:：]\s*(.+?)[）)]?$/);
        if (inlineAnswer) question = question.slice(0, inlineAnswer.index);
        const inlineOptions = question.match(/\s+([A-Za-zＡ-Ｚａ-ｚ][.．、:：)）]\s*.+)$/);
        const parsedOptions = inlineOptions ? optionParts(inlineOptions[1]) : [];
        if (parsedOptions.length > 1) question = question.slice(0, inlineOptions.index);

        row = {
          id: source + (originalId ? "（原题号 " + originalId + "）" : ""),
          subject: title, category: "", section, type, question,
          options: parsedOptions.length > 1 ? parsedOptions : [],
          answer: inlineAnswer?.[1] ?? "", explanation: "", source
        };
        field = "question";
      } else if (row && options.length) {
        row.options.push(...options);
        field = "option";
      } else if (row) {
        if (field === "option") row.options[row.options.length - 1].text += "\n" + line;
        else row[field] += (row[field] ? "\n" : "") + line;
      }
    }
    finish();
    return questions;
  }

  function excelQuestions(buffer, title, warnings) {
    const book = window.XLSX.read(buffer, { cellFormula: false, cellHTML: false });
    return book.SheetNames.flatMap(section => {
      const rows = new Map();
      const sheet = book.Sheets[section];
      for (const address of Object.keys(sheet)) {
        if (!/^[A-Z]+\d+$/.test(address) || sheet[address].v == null) continue;
        const value = clean(window.XLSX.utils.format_cell(sheet[address]));
        if (!value) continue;
        const { r, c } = window.XLSX.utils.decode_cell(address);
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r)[c] = value;
      }
      if (!rows.size) return [];
      const result = fromTable([...rows].sort((a, b) => a[0] - b[0])
        .map(([r, cells]) => ({ cells, index: r + 1 })), section, title, warnings);
      if (!result.length) warnings.push("工作表「" + section + "」未找到带列标题的题目");
      return result;
    });
  }

  async function docxQuestions(buffer, title, warnings) {
    let omittedImages = 0;
    const result = await window.mammoth.convertToHtml({ arrayBuffer: buffer }, {
      convertImage: () => { omittedImages++; return []; }
    });
    if (omittedImages) warnings.push("Word 中有 " + omittedImages + " 张图片未导入，请核对相关题目");
    const template = document.createElement("template");
    template.innerHTML = result.value;
    const textOf = element => {
      const clone = element.cloneNode(true);
      clone.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
      clone.querySelectorAll("p + p").forEach(node => node.before("\n"));
      return clean(clone.textContent);
    };
    const questions = [];
    let lines = [], tables = 0;
    for (const node of template.content.children) {
      if (node.tagName === "TABLE") {
        tables++;
        questions.push(...fromParagraphs(lines, title, warnings));
        lines = Array(lines.length).fill("");
        const rows = [...node.rows].map((row, index) => {
          const cells = [];
          for (const cell of row.cells) {
            cells.push(textOf(cell));
            for (let i = 1; i < cell.colSpan; i++) cells.push("");
          }
          return { cells, index: index + 1 };
        });
        const tableQuestions = fromTable(rows, "表格 " + tables, title, warnings);
        if (tableQuestions.length) questions.push(...tableQuestions);
        else {
          warnings.push("表格 " + tables + " 未找到带列标题的题目");
          lines.push(...rows.map(row => row.cells.filter(Boolean).join(" ")));
        }
      } else if (node.tagName === "OL") {
        const first = Number(node.getAttribute("start")) || 1;
        [...node.children].forEach((item, index) => lines.push(...((first + index) + "、" + textOf(item)).split("\n")));
      } else {
        lines.push(...textOf(node).split("\n"));
      }
    }
    questions.push(...fromParagraphs(lines, title, warnings));
    return questions;
  }

  function checkArchive(buffer) {
    const zip = new DataView(buffer);
    let end = zip.byteLength - 22;
    const floor = Math.max(0, end - 65535);
    while (end >= floor && zip.getUint32(end, true) !== 0x06054b50) end--;
    if (end < floor) throw new Error("文件缺少完整的 ZIP 目录。");

    const count = zip.getUint16(end + 10, true);
    let position = zip.getUint32(end + 16, true), total = 0;
    for (let i = 0; i < count; i++) {
      if (position + 46 > end || zip.getUint32(position, true) !== 0x02014b50) {
        throw new Error("文件的 ZIP 目录不完整，或使用了不支持的 ZIP64 格式。");
      }
      total += zip.getUint32(position + 24, true);
      if (total > 128 * 1024 * 1024) throw new Error("文件解压后超过 128 MB，请拆分题库后再导入。");
      position += 46 + zip.getUint16(position + 28, true) +
        zip.getUint16(position + 30, true) + zip.getUint16(position + 32, true);
    }
  }

  window.parseOffice = async file => {
    const extension = file.name.toLowerCase().split(".").pop();
    const title = file.name.replace(/\.[^.]*$/, "");
    const warnings = [];
    if (extension === "doc") {
      // shortcut: binary DOC is unsupported, add a browser-compatible parser if native import is needed.
      throw new Error("旧版 Word .doc 请先在 Word 或 WPS 中另存为 .docx，再导入。");
    }
    if (!["xlsx", "xls", "docx"].includes(extension)) throw new Error("请选 Excel .xlsx、.xls 或 Word .docx 文件。");
    if (file.size > 32 * 1024 * 1024) throw new Error("文件超过 32 MB，请拆分题库后再导入。");
    const buffer = file.arrayBuffer ? await file.arrayBuffer() : await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("无法读取文件，请重新选择。"));
      reader.readAsArrayBuffer(file);
    });
    if (buffer.byteLength >= 4 && new DataView(buffer).getUint32(0, true) === 0x04034b50) checkArchive(buffer);
    let questions;
    try {
      questions = extension === "docx"
        ? await docxQuestions(buffer, title, warnings)
        : excelQuestions(buffer, title, warnings);
    } catch (error) {
      throw new Error("无法读取此 Office 文件。请确认文件可打开、未加密，并另存为新文件后重试。");
    }
    if (!questions.length) {
      throw new Error(extension === "docx"
        ? "未找到题目。请用带「题干」「答案」列标题的表格，或用题号开头、答案单独标注的段落。"
        : "未找到题目。请检查 Excel 是否包含「题干」「答案」列标题。");
    }
    return { title, questions, warnings };
  };
})();
