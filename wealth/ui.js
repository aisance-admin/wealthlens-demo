/* Флоу велса · экран. Один путь: загрузил выписки → увидел главное → разобрал детали → отчёт.
   Сначала показываем то, что есть в выписках, затем по мере прихода докладываем
   текущие цены и историю. Ничего не ждём, чтобы начать работать. */
(function(){
const WL = window.WL;
const {fmt, esc} = WL;
const t = WL.t;          // t("русский", "English"): строка на языке интерфейса
const EN = WL.lang === "en";
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const STORE = "wl_wealth_v1";
const LEVEL = {high: t("Важно", "Important"), watch: t("Внимание", "Watch"), info: t("К сведению", "Note")};
const TYPE_RU = {stock: t("Акции", "Stocks"), fund: t("Фонды", "Funds"), bond: t("Облигации", "Bonds"), note: t("Ноты", "Notes"), other: t("Прочее", "Other"),
  option: t("Опционы", "Options"), future: t("Фьючерсы", "Futures"), cash: t("Деньги", "Cash")};
// Сверка остатков Swissquote идёт в валюте счёта: франки не должны печататься долларами.
// Подпись сверки приходит из разбора выписки на языке интерфейса: по-английски ищем код валюты рядом со словом balance.
const ccyOf = c => c.ccy || (/Остаток ([A-Z]{3})/.exec(c.label || "") ||
  /\b([A-Z]{3})\b(?=.*\b[Bb]alance\b)|\b[Bb]alance\b.*?\b([A-Z]{3})\b/.exec(c.label || "") || []).slice(1).find(Boolean) || "USD";
/* Аудитория приходит с лендинга (частный инвестор или советник): от неё зависят подписи
   на экране загрузки и имя портфеля по умолчанию. Без лендинга — как у советника. */
const AUDIENCE = (() => { try{ return localStorage.getItem("wl_audience") || ""; }catch(e){ return ""; } })();
const INVESTOR = AUDIENCE === "investor";
const DEFAULT_CLIENT = INVESTOR ? t("Мой портфель", "My portfolio") : t("Клиент", "Client");
// Имя по умолчанию, сохранённое на другом языке, после переключения языка показываем на текущем.
const DEFAULT_NAMES = {"Мой портфель": "My portfolio", "Клиент": "Client"};
const localName = name => EN ? DEFAULT_NAMES[name] || name
  : Object.keys(DEFAULT_NAMES).find(k => DEFAULT_NAMES[k] === name) || name;
const SUPPORT = String(window.WL_SUPPORT_EMAIL || "");
const supportLink = () => SUPPORT ? `<a href="mailto:${esc(SUPPORT)}">${esc(SUPPORT)}</a>` : "";
/* Переключатель языка: тот же адрес с ?lang=…, остальные параметры (demo и др.) сохраняются.
   Внутренние переходы на английском несут ?lang=en, чтобы язык не терялся без хранилища браузера. */
const langUrl = l => { const u = new URL(location.href); u.searchParams.set("lang", l); return u.pathname + u.search + u.hash; };
const HOME = location.pathname + t("", "?lang=en");
const S = {docs: [], P: null, period: "1d", filter: "all", broker: "all", bench: "SPY", client: DEFAULT_CLIENT, showPast: false,
  rid: null, demo: false, basis: (() => { try{ return localStorage.getItem("wl_basis") === "stmt" ? "stmt" : "now"; }catch(e){ return "now"; } })()};

/* Отчёт живёт в хранилище браузера, и открыт он может быть в нескольких вкладках. Пока одна вкладка занята
   (читает выписки, ждёт ответа в окне), другая может его поменять. Тогда при сохранении правки складываются:
   берём сохранённое там и добавляем то, что добавили или убрали здесь. Если там начали другой отчёт или этот
   удалили («Новый отчёт»), эта вкладка его не перезаписывает и просит обновить страницу. */
let saveWarned = false, seenRaw = null, seenNames = [], conflict = false, conflictWarned = false;
const remember = raw => { seenRaw = raw; try{ const v = JSON.parse(raw || "null"); seenNames = (v && v.docs || []).map(d => d.fileName); }catch(e){ seenNames = []; } };
const save = () => {
  if(S.demo) return true;
  try{
    const raw = localStorage.getItem(STORE);
    if(!conflict && raw !== seenRaw){
      const other = JSON.parse(raw || "null"), mine = JSON.parse(seenRaw || "null");
      const theirRid = other && other.rid || null, myRid = mine && mine.rid || null;
      if(other && (other.docs || []).length && theirRid !== S.rid && theirRid !== myRid) conflict = true;
      else if(!other && myRid && myRid === S.rid) conflict = true;
      else if(other && theirRid === S.rid){
        const removed = seenNames.filter(n => !S.docs.some(d => d.fileName === n));
        const added = S.docs.filter(d => !seenNames.includes(d.fileName));
        S.docs = (other.docs || []).filter(d => !removed.includes(d.fileName) && !added.some(a => a.fileName === d.fileName)).concat(added);
        setTimeout(() => { if(!S.demo && S.docs.length){ renderNow(); liveSoon(); } }, 0);
      }
    }
    if(conflict){
      if(!conflictWarned){ conflictWarned = true; toast(t("В другой вкладке этот отчёт удалили или начали другой. Эта вкладка его не перезапишет — обновите страницу.",
        "In another tab this report was deleted or a different one was started. This tab will not overwrite it — reload the page.")); }
      return false;
    }
    const v = JSON.stringify({client: S.client, docs: S.docs, rid: S.rid});
    localStorage.setItem(STORE, v); remember(v);
    return true;
  }catch(e){
    // Молчать нельзя: после перезагрузки или возврата с оплаты отчёта не окажется.
    if(!saveWarned){ saveWarned = true; toast(t("Браузер не сохраняет отчёт: закончилось место или хранилище запрещено. Не закрывайте вкладку, пока работаете с ним.",
      "The browser is not saving the report: storage is full or blocked. Keep this tab open while you work with it.")); }
    return false;
  }
};
const load = () => { try{ const raw = localStorage.getItem(STORE), v = JSON.parse(raw || "null");
  if(v && v.docs){ S.docs = v.docs; S.client = localName(v.client) || S.client; S.rid = v.rid || null; }
  remember(raw); conflict = false; conflictWarned = false; }catch(e){} };
// Вкладка была занята, а отчёт тем временем поменяли в другой: когда освободилась — складываем правки и показываем.
function syncStore(){
  if(S.demo || conflict || Q.running || MODALS.length) return;
  let raw; try{ raw = localStorage.getItem(STORE); }catch(e){ return; }
  if(raw !== seenRaw && S.docs.length) save();
}
// Уведомления стопкой: при нескольких файлах они шли одно поверх другого. Длинное держится дольше.
const liveBox = (id, cls) => { let el = $("#" + id);
  if(!el){ el = document.createElement("div"); el.id = id; el.className = cls; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
  return el; };
const toast = msg => {
  const box = liveBox("toasts", "toasts no-print");
  const el = document.createElement("div"); el.className = "toast"; el.textContent = msg;
  box.appendChild(el);
  while(box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), Math.min(9000, 3200 + String(msg).length * 30));
};
/* ── Платный отчёт ─────────────────────────────────────────────────────── */
/* На своём домене полный отчёт открывается после оплаты; копия для партнёров (GitHub Pages)
   и локальная работа остаются бесплатными. Выписки по-прежнему разбираются в браузере:
   сервер видит только идентификатор отчёта и подтверждает, что за него заплатили.
   Предпросмотр показывает заглушки вместо скрытых данных, а не размывает их: иначе цифры
   достаются из страницы. */
const ON_SITE = /(^|\.)euroaff\.eu$/.test(location.hostname);     // рядом лендинг и юридические страницы
// Проверочный режим оплаты на других адресах (?paywall=1) держится всю вкладку: возврат со Stripe приходит без параметра.
const PAYWALL = ON_SITE || (() => { const q = new URLSearchParams(location.search).has("paywall");
  try{ if(q) sessionStorage.setItem("wl_paywall", "1"); return q || sessionStorage.getItem("wl_paywall") === "1"; }catch(e){ return q; } })();
const PAY_API = "https://api.euroaff.eu";
const PRICE = {amount: 49, currency: "EUR", label: "€49"};
const UNLOCKS = "wl_unlock_v1", PENDING = "wl_pending_checkout";
const newRid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36).padStart(2, "0")).join("");
const unlocks = () => { try{ return JSON.parse(localStorage.getItem(UNLOCKS) || "{}"); }catch(e){ return {}; } };
const setUnlocks = m => { try{ localStorage.setItem(UNLOCKS, JSON.stringify(m)); }catch(e){} };
/* Доступ: подпись сервера (t), номер сессии Stripe (s), отпечатки оплаченных счетов (a) и когда сервер последний раз подтвердил
   оплату (v). Раньше хранилась только подпись. Отчёт открывает только запись правильной формы, подтверждённая сервером: пустой
   объект, произвольная строка или подпись без подтверждения — нет. Подтверждённый раньше доступ работает и без связи. */
const TOKEN = /^[a-f0-9]{40}$/;
const unlockOf = rid => { const v = rid && unlocks()[rid];
  if(typeof v === "string") return TOKEN.test(v) ? {t: v} : null;
  return v && typeof v === "object" && typeof v.t === "string" && TOKEN.test(v.t) ? v : null; };
/* Доступ открывает одно из двух, и ни то ни другое нельзя получить правкой хранилища браузера:
   — разрешение, подписанное сервером (ECDSA P-256), со сроком действия (g: {exp, sig}). Подпись браузер проверяет открытым
     ключом сам, поэтому доступ работает и без связи. Ключ вшит в страницу при выкладке (WL_ACCESS_KEY); если его нет, берётся
     с сервера и держится только в памяти;
   — ответ сервера «оплата подтверждена», полученный этой страницей. Он живёт только в памяти до перезагрузки, после неё
     доступ снова проверяется подписью и сервером. Отметки в localStorage и sessionStorage доказательством оплаты не считаются. */
const GRANTS = new Map();                 // «номер отчёта|сессия|срок|подпись» → подпись верна
const SERVER_OK = new Set();              // «номер отчёта|подпись сервера», подтверждённые сервером в этой загрузке страницы
let accessKeyP = null;
const grantId = (rid, u) => `${rid}|${u.s || ""}|${u.g.exp}|${u.g.sig}`;
const b64u = x => Uint8Array.from(atob(String(x).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(x).length / 4) * 4, "=")), c => c.charCodeAt(0));
function accessKey(){
  return accessKeyP = accessKeyP || (async () => {
    const jwk = window.WL_ACCESS_KEY && window.WL_ACCESS_KEY.x ? window.WL_ACCESS_KEY : await fetch(PAY_API + "/unlock/key").then(x => x.json());
    return crypto.subtle.importKey("jwk", {kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y}, {name: "ECDSA", namedCurve: "P-256"}, false, ["verify"]);
  })().catch(e => { accessKeyP = null; throw e; });
}
async function primeGrant(rid = S.rid){
  const u = rid && unlockOf(rid);
  if(!u || !u.g || typeof u.g.sig !== "string" || !Number.isFinite(u.g.exp)) return false;
  const id = grantId(rid, u);
  if(GRANTS.has(id)) return GRANTS.get(id);
  let ok = false;
  try{ ok = u.g.exp * 1000 > Date.now() && await crypto.subtle.verify({name: "ECDSA", hash: "SHA-256"}, await accessKey(), b64u(u.g.sig),
    new TextEncoder().encode(`wl-grant|${rid}|${u.s || ""}|${u.g.exp}`)); }catch(e){ return false; }   // ключ не загрузился — не запоминаем
  GRANTS.set(id, ok);
  return ok;
}
const confirmedAccess = (u, rid = S.rid) => !!(u && ((u.g && u.g.exp * 1000 > Date.now() && GRANTS.get(grantId(rid, u)) === true) || SERVER_OK.has(`${rid}|${u.t}`)));
/* Оплата — за портфель, а не за номер отчёта: если в отчёте не осталось ни одной выписки оплаченных счетов, а новые
   выписки — других счетов, это отчёт по другому клиенту. Выписки без номера счёта правило не трогают: лучше пропустить
   переиспользование, чем закрыть отчёт тому, кто заплатил. */
// Части отпечатка: полный номер, корень субсчёта, номер клиента — любое совпадение значит тот же клиент.
const acctParts = xs => (xs || []).flatMap(x => /^[ASC]:/.test(x) ? x.slice(2).split("/") : [x]);
const otherPortfolio = () => { const u = unlockOf(S.rid); if(!u || !u.a || !u.a.length) return false;
  const paid = new Set(acctParts(u.a)), cur = acctParts(S.docs.flatMap(d => d.accts || [])); return cur.length > 0 && !cur.some(x => paid.has(x)); };
const locked = () => PAYWALL && !S.demo && (!confirmedAccess(unlockOf(S.rid)) || otherPortfolio());
// Счета, добавленные в оплаченный отчёт того же клиента, становятся частью оплаченного портфеля.
function extendPaid(){
  const u = unlockOf(S.rid); if(!u || !u.a || otherPortfolio()) return;
  const add = [...new Set(S.docs.flatMap(d => d.accts || []))].filter(x => !u.a.includes(x)); if(!add.length) return;
  const m = unlocks(); m[S.rid] = {...u, a: u.a.concat(add)}; setUnlocks(m);
}
/* Отпечаток номера счёта: SHA-256 от номера с солью этого браузера. Сам номер в отчёте не хранится и никуда не уходит. */
let saltMem = null;
const salt = () => { if(saltMem) return saltMem;
  try{ saltMem = localStorage.getItem("wl_salt_v1"); if(!saltMem){ saltMem = newRid(); localStorage.setItem("wl_salt_v1", saltMem); } }catch(e){ saltMem = saltMem || newRid(); }
  return saltMem; };
async function fingerprint(doc){
  if(doc.accts || !doc.accountIds || !doc.accountIds.length) return;
  const h = async v => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt() + "|" + v))).slice(0, 8),
    b => b.toString(16).padStart(2, "0")).join("");
  try{
    // Вид номера (A — счёт, S — субсчёт с корнем, C — клиент) остаётся открытым: по нему сравниваются выписки.
    doc.accts = await Promise.all(doc.accountIds.map(async id => {
      const k = id.slice(0, 2), v = id.slice(2);
      if(k === "S:"){ const [r, w] = v.split("/"); return `S:${await h(r)}/${await h(w)}`; }
      return /^[AC]:$/.test(k) ? k + await h(v) : await h(id);
    }));
  }catch(e){}
}
const track = (name, params) => { if(WL.track) WL.track(name, params); };

const hasPositions = () => !!(S.P && S.P.positions.length);
const partialDocs = () => S.docs.filter(d => WL.quality(d).status === "partial");
// Выписки без итога для сверки продаются как анализ с ограничениями: об этом говорим до оплаты, а не после.
const unverifiedDocs = () => S.docs.filter(d => d.kind === "positions" && d.from !== "demo" && WL.quality(d).status === "unverified");
/* Персональная ссылка с подарочным кодом (?promo=КОД): код запоминается в этом браузере до оплаты, адрес очищается.
   Сервер применяет код к оплате сам — на странице Stripe уже €0. Если код не подошёл, человек узнаёт это до перехода к оплате. */
const PROMO_KEY = "wl_promo", PROMO_RE = /^[A-Z0-9][A-Z0-9-]{3,31}$/;
const promoCode = () => { try{ const c = localStorage.getItem(PROMO_KEY) || ""; return PROMO_RE.test(c) ? c : ""; }catch(e){ return ""; } };
const forgetPromo = () => { try{ localStorage.removeItem(PROMO_KEY); }catch(e){} };
function capturePromo(){
  const u = new URL(location.href);
  if(!u.searchParams.has("promo")) return;
  const c = (u.searchParams.get("promo") || "").trim().toUpperCase();
  u.searchParams.delete("promo"); history.replaceState(null, "", u.pathname + u.search + u.hash);
  if(PROMO_RE.test(c)) try{ localStorage.setItem(PROMO_KEY, c); }catch(e){}
}
let checkoutBusy = false;
const setBuyDisabled = on => document.querySelectorAll("[data-buy]").forEach(b => { b.disabled = on; });
async function openCheckout(source){
  // Отчёт без единой позиции продавать нельзя: человек заплатит за пустую страницу.
  if(!hasPositions()){ toast(t("В загруженных файлах не нашлось позиций — оплачивать пока нечего. Загрузите выписку о портфеле.",
    "No positions were found in the uploaded files, so there is nothing to pay for yet. Upload a portfolio statement.")); return; }
  if(Q.running){ toast(t("Дождитесь, пока загрузятся выписки: оплачивается отчёт со всеми файлами.", "Wait until the statements finish uploading: you pay for the report with all its files.")); return; }
  if(partialDocs().length){ toast(t("Сначала поправим выписки: пока одна из них прочитана не полностью, итог отчёта может быть неверным.",
    "Fix the statements first: while one of them is not fully read, the report total may be wrong.")); return; }
  if(checkoutBusy) return;
  // Оплатили в другой вкладке: полный отчёт уже открыт, второй раз платить не нужно.
  const paid = () => { if(locked()) return false; checkoutBusy = false; setBuyDisabled(false); renderApp();
    toast(t("Этот отчёт уже оплачен — полный отчёт открыт", "This report is already paid — the full report is unlocked")); return true; };
  if(paid()) return;
  // Доступ в браузере есть, но сервер его ещё не подтвердил (нет связи при открытии): сначала проверяем, а не продаём второй раз.
  if(unlockOf(S.rid) && !confirmedAccess(unlockOf(S.rid))){
    checkoutBusy = true; setBuyDisabled(true);
    await checkUnlock();
    checkoutBusy = false; setBuyDisabled(false);
    if(paid()) return;
    if(unlockOf(S.rid)) return;             // проверить не удалось — оплату не начинаем, сообщение уже показано
  }
  // Отчёт открывается сразу после оплаты — на это нужно явное согласие, а с ним и понимание, что право на отказ после этого не действует.
  checkoutBusy = true; setBuyDisabled(true);
  const gift = promoCode();
  const {choice} = await dialog({
    eyebrow: gift ? t("Подарочный код", "Gift code") : t("Полный отчёт", "Full report"),
    title: gift ? t("Открыть полный отчёт по подарочному коду", "Unlock the full report with your gift code") : t(`Открыть полный отчёт за ${PRICE.label}`, `Unlock the full report for ${PRICE.label}`),
    body: `<p>${gift ? t(`Код <b>${esc(gift)}</b> будет уже применён на странице Stripe — к оплате €0. Отчёт откроется в этом браузере сразу после подтверждения заказа. Выписки этого портфеля можно добавлять и потом.`,
        `Code <b>${esc(gift)}</b> will already be applied on the Stripe page — you pay €0. The report unlocks in this browser right after you confirm the order. You can add statements of this portfolio later.`)
      : t("Разовая оплата через Stripe. Отчёт откроется в этом браузере сразу после оплаты. Выписки этого портфеля можно добавлять и потом — платить снова не нужно.",
        "A one-off payment via Stripe. The report unlocks in this browser right after payment. You can add statements of this portfolio later at no extra cost.")}</p>
      ${unverifiedDocs().length ? `<div class="muted pw-reasons">${t("Не сверено с итогом банка:", "Not reconciled with a bank total:")}
        <ul class="pw-why">${unverifiedDocs().map(d => `<li><b>${esc(d.fileName)}</b> — ${esc(unverifiedWhy(d))}</li>`).join("")}</ul>
        ${t(`Позиции из ${unverifiedDocs().length === 1 ? "неё" : "них"} войдут в отчёт как прочитаны.`, "Their positions are included as read.")}</div>` : ""}
      <p class="muted pw-where">${t("Отчёт и доступ хранятся в этом браузере. Открываете на другом устройстве или очистили данные браузера — ",
        "The report and its access are kept in this browser. Opening it on another device, or cleared your browser data? ")}${SUPPORT
        ? t(`напишите на ${supportLink()} с почты, указанной при оплате: проверим оплату и пришлём код, чтобы открыть отчёт заново без оплаты.`,
            `Email ${supportLink()} from the address used at checkout: we will check the payment and send a code to unlock the report again at no cost.`)
        : t("напишите нам с почты, указанной при оплате: проверим оплату и пришлём код, чтобы открыть отчёт заново без оплаты.",
            "contact us from the address used at checkout: we will check the payment and send a code to unlock the report again at no cost.")}</p>
      <label class="ai-remember waiver"><input type="checkbox" data-waiver> ${t("Прошу открыть отчёт сразу после оплаты и понимаю, что после этого право отказаться от покупки в течение 14 дней не действует.",
        "I ask for the report to be unlocked right after payment and understand that I then lose the 14-day right of withdrawal.")}</label>
      ${ON_SITE ? `<p class="ai-more">${t(`<a href="/legal/terms/" target="_blank" rel="noopener">Условия</a> · <a href="/legal/refund/" target="_blank" rel="noopener">возврат, если отчёт не собрался</a>`,
        `<a href="/en/legal/terms/" target="_blank" rel="noopener">Terms</a> · <a href="/en/legal/refund/" target="_blank" rel="noopener">refund if the report can't be built</a>`)}</p>` : ""}`,
    buttons: [{id: "pay", label: gift ? t("Продолжить", "Continue") : t("Перейти к оплате", "Continue to payment"), primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}],
    cancel: "cancel", gate: "[data-waiver]",
  });
  checkoutBusy = false; setBuyDisabled(false);
  if(choice !== "pay" || paid() || Q.running || !hasPositions() || partialDocs().length) return;
  if(!S.rid) S.rid = newRid();
  // Отчёт, который браузер не сохраняет, после возврата с оплаты не найдётся: деньги спишутся, а открыть будет нечего.
  if(!save()){ toast(conflict ? t("Сначала обновите страницу: в другой вкладке этот отчёт удалили или начали другой.", "Reload the page first: in another tab this report was deleted or a different one was started.")
    : t("Браузер не сохраняет отчёт, поэтому после оплаты открыть его здесь не получится. Разрешите сайту хранить данные и попробуйте снова.",
        "The browser is not saving the report, so it could not be opened here after payment. Allow this site to store data and try again.")); return; }
  checkoutBusy = true; setBuyDisabled(true);
  // Пока ждём сервер, отчёт могли начать заново, оплатить в другой вкладке, добавить в него файл или убрать последнюю выписку.
  const rid = S.rid, stale = () => {
    if(rid === S.rid && paid()) return true;
    if(rid === S.rid && !Q.running && hasPositions() && !partialDocs().length) return false;
    checkoutBusy = false; setBuyDisabled(false);
    if(rid === S.rid) toast(Q.running ? t("Дождитесь, пока загрузятся выписки: оплачивается отчёт со всеми файлами.", "Wait until the statements finish uploading: you pay for the report with all its files.")
      : t("В отчёте не осталось позиций — оплачивать пока нечего.", "The report has no positions left, so there is nothing to pay for yet."));
    return true;
  };
  // Оплату этого отчёта уже начинали (вкладку закрыли до возврата со Stripe): сначала проверяем её, чтобы не заплатить дважды.
  let pend = null;
  try{ pend = JSON.parse(localStorage.getItem(PENDING) || "null"); }catch(e){}
  if(pend && pend.rid === rid && pend.sid && Date.now() - pend.at < 2 * 864e5){
    let v = null;
    try{ v = await fetch(`${PAY_API}/checkout/verify?session_id=${encodeURIComponent(pend.sid)}&rid=${rid}`).then(x => x.json()); }catch(e){}
    if(stale()) return;
    if(v && v.ok){
      await unlockWith(pend.sid, v); checkoutBusy = false;
      toast(t("Этот отчёт уже оплачен — полный отчёт открыт", "This report is already paid — the full report is unlocked"));
      renderApp(); return;
    }
  }
  const code = promoCode();
  track("InitiateCheckout", {value: code ? 0 : PRICE.amount, currency: PRICE.currency, content_name: "portfolio_report", source});
  // paywall — проверочный режим на другом адресе: сервер сохранит его в адресах возврата со Stripe.
  const body = Object.assign({}, WL.attribution ? WL.attribution() : {}, {rid, lang: WL.lang, path: location.pathname, waiver: true, paywall: PAYWALL && !ON_SITE}, code ? {promo: code} : {});
  let r = null;
  try{
    r = await fetch(PAY_API + "/checkout", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)})
      .then(x => x.json());
  }catch(e){}
  if(stale()) return;
  if(r && r.url){
    // Код из ссылки не применился — говорим об этом до страницы Stripe, а не оставляем человека с суммой €49.
    if(code && r.promo !== "applied"){
      if(r.promo === "invalid") forgetPromo();
      checkoutBusy = false; setBuyDisabled(false);
      const {choice: go} = await dialog({
        eyebrow: t("Подарочный код", "Gift code"),
        title: r.promo === "invalid" ? t("Код больше не действует", "This code is no longer valid") : t("Код не удалось применить автоматически", "The code could not be applied automatically"),
        body: `<p>${r.promo === "invalid"
          ? t(`Код <b>${esc(code)}</b> уже использован или истёк. Полный отчёт можно открыть за ${PRICE.label}.`, `Code <b>${esc(code)}</b> has already been used or has expired. You can unlock the full report for ${PRICE.label}.`)
          : t(`На странице Stripe нажмите «Добавить промокод» и введите <b>${esc(code)}</b>.`, `On the Stripe page, choose “Add promotion code” and enter <b>${esc(code)}</b>.`)}</p>`,
        buttons: [{id: "go", label: t("Перейти к оплате", "Continue to payment"), primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}],
        cancel: "cancel",
      });
      if(go !== "go" || stale()) return;
      if(r.promo === "invalid") renderPaywall();
    }
    // Запоминаем начатую оплату: если после неё вкладку закроют до возврата на сайт, отчёт откроется при следующем заходе.
    try{ localStorage.setItem(PENDING, JSON.stringify({rid, sid: r.id, at: Date.now()})); }catch(e){}
    leaving = true; location.href = r.url; return;
  }
  checkoutBusy = false; setBuyDisabled(false);
  toast(r && r.error === "payments_not_configured"
    ? (SUPPORT ? t(`Оплата подключается. Напишите на ${SUPPORT} — откроем отчёт вручную.`, `Payments are being set up. Email ${SUPPORT} and we will unlock the report manually.`)
               : t("Оплата скоро заработает. Попробуйте, пожалуйста, чуть позже.", "Payments are coming soon. Please try again a little later."))
    : SUPPORT ? t(`Не удалось открыть оплату. Попробуйте ещё раз или напишите на ${SUPPORT}.`, `Could not open checkout. Try again or email ${SUPPORT}.`)
    : t("Не удалось открыть оплату. Попробуйте ещё раз.", "Could not open checkout. Please try again."));
}

