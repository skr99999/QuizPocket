"use strict";

const button = document.getElementById("update");
const status = document.getElementById("update-status");
button.onclick = async () => {
  button.disabled = true;
  status.textContent = "正在检查更新，请保持联网…";
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
    await registration.update();
    const worker = registration.installing || registration.waiting ||
      (registration.active?.state === "activating" ? registration.active : null);
    if (worker) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error()), 60000);
        const check = () => {
          if (worker.state === "activated") { clearTimeout(timeout); resolve(); }
          else if (worker.state === "redundant") { clearTimeout(timeout); reject(new Error()); }
        };
        worker.addEventListener("statechange", check);
        check();
      });
    }
    status.textContent = "更新检查完成，请点下方链接返回并打开背单词。";
  } catch {
    status.textContent = "更新失败，请检查网络后重试。";
  } finally {
    button.disabled = false;
  }
};
