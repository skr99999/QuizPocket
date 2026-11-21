"use strict";

window.receiveSharedFile = async function (route, name) {
  try {
    const response = await fetch(route);
    if (!response.ok) throw new Error();
    const reader = response.body.getReader();
    const parts = [];
    let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32 * 1024 * 1024) {
        await reader.cancel();
        throw new Error();
      }
      parts.push(value);
    }
    if (!size) throw new Error();
    await window.importSharedFile(new File(parts, name));
  } catch {
    const status = document.getElementById("message");
    status.textContent = "无法读取分享的文件。请先把原文件保存到下载目录，再点「导入题库」选择。单份文件上限为 32 MB。";
    status.hidden = false;
  }
};

