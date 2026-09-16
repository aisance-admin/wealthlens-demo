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
  rid: null, demo: false};

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
const PAYWALL = ON_SITE || new URLSearchParams(location.search).has("paywall");
const PAY_API = "https://api.euroaff.eu";
const PRICE = {amount: 49, currency: "EUR", label: "€49"};
const UNLOCKS = "wl_unlock_v1", PENDING = "wl_pending_checkout";
const newRid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36).padStart(2, "0")).join("");
const unlocks = () => { try{ return JSON.parse(localStorage.getItem(UNLOCKS) || "{}"); }catch(e){ return {}; } };
const locked = () => PAYWALL && !S.demo && !(S.rid && unlocks()[S.rid]);
const track = (name, params) => { if(WL.track) WL.track(name, params); };

const hasPositions = () => !!(S.P && S.P.positions.length);
let checkoutBusy = false;
const setBuyDisabled = on => document.querySelectorAll("[data-buy]").forEach(b => { b.disabled = on; });
async function openCheckout(source){
  // Отчёт без единой позиции продавать нельзя: человек заплатит за пустую страницу.
  if(!hasPositions()){ toast(t("В загруженных файлах не нашлось позиций — оплачивать пока нечего. Загрузите выписку о портфеле.",
    "No positions were found in the uploaded files, so there is nothing to pay for yet. Upload a portfolio statement.")); return; }
  if(Q.running){ toast(t("Дождитесь, пока загрузятся выписки: оплачивается отчёт со всеми файлами.", "Wait until the statements finish uploading: you pay for the report with all its files.")); return; }
  if(checkoutBusy) return;
  // Оплатили в другой вкладке: полный отчёт уже открыт, второй раз платить не нужно.
  const paid = () => { if(locked()) return false; checkoutBusy = false; setBuyDisabled(false); renderApp();
    toast(t("Этот отчёт уже оплачен — полный отчёт открыт", "This report is already paid — the full report is unlocked")); return true; };
  if(paid()) return;
  if(!S.rid) S.rid = newRid();
  // Отчёт, который браузер не сохраняет, после возврата с оплаты не найдётся: деньги спишутся, а открыть будет нечего.
  if(!save()){ toast(conflict ? t("Сначала обновите страницу: в другой вкладке этот отчёт удалили или начали другой.", "Reload the page first: in another tab this report was deleted or a different one was started.")
    : t("Браузер не сохраняет отчёт, поэтому после оплаты открыть его здесь не получится. Разрешите сайту хранить данные и попробуйте снова.",
        "The browser is not saving the report, so it could not be opened here after payment. Allow this site to store data and try again.")); return; }
  checkoutBusy = true; setBuyDisabled(true);
  // Пока ждём сервер, отчёт могли начать заново, оплатить в другой вкладке, добавить в него файл или убрать последнюю выписку.
  const rid = S.rid, stale = () => {
    if(rid === S.rid && paid()) return true;
    if(rid === S.rid && !Q.running && hasPositions()) return false;
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
      unlockWith(pend.sid, v); checkoutBusy = false;
      toast(t("Этот отчёт уже оплачен — полный отчёт открыт", "This report is already paid — the full report is unlocked"));
      renderApp(); return;
    }
  }
  track("InitiateCheckout", {value: PRICE.amount, currency: PRICE.currency, content_name: "portfolio_report", source});
  const body = Object.assign({}, WL.attribution ? WL.attribution() : {}, {rid, lang: WL.lang, path: location.pathname});
  let r = null;
  try{
    r = await fetch(PAY_API + "/checkout", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)})
      .then(x => x.json());
  }catch(e){}
  if(stale()) return;
  if(r && r.url){
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

function unlockWith(sid, r){
  const m = unlocks(); m[S.rid] = r.token;
  try{ localStorage.setItem(UNLOCKS, JSON.stringify(m)); localStorage.removeItem(PENDING); }catch(e){}
  const seen = "wl_purchase_" + sid.slice(-16);     // событие покупки — один раз на платёж
  try{ if(!localStorage.getItem(seen)){ localStorage.setItem(seen, "1");
    track("Purchase", {value: r.amount || PRICE.amount, currency: r.currency || PRICE.currency, content_name: "portfolio_report"}); } }catch(e){}
}

/* Оплатили, но закрыли вкладку раньше, чем Stripe вернул на сайт: при следующем открытии
   проверяем последнюю начатую оплату этого отчёта, если ей не больше двух суток. */
async function recoverPendingPayment(){
  if(!locked()) return;
  let p = null;
  try{ p = JSON.parse(localStorage.getItem(PENDING) || "null"); }catch(e){}
  if(!p || p.rid !== S.rid || !p.sid || Date.now() - p.at > 2 * 864e5) return;
  let r = null;
  try{ r = await fetch(`${PAY_API}/checkout/verify?session_id=${encodeURIComponent(p.sid)}&rid=${S.rid}`).then(x => x.json()); }catch(e){}
  if(r && r.ok){ unlockWith(p.sid, r); toast(t("Оплата прошла — полный отчёт открыт", "Payment received — full report unlocked")); }
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
    unlockWith(sid, r);
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
  $("#printBtn").textContent = lock && hasPositions() ? t(`Полный отчёт · ${PRICE.label}`, `Full report · ${PRICE.label}`) : t("Отчёт PDF", "PDF report");
  if(!lock){ el.hidden = true; el.innerHTML = ""; return; }
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
    <div class="pw-buy"><div class="pw-price">${PRICE.label}</div><div class="muted pw-note">${t("разово за этот портфель", "one-off, for this portfolio")}</div>
      <button class="btn primary pw-btn" type="button" data-buy="paywall">${t("Открыть полный отчёт", "Unlock full report")}</button>
      <div class="muted pw-note">${t("Оплата через Stripe. Отчёт собирается и хранится в этом браузере, выписки на сервере не хранятся — открывайте отчёт здесь же.",
        "Payment via Stripe. The report is built and kept in this browser, and statements are not stored on a server, so open the report here.")}</div>
      ${ON_SITE ? `<div class="muted pw-note">${t(`Оплачивая, вы принимаете <a href="/legal/terms/">условия</a> и <a href="/legal/refund/">правила возврата</a>.`,
        `By paying, you accept the <a href="/en/legal/terms/">terms</a> and <a href="/en/legal/refund/">refund policy</a>.`)}</div>` : ""}
      <div class="muted pw-note">${t("Выписки можно добавлять и после оплаты — платить снова не нужно.", "You can add statements after paying — no need to pay again.")}</div>
      ${SUPPORT ? `<div class="muted pw-note">${t("Вопрос по оплате:", "Payment question:")} ${supportLink()}</div>` : ""}</div>
  </div>`;
}

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
function renderUpload(){
  closeDrawer();
  $("#bar").hidden = true;
  document.body.classList.add("on-upload");
  $("#app").innerHTML = `<div class="drop" id="drop">
    <div class="drop-mark" aria-hidden="true"></div>
    <div class="eyebrow">${ON_SITE ? `<a class="home" href="${t("/", "/en/")}">WealthLens</a>` : "WealthLens"} · ${INVESTOR ? t("сводный отчёт", "consolidated report") : t("портфель клиента", "client portfolio")}</div>
    <h1>${INVESTOR ? t("Загрузите выписки брокеров", "Upload your broker statements") : t("Загрузите выписки клиента", "Upload client statements")}</h1>
    <p>${t("Можно сразу несколько файлов. PDF Charles Schwab и Swissquote читаются сами; PDF, CSV и Excel других банков — с проверкой колонок перед импортом.",
      "You can add several files at once. Charles Schwab and Swissquote PDFs are read automatically; PDFs, CSV and Excel files from other banks are imported after a quick column check.")}</p>
    <div class="drop-actions"><button class="btn primary" id="pick" type="button">${t("Выбрать файлы", "Choose files")}</button>
    <button class="btn small" id="tplBtn" type="button">${t("Шаблон CSV", "CSV template")}</button></div>
    <p class="demo-link">${t(`<a href="?demo=1">Посмотреть пример отчёта</a> — вымышленный портфель у четырёх брокеров`,
      `<a href="?demo=1&amp;lang=en">See a sample report</a> — a fictional portfolio across four brokers`)}</p>
    <p class="hint">${t("Или перетащите файлы сюда. Выписки разбираются в этом браузере: наружу уходят только тикеры и названия компаний — для котировок и новостей. Если файл не прочитается, его таблицу можно распознать с помощью ИИ — только с вашего согласия и без шапки выписки.",
      "Or drop files here. Statements are processed in this browser: only tickers and company names leave it, to fetch quotes and news. If a file can't be read, its table can be read with AI — only with your consent and without the statement header.")}</p>
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
    ${PAYWALL ? `<p class="drop-foot muted">${t(`Итог по счетам и первый вывод — бесплатно · полный отчёт ${PRICE.label} · оплата через Stripe`,
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
  const f = [...top.el.querySelectorAll("button, select, input, a[href], [tabindex]:not([tabindex='-1'])")]
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
function dialog({eyebrow, title, body, buttons, cancel, read}){
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
    wrap.addEventListener("click", e => { if(e.target === wrap) return finish(cancel); const x = e.target.closest("[data-dlg]"); if(x) finish(x.dataset.dlg); });
    // Окна из очереди появляются, когда до файла дошла очередь, — возможно, посреди набора текста. Фокус на самом
    // окне, а не на кнопке: случайный Enter не отправит выписку в ИИ и не заменит выписку.
    wrap.querySelector(".dialog").focus();
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
  ops: () => t("это выписка операций — в ней движение денег, а не позиции. Нужна выписка о портфеле (Portfolio, Holdings, Valuation)",
               "this is a transaction statement — cash movements, not positions. Upload a portfolio statement (Portfolio, Holdings, Valuation)"),
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
      if(d.kind !== "positions") return;
      const b1 = bank(d); if(b1 && b2 && b1 !== b2) return;
      const all1 = doc.positions || [], all2 = d.positions || [];
      let hit = null;
      // Дата «на сегодня» (в файле её нет) у одной и той же выгрузки, добавленной в разные дни, разная — такие даты не сравниваем.
      const sameDay = doc.asOf === d.asOf || (dateGuessed(doc) && dateGuessed(d));
      if(sameDay && all1.length && all1.length === all2.length && pairs(all1, all2, true) === all1.length) hit = {doc: d, share: 1, identical: true, rank: 3};
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
const ALREADY = () => t("уже в отчёте", "already in the report");
// Даты оценки в файле не было, и взята сегодняшняя (у выписок, сохранённых раньше, — только пометка в примечании).
const dateGuessed = x => !!(x.asOfGuessed || /взята сегодняшняя|today's date used/.test(x.note || ""));
const inReport = it => !!(it.hash && S.docs.some(d => d.hash === it.hash));

function addFiles(files){
  const list = [...files].filter(f => /\.(pdf|csv|tsv|txt|xlsx|xls)$/i.test(f.name) || f.type === "application/pdf");
  if(!list.length){ toast(t("Нужны PDF-выписки или выгрузки CSV и Excel", "Only PDF statements and CSV or Excel exports are supported")); return; }
  if(S.demo) leaveDemo();
  list.forEach(f => Q.items.push({id: ++Q.seq, file: f, name: f.name, state: "queued", text: t("в очереди", "queued")}));
  Q.hidden = false;
  renderTray(true);
  if(Q.running) readQueued(Q.gen);
  runQueue();
}
/* Порядок: файлы читаются, как только пришли, — даже если открыто окно или ИИ читает другой файл. Прочитанное
   без вопросов сразу попадает в отчёт. Окна (ИИ, разметка, «тот же счёт») — по одному и после того, как всё
   пришедшее прочитано. Запрос к ИИ идёт в фоне, его результат добавляется, когда придёт ответ. */
let wakeQueue = null, reading = null;
function readQueued(gen){
  if(reading && reading.gen === gen) return reading.p;
  const job = reading = {gen};
  job.p = (async () => {
    try{ for(let it; gen === Q.gen && (it = Q.items.find(x => x.state === "queued"));) await processItem(it, gen); }
    catch(e){ console.error(e); }
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
        if(it.state === "ready") await commit(it, it.ready, gen);
        else if(it.later.kind === "hard") await resolveHard(it, it.later.manual, gen);
        else await mapAndCommit(it, it.later.manual, gen);
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
      if(Q.items.some(x => x.state === "error")) Q.hidden = false;           // об ошибке скажем, даже если лоток прятали
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
  try{ doc = await WL.parseFile(it.file); }catch(e){ return setState(it, "error", t("не удалось прочитать файл", "could not read the file")); }
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

/* PDF, который не прочитался здесь: ИИ (с согласия) или ручная разметка колонок. Согласие спрашиваем на файл;
   «не спрашивать для этого отчёта» действует до конца загрузки, а за отчётом запоминается, когда ИИ добавил
   выписку. Отключается в «Документах». */
async function resolveHard(it, manual, gen){
  if(inReport(it)) return setState(it, "skip", ALREADY());
  let choice = "ai", remember = false;
  if(!AI_CACHE.has(it.hash) && !aiAllowed()){
    setState(it, "ask", t("ждёт вашего решения", "waiting for your decision"));
    const r = await askAi(it, manual);
    if(gen !== Q.gen) return;
    choice = r.choice; remember = !!r.extra;
  }
  if(choice === "manual" && manual) return mapAndCommit(it, manual, gen);
  if(choice !== "ai") return setState(it, "skip", t("пропущен", "skipped"));
  if(remember) Q.aiOk = true;
  const ctl = it.abort = new AbortController();
  setState(it, "ai", t("распознаю с помощью ИИ — обычно до минуты", "reading with AI — usually up to a minute"));
  const cancelled = () => setState(it, "skip", t("распознавание отменено — файл не добавлен", "recognition cancelled — file not added"));
  // Не ждём ответа: очередь тем временем читает остальные файлы, а результат добавится, когда придёт.
  it.job = aiRead(it.file, it.hash, ctl.signal).then(doc => {
    it.abort = null; it.job = null;
    if(gen !== Q.gen) return;
    if(ctl.signal.aborted) return cancelled();
    track("AiRecognized", {positions: doc.positions.length});
    it.ready = doc;
    setState(it, "ready", t("распознано — добавляю в отчёт", "read — adding to the report"));
  }, e => {
    it.abort = null; it.job = null;
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
async function askAi(it, manual){
  const canManual = !!manual, unsure = !!(manual && manual.pre && manual.pre.pdf);
  return dialog({
    eyebrow: t("Распознавание", "Recognition"),
    title: unsure ? t("Не уверены, что таблица прочитана верно", "We are not sure the table was read correctly")
      : t("Файл не прочитался автоматически", "This file could not be read automatically"),
    body: `<ul class="ai-files"><li>${esc(it.name)}</li></ul>
      ${unsure ? `<p>${t("Таблицу позиций в файле нашли, но колонки или итог не сошлись. Проверьте колонки сами — это останется в браузере — или распознайте таблицу с помощью ИИ.",
        "We found the positions table, but the columns or the total did not add up. Check the columns yourself — this stays in the browser — or read the table with AI.")}</p>` : ""}
      <p>${t(`С помощью ИИ текст страниц файла, начиная с первой таблицы, уйдёт на наш сервер и в модель Claude компании Anthropic.
        Шапку первой страницы и строки, повторяющиеся на страницах, — обычно там имя, адрес и номер портфеля — не отправляем;
        IBAN, номера счетов, почту и телефоны стараемся замаскировать. Наш сервер не сохраняет ни файл, ни текст.`,
        `With AI, the text of the file's pages, starting from the first table, will be sent to our server and to Anthropic's Claude model.
        The first-page header and lines repeated on every page — usually the name, address and portfolio number — are not sent;
        we try to mask IBANs, account numbers, emails and phone numbers. Our server stores neither the file nor the text.`)}</p>
      <label class="ai-remember"><input type="checkbox" data-remember> ${t("Не спрашивать снова для этого отчёта", "Don't ask again for this report")}</label>
      ${ON_SITE ? `<p class="ai-more"><a href="${t("/legal/privacy/", "/en/legal/privacy/")}" target="_blank" rel="noopener">${t("Как мы обращаемся с данными", "How we handle data")}</a></p>` : ""}`,
    buttons: [{id: "ai", label: t("Распознать с помощью ИИ", "Read with AI"), primary: true},
              canManual && {id: "manual", label: t("Разметить колонки вручную", "Map columns manually")},
              {id: "cancel", label: t("Пропустить файл", "Skip this file")}].filter(Boolean),
    cancel: "cancel",
    read: wrap => { const c = wrap.querySelector("[data-remember]"); return !!(c && c.checked); },
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
  const twin = sameAccount(doc);
  let replace = null;
  if(twin){
    setState(it, "ask", twin.identical ? t("похоже, эта выписка уже в отчёте — ждёт решения", "looks like this statement is already in the report — waiting for your decision")
      : t("похоже на выписку того же счёта — ждёт решения", "looks like the same account — waiting for your decision"));
    const {choice} = await askReplace(twin, doc);
    if(gen !== Q.gen) return;
    if(!S.docs.includes(twin.doc) && choice !== "skip"){ replace = null; }                 // пока окно было открыто, выписку убрали
    else if(choice === "replace") replace = twin.doc.fileName;
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
  if(doc.fromAi && Q.aiOk) setAiAllowed(true);
  if(!Q.lead){ Q.lead = true; track("Lead", {content_name: "statements_uploaded", documents: S.docs.length}); }
  const n = doc.kind === "ledger" ? null : doc.positions.length;
  setState(it, "ok", (n == null ? t("журнал операций", "transaction log") : `${n} ${WL.pl(n, ["позиция", "позиции", "позиций"], ["position", "positions"])}`) +
    ` · ${doc.brokerShort || doc.broker}` + (doc.fromAi ? t(" · распознано ИИ", " · read by AI") : "") + (replace ? t(" · заменила прежнюю", " · replaced the earlier one") : ""));
  renderNow(); liveSoon();
  flashDoc(doc.fileName);
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
    : guessed ? [B.replace, B.both, B.skip]
    : same ? (log ? [B.replace, B.both, B.skip] : [B.both, B.replace, B.skip])
    : newer ? [B.replaceNew, B.both, B.skip] : [B.keepNew, {id: "replace", label: t("Заменить на эту", "Replace with this one")}, B.both];
  return dialog({
    eyebrow: bankOf(doc) ? doc.brokerShort || doc.broker : t("Выгрузка без названия банка", "Export without a bank name"),
    title: twin.identical ? t("Эта выписка уже есть в отчёте", "This statement is already in the report")
      : same && !log && !twin.few ? (known ? t("Похоже на другой счёт в том же банке", "Looks like another account at the same bank") : t("Похоже на другой счёт", "Looks like another account"))
      : t("Похоже, это выписка того же счёта", "This looks like a statement of the same account"),
    body: `<ul class="dlg-list">${line(t("В отчёте", "In the report"), old)}${line(t("Новая", "New"), doc)}</ul><p>${text}</p>`,
    buttons: order.map((b, i) => ({...b, primary: i === 0})),
    cancel: "skip",
  });
}
// Пометка об ИИ: откуда цифры и какие суммы не нашлись в тексте выписки. Остаётся и после ручной разметки колонок.
const aiNote = d => [t("распознано ИИ по тексту таблиц — сверьте суммы с выпиской", "read by AI from the table text — check the amounts against the statement"),
  d.aiDoubt && d.aiDoubt.length ? t(`не найдено в тексте выписки: ${d.aiDoubt.join(", ")}`, `not found in the statement text: ${d.aiDoubt.join(", ")}`) : ""].filter(Boolean).join(" · ");
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
async function aiRead(file, hash, signal){
  // Отменить можно и пока готовится текст: тогда он никуда не уходит.
  const cancelled = () => { if(signal && signal.aborted) throw new Error("aborted"); };
  const prep = await WL.pdfAiText(file);
  cancelled();
  if(prep.numbers.size < 2) throw new Error("no_positions");        // отправлять нечего: в тексте нет чисел
  if(prep.text.length > 160000) throw new Error("too_large");
  let data = AI_CACHE.get(hash);
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
    AI_CACHE.set(hash, data);
  }
  cancelled();
  if(data.document_kind === "transactions") throw new Error("transactions");
  const ps = (data.positions || []).filter(p => p && p.name && (p.market_value != null || p.quantity != null));
  if(!ps.length) throw new Error("no_positions");
  const found = v => v == null || prep.numbers.has(Math.round(Math.abs(v) * 100));
  const doubtful = ps.filter(p => !found(p.market_value) || !found(p.quantity));
  if(doubtful.length > Math.max(1, ps.length * 0.25)) throw new Error("unverified");
  // Ответ собираем в таблицу с заголовками шаблона и читаем тем же разбором, что CSV: классы активов,
  // опционы, сверка итогов и пометки о пропусках работают одинаково.
  const TYPE = {stock: "Stock", fund: "Fund", bond: "Bond", structured_note: "Structured note", cash: "Cash"};
  const ccy = v => (String(v || "").toUpperCase().match(/[A-Z]{3}/) || [""])[0];
  const broker = prep.ctx.broker || String(data.institution || "").slice(0, 60);
  const rows = [["Broker", "Name", "Ticker", "ISIN", "Type", "Quantity", "Average cost price", "Current price", "Market value", "Currency"],
    ...ps.map(p => [broker, p.name, p.ticker || "", p.isin || "", TYPE[p.asset_class] || "Other", p.quantity ?? "", p.cost_price ?? "", p.price ?? "", p.market_value ?? "", ccy(p.currency)]),
    ...(data.totals || []).filter(x => x && typeof x.value === "number").map(x => ["", `Total ${ccy(x.currency)}`.trim(), "", "", "", "", "", "", x.value, ccy(x.currency)])];
  const ctx = {broker: broker || null, asOf: prep.ctx.asOf || (/^\d{4}-\d{2}-\d{2}$/.test(data.as_of || "") ? data.as_of : null)};
  const head = WL.sheetFind(rows);
  const doc = WL.sheetDoc(rows, head, file, ctx);
  doc.fromAi = true;
  doc.aiDoubt = doubtful.map(p => p.name).slice(0, 3);
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
      if(x.dataset.cancel){ const it = Q.items.find(i => i.id === +x.dataset.cancel);
        if(it && it.abort && !it.abort.signal.aborted){ it.abort.abort(); it.text = t("отменяю…", "cancelling…"); renderTray(); } }
    });
  }
  const items = Q.items;
  if(!items.length){ el.hidden = true; el.innerHTML = ""; return; }
  const active = items.filter(x => ACTIVE.test(x.state)).length, ok = items.filter(x => x.state === "ok").length;
  const bad = items.some(x => x.state === "error");
  const title = active ? t(`Загружаю выписки · ${items.length - active} из ${items.length}`, `Uploading statements · ${items.length - active} of ${items.length}`)
    : ok ? t(`Добавлено ${ok} из ${items.length}`, `Added ${ok} of ${items.length}`) : t("Ничего не добавлено", "Nothing was added");
  el.innerHTML = `<div class="ut-head"><b>${esc(title)}</b><span class="spacer"></span>
      ${active ? "" : `<button class="btn small" type="button" data-tray="add">${t("Добавить ещё", "Add more")}</button>`}
      <button class="ut-x" type="button" data-tray="close" aria-label="${t("Скрыть", "Hide")}">×</button></div>
    ${active ? `<div class="ut-bar"><i style="width:${Math.round((items.length - active) / items.length * 100)}%"></i></div>` : ""}
    <ul class="ut-list">${items.map(x => `<li class="ut-item ${x.state}">
      <span class="ut-ic" aria-hidden="true"></span>
      <div class="ut-main"><div class="ut-name" title="${esc(x.name)}">${esc(x.name)}</div><div class="ut-text">${esc(x.text)}</div></div>
      ${x.state === "ai" && x.abort && !x.abort.signal.aborted ? `<button class="btn small" type="button" data-cancel="${x.id}">${t("Отменить", "Cancel")}</button>` : ""}</li>`).join("")}</ul>`;
  el.classList.toggle("busy", !!active);
  if(show && !Q.hidden) el.hidden = false;
  clearTimeout(trayTimer);
  if(!active && !bad) trayTimer = setTimeout(closeTray, 8000);
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
  const syms = [...new Set(P.positions.filter(p => WL.eq(p) && p.symbol && p.ccy === "USD").map(p => p.symbol))];
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
  WL.applyLiveCache(S.P);
  renderApp();
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
      <div id="demoBar"></div>
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
      <footer class="app-foot no-print">${[`WealthLens`, SUPPORT && `${t("Поддержка", "Support")}: ${supportLink()}`,
        ON_SITE && `<a href="${t("/legal/terms/", "/en/legal/terms/")}">${t("Условия", "Terms")}</a>`,
        ON_SITE && `<a href="${t("/legal/privacy/", "/en/legal/privacy/")}">${t("Конфиденциальность", "Privacy")}</a>`,
        window.WL_PIXEL_ID && `<a href="#" data-cookies>${t("Настройки cookies", "Cookie settings")}</a>`].filter(Boolean).join(" · ")}</footer>`;
    $("#bench").onchange = async e => { S.bench = e.target.value; $("#chart").innerHTML = `<p class="muted">${t("Загружаю историю…", "Loading price history…")}</p>`; await WL.fetchHistory(S.P, [S.bench]); renderChart(); };
    WL.renderMarket($("#market"), S.P);   // один раз: лента и новости не должны перезагружаться при каждом обновлении цен
  }
  $("#bench").value = S.bench;
  renderHero(); renderInsights(); renderStructure(); renderTimeline(); renderControls(); renderPositions(); renderChart(); renderDocs();
  renderPaywall(); renderDemoBar();
  setBuyDisabled(checkoutBusy);
  // Открытая карточка позиции показывает свежие данные, а не цены до пересборки.
  if(S.drawerId && $("#drawer").classList.contains("open")){
    if(S.P.positions.some(x => x.id === S.drawerId)) openDrawer(S.drawerId, true); else closeDrawer();
  }
}

function renderHero(){
  const P = S.P;
  const byDoc = P.docs.map(d => {
    const ps = P.positions.filter(p => p.source === d.fileName);
    const usd = ps.reduce((a, p) => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy); return v != null && k != null ? a + v * k : a; }, 0);
    const day = ps.reduce((a, p) => { const c = WL.eq(p) ? WL.change(P, p, "1d") : null; return c ? a + c.abs : a; }, 0);
    return {d, ps, usd, day, stale: WL.days(d.asOf, P.today) > 45, live: ps.some(p => p.live)};
  });
  const total = byDoc.reduce((a, x) => a + x.usd, 0), day = byDoc.reduce((a, x) => a + x.day, 0);
  // Доли — от суммы положительных позиций, как в «Структуре»: проданный опцион — обязательство, а не часть состава.
  const usdOf = p => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy); return v != null && k != null ? v * k : null; };
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
  const mixed = byDoc.some(x => x.stale) && byDoc.some(x => !x.stale);
  // Без связи с сервером данных суммы честно считаются по выпискам, а позиции в других
  // валютах не пересчитать — об этом надо сказать, а не молча выкинуть их из итога.
  const warn = !P.live ? [] : [!P.live.ok && t("Сервер котировок не ответил: суммы по ценам из выписок", "Quote server did not respond: amounts use statement prices"),
    !P.live.fx && P.positions.some(p => p.ccy !== "USD") && t("курсы валют не загрузились: позиции не в долларах в итог не вошли", "exchange rates did not load: non-USD positions are left out of the total")].filter(Boolean);
  $("#total").innerHTML = `<div class="eyebrow">${t("Всего в долларах", "Total in USD")}</div>
    <div class="value">${fmt.money(total, "USD", 0)}</div>
    <div class="sub">${mixed ? byDoc.map(x => `${esc(x.d.brokerShort)} — ${x.stale ? t("на ", "as of ") + fmt.date(x.d.asOf) : t("сейчас", "now")}`).join(" · ") : t("по текущим ценам", "at current prices")}</div>
    ${P.live && day ? `<div class="sub" style="margin-top:6px">${t("За день:", "Day change:")} <b class="${day > 0 ? "up" : "down"}">${fmt.signed(day)}</b> <span class="muted">${t("по акциям, котировки CBOE", "on stocks, CBOE quotes")}</span></div>` : ""}
    ${!P.live ? `<div class="sub muted" style="margin-top:6px">${t("Загружаю текущие цены…", "Loading current prices…")}</div>` : ""}
    ${warn.length ? `<div class="sub down" style="margin-top:6px">${esc(warn.join("; "))}.</div>` : ""}
    ${mixHtml}`;
  $("#brokers").className = `brokers n${byDoc.length}`;
  $("#brokers").innerHTML = byDoc.map(x => {
    const bad = x.d.checks.filter(c => !c.ok).length;
    return `<div class="card broker" data-file="${esc(x.d.fileName)}"><div class="name">${esc(x.d.broker)}
        ${x.d.from === "demo" && !bad ? "" : !bad && x.d.from === "sheet" && !x.d.checks.some(c => !c.count) ? `<span class="pill">${t("итог не сверен", "total not reconciled")}</span>`
          : `<span class="pill ${bad ? "bad" : "ok"}">${bad ? t(`не сошлось: ${bad}`, `mismatch: ${bad}`) : x.d.from === "sheet" ? t("сошлось с итогом файла", "matches file totals") : t("сверено с банком", "matches bank statement")}</span>`}
        ${x.stale ? `<span class="pill stale">${t(`${WL.days(x.d.asOf, P.today)} дн. назад`, `${WL.days(x.d.asOf, P.today)} days old`)}</span>` : x.live ? `<span class="pill live">${t("цены сейчас", "live prices")}</span>` : ""}</div>
      <div class="v">${fmt.money(x.usd, "USD", 0)}</div>
      <div class="meta">${x.d.kind === "ledger" ? t(`журнал за ${fmt.date(x.d.periodFrom)}–${fmt.date(x.d.asOf)}`, `transaction log ${fmt.date(x.d.periodFrom)}–${fmt.date(x.d.asOf)}`)
        : t(`${x.d.from === "sheet" ? "выгрузка" : x.d.from === "demo" ? "данные" : "выписка"} на ${fmt.date(x.d.asOf)}`,
            `${x.d.from === "sheet" ? "export" : x.d.from === "demo" ? "data" : "statement"} as of ${fmt.date(x.d.asOf)}`)} ·
        ${x.ps.length} ${WL.pl(x.ps.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}</div>
      ${byDoc.length > 1 && assets > 0 && x.usd > 0 ? `<div class="share" title="${esc(t("доля в портфеле", "share of the portfolio"))}"><span class="trk"><i style="width:${Math.min(100, Math.max(x.usd / assets * 100, 1)).toFixed(1)}%"></i></span><b>${pctLabel(x.usd / assets * 100)}</b></div>` : ""}</div>`;
  }).join("");
  keepFlash();
  $("#printTitle").textContent = t(`${S.client} — портфель`, `${S.client} — portfolio`);
  $("#printSub").textContent = t(`Отчёт на ${fmt.date(TODAY)} · ${S.docs.map(d => `${d.brokerShort}: ${d.kind === "ledger" ? "журнал до" : "выписка на"} ${fmt.date(d.asOf)}`).join(" · ")}`,
    `Report as of ${fmt.date(TODAY)} · ${S.docs.map(d => `${d.brokerShort}: ${d.kind === "ledger" ? "transaction log to" : "statement as of"} ${fmt.date(d.asOf)}`).join(" · ")}`);
}