async function unlockWith(sid, r, restored){
  const m = unlocks(); m[S.rid] = {t: r.token, s: r.sid || sid || null, a: [...new Set(S.docs.flatMap(d => d.accts || []))], g: r.grant || null};
  setUnlocks(m);
  SERVER_OK.add(`${S.rid}|${r.token}`);               // сюда попадают только ответы сервера об оплате
  try{ localStorage.removeItem(PENDING); }catch(e){}
  if(r.amount === 0) forgetPromo();                   // заказ по подарочному коду оформлен — код израсходован
  await primeGrant();
  if(restored) return;
  const seen = "wl_purchase_" + sid.slice(-16);     // событие покупки — один раз на платёж
  try{ if(!localStorage.getItem(seen)){ localStorage.setItem(seen, "1");
    // Сумма 0 (скидка 100%) — тоже сумма: цену по умолчанию подставляем, только если сервер суммы не прислал.
    track("Purchase", {value: typeof r.amount === "number" ? r.amount : PRICE.amount, currency: r.currency || PRICE.currency, content_name: "portfolio_report"}); } }catch(e){}
}

/* Доступ сверяется с сервером при каждом открытии отчёта: подпись сервера должна быть настоящей, а оплата — не возвращённой.
   Ответ держится только в памяти страницы. Нет связи — отчёт открывает лишь действующее подписанное разрешение; без него отчёт
   закрыт, и пейволл предлагает проверить оплату снова. Запись не той формы удаляется. */
let accessCheck = null;                     // null — не проверяли, "checking" — ждём сервер, "failed" — сервер не ответил
async function checkUnlock(){
  if(!PAYWALL || S.demo || !S.rid) return;
  const u = unlockOf(S.rid);
  if(!u){ const m = unlocks(); if(S.rid in m){ delete m[S.rid]; setUnlocks(m); } return; }
  const key = `${S.rid}|${u.t}`;
  await primeGrant();
  if(SERVER_OK.has(key)) return;                          // эта страница уже получила подтверждение сервера
  accessCheck = "checking";
  if(S.P && !confirmedAccess(u)) renderPaywall();
  let r = null;
  try{ r = await fetch(`${PAY_API}/unlock/check?rid=${encodeURIComponent(S.rid)}&token=${encodeURIComponent(u.t)}&sid=${encodeURIComponent(u.s || "")}`).then(x => x.json()); }catch(e){}
  const now = unlockOf(S.rid);
  accessCheck = r && typeof r.ok === "boolean" ? null : "failed";
  if(!now || u.t !== now.t){ if(S.P) renderApp(); return; }
  if(r && r.ok === true){
    const was = confirmedAccess(u);
    // Новое разрешение: срок продлевается при каждом подтверждении. Stripe не ответил (unverified) — сервер проверил только
    // свою подпись и нового разрешения не выдаёт; до перезагрузки этого достаточно.
    if(r.grant){ const m = unlocks(); m[S.rid] = {...now, g: r.grant}; setUnlocks(m); }
    SERVER_OK.add(key);
    await primeGrant();
    if(!was && S.P) renderApp();
    return;
  }
  if(r && r.ok === false){
    const m = unlocks(); delete m[S.rid]; setUnlocks(m);
    SERVER_OK.delete(key);
    toast(r.reason === "refunded" ? t("Оплата этого отчёта возвращена — полный отчёт закрыт.", "Payment for this report was refunded, so the full report is locked.")
      : t("Доступ к полному отчёту не подтвердился. Если вы оплачивали, нажмите «Восстановить доступ».", "Access to the full report could not be confirmed. If you paid, use “Restore access”."));
    if(S.P) renderApp();
    return;
  }
  // Сервер не ответил: действующее подписанное разрешение открывает отчёт и без связи, запись без него ждёт проверки.
  if(!confirmedAccess(u)){
    toast(t("Не удалось проверить оплату: нет связи с сервером. Отчёт откроется, когда проверка пройдёт.", "Could not verify the payment: no connection to the server. The report unlocks once the check succeeds."));
    if(S.P) renderPaywall();
  }
}
document.addEventListener("click", async e => {
  const b = e.target.closest && e.target.closest("[data-recheck]"); if(!b) return;
  e.preventDefault(); b.disabled = true;
  await checkUnlock();
  if(S.P) renderPaywall();
});
// Оплатили, а доступ в этом браузере пропал: ищем оплату этого отчёта в Stripe по его номеру.
async function restoreAccess(btn){
  if(!S.rid) return;
  if(btn) btn.disabled = true;
  let r = null;
  try{ r = await fetch(PAY_API + "/unlock/restore", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({rid: S.rid})}).then(x => x.json()); }catch(e){}
  if(btn) btn.disabled = false;
  if(r && r.ok){ await unlockWith(r.sid, r, true); toast(t("Оплата найдена — полный отчёт открыт", "Payment found — the full report is unlocked")); renderApp(); return; }
  toast(SUPPORT ? t(`Оплату этого отчёта не нашли. Напишите на ${SUPPORT} и укажите номер отчёта ${S.rid}.`, `No payment was found for this report. Email ${SUPPORT} with report number ${S.rid}.`)
    : t(`Оплату этого отчёта не нашли. Номер отчёта: ${S.rid}.`, `No payment was found for this report. Report number: ${S.rid}.`));
}
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-restore]"); if(b){ e.preventDefault(); restoreAccess(b); } });

/* Оплатили, но закрыли вкладку раньше, чем Stripe вернул на сайт: при следующем открытии
   проверяем последнюю начатую оплату этого отчёта, если ей не больше двух суток. */
async function recoverPendingPayment(){
  if(!locked()) return;
  let p = null;
  try{ p = JSON.parse(localStorage.getItem(PENDING) || "null"); }catch(e){}
  if(!p || p.rid !== S.rid || !p.sid || Date.now() - p.at > 2 * 864e5) return;
  let r = null;
  try{ r = await fetch(`${PAY_API}/checkout/verify?session_id=${encodeURIComponent(p.sid)}&rid=${S.rid}`).then(x => x.json()); }catch(e){}
  if(r && r.ok){ await unlockWith(p.sid, r); toast(t("Оплата прошла — полный отчёт открыт", "Payment received — full report unlocked")); }
}

async function handlePaymentReturn(){
  const u = new URL(location.href), sid = u.searchParams.get("paid"), canceled = u.searchParams.has("canceled");
  if(!sid && !canceled) return;
  u.searchParams.delete("paid"); u.searchParams.delete("canceled");
  history.replaceState(null, "", u.pathname + u.search + u.hash);
  if(canceled){ try{ localStorage.removeItem(PENDING); }catch(e){} toast(t("Оплата не завершена. Открыть полный отчёт можно в любой момент.", "Payment was not completed. You can unlock the full report at any time.")); return; }
  if(!S.rid){ toast(t("Оплата прошла, но выписок в этом браузере нет. Откройте отчёт там, где загружали выписки.",
    "Payment received, but this browser has no statements. Open the report in the browser where you uploaded them.")); return; }
  let r = null;
  try{ r = await fetch(`${PAY_API}/checkout/verify?session_id=${encodeURIComponent(sid)}&rid=${S.rid}`).then(x => x.json()); }catch(e){}
  if(r && r.ok){
    await unlockWith(sid, r);
    toast(t("Оплата прошла — полный отчёт открыт", "Payment received — full report unlocked"));
  } else {
    toast(r && r.reason === "not paid" ? t("Платёж ещё не подтверждён. Обновите страницу через минуту.", "Payment is not confirmed yet. Refresh the page in a minute.")
                                       : (SUPPORT ? t(`Не удалось подтвердить оплату. Напишите на ${SUPPORT} — разберёмся.`, `Could not confirm the payment. Email ${SUPPORT} and we will look into it.`)
                                               : t("Не удалось подтвердить оплату. Напишите нам — разберёмся.", "Could not confirm the payment. Contact us and we will look into it.")));
  }
}

function renderPaywall(){
  const el = $("#paywall"); if(!el) return;
  const lock = locked();
  document.body.classList.toggle("is-locked", lock);
  const priceNow = promoCode() ? "€0" : PRICE.label;
  $("#printBtn").textContent = lock && hasPositions() && !partialDocs().length ? t(`Полный отчёт · ${priceNow}`, `Full report · ${priceNow}`) : t("Отчёт PDF", "PDF report");
  if(!lock){ el.hidden = true; el.innerHTML = ""; return; }
  if(hasPositions() && partialDocs().length){
    el.hidden = false;
    el.innerHTML = `<div class="card paywall empty"><div><div class="eyebrow">${t("Сначала выписки", "Statements first")}</div>
      <h2>${t("Полный отчёт откроется, когда выписки сойдутся с итогами банка", "The full report unlocks once the statements match the bank's totals")}</h2>
      <p class="muted">${t("Сейчас в отчёте есть выписка, прочитанная не полностью, — итог и выводы по ней могут быть неверны, и продавать такой отчёт мы не будем. Уберите её в «Документах» или загрузите исходный PDF из интернет-банка либо выгрузку позиций в CSV или Excel.",
        "One of the statements was not fully read, so the total and findings may be wrong, and we will not sell such a report. Remove it under “Documents”, or upload the original PDF from online banking or a positions export in CSV or Excel.")}
      ${SUPPORT ? t(`Не получается — напишите на ${supportLink()}.`, `Stuck? Email ${supportLink()}.`) : ""}</p></div>
      <div class="pw-buy"><button class="btn primary" type="button" data-add-file>${t("Добавить выписку", "Add a statement")}</button></div></div>`;
    return;
  }
  if(!hasPositions()){
    el.hidden = false;
    el.innerHTML = `<div class="card paywall empty"><div><div class="eyebrow">${t("Позиций не нашлось", "No positions found")}</div>
      <h2>${t("В загруженных файлах нет таблицы позиций", "The uploaded files have no positions table")}</h2>
      <p class="muted">${t("Для отчёта нужна выписка о портфеле — Portfolio, Holdings, Positions или Valuation. Выписки операций и движения денег позиций не содержат.",
        "The report needs a portfolio statement — Portfolio, Holdings, Positions or Valuation. Transaction and cash-movement statements contain no positions.")}
      ${SUPPORT ? t(`Не получается — напишите на ${supportLink()}.`, `Stuck? Email ${supportLink()}.`) : ""}</p></div>
      <div class="pw-buy"><button class="btn primary" type="button" data-add-file>${t("Добавить выписку", "Add a statement")}</button></div></div>`;
    return;
  }
  // В браузере есть запись об оплате, но ни подписи, ни ответа сервера пока нет: не продаём второй раз, а проверяем оплату.
  const paidHere = unlockOf(S.rid);
  if(paidHere && !confirmedAccess(paidHere) && !otherPortfolio()){
    const failed = accessCheck === "failed";
    el.hidden = false;
    el.innerHTML = `<div class="card paywall empty"><div><div class="eyebrow">${t("Оплаченный отчёт", "Paid report")}</div>
      <h2>${failed ? t("Не удалось проверить оплату", "Could not verify the payment") : t("Проверяем оплату этого отчёта…", "Checking the payment for this report…")}</h2>
      <p class="muted">${failed ? t("В этом браузере есть запись об оплате, но сервер не ответил, а действующего подписанного разрешения у неё нет. Проверьте связь и нажмите «Проверить снова».",
          "This browser has a payment record, but the server did not respond and the record has no valid signed grant. Check your connection and use “Check again”.")
        : t("В этом браузере есть запись об оплате. Отчёт откроется, как только сервер её подтвердит.", "This browser has a payment record. The report unlocks as soon as the server confirms it.")}
      ${SUPPORT ? t(`Не получается — напишите на ${supportLink()} и укажите номер отчёта <code class="rid">${esc(S.rid)}</code>.`, `Stuck? Email ${supportLink()} with report number <code class="rid">${esc(S.rid)}</code>.`) : ""}</p></div>
      <div class="pw-buy"><button class="btn primary" type="button" data-recheck ${failed ? "" : "disabled"}>${failed ? t("Проверить снова", "Check again") : t("Проверяем…", "Checking…")}</button></div></div>`;
    return;
  }
  if(otherPortfolio()){
    el.hidden = false;
    el.innerHTML = `<div class="card paywall empty"><div><div class="eyebrow">${t("Другой портфель", "Another portfolio")}</div>
      <h2>${t("Этот отчёт оплачен для других счетов", "This report was paid for other accounts")}</h2>
      <p class="muted">${t("В отчёте не осталось выписок оплаченных счетов, а новые выписки — других счетов. Отчёт по другому клиенту оплачивается отдельно: начните «Новый отчёт» или верните выписку оплаченного счёта.",
        "None of the paid accounts' statements remain, and the new statements belong to other accounts. A report for another client is paid separately: start a “New report” or add back a statement of a paid account.")}
      ${SUPPORT ? t(`Если это тот же клиент, напишите на ${supportLink()} и укажите номер отчёта <code class="rid">${esc(S.rid)}</code>.`, `If this is the same client, email ${supportLink()} with report number <code class="rid">${esc(S.rid)}</code>.`) : ""}</p></div>
      <div class="pw-buy"><div class="pw-price">${PRICE.label}</div><button class="btn primary pw-btn" type="button" data-buy="paywall">${t("Открыть полный отчёт", "Unlock full report")}</button></div></div>`;
    return;
  }
  const I = WL.insights(S.P), n = lvl => I.filter(x => x.level === lvl).length;
  const found = [n("high") && `${n("high")} ${WL.pl(n("high"), ["важный вывод", "важных вывода", "важных выводов"], ["important finding", "important findings"])}`,
                 n("watch") && `${n("watch")} ${WL.pl(n("watch"), ["пункт требует", "пункта требуют", "пунктов требуют"], ["item that needs", "items that need"])} ${t("внимания", "attention")}`]
    .filter(Boolean).join(t(" и ", " and "));
  el.hidden = false;
  el.innerHTML = `<div class="card paywall">
    <div><div class="eyebrow">${t("Полный отчёт", "Full report")}</div>
      <h2>${found ? t(`В портфеле ${found}`, `This portfolio has ${found}`) : t("Откройте полный отчёт по портфелю", "Unlock the full portfolio report")}</h2>
      <ul class="pw-list">${t(`
        <li>все выводы с суммами: обязательства по опционам, концентрация, результат по счетам;</li>
        <li>каждая позиция: цена и дата покупки, комиссии, изменение за день, месяц, квартал, год и пять лет;</li>
        <li>календарь экспираций и ролловеров;</li>
        <li>сравнение с бенчмарком и отчёт в PDF.</li>`, `
        <li>Every finding with amounts: option obligations, concentration, results by account</li>
        <li>Every position: purchase price and date, fees, change over a day, month, quarter, year and five years</li>
        <li>Calendar of expiries and rollovers</li>
        <li>Benchmark comparison and a PDF report</li>`)}
      </ul></div>
    <div class="pw-buy">${promoCode() ? `<div class="pw-price"><s>${PRICE.label}</s> €0</div><div class="muted pw-note pw-gift">${t(`по подарочному коду <b>${esc(promoCode())}</b>`, `with gift code <b>${esc(promoCode())}</b>`)}</div>`
      : `<div class="pw-price">${PRICE.label}</div><div class="muted pw-note">${t("разово за этот портфель", "one-off, for this portfolio")}</div>`}
      <button class="btn primary pw-btn" type="button" data-buy="paywall">${t("Открыть полный отчёт", "Unlock full report")}</button>
      ${unverifiedDocs().length ? `<div class="muted pw-note pw-warn">${t("Не сверено с итогом банка:", "Not reconciled with a bank total:")}
        <ul class="pw-why">${unverifiedDocs().map(d => `<li><b>${esc(d.fileName)}</b> — ${esc(unverifiedWhy(d))}</li>`).join("")}</ul>
        ${t("Позиции из них войдут в отчёт как прочитаны.", "Their positions are included as read.")}</div>` : ""}
      <div class="muted pw-note">${promoCode() ? t("Оформление через Stripe. Отчёт собирается и хранится в этом браузере, выписки на сервере не хранятся — открывайте отчёт здесь же.",
        "Checkout via Stripe. The report is built and kept in this browser, and statements are not stored on a server, so open the report here.") : t("Оплата через Stripe. Отчёт собирается и хранится в этом браузере, выписки на сервере не хранятся — открывайте отчёт здесь же.",
        "Payment via Stripe. The report is built and kept in this browser, and statements are not stored on a server, so open the report here.")}</div>
      ${ON_SITE ? `<div class="muted pw-note">${t(`Оплачивая, вы принимаете <a href="/legal/terms/">условия</a> и <a href="/legal/refund/">правила возврата</a>.`,
        `By paying, you accept the <a href="/en/legal/terms/">terms</a> and <a href="/en/legal/refund/">refund policy</a>.`)}</div>` : ""}
      <div class="muted pw-note">${t("Выписки этого портфеля можно добавлять и после оплаты — платить снова не нужно. Отчёт по другому клиенту оплачивается отдельно.",
        "You can add statements of this portfolio after paying at no extra cost. A report for another client is paid separately.")}</div>
      ${S.rid ? `<div class="muted pw-note">${t("Уже оплачивали этот отчёт?", "Already paid for this report?")} <button class="linkbtn" type="button" data-restore>${t("Восстановить доступ", "Restore access")}</button>
        · ${t("номер отчёта", "report number")} <code class="rid">${esc(S.rid)}</code></div>` : ""}
      ${SUPPORT ? `<div class="muted pw-note">${t("Вопрос по оплате:", "Payment question:")} ${supportLink()}</div>` : ""}</div>
  </div>`;
}

// Почему выписку не с чем сверить — из пометок разбора; общий ответ, если причина не записана.
// Конкретная причина — разные случаи требуют разных действий: итога нет, итог есть, но в другой валюте и без курсов выписки.
const unverifiedWhy = d => /в валюте отчёта по бумагам в разных валютах|reference currency across several currencies/.test(d.note || "")
  ? t("итог в файле есть, но посчитан в валюте отчёта по бумагам в разных валютах: без курсов самой выписки его не сверить", "the file has a total, but in the reference currency across several currencies: it cannot be reconciled without the statement's own rates")
  : d.fromAi ? t("в тексте выписки не нашлось строки итога, с которой сошлась бы сумма позиций", "no total line in the statement text to reconcile the positions against")
  : t("итоговой строки в файле нет — сумму сверять не с чем", "the file has no total row, so there is nothing to reconcile the sum against");
// Плашки пересобираются при каждом обновлении цен: раскрытое человеком пояснение не должно захлопываться.
const keepOpen = (el, render) => { const was = el.querySelector("details.q-more"), open = was ? was.open : null; render();
  const now = el.querySelector("details.q-more"); if(now && open != null) now.open = open; };
function renderQuality(){
  const el = $("#qualityBar"); if(!el) return;
  keepOpen(el, () => renderQualityInto(el));
}
function renderQualityInto(el){
  const all = S.docs.map(d => ({d, q: WL.quality(d)}));
  const bad = all.filter(x => x.q.status === "partial"), open = all.filter(x => x.q.status === "unverified" && x.d.kind === "positions" && x.d.from !== "demo");
  el.innerHTML = (!bad.length ? "" : `<div class="card quality" role="status">
    <div class="q-top"><span class="lvl high">${t("Неполный отчёт", "Incomplete report")}</span>
      <h2>${bad.length === 1 ? t("Одна выписка прочитана не полностью", "One statement was not fully read") : t(`${bad.length} выписки прочитаны не полностью`, `${bad.length} statements were not fully read`)}</h2></div>
    <p>${t("Итог, структура и выводы ниже посчитаны только по прочитанному и могут быть неверны.", "The total, breakdown and findings below cover only what was read and may be wrong.")}
      ${locked() ? t("Полный отчёт откроется, когда все выписки сойдутся с итогами банка.", "The full report unlocks once every statement matches the bank's totals.") : ""}</p>
    <ul class="q-list">${bad.map(x => `<li><div><b>${esc(x.d.brokerShort || x.d.broker)}</b> <span class="muted">· ${esc(x.d.fileName)}</span>
      <div class="q-why">${x.q.issues.map(esc).join("; ")}</div></div>
      <button class="btn small no-print" type="button" data-q-remove="${esc(x.d.fileName)}">${t("Убрать из отчёта", "Remove from report")}</button></li>`).join("")}</ul>
    <div class="q-actions no-print"><button class="btn small" type="button" data-add-file>${t("Добавить исходный PDF или выгрузку CSV", "Add the original PDF or a CSV export")}</button></div>
  </div>`) + (!open.length ? "" : `<div class="card quality soft" role="note">
    <div class="q-top"><span class="lvl info">${t("К сведению", "Note")}</span>
      <h2>${open.length === 1 ? t("Одну выписку не с чем сверить", "One statement has no total to reconcile") : t(`${open.length} выписки не с чем сверить`, `${open.length} statements have no total to reconcile`)}</h2></div>
    <details class="q-more"><summary>${t("Почему и какие выписки", "Why, and which statements")}</summary>
    <p>${t("Противоречий в них не нашлось, и позиции показаны как прочитаны, но подтвердить полноту суммы итогом банка нельзя.",
      "No contradictions were found and the positions are shown as read, but the completeness of the sum cannot be confirmed by a bank total.")}</p>
    <ul class="q-list">${open.map(x => `<li><div><b>${esc(x.d.brokerShort || x.d.broker)}</b> <span class="muted">· ${esc(x.d.fileName)}</span>
      <div class="q-why">${esc(unverifiedWhy(x.d))}</div></div></li>`).join("")}</ul></details>
  </div>`);
}
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-q-remove]"); if(b) removeDoc(b.dataset.qRemove); });
/* Бумаги, которые не удалось сопоставить с биржей: текущая цена к ним не подставлена, новости и история не грузятся.
   Показываем, что торгуется под тикером на бирже США, и даём подтвердить, что это та же бумага. */
const secKey = p => `${p.type === "option" ? "opt" : "eq"}|${String(p.type === "option" ? p.underlying : p.symbol || "").toUpperCase()}|${String(p.type === "option" ? p.underlyingName || "" : p.name || "").toLowerCase()}`;
function renderIdentity(){
  const el = $("#idBar"); if(!el) return;
  keepOpen(el, () => renderIdentityInto(el));
}
function renderIdentityInto(el){
  const P = S.P;
  if(!P || S.demo || P.basis === "stmt"){ el.innerHTML = ""; return; }
  const seen = new Map(); let failed = false;
  P.positions.forEach(p => { const id = WL.idOf(P, p);
    if(id.how === "error") failed = true;
    if((id.how === "mismatch" || id.how === "notfound") && !seen.has(secKey(p))) seen.set(secKey(p), {p, id}); });
  // Опцион на ту же бумагу, что уже в списке акцией, отдельной строкой не повторяем.
  const eqTicks = new Set([...seen.values()].filter(x => x.p.type !== "option").map(x => String(x.p.symbol || "").toUpperCase()));
  const list = [...seen.values()].filter(x => x.p.type !== "option" || !eqTicks.has(String(x.p.underlying || "").toUpperCase()));
  if(!list.length && !failed){ el.innerHTML = ""; return; }
  el.innerHTML = `<div class="card quality soft ids" role="note">
    <div class="q-top"><span class="lvl info">${t("К сведению", "Note")}</span>
      <h2>${list.length ? t(`Текущая цена не подставлена ${list.length === 1 ? "одной бумаге" : `${list.length} бумагам`}`, `No current price for ${list.length} ${list.length === 1 ? "holding" : "holdings"}`)
        : t("Бумаги пока не сопоставлены с биржей", "Holdings are not matched to exchange listings yet")}</h2></div>
    <details class="q-more"${list.some(x => x.id.how === "mismatch") ? " open" : ""}><summary>${t("Почему и какие бумаги", "Why, and which holdings")}</summary>
    <p>${t("Тикер в выписке ещё не доказывает, что это та же бумага: под тем же тикером на бирже может торговаться другая компания. Пока бумага не сопоставлена, её стоимость — из выписки, а новости и история цен по ней не загружаются.",
      "A ticker in a statement does not prove it is the same security: another company may trade under the same ticker. Until a holding is matched, its value comes from the statement, and no news or price history is loaded for it.")}
      ${failed ? t(" Справочник бумаг сейчас не ответил — повторим при следующем обновлении цен.", " The securities reference did not respond — we will retry on the next price update.") : ""}</p>
    ${list.length ? `<ul class="q-list">${list.map(({p, id}) => { const opt = p.type === "option", sym = opt ? p.underlying : p.symbol, name = opt ? `${t("опционы на", "options on")} ${sym}` : p.name;
      return `<li><div><b>${esc(name)}</b> <span class="muted">· ${esc(sym)} · ${esc(p.brokerShort)}</span>
        <div class="q-why">${!id.market ? t("на биржах США бумаги с таким тикером не нашлось — стоимость из выписки", "no US-listed security with this ticker — the value comes from the statement")
          : t(`под этим тикером на бирже США: ${esc(id.market.name)}`, `listed under this ticker in the US: ${esc(id.market.name)}`)}
          ${id.isinMarket ? `<br>${t(`ISIN ${esc(p.isin)} указывает на другую бумагу: ${esc(id.isinMarket.name)} · ${esc(id.isinMarket.ticker)}`, `ISIN ${esc(p.isin)} points to a different listing: ${esc(id.isinMarket.name)} · ${esc(id.isinMarket.ticker)}`)}` : ""}</div></div>
        ${id.how === "mismatch" && id.market ? `<button class="btn small no-print" type="button" data-id-confirm="${esc(p.id)}">${t("Это та же бумага", "Same security")}</button>` : ""}</li>`; }).join("")}</ul>` : ""}</details>
  </div>`;
}
// Подтверждение человека сохраняется в выписках отчёта — у всех позиций этой бумаги (тот же тикер и название).
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-id-confirm]"); if(!b || !S.P) return;
  const p = S.P.positions.find(x => x.id === b.dataset.idConfirm); if(!p) return;
  const id = WL.idOf(S.P, p); if(!id.market) return;
  const key = secKey(p), mark = {ticker: p.type === "option" ? p.underlying : p.symbol, name: id.market.name};
  S.docs.forEach(d => (d.positions || []).forEach(q => { if(secKey(q) === key) q.idUser = mark; }));
  save();
  toast(t(`${mark.ticker}: сопоставлено с ${mark.name} — подставляю текущую цену`, `${mark.ticker}: matched to ${mark.name} — loading the current price`));
  renderNow(); liveSoon(0);
});
function renderDemoBar(){
  const el = $("#demoBar"); if(!el) return;
  // ?shot — снимок для лендинга (site/shots.py): там своя подпись, полоса демо не нужна
  el.innerHTML = S.demo && !new URLSearchParams(location.search).has("shot") ? `<div class="card demobar no-print"><span>${t(`<b>Демо-отчёт</b> на вымышленном портфеле у Interactive Brokers, UBS, Charles Schwab и Saxo Bank.
    По вашим выпискам отчёт будет таким же.`, `<b>Demo report</b> on a fictional portfolio held at Interactive Brokers, UBS, Charles Schwab and Saxo Bank.
    A report on your own statements will look the same.`)}</span><a class="btn primary small" href="${HOME}">${t("Загрузить свои выписки", "Upload your statements")}</a></div>` : "";
}
const lockedInsight = x => `<article class="card insight lockcard"><span class="lvl ${x.level}">${LEVEL[x.level]}</span>
  <div class="skel w90"></div><div class="skel w70"></div><div class="skel w50"></div>
  <div class="basis">${t("Скрыто до оплаты", "Hidden until payment")} · <button class="linkbtn" type="button" data-buy="insight">${t("открыть", "unlock")}</button></div></article>`;


