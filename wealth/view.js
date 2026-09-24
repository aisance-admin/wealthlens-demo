/* WealthLens · экраны. Всё, что пришло из выписок и от ИИ, выводится только через esc(): текст документа не может
   стать разметкой страницы. */
(function(){
const WL = window.WL, t = WL.t, esc = WL.esc, fmt = WL.fmt, $ = WL.$;
const S = () => WL.state, M = () => WL.model;
const LVL = {high: t("Важно", "Important"), watch: t("Внимание", "Watch"), info: t("К сведению", "Note")};
const TYPE = {portfolio: t("портфельная выписка", "portfolio statement"), bank: t("банковская выписка", "bank statement"), brokerage: t("брокерская выписка", "brokerage statement"),
  transactions: t("список операций", "transaction list"), other_financial: t("финансовый документ", "financial document"), not_financial: t("не выписка", "not a statement")};
const WHY = {not_financial: t("это не выписка — в отчёт не входит", "not a statement — not included"), no_positions: t("позиций и остатков в файле нет", "no holdings or balances in the file"),
  unread: t("файл не прочитан", "the file was not read"), older: t("выписка из истории — состав берётся из свежей, эта — в динамике за период", "a statement from the history — holdings come from the newer one, this one feeds the period changes"),
  duplicate: t("та же выписка ещё раз — учтена одна", "the same statement again — counted once"), removed: t("вы убрали его из отчёта", "you removed it from the report")};
const ICON = {
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l2.9 2.8 6.1-6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l6.2 11H1.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  dash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5.3a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  spark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z" fill="currentColor"/></svg>',
  file: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 2v3.3h3.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
};
const money = (v, d = 0) => fmt.money(v, M().base, d);
const pos = id => M().positions.find(p => p.id === id);
const docOf = id => M().docs.find(d => d.id === id);
const locked = () => WL.pay.locked();
const FREE_ROWS = 5;

/* ── Экран загрузки ──────────────────────────────────────────────────── */
function upload(){
  return `<section class="start">
    <div class="drop" id="drop">
      <div class="mark"></div>
      <h1>${t("Положите выписки — получите один понятный отчёт", "Drop your statements — get one clear report")}</h1>
      <p class="lede">${t("Файлы или целую папку: PDF из банков и от брокеров, сканы и фото, Excel. Мы прочитаем каждую страницу и разложим всё по полочкам: сколько денег, где они лежат, из чего состоит портфель и на что обратить внимание.",
        "Files or a whole folder: PDFs from banks and brokers, scans and photos, Excel. We read every page and lay it all out: how much there is, where it sits, what the portfolio is made of and what needs attention.")}</p>
      <div class="actions">
        <button class="btn primary big" type="button" data-pick="files">${t("Выбрать файлы", "Choose files")}</button>
        <button class="btn big" type="button" data-pick="folder">${t("Выбрать папку", "Choose a folder")}</button>
      </div>
      <p class="hint">${t("или перетащите их сюда · PDF, JPG, PNG, Excel, CSV", "or drag them here · PDF, JPG, PNG, Excel, CSV")}</p>
      <a class="demo-link" href="?demo=1${WL.EN ? "&lang=en" : ""}">${t("Посмотреть пример отчёта", "See a sample report")}</a>
    </div>
    <ol class="how">
      <li><b>${t("Кладёте файлы", "Drop the files")}</b><span>${t("Любые выписки, в любом виде и на любом языке.", "Any statements, in any layout or language.")}</span></li>
      <li><b>${t("Читаем каждую страницу", "We read every page")}</b><span>${t("Как человек: таблицы, итоги, валюты — с помощью ИИ.", "Like a person would: tables, totals, currencies — with AI.")}</span></li>
      <li><b>${t("Получаете отчёт", "You get the report")}</b><span>${t("Здесь в браузере, в PDF и в Excel.", "Here in the browser, as PDF and as Excel.")}</span></li>
    </ol>
    <p class="privacy">${ICON.lock}<span>${t("Выписки читает наша технология на основе ИИ. Мы не храним ни файлы, ни результат: отчёт остаётся в этом браузере.",
      "Statements are read by our AI-based technology. We store neither the files nor the result: the report stays in this browser.")}
      ${WL.pay.ON_SITE ? `<a href="${WL.EN ? "/en" : ""}/legal/privacy/">${t("Подробнее", "Details")}</a>` : ""}</span></p>
  </section>`;
}

/* ── Чтение ─────────────────────────────────────────────────────────── */
function fileLine(f){
  const d = S().docs.find(x => x.fileId === f.id), m = M() && M().docs.find(x => x.id === f.id);
  let meta = "", st = f.status;
  if(f.status === "reading") meta = f.total ? [f.inst, f.found ? t(`найдено ${f.found} ${WL.pl(f.found, ["позиция", "позиции", "позиций"], ["", "", ""])}`, `${f.found} ${f.found === 1 ? "position" : "positions"} found`) : "",
      t(`${f.done || 0} из ${f.total} стр.`, `${f.done || 0} of ${f.total} pages`)].filter(Boolean).join(" · ") : t("открываю файл…", "opening the file…");
  else if(f.status === "queued") meta = t("в очереди", "queued");
  else if(f.status === "skipped" || f.status === "error") meta = f.reason || t("не прочитан", "not read");
  else if(d){
    const parts = [d.institution, TYPE[d.type] || "", d.as_of ? fmt.date(d.as_of) : "", m && m.use ? `${m.positions} ${WL.pl(m.positions, ["позиция", "позиции", "позиций"], ["position", "positions"])}` : (m && WHY[m.why]) || ""];
    meta = parts.filter(Boolean).join(" · ");
    if(d.failed.length) st = "warn";
    else if(m && m.use && m.recon && m.recon.status === "mismatch") st = "warn";
  }
  const pct = f.total ? Math.round(100 * (f.done || 0) / f.total) : 0;
  return `<li class="fl st-${esc(st)}"><span class="fi">${st === "done" ? ICON.check : st === "warn" || st === "error" ? ICON.warn : st === "skipped" ? ICON.dash : '<i class="spin"></i>'}</span>
    <span class="fn">${esc(f.name)}</span><span class="fm">${esc(meta)}</span>
    ${f.status === "reading" ? `<span class="fb"><i style="width:${pct}%"></i></span>` : ""}
    ${/queued|reading/.test(f.status) ? `<button type="button" class="fx" data-cancel="${esc(f.id)}" title="${t("Остановить чтение и убрать файл", "Stop reading and remove the file")}" aria-label="${t("Отменить", "Cancel")} ${esc(f.name)}">×</button>` : ""}</li>`;
}
function readingPanel(){
  const files = S().files, active = files.filter(f => /queued|reading/.test(f.status));
  if(!WL.reading && !active.length) return "";
  const pages = files.reduce((s, f) => s + (f.total || 0), 0), done = files.reduce((s, f) => s + (f.done || 0), 0);
  return `<section class="reading card" id="reading" aria-live="polite">
    <div class="rh"><span class="orb">${ICON.spark}</span><div><h2>${t("Читаем выписки", "Reading your statements")}</h2>
      <p class="muted">${pages ? t(`${done} из ${pages} страниц · отчёт собирается ниже по мере чтения`, `${done} of ${pages} pages · the report builds up below as it reads`) : t("готовлю страницы…", "preparing pages…")}</p></div></div>
    <ul class="files">${files.map(fileLine).join("")}</ul>
  </section>`;
}
WL.renderReading = () => { const el = $("#reading"); if(!el){ if(WL.reading) WL.render(); return; } const html = readingPanel(); if(!html){ WL.render(); return; }
  const tmp = document.createElement("div"); tmp.innerHTML = html; el.replaceWith(tmp.firstElementChild); };

/* ── Отчёт ──────────────────────────────────────────────────────────── */
/* Результат выбранного периода (модель Саши): один расчёт на отрисовку — им пользуются итог, таблица и Excel. */
let perCache = null;
function per(){
  const m = M(); if(!m) return null;
  const id = WL.ui.per || "all", live = liveMode(m), key = [id, live, m.mkt && m.mkt.at, WL.fxsVer || 0].join("|");
  if(!perCache || perCache.m !== m || perCache.key !== key) perCache = {m, key, r: WL.period(m, id, live)};
  return perCache.r;
}
WL.perNow = per;
const sgn = v => v > 0 ? "+" : v < 0 ? "−" : "";
/* Динамика за период — сразу под итогом: переключатель окна и два числа — «заработано» и «изменение стоимости». */
function dynamics(m){
  const r = per();
  if(!r) return "";
  const id = r.id, abs = v => money(Math.abs(v)), stmtEnd = m.dates[m.dates.length - 1];
  const since = id === "all" ? r.start : r.change != null ? r.startDate : r.start;
  const chips = `<div class="chips per no-print" role="group" aria-label="${t("Период", "Period")}">${WL.WINDOWS.map(([k, l]) => `<button type="button" data-per="${k}" aria-pressed="${id === k}">${esc(l)}</button>`).join("")}</div>`;
  const has = r.exact || r.coverage > 0;
  const earned = `<div class="dv"><span class="dl">${t("Заработано", "Earned")}</span>${has
    ? `<b class="${r.earned < 0 ? "dn" : "up"}">${r.exact ? "" : "≈ "}${sgn(r.earned)}${esc(abs(r.earned))}</b>${r.earnedPct != null && isFinite(r.earnedPct) ? `<span class="${r.earned < 0 ? "dn" : "up"}">${sgn(r.earnedPct)}${esc(fmt.pct(Math.abs(r.earnedPct), 1))}</span>` : ""}`
    : `<span class="muted">${t("нет точки отсчёта", "no starting point")}</span>`}</div>`;
  const change = r.change != null ? `<div class="dv"><span class="dl">${t("Изменение стоимости", "Change in value")}${r.startDate !== since ? ` · ${t("с", "since")} ${esc(fmt.date(r.startDate))}` : ""}</span><b>${sgn(r.change)}${esc(abs(r.change))}</b>
      ${r.flows != null && Math.abs(r.flows) >= 1 ? `<span class="muted">${t(`в т.ч. пополнения и снятия ${sgn(r.flows)}${abs(r.flows)}`, `incl. deposits and withdrawals ${sgn(r.flows)}${abs(r.flows)}`)}</span>` : ""}</div>`
    : id === "1d" || id === "1w" ? "" : `<div class="dv"><span class="dl">${t("Изменение стоимости", "Change in value")}</span><span class="muted">${id === "all" || !r.start
      ? t("нужны выписки за прошлые периоды", "needs statements for past periods") : t(`нужна выписка на ${fmt.date(r.start)}`, `needs a statement as of ${fmt.date(r.start)}`)}</span></div>`;
  const n = r.srcCount, src = [n.buy ? t(`цена покупки — ${n.buy}`, `purchase price — ${n.buy}`) : "", n.stmt ? t(`выписка — ${n.stmt}`, `statement — ${n.stmt}`) : "",
    n.mkt ? t(`биржевая цена — ${n.mkt}`, `market price — ${n.mkt}`) : ""].filter(Boolean).join(", ");
  const basis = r.exact ? t(`Основа: выписки на ${fmt.date(r.startDate)} и ${fmt.date(stmtEnd)}${r.live ? ", после выписки — текущие цены" : ""}; пополнения и снятия — из сводок выписок.`,
      `Source: statements as of ${fmt.date(r.startDate)} and ${fmt.date(stmtEnd)}${r.live ? ", current prices after the statement" : ""}; deposits and withdrawals from the statement summaries.`)
    : has ? t(`Оценка по позициям. Точка отсчёта: ${src}${r.coverage < 0.995 ? `; без неё — ${fmt.pct(1 - r.coverage, 0)} вложений` : ""}. Деньги на счетах в «заработано» не входят.`,
      `Estimate from positions. Starting point: ${src}${r.coverage < 0.995 ? `; none for ${fmt.pct(1 - r.coverage, 0)} of holdings` : ""}. Cash balances are not counted as earnings.`)
    : t("Ни у одной бумаги нет точки отсчёта для этого периода: нет выписки на его начало, дат покупки внутри периода и биржевых цен.", "No holding has a starting point for this period: no statement at its start, no purchases inside it and no market prices.");
  const gaps = r.gaps.length ? t(`Нет выписок за ${r.gaps.map(g => fmt.date(g.from) + " – " + fmt.date(g.to)).join(", ")}: пополнения и снятия за это время неизвестны.`,
    `No statements for ${r.gaps.map(g => fmt.date(g.from) + " – " + fmt.date(g.to)).join(", ")}: deposits and withdrawals for that time are unknown.`) : "";
  const breaks = r.breaks.length ? t(`Стоимость на конец выписки на ${r.breaks.map(b => fmt.date(b.date)).join(", ")} не совпала со стоимостью на начало следующей — сверьте выписки.`,
    `The closing value of the statement as of ${r.breaks.map(b => fmt.date(b.date)).join(", ")} doesn't match the opening value of the next one — check the statements.`) : "";
  return `<div class="dyn">${chips}<div class="eyebrow dyh">${esc(r.label)} · ${since ? `${t("с", "since")} ${esc(fmt.date(since))}` : t("с покупки", "since purchase")}${r.live ? ` · ${t("по текущим ценам", "at current prices")}` : ""}</div>
    <div class="dvs">${earned}${change}</div><p class="fine">${esc([basis, gaps, breaks].filter(Boolean).join(" "))}</p></div>`;
}
/* История портфеля: стоимость по датам выписок (и на начало периода первой), график и цепочка выписок с проверкой стыков. */
function historyPoints(lines){
  if(lines.length === 1) return lines[0].points.map(p => ({date: p.date, value: p.value, src: p.src}));
  const dates = [...new Set(lines.flatMap(L => L.points.map(p => p.date)))].sort(), out = [];
  for(const d of dates){
    let sum = 0, ok = true;
    for(const L of lines){ const p = L.points.find(x => Math.abs(WL.dms(x.date) - WL.dms(d)) <= 5 * 864e5); if(!p){ ok = false; break; } sum += p.value; }
    if(ok && !out.some(x => Math.abs(WL.dms(x.date) - WL.dms(d)) <= 5 * 864e5)) out.push({date: d, value: sum, src: "sum"});
  }
  return out;
}
function historyChart(pts, W = 1100, Hh = 230, cls = ""){
  if(pts.length < 2) return "";
  const L0 = 10, R0 = 10, T0 = 18, B0 = 30;
  const x0 = WL.dms(pts[0].date), x1 = WL.dms(pts[pts.length - 1].date) || x0 + 1;
  const vs = pts.map(p => p.value), lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
  const X = d => L0 + (WL.dms(d) - x0) / (x1 - x0 || 1) * (W - L0 - R0), Y = v => T0 + (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (Hh - T0 - B0);
  const stmt = pts.filter(p => p.src !== "live"), live = pts.find(p => p.src === "live");
  const path = stmt.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${X(stmt[stmt.length - 1].date).toFixed(1)},${Hh - B0} L${X(stmt[0].date).toFixed(1)},${Hh - B0} Z`;
  const last = stmt[stmt.length - 1];
  // подписи дат: первая, последняя и средняя — только если она не налезает на крайние
  const mid = pts.slice(1, -1).map(p => [p, Math.abs(X(p.date) - W / 2)]).sort((a, b) => a[1] - b[1])[0];
  const ticks = [pts[0], ...(mid && X(mid[0].date) > W * 0.28 && X(mid[0].date) < W * 0.72 ? [mid[0]] : []), pts[pts.length - 1]];
  return `<svg class="hchart ${cls}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${t("Стоимость портфеля по датам выписок", "Portfolio value by statement date")}">
    <line class="hg" x1="${L0}" x2="${W - R0}" y1="${Y(hi).toFixed(1)}" y2="${Y(hi).toFixed(1)}"/><line class="hg" x1="${L0}" x2="${W - R0}" y1="${Y(lo).toFixed(1)}" y2="${Y(lo).toFixed(1)}"/>
    <text class="hv" x="${W - R0}" y="${(Y(hi) - 4).toFixed(1)}" text-anchor="end">${esc(money(hi))}</text><text class="hv" x="${W - R0}" y="${(Y(lo) + 12).toFixed(1)}" text-anchor="end">${esc(money(lo))}</text>
    <path class="ha" d="${area}"/><path class="hl" d="${path}"/>
    ${live ? `<path class="hl live" d="M${X(last.date).toFixed(1)},${Y(last.value).toFixed(1)} L${X(live.date).toFixed(1)},${Y(live.value).toFixed(1)}"/>` : ""}
    ${pts.map(p => `<circle class="hp${p.src === "live" ? " live" : p.src === "opening" ? " open" : ""}" cx="${X(p.date).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="4"><title>${esc(fmt.date(p.date))} · ${esc(money(p.value))}${p.src === "opening" ? t(" · на начало периода выписки", " · opening value of a statement") : p.src === "live" ? t(" · сейчас", " · now") : ""}</title></circle>`).join("")}
    ${ticks.map((p, i) => `<text class="hx" x="${X(p.date).toFixed(1)}" y="${Hh - 8}" text-anchor="${i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}">${esc(fmt.date(p.date))}</text>`).join("")}
  </svg>`;
}
function historySec(){
  const m = M(), H = m.hist, lines = H ? H.lines.filter(L => L.current) : [];
  if(!lines.some(L => L.points.length > 1)) return "";
  const pts = historyPoints(lines);
  if(liveMode(m)) pts.push({date: WL.today(), value: m.mkt.nowTotal, src: "live"});
  const rows = lines.flatMap(L => L.snaps.map((s, i) => {
    const link = L.links.find(k => k.snap === s.id), f = s.flows || {};
    const mark = !link ? "" : link.gap ? `<span class="badge none">${esc(t(`пробел ${fmt.date(link.gapFrom)} – ${fmt.date(link.gapTo)}`, `gap ${fmt.date(link.gapFrom)} – ${fmt.date(link.gapTo)}`))}</span>`
      : link.ok === true ? `<span class="badge ok" title="${esc(t("Стоимость на начало совпала с концом предыдущей выписки", "The opening value matches the previous statement's closing value"))}">${ICON.check}${t("стык сошёлся", "continuous")}</span>`
      : link.ok === false ? `<span class="badge bad">${ICON.warn}${esc(t(`на начало ${money(link.opening)}, в прошлой ${money(link.closing)}`, `opening ${money(link.opening)}, previous ${money(link.closing)}`))}</span>` : "";
    const mv = [f.deposits ? t(`пополнения ${money(f.deposits)}`, `deposits ${money(f.deposits)}`) : "", f.withdrawals ? t(`снятия ${money(f.withdrawals)}`, `withdrawals ${money(f.withdrawals)}`) : "",
      f.income ? t(`доходы ${money(f.income)}`, `income ${money(f.income)}`) : "", f.fees ? t(`комиссии ${money(f.fees)}`, `fees ${money(f.fees)}`) : ""].filter(Boolean).join(" · ");
    return `<li><span class="hd">${esc(fmt.date(s.as_of))}</span><span class="hn">${esc(s.from ? `${fmt.date(s.from)} – ${fmt.date(s.to || s.as_of)}` : t("на дату", "as of date"))}${lines.length > 1 ? ` · ${esc(L.name)}` : ""}${mv ? `<span class="sub">${esc(mv)}</span>` : ""}</span>
      <b>${esc(money(s.value))}</b>${mark}</li>`;
  })).reverse();
  return `<section class="sec" id="history"><div class="sh"><h2>${t("История", "History")}</h2><span class="muted">${t(`${rows.length} ${WL.pl(rows.length, ["выписка", "выписки", "выписок"], ["", ""])}`, `${rows.length} ${rows.length === 1 ? "statement" : "statements"}`)}</span></div>
    <div class="card pad">${historyChart(pts, 1100, 230, "hc-wide")}${historyChart(pts, 560, 300, "hc-narrow")}<ul class="hlist">${rows.join("")}</ul>
    <p class="fine">${t("Стоимость — по выпискам на их даты; кружок без заливки — стоимость на начало периода выписки из её сводки. Стык — проверка, что стоимость на конец одной выписки совпадает с началом следующей.",
      "Values are taken from the statements as of their dates; an open circle is a statement's opening value from its summary. A link check confirms that one statement's closing value matches the next one's opening value.")}</p></div></section>`;
}
function hero(){
  const m = M(), s = S();
  const accts = new Set(m.docs.filter(d => d.use).flatMap(d => d.accounts.map(a => (d.institution || d.file) + "|" + a.id)));
  const nAcc = Math.max(accts.size, m.docs.filter(d => d.use).length);
  const dates = m.dates.length ? (m.dates.length === 1 ? t(`на ${fmt.date(m.dates[0])}`, `as of ${fmt.date(m.dates[0])}`) : t(`на ${fmt.date(m.dates[0])} – ${fmt.date(m.dates[m.dates.length - 1])}`, `as of ${fmt.date(m.dates[0])} – ${fmt.date(m.dates[m.dates.length - 1])}`)) : "";
  const baseName = {USD: t("в долларах", "in US dollars"), EUR: t("в евро", "in euros"), CHF: t("во франках", "in Swiss francs"), GBP: t("в фунтах", "in pounds")}[m.base] || m.base;
  return `<section class="hero">
    <div class="card total">
      <div class="th"><span class="eyebrow">${t("Всего", "Total")} ${esc(baseName)}</span>
        <div class="seg" role="group" aria-label="${t("Валюта отчёта", "Report currency")}">${WL.BASES.map(b => `<button type="button" data-base="${b}" aria-pressed="${b === m.base}">${b}</button>`).join("")}</div></div>
      ${valuation(m, dates)}
      ${dynamics(m)}
      <div class="ts">${esc([m.mkt && WL.ui.val !== "stmt" ? "" : dates, `${m.byInst.length} ${WL.pl(m.byInst.length, ["банк", "банка", "банков"], ["institution", "institutions"])}`, `${nAcc} ${WL.pl(nAcc, ["счёт", "счёта", "счетов"], ["account", "accounts"])}`,
        `${m.positions.length} ${WL.pl(m.positions.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}`].filter(Boolean).join(" · "))}</div>
      ${m.accrued ? `<div class="ts muted">${t(`в т.ч. накопленный купон ${money(m.accrued)}`, `incl. accrued interest ${money(m.accrued)}`)}</div>` : ""}
      ${coverage(m)}
      ${mix(agg(m))}
    </div>
    <div class="card where">
      <div class="eyebrow">${t("Где лежит", "Where it is")}${liveMode(m) ? ` · ${t("по текущим ценам", "at current prices")}` : ""}</div>
      <ul class="inst">${agg(m).byInst.map(i => { const worst = i.docs.map(d => d.recon ? d.recon.status : "none").sort((a, b) => ({mismatch: 0, partial: 1, none: 2, ok: 3})[a] - ({mismatch: 0, partial: 1, none: 2, ok: 3})[b])[0];
        const open = worst === "ok" ? i.docs.reduce((k, d) => k + ((d.recon && d.recon.open) || 0), 0) : 0;
        return `<li><div class="in"><b>${esc(i.name)}</b><span class="muted">${esc(i.as_of.map(fmt.date).join(", "))}</span></div>
          <div class="iv"><b>${esc(money(i.value))}</b>${recBadge(worst, open)}</div><span class="trk"><i style="width:${Math.max(1, Math.round(100 * Math.max(0, i.share)))}%"></i></span></li>`; }).join("")}</ul>
    </div>
  </section>`;
}
/* Итог: по текущим ценам (если есть котировки) или по выпискам. Переключатель и время обновления — рядом. */
const liveMode = m => !!(m.mkt && m.mkt.coverage > 0 && WL.ui.val !== "stmt");
/* В режиме «Сейчас» итог, доли, категории, банки и валюты считаются от одной базы — текущей оценки. */
const agg = m => liveMode(m) && m.mkt.byCat ? m.mkt : m;
const wOf = p => liveMode(M()) && p.wNow != null ? p.wNow : p.w;
function valuation(m, dates){
  if(!m.mkt || !(m.mkt.coverage > 0)) return `<div class="tv">${esc(money(m.total))}</div>${WL.marketLoading ? `<div class="ts muted">${t("загружаю текущие котировки…", "loading current prices…")}</div>` : ""}`;
  const live = liveMode(m), at = new Date(m.mkt.at), when = at.toLocaleTimeString(WL.EN ? "en-GB" : "ru-RU", {hour: "2-digit", minute: "2-digit"});
  const d = m.mkt.delta, dp = m.total ? d / m.total : 0;
  return `<div class="seg val no-print" role="group" aria-label="${t("Оценка", "Valuation")}"><button type="button" data-val="now" aria-pressed="${live}">${t("Сейчас", "Now")}</button><button type="button" data-val="stmt" aria-pressed="${!live}">${t("По выписке", "Per statement")}</button></div>
    <div class="tv">${esc(money(live ? m.mkt.nowTotal : m.total))}</div>
    ${live ? `<div class="ts"><span class="${d < 0 ? "dn" : "up"}">${d > 0 ? "+" : ""}${esc(money(d))} (${d > 0 ? "+" : ""}${esc(fmt.pct(dp, 1))})</span> ${t("с даты выписки", "since the statement date")} · ${t("цены на", "prices at")} ${esc(when)}${WL.marketLoading ? " · " + t("обновляю…", "refreshing…") : ""}</div>
      <div class="ts muted">${t(`по выписке ${esc(dates)}: ${esc(money(m.total))} · по рыночной цене ${esc(fmt.pct(m.mkt.coverage, 0))} портфеля, остальное — по выпискам`, `per statement ${esc(dates)}: ${esc(money(m.total))} · ${esc(fmt.pct(m.mkt.coverage, 0))} of the portfolio at market prices, the rest at statement values`)}</div>`
      : `<div class="ts muted">${t(`по текущим ценам на ${esc(when)}: ${esc(money(m.mkt.nowTotal))}`, `at current prices at ${esc(when)}: ${esc(money(m.mkt.nowTotal))}`)}</div>`}`;
}
/* Насколько итог полный — прямо под ним: сколько выписок учтено, что не вошло и почему, что не прочитано и не сошлось с
   банком. Подробности — в разделе «Файлы» внизу. Тот же текст — на первом листе Excel. */
function coverageOf(m){
  const files = S().files, docs = m.docs, used = docs.filter(d => d.use);
  const n = (k, one, few, many, en1, enN) => t(`${k} ${WL.pl(k, [one, few, many], ["", ""])}`, `${k} ${k === 1 ? en1 : enN}`);
  const why = {};
  docs.filter(d => !d.use && !d.history).forEach(d => { why[d.why] = (why[d.why] || 0) + 1; });
  const hist = docs.filter(d => d.history), histBad = hist.filter(d => d.recon && (d.recon.status === "mismatch" || d.recon.status === "partial")).length;
  const reading = files.filter(f => /queued|reading/.test(f.status)).length;
  const broken = files.filter(f => (f.status === "error" || f.status === "skipped") && !docs.some(d => d.id === f.id)).length;
  const pages = used.reduce((k, d) => k + (d.failed || []).reduce((q, x) => q + x.to - x.from + 1, 0), 0);
  const cut = used.filter(d => d.truncated).length;
  const bad = used.filter(d => d.recon && (d.recon.status === "mismatch" || d.recon.status === "partial")).length;
  const checked = used.filter(d => d.recon && d.recon.status === "ok").length;
  const open = used.filter(d => d.recon && d.recon.status === "ok" && d.recon.open).length;
  const twice = used.filter(d => d.conflict && d.conflict.length).length;
  const out = [], note = [];
  const WHY = {older: [t("выписка из истории", "a statement from the history"), t("выписки из истории", "statements from the history")],
    duplicate: [t("повтор", "a duplicate"), t("повторы", "duplicates")], not_financial: [t("не выписка", "not a statement"), t("не выписки", "not statements")],
    no_positions: [t("без позиций", "no positions"), t("без позиций", "no positions")], unread: [t("не прочитан", "not read"), t("не прочитаны", "not read")],
    removed: [t("убран вами", "removed by you"), t("убраны вами", "removed by you")]};
  for(const [k, c] of Object.entries(why)) note.push(`${c} — ${(WHY[k] || [k, k])[c === 1 ? 0 : 1]}`);
  if(broken) out.push(n(broken, "файл не удалось прочитать", "файла не удалось прочитать", "файлов не удалось прочитать", "file could not be read", "files could not be read"));
  if(reading) out.push(n(reading, "файл ещё читается", "файла ещё читаются", "файлов ещё читаются", "file is still being read", "files are still being read"));
  if(pages) out.push(t(`не прочитано ${pages} стр.`, `${pages} ${pages === 1 ? "page" : "pages"} not read`));
  if(cut) out.push(n(cut, "файл прочитан не полностью", "файла прочитаны не полностью", "файлов прочитаны не полностью", "file was read only in part", "files were read only in part"));
  if(bad) out.push(n(bad, "выписка не сошлась с итогом банка", "выписки не сошлись с итогом банка", "выписок не сошлись с итогом банка", "statement doesn't match the bank's total", "statements don't match the bank's total"));
  if(open) out.push(t(`в ${open} ${WL.pl(open, ["выписке", "выписках", "выписках"], ["", ""])} общий итог сошёлся, а частичные итоги — нет`,
    `${open} ${open === 1 ? "statement matches" : "statements match"} in total but not in the subtotals`));
  if(twice) out.push(t("возможен двойной учёт счёта", "an account may be counted twice"));
  const warn = out.length > 0 || !!(why.unread || why.no_positions);
  if(histBad) out.push(n(histBad, "выписка из истории не сошлась с итогом банка", "выписки из истории не сошлись с итогом банка", "выписок из истории не сошлись с итогом банка",
    "history statement doesn't match the bank's total", "history statements don't match the bank's total"));
  const all = docs.length && used.length + hist.length === docs.length && !broken;
  const since = hist.map(d => d.as_of).filter(Boolean).sort()[0];
  const head = hist.length ? (all ? t(`В отчёте все ${n(used.length + hist.length, "выписка", "выписки", "выписок", "", "")}: ${used.length === 1 ? "текущая" : `${used.length} текущих`} и ${hist.length} из истории с ${fmt.date(since)}`,
        `All ${used.length + hist.length} statements are included: ${used.length} current and ${hist.length} from the history since ${fmt.date(since)}`)
      : t(`В отчёте ${n(used.length, "выписка", "выписки", "выписок", "", "")} и ${hist.length} из истории — из ${files.length} ${WL.pl(files.length, ["файла", "файлов", "файлов"], ["", ""])}`,
        `${used.length} current and ${hist.length} history statements of ${files.length} files are included`))
    : all && used.length === 1 ? t("Выписка в отчёте", "The statement is included")
    : all ? t(`В отчёте все ${n(used.length, "выписка", "выписки", "выписок", "statement", "statements")}`, `All ${used.length} statements are included`)
    : t(`В отчёте ${n(used.length, "выписка", "выписки", "выписок", "", "")} из ${files.length} ${WL.pl(files.length, ["файла", "файлов", "файлов"], ["", ""])}`,
        `${used.length} of ${files.length} ${files.length === 1 ? "file is" : "files are"} included`);
  const ok = !warn && used.length && bad === 0 && checked > 0 ? t("итоги сверены с банком", "totals match the bank's") : "";
  const parts = [head + (note.length ? ` (${note.join(", ")})` : ""), ...out, ok].filter(Boolean);
  return {text: files.length ? parts.join(" · ") : "", warn};
}
function coverage(m){
  const c = coverageOf(m);
  if(!c.text) return "";
  return `<div class="cover ${c.warn ? "warn" : "ok"}">${c.warn ? ICON.warn : ICON.check}<span>${esc(c.text)}
    <button class="link" type="button" data-goto="files">${t("Подробнее", "Details")}</button></span></div>`;
}
/* Строка сверки в карточке файла: что напечатал банк и что дала сумма позиций; итог, который не с чем сравнить, — «не проверено». */
function checkLine(c){
  const what = `${esc(c.label)}: ${esc(fmt.money(c.amount, c.ccy, 2))}`;
  if(c.unchecked) return `<li class="na">${ICON.dash}<span>${what} — ${c.unchecked === "fx" ? t("не проверено: нет курса валюты", "not checked: no exchange rate")
    : t("не проверено: позиции не разнесены по этому счёту", "not checked: the positions aren't split by this account")}</span></li>`;
  if(c.ok) return `<li class="ok">${ICON.check}<span>${what}${c.withAccrued ? t(" — сошлось с учётом НКД", " — matches incl. accrued interest") : t(" — сошлось", " — matches")}</span></li>`;
  const got = (c.group && c.group !== c.ccy ? t(`по позициям в ${c.group}`, `positions in ${c.group}`) : t("прочитано", "read")) + (c.shownAcc ? t(" с НКД", " incl. accrued") : "");
  return `<li class="bad">${ICON.warn}<span>${what} — ${got}: ${esc(fmt.money(c.shown ?? c.sum, c.ccy, 2))}</span></li>`;
}
function recBadge(st, open){
  if(st === "ok" && open) return `<span class="badge part" title="${t(`Общий итог совпал с итогом банка, но ${open} ${WL.pl(open, ["частичный итог", "частичных итога", "частичных итогов"], ["", ""])} (по валютам или счетам) — нет`,
    `The grand total matches the bank's, but ${open} ${open === 1 ? "subtotal" : "subtotals"} (by currency or account) ${open === 1 ? "doesn't" : "don't"}`)}">${ICON.warn}${t(`итог сверен · ${open} уточнить`, `total matches · ${open} to check`)}</span>`;
  if(st === "ok") return `<span class="badge ok" title="${t("Сумма позиций совпала с итогом банка", "Positions add up to the bank's total")}">${ICON.check}${t("сверено", "reconciled")}</span>`;
  if(st === "mismatch" || st === "partial") return `<span class="badge bad" title="${t("Сумма позиций не совпала с итогом банка", "Positions don't add up to the bank's total")}">${ICON.warn}${t("не сошлось", "mismatch")}</span>`;
  return `<span class="badge none" title="${t("В выписке нет итога для сверки", "The statement prints no total to check against")}">${t("без итога", "no total")}</span>`;
}
/* Состав — доли от активов. Если есть обязательства (проданные опционы, овердрафт), доли от чистого итога дали бы больше
   100%, поэтому полоса строится по активам, а обязательства названы отдельно суммой. */
function mix(m){
  const cats = m.byCat.filter(c => c.value > 0), neg = m.byCat.filter(c => c.value < -0.5);
  if(!cats.length) return "";
  const gross = cats.reduce((s, c) => s + c.value, 0), sh = c => gross ? c.value / gross : 0;
  return `<div class="mix"><div class="mix-bar">${cats.map(c => `<i class="c-${c.key}" style="flex-grow:${Math.max(0.004, sh(c))}" title="${esc(c.label)} ${fmt.pct(sh(c))}"></i>`).join("")}</div>
    <ul class="mix-legend">${cats.map(c => `<li><span class="k c-${c.key}"></span>${esc(c.label)} <b>${fmt.pct(sh(c), sh(c) < 0.1 ? 1 : 0)}</b></li>`).join("")}</ul>
    ${neg.length ? `<p class="fine">${esc(t(`Доли — от активов ${money(gross)}. Обязательства — отдельно: ${neg.map(c => `${c.label.toLowerCase()} ${money(c.value)}`).join(", ")}; итог — за их вычетом.`,
      `Shares are of assets of ${money(gross)}. Liabilities are shown separately: ${neg.map(c => `${c.label.toLowerCase()} ${money(c.value)}`).join(", ")}; the total is net of them.`))}</p>` : ""}</div>`;
}

function brief(){
  const s = S(), r = WL.reviewNow(), old = !r && s.review && s.review.summary, m = M();
  let body;
  if(WL.reading && !r) body = `<p class="muted">${t("Сводка появится, когда все файлы будут прочитаны.", "The summary appears once all files are read.")}</p>`;
  else if(WL.reviewing) body = `${old ? `<p class="muted small">${t("Состав отчёта изменился — обновляю сводку и выводы…", "The report has changed — updating the summary and findings…")}</p>` : ""}<div class="skel"><i></i><i></i><i style="width:62%"></i></div>`;
  else if(r && r.summary) body = `<p class="summary">${esc(r.summary)}</p>${r.base && r.base !== m.base ? `<p class="fine">${t(`Суммы в сводке — в ${r.base}.`, `Amounts in the summary are in ${r.base}.`)}</p>` : ""}`;
  else if(old) body = `<p class="muted">${t("Состав отчёта изменился — прежняя сводка к нему не относится.", "The report has changed — the previous summary no longer applies.")} <button class="link" type="button" data-review>${t("Обновить сводку", "Update the summary")}</button></p>`;
  else if(r && r.error) body = `<p class="muted">${t("Сводку получить не удалось.", "Could not get the summary.")} <button class="link" type="button" data-review>${t("Повторить", "Try again")}</button></p>`;
  else body = `<p class="muted"><button class="link" type="button" data-review>${t("Получить сводку", "Get the summary")}</button></p>`;
  const starters = [t("Что в портфеле главное сейчас?", "What matters most in the portfolio now?"), t("Где основные риски?", "Where are the main risks?"),
    t("Что погашается или истекает скоро?", "What matures or expires soon?")];
  return `<section class="card brief" id="brief">
    <div class="ch"><span class="orb">${ICON.spark}</span><div><div class="eyebrow">${t("Коротко о портфеле", "The portfolio in brief")}</div><span class="muted small">${t("по прочитанным выпискам", "from the statements read")}</span></div></div>
    ${body}
    <form class="ask no-print" id="ask" autocomplete="off"><input name="q" maxlength="1500" placeholder="${t("Спросите о портфеле: что делать с облигациями, чем рискует валютная часть…", "Ask about the portfolio: what to do with the bonds, what the currency part risks…")}" aria-label="${t("Вопрос о портфеле", "Question about the portfolio")}">
      <button class="btn" type="submit">${ICON.spark}${t("Обсудить", "Discuss")}</button></form>
    <div class="starters no-print">${starters.map(q => `<button type="button" class="sug" data-ask="${esc(q)}">${esc(q)}</button>`).join("")}</div>
  </section>`;
}

/* Все выводы в порядке важности: свои проверки, рынок и ИИ-анализ. */
function alertList(){
  const m = M(), r = WL.reviewNow();
  const extra = r && Array.isArray(r.alerts) ? r.alerts.map((a, i) => Object.assign({id: "ai-" + i, auto: false}, a)) : [];
  const rank = {high: 0, watch: 1, info: 2};
  return (liveMode(m) ? WL.alertsNow(m) : m.alerts).concat(extra).filter(a => a && a.title).map((a, i) => [a, i]).sort((x, y) => ((rank[x[0].level] ?? 3) - (rank[y[0].level] ?? 3)) || x[1] - y[1]).map(x => x[0]);
}
WL.alertList = alertList;
const topicOf = a => WL.topicId ? WL.topicId(a) : "";
function alertsBlock(){
  const all = alertList();
  if(!all.length) return "";
  const lock = locked();
  const updating = WL.reviewing && !WL.reviewNow();
  const cards = all.map((a, i) => alertCard(a, i, lock));
  return `<section class="sec" id="alerts"><div class="keep"><div class="sh"><h2>${t("На что обратить внимание", "What needs attention")}</h2><span class="muted">${all.length}</span>
      ${updating ? `<span class="muted small no-print">${t("выводы ИИ обновляются…", "AI findings are updating…")}</span>`
        : WL.topicId && !WL.printing ? `<span class="muted small no-print sh-hint">${t("нажмите на карточку, чтобы обсудить, что делать", "tap a card to discuss what to do")}</span>` : ""}</div>
    <div class="alerts">${cards.slice(0, 2).join("")}</div></div>${cards.length > 2 ? `<div class="alerts more">${cards.slice(2).join("")}</div>` : ""}
  </section>`;
}
/* Карточка вывода. Первые две вместе с заголовком раздела — в блоке «keep»: при печати заголовок не остаётся внизу страницы один. */
function alertCard(a, i, lock){
  const hide = lock && i > 0, tid = hide ? "" : topicOf(a);
  const shown = !hide && (a.refs || []).some(id => pos(id));
  return `<article class="card alert lv-${esc(a.level)}${hide ? " locked" : ""}${tid ? " talk" : ""}"${tid ? ` data-topic="${esc(tid)}"` : ""}><div class="al"><span class="lvl lv-${esc(a.level)}">${LVL[a.level] || ""}</span>${a.auto ? "" : `<span class="by">${ICON.spark}${t("ИИ-анализ", "AI analysis")}</span>`}</div>
        <h3>${esc(a.title)}</h3>${hide ? `<p class="muted lockline">${ICON.lock}${t("Подробности — в полном отчёте", "Details are in the full report")}</p><button class="link" type="button" data-buy="alert">${t("Открыть", "Unlock")}</button>` : `<p>${esc(a.text)}</p><p class="basis">${esc(basisOf(a))}</p>`}
        ${tid || shown ? `<div class="aa no-print">${tid ? `<button class="talkbtn" type="button" data-topic="${esc(tid)}">${ICON.spark}${t("Обсудить, что делать", "Discuss what to do")}</button>` : ""}
          ${shown ? `<button class="link" type="button" data-show="${esc((a.refs || []).filter(id => pos(id)).slice(0, 40).join(","))}">${t("Показать позиции", "Show positions")}</button>` : ""}</div>` : ""}</article>`;
}

/* Основание вывода: из чего он сделан. */
function basisOf(a){
  if(a.basis) return a.basis;
  if(!a.auto) return t("Основа: ИИ-анализ выписок" + (M().mkt ? " и котировок" : ""), "Source: AI analysis of the statements" + (M().mkt ? " and quotes" : ""));
  const d = (a.refs || []).map(id => docOf(id) || (pos(id) && docOf(pos(id).doc))).filter(Boolean)[0];
  const src = d ? (d.institution || d.file) : "";
  const map = {unread: t("Основа: чтение файла", "Source: file reading"), recon: t(`Основа: итог в выписке ${src}`, `Source: the total in the ${src} statement`),
    ccy: t("Основа: выписка без указания валюты", "Source: a statement without a currency"), fx: t("Основа: курсы валют", "Source: exchange rates"),
    neg: t("Основа: остатки на счетах в выписках", "Source: account balances in the statements"), conc: t("Основа: все выписки, курсы валют", "Source: all statements, exchange rates"),
    cash: t("Основа: остатки и депозиты в выписках", "Source: balances and deposits in the statements"), puts: t("Основа: опционы в выписке, страйк и множитель контракта", "Source: options in the statement, strike and contract size"),
    expiry: t("Основа: даты экспирации в выписках", "Source: expiry dates in the statements"), maturity: t("Основа: даты погашения в выписках", "Source: maturity dates in the statements"),
    zero: t("Основа: стоимость в выписках", "Source: values in the statements"), stale: t("Основа: даты выписок", "Source: statement dates"), dates: t("Основа: даты выписок", "Source: statement dates"),
    "ccy-guess": t("Основа: валюта выписки", "Source: the statement currency"), summary: t("Основа: таблицы в файле", "Source: the tables in the file"), trunc: t("Основа: число страниц файла", "Source: the file's page count")};
  const key = Object.keys(map).find(k => a.id === k || a.id.startsWith(k + "-"));
  return key ? map[key] : t("Основа: выписки", "Source: the statements");
}
function questions(){
  const r = WL.reviewNow();
  if(!r || !Array.isArray(r.questions) || !r.questions.length) return "";
  return `<section class="sec" id="questions"><div class="sh"><h2>${t("Что стоит уточнить", "Worth checking")}</h2></div>
    <ul class="qlist card">${r.questions.map(q => { const tid = WL.topicId ? WL.topicId({question: q.text}) : "";
      return `<li>${tid ? `<button type="button" class="qbtn" data-topic="${esc(tid)}">${ICON.spark}<span>${esc(q.text)}</span><em class="no-print">${t("Обсудить", "Discuss")} →</em></button>` : `${ICON.spark}<span>${esc(q.text)}</span>`}</li>`; }).join("")}</ul></section>`;
}

function paywall(){
  if(!locked()) return "";
  const pay = WL.pay, gift = pay.promo();
  if(pay.pending()) return `<section class="card paywall checking" id="paywall" aria-live="polite"><div><div class="eyebrow gold">${t("Полный отчёт", "Full report")}</div>
    <h2><i class="spin"></i>${t("Проверяем доступ…", "Checking access…")}</h2><p class="muted">${t("Этот отчёт оплачен в этом браузере — сверяем оплату, это пара секунд.", "This report was paid for in this browser — verifying the payment, it takes a couple of seconds.")}</p></div></section>`;
  return `<section class="card paywall" id="paywall">
    <div><div class="eyebrow gold">${t("Полный отчёт", "Full report")}</div>
      <h2>${gift ? t("Откройте полный отчёт по подарочному коду", "Unlock the full report with your gift code") : t(`Все позиции, выводы, PDF и Excel — ${pay.PRICE.label}`, `Every position, all findings, PDF and Excel — ${pay.PRICE.label}`)}</h2>
      <p class="muted">${t("Сейчас видно итог, состав, банки, первый вывод и крупнейшие позиции. Разовая оплата, без подписки.", "You can see the total, the mix, the institutions, the first finding and the largest positions. One-off payment, no subscription.")}</p></div>
    <div class="pa"><button class="btn primary big" type="button" data-buy="paywall">${gift ? t("Открыть за €0", "Unlock for €0") : t(`Открыть за ${pay.PRICE.label}`, `Unlock for ${pay.PRICE.label}`)}</button>
      <button class="link" type="button" data-restore>${t("Уже оплатили? Восстановить доступ", "Already paid? Restore access")}</button></div>
  </section>`;
}

function detailOf(p){
  const bits = [];
  if(p.cls === "option" || p.cls === "future"){
    if(p.right) bits.push(`${p.right === "C" ? t("колл", "call") : t("пут", "put")}${p.strike != null ? " " + fmt.num(p.strike, p.strike % 1 ? 2 : 0) : ""}`);
    if(p.date){ const d = fmt.days(p.date); bits.push(t("до ", "exp. ") + fmt.date(p.date) + (d != null && d >= 0 && d <= 60 ? ` · ${d} ${WL.pl(d, ["день", "дня", "дней"], ["day", "days"])}` : "")); }
    if(p.qty < 0) bits.push(t("продан", "short"));
  } else if(["bond", "note", "deposit"].includes(p.cls)){
    if(p.coupon != null) bits.push(`${t("купон", "coupon")} ${fmt.num(p.coupon, p.coupon % 1 ? 2 : 0)}%`);
    if(p.date) bits.push(t("погашение ", "matures ") + fmt.date(p.date));
  }
  const id = p.isin || p.ticker;
  if(id) bits.push(id);
  return bits.join(" · ");
}
function nowCell(p){
  if(p.cls === "cash" || p.cls === "deposit") return "";
  if(p.underQ) return `<span class="sub">${esc(p.underQ.name || p.under || "")}</span>${esc(fmt.num(p.underQ.price, p.underQ.price >= 1000 ? 0 : 2))}<span class="sub ${(p.underQ.change || 0) < 0 ? "dn" : "up"}">${p.underQ.change > 0 ? "+" : ""}${esc(fmt.num(p.underQ.change || 0, 1))}% ${t("день", "day")}</span>`;
  if(!p.mk) return `<span class="unk" title="${t("нет биржевой котировки — цена из выписки", "no listed price — the statement price is used")}">${t("по выписке", "statement")}</span>`;
  if(p.mk.suspect) return `<span class="unk" title="${t("котировка не совпадает с выпиской в разы (другая бумага или единица цены) — не используется", "the quote is off from the statement by a large factor (another security or price unit) — not used")}">${t("не сходится", "mismatch")}</span>`;
  const d = p.mk.change;
  return `${esc(fmt.money(p.mk.price, p.mk.ccy || "", p.mk.price >= 1000 ? 0 : 2))}${d != null ? `<span class="sub ${d < 0 ? "dn" : "up"}">${d > 0 ? "+" : ""}${esc(fmt.num(d, 1))}% ${t("день", "day")}</span>` : ""}${p.mk.underlying ? `<span class="sub">${t("акция", "stock")} ${esc(fmt.money(p.mk.underlying, "USD", 2))}</span>` : ""}`;
}
/* Изменение позиции за выбранный период — от её точки отсчёта (выписка на начало, цена покупки, биржевая цена). */
function chgCell(p){
  if(p.cls === "cash" || p.cls === "deposit") return "";
  const r = per(), x = r && r.pos[p.id];
  if(!x || x.start == null) return `<span class="nb" title="${esc(t("Для этого периода нет точки отсчёта: нет выписки на его начало, покупки внутри него и биржевой цены", "No starting point for this period: no statement at its start, no purchase inside it and no market price"))}">—</span>`;
  const tip = {buy: t(`от цены покупки${x.when ? " " + fmt.date(x.when) : ""}`, `from the purchase price${x.when ? " on " + fmt.date(x.when) : ""}`),
    stmt: t(`от выписки на ${fmt.date(x.when)}`, `from the statement as of ${fmt.date(x.when)}`), mkt: t("по биржевой цене", "from the market price")}[x.src] || "";
  return `<b class="${x.chg < 0 ? "dn" : "up"}" title="${esc(tip)}">${x.pct != null && isFinite(x.pct) ? sgn(x.pct) + esc(fmt.pct(Math.abs(x.pct), 1)) : ""}</b><span class="sub">${sgn(x.chg)}${esc(money(Math.abs(x.chg)))}${x.src === "buy" ? t(" с покупки", " since purchase") : ""}</span>`;
}
function row(p){
  const w = wOf(p), price = p.price != null ? (p.unit === "%" ? fmt.num(p.price, 2) + "%" : fmt.num(p.price, p.price >= 1000 ? 0 : 2)) : "—";
  return `<tr class="pr" data-pos="${esc(p.id)}" tabindex="0">
    <td class="nm"><b>${esc(p.name || p.isin || "—")}</b><span class="sub">${esc(detailOf(p))}</span></td>
    <td class="ac mh">${esc(p.inst)}${p.acct ? `<span class="sub">${esc(p.acct)}</span>` : ""}</td>
    <td class="n mh mt">${p.cls === "cash" || (p.cls === "deposit" && p.qty == null) ? "" : esc(fmt.qty(p.qty))}</td>
    <td class="n mh mt">${p.cls === "cash" || (p.cls === "deposit" && p.price == null) ? "" : esc(price)}</td>
    <td class="n mh">${esc(p.value != null ? fmt.money(p.value, p.ccy || "", p.cls === "cash" ? 2 : 0) : "—")}${p.accrued ? `<span class="sub">+ ${t("НКД", "acc.")} ${esc(fmt.money(p.accrued, p.ccy || "", 0))}</span>` : ""}</td>
    <td class="n mk mh mt">${nowCell(p)}</td>
    <td class="n mk">${chgCell(p)}</td>
    <td class="n strong">${p.vb == null ? `<span class="unk" title="${t("нет курса", "no FX rate")}">—</span>` : esc(money((liveMode(M()) && p.nowB != null ? p.nowB : p.vb) + (p.ab || 0)))}</td>
    <td class="n w">${esc(fmt.pct(w, Math.abs(w) < 0.1 ? 1 : 0))}</td></tr>`;
}
/* Пустые ячейки колонок «Где», «Кол-во», «Цена», «Стоимость», «Сейчас» для строк категорий, «Итого» и замка: на узком экране
   эти колонки скрываются по классу во всех строках сразу (mt — «Кол-во», «Цена», «Сейчас» до 1020 px; mh — все пять до 760 px),
   и суммы стоят под своими заголовками. */
const PH = '<td class="mh"></td><td class="mh mt"></td><td class="mh mt"></td><td class="mh"></td><td class="mh mt"></td>';
function holdings(){
  const m = M(), s = S(), f = WL.ui.filter || "all", q = (WL.ui.search || "").trim().toLowerCase();
  const printing = WL.printing, lock = locked() && !printing;
  let list = m.positions.slice();
  if(!printing && q) list = list.filter(p => [p.name, p.isin, p.ticker, p.inst, p.acct].join(" ").toLowerCase().includes(q));
  if(!printing && WL.ui.only) list = list.filter(p => WL.ui.only.includes(p.id));
  const vis = lock ? new Set(m.positions.slice().sort((a, b) => Math.abs(b.vb || 0) - Math.abs(a.vb || 0)).slice(0, FREE_ROWS).map(p => p.id)) : null;
  const cats = m.byCat.filter(c => printing || f === "all" || c.key === f);
  const groups = cats.map(c => {
    const ps = list.filter(p => p.cat === c.key).sort((a, b) => ((b.vb || 0) + (b.ab || 0)) - ((a.vb || 0) + (a.ab || 0)));
    if(!ps.length) return "";
    const shown = vis ? ps.filter(p => vis.has(p.id)) : ps, hidden = ps.length - shown.length;
    const cval = liveMode(m) ? ps.reduce((s, p) => s + (p.nowB != null ? p.nowB : (p.vb || 0)) + (p.ab || 0), 0) : c.value;
    const cshare = (agg(m).byCat.find(x => x.key === c.key) || c).share;
    return `<tbody class="grp"><tr class="gh"><td><span class="k c-${c.key}"></span>${esc(c.label)} <span class="muted">· ${ps.length}</span></td>${PH}<td></td>
        <td class="n strong">${esc(money(cval))}</td><td class="n w">${esc(fmt.pct(cshare, 0))}</td></tr>
      ${shown.map(row).join("")}
      ${hidden ? `<tr class="lockrow"><td>${ICON.lock}${t(`Ещё ${hidden} ${WL.pl(hidden, ["позиция", "позиции", "позиций"], ["position", "positions"])} — в полном отчёте`, `${hidden} more ${WL.pl(hidden, ["position", "positions"], ["position", "positions"])} in the full report`)}
        <button class="link" type="button" data-buy="holdings">${t("Открыть", "Unlock")}</button></td>${PH}<td></td><td></td><td></td></tr>` : ""}</tbody>`;
  }).join("");
  return `<section class="sec" id="holdings"><div class="sh"><h2>${t("Все позиции", "All positions")}</h2><span class="muted">${m.positions.length}</span></div>
    <div class="tools no-print"><div class="chips per" role="group" aria-label="${t("Период изменения", "Change period")}">${WL.WINDOWS.map(([id, l]) => `<button type="button" data-per="${id}" aria-pressed="${(WL.ui.per || "all") === id}">${esc(l)}</button>`).join("")}</div></div>
    <div class="tools no-print">
      <div class="chips" role="group">${[{key: "all", label: t("Все", "All")}].concat(m.byCat).map(c => `<button type="button" data-cat="${c.key}" aria-pressed="${f === c.key}">${esc(c.label)}</button>`).join("")}</div>
      <input class="search" id="search" type="search" value="${esc(WL.ui.search || "")}" placeholder="${t("Найти бумагу, ISIN, банк", "Find a security, ISIN, bank")}" aria-label="${t("Поиск по позициям", "Search positions")}">
    </div>
    ${WL.ui.only ? `<p class="only no-print">${t("Показаны позиции из предупреждения.", "Showing the positions from a finding.")} <button class="link" type="button" data-clear-only>${t("Показать все", "Show all")}</button></p>` : ""}
    <div class="tw"><table class="pos"><thead><tr><th class="l">${t("Бумага", "Security")}</th><th class="l mh">${t("Где", "Where")}</th><th class="mh mt">${t("Кол-во", "Qty")}</th><th class="mh mt">${t("Цена", "Price")}</th>
      <th class="mh">${t("Стоимость", "Value")}</th><th class="mh mt">${t("Сейчас", "Now")}</th><th>${t("Изм.", "Chg.")}<span class="thsub">${esc(WL.windowLabel(WL.ui.per || "all").toLowerCase())}</span></th><th>${esc(m.base)}${liveMode(m) ? `<span class="thsub">${t("сейчас", "now")}</span>` : ""}</th><th>${t("Доля", "Share")}</th></tr></thead>
      ${groups || `<tbody><tr><td colspan="9" class="muted">${t("Ничего не найдено.", "Nothing found.")}</td></tr></tbody>`}
      <tfoot><tr><td>${t("Итого", "Total")}</td>${PH}<td class="n">${(r => r && (r.exact || r.coverage > 0) ? `<b class="${r.earned < 0 ? "dn" : "up"}" title="${esc(r.exact ? t("Заработано за период без учёта пополнений и снятий — по выпискам", "Earned in the period net of deposits and withdrawals — from the statements") : t("Заработано за период — оценка по позициям с точкой отсчёта", "Earned in the period — estimate from positions with a starting point"))}">${r.earnedPct != null && isFinite(r.earnedPct) ? sgn(r.earnedPct) + esc(fmt.pct(Math.abs(r.earnedPct), 1)) : ""}</b><span class="sub">${r.exact ? "" : "≈ "}${sgn(r.earned)}${esc(money(Math.abs(r.earned)))}</span>` : "")(per())}</td>
        <td class="n strong">${esc(money(liveMode(m) ? m.mkt.nowTotal : m.total))}</td><td class="n w">100%</td></tr></tfoot></table></div>
    ${m.mkt ? `<p class="fine">${t(`«Сейчас» — биржевые цены на ${new Date(m.mkt.at).toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit"})}, акции с задержкой до 15 минут. Облигации, ноты и деньги без биржевой котировки — по выписке; у нот показан базовый актив.`,
      `“Now” — market prices at ${new Date(m.mkt.at).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})}, stocks delayed up to 15 minutes. Bonds, notes and cash without a listed price stay at statement values; notes show their underlying.`)}</p>` : ""}
  </section>`;
}

function currenciesAndDates(){
  const m = M(), lock = locked() && !WL.printing;
  const cc = agg(m).byCcy.filter(c => Math.abs(c.value) > 0.5);
  const tl = m.timeline.slice(0, 14);
  return `<section class="sec two">
    <div class="card pad"><div class="eyebrow">${t("Валюты", "Currencies")}${liveMode(m) ? ` · ${t("по текущим ценам", "at current prices")}` : ""}</div>
      <ul class="bars">${cc.map(c => `<li><span class="bl">${esc(c.ccy)}</span><span class="bt"><i style="width:${Math.max(1, Math.round(100 * Math.max(0, c.share)))}%"></i></span><b>${esc(fmt.pct(c.share, 0))}</b><span class="muted">${esc(money(c.value))}</span></li>`).join("")}</ul></div>
    <div class="card pad"><div class="eyebrow">${t("Сроки на год вперёд", "Dates in the next 12 months")}</div>
      ${tl.length ? `<ul class="tl">${tl.map((x, i) => `<li class="${lock && i >= 2 ? "blur" : ""}"><span class="td">${esc(fmt.date(x.p.date))}</span><span class="tn">${lock && i >= 2 ? "▇▇▇▇▇▇▇" : esc(x.p.name)}<span class="sub">${esc(["option", "future"].includes(x.p.cls) ? t("экспирация", "expiry") : t("погашение", "maturity"))} · ${x.days} ${WL.pl(x.days, ["день", "дня", "дней"], ["day", "days"])}</span></span><b>${lock && i >= 2 ? "" : esc(money(x.p.vb))}</b></li>`).join("")}</ul>`
        : `<p class="muted">${t("Погашений и экспираций в ближайший год нет.", "No maturities or expiries in the next 12 months.")}</p>`}</div>
  </section>`;
}

function files(){
  const s = S(), m = M(), notes = (WL.reviewNow() && WL.reviewNow().documents) || [];
  const cards = s.files.map(f => fileCard(f, s, m, notes));
  return `<section class="sec" id="files"><div class="keep"><div class="sh"><h2>${t("Файлы", "Files")}</h2><span class="muted">${s.files.length}</span>
      <button class="btn small no-print" type="button" data-pick="files">${t("Добавить", "Add")}</button></div>
    <div class="docs">${cards.slice(0, 2).join("")}</div></div>${cards.length > 2 ? `<div class="docs more">${cards.slice(2).join("")}</div>` : ""}
  </section>`;
}
/* Карточка файла: что это за документ, вошёл ли он в отчёт и почему, сверка с итогом банка. */
function fileCard(f, s, m, notes){
  const d = m.docs.find(x => x.id === f.id), raw = s.docs.find(x => x.fileId === f.id), note = notes.find(n => n.id === f.id);
  const status = f.status !== "done" ? (f.status === "reading" || f.status === "queued" ? t("читается…", "reading…") : f.reason || t("не прочитан", "not read"))
    : d && !d.use ? WHY[d.why] || "" : "";
  return `<article class="card doc${d && !d.use && !d.history ? " off" : ""}">
    <div class="dh"><span class="di">${ICON.file}</span><div class="dn"><b>${esc(f.name)}</b>
      <span class="muted">${esc([d && d.institution, d && TYPE[d.type], d && d.as_of && fmt.date(d.as_of), raw && `${raw.pageCount} ${WL.pl(raw.pageCount, ["стр.", "стр.", "стр."], ["page", "pages"])}`].filter(Boolean).join(" · "))}</span></div>
      ${d && (d.use || d.history) && d.recon ? recBadge(d.recon.status, d.recon.open) : ""}</div>
    ${status ? `<p class="dst">${esc(status)}</p>` : ""}
    ${d && d.use && d.replaced && d.replaced.length ? `<p class="dst">${esc(d.replaced.map(z => t(`Счёт ${z.acct} — учтена более свежая выписка «${z.byFile}»${z.byDate ? " на " + fmt.date(z.byDate) : ""}`,
      `Account ${z.acct} — the newer statement “${z.byFile}”${z.byDate ? " as of " + fmt.date(z.byDate) : ""} is used`)).join("; ") + t(". Остальные счета — из этой выписки.", ". The other accounts come from this statement."))}</p>` : ""}
    ${d && (d.use || d.history) && d.recon && d.recon.checks.length ? `<ul class="checks">${d.recon.checks.slice(0, 8).map(checkLine).join("")}${d.recon.checks.length > 8 ? `<li class="na"><span>${t(`и ещё ${d.recon.checks.length - 8}`, `and ${d.recon.checks.length - 8} more`)}</span></li>` : ""}</ul>
      ${d.recon.status === "ok" && d.recon.open ? `<p class="dst">${t("Общий итог сошёлся с банком. Частичные итоги, отмеченные ⚠, — нет: возможно, у части позиций неверно прочитаны валюта или счёт. Итог отчёта от этого не меняется, но разбивка по валютам и счетам может быть неточной.",
        "The grand total matches the bank's. The subtotals marked ⚠ don't: the currency or account of some positions may have been read wrong. The report total is unaffected, but the split by currency and account may be off.")}</p>` : ""}` : ""}
    ${note ? `<p class="dnote">${ICON.spark}<span>${esc(note.text)}</span></p>` : ""}
    ${raw && raw.notes && raw.notes.length ? (note
      ? `<details class="rn no-print"><summary>${t(`Заметки при чтении страниц · ${raw.notes.length}`, `Notes made while reading pages · ${raw.notes.length}`)}</summary><ul class="rnotes">${raw.notes.slice(0, 8).map(n => `<li>${esc(n)}</li>`).join("")}</ul></details>`
      : `<ul class="rnotes">${raw.notes.slice(0, 5).map(n => `<li>${esc(n)}</li>`).join("")}</ul>`) : ""}
    ${d && (d.summaryDropped || d.dupDropped) ? `<p class="fine">${[d.summaryDropped ? t(`Сводные таблицы (${d.summaryDropped} строк) не учтены — позиции взяты из полного списка.`, `Summary tables (${d.summaryDropped} rows) were ignored — positions come from the complete list.`) : "",
      d.dupDropped ? t(`${d.dupDropped} ${WL.pl(d.dupDropped, ["позиция повторялась", "позиции повторялись", "позиций повторялись"], ["", "", ""])} в другой таблице файла — учтены один раз.`, `${d.dupDropped} ${d.dupDropped === 1 ? "position was" : "positions were"} repeated in another table of the file — counted once.`) : ""].filter(Boolean).join(" ")}</p>` : ""}
    ${d && d.noCcy && !S().demo ? `<div class="ccy-pick no-print"><span>${t("Валюта выписки не указана. Выберите:", "The statement shows no currency. Choose:")}</span>
      ${["USD", "EUR", "GBP", "CHF", "AED", "RUB"].map(c => `<button class="btn small" type="button" data-setccy="${esc(f.id)}|${c}">${c}</button>`).join("")}
      <button class="link" type="button" data-setccy="${esc(f.id)}|?">${t("другая…", "other…")}</button></div>` : ""}
    <div class="da no-print"${S().demo ? " hidden" : ""}>
      ${raw && raw.failed && raw.failed.length && !WL.reading ? `<button class="btn small" type="button" data-reread="${esc(f.id)}">${t("Дочитать", "Read again")}</button>` : ""}
      ${f.status === "error" && !WL.reading ? `<button class="btn small" type="button" data-reread="${esc(f.id)}">${t("Повторить", "Try again")}</button>` : ""}
      ${d && !d.use && raw && raw.rows.length && d.why !== "not_financial" ? `<button class="link" type="button" data-include="${esc(f.id)}">${t("Всё равно учесть", "Include anyway")}</button>` : ""}
      ${d && d.use && !WL.reading ? `<button class="link" type="button" data-exclude="${esc(f.id)}">${t("Не учитывать", "Exclude")}</button>` : ""}
      ${!WL.reading ? `<button class="link danger" type="button" data-remove="${esc(f.id)}">${t("Убрать файл", "Remove file")}</button>` : ""}
    </div></article>`;
}

function method(){
  const m = M(), src = new Set(m.positions.map(p => p.fxSrc));
  const rates = [src.has("statement") ? t("курсы из самих выписок", "rates from the statements themselves") : "", src.has("ecb") ? t("курсы ЕЦБ на дату выписки", "ECB rates on the statement date") : "",
    src.has("alt") || src.has("peg") ? t("для валют, которых нет у ЕЦБ, — открытый набор курсов currency-api и привязка к доллару", "for currencies the ECB doesn't publish — the open currency-api rates and dollar pegs") : ""].filter(Boolean);
  return `<footer class="method"><p>${t("Позиции и итоги прочитаны прямо со страниц выписок; числа не пересчитывались, кроме перевода в валюту отчёта", "Positions and totals were read straight from the statement pages; numbers are as printed, except the conversion to the report currency")}${rates.length ? ": " + esc(rates.join("; ")) : ""}.
    ${t("Итог включает накопленный купон, если банк его показывает. Отчёт показывает факты из выписок и не является инвестиционной рекомендацией.", "The total includes accrued interest where the bank shows it. The report states facts from the statements and is not investment advice.")}</p>
    <p class="muted">WealthLens · ${esc(fmt.date(WL.today()))}${S().rid && !S().demo ? ` · ${t("отчёт", "report")} ${esc(S().rid)}` : ""}</p></footer>`;
}

function demoBar(){
  if(!S().demo || /[?&]shot=1/.test(location.search)) return "";
  return `<div class="demo-bar card"><span>${ICON.spark}${t("Это пример на вымышленном портфеле.", "This is a sample on a fictional portfolio.")}</span>
    <button class="btn primary small" type="button" data-new>${t("Загрузить свои выписки", "Upload your statements")}</button></div>`;
}

function report(){
  const m = M();
  if(!m || (!m.positions.length && !S().docs.length)) return readingPanel() || `<section class="empty card"><p>${t("Пока ничего не прочитано.", "Nothing has been read yet.")}</p></section>`;
  const printHead = `<div class="print-head"><div class="brandline">WealthLens</div><h1>${esc(S().client || t("Портфель", "Portfolio"))}</h1>
    <p>${t("Отчёт по портфелю", "Portfolio report")} · ${esc(fmt.date(WL.today()))}</p></div>`;
  if(!m.positions.length) return printHead + demoBar() + readingPanel() + (WL.reading ? "" : `<section class="card empty"><h2>${t("Позиций не нашлось", "No positions found")}</h2>
    <p class="muted">${t("В этих файлах не нашлось ни остатков, ни бумаг. Проверьте, что это выписки по счетам, — ниже по каждому файлу написано, что в нём.", "No balances or securities were found in these files. Check that they are account statements — each file below says what it contains.")}</p></section>`) + files();
  return printHead + demoBar() + readingPanel() + hero() + paywall() + brief() + alertsBlock() + questions() + holdings() + historySec() + currenciesAndDates() + (WL.marketSection ? WL.marketSection() : "") + files() + method();
}

WL.ui = WL.ui || {filter: "all", search: "", only: null};
WL.render = () => {
  const app = $("#app"), s = S();
  const has = s.files.length || s.docs.length || s.demo;
  document.body.classList.toggle("has-report", !!has);
  document.body.classList.toggle("is-locked", has && locked());
  $("#bar").hidden = !has;
  if($("#client")) $("#client").value = s.client || "";
  const keep = document.activeElement && document.activeElement.id === "search" ? document.activeElement.selectionStart : null;
  app.innerHTML = has ? report() : upload();
  if(keep != null && $("#search")){ $("#search").focus(); $("#search").setSelectionRange(keep, keep); }
  WL.renderBar && WL.renderBar();
  WL.renderChatLauncher && WL.renderChatLauncher();
  if(WL.chat && WL.chat.open && !WL.chat.topic && WL.renderChat) WL.renderChat();
};

/* ── Карточка позиции и страница-источник ───────────────────────────── */
WL.openPos = async id => {
  const p = pos(id); if(!p) return;
  if(locked() && !new Set(M().positions.slice().sort((a, b) => Math.abs(b.vb || 0) - Math.abs(a.vb || 0)).slice(0, FREE_ROWS).map(x => x.id)).has(id)) return WL.pay.open("drawer");
  const d = S().docs.find(x => x.id === p.doc);
  const rows = [
    [t("Тип", "Type"), WL.CLS[p.cls] || p.cls],
    [t("Банк", "Institution"), p.inst + (p.acct ? ` · ${p.acct}` : "")],
    [t("Количество", "Quantity"), p.qty != null ? fmt.qty(p.qty) : ""],
    [t("Цена", "Price"), p.price != null ? (p.unit === "%" ? fmt.num(p.price, 3) + "%" : fmt.num(p.price, 4).replace(/([,.]\d*?)0+$/, "$1").replace(/[,.]$/, "")) : ""],
    [t("Стоимость", "Value"), p.value != null ? fmt.money(p.value, p.ccy || "", 2) : ""],
    [t("Накопленный купон", "Accrued interest"), p.accrued ? fmt.money(p.accrued, p.ccy || "", 2) : ""],
    [t(`В ${M().base}`, `In ${M().base}`), p.vb != null ? money(p.vb + (p.ab || 0), 2) : t("нет курса", "no FX rate")],
    [liveMode(M()) ? t("Доля портфеля по текущим ценам", "Share of portfolio at current prices") : t("Доля портфеля", "Share of portfolio"), fmt.pct(wOf(p), 2)],
    [t("Себестоимость", "Cost"), p.cost != null ? fmt.money(p.cost, p.ccy || "", 2) : ""],
    [t("Результат к себестоимости", "Gain vs cost"), p.cost != null && p.value != null ? fmt.money(p.value - p.cost, p.ccy || "", 2) + (p.cost ? ` (${fmt.pct((p.value - p.cost) / Math.abs(p.cost))})` : "") : ""],
    [["option", "future"].includes(p.cls) ? t("Экспирация", "Expiry") : t("Погашение", "Maturity"), p.date ? fmt.date(p.date) : ""],
    [t("Купон", "Coupon"), p.coupon != null ? fmt.num(p.coupon, 3).replace(/([,.]\d*?)0+$/, "$1").replace(/[,.]$/, "") + "%" : ""],
    [t("Опцион", "Option"), p.right ? `${p.right === "C" ? t("колл", "call") : t("пут", "put")} ${p.strike ?? ""} ${p.under || ""}` : ""],
    ["ISIN", p.isin], [t("Тикер", "Ticker"), p.ticker],
    [t("Биржа", "Listing"), p.mk && p.mk.symbol ? p.mk.symbol : p.underQ ? p.underQ.symbol : ""],
    [t("Цена сейчас", "Price now"), p.mk && !p.mk.suspect ? fmt.money(p.mk.price, p.mk.ccy || "", 2) + (p.mk.delayed ? t(" (задержка до 15 мин)", " (delayed up to 15 min)") : "") : ""],
    [t(`Сейчас в ${M().base}`, `Now in ${M().base}`), p.nowB != null ? money(p.nowB + (p.ab || 0), 2) : ""],
    [t("Изменение: день / месяц / год", "Change: day / month / year"), p.mk && !p.mk.suspect && p.mk.perf ? [p.mk.change, p.mk.perf["1m"], p.mk.perf["1y"]].map(v => v == null ? "—" : (v > 0 ? "+" : "") + fmt.num(v, 1) + "%").join(" / ") : ""],
    [t("Базовый актив", "Underlying"), p.underQ ? `${p.underQ.name || p.under}: ${fmt.num(p.underQ.price, 2)} · ${t("месяц", "month")} ${p.underQ.perf["1m"] > 0 ? "+" : ""}${fmt.num(p.underQ.perf["1m"] || 0, 1)}% · ${t("год", "year")} ${p.underQ.perf["1y"] > 0 ? "+" : ""}${fmt.num(p.underQ.perf["1y"] || 0, 1)}%` : ""],
    [t("Базовая акция сейчас", "Underlying stock now"), p.mk && p.mk.underlying ? fmt.money(p.mk.underlying, "USD", 2) + (p.strike ? t(` · до страйка ${fmt.pct((p.mk.underlying - p.strike) / p.mk.underlying, 1)}`, ` · ${fmt.pct((p.mk.underlying - p.strike) / p.mk.underlying, 1)} from the strike`) : "") : ""],
    [t("Курс", "FX"), {statement: t("из выписки", "from the statement"), ecb: t("ЕЦБ на дату выписки", "ECB on the statement date"), alt: "currency-api", peg: t("привязка к доллару", "dollar peg"), same: ""}[p.fxSrc] || ""],
  ].filter(r => r[1] !== "" && r[1] != null);
  const dr = $("#drawer");
  dr.innerHTML = `<button class="x" type="button" data-close aria-label="${t("Закрыть", "Close")}">×</button>
    <div class="eyebrow">${esc(WL.catOf(p.cls).label)}</div><h3>${esc(p.name || p.isin)}</h3>
    ${WL.topicId ? `<button class="btn small talk-pos" type="button" data-topic="pos:${esc(p.id)}">${ICON.spark}${t("Обсудить эту позицию", "Discuss this position")}</button>` : ""}
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <div class="src"><div class="eyebrow">${t("Откуда цифры", "Where the numbers come from")}</div>
      <p>${esc(p.docFile)}${p.page ? t(`, страница ${p.page}`, `, page ${p.page}`) : ""}</p><div class="page" id="srcPage"><div class="skel tall"></div></div></div>`;
  dr.classList.add("open"); $("#scrim").classList.add("open"); dr.setAttribute("aria-hidden", "false"); dr.querySelector(".x").focus();
  const box = $("#srcPage");
  try{
    const blob = WL.blobs[p.doc] || await WL.files.get(p.doc);
    if(!blob){ box.innerHTML = `<p class="muted">${t("Файла нет в этом браузере — страницу показать нельзя.", "The file isn't in this browser, so the page can't be shown.")}</p>`; return; }
    const kind = WL.fileKind(blob.name ? blob : Object.assign(blob, {name: d ? d.file : ""}));
    if(kind === "pdf" && p.page){ const c = await WL.renderPdfPage(blob, p.page); c.className = "pageimg"; box.innerHTML = ""; box.appendChild(c); }
    else if(kind === "image"){ const img = new Image(); img.className = "pageimg"; img.src = URL.createObjectURL(blob); box.innerHTML = ""; box.appendChild(img); }
    else box.innerHTML = `<p class="muted">${t("Таблица: строка взята из листа файла.", "Spreadsheet: the row comes from the file's sheet.")}</p>`;
  }catch(e){ box.innerHTML = `<p class="muted">${t("Страницу показать не удалось.", "Could not show the page.")}</p>`; }
};
WL.closeDrawer = () => { const dr = $("#drawer"); dr.classList.remove("open"); $("#scrim").classList.remove("open"); dr.setAttribute("aria-hidden", "true"); };

/* ── Выгрузка: PDF (печать браузера) и Excel ─────────────────────────── */
WL.printReport = async () => {
  if(locked()) return WL.pay.open("pdf");
  WL.printing = true; WL.closeDrawer(); WL.render();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const was = document.title; document.title = `${S().client || "WealthLens"} · ${fmt.date(WL.today())}`;
  try{ window.print(); } finally { document.title = was; WL.printing = false; WL.render(); }
};
WL.excel = async () => {
  if(locked()) return WL.pay.open("excel");
  let X;
  try{ X = await WL.loadXLSX(); }catch(e){ WL.toast(t("Не удалось загрузить модуль Excel. Проверьте связь и попробуйте ещё раз.", "Could not load the Excel module. Check the connection and try again.")); return; }
  const m = M(), s = S(), r = WL.reviewNow() || {}, base = m.base, mk = m.mkt && m.mkt.coverage > 0 ? m.mkt : null;
  const round = (v, d = 2) => v == null || !isFinite(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const sheet = (rows, name, cols) => { const ws = X.utils.aoa_to_sheet(rows); if(cols) ws["!cols"] = cols.map(wch => ({wch})); X.utils.book_append_sheet(wb, ws, name); };
  const wb = X.utils.book_new();
  // Сводка: две явные основы — по выпискам (на даты выписок) и текущая оценка (на время котировок), и полнота отчёта
  const on = m.dates.length ? (m.dates.length === 1 ? fmt.date(m.dates[0]) : `${fmt.date(m.dates[0])} – ${fmt.date(m.dates[m.dates.length - 1])}`) : "";
  const when = mk ? new Date(mk.at).toLocaleString(WL.EN ? "en-GB" : "ru-RU", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"}) : "";
  const block = (g, withCount) => [
    [t("Категория", "Category"), base, t("Доля, %", "Share, %"), ...(withCount ? [t("Позиций", "Positions")] : [])], ...g.byCat.map(c => [c.label, round(c.value), round(c.share * 100), ...(withCount ? [c.count] : [])]), [],
    [t("Банк", "Institution"), base, t("Доля, %", "Share, %"), t("Дата выписки", "Statement date")], ...g.byInst.map(i => [i.name, round(i.value), round(i.share * 100), i.as_of.map(fmt.date).join(", ")]), [],
    [t("Валюта", "Currency"), base, t("Доля, %", "Share, %")], ...g.byCcy.map(c => [c.ccy, round(c.value), round(c.share * 100)])];
  const sum = [[s.client || "WealthLens"], [t("Отчёт по портфелю", "Portfolio report"), fmt.date(WL.today())], [],
    [t("Полнота отчёта", "Completeness"), coverageOf(m).text], [],
    [t(`ПО ВЫПИСКАМ${on ? " — на " + on : ""}`, `PER STATEMENTS${on ? " — as of " + on : ""}`)],
    [t(`Всего, ${base}`, `Total, ${base}`), round(m.total)], [t("в т.ч. накопленный купон", "incl. accrued interest"), round(m.accrued)], [], ...block(m, true)];
  if(mk) sum.push([], [t(`ТЕКУЩАЯ ОЦЕНКА — цены на ${when}`, `CURRENT VALUE — prices at ${when}`)],
    [t(`Всего сейчас, ${base}`, `Total now, ${base}`), round(mk.nowTotal)],
    [t("По рыночной цене, % портфеля", "At market prices, % of the portfolio"), round(mk.coverage * 100), t("остальное — по выпискам; по строкам — лист «Позиции», колонка «Основа оценки сейчас»", "the rest at statement values; per line — sheet “Positions”, column “Basis now”")], [],
    ...block(mk, true));
  if(r.summary) sum.push([], [t("Коротко о портфеле — ИИ-анализ по выпискам", "The portfolio in brief — AI analysis of the statements")], [r.summary]);
  sheet(sum, t("Сводка", "Summary"), [46, 18, 12, 14]);
  // Позиции: стоимость по выписке и сейчас — в каждой строке; колонки складываются в итоги сводки
  const head = [t("Категория", "Category"), t("Бумага", "Security"), "ISIN", t("Тикер", "Ticker"), t("Банк", "Institution"), t("Счёт", "Account"), t("Количество", "Quantity"),
    t("Цена", "Price"), t("Цена в % номинала", "Price in % of nominal"), t("Стоимость", "Value"), t("Валюта", "Currency"), t("Накопленный купон", "Accrued interest"),
    t(`Стоимость по выписке, ${base}`, `Statement value, ${base}`), t("Доля по выписке, %", "Share per statement, %"), t("Погашение / экспирация", "Maturity / expiry"), t("Купон, %", "Coupon, %"), t("Опцион", "Option"),
    t("Себестоимость", "Cost"), t("Файл", "File"), t("Страница", "Page"), t("Дата выписки", "Statement date"),
    t("Биржевой символ", "Listing"), t("Цена сейчас", "Price now"), t("Валюта котировки", "Quote currency"), t("Изм. день, %", "Chg. day, %"), t("Изм. месяц, %", "Chg. month, %"),
    t("Изм. год, %", "Chg. year, %"), t(`Сейчас, ${base}`, `Now, ${base}`), t("Доля сейчас, %", "Share now, %"), t("Основа оценки сейчас", "Basis now"), t("Базовый актив", "Underlying"), t("Базовый актив сейчас", "Underlying now")];
  const live = p => p.mk && !p.mk.suspect;
  const rows = m.positions.slice().sort((a, b) => a.cat.localeCompare(b.cat) || ((b.vb || 0) - (a.vb || 0))).map(p => [WL.catOf(p.cls).label, p.name, p.isin, p.ticker, p.inst, p.acct,
    p.qty, p.price, p.unit === "%" ? t("да", "yes") : "", p.value, p.ccy, p.accrued, round((p.vb || 0) + (p.ab || 0)), round(p.w * 100, 3), p.date, p.coupon,
    p.right ? `${p.right} ${p.strike ?? ""} ${p.under || ""}`.trim() : "", p.cost, p.docFile, p.page || null, p.as_of,
    live(p) ? p.mk.symbol || "Cboe" : "", live(p) ? p.mk.price : null, live(p) ? p.mk.ccy : "", live(p) ? p.mk.change : null,
    live(p) && p.mk.perf ? p.mk.perf["1m"] : null, live(p) && p.mk.perf ? p.mk.perf["1y"] : null,
    mk ? round(p.nowV) : null, mk ? round(p.wNow * 100, 3) : null, mk ? (p.nowB != null ? t("биржевая цена", "market price") : t("по выписке", "statement value")) : "",
    p.underQ ? (p.underQ.name || p.under) : (p.mk && p.mk.underlying ? p.under : ""), p.underQ ? p.underQ.price : (p.mk && p.mk.underlying) || null]);
  const tot = head.map(() => null); tot[0] = t("Итого", "Total");
  tot[12] = round(m.total); tot[13] = 100;
  if(mk){ tot[27] = round(mk.nowTotal); tot[28] = 100; }
  sheet([head, ...rows, [], tot], t("Позиции", "Positions"), [22, 40, 14, 9, 22, 14, 12, 10, 8, 14, 8, 12, 16, 10, 12, 8, 14, 12, 26, 8, 12, 14, 11, 8, 9, 9, 9, 16, 10, 16, 18, 12]);
  // Файлы: все загруженные, и прочитанные, и нет, — с причиной, почему файл не вошёл
  const STATUS = {error: t("не прочитан", "not read"), skipped: t("пропущен", "skipped"), reading: t("читается", "being read"), queued: t("в очереди", "queued")};
  const REC = {ok: t("сошлось", "matches"), partial: t("частично", "partly"), mismatch: t("не сошлось", "mismatch"), none: t("нет итога", "no total")};
  const files = [[t("Файл", "File"), t("Чтение", "Reading"), t("В отчёте", "Included"), t("Причина", "Reason"), t("Банк", "Institution"), t("Документ", "Document"), t("Дата", "As of"),
    t("Страниц", "Pages"), t("Не прочитаны страницы", "Pages not read"), t("Позиций", "Positions"), t(`Стоимость, ${base}`, `Value, ${base}`),
    t("Сверка с итогом банка", "Check against the bank total"), t("Итог банка", "Bank total"), t("Валюта итога", "Total currency"), t("Сумма позиций", "Positions sum"), t("Частичные итоги", "Subtotals")]];
  for(const f of s.files){
    const d = m.docs.find(x => x.id === f.id), raw = s.docs.find(x => x.fileId === f.id), rc = d && d.use && d.recon;
    const c = rc && (rc.checks.find(x => x.scope === "total" && !x.unchecked) || rc.checks.find(x => !x.unchecked));
    const gaps = raw && raw.failed && raw.failed.length ? raw.failed.map(x => x.from === x.to ? x.from : `${x.from}–${x.to}`).join(", ") : "";
    const read = f.status === "done" ? (gaps ? t("прочитан частично", "partly read") : t("прочитан", "read")) : STATUS[f.status] || f.status;
    const why = f.status !== "done" ? f.reason || t("файл не прочитан", "the file was not read") : d && !d.use ? WHY[d.why] || d.why
      : d && d.replaced && d.replaced.length ? d.replaced.map(z => t(`счёт ${z.acct} — из более свежей выписки «${z.byFile}»`, `account ${z.acct} — from the newer statement “${z.byFile}”`)).join("; ") : "";
    const bad = rc ? rc.checks.filter(x => !x.ok && !x.unchecked).length : 0, na = rc ? rc.checks.filter(x => x.unchecked).length : 0;
    files.push([f.name, read, d && d.use ? t("да", "yes") : t("нет", "no"), why, d ? d.institution : f.inst || "", d ? TYPE[d.type] || d.type : "", d && d.as_of ? fmt.date(d.as_of) : "",
      raw ? raw.pageCount : null, gaps, d && d.use ? d.positions : null, d && d.use ? round(d.value) : null, rc ? REC[rc.status] : "",
      c ? c.amount : null, c ? c.ccy : "", c ? round(c.sum) : null,
      rc && rc.checks.length > 1 ? [bad ? t(`не сошлись: ${bad}`, `not matching: ${bad}`) : t("все сошлись", "all match"), na ? t(`не проверено: ${na}`, `not checked: ${na}`) : ""].filter(Boolean).join(", ") : ""]);
  }
  sheet(files, t("Файлы", "Files"), [34, 16, 9, 44, 24, 20, 11, 8, 12, 9, 14, 14, 14, 9, 14, 20]);
  // Динамика: все периоды сразу — как они посчитаны (по выпискам или оценка по позициям), и история стоимости по датам выписок
  const liveNow = liveMode(m), dyn = [[t(`Динамика — ${liveNow ? "по текущим ценам" : "по выпискам"}`, `Changes — ${liveNow ? "at current prices" : "per statements"}`)], [],
    [t("Период", "Period"), t("С даты", "Since"), t(`Стоимость на начало, ${base}`, `Value at start, ${base}`), t(`Изменение стоимости, ${base}`, `Change in value, ${base}`),
      t(`Пополнения и снятия, ${base}`, `Deposits and withdrawals, ${base}`), t(`Доходы, ${base}`, `Income, ${base}`), t(`Комиссии, ${base}`, `Fees, ${base}`),
      t(`Заработано, ${base}`, `Earned, ${base}`), t("Заработано, %", "Earned, %"), t("Как посчитано", "Basis"), t("Доля вложений с точкой отсчёта, %", "Holdings with a starting point, %")]];
  for(const [id] of WL.WINDOWS){
    const r = WL.period(m, id, liveNow); if(!r) continue;
    dyn.push([r.label, (d => d ? fmt.date(d) : t("с покупки", "since purchase"))(r.change != null && id !== "all" ? r.startDate : r.start), round(r.startValue), round(r.change), round(r.flows), round(r.income), round(r.fees),
      r.exact || r.coverage > 0 ? round(r.earned) : null, r.earnedPct != null && isFinite(r.earnedPct) ? round(r.earnedPct * 100) : null,
      r.exact ? t("по выпискам", "statements") : r.coverage > 0 ? t("оценка по позициям", "estimate from positions") : t("нет точки отсчёта", "no starting point"), round(r.coverage * 100)]);
  }
  const hl = m.hist ? m.hist.lines.filter(L => L.current) : [];
  if(hl.some(L => L.points.length > 1)){
    dyn.push([], [t("История стоимости", "Value history")], [t("Дата", "Date"), t(`Стоимость, ${base}`, `Value, ${base}`), t("Откуда", "Source"), t("Банк", "Institution"), t("Стык с прошлой выпиской", "Link to the previous statement")]);
    for(const L of hl) for(const pt of L.points){
      const k = L.links.find(x => x.snap === pt.snap && pt.src === "snap");
      dyn.push([fmt.date(pt.date), round(pt.value), pt.src === "opening" ? t("начало периода выписки", "statement opening value") : t("выписка", "statement"), L.name,
        !k ? "" : k.gap ? t(`пробел ${fmt.date(k.gapFrom)} – ${fmt.date(k.gapTo)}`, `gap ${fmt.date(k.gapFrom)} – ${fmt.date(k.gapTo)}`) : k.ok === true ? t("сошёлся", "matches") : k.ok === false ? t("не сошёлся", "mismatch") : ""]);
    }
  }
  sheet(dyn, t("Динамика", "Changes"), [22, 12, 18, 18, 18, 14, 14, 16, 12, 22, 16]);
  if(mk){
    const P = WL.PERIODS.filter(([id]) => id !== "1d" && id !== "1w" && id !== "6m");
    sheet([[t("Рынок", "Market"), when], [t(`Оценка сейчас, ${base}`, `Value now, ${base}`), round(mk.nowTotal)], [t(`По выпискам, ${base}`, `Per statements, ${base}`), round(m.total)],
      [t("Доля по рыночной цене, %", "Share at market prices, %"), round(mk.coverage * 100)], [],
      [t("Изменение, %", "Change, %"), t("Весь портфель", "Whole portfolio"), t("Котируемая часть", "Listed part"), ...mk.benchmarks.map(b => b.label)],
      ...P.map(([id, l]) => [l, mk.perf[id] && mk.perf[id].whole != null ? round(mk.perf[id].whole * 100) : null, mk.perf[id] && mk.perf[id].pct != null ? round(mk.perf[id].pct * 100) : null,
        ...mk.benchmarks.map(b => b.perf ? b.perf[id] : null)]), [],
      [t("Котировка", "Quote"), t("Цена", "Price"), t("Изм. день, %", "Chg. day, %")], ...mk.overview.map(x => [x.label, x.price, x.change])], t("Рынок", "Market"), [34, 16, 16, 14]);
  }
  const al = [[t("Уровень", "Level"), t("Что", "What"), t("Подробно", "Details"), t("Источник", "Source")]];
  for(const a of m.alerts) al.push([LVL[a.level], a.title, a.text, basisOf(a)]);
  for(const a of (r.alerts || [])) al.push([LVL[a.level], a.title, a.text, t("ИИ-анализ", "AI analysis")]);
  for(const q of (r.questions || [])) al.push([t("Уточнить", "Check"), q.text, "", t("ИИ-анализ", "AI analysis")]);
  sheet(al, t("Внимание", "Attention"), [12, 48, 90, 34]);
  const name = `${(s.client || "WealthLens").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()} ${WL.today()}.xlsx`;
  X.writeFile(wb, name);
};
})();
