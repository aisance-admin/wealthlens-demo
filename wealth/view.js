/* WealthLens · экраны. Всё, что пришло из выписок и от ИИ, выводится только через esc(): текст документа не может
   стать разметкой страницы. */
(function(){
const WL = window.WL, t = WL.t, esc = WL.esc, fmt = WL.fmt, $ = WL.$;
const S = () => WL.state, M = () => WL.model;
const LVL = {high: t("Важно", "Important"), watch: t("Внимание", "Watch"), info: t("К сведению", "Note")};
const TYPE = {portfolio: t("портфельная выписка", "portfolio statement"), bank: t("банковская выписка", "bank statement"), brokerage: t("брокерская выписка", "brokerage statement"),
  transactions: t("список операций", "transaction list"), other_financial: t("финансовый документ", "financial document"), not_financial: t("не выписка", "not a statement")};
const WHY = {not_financial: t("это не выписка — в отчёт не входит", "not a statement — not included"), no_positions: t("позиций и остатков в файле нет", "no holdings or balances in the file"),
  unread: t("файл не прочитан", "the file was not read"), older: t("более старая выписка того же счёта — учтена свежая", "an older statement of the same account — the newer one is used"),
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
    ${f.status === "reading" ? `<span class="fb"><i style="width:${pct}%"></i></span>` : ""}</li>`;
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
      <div class="ts">${esc([m.mkt && WL.ui.val !== "stmt" ? "" : dates, `${m.byInst.length} ${WL.pl(m.byInst.length, ["банк", "банка", "банков"], ["institution", "institutions"])}`, `${nAcc} ${WL.pl(nAcc, ["счёт", "счёта", "счетов"], ["account", "accounts"])}`,
        `${m.positions.length} ${WL.pl(m.positions.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}`].filter(Boolean).join(" · "))}</div>
      ${m.accrued ? `<div class="ts muted">${t(`в т.ч. накопленный купон ${money(m.accrued)}`, `incl. accrued interest ${money(m.accrued)}`)}</div>` : ""}
      ${mix(agg(m))}
    </div>
    <div class="card where">
      <div class="eyebrow">${t("Где лежит", "Where it is")}${liveMode(m) ? ` · ${t("по текущим ценам", "at current prices")}` : ""}</div>
      <ul class="inst">${agg(m).byInst.map(i => { const worst = i.docs.map(d => d.recon ? d.recon.status : "none").sort((a, b) => ({mismatch: 0, partial: 1, none: 2, ok: 3})[a] - ({mismatch: 0, partial: 1, none: 2, ok: 3})[b])[0];
        return `<li><div class="in"><b>${esc(i.name)}</b><span class="muted">${esc(i.as_of.map(fmt.date).join(", "))}</span></div>
          <div class="iv"><b>${esc(money(i.value))}</b>${recBadge(worst)}</div><span class="trk"><i style="width:${Math.max(1, Math.round(100 * Math.max(0, i.share)))}%"></i></span></li>`; }).join("")}</ul>
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
function recBadge(st){
  if(st === "ok") return `<span class="badge ok" title="${t("Сумма позиций совпала с итогом банка", "Positions add up to the bank's total")}">${ICON.check}${t("сверено", "reconciled")}</span>`;
  if(st === "mismatch" || st === "partial") return `<span class="badge bad" title="${t("Сумма позиций не совпала с итогом банка", "Positions don't add up to the bank's total")}">${ICON.warn}${t("не сошлось", "mismatch")}</span>`;
  return `<span class="badge none" title="${t("В выписке нет итога для сверки", "The statement prints no total to check against")}">${t("без итога", "no total")}</span>`;
}
function mix(m){
  const cats = m.byCat.filter(c => c.value > 0);
  if(!cats.length) return "";
  return `<div class="mix"><div class="mix-bar">${cats.map(c => `<i class="c-${c.key}" style="flex-grow:${Math.max(0.004, c.share)}" title="${esc(c.label)} ${fmt.pct(c.share)}"></i>`).join("")}</div>
    <ul class="mix-legend">${cats.map(c => `<li><span class="k c-${c.key}"></span>${esc(c.label)} <b>${fmt.pct(c.share, c.share < 0.1 ? 1 : 0)}</b></li>`).join("")}</ul></div>`;
}

function brief(){
  const s = S(), r = s.review, m = M();
  let body;
  if(WL.reading && !r) body = `<p class="muted">${t("Сводка появится, когда все файлы будут прочитаны.", "The summary appears once all files are read.")}</p>`;
  else if(WL.reviewing) body = `<div class="skel"><i></i><i></i><i style="width:62%"></i></div>`;
  else if(r && r.summary) body = `<p class="summary">${esc(r.summary)}</p>${r.base && r.base !== m.base ? `<p class="fine">${t(`Суммы в сводке — в ${r.base}.`, `Amounts in the summary are in ${r.base}.`)}</p>` : ""}`;
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
  const m = M(), r = S().review;
  const extra = r && Array.isArray(r.alerts) ? r.alerts.map((a, i) => Object.assign({id: "ai-" + i, auto: false}, a)) : [];
  const rank = {high: 0, watch: 1, info: 2};
  return m.alerts.concat(extra).filter(a => a && a.title).map((a, i) => [a, i]).sort((x, y) => ((rank[x[0].level] ?? 3) - (rank[y[0].level] ?? 3)) || x[1] - y[1]).map(x => x[0]);
}
WL.alertList = alertList;
const topicOf = a => WL.topicId ? WL.topicId(a) : "";
function alertsBlock(){
  const all = alertList();
  if(!all.length) return "";
  const lock = locked();
  return `<section class="sec" id="alerts"><div class="sh"><h2>${t("На что обратить внимание", "What needs attention")}</h2><span class="muted">${all.length}</span>
      ${WL.topicId && !WL.printing ? `<span class="muted small no-print sh-hint">${t("нажмите на карточку, чтобы обсудить, что делать", "tap a card to discuss what to do")}</span>` : ""}</div>
    <div class="alerts">${all.map((a, i) => {
      const hide = lock && i > 0, tid = hide ? "" : topicOf(a);
      const shown = !hide && (a.refs || []).some(id => pos(id));
      return `<article class="card alert lv-${esc(a.level)}${hide ? " locked" : ""}${tid ? " talk" : ""}"${tid ? ` data-topic="${esc(tid)}"` : ""}><div class="al"><span class="lvl lv-${esc(a.level)}">${LVL[a.level] || ""}</span>${a.auto ? "" : `<span class="by">${ICON.spark}${t("ИИ-анализ", "AI analysis")}</span>`}</div>
        <h3>${esc(a.title)}</h3>${hide ? `<p class="muted lockline">${ICON.lock}${t("Подробности — в полном отчёте", "Details are in the full report")}</p><button class="link" type="button" data-buy="alert">${t("Открыть", "Unlock")}</button>` : `<p>${esc(a.text)}</p><p class="basis">${esc(basisOf(a))}</p>`}
        ${tid || shown ? `<div class="aa no-print">${tid ? `<button class="talkbtn" type="button" data-topic="${esc(tid)}">${ICON.spark}${t("Обсудить, что делать", "Discuss what to do")}</button>` : ""}
          ${shown ? `<button class="link" type="button" data-show="${esc((a.refs || []).filter(id => pos(id)).slice(0, 40).join(","))}">${t("Показать позиции", "Show positions")}</button>` : ""}</div>` : ""}</article>`; }).join("")}</div>
  </section>`;
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
  const r = S().review;
  if(!r || !Array.isArray(r.questions) || !r.questions.length) return "";
  return `<section class="sec" id="questions"><div class="sh"><h2>${t("Что стоит уточнить", "Worth checking")}</h2></div>
    <ul class="qlist card">${r.questions.map(q => { const tid = WL.topicId ? WL.topicId({question: q.text}) : "";
      return `<li>${tid ? `<button type="button" class="qbtn" data-topic="${esc(tid)}">${ICON.spark}<span>${esc(q.text)}</span><em class="no-print">${t("Обсудить", "Discuss")} →</em></button>` : `${ICON.spark}<span>${esc(q.text)}</span>`}</li>`; }).join("")}</ul></section>`;
}

function paywall(){
  if(!locked()) return "";
  const pay = WL.pay, gift = pay.promo();
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
function chgCell(p){
  if(p.cls === "cash" || p.cls === "deposit") return "";
  const per = WL.ui.per || "1d", src = p.underQ || p.mk;
  if(!src || (p.mk && p.mk.suspect)) return `<span class="nb">—</span>`;
  const pc = per === "1d" ? src.change : (src.perf || {})[per];
  if(pc == null) return `<span class="nb">—</span>`;
  const v = p.underQ ? null : p.nowB != null ? p.nowB * pc / (100 + pc) : null;
  return `<b class="${pc < 0 ? "dn" : "up"}">${pc > 0 ? "+" : ""}${esc(fmt.num(pc, 1))}%</b>${v != null ? `<span class="sub">${v > 0 ? "+" : ""}${esc(money(v))}</span>` : p.underQ ? `<span class="sub">${t("базовый актив", "underlying")}</span>` : ""}`;
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
    ${m.mkt ? `<div class="tools no-print"><div class="chips per" role="group" aria-label="${t("Период изменения", "Change period")}">${WL.PERIODS.map(([id, l]) => `<button type="button" data-per="${id}" aria-pressed="${(WL.ui.per || "1d") === id}">${esc(l)}</button>`).join("")}</div></div>` : ""}
    <div class="tools no-print">
      <div class="chips" role="group">${[{key: "all", label: t("Все", "All")}].concat(m.byCat).map(c => `<button type="button" data-cat="${c.key}" aria-pressed="${f === c.key}">${esc(c.label)}</button>`).join("")}</div>
      <input class="search" id="search" type="search" value="${esc(WL.ui.search || "")}" placeholder="${t("Найти бумагу, ISIN, банк", "Find a security, ISIN, bank")}" aria-label="${t("Поиск по позициям", "Search positions")}">
    </div>
    ${WL.ui.only ? `<p class="only no-print">${t("Показаны позиции из предупреждения.", "Showing the positions from a finding.")} <button class="link" type="button" data-clear-only>${t("Показать все", "Show all")}</button></p>` : ""}
    <div class="tw"><table class="pos"><thead><tr><th class="l">${t("Бумага", "Security")}</th><th class="l mh">${t("Где", "Where")}</th><th class="mh mt">${t("Кол-во", "Qty")}</th><th class="mh mt">${t("Цена", "Price")}</th>
      <th class="mh">${t("Стоимость", "Value")}</th><th class="mh mt">${t("Сейчас", "Now")}</th><th>${t("Изм.", "Chg.")}<span class="thsub">${esc(WL.periodLabel(WL.ui.per || "1d").toLowerCase())}</span></th><th>${esc(m.base)}${liveMode(m) ? `<span class="thsub">${t("сейчас", "now")}</span>` : ""}</th><th>${t("Доля", "Share")}</th></tr></thead>
      ${groups || `<tbody><tr><td colspan="9" class="muted">${t("Ничего не найдено.", "Nothing found.")}</td></tr></tbody>`}
      <tfoot><tr><td>${t("Итого", "Total")}</td>${PH}<td class="n">${(pf => pf && pf.whole != null ? `<b class="${pf.whole < 0 ? "dn" : "up"}" title="${t("Изменение всего портфеля: деньги и бумаги без котировки считаются неизменными", "Change of the whole portfolio: cash and holdings without a listed price are treated as unchanged")}">${pf.whole > 0 ? "+" : ""}${esc(fmt.pct(pf.whole, 1))}</b><span class="sub">${t("весь портфель", "whole portfolio")}</span>` : "")(m.mkt && m.mkt.perf[WL.ui.per || "1d"])}</td>
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
  const s = S(), m = M(), notes = (S().review && S().review.documents) || [];
  return `<section class="sec" id="files"><div class="sh"><h2>${t("Файлы", "Files")}</h2><span class="muted">${s.files.length}</span>
      <button class="btn small no-print" type="button" data-pick="files">${t("Добавить", "Add")}</button></div>
    <div class="docs">${s.files.map(f => {
      const d = m.docs.find(x => x.id === f.id), raw = s.docs.find(x => x.fileId === f.id), note = notes.find(n => n.id === f.id);
      const status = f.status !== "done" ? (f.status === "reading" || f.status === "queued" ? t("читается…", "reading…") : f.reason || t("не прочитан", "not read"))
        : d && !d.use ? WHY[d.why] || "" : "";
      return `<article class="card doc${d && !d.use ? " off" : ""}">
        <div class="dh"><span class="di">${ICON.file}</span><div class="dn"><b>${esc(f.name)}</b>
          <span class="muted">${esc([d && d.institution, d && TYPE[d.type], d && d.as_of && fmt.date(d.as_of), raw && `${raw.pageCount} ${WL.pl(raw.pageCount, ["стр.", "стр.", "стр."], ["page", "pages"])}`].filter(Boolean).join(" · "))}</span></div>
          ${d && d.use && d.recon ? recBadge(d.recon.status) : ""}</div>
        ${status ? `<p class="dst">${esc(status)}</p>` : ""}
        ${d && d.use && d.replaced && d.replaced.length ? `<p class="dst">${esc(d.replaced.map(z => t(`Счёт ${z.acct} — учтена более свежая выписка «${z.byFile}»${z.byDate ? " на " + fmt.date(z.byDate) : ""}`,
          `Account ${z.acct} — the newer statement “${z.byFile}”${z.byDate ? " as of " + fmt.date(z.byDate) : ""} is used`)).join("; ") + t(". Остальные счета — из этой выписки.", ". The other accounts come from this statement."))}</p>` : ""}
        ${d && d.use && d.recon && d.recon.checks.length ? `<ul class="checks">${d.recon.checks.slice(0, 6).map(c => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? ICON.check : ICON.warn}<span>${esc(c.label)}: ${esc(fmt.money(c.amount, c.ccy, 2))}${c.ok ? (c.withAccrued ? t(" — сошлось с учётом НКД", " — matches incl. accrued interest") : t(" — сошлось", " — matches")) : t(` — прочитано ${fmt.money(c.sum, c.ccy, 2)}`, ` — read ${fmt.money(c.sum, c.ccy, 2)}`)}</span></li>`).join("")}</ul>` : ""}
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
        </div></article>`; }).join("")}</div>
  </section>`;
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
  return printHead + demoBar() + readingPanel() + hero() + paywall() + brief() + alertsBlock() + questions() + holdings() + currenciesAndDates() + (WL.marketSection ? WL.marketSection() : "") + files() + method();
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
  const m = M(), s = S(), r = s.review || {}, base = m.base;
  const round = (v, d = 2) => v == null || !isFinite(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const wb = X.utils.book_new();
  const sum = [[s.client || "WealthLens"], [t("Отчёт по портфелю", "Portfolio report"), WL.today()], [],
    [t(`Всего, ${base}`, `Total, ${base}`), round(m.total)], [t("в т.ч. накопленный купон", "incl. accrued interest"), round(m.accrued)], [],
    [t("Категория", "Category"), base, t("Доля, %", "Share, %"), t("Позиций", "Positions")], ...m.byCat.map(c => [c.label, round(c.value), round(c.share * 100), c.count]), [],
    [t("Банк", "Institution"), base, t("Доля, %", "Share, %"), t("Дата", "As of")], ...m.byInst.map(i => [i.name, round(i.value), round(i.share * 100), i.as_of.join(", ")]), [],
    [t("Валюта", "Currency"), base, t("Доля, %", "Share, %")], ...m.byCcy.map(c => [c.ccy, round(c.value), round(c.share * 100)])];
  if(r.summary) sum.push([], [t("Коротко о портфеле", "The portfolio in brief")], [r.summary]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sum), t("Сводка", "Summary"));
  const head = [t("Категория", "Category"), t("Бумага", "Security"), "ISIN", t("Тикер", "Ticker"), t("Банк", "Institution"), t("Счёт", "Account"), t("Количество", "Quantity"),
    t("Цена", "Price"), t("Цена в % номинала", "Price in % of nominal"), t("Стоимость", "Value"), t("Валюта", "Currency"), t("Накопленный купон", "Accrued interest"),
    t(`Стоимость, ${base}`, `Value, ${base}`), t("Доля, %", "Share, %"), t("Погашение / экспирация", "Maturity / expiry"), t("Купон, %", "Coupon, %"), t("Опцион", "Option"),
    t("Себестоимость", "Cost"), t("Файл", "File"), t("Страница", "Page"), t("Дата выписки", "Statement date"),
    t("Биржевой символ", "Listing"), t("Цена сейчас", "Price now"), t("Валюта котировки", "Quote currency"), t("Изм. день, %", "Chg. day, %"), t("Изм. месяц, %", "Chg. month, %"),
    t("Изм. год, %", "Chg. year, %"), t(`Сейчас, ${base}`, `Now, ${base}`), t("Базовый актив", "Underlying"), t("Базовый актив сейчас", "Underlying now")];
  const rows = m.positions.slice().sort((a, b) => a.cat.localeCompare(b.cat) || ((b.vb || 0) - (a.vb || 0))).map(p => [WL.catOf(p.cls).label, p.name, p.isin, p.ticker, p.inst, p.acct,
    p.qty, p.price, p.unit === "%" ? t("да", "yes") : "", p.value, p.ccy, p.accrued, round((p.vb || 0) + (p.ab || 0)), round(p.w * 100, 3), p.date, p.coupon,
    p.right ? `${p.right} ${p.strike ?? ""} ${p.under || ""}`.trim() : "", p.cost, p.docFile, p.page || null, p.as_of,
    p.mk && !p.mk.suspect ? p.mk.symbol || "Cboe" : "", p.mk && !p.mk.suspect ? p.mk.price : null, p.mk && !p.mk.suspect ? p.mk.ccy : "", p.mk && !p.mk.suspect ? p.mk.change : null,
    p.mk && !p.mk.suspect && p.mk.perf ? p.mk.perf["1m"] : null, p.mk && !p.mk.suspect && p.mk.perf ? p.mk.perf["1y"] : null, p.nowB != null ? round(p.nowB + (p.ab || 0)) : null,
    p.underQ ? (p.underQ.name || p.under) : (p.mk && p.mk.underlying ? p.under : ""), p.underQ ? p.underQ.price : (p.mk && p.mk.underlying) || null]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([head, ...rows]), t("Позиции", "Positions"));
  const docs = [[t("Файл", "File"), t("Банк", "Institution"), t("Документ", "Document"), t("Дата", "As of"), t("Страниц", "Pages"), t("В отчёте", "Included"), t("Причина", "Reason"),
    t("Сверка", "Reconciliation"), t("Итог банка", "Bank total"), t("Валюта итога", "Total currency"), t("Сумма позиций", "Positions sum")]];
  for(const d of m.docs){ const c = d.recon && (d.recon.checks.find(x => x.scope === "total") || d.recon.checks[0]);
    docs.push([d.file, d.institution, TYPE[d.type] || d.type, d.as_of, d.pageCount, d.use ? t("да", "yes") : t("нет", "no"), d.use ? "" : WHY[d.why] || d.why,
      d.recon ? {ok: t("сошлось", "matches"), partial: t("частично", "partly"), mismatch: t("не сошлось", "mismatch"), none: t("нет итога", "no total")}[d.recon.status] : "",
      c ? c.amount : null, c ? c.ccy : "", c ? round(c.sum) : null]); }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(docs), t("Выписки", "Statements"));
  if(m.mkt){
    const mk = m.mkt, P = WL.PERIODS.filter(([id]) => id !== "1d" && id !== "1w" && id !== "6m");
    const sheet = [[t("Рынок", "Market"), new Date(mk.at).toLocaleString()], [t(`Оценка сейчас, ${base}`, `Value now, ${base}`), round(mk.nowTotal)], [t(`По выпискам, ${base}`, `Per statements, ${base}`), round(m.total)],
      [t("Доля по рыночной цене, %", "Share at market prices, %"), round(mk.coverage * 100)], [],
      [t("Изменение, %", "Change, %"), t("Весь портфель", "Whole portfolio"), t("Котируемая часть", "Listed part"), ...mk.benchmarks.map(b => b.label)],
      ...P.map(([id, l]) => [l, mk.perf[id] && mk.perf[id].whole != null ? round(mk.perf[id].whole * 100) : null, mk.perf[id] && mk.perf[id].pct != null ? round(mk.perf[id].pct * 100) : null,
        ...mk.benchmarks.map(b => b.perf ? b.perf[id] : null)]), [],
      [t("Котировка", "Quote"), t("Цена", "Price"), t("Изм. день, %", "Chg. day, %")], ...mk.overview.map(x => [x.label, x.price, x.change])];
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sheet), t("Рынок", "Market"));
  }
  const al = [[t("Уровень", "Level"), t("Что", "What"), t("Подробно", "Details"), t("Источник", "Source")]];
  for(const a of m.alerts) al.push([LVL[a.level], a.title, a.text, basisOf(a)]);
  for(const a of (r.alerts || [])) al.push([LVL[a.level], a.title, a.text, t("ИИ-анализ", "AI analysis")]);
  for(const q of (r.questions || [])) al.push([t("Уточнить", "Check"), q.text, "", t("ИИ-анализ", "AI analysis")]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(al), t("Внимание", "Attention"));
  const name = `${(s.client || "WealthLens").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()} ${WL.today()}.xlsx`;
  X.writeFile(wb, name);
};
})();