/* ── Загрузка ─────────────────────────────────────────────────────────── */
/* Страница без одного из модулей (сбой сети или смешанные версии файлов из кэша сразу после выкладки) не должна ломать загрузку
   молча: модули проверяются до работы, а при сбое страница предлагает обновиться. */
const NEEDS = {"parse.js": ["parseFile", "aiVerify"], "sheet.js": ["parseSheet", "sheetDoc"], "model.js": ["build", "quality", "idOf", "current", "usd", "fetchLive"],
  "insights.js": ["insights", "missing"], "table.js": ["renderPositions", "renderChart"], "market.js": ["renderMarket"]};
const missingModules = () => Object.entries(NEEDS).filter(([, fns]) => fns.some(f => typeof WL[f] !== "function")).map(([m]) => m);
async function reloadFresh(){
  // Обычная перезагрузка может снова взять файлы из кэша браузера: сначала обновляем в кэше скрипты страницы.
  try{ await Promise.all([...document.scripts].filter(s => s.src).map(s => fetch(s.src, {cache: "reload"}))); }catch(e){}
  location.reload();
}
function renderBroken(lost){
  $("#bar").hidden = true;
  document.body.classList.add("on-upload");
  $("#app").innerHTML = `<div class="drop" role="alert"><div class="drop-mark" aria-hidden="true"></div>
    <div class="eyebrow">WealthLens · ${t("страница загрузилась не полностью", "the page did not load completely")}</div>
    <h1>${t("Обновите страницу", "Reload the page")}</h1>
    <p>${t("Часть файлов приложения не загрузилась — так бывает при сбое сети или сразу после обновления сайта. Выписки, уже добавленные в этом браузере, сохранены.",
      "Some of the app's files did not load — this happens after a network glitch or right after a site update. Statements already added in this browser are saved.")}</p>
    <div class="drop-actions"><button class="btn primary" type="button" data-reload>${t("Обновить страницу", "Reload the page")}</button></div>
    ${lost && lost.length ? `<p class="hint">${t("Не загрузилось", "Not loaded")}: ${esc(lost.join(", "))}</p>` : ""}</div>`;
}
function renderGlitch(on){
  const el = $("#glitchBar"); if(!el) return;
  el.innerHTML = on ? `<div class="card quality" role="alert"><div class="q-top"><span class="lvl high">${t("Сбой", "Error")}</span>
      <h2>${t("Часть отчёта не показалась", "Part of the report did not render")}</h2></div>
    <p>${t("Страница загрузилась не полностью или произошёл сбой. Выписки сохранены в этом браузере — обновите страницу.",
      "The page did not load completely or hit an error. Your statements are saved in this browser — reload the page.")}</p>
    <button class="btn small no-print" type="button" data-reload>${t("Обновить страницу", "Reload the page")}</button></div>` : "";
}
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-reload]"); if(b){ e.preventDefault(); b.disabled = true; reloadFresh(); } });
function renderUpload(){
  closeDrawer();
  $("#bar").hidden = true;
  document.body.classList.add("on-upload");
  $("#app").innerHTML = `<div class="drop" id="drop">
    <div class="drop-mark" aria-hidden="true"></div>
    <div class="eyebrow">${ON_SITE ? `<a class="home" href="${t("/", "/en/")}">WealthLens</a>` : "WealthLens"} · ${INVESTOR ? t("сводный отчёт", "consolidated report") : t("портфель клиента", "client portfolio")}</div>
    ${PAYWALL && promoCode() ? `<p class="gift-pill">${t(`Подарочный код <b>${esc(promoCode())}</b> — полный отчёт для вас бесплатный`, `Gift code <b>${esc(promoCode())}</b> — your full report is free`)}</p>` : ""}
    <h1>${INVESTOR ? t("Загрузите выписки брокеров", "Upload your broker statements") : t("Загрузите выписки клиента", "Upload client statements")}</h1>
    <p>${t("Можно сразу несколько файлов. PDF Charles Schwab и Swissquote читаются сами; PDF, CSV и Excel других банков — с проверкой колонок перед импортом.",
      "You can add several files at once. Charles Schwab and Swissquote PDFs are read automatically; PDFs, CSV and Excel files from other banks are imported after a quick column check.")}</p>
    <div class="drop-actions"><button class="btn primary" id="pick" type="button">${t("Выбрать файлы", "Choose files")}</button>
    <button class="btn small" id="tplBtn" type="button">${t("Шаблон CSV", "CSV template")}</button></div>
    <p class="demo-link">${t(`<a href="?demo=1">Посмотреть пример отчёта</a> — вымышленный портфель у четырёх брокеров`,
      `<a href="?demo=1&amp;lang=en">See a sample report</a> — a fictional portfolio across four brokers`)}</p>
    <p class="hint">${t("Или перетащите файлы сюда. Выписки разбираются в этом браузере: наружу уходят только тикеры, ISIN и названия компаний — чтобы сопоставить бумаги с биржей и получить котировки и новости. Если файл не прочитается, его таблицу можно распознать с помощью ИИ — только с вашего согласия и без шапки выписки.",
      "Or drop files here. Statements are processed in this browser: only tickers, ISINs and company names leave it, to match holdings to exchange listings and fetch quotes and news. If a file can't be read, its table can be read with AI — only with your consent and without the statement header.")}</p>
    ${SUPPORT ? `<p class="hint">${t(`Выписка не читается или нужен другой банк — напишите на ${supportLink()}. Сами выписки присылать не нужно, достаточно названия банка.`,
      `Statement not read, or need another bank? Email ${supportLink()}. No need to send the statement itself — the bank's name is enough.`)}</p>` : ""}
    <p class="hint lang-link"><a href="${esc(langUrl(EN ? "ru" : "en"))}" hreflang="${EN ? "ru" : "en"}" lang="${EN ? "ru" : "en"}">${EN ? "Русский" : "English"}</a></p>
    <details class="where"><summary>${t("Где взять выписку", "Where to get a statement")}</summary><ul>${t(`
      <li><b>Interactive Brokers</b> — Portal → Performance &amp; Reports → Statements → Activity, формат CSV.</li>
      <li><b>Charles Schwab</b> — Accounts → Statements &amp; Tax Forms → месячная выписка в PDF.</li>
      <li><b>Swissquote</b> — раздел документов счёта → выписка о портфеле в PDF.</li>
      <li><b>Другие банки</b> — выписка о портфеле в PDF или экспорт позиций (Positions, Holdings, Portfolio) в CSV или Excel. Сканы не читаются: в PDF должен выделяться текст.</li>`, `
      <li><b>Interactive Brokers</b> — Portal → Performance &amp; Reports → Statements → Activity, CSV format.</li>
      <li><b>Charles Schwab</b> — Accounts → Statements &amp; Tax Forms → monthly statement (PDF).</li>
      <li><b>Swissquote</b> — account documents → portfolio statement (PDF).</li>
      <li><b>Other banks</b> — a portfolio statement in PDF, or a positions export (Positions, Holdings or Portfolio) to CSV or Excel. Scans cannot be read: the PDF text must be selectable.</li>`)}
    </ul></details>
    </div>
    ${PAYWALL ? `<p class="drop-foot muted">${promoCode() ? t("Итог по счетам и первый вывод — сразу · полный отчёт по подарочному коду — €0 · оформление через Stripe",
      "Account totals and the first finding right away · full report with your gift code — €0 · checkout via Stripe")
      : t(`Итог по счетам и первый вывод — бесплатно · полный отчёт ${PRICE.label} · оплата через Stripe`,
      `Account totals and the first finding are free · full report ${PRICE.label} · payment via Stripe`)}</p>` : ""}`;
  $("#pick").onclick = () => $("#file").click();
  // Шаблон для тех, у кого выгрузки нет: заполнить в Excel и принести сюда.
  $("#tplBtn").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + WL.sheetTemplate()], {type: "text/csv;charset=utf-8"}));
    a.download = t("wealthlens-шаблон.csv", "wealthlens-template.csv");
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}
if(INVESTOR) document.title = t("Мой портфель · WealthLens", "My portfolio · WealthLens");
else if(EN) document.title = "Client portfolio · WealthLens";
/* ── Окна поверх страницы ─────────────────────────────────────────────────
   Одно правило для всех окон (ИИ, «тот же счёт», разметка колонок): Escape закрывает только верхнее,
   Tab не уходит из окна, после закрытия фокус возвращается туда, где был. */
const MODALS = [];
document.addEventListener("keydown", e => {
  const top = MODALS[MODALS.length - 1]; if(!top) return;
  if(e.key === "Escape"){ e.preventDefault(); e.stopImmediatePropagation(); top.dismiss(); return; }
  if(e.key !== "Tab") return;
  const f = [...top.el.querySelectorAll("button, select, input, textarea, summary, a[href], [tabindex]:not([tabindex='-1'])")]
    .filter(x => !x.disabled && x.offsetParent !== null);
  if(!f.length) return;
  const i = f.indexOf(document.activeElement);
  if(e.shiftKey && i <= 0){ e.preventDefault(); f[f.length - 1].focus(); }
  else if(!e.shiftKey && (i === f.length - 1 || i < 0)){ e.preventDefault(); f[0].focus(); }
}, true);
function pushModal(wrap, dismiss){
  const back = document.activeElement, entry = {el: wrap, dismiss};
  MODALS.push(entry);
  return () => {
    const i = MODALS.indexOf(entry); if(i >= 0) MODALS.splice(i, 1);
    wrap.remove();
    if(back && back.focus && document.contains(back)) back.focus();
    if(!MODALS.length) setTimeout(syncStore, 0);
  };
}
let dlgSeq = 0;
function dialog({eyebrow, title, body, buttons, cancel, read, gate, focus, enter}){
  return new Promise(resolve => {
    const wrap = document.createElement("div"), id = "dlg" + (++dlgSeq);
    wrap.className = "modal no-print";
    wrap.innerHTML = `<div class="card dialog" role="dialog" aria-modal="true" aria-labelledby="${id}" tabindex="-1">
      ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h2 id="${id}">${esc(title)}</h2>${body}
      <div class="dlg-actions">${buttons.map(x => `<button class="btn${x.primary ? " primary" : ""}" type="button" data-dlg="${x.id}">${esc(x.label)}</button>`).join("")}</div></div>`;
    document.body.appendChild(wrap);
    let done = false;
    const finish = choice => { if(done) return; done = true; const extra = read ? read(wrap) : null; close(); resolve({choice, extra}); };
    const close = pushModal(wrap, () => finish(cancel));
    wrap.addEventListener("click", e => { if(e.target === wrap) return finish(cancel); const x = e.target.closest("[data-dlg]"); if(x && !x.disabled) finish(x.dataset.dlg); });
    // Главная кнопка ждёт отмеченного согласия.
    if(gate){ const box = wrap.querySelector(gate), btn = wrap.querySelector(".btn.primary"); const sync = () => { btn.disabled = !box.checked; }; box.addEventListener("change", sync); sync(); }
    // Поле ввода (пароль): Enter в нём — главная кнопка.
    if(enter && focus){ const f = wrap.querySelector(focus); if(f) f.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); finish(enter); } }); }
    // Окна из очереди появляются, когда до файла дошла очередь, — возможно, посреди набора текста. Фокус на самом
    // окне, а не на кнопке: случайный Enter не отправит выписку в ИИ и не заменит выписку. Окно с полем ввода — на поле.
    (focus && wrap.querySelector(focus) || wrap.querySelector(".dialog")).focus();
  });
}

/* ── Загрузка выписок: одна очередь ───────────────────────────────────────
   Выписки приносят пачкой или по одной — в том числе пока предыдущая ещё читается, ждёт решения или
   распознаётся ИИ. Всё идёт через одну очередь: окна не накладываются, отчёт не пересобирается наперегонки,
   а лоток загрузок показывает, что с каждым файлом. Прочитанная выписка сразу попадает в отчёт и
   сохраняется, не дожидаясь остальных. Тот же файл второй раз не читается и не уходит в ИИ. */
const Q = {items: [], running: false, gen: 0, seq: 0, lead: false, hidden: false, aiOk: false};
const ACTIVE = /^(queued|reading|later|ask|ai|ready|mapping)$/;
const isPdf = f => /\.pdf$/i.test(f.name) || f.type === "application/pdf";
const AI_CACHE = new Map();            // хеш файла → ответ ИИ; только в памяти этой вкладки
const AI_OK = "wl_ai_consent_v1";      // отчёты, где пользователь разрешил ИИ без вопроса
// Разрешение действует, пока в отчёте есть выписки: пустой отчёт выглядит как новый — там снова спрашиваем.
// В рамках одной загрузки галочка действует сразу, даже если ни одна выписка ещё не добавлена.
const aiAllowed = () => { if(Q.aiOk) return true; try{ return !!(S.rid && S.docs.length && JSON.parse(localStorage.getItem(AI_OK) || "{}")[S.rid]); }catch(e){ return false; } };
const setAiAllowed = on => { try{ const m = JSON.parse(localStorage.getItem(AI_OK) || "{}"); if(on) m[S.rid] = 1; else delete m[S.rid];
  localStorage.setItem(AI_OK, JSON.stringify(m)); }catch(e){} };
const MSG = {
  ops: () => t("похоже на выписку операций: нашлось только движение денег, таблицы позиций нет. Нужна выписка о портфеле (Portfolio, Holdings, Valuation)",
               "this looks like a transaction statement: only cash movements were found, no positions table. Upload a portfolio statement (Portfolio, Holdings, Valuation)"),
  scan: () => t("это скан без текста — нужна электронная выписка из интернет-банка или выгрузка CSV или Excel",
                "this is a scan with no text — download an electronic statement or a CSV or Excel export"),
  plain: () => t("в PDF нет таблиц с суммами — похоже, это не выписка", "this PDF has no tables with amounts — it does not look like a statement"),
};

async function fileHash(file){
  try{
    const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(d).slice(0, 12), x => x.toString(16).padStart(2, "0")).join("");
  }catch(e){ return `${file.name}:${file.size}:${file.lastModified}`; }
}
// Имя файла — ключ документа во всём отчёте (позиции, сверки, разметка), поэтому у разных файлов оно разное.
function uniqueName(name, free){
  const taken = n => n !== free && S.docs.some(d => d.fileName === n);
  if(!taken(name)) return name;
  const m = /^(.*?)(\.[^.]+)?$/.exec(name);
  let k = 2; while(taken(`${m[1]} (${k})${m[2] || ""}`)) k++;
  return `${m[1]} (${k})${m[2] || ""}`;
}
// Выписка без количества и цены, но с датой в шапке — движение денег, а не позиции.
function looksLikeOps(doc){
  const sh = doc.sheets && doc.sheets[doc.sheetIndex || 0], h = doc.head;
  if(!sh || !h || h.map.qty != null || h.map.price != null) return false;
  return (sh.rows[h.row] || []).some(c => /(^|\s)(date|datum|дата|valuta|booking)(\s|$)/i.test(String(c ?? "").trim()));
}
/* Выписка того же счёта. Молча заменять нельзя — в одном банке бывают два счёта с одинаковыми бумагами (у супругов
   одна модель портфеля); молча складывать тоже — тогда счёт посчитается дважды. Поэтому спрашиваем, а по сравнению
   подсказываем ответ:
   · те же бумаги и количества на ту же дату — это та же выписка;
   · тот же банк, и бумаги в основном общие (по ISIN, тикеру или названию, от объединения обоих списков) — выписка
     того же счёта; маленький счёт внутри большого так не совпадёт;
   · банк неизвестен (выгрузка без названия банка) — нужно больше общих бумаг;
   · бумаг слишком мало, чтобы сравнивать, но банк и имя файла или дата те же — тоже спрашиваем;
   · журнал операций (Swissquote) бумаг не перечисляет — для него хватает того же банка. */
const normName = x => String(x || "").toLowerCase().replace(/[^a-zа-яё0-9]/g, "");
const tagOf = name => String(name || "").replace(/ \(\d+\)(?=\.[^.]+$)/, "").replace(/\.[^.]+$/, "").slice(0, 40);
// Банк выписки для сравнения. У выгрузки без банка вместо его названия имя файла — такому «банку» не верим.
const bankOf = d => { const known = WL.brokerByName && WL.brokerByName(String(d.broker || ""));
  if(known) return normName(known);
  return d.from === "sheet" && (d.broker === tagOf(d.fileName) || /·/.test(d.broker || "")) ? null : normName(d.brokerShort || d.broker) || null; };
function sameAccount(doc){
  const norm = normName, bank = bankOf;
  const ids = p => [p.isin, p.occ, p.type === "cash" ? "CASH:" + (p.ccy || p.symbol) : p.symbol, p.name && "N:" + norm(p.name)].filter(Boolean).map(x => String(x).toUpperCase());
  // Пары одинаковых бумаг: бумага совпадает с другой, если совпал хоть один признак. exact — ещё и количество со стоимостью.
  const pairs = (a, b, exact) => { const used = new Set(); let m = 0;
    a.forEach(p => { const k = ids(p);
      const j = b.findIndex((q, i) => !used.has(i) && ids(q).some(x => k.includes(x)) &&
        (!exact || ((p.qty ?? null) === (q.qty ?? null) && Math.abs((p.value || 0) - (q.value || 0)) < 0.01)));
      if(j >= 0){ used.add(j); m++; } });
    return m; };
  const b2 = bank(doc);
  if(doc.kind === "positions"){
    let best = null;
    S.docs.forEach(d => {
      if(d.kind !== "positions" || distinct(d, doc)) return;
      const b1 = bank(d); if(b1 && b2 && b1 !== b2) return;
      // Номер счёта известен в обеих выписках: совпал — тот же счёт, разный — другой, как бы ни совпадали бумаги (у супругов одна модель).
      // Субсчета одного клиента (123456-1 и 123456-2) — разные счета. Совпал только корень или номер клиента — спрашиваем.
      const rel = WL.compareAccounts(d.accts, doc.accts);
      if(rel === "different") return;
      const acctSame = rel === "same";
      const all1 = doc.positions || [], all2 = d.positions || [];
      let hit = null;
      // Дата «на сегодня» (в файле её нет) у одной и той же выгрузки, добавленной в разные дни, разная — такие даты не сравниваем.
      const sameDay = doc.asOf === d.asOf || (dateGuessed(doc) && dateGuessed(d));
      const shareOf = () => { const h1 = all1.filter(p => p.type !== "cash"), h2 = all2.filter(p => p.type !== "cash"), m = pairs(h1, h2), u = h1.length + h2.length - m; return u ? m / u : null; };
      if(sameDay && all1.length && all1.length === all2.length && pairs(all1, all2, true) === all1.length) hit = {doc: d, share: 1, identical: true, rank: 5};
      else if(acctSame) hit = {doc: d, share: shareOf(), acct: true, rank: 4};
      else if(rel === "maybe" || rel === "client") hit = {doc: d, share: shareOf(), maybe: rel, rank: 3};
      else {
        const h1 = all1.filter(p => p.type !== "cash"), h2 = all2.filter(p => p.type !== "cash");
        const m = pairs(h1, h2), union = h1.length + h2.length - m, share = union ? m / union : 0, sameBank = !!(b1 && b1 === b2);
        if(sameBank ? m >= 2 && share >= 0.5 : m >= 3 && share >= 0.7) hit = {doc: d, share, rank: 2};
        // Сравнить по бумагам нечего или банк не указан: тогда подсказкой служит то же имя файла (выгрузка за другую неделю).
        else if(sameBank ? (h1.length < 2 || h2.length < 2) && (tagOf(d.fileName) === tagOf(doc.fileName) || (d.asOf === doc.asOf && !dateGuessed(d) && !dateGuessed(doc)))
                         : (!b1 || !b2) && tagOf(d.fileName) === tagOf(doc.fileName)) hit = {doc: d, share: null, few: true, noBank: !sameBank, rank: 1};
      }
      if(hit && (!best || hit.rank > best.rank || (hit.rank === best.rank && (hit.share || 0) > (best.share || 0)))) best = hit;
    });
    if(best) return best;
  }
  if(!b2 || (doc.kind !== "ledger" && doc.kind !== "positions")) return null;
  const log = S.docs.find(d => (d.kind === "ledger" || doc.kind === "ledger") && (d.kind === "ledger" || d.kind === "positions") && bank(d) === b2);
  return log ? {doc: log, share: null, log: true} : null;
}
/* Ответ «это разные счета» запоминается за выписками: следующая выписка любого из этих счетов не вызовет тот же вопрос.
   Ключ — отпечатки номеров счёта, а без номеров — имя файла без даты. */
