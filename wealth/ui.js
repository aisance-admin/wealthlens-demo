/* Флоу велса · экран. Один путь: загрузил выписки → увидел главное → разобрал детали → отчёт.
   Сначала показываем то, что есть в выписках, затем по мере прихода докладываем
   текущие цены и историю. Ничего не ждём, чтобы начать работать. */
(function(){
const WL = window.WL;
const {fmt, esc} = WL;
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const STORE = "wl_wealth_v1";
const LEVEL = {high: "Важно", watch: "Внимание", info: "К сведению"};
const TYPE_RU = {stock: "Акции", fund: "Фонды", bond: "Облигации", note: "Ноты", other: "Прочее",
  option: "Опционы", future: "Фьючерсы", cash: "Деньги"};
// Сверка остатков Swissquote идёт в валюте счёта: франки не должны печататься долларами.
const ccyOf = c => c.ccy || (/Остаток ([A-Z]{3})/.exec(c.label || "") || [])[1] || "USD";
const S = {docs: [], P: null, period: "1d", filter: "all", broker: "all", bench: "SPY", client: "Клиент", showPast: false};

const save = () => { try{ localStorage.setItem(STORE, JSON.stringify({client: S.client, docs: S.docs})); }catch(e){} };
const load = () => { try{ const v = JSON.parse(localStorage.getItem(STORE) || "null"); if(v && v.docs){ S.docs = v.docs; S.client = v.client || S.client; } }catch(e){} };
const toast = msg => { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); };

/* ── Загрузка ─────────────────────────────────────────────────────────── */
function renderUpload(){
  $("#bar").hidden = true;
  $("#app").innerHTML = `<div class="drop" id="drop">
    <div class="eyebrow">WealthLens · портфель клиента</div>
    <h1>Загрузите выписки клиента</h1>
    <p>Можно сразу несколько файлов. PDF читается у Charles Schwab и Swissquote; выгрузка CSV или Excel — у любого брокера, колонки распознаются сами.</p>
    <button class="btn primary" id="pick" type="button">Выбрать файлы</button>
    <button class="btn small" id="tplBtn" type="button" style="margin-left:8px">Шаблон CSV</button>
    <p class="hint">Или перетащите файлы сюда. Выписки разбираются в этом браузере и никуда не отправляются: наружу уходят только тикеры и названия компаний — для котировок и новостей.</p>
    <div class="progress" id="progress" aria-live="polite"></div></div>`;
  $("#pick").onclick = () => $("#file").click();
  // Шаблон для тех, у кого выгрузки нет: заполнить в Excel и принести сюда.
  $("#tplBtn").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + WL.sheetTemplate()], {type: "text/csv;charset=utf-8"}));
    a.download = "wealthlens-шаблон.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}
async function addFiles(files){
  const list = [...files].filter(f => /\.(pdf|csv|tsv|txt|xlsx|xls)$/i.test(f.name) || f.type === "application/pdf");
  if(!list.length){ toast("Нужны PDF-выписки или выгрузки CSV и Excel"); return; }
  const prog = $("#progress");
  const pending = [];      // таблицы, которые надо разметить руками
  for(const f of list){
    if(prog) prog.insertAdjacentHTML("beforeend", `<div>Читаю ${esc(f.name)}…</div>`);
    try{
      const doc = await WL.parseFile(f);
      if(doc.unknown){
        // Таблицу, которую не удалось разметить самим, отдаём пользователю: он покажет колонки.
        if(doc.sheets){ pending.push({file: f, sheets: doc.sheets}); continue; }
        toast(`${f.name}: формат выписки пока не распознаётся`);
        continue;
      }
      if(doc.from === "sheet" && doc.sheets)
        S_SHEETS[f.name] = {file: f, sheets: doc.sheets, sheetIndex: doc.sheetIndex, head: doc.head};
      S.docs = S.docs.filter(d => !(d.broker === doc.broker && d.asOf === doc.asOf && d.periodFrom === doc.periodFrom));
      S.docs.push(doc);
    }catch(e){ toast(`${f.name}: не удалось прочитать файл`); }
  }
  const askMapping = () => { const p = pending.shift(); if(p) openMapper(p.file, p.sheets, null, askMapping); };
  if(!S.docs.length){ renderUpload(); askMapping(); return; }
  save();
  await refresh();
  askMapping();
}

