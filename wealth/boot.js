/* WealthLens · запуск страницы: язык интерфейса и адрес сервера. Выполняется до остальных скриптов, когда шапка уже
   на странице. Отдельным файлом: политика безопасности (CSP) не разрешает встроенные скрипты. */
/* Язык интерфейса: ?lang=en|ru запоминается в браузере; по умолчанию русский. */
window.WL = window.WL || {};
WL.lang = (() => {
  const q = new URLSearchParams(location.search).get("lang");
  let l = q === "en" || q === "ru" ? q : null;
  try{ if(l) localStorage.setItem("wl_lang", l); else l = localStorage.getItem("wl_lang"); }catch(e){}
  return l === "en" ? "en" : "ru";
})();
WL.t = (ru, en) => WL.lang === "en" ? en : ru;
document.documentElement.lang = WL.lang;
if(WL.lang === "en"){
  document.title = "WealthLens · portfolio report";
  document.body.dataset.drop = "Drop the files — we will read them";
  const tx = {langBtn: ["RU", "Русский"], addBtn: ["Add files"], newBtn: ["New report"], dlBtn: ["Download"]};
  for(const [id, [text, title]] of Object.entries(tx)){ const b = document.getElementById(id); b.textContent = text; if(title) b.title = title; }
  document.getElementById("langBtn").lang = "ru";
  const m = document.querySelectorAll("#dlMenu small"); m[0].textContent = "To print and send"; m[1].textContent = "All positions and reconciliation";
  document.getElementById("client").setAttribute("aria-label", "Report name");
}
/* Адрес сервера: страница с нашего домена и копия на GitHub Pages берут его из wealth/api.json; локальный стенд — боевой сервер. */
WL.apiReady = (async () => {
  let api = "";
  if(!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname)){
    try{ const r = await fetch("wealth/api.json?t=" + Date.now(), {cache: "no-store"}); if(r.ok) api = (await r.json()).api || ""; }catch(e){}
  } else {
    /* Локальный стенд может ходить в локальный сервер: ?api=http://127.0.0.1:8790 */
    const o = new URLSearchParams(location.search).get("api");
    if(o && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(o)) api = o;
  }
  return WL.API_BASE = String(api || "https://api.euroaff.eu").replace(/\/+$/, "");
})();
