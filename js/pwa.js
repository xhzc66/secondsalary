/* PWA：注册 Service Worker，并标记是否以主屏幕 App 运行。 */
(function () {
  "use strict";
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
    || window.navigator.standalone === true;
  if (standalone) {
    document.documentElement.classList.add("is-standalone");
  }
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {
      /* 离线缓存注册失败不影响在线使用。 */
    });
  });
})();