/* Структура: куда разложены деньги клиента — по брокерам, типам и валютам. Доли считаются
   от суммы положительных позиций; проданные опционы имеют отрицательную стоимость и
   показываются суммой без доли. Фьючерсы учтены через деньги счёта. */
function renderStructure(){
  const P = S.P, el = $("#structure"); if(!P || !el) return;
  const rows = P.positions.map(p => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy); return {p, usd: v != null && k != null ? v * k : null}; })
    .filter(x => x.usd != null);
  const assets = rows.reduce((a, x) => a + Math.max(x.usd, 0), 0);
  const group = key => { const m = new Map(); rows.forEach(x => m.set(key(x.p), (m.get(key(x.p)) || 0) + x.usd)); return [...m].sort((a, b) => b[1] - a[1]); };
  // Один ряд — одна сущность, и цвет у типа тот же, что в сводке и в группах таблицы; брокеры и валюты — одним золотом.
  const TYPE = {stock: t("Акции", "Stocks"), fund: t("Фонды", "Funds"), bond: t("Облигации", "Bonds"), note: t("Структурные ноты", "Structured notes"), other: t("Прочее", "Other"),
    option: t("Опционы проданные", "Short options"), future: t("Фьючерсы", "Futures"), cash: t("Деньги", "Cash")};
  const block = (title, items, color) => `<div class="card sblock"><div class="eyebrow">${title}</div>` + items.map(([key, v]) => {
    const share = v > 0 && assets ? v / assets * 100 : null, name = color ? TYPE[key] || key : key;
    return `<div class="srow"><div class="sname">${esc(name)}</div><div class="sbar">${share != null ? `<i style="width:${Math.max(share, 0.6).toFixed(1)}%${color ? `;--c:var(--cls-${WL.clsKey(key)})` : ""}"></i>` : ""}</div>` +
      `<div class="sval ${v < 0 ? "down" : ""}">${fmt.short(v)}</div><div class="spct">${share != null ? Math.round(share) + "%" : "—"}</div></div>`;
  }).join("") + `</div>`;
  el.innerHTML = block(t("По брокерам", "By broker"), group(p => p.brokerShort)) + block(t("По типам", "By type"), group(p => p.type), true) + block(t("По валютам", "By currency"), group(p => p.ccy));
  const stale = P.docs.filter(d => WL.days(d.asOf, P.today) > 45);
  $("#structAside").textContent = t(`в долларах${stale.length ? `; ${stale.map(d => `${d.brokerShort} — на ${fmt.date(d.asOf)}`).join(", ")}` : " по текущим ценам"}; фьючерсы учтены через деньги счёта`,
    `in USD${stale.length ? `; ${stale.map(d => `${d.brokerShort} as of ${fmt.date(d.asOf)}`).join(", ")}` : " at current prices"}; futures are counted through account cash`);
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
    if(d >= 0 && p && p.type === "option" && p.underlyingLive != null){
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
  const L = S.P.live;
  $("#posAside").textContent = !L ? t("цены из выписок", "statement prices") : !L.ok ? t("цены из выписок: сервер котировок не ответил", "statement prices: quote server did not respond") :
    `${t("текущие цены CBOE с задержкой", "delayed CBOE prices")} · ${L.fxDate ? t(`курсы ЕЦБ на ${fmt.date(L.fxDate)}`, `ECB rates as of ${fmt.date(L.fxDate)}`) : t("курсы валют не загрузились", "exchange rates did not load")}`;
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
      const c = WL.change(P, p, per.id), k = WL.usd(P, p.ccy);
      if(c && k != null){ covered++; abs += c.abs * k; }
    });
    return {per, abs, covered, countable};
  });
  pe.innerHTML = `<div class="sec-h"><h2>${t("Изменение по периодам", "Change by period")}</h2><span class="aside">${t("текущее количество бумаг, сумма по позициям, где есть данные", "current holdings; total across positions with data")}</span></div>
    <div class="card"><table class="pos"><thead><tr><th class="l">${t("Период", "Period")}</th><th>${t("Изменение", "Change")}</th><th>${t("Есть данные", "Data available")}</th><th class="l">${t("Как считается", "Method")}</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td class="l">${esc(r.per.label)}</td><td><span class="${r.abs > 0 ? "up" : r.abs < 0 ? "down" : ""}">${r.covered ? fmt.signed(r.abs) : "—"}</span></td>` +
      `<td>${t(`${r.covered} из ${r.countable}`, `${r.covered} of ${r.countable}`)}</td><td class="l">${esc(PERIOD_NOTE[r.per.id] || "")}</td></tr>`).join("") + `</tbody></table></div>`;
  const liveAt = P.live && P.live.ok ? new Date(P.live.at) : null;
  const at = !liveAt ? null : EN
    ? `${fmt.date(`${liveAt.getFullYear()}-${pad(liveAt.getMonth() + 1)}-${pad(liveAt.getDate())}`)}, ${pad(liveAt.getHours())}:${pad(liveAt.getMinutes())}`
    : liveAt.toLocaleString("ru-RU", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"});
  pn.innerHTML = `<div class="sec-h"><h2>${t("Источники и оговорки", "Sources and caveats")}</h2></div><div class="card doc"><ul class="notes">${t(`
    <li>Позиции, количества, себестоимость и комиссии — из выписок брокеров. Разбор сверен с итогами самих выписок, результаты сверки — в разделе «Документы».</li>
    <li>${at ? `Текущие цены — CBOE с задержкой около 15 минут, получены ${esc(at)}. ${P.live.fxDate ? `Курсы валют — ЕЦБ на ${fmt.date(P.live.fxDate)}.` : "Курсы валют не загрузились."}` : "Текущие цены не загружались: все суммы — по данным выписок."}</li>
    <li>История цен — дневные цены закрытия CBOE без учёта дивидендов. График показывает, как менялся бы текущий состав акций; это не фактическая история счёта: сделки и ввод-вывод денег не учитываются.</li>
    <li>Даты экспираций опционов и первого дня уведомления по фьючерсам CME рассчитаны по правилам биржи без учёта праздников.</li>
    <li>Данные Swissquote — на дату журнала операций. Что открыто на этом счёте сейчас, из журнала не видно.</li>
    <li>Рынок: индексы, VIX, доходности казначейских облигаций США и фонды GLD, BNO, IBIT — CBOE с задержкой; курсы валют — ЕЦБ.</li>
    <li>Новости рынка — RSS Investing.com, «Ведомости», «Коммерсантъ», CNBC и MarketWatch. Новости по бумагам клиента — Google News за неделю, отобраны по названию компании и биржевому обозначению.</li>
    <li>Отчёт носит информационный характер и не является инвестиционной рекомендацией.</li>`, `
    <li>Positions, quantities, cost basis and fees come from the broker statements. Parsed data is reconciled with each statement's own totals; the results are in the “Documents and gaps” section.</li>
    <li>${at ? `Current prices: CBOE, delayed by about 15 minutes, retrieved ${esc(at)}. ${P.live.fxDate ? `Exchange rates: ECB as of ${fmt.date(P.live.fxDate)}.` : "Exchange rates did not load."}` : "Current prices were not loaded: all amounts are based on the statements."}</li>
    <li>Price history: CBOE daily closing prices, excluding dividends. The chart shows how the current stock holdings would have performed; it is not the actual account history, as trades, deposits and withdrawals are not included.</li>
    <li>Option expiry dates and first notice days for CME futures are calculated from exchange rules, without adjusting for holidays.</li>
    <li>Swissquote data is as of the transaction log date. The log does not show what is currently open on that account.</li>
    <li>Market: indices, VIX, US Treasury yields and the GLD, BNO and IBIT funds are delayed CBOE quotes; exchange rates are from the ECB.</li>
    <li>Market news: RSS feeds from Investing.com, Vedomosti, Kommersant, CNBC and MarketWatch. News on the client's holdings: Google News for the past week, matched by company name and ticker.</li>
    <li>This report is for information only and does not constitute investment advice.</li>`)}</ul></div>`;
}
const renderChart = () => {
  if(locked()){
    $("#chart").innerHTML = `<div class="lockblock"><div class="skel-chart"></div>
      <p>${t("Как акции портфеля шли против S&P 500, Nasdaq, золота и других бенчмарков — в полном отчёте.", "See how the portfolio's stocks performed against the S&P 500, Nasdaq, gold and other benchmarks in the full report.")}</p>
      <button class="btn small" type="button" data-buy="chart">${t(`Открыть за ${PRICE.label}`, `Unlock for ${PRICE.label}`)}</button></div>`;
    return;
  }
  WL.renderChart($("#chart"), S.P, S);
};