/* ── Портфель ─────────────────────────────────────────────────────────── */
let historyTimer = null;
async function loadHistory(attempt = 0){
  const P = S.P; if(!P) return;
  const syms = [...new Set(P.positions.filter(p => WL.eq(p) && p.symbol).map(p => p.symbol))];
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
  $("#docChips").innerHTML = S.docs.map(d => `<span class="pill ${d.checks.every(c => c.ok) ? "ok" : "bad"}" title="${esc(d.fileName)}">${esc(d.brokerShort)} · ${fmt.date(d.asOf)}</span>`).join(" ");
  if(!$("#insights")){
    $("#app").innerHTML = `
      <div class="print-head"><h1 id="printTitle"></h1><p class="muted" id="printSub"></p></div>
      <div class="hero"><div class="card broker total" id="total"></div><div class="brokers" id="brokers"></div></div>
      <section><div class="sec-h"><h2>Главное</h2><span class="aside">выводы только по тому, что есть в выписках и котировках</span></div><div class="insights" id="insights"></div></section>
      <section><div class="sec-h"><h2>Структура портфеля</h2><span class="aside" id="structAside"></span></div><div class="struct" id="structure"></div></section>
      <section><div class="sec-h"><h2>Сроки</h2><span class="aside">экспирации, ролловеры фьючерсов</span></div><div class="card tl" id="timeline"></div></section>
      <section><div class="sec-h"><h2>Позиции</h2><span class="aside" id="posAside"></span></div>
        <div class="toolbar no-print"><div class="seg" id="periods" role="group" aria-label="Период изменения"></div><div class="seg" id="filters" role="group" aria-label="Тип"></div><div class="seg" id="venues" role="group" aria-label="Брокер"></div></div>
        <div class="card table-wrap" id="positions"></div></section>
      <section class="print-only" id="printPeriods"></section>
      <section><div class="sec-h"><h2>Акции против бенчмарка</h2><span class="spacer"></span>
        <label class="no-print muted">Бенчмарк <select id="bench">${WL.BENCH.map(b => `<option value="${b[0]}">${esc(b[1])}</option>`).join("")}</select></label></div>
        <div class="card chart-card" id="chart"></div></section>
      <section id="market"></section>
      <section><div class="sec-h"><h2>Документы и чего не хватает</h2></div><div class="docs"><div class="card doc" id="docs"></div><div class="card miss" id="missing"></div></div></section>
      <section class="print-only" id="printNotes"></section>`;
    $("#bench").onchange = async e => { S.bench = e.target.value; $("#chart").innerHTML = `<p class="muted">Загружаю историю…</p>`; await WL.fetchHistory(S.P, [S.bench]); renderChart(); };
    WL.renderMarket($("#market"), S.P);   // один раз: лента и новости не должны перезагружаться при каждом обновлении цен
  }
  $("#bench").value = S.bench;
  renderHero(); renderInsights(); renderStructure(); renderTimeline(); renderControls(); renderPositions(); renderChart(); renderDocs();
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
  const mixed = byDoc.some(x => x.stale) && byDoc.some(x => !x.stale);
  // Без связи с сервером данных суммы честно считаются по выпискам, а позиции в других
  // валютах не пересчитать — об этом надо сказать, а не молча выкинуть их из итога.
  const warn = !P.live ? [] : [!P.live.ok && "Сервер котировок не ответил: суммы по ценам из выписок",
    !P.live.fx && P.positions.some(p => p.ccy !== "USD") && "курсы валют не загрузились: позиции не в долларах в итог не вошли"].filter(Boolean);
  $("#total").innerHTML = `<div class="eyebrow">Всего в долларах</div>
    <div class="value">${fmt.money(total, "USD", 0)}</div>
    <div class="sub">${mixed ? byDoc.map(x => `${esc(x.d.brokerShort)} — ${x.stale ? "на " + fmt.date(x.d.asOf) : "сейчас"}`).join(" · ") : "по текущим ценам"}</div>
    ${P.live && day ? `<div class="sub" style="margin-top:6px">За день: <b class="${day > 0 ? "up" : "down"}">${fmt.signed(day)}</b> <span class="muted">по акциям, котировки CBOE</span></div>` : ""}
    ${!P.live ? `<div class="sub muted" style="margin-top:6px">Загружаю текущие цены…</div>` : ""}
    ${warn.length ? `<div class="sub down" style="margin-top:6px">${esc(warn.join("; "))}.</div>` : ""}`;
  $("#brokers").innerHTML = byDoc.map(x => {
    const bad = x.d.checks.filter(c => !c.ok).length;
    return `<div class="card broker"><div class="name">${esc(x.d.broker)}
        <span class="pill ${bad ? "bad" : "ok"}">${bad ? `не сошлось: ${bad}` : x.d.from === "sheet" ? "сошлось с итогом файла" : "сверено с банком"}</span>
        ${x.stale ? `<span class="pill stale">${WL.days(x.d.asOf, P.today)} дн. назад</span>` : x.live ? `<span class="pill live">цены сейчас</span>` : ""}</div>
      <div class="v">${fmt.money(x.usd, "USD", 0)}</div>
      <div class="meta">${x.d.kind === "ledger" ? `журнал за ${fmt.date(x.d.periodFrom)}–${fmt.date(x.d.asOf)}`
        : `${x.d.from === "sheet" ? "выгрузка" : "выписка"} на ${fmt.date(x.d.asOf)}`} ·
        ${x.ps.length} ${WL.plural(x.ps.length, "позиция", "позиции", "позиций")}</div></div>`;
  }).join("");
  $("#printTitle").textContent = `${S.client} — портфель`;
  $("#printSub").textContent = `Отчёт на ${fmt.date(TODAY)} · ${S.docs.map(d => `${d.brokerShort}: ${d.kind === "ledger" ? "журнал до" : "выписка на"} ${fmt.date(d.asOf)}`).join(" · ")}`;
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
  const TYPE = {stock: "Акции", fund: "Фонды", bond: "Облигации", note: "Структурные ноты", other: "Прочее",
    option: "Опционы проданные", future: "Фьючерсы", cash: "Деньги"};
  const block = (title, items) => `<div class="card sblock"><div class="eyebrow">${title}</div>` + items.map(([name, v]) => {
    const share = v > 0 && assets ? v / assets * 100 : null;
    return `<div class="srow"><div class="sname">${esc(name)}</div><div class="sbar">${share != null ? `<i style="width:${Math.max(share, 0.6).toFixed(1)}%"></i>` : ""}</div>` +
      `<div class="sval ${v < 0 ? "down" : ""}">${fmt.short(v)}</div><div class="spct">${share != null ? Math.round(share) + "%" : "—"}</div></div>`;
  }).join("") + `</div>`;
  el.innerHTML = block("По брокерам", group(p => p.brokerShort)) + block("По типам", group(p => TYPE[p.type] || p.type)) + block("По валютам", group(p => p.ccy));
  const stale = P.docs.filter(d => WL.days(d.asOf, P.today) > 45);
  $("#structAside").textContent = `в долларах${stale.length ? `; ${stale.map(d => `${d.brokerShort} — на ${fmt.date(d.asOf)}`).join(", ")}` : " по текущим ценам"}; фьючерсы учтены через деньги счёта`;
}