const acctKey = d => { const a = (d.accts || []).filter(x => !x.startsWith("C:")).sort().join(","); return a || "file:" + tagOf(d.fileName).replace(/\d{4}[-_.]?\d{2}[-_.]?\d{2}|\d{2}[-_.]\d{2}[-_.]\d{4}/g, ""); };
const distinct = (a, b) => (a.distinctFrom || []).includes(acctKey(b)) || (b.distinctFrom || []).includes(acctKey(a));
const ALREADY = () => t("уже в отчёте", "already in the report");
// Даты оценки в файле не было, и взята сегодняшняя (у выписок, сохранённых раньше, — только пометка в примечании).
const dateGuessed = x => !!(x.asOfGuessed || /взята сегодняшняя|today's date used/.test(x.note || ""));
const inReport = it => !!(it.hash && S.docs.some(d => d.hash === it.hash));

function addFiles(files){
  if(missingModules().length) return renderBroken(missingModules());
  const list = [...files].filter(f => /\.(pdf|csv|tsv|txt|xlsx|xls)$/i.test(f.name) || f.type === "application/pdf");
  if(!list.length){ toast(t("Нужны PDF-выписки или выгрузки CSV и Excel", "Only PDF statements and CSV or Excel exports are supported")); return; }
  if(S.demo) leaveDemo();
  list.forEach(f => Q.items.push({id: ++Q.seq, file: f, name: f.name, state: "queued", text: t("в очереди", "queued")}));
  Q.hidden = false; Q.trayOpen = false;
  renderTray(true);
  if(Q.running) readQueued(Q.gen);
  runQueue();
}
/* Порядок: файлы читаются, как только пришли, — даже если открыто окно или ИИ читает другой файл. Прочитанное
   без вопросов сразу попадает в отчёт. Окна (ИИ, разметка, «тот же счёт») — по одному и после того, как всё
   пришедшее прочитано. Запрос к ИИ идёт в фоне, его результат добавляется, когда придёт ответ. */
let wakeQueue = null, reading = null;
/* Непредвиденный сбой (не «файл повреждён» и не «формат не распознан», а ошибка самой страницы) не оставляет файл в «читаю…»:
   файл получает понятный итог и кнопку «Повторить», остальные файлы пачки обрабатываются дальше. Причина — в консоли.
   Сначала меняется состояние и только потом текст и лоток: если сломана и отрисовка, файл всё равно не зависнет. */
function failItem(it){
  it.state = "error"; it.retry = true; it.ready = null; it.later = null;
  try{
    it.text = t("не удалось обработать из-за сбоя страницы — нажмите «Повторить» или обновите страницу", "could not be processed because the page hit an error — use “Retry” or reload the page");
    renderTray(true); announce(`${it.name}: ${it.text}`);
  }catch(e){ console.error(e); }
}
const STUCK = /^(queued|reading|later|ask|ai|ready|mapping)$/;    // те же состояния, что ACTIVE: файл ещё в работе
function readQueued(gen){
  if(reading && reading.gen === gen) return reading.p;
  const job = reading = {gen};
  job.p = (async () => {
    try{
      for(let it; gen === Q.gen && (it = Q.items.find(x => x.state === "queued"));){
        try{ await processItem(it, gen); }
        catch(e){ console.error(e); if(gen === Q.gen && STUCK.test(it.state)) failItem(it); }
      }
    }
    finally{ if(reading === job) reading = null; if(wakeQueue) wakeQueue(); }
  })();
  return job.p;
}
async function runQueue(){
  if(Q.running){ if(wakeQueue) wakeQueue(); return; }
  const gen = Q.gen;
  Q.running = true; Q.lead = false; setBusy(true);
  try{
    while(gen === Q.gen){
      if(Q.items.some(x => x.state === "queued")) readQueued(gen);
      const it = !reading && (Q.items.find(x => x.state === "ready") || Q.items.find(x => x.state === "later"));
      if(it){
        try{
          if(it.state === "ready") await commit(it, it.ready, gen);
          else if(it.later.kind === "hard") await resolveHard(it, it.later.manual, gen);
          else if(it.later.kind === "password") await askPasswordAndRetry(it, gen);
          else await mapAndCommit(it, it.later.manual, gen);
        }catch(e){ console.error(e); if(gen === Q.gen && STUCK.test(it.state)) failItem(it); }
        continue;
      }
      const waits = [reading && reading.p, ...Q.items.filter(x => x.state === "ai" && x.job).map(x => x.job)].filter(Boolean);
      if(!waits.length) break;
      await Promise.race([...waits, new Promise(r => { wakeQueue = r; })]);     // дочитали, пришёл ответ ИИ или новые файлы
      wakeQueue = null;
    }
  }finally{
    if(gen === Q.gen){
      Q.running = false; Q.aiOk = false; setBusy(false);
      if(Q.items.some(x => x.state === "error" || x.state === "partial")) Q.hidden = false;   // о проблеме скажем, даже если лоток прятали
      renderTray(true);
      syncStore();
      if(S.docs.length) liveSoon(0);
    }
  }
}
function setState(it, state, text){
  it.state = state; it.text = text;
  renderTray(true);
  if(!ACTIVE.test(state)) announce(`${it.name}: ${text}`);
}

async function processItem(it, gen){
  setState(it, "reading", t("читаю…", "reading…"));
  it.hash = await fileHash(it.file);
  if(gen !== Q.gen) return;
  if(inReport(it)) return setState(it, "skip", ALREADY());
  if(Q.items.some(x => x !== it && x.hash === it.hash && ACTIVE.test(x.state))) return setState(it, "skip", t("этот файл уже в очереди", "this file is already in the queue"));
  let doc;
  // Страницы-картинки распознаются на этом компьютере — это небыстро, поэтому показываем ход и даём отменить.
  const ocrCtl = it.abort = new AbortController();
  const ocr = (i, n) => { it.ocr = true; setState(it, "reading", t(`распознаю текст на страницах-картинках на этом компьютере: ${i + 1} из ${n}`,
    `recognising text on image pages on this computer: ${i + 1} of ${n}`)); };
  try{ doc = await WL.parseFile(it.file, {ocr, signal: ocrCtl.signal, password: it.password}); }
  catch(e){
    it.abort = null; it.ocr = false;
    if(gen !== Q.gen) return;
    // Выписка под паролем: спросим пароль, когда дойдёт очередь окон; остальные файлы читаются дальше.
    if(e && e.name === "PasswordException"){
      it.later = {kind: "password", wrong: e.code === 2};
      return setState(it, "later", e.code === 2 ? t("пароль не подошёл — спрошу снова", "wrong password — will ask again") : t("защищён паролем — спрошу пароль", "password-protected — will ask for the password"));
    }
    return setState(it, "error", e && e.name === "InvalidPDFException" ? t("файл повреждён или это не PDF — откройте его на компьютере и сохраните заново", "the file is damaged or not a PDF — open it on your computer and save it again")
      : t("не удалось прочитать файл", "could not read the file"));
  }
  it.abort = null; it.ocr = false;
  if(gen !== Q.gen) return;
  if(doc.unknown){
    if(doc.ops) return setState(it, "error", MSG.ops());
    if(doc.scan) return setState(it, "error", MSG.scan());
    if(doc.plain) return setState(it, "error", MSG.plain());
    const manual = doc.sheets ? {sheets: doc.sheets} : null;
    if(isPdf(it.file)) return later(it, "hard", manual);
    // Таблицу CSV или Excel, которую не удалось разметить самим, отдаём пользователю: он покажет колонки.
    if(manual) return later(it, "map", manual);
    return setState(it, "error", t("формат выписки пока не распознаётся", "this statement format is not supported yet"));
  }
  if(doc.from === "sheet" && !doc.fromPdf && looksLikeOps(doc)) return setState(it, "error", MSG.ops());
  await fingerprint(doc);
  if(gen !== Q.gen) return;
  // Таблица из PDF другого банка. Уверенный разбор — сразу в отчёт: ничего не упало в сверке, у позиций есть
  // названия и стоимость, итог файла сошёлся или стоимость есть почти у всех строк. Сомнительный — ИИ или ручная разметка.
  if(doc.fromPdf){
    const m = doc.head.map, totals = doc.checks.filter(c => !c.count);
    const valued = doc.positions.filter(p => p.value != null).length;
    const sure = doc.checks.every(c => c.ok) && doc.positions.length >= 2 && m.value != null && (m.name != null || m.ticker != null) &&
      (totals.some(c => c.ok) || valued >= doc.positions.length * 0.8);
    if(!sure) return later(it, "hard", {sheets: doc.sheets, pre: {sheetIndex: doc.sheetIndex || 0, head: doc.head, pdf: true}});
    doc.note = [doc.note, t("таблица найдена в PDF автоматически", "table found in the PDF automatically")].filter(Boolean).join(" · ");
  }
  if(WL.quality(doc).status === "partial"){ it.ready = doc; return setState(it, "ready", t("прочитан не полностью — спрошу, добавлять ли", "not fully read — will ask whether to add it")); }
  if(doc.ccyGuessed){ it.ready = doc; return setState(it, "ready", t("прочитан — спрошу валюту сумм", "read — will ask for the currency")); }
  if(sameAccount(doc)){ it.ready = doc; return setState(it, "ready", t("прочитан — спрошу, тот ли это счёт", "read — will ask whether it is the same account")); }
  return commit(it, doc, gen);
}

function later(it, kind, manual){
  it.later = {kind, manual};
  const more = Q.items.some(x => x.state === "queued"), unsure = !!(manual && manual.pre && manual.pre.pdf);
  setState(it, "later", kind === "hard"
    ? (unsure ? (more ? t("таблица найдена, но нужна проверка — после остальных файлов", "table found but needs a check — after the other files") : t("таблица найдена, но нужна проверка", "table found but needs a check"))
      : more ? t("не прочитался автоматически — вернусь после остальных файлов", "not read automatically — back to it after the other files") : t("не прочитался автоматически", "not read automatically"))
    : (more ? t("нужна разметка колонок — после остальных файлов", "needs column mapping — after the other files") : t("нужна разметка колонок", "needs column mapping")));
}

/* Выписка под паролем. Пароль вводится здесь и живёт только в памяти этой вкладки: им расшифровывается файл на этом компьютере,
   на сервер он не уходит и в отчёт не сохраняется. */
async function askPasswordAndRetry(it, gen){
  if(inReport(it)) return setState(it, "skip", ALREADY());
  setState(it, "ask", t("ждёт пароля", "waiting for the password"));
  const wrong = it.later && it.later.wrong;
  const {choice, extra} = await dialog({
    eyebrow: t("Защищённый PDF", "Protected PDF"),
    title: wrong ? t("Пароль не подошёл", "Wrong password") : t("Выписка защищена паролем", "This statement is password-protected"),
    body: `<ul class="ai-files"><li>${esc(it.name)}</li></ul>
      <p>${t("Банк защитил файл паролем. Введите его — файл откроется на этом компьютере; пароль никуда не отправляется и не сохраняется.",
        "The bank protected this file with a password. Enter it to open the file on this computer; the password is not sent anywhere or stored.")}</p>
      <label class="pw-field"><span>${t("Пароль к файлу", "File password")}</span><input type="password" data-pw autocomplete="off" spellcheck="false"></label>`,
    buttons: [{id: "open", label: t("Открыть", "Open"), primary: true}, {id: "skip", label: t("Пропустить файл", "Skip this file")}],
    cancel: "skip", focus: "[data-pw]", enter: "open",
    read: wrap => { const x = wrap.querySelector("[data-pw]"); return x ? x.value : ""; },
  });
  if(gen !== Q.gen) return;
  if(choice !== "open" || !extra) return setState(it, "skip", t("защищён паролем — не добавлен", "password-protected — not added"));
  it.password = extra; it.later = null;
  setState(it, "queued", t("в очереди", "queued"));
  readQueued(gen);
}

/* PDF, который не прочитался здесь: ИИ (с согласия) или ручная разметка колонок. Согласие спрашиваем на файл;
   «не спрашивать для этого отчёта» действует до конца загрузки, а за отчётом запоминается, когда ИИ добавил
   выписку. Отключается в «Документах». */
async function resolveHard(it, manual, gen){
  if(inReport(it)) return setState(it, "skip", ALREADY());
  let choice = "ai", remember = false;
  if(!AI_CACHE.has(it.hash) && !aiAllowed()){
    // Текст готовим до вопроса: человек может посмотреть, что именно уйдёт, прежде чем согласиться.
    setState(it, "reading", t("готовлю текст для распознавания…", "preparing the text…"));
    try{ it.prep = await WL.pdfAiText(it.file, {password: it.password}); }catch(e){ return setState(it, "error", t("не удалось прочитать текст файла", "could not read the file's text")); }
    if(gen !== Q.gen) return;
    setState(it, "ask", t("ждёт вашего решения", "waiting for your decision"));
    const r = await askAi(it, manual, it.prep);
    if(gen !== Q.gen) return;
    choice = r.choice; remember = !!(r.extra && r.extra.remember);
    // Текст поправили перед отправкой: уходит и проверяется ровно он.
    const edited = r.extra && r.extra.text;
    if(choice === "ai" && edited != null && edited !== it.prep.text){
      if(!edited.trim()) return setState(it, "skip", t("текст для распознавания пуст — файл не добавлен", "the text to read is empty — file not added"));
      it.prep = {...it.prep, text: edited, ...WL.aiLines(edited), edited: true};
    }
  }
  if(choice === "manual" && manual) return mapAndCommit(it, manual, gen);
  if(choice !== "ai") return setState(it, "skip", t("пропущен", "skipped"));
  if(remember) Q.aiOk = true;
  const ctl = it.abort = new AbortController();
  setState(it, "ai", t("распознаю с помощью ИИ — это может занять несколько минут", "reading with AI — this can take a few minutes"));
  const cancelled = () => setState(it, "skip", t("распознавание отменено — файл не добавлен", "recognition cancelled — file not added"));
  // Не ждём ответа: очередь тем временем читает остальные файлы, а результат добавится, когда придёт.
  it.job = aiRead(it.file, it.hash, ctl.signal, it.prep, it.password).then(doc => {
    it.abort = null; it.job = null; it.prep = null;
    if(gen !== Q.gen) return;
    if(ctl.signal.aborted) return cancelled();
    track("AiRecognized", {positions: doc.positions.length});
    it.ready = doc;
    setState(it, "ready", t("распознано — добавляю в отчёт", "read — adding to the report"));
  }, e => {
    it.abort = null; it.job = null; it.prep = null;
    if(gen !== Q.gen) return;
    const code = String(e && e.message || e);
    track("AiFailed", {reason: code.slice(0, 40)});
    if(code === "aborted") return cancelled();
    if(manual && !/^(transactions|no_positions)$/.test(code)){
      toast(`${it.name}: ${aiErrorText(code)}`);
      it.later = {kind: "map", manual};
      return setState(it, "later", t("ИИ не прочитал файл — нужна разметка колонок", "AI could not read the file — needs column mapping"));
    }
    setState(it, "error", aiErrorText(code));
  }).catch(e => { console.error(e); });
}
async function askAi(it, manual, prep){
  const canManual = !!manual, unsure = !!(manual && manual.pre && manual.pre.pdf);
  return dialog({
    eyebrow: t("Распознавание", "Recognition"),
    title: unsure ? t("Не уверены, что таблица прочитана верно", "We are not sure the table was read correctly")
      : t("Файл не прочитался автоматически", "This file could not be read automatically"),
    body: `<ul class="ai-files"><li>${esc(it.name)}</li></ul>
      ${unsure ? `<p>${t("Таблицу позиций в файле нашли, но колонки или итог не сошлись. Проверьте колонки сами — это останется в браузере — или распознайте таблицу с помощью ИИ.",
        "We found the positions table, but the columns or the total did not add up. Check the columns yourself — this stays in the browser — or read the table with AI.")}</p>` : ""}
      <p>${t(`С помощью ИИ текст файла, начиная с первой таблицы, уйдёт на наш сервер и в модель Claude компании Anthropic.
        Страницы и строки до первой таблицы (обложку, адрес, реквизиты) и строки, повторяющиеся на страницах, не отправляем;
        номера счетов и портфеля, IBAN, почту, телефоны и имя владельца закрываем там, где их удалось узнать, — это помощь, а не гарантия.
        Проверьте текст перед отправкой. Наш сервер не сохраняет ни файл, ни текст.`,
        `With AI, the file's text from the first table onwards will be sent to our server and to Anthropic's Claude model.
        Pages and lines before the first table (cover, address, account details) and lines repeated on every page are not sent;
        account and portfolio numbers, IBANs, emails, phone numbers and the owner's name are hidden where we recognise them — this helps but is not a guarantee.
        Check the text before sending. Our server stores neither the file nor the text.`)}</p>
      ${prep && prep.text ? `<details class="ai-preview"><summary>${t(`Проверить и поправить текст, который уйдёт · ${fmt.int(prep.text.length)} знаков`, `Check and edit the text that will be sent · ${fmt.int(prep.text.length)} characters`)}</summary>
        <textarea class="ai-text" data-ai-text spellcheck="false" aria-label="${t("Текст, который уйдёт на распознавание", "Text that will be sent for recognition")}">${esc(prep.text)}</textarea>
        <p class="muted">${t("▇ — закрытые номера и имена. Всё, что отправлять нельзя, удалите или замените на ▇ прямо здесь: уйдёт и будет проверяться именно этот текст.",
          "▇ marks hidden numbers and names. Delete anything that must not be sent, or replace it with ▇, right here: exactly this text is sent and checked.")}</p></details>` : ""}
      <label class="ai-remember"><input type="checkbox" data-remember> ${t("Не спрашивать снова для этого отчёта", "Don't ask again for this report")}</label>
      ${ON_SITE ? `<p class="ai-more"><a href="${t("/legal/privacy/", "/en/legal/privacy/")}" target="_blank" rel="noopener">${t("Как мы обращаемся с данными", "How we handle data")}</a></p>` : ""}`,
    buttons: [{id: "ai", label: t("Распознать с помощью ИИ", "Read with AI"), primary: true},
              canManual && {id: "manual", label: t("Разметить колонки вручную", "Map columns manually")},
              {id: "cancel", label: t("Пропустить файл", "Skip this file")}].filter(Boolean),
    cancel: "cancel",
    read: wrap => { const c = wrap.querySelector("[data-remember]"), x = wrap.querySelector("[data-ai-text]");
      return {remember: !!(c && c.checked), text: x ? x.value : null}; },
  });
}
async function mapAndCommit(it, manual, gen){
  if(inReport(it)) return setState(it, "skip", ALREADY());
  setState(it, "mapping", t("ждёт разметки колонок", "waiting for column mapping"));
  const doc = await openMapper(it.file, manual.sheets, manual.pre || null);
  if(gen !== Q.gen) return;
  if(!doc) return setState(it, "skip", t("разметка закрыта — файл не добавлен", "mapping closed — file not added"));
  return commit(it, doc, gen);
}
async function commit(it, doc, gen){
  it.ready = null;
  if(inReport(it)) return setState(it, "skip", ALREADY());
  doc.hash = it.hash;
  await fingerprint(doc);
  if(gen !== Q.gen) return;
  // Цена облигаций без основы и без стоимости: сначала спрашиваем основу — от неё зависят стоимость и сверка итога.
  if(doc.basisUnknown && doc.sheets && doc.head){
    setState(it, "ask", t("цена облигаций без основы — ждёт решения", "bond price basis unknown — waiting for your decision"));
    const {choice} = await askBasis(it, doc);
    if(gen !== Q.gen) return;
    if(choice !== "percent" && choice !== "unit") return setState(it, "skip", t("не добавлен — не указана основа цены облигаций", "not added — bond price basis not given"));
    setBasis(it, doc, choice);
  }
  let quality = WL.quality(doc);
  if(quality.status === "partial"){
    setState(it, "ask", t("прочитан не полностью — ждёт решения", "not fully read — waiting for your decision"));
    const open = unreadPages(doc);
    const {choice} = await askPartial(it, doc, quality, open);
    if(gen !== Q.gen) return;
    if(choice === "noPositions"){ doc.pagesConfirmed = [...new Set([...(doc.pagesConfirmed || []), ...open])]; quality = WL.quality(doc); }
    else if(choice !== "add") return setState(it, "skip", t("не добавлен — прочитан не полностью", "not added — not fully read"));
  }
  // Валюты в файле нет: доллары молча не подставляем — суммы в евро или франках исказили бы итог.
  if(doc.ccyGuessed){
    setState(it, "ask", t("валюта не указана — ждёт решения", "currency not stated — waiting for your decision"));
    const {choice} = await askCurrency(it, doc);
    if(gen !== Q.gen) return;
    if(!/^[A-Z]{3}$/.test(choice)) return setState(it, "skip", t("не добавлен — валюта не указана", "not added — currency not stated"));
    setCurrency(doc, choice);
  }
  const twin = sameAccount(doc);
  let replace = null;
  if(twin){
    setState(it, "ask", twin.identical ? t("похоже, эта выписка уже в отчёте — ждёт решения", "looks like this statement is already in the report — waiting for your decision")
      : t("похоже на выписку того же счёта — ждёт решения", "looks like the same account — waiting for your decision"));
    const {choice} = await askReplace(twin, doc);
    if(gen !== Q.gen) return;
    if(!S.docs.includes(twin.doc) && choice !== "skip"){ replace = null; }                 // пока окно было открыто, выписку убрали
    else if(choice === "replace"){ replace = twin.doc.fileName;
      // Новая выписка того же счёта наследует ответы «это разные счета», данные о прежней.
      if(twin.doc.distinctFrom) doc.distinctFrom = [...new Set([...(doc.distinctFrom || []), ...twin.doc.distinctFrom])]; }
    else if(choice === "both") doc.distinctFrom = [...new Set([...(doc.distinctFrom || []), acctKey(twin.doc)])];
    if(choice === "skip") return setState(it, "skip", twin.identical ? ALREADY() : t("не добавлен — выписка этого счёта уже в отчёте", "not added — this account is already in the report"));
    if(inReport(it)) return setState(it, "skip", ALREADY());
  }
  doc.fileName = uniqueName(doc.fileName, replace);
  it.name = doc.fileName;
  const next = replace ? S.docs.map(d => d.fileName === replace ? doc : d) : S.docs.concat(doc);
  // Отчёт с новой выпиской должен собираться: иначе после сохранения страница была бы пустой при каждом открытии.
  try{ WL.build(next, TODAY); }catch(e){
    return setState(it, "error", t("файл прочитан, но отчёт с ним не собирается — напишите нам", "the file was read but the report cannot be built with it — contact us"));
  }
  if(replace) delete S_SHEETS[replace];
  S.docs = next;
  if(doc.from === "sheet" && doc.sheets) S_SHEETS[doc.fileName] = {file: it.file, sheets: doc.sheets, sheetIndex: doc.sheetIndex, head: doc.head, hash: doc.hash};
  if(!S.rid) S.rid = newRid();
  save();
  extendPaid();
  if(doc.fromAi && Q.aiOk) setAiAllowed(true);
  if(!Q.lead){ Q.lead = true; track("Lead", {content_name: "statements_uploaded", documents: S.docs.length}); }
  const n = doc.kind === "ledger" ? null : doc.positions.length, partial = quality.status === "partial";
  setState(it, partial ? "partial" : "ok", (partial ? t("добавлен с пометкой «прочитан не полностью» · ", "added, marked as not fully read · ") : "") +
    (n == null ? t("журнал операций", "transaction log") : `${n} ${WL.pl(n, ["позиция", "позиции", "позиций"], ["position", "positions"])}`) +
    ` · ${doc.brokerShort || doc.broker}` + (doc.fromAi ? t(" · распознано ИИ", " · read by AI") : "") + (replace ? t(" · заменила прежнюю", " · replaced the earlier one") : ""));
  renderNow(); liveSoon();
  flashDoc(doc.fileName);
}
function setCurrency(doc, ccy){
  doc.positions.forEach(p => { if(!p.ccyGuessed) return; p.ccy = ccy; if(p.type === "cash") p.symbol = ccy; delete p.ccyGuessed; });
  delete doc.ccyGuessed;
  doc.note = [doc.note, t(`валюта сумм указана вручную: ${ccy}`, `currency set manually: ${ccy}`)].filter(Boolean).join(" · ");
}
function askCurrency(it, doc){
  const n = doc.positions.filter(p => p.ccyGuessed).length;
  return dialog({
    eyebrow: doc.brokerShort || doc.broker,
    title: t("В какой валюте суммы в файле?", "What currency are the amounts in?"),
    body: `<ul class="ai-files"><li>${esc(it.name)}</li></ul>
      <p>${t(`У ${n} ${WL.pl(n, ["позиции", "позиций", "позиций"], ["position", "positions"])} в файле нет валюты: ни колонки, ни кода в самой сумме. Если посчитать их в долларах, а суммы на самом деле в евро или франках, итог отчёта будет неверным.`,
        `${n} ${WL.pl(n, ["позиции", "позиций", "позиций"], ["position", "positions"])} in the file have no currency: no column and no code in the amount itself. Counting them in dollars when they are really in euros or francs would make the report total wrong.`)}</p>`,
    buttons: [{id: "USD", label: "USD", primary: true}, {id: "EUR", label: "EUR"}, {id: "CHF", label: "CHF"}, {id: "GBP", label: "GBP"},
              {id: "skip", label: t("Другая — не добавлять", "Other — don't add")}],
    cancel: "skip",
  });
}
// Страницы-картинки, которые мешают доверять выписке: не прочитаны, человек их не подтвердил, и итог всего счёта их не покрывает.
const unreadPages = d => { const pg = d.pages; if(!pg || !(pg.unread || []).length || (d.checks || []).some(c => c.whole && c.ok)) return [];
  return pg.unread.filter(n => !(d.pagesConfirmed || []).includes(n)); };
// Выписка прочитана не полностью: показываем, что именно потеряно, и объясняем, что будет с отчётом. Непрочитанные страницы —
// миниатюрами: человек видит, реклама там или таблица, и может подтвердить, что позиций на них нет.
async function askPartial(it, doc, quality, open = []){
  let thumbs = [];
  if(open.length && WL.pageThumbs){ try{ thumbs = await WL.pageThumbs(it.file, open.slice(0, 4), {password: it.password}); }catch(e){} }
  const onlyPages = open.length && quality.issues.length === 1;
  return dialog({
    eyebrow: bankOf(doc) ? doc.brokerShort || doc.broker : t("Выгрузка без названия банка", "Export without a bank name"),
    title: onlyPages ? t("Программа не прочитала часть страниц", "Some pages could not be read") : t("Выписка прочитана не полностью", "This statement was not fully read"),
    body: `<ul class="ai-files"><li>${esc(it.name)}</li></ul>
      <ul class="dlg-issues">${quality.issues.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      ${thumbs.length ? `<div class="pg-thumbs">${thumbs.map(x => `<figure><img src="${x.url}" alt="${esc(t(`Страница ${x.n}`, `Page ${x.n}`))}"><figcaption>${t("стр.", "p.")} ${x.n}</figcaption></figure>`).join("")}</div>` : ""}
      ${onlyPages ? `<p>${open.length === 1
          ? t("Это изображение: текст на нём программа не читает, и распознать его не получилось. Если там только график, условия или реклама, отметьте это — выписка войдёт в отчёт с пометкой «позиций нет — со слов пользователя». Если там позиции, лучше загрузить исходный PDF из интернет-банка или выгрузку CSV.",
              "This is an image: the program cannot read text on it, and recognition did not work. If it only contains a chart, terms or ads, confirm it — the statement joins the report marked “no positions, as confirmed by the user”. If it contains positions, upload the original PDF from online banking or a CSV export instead.")
          : t("Это изображения: текст на них программа не читает, и распознать их не получилось. Если на них только графики, условия или реклама, отметьте это — выписка войдёт в отчёт с пометкой «позиций нет — со слов пользователя». Если там позиции, лучше загрузить исходный PDF из интернет-банка или выгрузку CSV.",
              "These are images: the program cannot read text on them, and recognition did not work. If they only contain charts, terms or ads, confirm it — the statement joins the report marked “no positions, as confirmed by the user”. If they contain positions, upload the original PDF from online banking or a CSV export instead.")}</p>`
        : `<p>${t("Итог и выводы с такой выпиской могут быть неверны. Её можно добавить с пометкой — посмотреть, что прочиталось, — но полный отчёт откроется, только когда все выписки сойдутся с итогами банка.",
          "The total and findings with this statement may be wrong. You can add it with a warning to see what was read, but the full report unlocks only when every statement matches the bank's totals.")}</p>
      <p>${t("Надёжнее загрузить исходный PDF из интернет-банка, без закрашивания и пересохранения, или выгрузку позиций в CSV или Excel.",
        "It is more reliable to upload the original PDF from online banking, not redacted or re-saved, or a positions export in CSV or Excel.")}</p>`}`,
    buttons: [{id: "add", label: t("Добавить с пометкой", "Add with a warning"), primary: true},
              onlyPages && {id: "noPositions", label: open.length === 1 ? t("На этой странице позиций нет", "No positions on this page") : t("На этих страницах позиций нет", "No positions on these pages")},
              {id: "skip", label: t("Не добавлять", "Don't add")}].filter(Boolean),
    cancel: "skip",
  });
}
// Цена облигаций без основы: показываем, что получится в каждом случае, — человек сверит с суммой в выписке банка.
function askBasis(it, doc){
  const ps = doc.positions.filter(p => p.basisUnknown && p.value == null), ex = ps[0], n = ps.length;
  const opt = (label, v) => `<li><span class="k">${label}</span><span class="m">${fmt.qty(ex.qty)} × ${fmt.px(ex.price)}${v === "p" ? "%" : ""} = ${fmt.money(ex.qty * ex.price / (v === "p" ? 100 : 1), ex.ccy)}</span></li>`;
  return dialog({
    eyebrow: doc.brokerShort || doc.broker,
    title: t("Цена облигаций — в процентах номинала или за штуку?", "Are the bond prices in percent of nominal or per unit?"),
    body: `<ul class="ai-files"><li>${esc(it.name)}</li></ul>
      <p>${t(`У ${n} ${WL.pl(n, ["облигации", "облигаций", "облигаций"], ["bond", "bonds"])} в файле нет стоимости, а по цене не видно, в чём она указана. Обычно цена облигации — в процентах номинала, но так бывает не всегда. Пример — ${esc(ex.name)}:`,
        `${n} ${WL.pl(n, ["", "", ""], ["bond has", "bonds have"])} no value in the file, and the price does not say what it is in. Bond prices are usually in percent of nominal, but not always. Example — ${esc(ex.name)}:`)}</p>
      <ul class="dlg-list">${opt(t("в % номинала", "% of nominal"), "p")}${opt(t("за штуку", "per unit"), "u")}</ul>`,
    buttons: [{id: "percent", label: t("В процентах номинала", "Percent of nominal"), primary: true}, {id: "unit", label: t("За штуку", "Per unit")}, {id: "skip", label: t("Не добавлять", "Don't add")}],
    cancel: "skip",
  });
}
function setBasis(it, doc, basis){
  const sh = doc.sheets[doc.sheetIndex || 0];
  const fresh = WL.sheetDoc(sh.rows, doc.head, it.file, {...(sh.ctx || {}), basis});
  doc.positions = fresh.positions; doc.checks = fresh.checks; delete doc.basisUnknown;
  doc.note = [doc.note, basis === "percent" ? t("цена облигаций в процентах номинала — указано вручную", "bond prices in percent of nominal — set manually")
    : t("цена облигаций за штуку — указано вручную", "bond prices per unit — set manually")].filter(Boolean).join(" · ");
}
function askReplace(twin, doc){
  const old = twin.doc, guessed = dateGuessed(doc) || dateGuessed(old);
  const newer = !guessed && doc.asOf > old.asOf, log = !!twin.log, same = !guessed && doc.asOf === old.asOf, pct = twin.share != null ? Math.round(twin.share * 100) : null;
  const line = (label, d) => `<li><span class="k">${label}</span><span class="f">${esc(d.fileName)}</span>
    <span class="m">${d.kind === "ledger" ? t(`журнал операций за ${fmt.date(d.periodFrom)}–${fmt.date(d.asOf)}`, `transaction log ${fmt.date(d.periodFrom)}–${fmt.date(d.asOf)}`)
      : `${t("на", "as of")} ${fmt.date(d.asOf)} · ${d.positions.length} ${WL.pl(d.positions.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}`}</span></li>`;
  const known = !!(bankOf(doc) && bankOf(old));
  const KEEP = known ? t("Если это разные счета в одном банке, оставьте обе.", "If these are different accounts at the same bank, keep both.")
    : t("Если это разные счета, оставьте обе.", "If these are different accounts, keep both.");
  const text = twin.identical ? t("Те же бумаги с теми же количествами и суммами на ту же дату — это та же выписка. Второй раз её добавлять не нужно: всё посчиталось бы дважды.",
      "The same holdings with the same quantities and amounts as of the same date — this is the same statement. Adding it again would count everything twice.")
    : twin.acct ? t("Номер счёта в выписках совпадает — это выписка того же счёта. В отчёте должна остаться одна, более новая, иначе всё посчитается дважды.",
      "The account number is the same in both statements, so this is the same account. Keep only the newer one, otherwise everything is counted twice.")
    : twin.maybe === "maybe" ? t(`В одной выписке номер счёта указан полностью, в другой — только его общая часть${pct != null ? `; бумаги совпадают на ${pct}%` : ""}. Это может быть новая выписка того же счёта, а может быть другой субсчёт того же клиента. Если это разные счета, оставьте обе.`,
      `One statement shows the full account number and the other only its common part${pct != null ? `; ${pct}% of the holdings match` : ""}. This may be a newer statement of the same account or another sub-account of the same client. If these are different accounts, keep both.`)
    : twin.maybe === "client" ? t(`Номер клиента в выписках совпадает, а номера счёта в них нет${pct != null ? `; бумаги совпадают на ${pct}%` : ""}. У одного клиента бывает несколько счетов: если это разные счета, оставьте обе, если тот же — замените прежнюю.`,
      `The client number is the same in both statements, but they show no account number${pct != null ? `; ${pct}% of the holdings match` : ""}. One client can have several accounts: if these are different accounts, keep both; if it is the same one, replace the earlier statement.`)
    : log ? t("Журнал операций показывает деньги и открытые позиции на свою дату, выписка — на свою. Если это один и тот же счёт, оставьте одну, более новую, — иначе деньги посчитаются дважды.",
      "A transaction log shows cash and open positions as of its own date, and a statement as of its own. If this is the same account, keep only the newer one — otherwise the cash is counted twice.") + " " + KEEP
    : twin.few && twin.noBank ? t("Банк в файлах не указан, но имя файла то же — похоже на новую выгрузку того же счёта. Если это один и тот же счёт, оставьте одну выписку — иначе всё посчитается дважды.",
      "The files do not name the bank, but the file name is the same — this looks like a new export of the same account. If it is the same account, keep one statement — otherwise everything is counted twice.") + " " + KEEP
    : twin.few ? t("Бумаг в выписках мало, и по ним не понять, один ли это счёт, но банк и имя файла или дата совпадают. Если это один и тот же счёт, оставьте одну выписку — иначе всё посчитается дважды.",
      "There are too few holdings to tell whether this is the same account, but the bank and the file name or date match. If it is the same account, keep one statement — otherwise everything is counted twice.") + " " + KEEP
    : same ? t(`Дата та же, бумаги совпадают на ${pct}%, но количества или суммы разные — скорее это другой счёт${known ? " в том же банке" : ""}. Если это исправленная выписка того же счёта, замените прежнюю.`,
      `Same date and ${pct}% of the holdings match, but quantities or amounts differ — most likely another account${known ? " at the same bank" : ""}. If this is a corrected statement of the same account, replace the earlier one.`)
    : t(`Бумаги совпадают на ${pct}%. Если это один и тот же счёт, в отчёте должна остаться одна выписка — иначе всё посчитается дважды.`,
      `${pct}% of the holdings match. If this is the same account, keep only one statement — otherwise everything is counted twice.`) + " " + KEEP;
  const B = {replaceNew: {id: "replace", label: t("Заменить более новой", "Replace with the newer one")}, replace: {id: "replace", label: t("Заменить прежнюю", "Replace the earlier one")},
    both: {id: "both", label: t("Это разные счета", "Different accounts")}, skip: {id: "skip", label: t("Не добавлять", "Don't add")}, keepNew: {id: "skip", label: t("Оставить более новую", "Keep the newer one")}};
  const order = twin.identical ? [B.skip, B.replace, B.both]
    : twin.acct ? (newer || same || guessed ? [newer ? B.replaceNew : B.replace, B.skip, B.both] : [B.keepNew, {id: "replace", label: t("Заменить на эту", "Replace with this one")}, B.both])
    : twin.maybe ? ((twin.share || 0) >= 0.5 && newer ? [B.replaceNew, B.both, B.skip] : [B.both, newer ? B.replaceNew : B.replace, B.skip])
    : guessed ? [B.replace, B.both, B.skip]
    : same ? (log ? [B.replace, B.both, B.skip] : [B.both, B.replace, B.skip])
    : newer ? [B.replaceNew, B.both, B.skip] : [B.keepNew, {id: "replace", label: t("Заменить на эту", "Replace with this one")}, B.both];
  return dialog({
    eyebrow: bankOf(doc) ? doc.brokerShort || doc.broker : t("Выгрузка без названия банка", "Export without a bank name"),
    title: twin.identical ? t("Эта выписка уже есть в отчёте", "This statement is already in the report")
      : twin.acct ? t("Это выписка того же счёта", "This is a statement of the same account")
      : twin.maybe ? t("Тот же счёт или другой?", "The same account or another one?")
      : same && !log && !twin.few ? (known ? t("Похоже на другой счёт в том же банке", "Looks like another account at the same bank") : t("Похоже на другой счёт", "Looks like another account"))
      : t("Похоже, это выписка того же счёта", "This looks like a statement of the same account"),
    body: `<ul class="dlg-list">${line(t("В отчёте", "In the report"), old)}${line(t("Новая", "New"), doc)}</ul><p>${text}</p>`,
    buttons: order.map((b, i) => ({...b, primary: i === 0})),
    cancel: "skip",
  });
}
// Пометка об ИИ: откуда цифры и какие суммы не нашлись в тексте выписки. Остаётся и после ручной разметки колонок.
const aiNote = d => [t("распознано ИИ по тексту таблиц; каждое число сверено со строкой своей бумаги", "read by AI from the table text; every number was checked against its own row"),
  d.aiDoubt && d.aiDoubt.length ? t(`не подтверждено текстом выписки: ${listShort(d.aiDoubt)}`, `not confirmed by the statement text: ${listShort(d.aiDoubt)}`) : ""].filter(Boolean).join(" · ");
const listShort = xs => xs.slice(0, 5).join(", ") + (xs.length > 5 ? t(` и ещё ${xs.length - 5}`, ` and ${xs.length - 5} more`) : "");
function aiErrorText(code){
  return ({
    ai_not_configured: t("распознавание ИИ ещё подключается", "AI recognition is not set up yet"),
    rate_limited: t("слишком много распознаваний подряд — попробуйте через 10 минут", "too many recognitions in a row — try again in 10 minutes"),
    too_large: t("файл слишком большой для распознавания", "the file is too large to read"),
    transactions: t("это выписка операций — позиций в ней нет", "this is a transaction statement with no positions"),
    no_positions: t("ИИ не нашёл в файле позиций", "AI found no positions in the file"),
    unverified: t("часть сумм из ответа ИИ не нашлась в выписке — такой разбор не принят", "some amounts in the AI result are not in the statement, so it was rejected"),
    timeout: t("ИИ не ответил за три минуты — попробуйте ещё раз", "AI did not answer within three minutes — try again"),
    network: t("нет связи с сервером распознавания", "no connection to the recognition server"),
  })[code] || t("не удалось распознать файл", "could not read the file");
}
// Ключ ответа ИИ: файл и ровно тот текст, что ушёл, — поправленный текст распознаётся заново.
const textKey = x => { let h = 2166136261; for(let i = 0; i < x.length; i++){ h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ":" + x.length; };
async function aiRead(file, hash, signal, prepared, password){
  // Отменить можно и пока готовится текст: тогда он никуда не уходит.
  const cancelled = () => { if(signal && signal.aborted) throw new Error("aborted"); };
  const prep = prepared || await WL.pdfAiText(file, {password});
  cancelled();
  if(prep.numbers.size < 2) throw new Error("no_positions");        // отправлять нечего: в тексте нет чисел
  if(prep.text.length > 160000) throw new Error("too_large");
  const key = prep.edited ? hash + "|" + textKey(prep.text) : hash;
  let data = AI_CACHE.get(key);
  if(!data){
    const ctl = new AbortController(), stop = () => ctl.abort();
    let timedOut = false, r;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, 180000);
    if(signal) signal.addEventListener("abort", stop);
    try{
      r = await fetch(PAY_API + "/ai/extract", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({text: prep.text}), signal: ctl.signal});
      data = await r.json();
    }catch(e){ throw new Error(signal && signal.aborted ? "aborted" : timedOut ? "timeout" : "network"); }
    finally{ clearTimeout(timer); if(signal) signal.removeEventListener("abort", stop); }
    if(!r.ok || data.error) throw new Error(data.error || "http_" + r.status);
    AI_CACHE.set(key, data);
  }
  cancelled();
  if(data.document_kind === "transactions") throw new Error("transactions");
  // Поля опциона приходят объектом без null («none», "", 0 — нет значения); страница 0 — неизвестна.
  const norm = p => { const o = p.option || {};
    return {...p, option_right: o.right && o.right !== "none" ? o.right : p.option_right || null, underlying: o.underlying || p.underlying || null,
      strike: o.strike || p.strike || null, contract_multiplier: o.multiplier || p.contract_multiplier || null, page: p.page || null}; };
  const ps = (data.positions || []).filter(p => p && p.name && (p.market_value != null || p.quantity != null)).map(norm);
  if(!ps.length) throw new Error("no_positions");

  /* Проверка ответа (WL.aiVerify): каждое число — в строке своей бумаги и с тем же знаком, валюта — из строки, шапки таблицы
     или единственная в тексте. Бумаги с неподтверждённой стоимостью, количеством, ценой, НКД или чужой валютой помечаются, и
     выписка считается прочитанной не полностью; если таких больше четверти — ответу не верим целиком. Себестоимость, которой
     нет в строке, не показываем. */
  const V = WL.aiVerify(prep, ps);
  const doubtful = ps.filter((p, k) => V.pos[k].doubt.length);
  if(doubtful.length > ps.length * 0.25) throw new Error("unverified");

  // Ответ собираем в таблицу с заголовками шаблона и читаем тем же разбором, что CSV: классы активов,
  // опционы, сверка итогов и пометки о пропусках работают одинаково.
  const TYPE = {stock: "Stock", fund: "Fund", bond: "Bond", structured_note: "Structured note", option: "Option", future: "Future", cash: "Cash"};
  const ccy = v => (String(v || "").toUpperCase().match(/\b[A-Z]{3}\b/) || [""])[0];
  const isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "";
  const pct = p => p.price_basis === "percent_of_nominal";
  const cents = v => Math.round(v * 100) / 100;
  // Дата погашения, которой противоречит строка выписки, не берётся; не найденная в строке — остаётся с пометкой.
  ps.forEach((p, k) => { const v = V.pos[k]; if(v.date === "bad") p.maturity = null;
    v.drop.forEach(f => { p[f] = null; }); });
  // Опцион со стандартным контрактом на 100 акций — в виде кода OCC: по нему работают календарь экспираций и живая котировка.
  // Только если экспирация, страйк и базовый актив есть в строке выписки: иначе котировка была бы чужого контракта.
  const occOf = (p, k) => {
    const v = V.pos[k];
    if(p.asset_class !== "option" || !p.underlying || !p.option_right || p.strike == null || !isoDate(p.maturity) ||
       (p.contract_multiplier != null && p.contract_multiplier !== 100) || v.date !== "ok" || v.strike !== "ok" || v.under !== "ok") return "";
    const u = String(p.underlying).toUpperCase().replace(/\s+/g, "");
    if(!/^[A-Z][A-Z0-9.]{0,5}$/.test(u)) return "";
    const d = p.maturity;
    return u + d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10) + (p.option_right === "call" ? "C" : "P") + String(Math.round(p.strike * 1000)).padStart(8, "0");
  };
  const broker = prep.ctx.broker || String(data.institution || "").slice(0, 60);
  const accrued = {}, sums = {};
  const mvOf = p => p.market_value ?? (pct(p) && p.price != null && p.quantity != null ? cents(p.quantity * p.price / 100) : null);
  ps.forEach(p => { const c = ccy(p.currency); if(p.accrued_interest) accrued[c] = cents((accrued[c] || 0) + p.accrued_interest);
    const s2 = sums[c] = sums[c] || {mv: 0, acc: 0}; s2.mv = cents(s2.mv + (mvOf(p) || 0)); s2.acc = cents(s2.acc + (p.accrued_interest || 0)); });
  const ACCRUED = t("Накопленный купонный доход", "Accrued interest");
  // Итог — из строк итога самой выписки. Сошлась сумма позиций (с НКД или без) с каким-нибудь итогом в этой валюте — берём его;
  // не сошлась ни с одним — берём самый крупный итог валюты, и сверка покажет расхождение.
  const totalRows = Object.entries(sums).map(([c, s2]) => {
    const vals = V.totals.filter(x => x.ccy === c).flatMap(x => x.values).filter(v => Math.abs(v) >= 1);
    if(!c || !vals.length) return null;
    const near = (a, b) => Math.abs(a - b) < Math.max(0.01, Math.abs(b) * 1e-6);
    const full = vals.find(v => near(v, cents(s2.mv + s2.acc))), clean = vals.find(v => near(v, s2.mv));
    const value = full != null ? full : clean != null ? cents(clean + s2.acc) : vals.reduce((m, v) => Math.abs(v) > Math.abs(m) ? v : m, 0);
    return ["", `Total ${c}`, "", "", "", "", "", "", "", value, c, ""];
  }).filter(Boolean);
  const rows = [["Broker", "Name", "Ticker", "ISIN", "Type", "Quantity", "Average cost price", "Cost basis", "Current price", "Market value", "Currency", "Expiry"],
    ...ps.map((p, k) => {
      // Цены облигаций в процентах номинала: себестоимость — итоговой суммой, цена за единицу в колонку не идёт.
      const cost = p.cost_value ?? (pct(p) && p.cost_price != null && p.quantity != null ? cents(p.quantity * p.cost_price / 100) : null);
      return [broker, p.name, occOf(p, k) || p.ticker || "", p.isin || "", TYPE[p.asset_class] || "Other", p.quantity ?? "",
              pct(p) ? "" : p.cost_price ?? "", cost ?? "", pct(p) ? "" : p.price ?? "", mvOf(p) ?? "", ccy(p.currency), isoDate(p.maturity)];
    }),
    // НКД — отдельной строкой в своей валюте: в рыночной стоимости бумаг его нет, а в итогах счёта обычно есть.
    ...Object.entries(accrued).map(([c, v]) => [broker, ACCRUED, "", "", "Bond", "", "", "", "", v, c, ""]),
    ...totalRows];
  const ctx = {broker: broker || null, asOf: prep.ctx.asOf || (/^\d{4}-\d{2}-\d{2}$/.test(data.as_of || "") ? data.as_of : null)};
  const head = WL.sheetFind(rows);
  const doc = WL.sheetDoc(rows, head, file, ctx);
  // Что таблица шаблона не передаёт: погашение, цена в процентах номинала, НКД, страница — сопоставляем по порядку и названию.
  const used = new Set();
  ps.forEach((p, k) => {
    const d = doc.positions.find(x => !used.has(x) && x.name === p.name) || null;
    if(!d) return;
    used.add(d);
    const v = V.pos[k];
    if(p.page != null) d.page = p.page;
    if(isoDate(p.maturity) && d.type !== "option" && d.type !== "future") d.maturity = p.maturity;
    if(pct(p)){ d.priceBasis = "percent"; d.price = p.price ?? null; d.costPrice = p.cost_price ?? null; }
    if(p.accrued_interest != null){ d.accruedRef = p.accrued_interest; d.refCcy = ccy(p.currency) || d.ccy; }
    if(d.type === "option" && !d.occ){ d.right = p.option_right === "call" ? "C" : p.option_right === "put" ? "P" : null; d.strike = p.strike ?? null;
      d.underlying = p.underlying || null; d.multiplier = p.contract_multiplier ?? null; }
    // Поля, которых нет в строке выписки: показываем с пометкой, по ним не строим котировку.
    const unconfirmed = [v.date === "unknown" && "maturity", v.strike === "unknown" && "strike", v.under === "unknown" && "underlying"].filter(Boolean);
    if(unconfirmed.length) d.unconfirmed = unconfirmed;
    if(v.ccy === "guess"){ d.ccyGuessed = true; }
  });
  doc.positions.forEach(d => { if(d.name === ACCRUED && !d.symbol && d.type === "bond") d.accruedLine = true; });
  const guessed = doc.positions.filter(d => d.ccyGuessed).length;
  if(guessed) doc.ccyGuessed = guessed;
  doc.fromAi = true;
  if(prep.accountIds) Object.defineProperty(doc, "accountIds", {value: prep.accountIds, enumerable: false, configurable: true});
  // Что именно не подтвердилось — по бумагам и полям: человек видит конкретную цифру, а не общий совет «сверьте».
  const FIELD = {market_value: t("стоимость", "value"), quantity: t("количество", "quantity"), price: t("цена", "price"),
    accrued_interest: t("НКД", "accrued interest"), currency: t("валюта", "currency"), row: t("строка бумаги", "the security's row")};
  const issues = [];
  ps.forEach((p, k) => { const v = V.pos[k];
    if(v.doubt.length) issues.push(v.doubt.includes("row") ? t(`${p.name}: бумаги нет в тексте выписки`, `${p.name}: the security is not in the statement text`)
      : t(`${p.name}: ${v.doubt.map(f => FIELD[f]).join(", ")} — не как в строке бумаги в выписке`, `${p.name}: ${v.doubt.map(f => FIELD[f]).join(", ")} — not as in the security's row in the statement`)); });
  const noCost = ps.filter((p, k) => V.pos[k].drop.length).map(p => p.name);
  if(noCost.length) issues.push(t(`себестоимость из ответа ИИ не нашлась в строке бумаги и не показана: ${listShort(noCost)}`,
    `cost from the AI result was not found in the security's row and is not shown: ${listShort(noCost)}`));
  if(V.missed.length) issues.push(t(`в таблице позиций есть строки, которых нет в ответе ИИ: ${listShort(V.missed.map(x => x.label))}`,
    `the positions table has rows missing from the AI result: ${listShort(V.missed.map(x => x.label))}`));
  doc.aiIssues = issues;
  doc.aiDoubt = doubtful.map(p => p.name);
  if(prep.pages) doc.pages = {count: prep.pages.count, unread: prep.pages.unread || [], ocr: []};
  doc.note = [doc.note, aiNote(doc)].filter(Boolean).join(" · ");
  doc.sheetIndex = 0; doc.head = head;
  Object.defineProperty(doc, "sheets", {value: [{name: t("Распознано ИИ", "AI result"), rows, ctx}], enumerable: false});
  return doc;
}

