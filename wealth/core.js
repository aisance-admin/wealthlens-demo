/* WealthLens · общее: язык, форматирование, экранирование, хранилище, сервер.
   Отчёт живёт в браузере: сам отчёт — в localStorage, файлы выписок — в IndexedDB (для просмотра страницы-источника
   и повторного чтения). На сервер уходят только страницы на чтение и данные отчёта для выводов. */
(function(){
const WL = window.WL = window.WL || {};
const EN = WL.lang === "en";
const t = WL.t = WL.t || ((ru, en) => EN ? en : ru);
WL.EN = EN;

const esc = WL.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const $ = WL.$ = (sel, root = document) => root.querySelector(sel);
WL.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
WL.sleep = ms => new Promise(r => setTimeout(r, ms));
WL.uid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36).padStart(2, "0")).join("");

/* Множественное число: pl(5, ["позиция", "позиции", "позиций"], ["position", "positions"]) */
WL.pl = (n, ru, en) => {
  if(EN) return Math.abs(n) === 1 ? en[0] : en[1];
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? ru[2] : b === 1 ? ru[0] : b >= 2 && b <= 4 ? ru[1] : ru[2];
};

/* Числа и деньги. Знак валюты — перед числом ($1 234 567), минус — типографский. */
const LOCALE = EN ? "en-US" : "ru-RU";
const SYM = {USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", CHF: "CHF ", RUB: "₽", ILS: "₪", INR: "₹", KRW: "₩", TRY: "₺", UAH: "₴", KZT: "₸"};
const nf = {};
const numFmt = d => nf[d] || (nf[d] = new Intl.NumberFormat(LOCALE, {minimumFractionDigits: d, maximumFractionDigits: d}));
const fmt = WL.fmt = {
  num(v, d = 0){ if(v == null || !isFinite(v)) return "—"; const s = numFmt(d).format(Math.abs(v)); return (v < 0 && Math.abs(v) >= Math.pow(10, -d) / 2 ? "−" : "") + s; },
  // Количество: без лишних нулей, до 4 знаков
  qty(v){ if(v == null || !isFinite(v)) return "—"; const d = Math.abs(v) >= 1000 || Number.isInteger(v) ? 0 : Math.min(4, (String(v).split(".")[1] || "").length);
    return fmt.num(v, d); },
  money(v, ccy = "USD", d = 0){
    if(v == null || !isFinite(v)) return "—";
    const s = numFmt(d).format(Math.abs(v)), sym = SYM[ccy], neg = v < 0 && Math.abs(v) >= Math.pow(10, -d) / 2 ? "−" : "";
    return sym ? neg + sym + s : neg + s + " " + (ccy || "");
  },
  // Крупные суммы коротко: $1,2 млн
  short(v, ccy = "USD"){
    if(v == null || !isFinite(v)) return "—";
    const a = Math.abs(v), sym = SYM[ccy] || "", neg = v < 0 ? "−" : "";
    const [k, ru, en] = a >= 1e9 ? [1e9, "млрд", "B"] : a >= 1e6 ? [1e6, "млн", "M"] : a >= 1e4 ? [1e3, "тыс.", "K"] : [1, "", ""];
    const n = numFmt(k === 1 ? 0 : a / k >= 100 ? 0 : 1).format(a / k);
    const tail = k === 1 ? "" : (EN ? en : " " + ru);
    return sym ? neg + sym + n + tail : neg + n + tail + " " + ccy;
  },
  pct(v, d = 1){ if(v == null || !isFinite(v)) return "—"; const lim = Math.pow(10, -d) / 100;
    if(v !== 0 && Math.abs(v) < lim) return (v < 0 ? "−" : "") + "<" + fmt.num(lim * 100, d) + "%"; return fmt.num(v * 100, d) + "%"; },
  date(iso){
    if(!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || "—";
    const [y, m, d] = iso.slice(0, 10).split("-");
    if(!EN) return `${d}.${m}.${y}`;
    return new Date(Date.UTC(+y, +m - 1, +d)).toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: "UTC"});
  },
  days(iso){ if(!iso) return null; const d = Date.parse(iso.slice(0, 10) + "T00:00:00Z"); if(!isFinite(d)) return null;
    const now = new Date(); const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()); return Math.round((d - today) / 864e5); },
};
WL.today = () => { const n = new Date(), p = x => String(x).padStart(2, "0"); return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`; };

/* Хранилище: localStorage с защитой от исключений (приватный режим, запрет сайта хранить данные). */
WL.store = {
  get(k, def = null){ try{ const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); }catch(e){ return def; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} },
};

/* Файлы выписок — в IndexedDB этого браузера: чтобы после перезагрузки (и возврата с оплаты) показать страницу-источник
   и дочитать то, что не прочиталось. Любая ошибка хранилища — не ошибка отчёта. */
const IDB = "wl_files_v2";
let dbP = null;
function db(){
  return dbP = dbP || new Promise((res, rej) => {
    try{
      const r = indexedDB.open(IDB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }catch(e){ rej(e); }
  }).catch(e => { dbP = null; throw e; });
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const x = d.transaction("files", mode), s = x.objectStore("files");
  const out = fn(s); x.oncomplete = () => res(out && out.result !== undefined ? out.result : out); x.onerror = () => rej(x.error); x.onabort = () => rej(x.error); }); };
WL.files = {
  async put(id, blob){ try{ await tx("readwrite", s => s.put(blob, id)); return true; }catch(e){ return false; } },
  async get(id){ try{ const d = await db(); return await new Promise((res, rej) => { const r = d.transaction("files").objectStore("files").get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); }catch(e){ return null; } },
  async del(id){ try{ await tx("readwrite", s => s.delete(id)); }catch(e){} },
  async clear(){ try{ await tx("readwrite", s => s.clear()); }catch(e){} },
};

/* Сервер приложения. Страница с нашего домена и копия на GitHub Pages берут адрес из wealth/api.json; локальный стенд —
   боевой сервер (он разрешает запросы с 127.0.0.1:8787). */
WL.api = async (path, body, opts = {}) => {
  const base = (await WL.apiReady) || "https://api.euroaff.eu";
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeout || 290000);
  if(opts.signal) opts.signal.addEventListener("abort", () => ctl.abort(), {once: true});
  try{
    const r = await fetch(base + path, body === undefined ? {signal: ctl.signal} : {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body), signal: ctl.signal});
    let data = null; try{ data = await r.json(); }catch(e){}
    if(!r.ok) return Object.assign({error: r.status === 429 ? "quota" : r.status === 503 ? "busy" : r.status === 403 ? "forbidden" : "http", status: r.status}, data || {});
    return data || {error: "bad_json"};
  }catch(e){
    return {error: opts.signal && opts.signal.aborted ? "aborted" : ctl.signal.aborted ? "timeout" : "network"};
  }finally{ clearTimeout(timer); }
};

/* Сообщение внизу экрана */
let toastTimer = null;
WL.toast = (text, ms = 5200) => {
  let el = $("#toast");
  if(!el){ el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
  el.textContent = text; el.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("on"), ms);
};

/* Диалог: {eyebrow, title, body (HTML — только своё, экранированное), buttons: [{id, label, primary}], cancel, gate (селектор флажка,
   без которого главная кнопка недоступна), input: {type, placeholder}} → Promise<{choice, value}> */
WL.dialog = ({eyebrow, title, body = "", buttons = [], cancel = "cancel", gate, input}) => new Promise(resolve => {
  const prev = document.activeElement;
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
    ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}
    <h2 id="dlgTitle">${esc(title)}</h2>
    <div class="modal-body">${body}</div>
    ${input ? `<input class="modal-input" type="${esc(input.type || "text")}" placeholder="${esc(input.placeholder || "")}" autocomplete="off">` : ""}
    <div class="modal-actions">${buttons.map(b => `<button type="button" class="btn${b.primary ? " primary" : ""}" data-dlg="${esc(b.id)}">${esc(b.label)}</button>`).join("")}</div>
  </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add("has-modal");
  const done = choice => { const value = input ? wrap.querySelector(".modal-input").value : undefined; wrap.remove();
    if(!document.querySelector(".modal-wrap")) document.body.classList.remove("has-modal");
    document.removeEventListener("keydown", key, true); if(prev && prev.focus) prev.focus(); resolve({choice, value}); };
  const primary = wrap.querySelector(".btn.primary");
  const sync = () => { if(gate && primary) primary.disabled = !wrap.querySelector(gate).checked; };
  if(gate){ sync(); wrap.querySelector(gate).addEventListener("change", sync); }
  wrap.addEventListener("click", e => { const b = e.target.closest("[data-dlg]"); if(b && !b.disabled) done(b.dataset.dlg); else if(e.target === wrap) done(cancel); });
  const key = e => { if(e.key === "Escape"){ e.preventDefault(); done(cancel); }
    else if(e.key === "Enter" && input && document.activeElement === wrap.querySelector(".modal-input") && primary && !primary.disabled){ e.preventDefault(); done(primary.dataset.dlg); } };
  document.addEventListener("keydown", key, true);
  setTimeout(() => (wrap.querySelector(".modal-input") || primary || wrap.querySelector("button")).focus(), 30);
});
})();