function renderInsights(){
  const I = WL.insights(S.P);
  $("#insights").innerHTML = I.length ? I.map(x => `<article class="card insight">
      <span class="lvl ${x.level}">${LEVEL[x.level]}</span><h3>${esc(x.title)}</h3>
      ${x.text ? `<p>${esc(x.text)}</p>` : ""}
      ${x.lines ? `<ul>${x.lines.map(l => `<li><b>${esc(l.text)}</b><span class="note ${l.level === "high" ? "high" : ""}">${esc(l.note || "")}</span></li>`).join("")}</ul>` : ""}
      <div class="basis">Основа: ${esc(x.basis)}</div></article>`).join("")
    : `<p class="muted">По загруженным выпискам нет поводов для внимания.</p>`;
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
      status = `<span class="pill ${itm ? "bad" : "ok"}">${itm ? "в деньгах" : "вне денег"}</span>`;
    }
    if(d < 0) status = `<span class="pill stale">статус неизвестен</span>`;
    const kind = e.kind === "roll" ? "ролловер" : "экспирация";
    return `<div class="tl-row ${d < 0 ? "past" : ""}"><span class="tl-date">${fmt.date(e.date)}</span>
      <span class="${d >= 0 && d <= 14 ? "down" : "muted"}">${d >= 0 ? `через ${d} ${WL.plural(d, "день", "дня", "дней")}` : "прошло"}</span>
      <span>${esc(p ? p.name : "")} <span class="muted">· ${kind} · ${esc(p ? p.brokerShort : "")}</span></span>${status}</div>`;
  };
  $("#timeline").innerHTML = (upcoming.length ? upcoming.map(row).join("") : `<div class="tl-row"><span class="muted">Впереди сроков нет</span></div>`) +
    (past.length ? `<div class="tl-more no-print"><button class="btn small" id="pastBtn" type="button">${S.showPast ? "Скрыть" : "Показать"} прошедшие после даты выписки: ${past.length}</button></div>` +
      (S.showPast ? past.map(row).join("") : "") : "");
  const b = $("#pastBtn"); if(b) b.onclick = () => { S.showPast = !S.showPast; renderTimeline(); };
}