/* Лоток загрузок: что происходит с каждым файлом. Сам прячется, когда всё добавлено без ошибок;
   с ошибкой остаётся, пока его не закроют. */
let trayTimer = null;
function renderTray(show){
  let el = $("#uptray");
  if(!el){
    el = document.createElement("aside");
    el.id = "uptray"; el.className = "uptray no-print"; el.hidden = true;
    el.setAttribute("aria-label", t("Загрузка выписок", "Statement uploads"));
    document.body.appendChild(el);
    el.addEventListener("click", e => {
      const x = e.target.closest("button"); if(!x) return;
      if(x.dataset.tray === "close") closeTray();
      if(x.dataset.tray === "add") $("#file").click();
      if(x.dataset.tray === "toggle"){ Q.trayOpen = !Q.trayOpen; renderTray(); }
      if(x.dataset.retry) retryItem(Q.items.find(i => i.id === +x.dataset.retry));
      if(x.dataset.cancel){ const it = Q.items.find(i => i.id === +x.dataset.cancel);
        if(it && it.abort && !it.abort.signal.aborted){ it.abort.abort(); it.text = t("отменяю…", "cancelling…"); renderTray(); } }
    });
  }
  const items = Q.items;
  if(!items.length){ el.hidden = true; el.innerHTML = ""; return; }
  const active = items.filter(x => ACTIVE.test(x.state)).length, ok = items.filter(x => x.state === "ok" || x.state === "partial").length;
  const bad = items.some(x => x.state === "error" || x.state === "partial");
  const title = active ? t(`Загружаю выписки · ${items.length - active} из ${items.length}`, `Uploading statements · ${items.length - active} of ${items.length}`)
    : ok ? t(`Добавлено ${ok} из ${items.length}`, `Added ${ok} of ${items.length}`) : t("Ничего не добавлено", "Nothing was added");
  // Загрузка закончилась — лоток сворачивается в строку, чтобы не закрывать кнопки отчёта; ошибки видны по счётчику.
  const errs = items.filter(x => x.state === "error").length, warns = items.filter(x => x.state === "partial").length;
  const compact = !active && !Q.trayOpen;
  el.classList.toggle("compact", compact);
  el.innerHTML = `<div class="ut-head"><b>${esc(title)}</b>
      ${!active && errs ? `<span class="ut-count err">${errs} ${WL.pl(errs, ["ошибка", "ошибки", "ошибок"], ["error", "errors"])}</span>` : ""}
      ${!active && warns ? `<span class="ut-count warn">${warns} ${t("с пометкой", "flagged")}</span>` : ""}<span class="spacer"></span>
      ${active ? "" : `<button class="btn small" type="button" data-tray="toggle" aria-expanded="${!compact}">${compact ? t("Подробнее", "Details") : t("Свернуть", "Collapse")}</button>`}
      ${active || compact ? "" : `<button class="btn small" type="button" data-tray="add">${t("Добавить ещё", "Add more")}</button>`}
      <button class="ut-x" type="button" data-tray="close" aria-label="${t("Скрыть", "Hide")}">×</button></div>
    ${active ? `<div class="ut-bar"><i style="width:${Math.round((items.length - active) / items.length * 100)}%"></i></div>` : ""}
    <ul class="ut-list">${items.map(x => `<li class="ut-item ${x.state}">
      <span class="ut-ic" aria-hidden="true"></span>
      <div class="ut-main"><div class="ut-name" title="${esc(x.name)}">${esc(x.name)}</div><div class="ut-text">${esc(x.text)}</div></div>
      ${(x.state === "ai" || (x.state === "reading" && x.ocr)) && x.abort && !x.abort.signal.aborted ? `<button class="btn small" type="button" data-cancel="${x.id}">${t("Отменить", "Cancel")}</button>` : ""}
      ${x.state === "error" && x.retry ? `<button class="btn small" type="button" data-retry="${x.id}">${t("Повторить", "Retry")}</button>` : ""}</li>`).join("")}</ul>`;
  el.classList.toggle("busy", !!active);
  if(show && !Q.hidden) el.hidden = false;
  clearTimeout(trayTimer);
  if(!active && !bad) trayTimer = setTimeout(closeTray, 8000);
}
// «Повторить» у файла, упавшего из-за сбоя страницы: файл читается заново с начала.
function retryItem(it){
  if(!it || it.state !== "error" || !it.retry) return;
  Object.assign(it, {state: "queued", text: t("в очереди", "queued"), retry: false, ready: null, later: null});
  Q.hidden = false; Q.trayOpen = false;
  renderTray(true);
  if(Q.running) readQueued(Q.gen);
  runQueue();
}
function closeTray(){
  const el = $("#uptray"); if(el) el.hidden = true;
  // Пока загрузка идёт, лоток только прячется: готовые строки и ошибки остаются до конца.
  if(Q.items.some(x => ACTIVE.test(x.state))){ Q.hidden = true; return; }
  Q.hidden = false; Q.items = [];
  if(el) el.innerHTML = "";
}
function announce(text){
  const el = liveBox("srStatus", "sr-only");
  el.textContent = "";
  requestAnimationFrame(() => { el.textContent = text; });
}
function setBusy(on){ document.body.classList.toggle("uploading", on); }
const flashes = new Map();   // имя файла → когда карточка начала светиться; выписок в пачке бывает несколько
function flashDoc(fileName){ flashes.set(fileName, Date.now()); keepFlash(); }
function keepFlash(){
  const cards = [...document.querySelectorAll("#brokers .broker")];
  flashes.forEach((at, name) => {
    const gone = Date.now() - at;
    if(gone >= 1600) return flashes.delete(name);
    const card = cards.find(c => c.dataset.file === name);
    if(card){ card.style.animationDelay = `${-gone}ms`; card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
  });
}
function cancelQueue(){
  Q.gen++; Q.running = false; Q.aiOk = false; Q.hidden = false; setBusy(false);
  if(wakeQueue){ wakeQueue(); wakeQueue = null; }
  reading = null;
  Q.items.forEach(x => { if(x.abort) x.abort.abort(); });
  Q.items = [];
  MODALS.slice().reverse().forEach(m => m.dismiss());
  renderTray();
}
// Файл из демо продолжает свой сохранённый отчёт, если он есть, а не затирает его.
function leaveDemo(){
  S.demo = false; S.docs = []; S.rid = null; S.client = DEFAULT_CLIENT; S.P = null;
  load();
  history.replaceState(null, "", HOME);
  $("#app").innerHTML = "";
  if(S.docs.length) refresh(); else renderUpload();
}

/* ── Портфель ─────────────────────────────────────────────────────────── */
let historyTimer = null;
async function loadHistory(attempt = 0){
  const P = S.P; if(!P) return;
  // История цен — только подтверждённых бумаг: график «как шли акции портфеля» не должен рисовать чужую компанию.
  const syms = [...new Set(P.positions.filter(p => WL.eq(p) && p.ccy === "USD").map(p => WL.quoteSymbol(P, p)).filter(Boolean))];
  await WL.fetchHistory(P, [S.bench, ...syms]);   // бенчмарк первым: график нужен даже при частичной истории
  if(P !== S.P) return;
  renderHero(); renderPositions(); renderChart();
  clearTimeout(historyTimer);
  if(Object.values(P.historyStatus || {}).includes("limited") && attempt < 6)
    historyTimer = setTimeout(() => loadHistory(attempt + 1), 90000);
}
/* Отчёт пересобирается после каждой добавленной или убранной выписки. Сразу — с последними известными
   ценами и историей, чтобы итог не прыгал; котировки подтягиваются следом одной волной. Выписка, с которой
   отчёт не собирается (например, сохранённая старой версией), убирается с сообщением, а не ломает страницу. */
let refreshGen = 0, liveTimer = null;
function buildSafe(){
  try{ return WL.build(S.docs, TODAY); }
  catch(e){
    const ok = [];
    S.docs.forEach(d => { try{ WL.build(ok.concat(d), TODAY); ok.push(d); }
      catch(err){ toast(t(`${d.fileName}: выписку не удалось показать, она убрана из отчёта`, `${d.fileName}: this statement could not be shown and was removed from the report`)); } });
    S.docs = ok; save();
    if(!S.docs.length) setAiAllowed(false);
    return WL.build(S.docs, TODAY);
  }
}
function renderNow(){
  refreshGen++;
  if(!S.docs.length){ S.P = null; renderUpload(); return; }
  const prev = S.P;
  S.P = buildSafe();
  if(!S.docs.length){ S.P = null; renderUpload(); return; }
  if(prev){ S.P.history = prev.history || {}; S.P.historyStatus = prev.historyStatus; }
  // Демо живёт на текущих ценах: у вымышленных выписок нет своих цен, и снимок показал бы пустой портфель.
  S.P.basis = S.demo ? "now" : S.basis;
  WL.applyLiveCache(S.P);
  renderApp();
}
// Основание оценки: «оценка сейчас» или «снимок выписок». Запоминается в браузере; в снимке нужны курсы на дату выписки.
function setValuation(b){
  if(!S.P || (b !== "now" && b !== "stmt") || S.basis === b) return;
  S.basis = b; S.P.basis = b;
  try{ localStorage.setItem("wl_basis", b); }catch(e){}
  renderApp();
  if(b === "stmt"){ const P = S.P; WL.fetchFxAt(P).then(() => { if(P === S.P) renderApp(); }); }
  announce(b === "stmt" ? t("Показан снимок выписок", "Showing the statement snapshot") : t("Показана оценка сейчас", "Showing the current valuation"));
}
function liveSoon(ms = 600){
  clearTimeout(liveTimer);
  liveTimer = setTimeout(goLive, ms);
}
async function goLive(){
  const my = ++refreshGen, P = S.P;
  if(!P) return;
  await WL.fetchLive(P);
  if(my !== refreshGen || P !== S.P) return;
  renderApp();
  if(WL.updateMarketHoldings) WL.updateMarketHoldings(P);
  await loadHistory();
}
async function refresh(){
  renderNow();
  if(S.P) await goLive();
}
function renderApp(){
  const P = S.P;
  if(!P) return;
  document.body.classList.remove("on-upload");
  $("#bar").hidden = false;
  if(document.activeElement !== $("#client")) $("#client").value = S.client;
  const allOk = S.docs.every(d => d.checks.every(c => c.ok)), dates = [...new Set(S.docs.map(d => fmt.date(d.asOf)))];
  $("#docChips").innerHTML = S.docs.length > 2
    ? `<span class="pill ${allOk ? "ok" : "bad"}" title="${esc(S.docs.map(d => `${d.brokerShort} · ${fmt.date(d.asOf)}`).join("\n"))}">${S.docs.length} ${WL.pl(S.docs.length, ["выписка", "выписки", "выписок"], ["statement", "statements"])}${dates.length === 1 ? ` · ${dates[0]}` : ""}</span>`
    : S.docs.map(d => `<span class="pill ${d.checks.every(c => c.ok) ? "ok" : "bad"}" title="${esc(d.fileName)}">${esc(d.brokerShort)} · ${fmt.date(d.asOf)}</span>`).join(" ");
  if(!$("#insights")){
    $("#app").innerHTML = `
      <div id="glitchBar"></div>
      <div id="demoBar"></div>
      <div id="qualityBar"></div>
      <div id="idBar"></div>
      <div class="print-head"><h1 id="printTitle"></h1><p class="muted" id="printSub"></p></div>
      <div class="hero"><div class="card broker total" id="total"></div><div class="brokers" id="brokers"></div></div>
      <section><div class="sec-h"><h2>${t("Главное", "Key findings")}</h2><span class="aside">${t("выводы только по тому, что есть в выписках и котировках", "based only on what the statements and quotes show")}</span></div><div class="insights" id="insights"></div></section>
      <section id="paywall" class="no-print" hidden></section>
      <section><div class="sec-h"><h2>${t("Структура портфеля", "Portfolio breakdown")}</h2><span class="aside" id="structAside"></span></div><div class="struct" id="structure"></div></section>
      <section><div class="sec-h"><h2>${t("Сроки", "Upcoming dates")}</h2><span class="aside">${t("экспирации, ролловеры фьючерсов", "expiries, futures rollovers")}</span></div><div class="card tl" id="timeline"></div></section>
      <section><div class="sec-h"><h2>${t("Позиции", "Positions")}</h2><span class="aside" id="posAside"></span></div>
        <div class="toolbar no-print"><div class="seg" id="periods" role="group" aria-label="${t("Период изменения", "Change period")}"></div><div class="seg" id="filters" role="group" aria-label="${t("Тип", "Type")}"></div><div class="seg" id="venues" role="group" aria-label="${t("Брокер", "Broker")}"></div></div>
        <div class="card table-wrap" id="positions"></div></section>
      <section class="print-only" id="printPeriods"></section>
      <section><div class="sec-h"><h2>${t("Акции против бенчмарка", "Stocks vs benchmark")}</h2><span class="spacer"></span>
        <label class="no-print muted">${t("Бенчмарк", "Benchmark")} <select id="bench">${WL.BENCH.map(b => `<option value="${b[0]}">${esc(b[1])}</option>`).join("")}</select></label></div>
        <div class="card chart-card" id="chart"></div></section>
      <section id="market"></section>
      <section><div class="sec-h"><h2>${t("Документы и чего не хватает", "Documents and gaps")}</h2><span class="spacer"></span>
        <button class="btn small no-print" type="button" data-add-file>${t("Добавить выписку", "Add statement")}</button></div><div class="docs"><div class="card doc" id="docs"></div><div class="card miss" id="missing"></div></div></section>
      <section class="print-only" id="printNotes"></section>
      <footer class="app-foot no-print" id="appFoot"></footer>`;
    $("#bench").onchange = async e => { S.bench = e.target.value; $("#chart").innerHTML = `<p class="muted">${t("Загружаю историю…", "Loading price history…")}</p>`; await WL.fetchHistory(S.P, [S.bench]); renderChart(); };
    WL.renderMarket($("#market"), S.P);   // один раз: лента и новости не должны перезагружаться при каждом обновлении цен
  }
  $("#bench").value = S.bench;
  // Сбой одного блока не оставляет страницу без отчёта: остальные блоки показываются, над отчётом — плашка со сбоем.
  // Пейволл при сбое закрывает отчёт, а не открывает его.
  const broken = [renderHero, renderInsights, renderStructure, renderTimeline, renderControls, renderPositions, renderChart, renderDocs,
    renderPaywall, renderDemoBar, renderQuality, renderIdentity, renderFoot].filter(fn => {
    try{ fn(); return false; }
    catch(e){ console.error(e); if(fn === renderPaywall) document.body.classList.toggle("is-locked", PAYWALL && !S.demo); return true; }
  });
  renderGlitch(broken.length > 0);
  setBuyDisabled(checkoutBusy);
  // Открытая карточка позиции показывает свежие данные, а не цены до пересборки.
  if(S.drawerId && $("#drawer").classList.contains("open")){
    if(S.P.positions.some(x => x.id === S.drawerId)) openDrawer(S.drawerId, true); else closeDrawer();
  }
}

// Подвал отчёта. Оплаченный отчёт живёт в этом браузере: номер отчёта и путь восстановления — рядом с поддержкой.
function renderFoot(){
  const el = $("#appFoot"); if(!el) return;
  const paid = PAYWALL && !S.demo && !!S.rid && !locked();
  el.innerHTML = [`WealthLens`, SUPPORT && `${t("Поддержка", "Support")}: ${supportLink()}`,
    ON_SITE && `<a href="${t("/legal/terms/", "/en/legal/terms/")}">${t("Условия", "Terms")}</a>`,
    ON_SITE && `<a href="${t("/legal/privacy/", "/en/legal/privacy/")}">${t("Конфиденциальность", "Privacy")}</a>`,
    window.WL_PIXEL_ID && `<a href="#" data-cookies>${t("Настройки cookies", "Cookie settings")}</a>`].filter(Boolean).join(" · ") +
    (paid ? `<div class="foot-rid">${t(`Номер отчёта <code class="rid">${esc(S.rid)}</code>. Отчёт открыт в этом браузере; на другом устройстве или после очистки данных браузера ${SUPPORT ? `напишите на ${supportLink()}` : "напишите нам"} с почты, указанной при оплате, — пришлём код, чтобы открыть отчёт заново без оплаты.`,
      `Report number <code class="rid">${esc(S.rid)}</code>. The report is unlocked in this browser; for another device or after clearing browser data, ${SUPPORT ? `email ${supportLink()}` : "contact us"} from the address used at checkout and we will send a code to unlock it again at no cost.`)}</div>` : "");
}
/* Основание суммы — одна строка для заголовка, карточек, структуры и PDF. Оценка сейчас честно называет себя смешанной,
   если хоть одна цена или курс уже не из выписки, а часть сумм — ещё из выписок, независимо от доли и знака позиций.
   Рядом — контрольный итог самих выписок (цены выписок, курс ЕЦБ на дату выписки): с ним сверяется банк. */
function valuation(P){
  const stmt = P.basis === "stmt", dates = [...new Set(S.docs.map(d => fmt.date(d.asOf)))].join(", ");
  const priced = P.positions.filter(p => p.type !== "cash" && WL.current(P, p).value != null);
  const live = priced.filter(p => WL.current(P, p).live), fromStmt = priced.length - live.length;
  const foreign = P.positions.filter(p => p.ccy && p.ccy !== "USD" && WL.current(P, p).value != null);
  const missingFx = [...new Set(foreign.filter(p => WL.usd(P, p.ccy, p) == null).map(p => p.ccy))];
  const liveAt = live.length && P.live && P.live.at ? new Date(P.live.at) : null;
  const hhmm = liveAt ? `${pad(liveAt.getHours())}:${pad(liveAt.getMinutes())}` : "";
  const fxNowDate = P.live && P.live.fxDate ? fmt.date(P.live.fxDate) : null;
  const fxStmtDates = [...new Set(foreign.map(p => P.fxAt && P.fxAt[p.asOf] && P.fxAt[p.asOf].date).filter(Boolean))].map(fmt.date).join(", ");
  const n = k => `${k} ${WL.pl(k, ["позиции", "позиций", "позиций"], ["position", "positions"])}`;
  let mode, line;
  if(stmt){
    mode = "stmt";
    // Позиции без стоимости в самой выписке (выгрузка только с количеством) в снимок не входят — так и пишем.
    const noValue = P.positions.filter(p => p.type !== "cash" && !p.accruedLine && p.value == null).length;
    line = t(`Снимок выписок на ${dates}${foreign.length ? ` · валюты по курсу ЕЦБ${fxStmtDates ? ` на ${fxStmtDates}` : ""}` : ""}${noValue ? ` · без стоимости в выписке: ${n(noValue)}` : ""}`,
             `Statement snapshot as of ${dates}${foreign.length ? ` · currencies at ECB rates${fxStmtDates ? ` as of ${fxStmtDates}` : ""}` : ""}${noValue ? ` · no value in the statement: ${n(noValue)}` : ""}`);
  } else if(!live.length && !foreign.length){
    mode = "stmt-only";
    line = t(`По ценам выписок на ${dates}: текущих цен для этих бумаг нет`, `At statement prices as of ${dates}: no current prices for these holdings`);
  } else if(live.length && !fromStmt && !foreign.length){
    mode = "live";
    line = t(`По текущим ценам CBOE${hhmm ? `, получены в ${hhmm}` : ""}`, `At current CBOE prices${hhmm ? `, retrieved at ${hhmm}` : ""}`);
  } else {
    mode = "mixed";
    line = t(`Смешанная оценка: ${live.length ? `текущие цены CBOE для ${n(live.length)}${hhmm ? ` (${hhmm})` : ""}, ` : ""}${fromStmt ? `цены выписок на ${dates} для ${n(fromStmt)}` : ""}${foreign.length ? `${live.length || fromStmt ? "; " : ""}валюты по текущему курсу ЕЦБ${fxNowDate ? ` на ${fxNowDate}` : ""}` : ""}`,
             `Mixed valuation: ${live.length ? `current CBOE prices for ${n(live.length)}${hhmm ? ` (${hhmm})` : ""}, ` : ""}${fromStmt ? `statement prices as of ${dates} for ${n(fromStmt)}` : ""}${foreign.length ? `${live.length || fromStmt ? "; " : ""}currencies at the current ECB rate${fxNowDate ? ` as of ${fxNowDate}` : ""}` : ""}`);
  }
  // Контрольный итог выписок: стоимости из выписок, валюты по курсу ЕЦБ на дату выписки.
  let control = 0, controlGap = [], controlMissing = 0;
  P.positions.forEach(p => { if(p.value == null){ if(p.type !== "cash") controlMissing++; return; }
    if(p.ccy === "USD"){ control += p.value; return; }
    const f = P.fxAt && P.fxAt[p.asOf]; if(f && f.rates[p.ccy]) control += p.value / f.rates[p.ccy]; else controlGap.push(p.ccy); });
  return {mode, line, missingFx, control, controlGap: [...new Set(controlGap)], controlMissing, live: live.length};
}
function renderHero(){
  const P = S.P;
  const byDoc = P.docs.map(d => {
    const ps = P.positions.filter(p => p.source === d.fileName);
    const usd = ps.reduce((a, p) => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy, p); return v != null && k != null ? a + v * k : a; }, 0);
    // Доля в портфеле — от активов (положительных позиций), как в «Структуре»: проданный опцион — обязательство.
    const pos = ps.reduce((a, p) => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy, p); return v != null && k != null && v * k > 0 ? a + v * k : a; }, 0);
    const day = ps.reduce((a, p) => { const c = WL.eq(p) ? WL.change(P, p, "1d") : null; return c ? a + c.abs : a; }, 0);
    const priced = ps.filter(p => p.type !== "cash" && WL.current(P, p).value != null), nLive = priced.filter(p => WL.current(P, p).live).length;
    return {d, ps, usd, pos, day, stale: WL.days(d.asOf, P.today) > 45, nLive, allLive: priced.length > 0 && nLive === priced.length};
  });
  const total = byDoc.reduce((a, x) => a + x.usd, 0), day = byDoc.reduce((a, x) => a + x.day, 0);
  const usdOf = p => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy, p); return v != null && k != null ? v * k : null; };
  const assets = P.positions.reduce((a, p) => a + Math.max(usdOf(p) || 0, 0), 0);
  const pctLabel = v => v < 1 ? "<1%" : Math.round(v) + "%";
  const MIX = [["stock", t("Акции", "Stocks")], ["fund", t("Фонды", "Funds")], ["bond", t("Облигации", "Bonds")],
               ["note", t("Ноты", "Notes")], ["other", t("Прочее", "Other")], ["cash", t("Деньги", "Cash")]];
  const bySum = new Map();
  P.positions.forEach(p => { const v = usdOf(p); if(v > 0) bySum.set(WL.clsKey(p.type), (bySum.get(WL.clsKey(p.type)) || 0) + v); });
  const mix = assets > 0 ? MIX.filter(([k]) => bySum.get(k) > 0).map(([k, label]) => ({k, label, share: bySum.get(k) / assets * 100})) : [];
  // Один класс — не график: полоса из одного куска ничего не сообщает.
  const mixHtml = mix.length < 2 ? "" : `<div class="mix" role="img" aria-label="${esc(t("Состав портфеля: ", "Portfolio mix: ") + mix.map(m => `${m.label} ${pctLabel(m.share)}`).join(", "))}">
      <div class="mix-bar">${mix.map(m => `<i style="flex-grow:${m.share.toFixed(3)};--c:var(--cls-${m.k})" title="${esc(m.label)} · ${pctLabel(m.share)}"></i>`).join("")}</div>
      <ul class="mix-legend" aria-hidden="true">${mix.map(m => `<li><span class="k" style="--c:var(--cls-${m.k})"></span>${esc(m.label)} <b>${pctLabel(m.share)}</b></li>`).join("")}</ul></div>`;
  const V = valuation(P), stmt = P.basis === "stmt";
  // Без связи с сервером данных суммы честно считаются по выпискам, а позиции в других
  // валютах не пересчитать — об этом надо сказать, а не молча выкинуть их из итога.
  const warn = [!stmt && P.live && !P.live.ok && t("Сервер котировок не ответил: суммы по ценам из выписок", "Quote server did not respond: amounts use statement prices"),
    V.missingFx.length && (stmt ? t(`курс ЕЦБ на дату выписки для ${V.missingFx.join(", ")} не загрузился: эти позиции в итог не вошли`, `the ECB rate on the statement date for ${V.missingFx.join(", ")} did not load: those positions are left out of the total`)
      : P.live ? t(`курсы валют не загрузились: позиции в ${V.missingFx.join(", ")} в итог не вошли`, `exchange rates did not load: positions in ${V.missingFx.join(", ")} are left out of the total`) : "")].filter(Boolean);
  const showControl = !S.demo && !stmt && V.mode !== "stmt-only" && Math.abs(V.control - total) >= 1;
  $("#total").innerHTML = `<div class="total-top"><div class="eyebrow">${t("Всего в долларах", "Total in USD")}</div>
      <div class="seg basis no-print" role="group" aria-label="${t("Основание оценки", "Valuation basis")}"${S.demo ? " hidden" : ""}>
        <button type="button" data-basis="now" aria-pressed="${!stmt}">${t("Оценка сейчас", "Value now")}</button>
        <button type="button" data-basis="stmt" aria-pressed="${stmt}">${t("Снимок выписок", "Statement snapshot")}</button></div></div>
    <div class="value">${fmt.money(total, "USD", 0)}</div>
    <div class="sub basis-line ${V.mode}">${esc(V.line)}</div>
    ${showControl ? `<div class="sub muted control">${t("Итог самих выписок", "Statements' own total")}: <b>${fmt.money(V.control, "USD", 0)}</b>${V.controlGap.length ? t(` без позиций в ${V.controlGap.join(", ")}`, ` excluding ${V.controlGap.join(", ")} positions`) : ""}${V.controlMissing ? t(`; у ${V.controlMissing} ${WL.pl(V.controlMissing, ["позиции", "позиций", "позиций"], ["position", "positions"])} стоимости в выписке нет`, `; ${V.controlMissing} ${WL.pl(V.controlMissing, ["", "", ""], ["position has", "positions have"])} no value in the statement`) : ""}</div>` : ""}
    ${!stmt && P.live && day ? `<div class="sub" style="margin-top:6px">${t("За день:", "Day change:")} <b class="${day > 0 ? "up" : "down"}">${fmt.signed(day)}</b> <span class="muted">${t("по акциям, котировки CBOE", "on stocks, CBOE quotes")}</span></div>` : ""}
    ${!stmt && !P.live ? `<div class="sub muted" style="margin-top:6px">${t("Загружаю текущие цены…", "Loading current prices…")}</div>` : ""}
    ${warn.length ? `<div class="sub down" style="margin-top:6px">${esc(warn.join("; "))}.</div>` : ""}
    ${mixHtml}`;
  $("#total").querySelectorAll("[data-basis]").forEach(b => { b.onclick = () => setValuation(b.dataset.basis); });
  $("#brokers").className = `brokers n${byDoc.length}`;
  $("#brokers").innerHTML = byDoc.map(x => {
    // Карточка счёта говорит то же, что «Документы» и плашка над отчётом: сверено, итога нет или есть пропуски.
    const q = x.d.kind === "positions" ? WL.quality(x.d) : {status: x.d.checks.every(c => c.ok) ? "ok" : "partial", issues: x.d.checks.filter(c => !c.ok)};
    const chip = q.status === "partial" ? `<span class="pill bad" title="${esc(q.issues.map(i => typeof i === "string" ? i : i.label).join("; "))}">${t("есть пропуски", "gaps found")}</span>`
      : q.status === "unverified" ? `<span class="pill">${t("итог не сверен", "total not reconciled")}</span>`
      : `<span class="pill ok">${x.d.from === "sheet" ? t("сошлось с итогом файла", "matches file totals") : t("сверено с банком", "matches bank statement")}</span>`;
    // Основание суммы карточки — то же, что у заголовка: снимок, текущие цены или смешанная оценка.
    const basisPill = stmt ? `<span class="pill">${t("снимок выписки", "statement snapshot")}</span>`
      : x.allLive ? `<span class="pill live">${t("цены сейчас", "live prices")}</span>`
      : x.nLive ? `<span class="pill live">${t("смешанная оценка", "mixed valuation")}</span>` : "";
    return `<div class="card broker" data-file="${esc(x.d.fileName)}"><div class="name">${esc(x.d.broker)}
        ${x.d.from === "demo" && q.status !== "partial" ? "" : chip}
        ${x.stale ? `<span class="pill stale">${t(`${WL.days(x.d.asOf, P.today)} дн. назад`, `${WL.days(x.d.asOf, P.today)} days old`)}</span>` : ""}${basisPill}</div>
      <div class="v">${fmt.money(x.usd, "USD", 0)}</div>
      <div class="meta">${x.d.kind === "ledger" ? t(`журнал за ${fmt.date(x.d.periodFrom)}–${fmt.date(x.d.asOf)}`, `transaction log ${fmt.date(x.d.periodFrom)}–${fmt.date(x.d.asOf)}`)
        : t(`${x.d.from === "sheet" ? "выгрузка" : x.d.from === "demo" ? "данные" : "выписка"} на ${fmt.date(x.d.asOf)}`,
            `${x.d.from === "sheet" ? "export" : x.d.from === "demo" ? "data" : "statement"} as of ${fmt.date(x.d.asOf)}`)} ·
        ${x.ps.length} ${WL.pl(x.ps.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}</div>
      ${byDoc.length > 1 && assets > 0 && x.pos > 0 ? `<div class="share" title="${esc(t("доля в активах портфеля (без обязательств)", "share of portfolio assets (excluding liabilities)"))}"><span class="trk"><i style="width:${Math.min(100, Math.max(x.pos / assets * 100, 1)).toFixed(1)}%"></i></span><b>${pctLabel(x.pos / assets * 100)}</b></div>` : ""}</div>`;
  }).join("");
  keepFlash();
  $("#printTitle").textContent = t(`${S.client} — портфель`, `${S.client} — portfolio`);
  $("#printSub").textContent = t(`Отчёт на ${fmt.date(TODAY)} · ${S.docs.map(d => `${d.brokerShort}: ${d.kind === "ledger" ? "журнал до" : "выписка на"} ${fmt.date(d.asOf)}`).join(" · ")}`,
    `Report as of ${fmt.date(TODAY)} · ${S.docs.map(d => `${d.brokerShort}: ${d.kind === "ledger" ? "transaction log to" : "statement as of"} ${fmt.date(d.asOf)}`).join(" · ")}`);
}

