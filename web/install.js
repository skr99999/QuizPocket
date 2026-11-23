"use strict";

const status = document.getElementById("offline-status");
const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;

if ("serviceWorker" in navigator) {
  const showReady = () => {
    status.textContent = standalone ? "已可离线使用" : "已可离线使用。iPhone 可在 Safari 中点「分享」→「添加到主屏幕」。";
  };
  if (navigator.serviceWorker.controller) {
    showReady();
  } else {
    status.textContent = "首次打开，正在准备离线使用…";
    navigator.serviceWorker.addEventListener("controllerchange", showReady, { once: true });
  }
  navigator.serviceWorker.register("./sw.js").then(registration => {
    registration.update().catch(() => {});
    const worker = registration.installing;
    if (!worker || navigator.serviceWorker.controller) return;
    const showFailure = () => {
      if (worker.state === "redundant" && !navigator.serviceWorker.controller) {
        status.textContent = "离线准备失败，请联网刷新后再试。";
      }
    };
    worker.addEventListener("statechange", showFailure);
    showFailure();
  }).catch(() => {
    if (!navigator.serviceWorker.controller) status.textContent = "离线准备失败，请联网刷新后再试。";
  });
} else {
  status.textContent = "请通过 HTTPS 在 Safari 中打开以准备离线使用。";
}