function renderControls(){
  const types = ["all", ...["stock", "fund", "bond", "note", "other", "option", "future", "cash"]
    .filter(t => S.P.positions.some(p => p.type === t))];
  $("#periods").innerHTML = WL.PERIODS.map(p => `<button type="button" data-per="${p.id}" aria-pressed="${S.period === p.id}">${p.label}</button>`).join("");
  $("#filters").innerHTML = types.map(t => `<button type="button" data-f="${t}" aria-pressed="${S.filter === t}">${t === "all" ? "Все" : TYPE_RU[t]}</button>`).join("");
  $("#periods").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.period = b.dataset.per; renderControls(); renderPositions(); renderChart(); };
  $("#filters").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.filter = b.dataset.f; renderControls(); renderPositions(); };
  // Портфель по умолчанию общий; разбивка по площадкам — по желанию, поэтому переключатель
  // появляется, только когда брокеров больше одного.
  const brokers = [...new Set(S.P.positions.map(p => p.brokerShort))];
  $("#venues").hidden = brokers.length < 2;
  $("#venues").innerHTML = ["all", ...brokers].map(b =>
    `<button type="button" data-b="${esc(b)}" aria-pressed="${S.broker === b}">${b === "all" ? "Все площадки" : esc(b)}</button>`).join("");
  $("#venues").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.broker = b.dataset.b; renderControls(); renderPositions(); };
}
function renderPositions(){
  WL.renderPositions($("#positions"), S.P, S);
  const L = S.P.live;
  $("#posAside").textContent = !L ? "цены из выписок" : !L.ok ? "цены из выписок: сервер котировок не ответил" :
    `текущие цены CBOE с задержкой · ${L.fxDate ? `курсы ЕЦБ на ${fmt.date(L.fxDate)}` : "курсы валют не загрузились"}`;
  renderPrintExtras();
}

/* Только для печати. На экране период выбирается переключателем, а в PDF выбора нет,
   поэтому отчёт показывает изменение сразу за все периоды и называет источники. */