/* Структура: куда разложены активы клиента — по брокерам, типам и валютам. Доли — от активов (положительных позиций),
   поэтому один брокер или одна валюта — это 100%. Обязательства (проданные опционы, отрицательные остатки) в доли не
   входят и показываются отдельной строкой со своей суммой: смешивать чистую стоимость и активы в одной доле нельзя.
   Фьючерсы учтены через деньги счёта. */
function renderStructure(){
  const P = S.P, el = $("#structure"); if(!P || !el) return;
  const rows = P.positions.map(p => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy, p); return {p, usd: v != null && k != null ? v * k : null}; })
    .filter(x => x.usd != null);
  const assets = rows.reduce((a, x) => a + Math.max(x.usd, 0), 0), liabilities = rows.reduce((a, x) => a + Math.min(x.usd, 0), 0);
  const group = key => { const m = new Map(); rows.forEach(x => { if(x.usd > 0) m.set(key(x.p), (m.get(key(x.p)) || 0) + x.usd); }); return [...m].sort((a, b) => b[1] - a[1]); };
  // Один ряд — одна сущность, и цвет у типа тот же, что в сводке и в группах таблицы; брокеры и валюты — одним золотом.
  const TYPE = {stock: t("Акции", "Stocks"), fund: t("Фонды", "Funds"), bond: t("Облигации", "Bonds"), note: t("Структурные ноты", "Structured notes"), other: t("Прочее", "Other"),
    option: t("Опционы", "Options"), future: t("Фьючерсы", "Futures"), cash: t("Деньги", "Cash")};
  const row = (name, v, share, color) => `<div class="srow"><div class="sname">${esc(name)}</div><div class="sbar">${share != null ? `<i style="width:${Math.max(share, 0.6).toFixed(1)}%${color ? `;--c:var(--cls-${color})` : ""}"></i>` : ""}</div>` +
    `<div class="sval ${v < 0 ? "down" : ""}">${fmt.short(v)}</div><div class="spct">${share != null ? (share < 1 ? "<1%" : Math.round(share) + "%") : "—"}</div></div>`;
  const debts = rows.filter(x => x.usd < 0);
  const debtRow = debts.length ? `<div class="srow debt"><div class="sname">${t("Обязательства", "Liabilities")}</div><div class="sbar"></div>` +
    `<div class="sval down">${fmt.short(liabilities)}</div><div class="spct" title="${esc(t("в доли активов не входят", "not included in asset shares"))}">—</div></div>` : "";
  const block = (title, items, color) => `<div class="card sblock"><div class="eyebrow">${title}</div>` +
    items.map(([key, v]) => row(color ? TYPE[key] || key : key, v, assets ? v / assets * 100 : null, color ? WL.clsKey(key) : null)).join("") + debtRow + `</div>`;
  el.innerHTML = block(t("По брокерам", "By broker"), group(p => p.brokerShort)) + block(t("По типам", "By type"), group(p => p.type), true) + block(t("По валютам", "By currency"), group(p => p.ccy));
  const V = valuation(P), stale = P.docs.filter(d => WL.days(d.asOf, P.today) > 45);
  const basis = V.mode === "stmt" ? t("снимок выписок", "statement snapshot") : V.mode === "live" ? t("по текущим ценам", "at current prices")
    : V.mode === "mixed" ? t("смешанная оценка", "mixed valuation") : t("по ценам выписок", "at statement prices");
  $("#structAside").textContent = t(`в долларах, ${basis}; доли — от активов ${fmt.short(assets)}${debts.length ? `, обязательства ${fmt.short(liabilities)} — отдельно` : ""}${stale.length ? `; ${stale.map(d => `${d.brokerShort} — на ${fmt.date(d.asOf)}`).join(", ")}` : ""}; фьючерсы учтены через деньги счёта`,
    `in USD, ${basis}; shares of assets ${fmt.short(assets)}${debts.length ? `, liabilities ${fmt.short(liabilities)} shown separately` : ""}${stale.length ? `; ${stale.map(d => `${d.brokerShort} as of ${fmt.date(d.asOf)}`).join(", ")}` : ""}; futures are counted through account cash`);
}