function renderDocs(){
  const P = S.P;
  $("#docs").innerHTML = S.docs.map(d => `<div style="margin-bottom:14px">
      <div class="name" style="font-weight:600">${esc(d.broker)}</div>
      <div class="muted" style="font-size:12.5px">${esc(d.fileName)} · ${d.kind === "ledger"
        ? t(`журнал операций, ${d.records.length} строк, ${d.trades.length} сделок${d.cancelled.length ? `, отменено банком: ${d.cancelled.length}` : ""}`,
            `transaction log, ${d.records.length} ${WL.pl(d.records.length, ["строка", "строки", "строк"], ["row", "rows"])}, ${d.trades.length} ${WL.pl(d.trades.length, ["сделка", "сделки", "сделок"], ["trade", "trades"])}${d.cancelled.length ? `, cancelled by the bank: ${d.cancelled.length}` : ""}`)
        : t(`${d.from === "sheet" ? "выгрузка таблицей" : "снимок"}, позиции на ${fmt.date(d.asOf)}`, `${d.from === "sheet" ? "spreadsheet export" : "snapshot"}, positions as of ${fmt.date(d.asOf)}`)}${d.note ? " · " + esc(d.note) : ""}</div>
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
    doc.fileName = key; doc.hash = old.hash;
    // Цифры по-прежнему из ответа ИИ: пометка об этом и о суммах, не найденных в выписке, остаётся.
    if(old.fromAi){ doc.fromAi = true; doc.aiDoubt = old.aiDoubt; doc.note = [aiNote(doc), doc.note].filter(Boolean).join(" · "); }
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
  if(!S.docs.length){ setAiAllowed(false); Q.aiOk = false; }
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
  const cur = WL.current(P, p), k = WL.usd(P, p.ccy);
  const kv = [];
  const add = (label, v) => { if(v != null && v !== "") kv.push(`<dt>${label}</dt><dd>${v}</dd>`); };
  const NOT_IN = t("нет в выписке", "not in statement");
  add(t("Брокер", "Broker"), esc(p.broker));
  const contracts = p.type === "option" || p.type === "future";
  if(p.type !== "cash" && p.qty != null) add(t("Количество", "Quantity"), fmt.qty(p.qty) + (contracts ? t(" контр.", " " + WL.pl(p.qty, ["", "", ""], ["contract", "contracts"])) : ""));
  if(!contracts && p.type !== "cash") add(t("Цена покупки", "Purchase price"), p.cost != null ? t(`${fmt.px(p.cost / p.qty)} (средняя из себестоимости ${fmt.money(p.cost)})`, `${fmt.px(p.cost / p.qty)} (average from cost basis ${fmt.money(p.cost)})`) : `<span class="unk">${esc(p.costNote || NOT_IN)}</span>`);
  if(p.premium != null) add(t("Премия всего", "Total premium"), fmt.money(p.premium, p.ccy));
  add(t("Дата покупки", "Purchase date"), p.purchaseDate ? fmt.date(p.purchaseDate) + (p.purchaseNote ? ` <span class="muted">(${esc(p.purchaseNote)})</span>` : "") : p.type === "cash" ? null : `<span class="unk">${NOT_IN}</span>`);
  if(p.type !== "cash") add(t("Комиссии", "Fees"), p.commission != null ? fmt.money(p.commission, p.ccy) : `<span class="unk">${NOT_IN}</span>`);
  if(p.price != null) add(t(`Цена на ${fmt.date(p.priceDate)}`, `Price as of ${fmt.date(p.priceDate)}`), fmt.px(p.price));
  if(cur.live) add(t("Цена сейчас", "Live price"), `${fmt.px(cur.price)}${p.live.bid != null ? ` <span class="muted">(bid ${fmt.px(p.live.bid)} / ask ${fmt.px(p.live.ask)})</span>` : ""}`);
  if(p.underlyingLive != null) add(t(`${esc(p.underlying)} сейчас`, `${esc(p.underlying)} now`), fmt.px(p.underlyingLive));
  add(t("Стоимость", "Value"), cur.value != null ? fmt.money(cur.value, p.ccy) : `<span class="unk">${esc(p.valueNote || NOT_IN)}</span>`);
  if(cur.value != null && k != null && p.ccy !== "USD") add(t("В долларах", "In USD"), fmt.money(cur.value * k));
  if(p.notional != null) add(t("Номинал", "Notional"), fmt.money(p.notional, p.ccy, 0));
  if(p.type === "option" && p.qty < 0 && p.multiplier) add(p.right === "P" ? t("Обязательство купить", "Obligation to buy") : t("Обязательство продать", "Obligation to sell"), fmt.money(Math.abs(p.qty) * p.multiplier * p.strike, p.ccy, 0));
  if(p.firstNotice) add(t("Первый день уведомления", "First notice day"), fmt.date(p.firstNotice) + t(" <span class='muted'>— переложить до</span>", " <span class='muted'>— roll before</span>"));
  if(p.expiry) add(p.type === "future" ? t("Последний торговый день", "Last trading day") : t("Экспирация", "Expiry"), fmt.date(p.expiry));
  if(p.unrealized != null) add(t(`Результат к покупке на ${fmt.date(p.priceDate)}`, `Unrealized gain/loss as of ${fmt.date(p.priceDate)}`), fmt.money(p.unrealized));
  const changes = p.type === "cash" ? "" : `<h4 style="margin:18px 0 6px">${t("Изменение за периоды", "Change by period")}</h4><table class="mini">` +
    WL.PERIODS.map(per => { const c = WL.change(P, p, per.id); return `<tr><td class="l">${per.label}</td><td class="${c && c.abs > 0 ? "up" : c && c.abs < 0 ? "down" : ""}">${c ? fmt.signed(c.abs, p.ccy) : `<span class='unk'>${t("нет данных", "no data")}</span>`}</td><td>${c && c.pct != null ? fmt.pct(c.pct) : ""}</td></tr>`; }).join("") + `</table>`;
  const trades = p.trades && p.trades.length ? `<h4 style="margin:18px 0 6px">${t("Сделки из журнала:", "Trades in the transaction log:")} ${p.trades.length}</h4><table class="mini"><tr><th class="l">${t("Дата", "Date")}</th><th class="l">${t("Операция", "Action")}</th><th>${t("Кол-во", "Qty")}</th><th>${t("Премия", "Premium")}</th><th>${t("Комиссия", "Fees")}</th><th>${t("Сбор", "Exchange fees")}</th></tr>` +
    p.trades.map(tr => `<tr><td class="l">${fmt.date(tr.date)}</td><td class="l">${tr.assigned ? t("исполнение", "assignment") : tr.side === "Buy" ? t("покупка", "buy") : t("продажа", "sell")}</td><td>${tr.qty}</td><td>${tr.premium ? fmt.money(tr.premium, tr.ccy) : ""}</td><td>${fmt.money(tr.commission, tr.ccy)}</td><td>${fmt.money(tr.exchFees, tr.ccy)}</td></tr>`).join("") + `</table>` : "";
  $("#drawer").innerHTML = `<button class="btn small" id="closeDrawer" type="button" style="float:right">${t("Закрыть", "Close")}</button>
    <div class="eyebrow">${esc(TYPE_RU[p.type])} · ${esc(p.brokerShort)}</div><h3>${esc(p.name)}</h3>
    <div class="code">${esc(p.occ || p.code || p.symbol || "")}</div>
    <dl class="kv">${kv.join("")}</dl>${changes}${trades}
    <p class="basis">${t("Источник:", "Source:")} ${esc(p.source)}${cur.live ? t(" · текущие цены CBOE с задержкой", " · delayed CBOE prices") : ""}</p>`;
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
window.addEventListener("beforeprint", () => { if(locked()) track("PrintBlocked", {}); });
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
  if(e.key === UNLOCKS){ if(S.P) renderApp(); return; }
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
  await recoverPendingPayment();
  if(locked()) track("ViewContent", {content_name: "report_preview", value: PRICE.amount, currency: PRICE.currency});
  return refresh();
})();
})();