const PERIOD_NOTE = {"1d": "акции: к закрытию прошлого дня", "1m": "акции: к цене месяц назад",
  "3m": "акции: к цене три месяца назад", "1y": "акции: к цене год назад", "5y": "акции: к цене пять лет назад",
  "all": "акции: к первой цене в истории CBOE", "stmt": "акции и опционы Schwab: к цене в выписке",
  "cost": "акции и опционы: к себестоимости из выписки"};
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
  pe.innerHTML = `<div class="sec-h"><h2>Изменение по периодам</h2><span class="aside">текущее количество бумаг, сумма по позициям, где есть данные</span></div>
    <div class="card"><table class="pos"><thead><tr><th class="l">Период</th><th>Изменение</th><th>Есть данные</th><th class="l">Как считается</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td class="l">${esc(r.per.label)}</td><td><span class="${r.abs > 0 ? "up" : r.abs < 0 ? "down" : ""}">${r.covered ? fmt.signed(r.abs) : "—"}</span></td>` +
      `<td>${r.covered} из ${r.countable}</td><td class="l">${esc(PERIOD_NOTE[r.per.id] || "")}</td></tr>`).join("") + `</tbody></table></div>`;
  const at = P.live && P.live.ok ? new Date(P.live.at).toLocaleString("ru-RU", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"}) : null;
  pn.innerHTML = `<div class="sec-h"><h2>Источники и оговорки</h2></div><div class="card doc"><ul class="notes">
    <li>Позиции, количества, себестоимость и комиссии — из выписок брокеров. Разбор сверен с итогами самих выписок, результаты сверки — в разделе «Документы».</li>
    <li>${at ? `Текущие цены — CBOE с задержкой около 15 минут, получены ${esc(at)}. ${P.live.fxDate ? `Курсы валют — ЕЦБ на ${fmt.date(P.live.fxDate)}.` : "Курсы валют не загрузились."}` : "Текущие цены не загружались: все суммы — по данным выписок."}</li>
    <li>История цен — дневные цены закрытия CBOE без учёта дивидендов. График показывает, как менялся бы текущий состав акций; это не фактическая история счёта: сделки и ввод-вывод денег не учитываются.</li>
    <li>Даты экспираций опционов и первого дня уведомления по фьючерсам CME рассчитаны по правилам биржи без учёта праздников.</li>
    <li>Данные Swissquote — на дату журнала операций. Что открыто на этом счёте сейчас, из журнала не видно.</li>
    <li>Рынок: индексы, VIX, доходности казначейских облигаций США и фонды GLD, BNO, IBIT — CBOE с задержкой; курсы валют — ЕЦБ.</li>
    <li>Новости рынка — RSS Investing.com, «Ведомости», «Коммерсантъ», CNBC и MarketWatch. Новости по бумагам клиента — Google News за неделю, отобраны по названию компании и биржевому обозначению.</li>
    <li>Отчёт носит информационный характер и не является инвестиционной рекомендацией.</li></ul></div>`;
}
const renderChart = () => WL.renderChart($("#chart"), S.P, S);