function renderInsights(){
  const I = WL.insights(S.P);
  $("#insights").innerHTML = I.length ? I.map((x, i) => locked() && i > 0 ? lockedInsight(x) : `<article class="card insight ${x.level}">
      <span class="lvl ${x.level}">${LEVEL[x.level]}</span><h3>${esc(x.title)}</h3>
      ${x.text ? `<p>${esc(x.text)}</p>` : ""}
      ${x.lines ? `<ul>${x.lines.map(l => `<li><b>${esc(l.text)}</b><span class="note ${l.level === "high" ? "high" : ""}">${esc(l.note || "")}</span></li>`).join("")}</ul>` : ""}
      <div class="basis">${t("Основа:", "Source:")} ${esc(x.basis)}</div></article>`).join("")
    : `<p class="muted">${t("По загруженным выпискам нет поводов для внимания.", "Nothing in the uploaded statements needs attention.")}</p>`;
}

function renderTimeline(){
  const P = S.P, T = P.today;
  const posById = new Map(P.positions.map(p => [p.id, p]));
  const upcoming = P.events.filter(e => e.date >= T), past = P.events.filter(e => e.date < T);
  const row = e => {
    const p = posById.get(e.posId), d = WL.days(T, e.date);
    let status = "";
    if(d >= 0 && p && p.type === "option" && p.underlyingLive != null && S.P.basis !== "stmt"){
      const itm = p.right === "C" ? p.underlyingLive > p.strike : p.underlyingLive < p.strike;
      status = `<span class="pill ${itm ? "bad" : "ok"}">${itm ? t("в деньгах", "in the money") : t("вне денег", "out of the money")}</span>`;
    }
    if(d < 0) status = `<span class="pill stale">${t("статус неизвестен", "status unknown")}</span>`;
    const kind = e.kind === "roll" ? t("ролловер", "rollover") : t("экспирация", "expiry");
    return `<div class="tl-row ${d < 0 ? "past" : ""}"><span class="tl-date">${fmt.date(e.date)}</span>
      <span class="${d >= 0 && d <= 14 ? "down" : "muted"}">${d >= 0 ? t(`через ${d} ${WL.pl(d, ["день", "дня", "дней"], ["day", "days"])}`, `in ${d} ${WL.pl(d, ["день", "дня", "дней"], ["day", "days"])}`) : t("прошло", "passed")}</span>
      <span>${esc(p ? p.name : "")} <span class="muted">· ${kind} · ${esc(p ? p.brokerShort : "")}</span></span>${status}</div>`;
  };
  const lock = locked(), up = lock ? upcoming.slice(0, 2) : upcoming;
  const rest = upcoming.length - up.length;
  const more = up.length < upcoming.length ? `<div class="tl-row lockline"><span class="muted">${t(`Ещё ${rest} ${WL.pl(rest, ["срок", "срока", "сроков"], ["date", "dates"])} — в полном отчёте`, `${rest} more ${WL.pl(rest, ["срок", "срока", "сроков"], ["date", "dates"])} in the full report`)}</span>
    <button class="btn small" type="button" data-buy="timeline">${t("Открыть", "Unlock")}</button></div>` : "";
  $("#timeline").innerHTML = (up.length ? up.map(row).join("") + more : `<div class="tl-row"><span class="muted">${t("Впереди сроков нет", "No upcoming dates")}</span></div>`) +
    (past.length && !lock ? `<div class="tl-more no-print"><button class="btn small" id="pastBtn" type="button">${S.showPast ? t("Скрыть", "Hide") : t("Показать", "Show")} ${t("прошедшие после даты выписки", "dates passed since the statement date")}: ${past.length}</button></div>` +
      (S.showPast ? past.map(row).join("") : "") : "");
  const b = $("#pastBtn"); if(b) b.onclick = () => { S.showPast = !S.showPast; renderTimeline(); };
}

function renderControls(){
  const lock = locked();
  const types = ["all", ...["stock", "fund", "bond", "note", "other", "option", "future", "cash"]
    .filter(t => S.P.positions.some(p => p.type === t))];
  const brokerList = [...new Set(S.P.positions.map(p => p.brokerShort))];
  // До оплаты видны три строки: фильтры по типу и брокеру открыли бы другие. После добавления или удаления
  // выписки выбранного типа или брокера может не остаться — тогда показываем всё.
  if(lock || !types.includes(S.filter)) S.filter = "all";
  if(lock || (S.broker !== "all" && !brokerList.includes(S.broker))) S.broker = "all";
  const off = x => lock && x !== "all" ? ` disabled title="${t("Фильтры — в полном отчёте", "Filters are in the full report")}"` : "";
  $("#periods").innerHTML = WL.PERIODS.map(p => `<button type="button" data-per="${p.id}" aria-pressed="${S.period === p.id}">${p.label}</button>`).join("");
  $("#filters").innerHTML = types.map(ty => `<button type="button" data-f="${ty}" aria-pressed="${S.filter === ty}"${off(ty)}>${ty === "all" ? t("Все", "All") : TYPE_RU[ty]}</button>`).join("");
  $("#periods").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.period = b.dataset.per; renderControls(); renderPositions(); renderChart(); };
  $("#filters").onclick = e => { const b = e.target.closest("button"); if(!b || b.disabled) return; S.filter = b.dataset.f; renderControls(); renderPositions(); };
  // Портфель по умолчанию общий; разбивка по площадкам — по желанию, поэтому переключатель
  // появляется, только когда брокеров больше одного.
  $("#venues").hidden = brokerList.length < 2;
  $("#venues").innerHTML = ["all", ...brokerList].map(b =>
    `<button type="button" data-b="${esc(b)}" aria-pressed="${S.broker === b}"${off(b)}>${b === "all" ? t("Все площадки", "All venues") : esc(b)}</button>`).join("");
  $("#venues").onclick = e => { const b = e.target.closest("button"); if(!b || b.disabled) return; S.broker = b.dataset.b; renderControls(); renderPositions(); };
}
function renderPositions(){
  S.cap = locked() ? 3 : Infinity;
  WL.renderPositions($("#positions"), S.P, S);
  const L = S.P.live, V = valuation(S.P);
  // Подпись таблицы — то же основание, что у итога: снимок, текущие цены или смешанная оценка.
  $("#posAside").textContent = S.P.basis === "stmt" ? t("снимок выписок: цены выписок, курсы ЕЦБ на дату выписки", "statement snapshot: statement prices, ECB rates on the statement date")
    : !L ? t("цены из выписок", "statement prices") : !L.ok ? t("цены из выписок: сервер котировок не ответил", "statement prices: quote server did not respond")
    : `${V.mode === "mixed" ? t("смешанная оценка: текущие цены CBOE с задержкой там, где бумага сопоставлена с биржей, остальное — из выписок", "mixed valuation: delayed CBOE prices where the holding is matched to a listing, statement prices elsewhere")
        : V.mode === "live" ? t("текущие цены CBOE с задержкой", "delayed CBOE prices") : t("цены из выписок", "statement prices")} · ${L.fxDate ? t(`курсы ЕЦБ на ${fmt.date(L.fxDate)}`, `ECB rates as of ${fmt.date(L.fxDate)}`) : t("курсы валют не загрузились", "exchange rates did not load")}`;
  renderPrintExtras();
}

/* Только для печати. На экране период выбирается переключателем, а в PDF выбора нет,
   поэтому отчёт показывает изменение сразу за все периоды и называет источники. */
const PERIOD_NOTE = {"1d": t("акции: к закрытию прошлого дня", "stocks: vs previous close"), "1m": t("акции: к цене месяц назад", "stocks: vs price a month ago"),
  "3m": t("акции: к цене три месяца назад", "stocks: vs price three months ago"), "1y": t("акции: к цене год назад", "stocks: vs price a year ago"), "5y": t("акции: к цене пять лет назад", "stocks: vs price five years ago"),
  "all": t("акции: к первой цене в истории CBOE", "stocks: vs first price in CBOE history"), "stmt": t("акции и опционы Schwab: к цене в выписке", "Schwab stocks and options: vs statement price"),
  "cost": t("акции и опционы: к себестоимости из выписки", "stocks and options: vs cost basis from the statement")};
function renderPrintExtras(){
  const P = S.P, pe = $("#printPeriods"), pn = $("#printNotes");
  if(!P || !pe || !pn) return;
  const rows = WL.PERIODS.map(per => {
    let abs = 0, covered = 0, countable = 0;
    P.positions.filter(p => p.type !== "cash").forEach(p => {
      countable++;
      const c = WL.change(P, p, per.id), k = WL.usd(P, p.ccy, p);
      if(c && k != null){ covered++; abs += c.abs * k; }
    });
    return {per, abs, covered, countable};
  });
  // В снимке выписок изменений за периоды нет — таблица из одних прочерков в PDF не нужна, об этом сказано в оговорках.
  pe.innerHTML = P.basis === "stmt" ? "" : `<div class="sec-h"><h2>${t("Изменение по периодам", "Change by period")}</h2><span class="aside">${t("текущее количество бумаг, сумма по позициям, где есть данные", "current holdings; total across positions with data")}</span></div>
    <div class="card"><table class="pos"><thead><tr><th class="l">${t("Период", "Period")}</th><th>${t("Изменение", "Change")}</th><th>${t("Есть данные", "Data available")}</th><th class="l">${t("Как считается", "Method")}</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td class="l">${esc(r.per.label)}</td><td><span class="${r.abs > 0 ? "up" : r.abs < 0 ? "down" : ""}">${r.covered ? fmt.signed(r.abs) : "—"}</span></td>` +
      `<td>${t(`${r.covered} из ${r.countable}`, `${r.covered} of ${r.countable}`)}</td><td class="l">${esc(PERIOD_NOTE[r.per.id] || "")}</td></tr>`).join("") + `</tbody></table></div>`;
  const liveAt = P.live && P.live.ok ? new Date(P.live.at) : null;
  const at = !liveAt ? null : EN
    ? `${fmt.date(`${liveAt.getFullYear()}-${pad(liveAt.getMonth() + 1)}-${pad(liveAt.getDate())}`)}, ${pad(liveAt.getHours())}:${pad(liveAt.getMinutes())}`
    : liveAt.toLocaleString("ru-RU", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"});
  const V = valuation(P), stmt = P.basis === "stmt";
  const basisNote = `<li><b>${t("Основание оценки:", "Valuation basis:")}</b> ${esc(V.line)}.${!S.demo && !stmt && Math.abs(V.control - P.positions.reduce((a, p) => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy, p); return v != null && k != null ? a + v * k : a; }, 0)) >= 1
    ? t(` Итог самих выписок: ${fmt.money(V.control, "USD", 0)}.`, ` The statements' own total: ${fmt.money(V.control, "USD", 0)}.`) : ""}${stmt ? "" : " " + t("Текущая цена подставляется только бумагам, сопоставленным с биржей США по ISIN, полному совпадению названия, выписке американского брокера или вашему подтверждению; остальные — по выпискам.",
      "A current price is used only for holdings matched to a US listing by ISIN, an exact name match, a US broker's statement or your confirmation; the rest use statement values.")}</li>`;
  // Оговорки — только о том, что есть в этом отчёте: в снимке нет текущих цен, без деривативов нет правил экспирации,
  // без журнала операций нет оговорки о журнале.
  const foreign = P.positions.some(p => p.ccy && p.ccy !== "USD");
  const pricesNote = stmt
    ? t(`Суммы — по ценам и стоимостям выписок${foreign ? "; валюты — по курсу ЕЦБ на дату выписки" : ""}. Текущие цены, изменения за периоды и сравнение с бенчмарком в снимок не входят.`,
        `Amounts use the statements' prices and values${foreign ? "; currencies are converted at ECB rates as of each statement date" : ""}. Current prices, period changes and the benchmark comparison are not part of the snapshot.`)
    : at ? t(`Текущие цены — CBOE с задержкой около 15 минут, получены ${esc(at)}. ${P.live.fxDate ? `Курсы валют — ЕЦБ на ${fmt.date(P.live.fxDate)}.` : "Курсы валют не загрузились."}`,
             `Current prices: CBOE, delayed by about 15 minutes, retrieved ${esc(at)}. ${P.live.fxDate ? `Exchange rates: ECB as of ${fmt.date(P.live.fxDate)}.` : "Exchange rates did not load."}`)
    : t("Текущие цены не загружались: все суммы — по данным выписок.", "Current prices were not loaded: all amounts are based on the statements.");
  const derivatives = P.positions.some(p => p.type === "option" || p.type === "future");
  const ledgers = [...new Set(S.docs.filter(d => d.kind === "ledger").map(d => d.brokerShort || d.broker).filter(Boolean))];
  const li = x => x ? `<li>${x}</li>` : "";
  pn.innerHTML = `<div class="sec-h"><h2>${t("Источники и оговорки", "Sources and caveats")}</h2></div><div class="card doc"><ul class="notes">${basisNote}` +
    li(t("Позиции, количества, себестоимость и комиссии — из выписок брокеров. Разбор сверен с итогами самих выписок, результаты сверки — в разделе «Документы».",
         "Positions, quantities, cost basis and fees come from the broker statements. Parsed data is reconciled with each statement's own totals; the results are in the “Documents and gaps” section.")) +
    li(pricesNote) +
    li(!stmt && P.positions.some(p => WL.eq(p)) && t("История цен — дневные цены закрытия CBOE без учёта дивидендов. График показывает, как менялся бы текущий состав акций; это не фактическая история счёта: сделки и ввод-вывод денег не учитываются.",
         "Price history: CBOE daily closing prices, excluding dividends. The chart shows how the current stock holdings would have performed; it is not the actual account history, as trades, deposits and withdrawals are not included.")) +
    li(derivatives && t("Даты экспираций опционов и первого дня уведомления по фьючерсам CME рассчитаны по правилам биржи без учёта праздников.",
         "Option expiry dates and first notice days for CME futures are calculated from exchange rules, without adjusting for holidays.")) +
    li(ledgers.length && t(`Данные ${esc(ledgers.join(", "))} — на дату журнала операций. Что открыто на этом счёте сейчас, из журнала не видно.`,
         `${esc(ledgers.join(", "))} data is as of the transaction log date. The log does not show what is currently open on that account.`)) +
    li(t("Рынок: индексы, VIX, доходности казначейских облигаций США и фонды GLD, BNO, IBIT — CBOE с задержкой; курсы валют — ЕЦБ.",
         "Market: indices, VIX, US Treasury yields and the GLD, BNO and IBIT funds are delayed CBOE quotes; exchange rates are from the ECB.")) +
    li(t("Новости рынка — RSS Investing.com, «Ведомости», «Коммерсантъ», CNBC и MarketWatch. Новости по бумагам клиента — Google News за неделю, отобраны по названию компании и биржевому обозначению.",
         "Market news: RSS feeds from Investing.com, Vedomosti, Kommersant, CNBC and MarketWatch. News on the client's holdings: Google News for the past week, matched by company name and ticker.")) +
    li(t("Отчёт носит информационный характер и не является инвестиционной рекомендацией.", "This report is for information only and does not constitute investment advice.")) +
    `</ul></div>`;
}
const renderChart = () => {
  // Сравнение с бенчмарком строится по текущим ценам и истории — к снимку выписок оно не относится: в снимке блок не печатается.
  const sec = $("#chart").closest("section"), stmt = S.P && S.P.basis === "stmt" && !S.demo;
  if(sec) sec.classList.toggle("stmt-off", !!stmt);
  if(stmt){
    $("#chart").innerHTML = `<p class="muted" style="margin:0">${t("Сравнение с бенчмарком считается по текущим ценам и в снимок выписок не входит. Переключитесь на «Оценку сейчас», чтобы его увидеть.",
      "The benchmark comparison uses current prices and is not part of the statement snapshot. Switch to “Current valuation” to see it.")}</p>`;
    return;
  }
  if(locked()){
    $("#chart").innerHTML = `<div class="lockblock"><div class="skel-chart"></div>
      <p>${t("Как акции портфеля шли против S&P 500, Nasdaq, золота и других бенчмарков — в полном отчёте.", "See how the portfolio's stocks performed against the S&P 500, Nasdaq, gold and other benchmarks in the full report.")}</p>
      <button class="btn small" type="button" data-buy="chart">${t(`Открыть за ${PRICE.label}`, `Unlock for ${PRICE.label}`)}</button></div>`;
    return;
  }
  WL.renderChart($("#chart"), S.P, S);
};

