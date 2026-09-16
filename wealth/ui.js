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

const save = () => { if(S.demo) return; try{ localStorage.setItem(STORE, JSON.stringify({client: S.client, docs: S.docs, rid: S.rid})); }catch(e){} };
const load = () => { try{ const v = JSON.parse(localStorage.getItem(STORE) || "null");
  if(v && v.docs){ S.docs = v.docs; S.client = localName(v.client) || S.client; S.rid = v.rid || null; } }catch(e){} };
const toast = msg => { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); };
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
async function openCheckout(source){
  // Отчёт без единой позиции продавать нельзя: человек заплатит за пустую страницу.
  if(!hasPositions()){ toast(t("В загруженных файлах не нашлось позиций — оплачивать пока нечего. Загрузите выписку о портфеле.",
    "No positions were found in the uploaded files, so there is nothing to pay for yet. Upload a portfolio statement.")); return; }
  if(!S.rid){ S.rid = newRid(); save(); }
  track("InitiateCheckout", {value: PRICE.amount, currency: PRICE.currency, content_name: "portfolio_report", source});
  const btns = [...document.querySelectorAll("[data-buy]")];
  btns.forEach(b => { b.disabled = true; });
  const body = Object.assign({}, WL.attribution ? WL.attribution() : {}, {rid: S.rid, lang: WL.lang, path: location.pathname});
  let r = null;
  try{
    r = await fetch(PAY_API + "/checkout", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)})
      .then(x => x.json());
  }catch(e){}
  if(r && r.url){
    // Запоминаем начатую оплату: если после неё вкладку закроют до возврата на сайт, отчёт откроется при следующем заходе.
    try{ localStorage.setItem(PENDING, JSON.stringify({rid: S.rid, sid: r.id, at: Date.now()})); }catch(e){}
    location.href = r.url; return;
  }
  btns.forEach(b => { b.disabled = false; });
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
  $("#printBtn").textContent = lock ? t(`Полный отчёт · ${PRICE.label}`, `Full report · ${PRICE.label}`) : t("Отчёт PDF", "PDF report");
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
      <div class="muted pw-note">${t("Оплата через Stripe. Выписки не загружаются на сервер — отчёт собирается в вашем браузере.",
        "Payment via Stripe. Statements are not uploaded to a server — the report is built in your browser.")}</div>
      ${ON_SITE ? `<div class="muted pw-note">${t(`Оплачивая, вы принимаете <a href="/legal/terms/">условия</a> и <a href="/legal/refund/">правила возврата</a>.`,
        `By paying, you accept the <a href="/en/legal/terms/">terms</a> and <a href="/en/legal/refund/">refund policy</a>.`)}</div>` : ""}
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
  $("#bar").hidden = true;
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
    <p class="hint">${t("Или перетащите файлы сюда. Выписки разбираются в этом браузере и никуда не отправляются: наружу уходят только тикеры и названия компаний — для котировок и новостей.",
      "Or drop files here. Statements are processed in this browser and are not sent anywhere: only tickers and company names leave it, to fetch quotes and news.")}</p>
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
    <div class="progress" id="progress" aria-live="polite"></div></div>
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
async function addFiles(files){
  if(S.demo){ S.demo = false; S.docs = []; S.rid = null; S.client = DEFAULT_CLIENT; history.replaceState(null, "", HOME); }
  const list = [...files].filter(f => /\.(pdf|csv|tsv|txt|xlsx|xls)$/i.test(f.name) || f.type === "application/pdf");
  if(!list.length){ toast(t("Нужны PDF-выписки или выгрузки CSV и Excel", "Only PDF statements and CSV or Excel exports are supported")); return; }
  const prog = $("#progress");
  const pending = [];      // таблицы, которые надо разметить руками
  for(const f of list){
    if(prog) prog.insertAdjacentHTML("beforeend", `<div>${t("Читаю", "Reading")} ${esc(f.name)}…</div>`);
    try{
      const doc = await WL.parseFile(f);
      if(doc.unknown){
        // Таблицу, которую не удалось разметить самим, отдаём пользователю: он покажет колонки.
        if(doc.sheets){ pending.push({file: f, sheets: doc.sheets}); continue; }
        toast(doc.ops
          ? t(`${f.name}: это выписка операций — в ней движение денег, а не позиции. Для отчёта нужна выписка о портфеле (Portfolio, Holdings, Valuation).`,
              `${f.name}: this is a transaction statement — cash movements, not positions. The report needs a portfolio statement (Portfolio, Holdings, Valuation).`)
          : doc.scan
          ? t(`${f.name}: это скан — в PDF нет текста. Нужна электронная выписка из интернет-банка или выгрузка CSV или Excel.`,
              `${f.name}: this is a scan with no text layer. Download an electronic statement from online banking, or a CSV or Excel export.`)
          : doc.pdf
          ? t(`${f.name}: в PDF не нашлось таблицы позиций. Если это выписка, загрузите выгрузку позиций в CSV или Excel.`,
              `${f.name}: no positions table found in this PDF. If it is a statement, upload a CSV or Excel export of positions.`)
          : t(`${f.name}: формат выписки пока не распознаётся`, `${f.name}: this statement format is not supported yet`));
        continue;
      }
      // Таблица из PDF другого банка. Уверенный разбор — сразу в отчёт: ничего не упало в сверке, у позиций есть
      // названия и стоимость, итог файла сошёлся или стоимость есть почти у всех строк. Сомнительный — на проверку колонок.
      if(doc.fromPdf){
        const m = doc.head.map, totals = doc.checks.filter(c => !c.count);
        const valued = doc.positions.filter(p => p.value != null).length;
        const sure = doc.checks.every(c => c.ok) && doc.positions.length >= 2 && m.value != null && (m.name != null || m.ticker != null) &&
          (totals.some(c => c.ok) || valued >= doc.positions.length * 0.8);
        if(!sure){ pending.push({file: f, sheets: doc.sheets, pre: {sheetIndex: doc.sheetIndex || 0, head: doc.head, pdf: true}}); continue; }
        doc.note = [doc.note, t("таблица найдена в PDF автоматически — если что-то не так, «Сопоставить колонки» ниже",
          "table found in the PDF automatically — use “Map columns” below if something is off")].filter(Boolean).join(" · ");
      }
      if(doc.from === "sheet" && doc.sheets)
        S_SHEETS[f.name] = {file: f, sheets: doc.sheets, sheetIndex: doc.sheetIndex, head: doc.head};
      S.docs = S.docs.filter(d => !(d.broker === doc.broker && d.asOf === doc.asOf && d.periodFrom === doc.periodFrom));
      S.docs.push(doc);
    }catch(e){ toast(t(`${f.name}: не удалось прочитать файл`, `${f.name}: could not read the file`)); }
  }
  const askMapping = () => { const p = pending.shift(); if(p) openMapper(p.file, p.sheets, p.pre || null, askMapping); };
  if(!S.docs.length){ renderUpload(); askMapping(); return; }
  if(!S.rid) S.rid = newRid();
  track("Lead", {content_name: "statements_uploaded", documents: S.docs.length});
  save();
  await refresh();
  askMapping();
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
async function refresh(){
  S.P = WL.build(S.docs, TODAY);
  renderApp();
  await WL.fetchLive(S.P);
  renderApp();
  await loadHistory();
}
function renderApp(){
  const P = S.P;
  $("#bar").hidden = false;
  $("#client").value = S.client;
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
      <section><div class="sec-h"><h2>${t("Документы и чего не хватает", "Documents and gaps")}</h2></div><div class="docs"><div class="card doc" id="docs"></div><div class="card miss" id="missing"></div></div></section>
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
    return `<div class="card broker"><div class="name">${esc(x.d.broker)}
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
  const types = ["all", ...["stock", "fund", "bond", "note", "other", "option", "future", "cash"]
    .filter(t => S.P.positions.some(p => p.type === t))];
  $("#periods").innerHTML = WL.PERIODS.map(p => `<button type="button" data-per="${p.id}" aria-pressed="${S.period === p.id}">${p.label}</button>`).join("");
  $("#filters").innerHTML = types.map(ty => `<button type="button" data-f="${ty}" aria-pressed="${S.filter === ty}">${ty === "all" ? t("Все", "All") : TYPE_RU[ty]}</button>`).join("");
  $("#periods").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.period = b.dataset.per; renderControls(); renderPositions(); renderChart(); };
  $("#filters").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.filter = b.dataset.f; renderControls(); renderPositions(); };
  // Портфель по умолчанию общий; разбивка по площадкам — по желанию, поэтому переключатель
  // появляется, только когда брокеров больше одного.
  const brokers = [...new Set(S.P.positions.map(p => p.brokerShort))];
  $("#venues").hidden = brokers.length < 2;
  $("#venues").innerHTML = ["all", ...brokers].map(b =>
    `<button type="button" data-b="${esc(b)}" aria-pressed="${S.broker === b}">${b === "all" ? t("Все площадки", "All venues") : esc(b)}</button>`).join("");
  $("#venues").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.broker = b.dataset.b; renderControls(); renderPositions(); };
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
      ${d.from === "sheet" && S_SHEETS[d.fileName] ? `<button class="btn small no-print" type="button" data-remap="${esc(d.fileName)}" style="margin-top:8px">${t("Сопоставить колонки", "Map columns")}</button>` : ""}
    </div>`).join("");
  $("#docs").onclick = e => {
    const b = e.target.closest("[data-remap]"); if(!b) return;
    const st = S_SHEETS[b.dataset.remap];
    if(st) openMapper(st.file, st.sheets, st);
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

/* ── Ручное сопоставление колонок ──────────────────────────────────────── */
/* Нужно, когда заголовки в выгрузке названы по-своему. Инструмент честно говорит, что
   не понял файл, и даёт разметить таблицу руками: это лучше, чем угадать и посчитать не
   то. Панель показывает начало файла, выбор строки заголовков и то, что получится. */
const S_SHEETS = {};        // строки принесённых таблиц: только в памяти сессии
function openMapper(file, sheets, pre, onDone){
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
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); if(onDone) onDone(); };
  const onKey = e => { if(e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  function render(){
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
          (d.note ? " · " + d.note : "");
        preview = d.positions.slice(0, 5).map(p => `<tr><td>${esc(p.name)}</td><td>${esc(TYPE_RU[p.type] || p.type)}</td>` +
          `<td>${esc(p.symbol || "")}</td><td>${p.qty != null ? fmt.qty(p.qty) : ""}</td>` +
          `<td>${p.value != null ? fmt.money(p.value, p.ccy, 0) : ""}</td><td>${esc(p.brokerShort)}</td></tr>`).join("");
      }catch(e){ status = t("с этим сопоставлением файл не разбирается", "the file cannot be parsed with this mapping"); }
    } else status = t("укажите наименование или тикер и количество или стоимость", "choose a name or ticker, and a quantity or value");

    wrap.innerHTML = `<div class="card mapper">
      <div class="sec-h"><h2>${t("Сопоставьте колонки", "Map columns")}</h2><span class="aside">${esc(file.name)}</span>
        <span class="spacer"></span><button class="btn small" data-x="close" type="button">${t("Закрыть", "Close")}</button></div>
      ${sheets.length > 1 ? `<div class="seg" style="margin-bottom:10px">${sheets.map((sh, i) =>
        `<button type="button" data-sheet="${i}" aria-pressed="${i === si}">${esc(sh.name)}</button>`).join("")}</div>` : ""}
      <p class="muted" style="margin:0 0 8px">${t("Нажмите строку с заголовками — всё, что ниже, считается данными.", "Click the header row. Everything below it is treated as data.")}</p>
      <div class="table-wrap"><table class="prev">${rows.slice(0, 8).map((r, i) =>
        `<tr class="hdr${i === head.row ? " on" : ""}" data-row="${i}">${Array.from({length: width},
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
  wrap.addEventListener("click", async e => {
    if(e.target === wrap) return close();
    const tr = e.target.closest("tr.hdr");
    if(tr){ head = {row: +tr.dataset.row, map: WL.sheetMap(sheets[si].rows[+tr.dataset.row] || [])}; return render(); }
    const b = e.target.closest("button"); if(!b) return;
    if(b.dataset.sheet != null){
      si = +b.dataset.sheet;
      head = autoHead(si);
      return render();
    }
    if(b.dataset.x === "auto"){ head = {row: head.row, map: WL.sheetMap(sheets[si].rows[head.row] || [])}; return render(); }
    if(b.dataset.x === "close") return close();
    if(b.dataset.x === "ok"){
      const doc = WL.sheetDoc(sheets[si].rows, head, file, sheets[si].ctx);
      if(!doc.positions.length){ toast(t("Позиций не нашлось — выберите другую таблицу или колонки", "No positions found — pick another table or columns")); return; }
      doc.sheetIndex = si; doc.head = {row: head.row, map: {...head.map}};
      doc.note = [doc.note, pre && pre.pdf ? t("таблица взята из PDF, колонки проверены", "table read from PDF, columns reviewed")
        : t("колонки размечены вручную", "columns mapped manually")].filter(Boolean).join(" · ");
      S_SHEETS[file.name] = {file, sheets, sheetIndex: si, head: doc.head};
      S.docs = S.docs.filter(d => d.fileName !== doc.fileName &&
        !(d.broker === doc.broker && d.asOf === doc.asOf && d.periodFrom === doc.periodFrom));
      S.docs.push(doc);
      if(!S.rid) S.rid = newRid();
      save(); close();
      toast(`${file.name}: ${doc.positions.length} ${WL.pl(doc.positions.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}`);
      await refresh();
    }
  });
  render();
}

/* ── Детали позиции ───────────────────────────────────────────────────── */
function openDrawer(id){
  const P = S.P, p = P.positions.find(x => x.id === id); if(!p) return;
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
  $("#closeDrawer").onclick = closeDrawer; $("#closeDrawer").focus();
}
function closeDrawer(){ $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); }

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
  if(!confirm(t("Убрать выписки этого клиента с этого компьютера?", "Remove this client's statements from this computer?"))) return;
  S.docs = []; S.P = null; S.rid = null; localStorage.removeItem(STORE); renderUpload();
};
$("#client").oninput = e => { S.client = e.target.value.trim() || DEFAULT_CLIENT; save(); renderHero(); };
$("#scrim").onclick = closeDrawer;
document.addEventListener("keydown", e => {
  if(e.key === "Escape") closeDrawer();
  if(e.key === "Enter" && e.target.matches && e.target.matches("tr.row")) openDrawer(e.target.dataset.id);
});
document.addEventListener("click", e => { const r = e.target.closest && e.target.closest("tr.row"); if(r) openDrawer(r.dataset.id); });
["dragenter", "dragover"].forEach(t => window.addEventListener(t, e => { e.preventDefault(); const d = $("#drop"); if(d) d.classList.add("over"); }));
window.addEventListener("dragleave", e => { if(!e.relatedTarget){ const d = $("#drop"); if(d) d.classList.remove("over"); } });
window.addEventListener("drop", e => { e.preventDefault(); const d = $("#drop"); if(d) d.classList.remove("over"); if(e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

WL.app = {addFiles, state: S, locked, openCheckout};
(async function boot(){
  if(new URLSearchParams(location.search).has("demo") && WL.demoDocs){
    S.demo = true; S.client = t("Демо-клиент", "Demo client"); S.docs = WL.demoDocs(WL.lang);
    track("ViewContent", {content_name: "demo_report"});
    return refresh();
  }
  load();
  await handlePaymentReturn();
  if(!S.docs.length) return renderUpload();
  await recoverPendingPayment();
  if(locked()) track("ViewContent", {content_name: "report_preview", value: PRICE.amount, currency: PRICE.currency});
  return refresh();
})();
})();