function renderDocs(){
  const P = S.P;
  $("#docs").innerHTML = S.docs.map(d => `<div style="margin-bottom:14px">
      <div class="name" style="font-weight:600">${esc(d.broker)}</div>
      <div class="muted" style="font-size:12.5px">${esc(d.fileName)} · ${d.kind === "ledger" ? `журнал операций, ${d.records.length} строк, ${d.trades.length} сделок${d.cancelled.length ? `, отменено банком: ${d.cancelled.length}` : ""}` : `${d.from === "sheet" ? "выгрузка таблицей" : "снимок"}, позиции на ${fmt.date(d.asOf)}`}${d.note ? " · " + esc(d.note) : ""}</div>
      ${d.checks.map(c => `<div class="check"><span>${c.ok ? "✓" : "✗"} ${esc(c.label)}</span><span class="num ${c.ok ? "" : "down"}">${c.count ? `${c.parsed} из ${c.stated}` : `${fmt.money(c.parsed, ccyOf(c))}${c.ok ? "" : " ≠ " + fmt.money(c.stated, ccyOf(c))}`}</span></div>`).join("")}
      ${d.from === "sheet" && S_SHEETS[d.fileName] ? `<button class="btn small no-print" type="button" data-remap="${esc(d.fileName)}" style="margin-top:8px">Сопоставить колонки</button>` : ""}
    </div>`).join("");
  $("#docs").onclick = e => {
    const b = e.target.closest("[data-remap]"); if(!b) return;
    const st = S_SHEETS[b.dataset.remap];
    if(st) openMapper(st.file, st.sheets, st);
  };
  const M = WL.missing(P);
  $("#missing").innerHTML = `<div class="sec-h" style="margin:12px 0 4px"><span class="eyebrow">Чего не хватает</span><span class="spacer"></span>
      <button class="btn small no-print" id="askBtn" type="button">Скопировать запрос</button></div>` +
    M.map(m => `<div class="miss-row"><div class="t">${esc(m.broker)}: ${esc(m.title)}</div>
      <div class="d">Влияет на: ${esc(m.affects)}.</div><div class="d muted">Сейчас: ${esc(m.now)}.</div></div>`).join("");
  $("#askBtn").onclick = async () => {
    try{ await navigator.clipboard.writeText(WL.requestText(M)); toast("Текст запроса скопирован"); }
    catch(e){ toast("Не удалось скопировать — браузер запретил доступ к буферу"); }
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
      return h ? h.slice(0, 30) : `Колонка ${c + 1}`; };
    const ready = (head.map.name != null || head.map.ticker != null) && (head.map.qty != null || head.map.value != null);
    let preview = "", status;
    if(ready){
      try{
        const d = WL.sheetDoc(rows, head, file);
        const bad = d.checks.filter(c => !c.ok).length;
        status = `${d.positions.length} ${WL.plural(d.positions.length, "позиция", "позиции", "позиций")}` +
          (d.checks.length > 1 ? (bad ? " · с итогом файла не сходится" : " · сходится с итогом файла") : "") +
          (d.note ? " · " + d.note : "");
        preview = d.positions.slice(0, 5).map(p => `<tr><td>${esc(p.name)}</td><td>${esc(TYPE_RU[p.type] || p.type)}</td>` +
          `<td>${esc(p.symbol || "")}</td><td>${p.qty != null ? fmt.qty(p.qty) : ""}</td>` +
          `<td>${p.value != null ? fmt.money(p.value, p.ccy, 0) : ""}</td><td>${esc(p.brokerShort)}</td></tr>`).join("");
      }catch(e){ status = "с этим сопоставлением файл не разбирается"; }
    } else status = "укажите наименование или тикер и количество или стоимость";

    wrap.innerHTML = `<div class="card mapper">
      <div class="sec-h"><h2>Сопоставьте колонки</h2><span class="aside">${esc(file.name)}</span>
        <span class="spacer"></span><button class="btn small" data-x="close" type="button">Закрыть</button></div>
      ${sheets.length > 1 ? `<div class="seg" style="margin-bottom:10px">${sheets.map((sh, i) =>
        `<button type="button" data-sheet="${i}" aria-pressed="${i === si}">${esc(sh.name)}</button>`).join("")}</div>` : ""}
      <p class="muted" style="margin:0 0 8px">Нажмите строку с заголовками — всё, что ниже, считается данными.</p>
      <div class="table-wrap"><table class="prev">${rows.slice(0, 8).map((r, i) =>
        `<tr class="hdr${i === head.row ? " on" : ""}" data-row="${i}">${Array.from({length: width},
          (_, c) => `<td>${esc(String(r[c] ?? "").slice(0, 22))}</td>`).join("")}</tr>`).join("")}</table></div>
      <div class="map-grid">${WL.sheetFields.map(([f, label]) => `<label>${label}
        <select data-f="${f}"><option value="">— нет —</option>${Array.from({length: width}, (_, c) =>
          `<option value="${c}"${head.map[f] === c ? " selected" : ""}>${esc(colLabel(c))}</option>`).join("")}</select></label>`).join("")}</div>
      <div class="sec-h" style="margin:14px 0 0"><b>Получится</b><span class="aside">${esc(status)}</span><span class="spacer"></span>
        <button class="btn small" data-x="auto" type="button">Подобрать заново</button>
        <button class="btn primary small" data-x="ok" type="button"${ready ? "" : " disabled"}>Импортировать</button></div>
      ${preview ? `<div class="table-wrap" style="margin-top:8px"><table class="prev"><tr><th>Бумага</th><th>Тип</th><th>Тикер</th><th>Кол-во</th><th>Стоимость</th><th>Брокер</th></tr>${preview}</table></div>` : ""}
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
      const doc = WL.sheetDoc(sheets[si].rows, head, file);
      doc.sheetIndex = si; doc.head = {row: head.row, map: {...head.map}};
      doc.note = [doc.note, "колонки размечены вручную"].filter(Boolean).join(" · ");
      S_SHEETS[file.name] = {file, sheets, sheetIndex: si, head: doc.head};
      S.docs = S.docs.filter(d => d.fileName !== doc.fileName &&
        !(d.broker === doc.broker && d.asOf === doc.asOf && d.periodFrom === doc.periodFrom));
      S.docs.push(doc);
      save(); close();
      toast(`${file.name}: ${doc.positions.length} ${WL.plural(doc.positions.length, "позиция", "позиции", "позиций")}`);
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
  add("Брокер", esc(p.broker));
  const contracts = p.type === "option" || p.type === "future";
  if(p.type !== "cash" && p.qty != null) add("Количество", fmt.qty(p.qty) + (contracts ? " контр." : ""));
  if(!contracts && p.type !== "cash") add("Цена покупки", p.cost != null ? `${fmt.px(p.cost / p.qty)} (средняя из себестоимости ${fmt.money(p.cost)})` : `<span class="unk">${esc(p.costNote || "нет в выписке")}</span>`);
  if(p.premium != null) add("Премия всего", fmt.money(p.premium, p.ccy));
  add("Дата покупки", p.purchaseDate ? fmt.date(p.purchaseDate) + (p.purchaseNote ? ` <span class="muted">(${esc(p.purchaseNote)})</span>` : "") : p.type === "cash" ? null : `<span class="unk">нет в выписке</span>`);
  if(p.type !== "cash") add("Комиссии", p.commission != null ? fmt.money(p.commission, p.ccy) : `<span class="unk">нет в выписке</span>`);
  if(p.price != null) add(`Цена на ${fmt.date(p.priceDate)}`, fmt.px(p.price));
  if(cur.live) add("Цена сейчас", `${fmt.px(cur.price)}${p.live.bid != null ? ` <span class="muted">(bid ${fmt.px(p.live.bid)} / ask ${fmt.px(p.live.ask)})</span>` : ""}`);
  if(p.underlyingLive != null) add(`${esc(p.underlying)} сейчас`, fmt.px(p.underlyingLive));
  add("Стоимость", cur.value != null ? fmt.money(cur.value, p.ccy) : `<span class="unk">${esc(p.valueNote || "нет в выписке")}</span>`);
  if(cur.value != null && k != null && p.ccy !== "USD") add("В долларах", fmt.money(cur.value * k));
  if(p.notional != null) add("Номинал", fmt.money(p.notional, p.ccy, 0));
  if(p.type === "option" && p.qty < 0 && p.multiplier) add(p.right === "P" ? "Обязательство купить" : "Обязательство продать", fmt.money(Math.abs(p.qty) * p.multiplier * p.strike, p.ccy, 0));
  if(p.firstNotice) add("Первый день уведомления", fmt.date(p.firstNotice) + " <span class='muted'>— переложить до</span>");
  if(p.expiry) add(p.type === "future" ? "Последний торговый день" : "Экспирация", fmt.date(p.expiry));
  if(p.unrealized != null) add(`Результат к покупке на ${fmt.date(p.priceDate)}`, fmt.money(p.unrealized));
  const changes = p.type === "cash" ? "" : `<h4 style="margin:18px 0 6px">Изменение за периоды</h4><table class="mini">` +
    WL.PERIODS.map(per => { const c = WL.change(P, p, per.id); return `<tr><td class="l">${per.label}</td><td class="${c && c.abs > 0 ? "up" : c && c.abs < 0 ? "down" : ""}">${c ? fmt.signed(c.abs, p.ccy) : "<span class='unk'>нет данных</span>"}</td><td>${c && c.pct != null ? fmt.pct(c.pct) : ""}</td></tr>`; }).join("") + `</table>`;
  const trades = p.trades && p.trades.length ? `<h4 style="margin:18px 0 6px">Сделки из журнала: ${p.trades.length}</h4><table class="mini"><tr><th class="l">Дата</th><th class="l">Операция</th><th>Кол-во</th><th>Премия</th><th>Комиссия</th><th>Сбор</th></tr>` +
    p.trades.map(t => `<tr><td class="l">${fmt.date(t.date)}</td><td class="l">${t.assigned ? "исполнение" : t.side === "Buy" ? "покупка" : "продажа"}</td><td>${t.qty}</td><td>${t.premium ? fmt.money(t.premium, t.ccy) : ""}</td><td>${fmt.money(t.commission, t.ccy)}</td><td>${fmt.money(t.exchFees, t.ccy)}</td></tr>`).join("") + `</table>` : "";
  $("#drawer").innerHTML = `<button class="btn small" id="closeDrawer" type="button" style="float:right">Закрыть</button>
    <div class="eyebrow">${esc(TYPE_RU[p.type])} · ${esc(p.brokerShort)}</div><h3>${esc(p.name)}</h3>
    <div class="code">${esc(p.occ || p.code || p.symbol || "")}</div>
    <dl class="kv">${kv.join("")}</dl>${changes}${trades}
    <p class="basis">Источник: ${esc(p.source)}${cur.live ? " · текущие цены CBOE с задержкой" : ""}</p>`;
  $("#drawer").classList.add("open"); $("#scrim").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false");
  $("#closeDrawer").onclick = closeDrawer; $("#closeDrawer").focus();
}
function closeDrawer(){ $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); }

/* ── События ──────────────────────────────────────────────────────────── */
$("#file").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
$("#addBtn").onclick = () => $("#file").click();
$("#printBtn").onclick = () => window.print();
$("#resetBtn").onclick = () => { if(!confirm("Убрать выписки этого клиента с этого компьютера?")) return; S.docs = []; S.P = null; localStorage.removeItem(STORE); renderUpload(); };
$("#client").oninput = e => { S.client = e.target.value.trim() || "Клиент"; save(); renderHero(); };
$("#scrim").onclick = closeDrawer;
document.addEventListener("keydown", e => {
  if(e.key === "Escape") closeDrawer();
  if(e.key === "Enter" && e.target.matches && e.target.matches("tr.row")) openDrawer(e.target.dataset.id);
});
document.addEventListener("click", e => { const r = e.target.closest && e.target.closest("tr.row"); if(r) openDrawer(r.dataset.id); });
["dragenter", "dragover"].forEach(t => window.addEventListener(t, e => { e.preventDefault(); const d = $("#drop"); if(d) d.classList.add("over"); }));
window.addEventListener("dragleave", e => { if(!e.relatedTarget){ const d = $("#drop"); if(d) d.classList.remove("over"); } });
window.addEventListener("drop", e => { e.preventDefault(); const d = $("#drop"); if(d) d.classList.remove("over"); if(e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

WL.app = {addFiles, state: S};
load();
if(S.docs.length) refresh(); else renderUpload();
})();