// Состояние выписки — та же подпись, что при загрузке, в «Неполном отчёте» и перед оплатой; ниже — что не так и на чём держится доверие.
function docStatus(d){
  if(d.kind !== "positions" || d.from === "demo") return "";
  const q = WL.quality(d), pg = d.pages;
  const extra = q.basis.filter(x => !(d.checks || []).some(c => x.startsWith(c.label)));
  return `<div class="doc-status"><span class="qchip ${q.status}">${esc(WL.qualityLabel(q.status))}</span>${d.fromAi ? `<span class="muted">${t("распознано ИИ", "read by AI")}</span>` : ""}</div>
    ${q.issues.length ? `<ul class="doc-issues">${q.issues.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${q.status === "unverified" && !/сверять сумму не с чем|без курсов выписки|nothing to reconcile|statement's exchange rates/.test(d.note || "") ? `<div class="doc-basis">${esc(unverifiedWhy(d))}</div>` : ""}
    ${extra.length ? `<div class="doc-basis">${extra.map(esc).join(" · ")}</div>` : ""}`;
}
function renderDocs(){
  const P = S.P;
  $("#docs").innerHTML = S.docs.map(d => `<div style="margin-bottom:14px">
      <div class="name" style="font-weight:600">${esc(d.broker)}</div>
      <div class="muted" style="font-size:12.5px">${esc(d.fileName)} · ${d.kind === "ledger"
        ? t(`журнал операций, ${d.records.length} строк, ${d.trades.length} сделок${d.cancelled.length ? `, отменено банком: ${d.cancelled.length}` : ""}`,
            `transaction log, ${d.records.length} ${WL.pl(d.records.length, ["строка", "строки", "строк"], ["row", "rows"])}, ${d.trades.length} ${WL.pl(d.trades.length, ["сделка", "сделки", "сделок"], ["trade", "trades"])}${d.cancelled.length ? `, cancelled by the bank: ${d.cancelled.length}` : ""}`)
        : t(`${d.from === "sheet" ? "выгрузка таблицей" : "снимок"}, позиции на ${fmt.date(d.asOf)}`, `${d.from === "sheet" ? "spreadsheet export" : "snapshot"}, positions as of ${fmt.date(d.asOf)}`)}${d.note ? " · " + esc(d.note) : ""}</div>
      ${docStatus(d)}
      ${d.checks.map(c => `<div class="check"><span>${c.ok ? "✓" : "✗"} ${esc(c.label)}</span><span class="num ${c.ok ? "" : "down"}">${c.count ? t(`${c.parsed} из ${c.stated}`, `${c.parsed} of ${c.stated}`) : `${fmt.money(c.parsed, ccyOf(c))}${c.ok ? "" : " ≠ " + fmt.money(c.stated, ccyOf(c))}`}</span></div>`).join("")}
      <div class="doc-actions no-print">
        ${d.from === "sheet" && S_SHEETS[d.fileName] && S_SHEETS[d.fileName].hash === d.hash ? `<button class="btn small" type="button" data-remap="${esc(d.fileName)}">${t("Сопоставить колонки", "Map columns")}</button>` : ""}
        <button class="btn small ghost" type="button" data-remove="${esc(d.fileName)}">${t("Убрать из отчёта", "Remove from report")}</button>
      </div>
    </div>`).join("") + (aiAllowed() ? `<p class="muted ai-line no-print">${t("Нечитаемые PDF в этом отчёте распознаются ИИ без вопроса.", "Unreadable PDFs in this report are read by AI without asking.")}
      <button class="linkbtn" type="button" data-ai-off>${t("Спрашивать снова", "Ask again")}</button></p>` : "");
  $("#docs").onclick = async e => {
    if(e.target.closest("[data-ai-off]")){ setAiAllowed(false); Q.aiOk = false; renderDocs(); toast(t("Перед распознаванием ИИ снова будем спрашивать", "We will ask before using AI again")); return; }
    const rm = e.target.closest("[data-remove]");
    if(rm) return removeDoc(rm.dataset.remove);
    const b = e.target.closest("[data-remap]"); if(!b) return;
    const key = b.dataset.remap, st = S_SHEETS[key], old = S.docs.find(d => d.fileName === key);
    if(!st || !old || st.hash !== old.hash) return;
    const doc = await openMapper(st.file, st.sheets, st, key);
    if(!doc || !S.docs.includes(old)) return;
    doc.fileName = key; doc.hash = old.hash; if(old.accts) doc.accts = old.accts;
    // Цифры по-прежнему из ответа ИИ: пометка об этом и о суммах, не найденных в выписке, остаётся.
    if(old.fromAi){ doc.fromAi = true; doc.aiDoubt = old.aiDoubt; doc.aiIssues = old.aiIssues; doc.note = [aiNote(doc), doc.note].filter(Boolean).join(" · "); }
    if(old.pages){ doc.pages = old.pages; if(old.pagesConfirmed) doc.pagesConfirmed = old.pagesConfirmed; }
    if(doc.ccyGuessed){ const cs = [...new Set(old.positions.map(p => p.ccy))]; if(cs.length === 1) setCurrency(doc, cs[0]); }
    S.docs = S.docs.map(d => d === old ? doc : d);
    S_SHEETS[key] = {file: st.file, sheets: st.sheets, sheetIndex: doc.sheetIndex, head: doc.head, hash: doc.hash};
    save();
    toast(`${key}: ${doc.positions.length} ${WL.pl(doc.positions.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}`);
    const done = refresh(); focusDocs(); await done;
  };
  const M = WL.missing(P);
  $("#missing").innerHTML = `<div class="sec-h" style="margin:12px 0 4px"><span class="eyebrow">${t("Чего не хватает", "What's missing")}</span><span class="spacer"></span>
      <button class="btn small no-print" id="askBtn" type="button">${t("Скопировать запрос", "Copy request")}</button></div>` +
    M.map(m => `<div class="miss-row"><div class="t">${esc(m.broker)}: ${esc(m.title)}</div>
      <div class="d">${t("Влияет на:", "Affects:")} ${esc(m.affects)}.</div><div class="d muted">${t("Сейчас:", "Currently:")} ${esc(m.now)}.</div></div>`).join("");
  $("#askBtn").onclick = async () => {
    try{ await navigator.clipboard.writeText(WL.requestText(M)); toast(t("Текст запроса скопирован", "Request text copied")); }
    catch(e){ toast(t("Не удалось скопировать — браузер запретил доступ к буферу", "Could not copy: the browser blocked clipboard access")); }
  };
}

const focusDocs = () => { const b = $("#docs") && $("#docs").closest("section").querySelector("[data-add-file]"); if(b) b.focus(); };
// Неверную или лишнюю выписку можно убрать, не начиная отчёт заново: номер отчёта и оплата остаются.
async function removeDoc(fileName){
  const d = S.docs.find(x => x.fileName === fileName); if(!d) return;
  const {choice} = await dialog({
    title: t("Убрать выписку из отчёта?", "Remove this statement from the report?"),
    body: `<ul class="dlg-list"><li><span class="f">${esc(d.fileName)}</span><span class="m">${esc(d.brokerShort || d.broker)} · ${t("на", "as of")} ${fmt.date(d.asOf)}</span></li></ul>
      <p>${t("Позиции этой выписки уйдут из отчёта. Файл можно добавить снова в любой момент.", "Its positions will be removed from the report. You can add the file again at any time.")}</p>`,
    buttons: [{id: "remove", label: t("Убрать", "Remove"), primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}],
    cancel: "cancel",
  });
  if(choice !== "remove" || !S.docs.includes(d)) return;
  S.docs = S.docs.filter(x => x !== d);
  delete S_SHEETS[fileName];
  if(!S.docs.length){ setAiAllowed(false); Q.aiOk = false; AI_CACHE.clear(); }
  save();
  toast(t(`${fileName}: убрана из отчёта`, `${fileName}: removed from the report`));
  if(S.docs.length){ refresh(); focusDocs(); } else { S.P = null; renderUpload(); const b = $("#pick"); if(b) b.focus(); }
}

/* ── Ручное сопоставление колонок ──────────────────────────────────────── */
/* Нужно, когда заголовки в выгрузке названы по-своему. Инструмент честно говорит, что
   не понял файл, и даёт разметить таблицу руками: это лучше, чем угадать и посчитать не
   то. Панель показывает начало файла, выбор строки заголовков и то, что получится. */
const S_SHEETS = {};        // строки принесённых таблиц: только в памяти сессии
function openMapper(file, sheets, pre, shownName){ return new Promise(resolve => {
  let si = pre && pre.sheetIndex != null ? pre.sheetIndex : 0;
  // Если разметить сами не смогли, подсвечиваем самую заполненную из первых строк:
  // заголовки почти всегда именно она, а не титул отчёта сверху.
  const guessRow = rows => {
    let best = 0, n = -1;
    rows.slice(0, 10).forEach((r, i) => { const c = r.filter(x => String(x ?? "").trim()).length; if(c > n){ n = c; best = i; } });
    return best;
  };
  const autoHead = i => WL.sheetFind(sheets[i].rows) ||
    (r => ({row: r, map: WL.sheetMap(sheets[i].rows[r] || [])}))(guessRow(sheets[i].rows));
  let head = pre && pre.head ? {row: pre.head.row, map: {...pre.head.map}} : autoHead(si);
  const wrap = document.createElement("div");
  wrap.className = "modal no-print";
  wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true"); wrap.setAttribute("aria-label", t("Сопоставьте колонки", "Map columns"));
  document.body.appendChild(wrap);
  let done = false;
  const close = doc => { if(done) return; done = true; unmodal(); resolve(doc || null); };
  const unmodal = pushModal(wrap, () => close(null));

  function render(){
    const a = document.activeElement, keep = a && wrap.contains(a) ? (a.dataset.f ? `[data-f="${a.dataset.f}"]` : a.dataset.row != null ? `[data-row="${a.dataset.row}"]`
      : a.dataset.x ? `[data-x="${a.dataset.x}"]` : a.dataset.sheet != null ? `[data-sheet="${a.dataset.sheet}"]` : null) : null;
    draw();
    const back = keep && wrap.querySelector(keep);
    (back || wrap.querySelector("select, button")).focus();
  }
  function draw(){
    const rows = sheets[si].rows;
    const width = Math.max(1, ...rows.slice(0, 60).map(r => r.length));
    const colLabel = c => { const h = String((rows[head.row] || [])[c] ?? "").replace(/\s+/g, " ").trim();
      return h ? h.slice(0, 30) : t(`Колонка ${c + 1}`, `Column ${c + 1}`); };
    const ready = (head.map.name != null || head.map.ticker != null) && (head.map.qty != null || head.map.value != null);
    let preview = "", status, count = 0;
    if(ready){
      try{
        const d = WL.sheetDoc(rows, head, file, sheets[si].ctx);
        const bad = d.checks.filter(c => !c.ok).length;
        count = d.positions.length;
        status = !count ? t("в этой таблице позиций не нашлось — выберите другую таблицу выше или другие колонки",
                            "no positions in this table — pick another table above or other columns")
          : `${d.positions.length} ${WL.pl(d.positions.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}` +
          (d.checks.length > 1 ? (bad ? t(" · с итогом файла не сходится", " · does not match file totals") : t(" · сходится с итогом файла", " · matches file totals")) : "") +
          (looksLikeOps({sheets, sheetIndex: si, head}) ? t(" · похоже на выписку операций: нужны позиции, а не движение денег", " · looks like a transaction list: positions are needed, not cash movements") : "") +
          (d.note ? " · " + d.note : "");
        preview = d.positions.slice(0, 5).map(p => `<tr><td>${esc(p.name)}</td><td>${esc(TYPE_RU[p.type] || p.type)}</td>` +
          `<td>${esc(p.symbol || "")}</td><td>${p.qty != null ? fmt.qty(p.qty) : ""}</td>` +
          `<td>${p.value != null ? fmt.money(p.value, p.ccy, 0) : ""}</td><td>${esc(p.brokerShort)}</td></tr>`).join("");
      }catch(e){ status = t("с этим сопоставлением файл не разбирается", "the file cannot be parsed with this mapping"); }
    } else status = t("укажите наименование или тикер и количество или стоимость", "choose a name or ticker, and a quantity or value");

    wrap.innerHTML = `<div class="card mapper">
      <div class="sec-h"><h2>${t("Сопоставьте колонки", "Map columns")}</h2><span class="aside">${esc(shownName || file.name)}</span>
        <span class="spacer"></span><button class="btn small" data-x="close" type="button">${t("Закрыть", "Close")}</button></div>
      ${sheets.length > 1 ? `<div class="seg" style="margin-bottom:10px">${sheets.map((sh, i) =>
        `<button type="button" data-sheet="${i}" aria-pressed="${i === si}">${esc(sh.name)}</button>`).join("")}</div>` : ""}
      <p class="muted" style="margin:0 0 8px">${t("Нажмите строку с заголовками — всё, что ниже, считается данными.", "Click the header row. Everything below it is treated as data.")}</p>
      <div class="table-wrap"><table class="prev" role="radiogroup" aria-label="${t("Строка заголовков", "Header row")}">${rows.slice(0, 8).map((r, i) =>
        `<tr class="hdr${i === head.row ? " on" : ""}" data-row="${i}" tabindex="0" role="radio" aria-checked="${i === head.row}" aria-label="${t(`Строка ${i + 1} — заголовки`, `Row ${i + 1} as headers`)}">${Array.from({length: width},
          (_, c) => `<td>${esc(String(r[c] ?? "").slice(0, 22))}</td>`).join("")}</tr>`).join("")}</table></div>
      <div class="map-grid">${WL.sheetFields.map(([f, label]) => `<label>${label}
        <select data-f="${f}"><option value="">${t("— нет —", "— none —")}</option>${Array.from({length: width}, (_, c) =>
          `<option value="${c}"${head.map[f] === c ? " selected" : ""}>${esc(colLabel(c))}</option>`).join("")}</select></label>`).join("")}</div>
      <div class="sec-h actions"><b>${t("Получится", "Result")}</b><span class="aside">${esc(status)}</span><span class="spacer"></span>
        <button class="btn small" data-x="auto" type="button">${t("Подобрать заново", "Auto-detect again")}</button>
        <button class="btn primary small" data-x="ok" type="button"${ready && count ? "" : " disabled"}>${t("Импортировать", "Import")}</button></div>
      ${preview ? `<div class="table-wrap" style="margin-top:8px"><table class="prev"><tr><th>${t("Бумага", "Security")}</th><th>${t("Тип", "Type")}</th><th>${t("Тикер", "Ticker")}</th><th>${t("Кол-во", "Qty")}</th><th>${t("Стоимость", "Value")}</th><th>${t("Брокер", "Broker")}</th></tr>${preview}</table></div>` : ""}
    </div>`;
  }

  wrap.addEventListener("change", e => {
    const sel = e.target.closest("select[data-f]"); if(!sel) return;
    const f = sel.dataset.f, v = sel.value;
    // Одна колонка достаётся одному полю: иначе количество и стоимость смотрят в одно место.
    if(v !== "") Object.keys(head.map).forEach(k => { if(k !== f && head.map[k] === +v) delete head.map[k]; });
    if(v === "") delete head.map[f]; else head.map[f] = +v;
    render();
  });
  wrap.addEventListener("keydown", e => {
    const tr = e.target.closest && e.target.closest("tr.hdr");
    if(tr && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); tr.click(); }
  });
  wrap.addEventListener("click", e => {
    if(e.target === wrap) return close(null);
    const tr = e.target.closest("tr.hdr");
    if(tr){ head = {row: +tr.dataset.row, map: WL.sheetMap(sheets[si].rows[+tr.dataset.row] || [])}; return render(); }
    const b = e.target.closest("button"); if(!b) return;
    if(b.dataset.sheet != null){
      si = +b.dataset.sheet;
      head = autoHead(si);
      return render();
    }
    if(b.dataset.x === "auto"){ head = {row: head.row, map: WL.sheetMap(sheets[si].rows[head.row] || [])}; return render(); }
    if(b.dataset.x === "close") return close(null);
    if(b.dataset.x === "ok"){
      const doc = WL.sheetDoc(sheets[si].rows, head, file, sheets[si].ctx);
      if(!doc.positions.length){ toast(t("Позиций не нашлось — выберите другую таблицу или колонки", "No positions found — pick another table or columns")); return; }
      doc.sheetIndex = si; doc.head = {row: head.row, map: {...head.map}};
      doc.note = [doc.note, pre && pre.pdf ? t("таблица взята из PDF, колонки проверены", "table read from PDF, columns reviewed")
        : t("колонки размечены вручную", "columns mapped manually")].filter(Boolean).join(" · ");
      Object.defineProperty(doc, "sheets", {value: sheets, enumerable: false});
      close(doc);
    }
  });
  render();
}); }

/* ── Детали позиции ───────────────────────────────────────────────────── */
function openDrawer(id, quiet){
  const P = S.P, p = P && P.positions.find(x => x.id === id); if(!p) return;
  const hadFocus = $("#drawer").contains(document.activeElement);
  S.drawerId = id;
  const cur = WL.current(P, p), k = WL.usd(P, p.ccy, p);
  const kv = [];
  const add = (label, v) => { if(v != null && v !== "") kv.push(`<dt>${label}</dt><dd>${v}</dd>`); };
  const NOT_IN = t("нет в выписке", "not in statement");
  add(t("Брокер", "Broker"), esc(p.broker));
  const contracts = p.type === "option" || p.type === "future";
  if(p.type !== "cash" && p.qty != null) add(t("Количество", "Quantity"), fmt.qty(p.qty) + (contracts ? t(" контр.", " " + WL.pl(p.qty, ["", "", ""], ["contract", "contracts"])) : ""));
  const pctBasis = p.priceBasis === "percent";
  if(!contracts && p.type !== "cash" && !p.accruedLine) add(t("Цена покупки", "Purchase price"), p.cost != null && p.qty
    ? (pctBasis ? t(`${fmt.px(p.costPrice ?? p.cost / p.qty * 100)}% номинала (себестоимость ${fmt.money(p.cost, p.refCcy || p.ccy)})`, `${fmt.px(p.costPrice ?? p.cost / p.qty * 100)}% of nominal (cost basis ${fmt.money(p.cost, p.refCcy || p.ccy)})`)
      : t(`${fmt.px(p.cost / p.qty)} (средняя из себестоимости ${fmt.money(p.cost)})`, `${fmt.px(p.cost / p.qty)} (average from cost basis ${fmt.money(p.cost)})`))
    : `<span class="unk">${esc(p.costNote || NOT_IN)}</span>`);
  if(p.premium != null) add(t("Премия всего", "Total premium"), fmt.money(p.premium, p.ccy));
  add(t("Дата покупки", "Purchase date"), p.purchaseDate ? fmt.date(p.purchaseDate) + (p.purchaseNote ? ` <span class="muted">(${esc(p.purchaseNote)})</span>` : "") : p.type === "cash" ? null : `<span class="unk">${NOT_IN}</span>`);
  if(p.type !== "cash") add(t("Комиссии", "Fees"), p.commission != null ? fmt.money(p.commission, p.ccy) : `<span class="unk">${NOT_IN}</span>`);
  if(p.price != null) add(t(`Цена на ${fmt.date(p.priceDate)}`, `Price as of ${fmt.date(p.priceDate)}`), fmt.px(p.price) + (pctBasis ? t("% номинала", "% of nominal") : ""));
  if(cur.live) add(t("Цена сейчас", "Live price"), `${fmt.px(cur.price)}${p.live.bid != null ? ` <span class="muted">(bid ${fmt.px(p.live.bid)} / ask ${fmt.px(p.live.ask)})</span>` : ""}`);
  if(p.underlyingLive != null) add(t(`${esc(p.underlying)} сейчас`, `${esc(p.underlying)} now`), fmt.px(p.underlyingLive));
  add(t("Стоимость", "Value"), cur.value != null ? fmt.money(cur.value, p.ccy) : `<span class="unk">${esc(p.valueNote || NOT_IN)}</span>`);
  if(cur.value != null && k != null && p.ccy !== "USD") add(t("В долларах", "In USD"), fmt.money(cur.value * k));
  if(p.notional != null) add(t("Номинал", "Notional"), fmt.money(p.notional, p.ccy, 0));
  if(p.type === "option" && p.qty < 0 && p.multiplier) add(p.right === "P" ? t("Обязательство купить", "Obligation to buy") : t("Обязательство продать", "Obligation to sell"), fmt.money(Math.abs(p.qty) * p.multiplier * p.strike, p.ccy, 0));
  if(p.firstNotice) add(t("Первый день уведомления", "First notice day"), fmt.date(p.firstNotice) + t(" <span class='muted'>— переложить до</span>", " <span class='muted'>— roll before</span>"));
  if(p.deliverable) add(t("Поставка по контракту", "Contract deliverable"), `${esc(p.deliverable)} <span class="muted">${t("— скорректированный контракт", "— adjusted contract")}</span>`);
  const unconf = f => (p.unconfirmed || []).includes(f) ? ` <span class="unk">${t("не подтверждено текстом выписки", "not confirmed by the statement text")}</span>` : "";
  if(p.maturity) add(t("Погашение", "Maturity"), fmt.date(p.maturity) + unconf("maturity"));
  if(p.coupon != null) add(t("Купон", "Coupon"), `${fmt.dec(p.coupon, 3).replace(/[,.]?0+$/, "")}%`);
  if(p.accruedRef != null) add(t("Накопленный купонный доход", "Accrued interest"), fmt.money(p.accruedRef, p.refCcy || p.ccy));
  if(p.isin) add("ISIN", esc(p.isin));
  // Какая бумага стоит за тикером и почему ей подставлена (или нет) текущая цена.
  const idn = (WL.eq(p) || p.type === "option") && p.ccy === "USD" ? WL.idOf(P, p) : null;
  if(idn && idn.how !== "none"){
    const mk = idn.market ? `${esc(idn.market.name)}${idn.market.ticker ? ` · ${esc(idn.market.ticker)}` : ""}` : "";
    add(t("Бумага на бирже", "Exchange listing"), ({
      source: t("тикер биржи США из выписки брокера", "US exchange ticker from the broker's statement"),
      isin: t(`${mk} — сопоставлено по ISIN`, `${mk} — matched by ISIN`),
      name: t(`${mk} — совпало название`, `${mk} — the name matches`),
      user: t(`${mk} — подтверждено вами`, `${mk} — confirmed by you`),
      underlying: t("базовый актив сопоставлен в отчёте", "the underlying is matched in this report"),
      mismatch: `<span class="unk">${idn.market ? t(`под тикером на бирже — ${mk}; не подтверждено, цена из выписки`, `listed under this ticker: ${mk}; not confirmed, statement price used`)
        : t("под тикером на биржах США бумага не найдена — цена из выписки", "no US listing under this ticker — statement price used")}${idn.isinMarket
        ? t(`; ISIN указывает на другую бумагу: ${esc(idn.isinMarket.name)} · ${esc(idn.isinMarket.ticker)}`, `; the ISIN points to a different listing: ${esc(idn.isinMarket.name)} · ${esc(idn.isinMarket.ticker)}`) : ""}</span>`,
      notfound: `<span class="unk">${t("на биржах США не найдена — цена из выписки", "not found on US exchanges — statement price used")}</span>`,
      pending: `<span class="unk">${t("сопоставляю с биржей…", "matching to exchange listings…")}</span>`,
      error: `<span class="unk">${t("справочник бумаг не ответил — цена из выписки", "the securities reference did not respond — statement price used")}</span>`,
    })[idn.how]);
  }
  if(p.purchaseNote) add(t("Последняя покупка", "Last purchase"), esc(p.purchaseNote));
  if(p.expiry) add(p.type === "future" ? t("Последний торговый день", "Last trading day") : t("Экспирация", "Expiry"), fmt.date(p.expiry) + (p.type === "option" ? unconf("maturity") : ""));
  if(p.type === "option" && !p.occ && p.strike != null) add(t("Страйк", "Strike"), fmt.px(p.strike) + unconf("strike"));
  if(p.unrealized != null) add(t(`Результат к покупке на ${fmt.date(p.priceDate)}`, `Unrealized gain/loss as of ${fmt.date(p.priceDate)}`), fmt.money(p.unrealized));
  const changes = p.type === "cash" ? "" : `<h4 style="margin:18px 0 6px">${t("Изменение за периоды", "Change by period")}</h4><table class="mini">` +
    WL.PERIODS.map(per => { const c = WL.change(P, p, per.id); return `<tr><td class="l">${per.label}</td><td class="${c && c.abs > 0 ? "up" : c && c.abs < 0 ? "down" : ""}">${c ? fmt.signed(c.abs, p.ccy) : `<span class='unk'>${t("нет данных", "no data")}</span>`}</td><td>${c && c.pct != null ? fmt.pct(c.pct) : ""}</td></tr>`; }).join("") + `</table>`;
  const trades = p.trades && p.trades.length ? `<h4 style="margin:18px 0 6px">${t("Сделки из журнала:", "Trades in the transaction log:")} ${p.trades.length}</h4><table class="mini"><tr><th class="l">${t("Дата", "Date")}</th><th class="l">${t("Операция", "Action")}</th><th>${t("Кол-во", "Qty")}</th><th>${t("Премия", "Premium")}</th><th>${t("Комиссия", "Fees")}</th><th>${t("Сбор", "Exchange fees")}</th></tr>` +
    p.trades.map(tr => `<tr><td class="l">${fmt.date(tr.date)}</td><td class="l">${tr.assigned ? t("исполнение", "assignment") : tr.side === "Buy" ? t("покупка", "buy") : t("продажа", "sell")}</td><td>${tr.qty}</td><td>${tr.premium ? fmt.money(tr.premium, tr.ccy) : ""}</td><td>${fmt.money(tr.commission, tr.ccy)}</td><td>${fmt.money(tr.exchFees, tr.ccy)}</td></tr>`).join("") + `</table>` : "";
  $("#drawer").innerHTML = `<button class="btn small" id="closeDrawer" type="button" style="float:right">${t("Закрыть", "Close")}</button>
    <div class="eyebrow">${esc(TYPE_RU[p.type])} · ${esc(p.brokerShort)}</div><h3>${esc(p.name)}</h3>
    <div class="code">${esc(p.occ || p.code || p.symbol || "")}</div>
    <dl class="kv">${kv.join("")}</dl>${changes}${trades}
    <p class="basis">${t("Источник:", "Source:")} ${esc(p.source)}${p.page ? t(` · стр. ${p.page}`, ` · p. ${p.page}`) : ""}${cur.live ? t(" · текущие цены CBOE с задержкой", " · delayed CBOE prices") : ""}</p>`;
  $("#drawer").classList.add("open"); $("#scrim").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false");
  $("#closeDrawer").onclick = closeDrawer; if(!quiet || hadFocus) $("#closeDrawer").focus();
}
function closeDrawer(){ S.drawerId = null; $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); }

/* ── Подписи из разметки: по-русски они уже в wealth.html ───────────────── */
if(EN){
  $("#client").defaultValue = $("#client").value = DEFAULT_CLIENT;
  $("#client").setAttribute("aria-label", "Client name");
  $("#addBtn").textContent = "Add statement";
  $("#resetBtn").textContent = "New report";
  $("#printBtn").textContent = "PDF report";
  $("#langBtn").textContent = "RU"; $("#langBtn").lang = "ru";
  $("#langBtn").title = "Русский"; $("#langBtn").setAttribute("aria-label", "Русский");
  $(".print-lock").textContent = "The full PDF report is available after payment at wealth.euroaff.eu";
  $("#drawer").setAttribute("aria-label", "Position details");
}

/* ── События ──────────────────────────────────────────────────────────── */
$("#file").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
$("#langBtn").onclick = () => { location.href = langUrl(EN ? "ru" : "en"); };
$("#addBtn").onclick = () => $("#file").click();
document.addEventListener("click", e => { if(e.target.closest && e.target.closest("[data-add-file]")) $("#file").click(); });
$("#printBtn").onclick = () => locked() ? openCheckout("pdf") : window.print();
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-buy]");
  if(b && !b.disabled){ e.preventDefault(); openCheckout(b.dataset.buy); }
});
// В PDF пояснения к плашкам раскрыты: закрытое <details> не печатается.
window.addEventListener("beforeprint", () => { if(locked()) track("PrintBlocked", {}); document.querySelectorAll("details.q-more:not([open])").forEach(d => { d.open = true; d.dataset.printOpened = "1"; }); });
window.addEventListener("afterprint", () => { document.querySelectorAll("details.q-more[data-print-opened]").forEach(d => { d.open = false; delete d.dataset.printOpened; }); });
$("#resetBtn").onclick = () => {
  if(S.demo){ location.href = HOME; return; }
  const paid = !!(S.rid && unlocks()[S.rid]);
  const msg = (Q.running ? t("Загрузка ещё идёт — она остановится. ", "An upload is still running — it will stop. ") : "") +
    t("Убрать выписки этого клиента с этого компьютера и начать новый отчёт?", "Remove this client's statements from this computer and start a new report?") +
    (paid ? t(" Оплата за этот отчёт к новому не перейдёт; чтобы поправить этот отчёт, уберите лишнюю выписку в «Документах».",
              " Payment for this report does not carry over; to fix this report, remove the wrong statement under “Documents”.") : "");
  if(!confirm(msg)) return;
  cancelQueue(); closeDrawer();
  refreshGen++; clearTimeout(liveTimer);
  S.docs = []; S.P = null; S.rid = null; S.client = DEFAULT_CLIENT; S.filter = "all"; S.broker = "all";
  Object.keys(S_SHEETS).forEach(k => delete S_SHEETS[k]);
  AI_CACHE.clear();
  try{ localStorage.removeItem(STORE); }catch(e){}
  remember(null); conflict = false; conflictWarned = false;
  renderUpload();
};
let nameTimer = null;
$("#client").oninput = e => { S.client = e.target.value.trim() || DEFAULT_CLIENT; renderHero(); clearTimeout(nameTimer); nameTimer = setTimeout(save, 400); };
$("#scrim").onclick = closeDrawer;
document.addEventListener("keydown", e => {
  if(e.key === "Escape") closeDrawer();
  if(e.key === "Enter" && e.target.matches && e.target.matches("tr.row")) openDrawer(e.target.dataset.id);
});
document.addEventListener("click", e => { const r = e.target.closest && e.target.closest("tr.row"); if(r) openDrawer(r.dataset.id); });
/* Файлы можно бросить на любую часть страницы: на экране загрузки подсвечивается рамка, на отчёте — подсказка
   поверх страницы. Во время загрузки новые файлы встают в очередь. */
document.body.dataset.drop = t("Отпустите — добавим выписки в отчёт", "Drop to add the statements to the report");
const hasFiles = e => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files"));
let dragDepth = 0;
const dragOff = () => { dragDepth = 0; document.body.classList.remove("dragging"); const d = $("#drop"); if(d) d.classList.remove("over"); };
window.addEventListener("dragenter", e => { if(!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); const d = $("#drop"); if(d) d.classList.add("over"); });
let dragTimer = null;
window.addEventListener("dragover", e => { if(!hasFiles(e)) return; e.preventDefault(); clearTimeout(dragTimer); dragTimer = setTimeout(dragOff, 1000); });
window.addEventListener("blur", () => dragOff());
window.addEventListener("dragleave", e => { if(hasFiles(e) && --dragDepth <= 0) dragOff(); });
window.addEventListener("drop", e => { if(!hasFiles(e)) return; e.preventDefault(); dragOff(); if(e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

// Пока выписки читаются или ждут решения, уход со страницы их потеряет — браузер переспросит.
let leaving = false;
window.addEventListener("beforeunload", e => { if(!leaving && Q.items.some(x => ACTIVE.test(x.state))){ e.preventDefault(); e.returnValue = ""; } });
// Со страницы оплаты вернулись кнопкой «Назад»: браузер восстановил вкладку как была, с заблокированными кнопками оплаты.
window.addEventListener("pageshow", e => { if(!e.persisted) return; leaving = false; checkoutBusy = false; setBuyDisabled(false); if(S.P) renderApp(); });
// Тот же отчёт открыт в другой вкладке и там его поменяли: показываем актуальное, а не перезаписываем чужие изменения.
window.addEventListener("storage", e => {
  if(S.demo) return;
  if(e.key === UNLOCKS){
    // Оплатили в другой вкладке: подпись проверяем здесь сами, а запись без действующей подписи — через сервер.
    primeGrant().then(() => { const u = unlockOf(S.rid); return u && !confirmedAccess(u) ? checkUnlock() : null; }).then(() => { if(S.P) renderApp(); });
    return;
  }
  if(e.key !== STORE) return;
  if(Q.running || MODALS.length){ toast(t("Отчёт изменили в другой вкладке. Обновите страницу, когда закончите здесь.", "The report was changed in another tab. Reload the page when you are done here.")); return; }
  S.docs = []; S.rid = null; S.client = DEFAULT_CLIENT; Q.aiOk = false;
  Object.keys(S_SHEETS).forEach(k => delete S_SHEETS[k]);
  load();
  if(S.docs.length) refresh(); else { S.P = null; renderUpload(); }
});

liveBox("toasts", "toasts no-print"); liveBox("srStatus", "sr-only");
WL.app = {addFiles, state: S, locked, openCheckout, queue: Q, modals: MODALS};
(async function boot(){
  capturePromo();
  if(missingModules().length) return renderBroken(missingModules());
  if(new URLSearchParams(location.search).has("demo") && WL.demoDocs){
    S.demo = true; S.client = t("Демо-клиент", "Demo client"); S.docs = WL.demoDocs(WL.lang);
    track("ViewContent", {content_name: "demo_report"});
    return refresh();
  }
  load();
  // Отчёт без выписок выглядит как новый: разрешение на ИИ без вопроса, оставшееся от неудачной попытки, не действует.
  if(S.rid && !S.docs.length) setAiAllowed(false);
  await handlePaymentReturn();
  if(!S.docs.length) return renderUpload();
  // Разрешение на доступ проверяется до первой отрисовки: оплаченный отчёт не мигает пейволлом.
  await primeGrant();
  await recoverPendingPayment();
  // Сервер проверяется при каждом открытии. Записи без действующей подписи нужен его ответ — ждём его недолго перед отрисовкой.
  const check = checkUnlock(), rec = unlockOf(S.rid);
  if(rec && !confirmedAccess(rec)) await Promise.race([check, new Promise(ok => setTimeout(ok, 2500))]);
  if(locked()) track("ViewContent", {content_name: "report_preview", value: PRICE.amount, currency: PRICE.currency});
  return refresh();
})();
})();
