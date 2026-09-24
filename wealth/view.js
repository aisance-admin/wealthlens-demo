/* WealthLens · экраны. Всё, что пришло из выписок и от Claude, выводится только через esc(): текст документа не может
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
      <p class="lede">${t("Файлы или целую папку: PDF из банков и от брокеров, сканы и фото, Excel. Claude прочитает каждую страницу и разложит всё по полочкам: сколько денег, где они лежат, из чего состоит портфель и на что обратить внимание.",
        "Files or a whole folder: PDFs from banks and brokers, scans and photos, Excel. Claude reads every page and lays it all out: how much there is, where it sits, what the portfolio is made of and what needs attention.")}</p>
      <div class="actions">
        <button class="btn primary big" type="button" data-pick="files">${t("Выбрать файлы", "Choose files")}</button>
        <button class="btn big" type="button" data-pick="folder">${t("Выбрать папку", "Choose a folder")}</button>
      </div>
      <p class="hint">${t("или перетащите их сюда · PDF, JPG, PNG, Excel, CSV", "or drag them here · PDF, JPG, PNG, Excel, CSV")}</p>
      <a class="demo-link" href="?demo=1${WL.EN ? "&lang=en" : ""}">${t("Посмотреть пример отчёта", "See a sample report")}</a>
    </div>
    <ol class="how">
      <li><b>${t("Кладёте файлы", "Drop the files")}</b><span>${t("Любые выписки, в любом виде и на любом языке.", "Any statements, in any layout or language.")}</span></li>
      <li><b>${t("Claude читает", "Claude reads them")}</b><span>${t("Каждую страницу, как человек: таблицы, итоги, валюты.", "Every page, like a person would: tables, totals, currencies.")}</span></li>
      <li><b>${t("Получаете отчёт", "You get the report")}</b><span>${t("Здесь в браузере, в PDF и в Excel.", "Here in the browser, as PDF and as Excel.")}</span></li>
    </ol>
    <p class="privacy">${ICON.lock}<span>${t("Страницы выписок читает ИИ Claude компании Anthropic через наш сервер. Мы не храним ни файлы, ни результат: отчёт остаётся в этом браузере.",
      "Statement pages are read by Anthropic's Claude AI through our server. We store neither the files nor the result: the report stays in this browser.")}
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
    <div class="rh"><span class="orb">${ICON.spark}</span><div><h2>${t("Claude читает выписки", "Claude is reading your statements")}</h2>
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
      <div class="tv">${esc(money(m.total))}</div>
      <div class="ts">${esc([dates, `${m.byInst.length} ${WL.pl(m.byInst.length, ["банк", "банка", "банков"], ["institution", "institutions"])}`, `${nAcc} ${WL.pl(nAcc, ["счёт", "счёта", "счетов"], ["account", "accounts"])}`,
        `${m.positions.length} ${WL.pl(m.positions.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}`].filter(Boolean).join(" · "))}</div>
      ${m.accrued ? `<div class="ts muted">${t(`в т.ч. накопленный купон ${money(m.accrued)}`, `incl. accrued interest ${money(m.accrued)}`)}</div>` : ""}
      ${mix(m)}
    </div>
    <div class="card where">
      <div class="eyebrow">${t("Где лежит", "Where it is")}</div>
      <ul class="inst">${m.byInst.map(i => { const worst = i.docs.map(d => d.recon ? d.recon.status : "none").sort((a, b) => ({mismatch: 0, partial: 1, none: 2, ok: 3})[a] - ({mismatch: 0, partial: 1, none: 2, ok: 3})[b])[0];
        return `<li><div class="in"><b>${esc(i.name)}</b><span class="muted">${esc(i.as_of.map(fmt.date).join(", "))}</span></div>
          <div class="iv"><b>${esc(money(i.value))}</b>${recBadge(worst)}</div><span class="trk"><i style="width:${Math.max(1, Math.round(100 * Math.max(0, i.share)))}%"></i></span></li>`; }).join("")}</ul>
    </div>
  </section>`;
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

function claude(){
  const s = S(), r = s.review, m = M();
  let body;
  if(WL.reading && !r) body = `<p class="muted">${t("Сводка появится, когда Claude дочитает все файлы.", "The summary appears once Claude has read all files.")}</p>`;
  else if(WL.reviewing) body = `<div class="skel"><i></i><i></i><i style="width:62%"></i></div>`;
  else if(r && r.summary) body = `<p class="summary">${esc(r.summary)}</p>${r.base && r.base !== m.base ? `<p class="fine">${t(`Суммы в сводке — в ${r.base}.`, `Amounts in the summary are in ${r.base}.`)}</p>` : ""}`;
  else if(r && r.error) body = `<p class="muted">${t("Сводку получить не удалось.", "Could not get the summary.")} <button class="link" type="button" data-review>${t("Повторить", "Try again")}</button></p>`;
  else body = `<p class="muted"><button class="link" type="button" data-review>${t("Получить сводку от Claude", "Get a summary from Claude")}</button></p>`;
  const qa = (s.qa || []).map(x => `<div class="q">${esc(x.q)}</div><div class="a">${x.a == null ? '<div class="skel"><i></i><i style="width:48%"></i></div>' : esc(x.a)}</div>`).join("");
  return `<section class="card claude" id="claude">
    <div class="ch"><span class="orb">${ICON.spark}</span><div><div class="eyebrow">${t("Коротко о портфеле", "The portfolio in brief")}</div><span class="muted small">${t("сводка Claude по прочитанным выпискам", "Claude's summary of the statements it read")}</span></div></div>
    ${body}
    <div class="qa" id="qa">${qa}</div>
    <form class="ask" id="ask" autocomplete="off"><input name="q" maxlength="600" placeholder="${t("Спросите про свой портфель: сколько в облигациях, что погашается в этом году…", "Ask about your portfolio: how much is in bonds, what matures this year…")}" aria-label="${t("Вопрос по отчёту", "Question about the report")}">
      <button class="btn" type="submit">${t("Спросить", "Ask")}</button></form>
  </section>`;
}

function alertsBlock(){
  const m = M(), r = S().review;
  const extra = r && Array.isArray(r.alerts) ? r.alerts.map((a, i) => Object.assign({id: "claude-" + i, auto: false}, a)) : [];
  const rank = {high: 0, watch: 1, info: 2};
  const all = m.alerts.concat(extra).filter(a => a && a.title).map((a, i) => [a, i]).sort((x, y) => ((rank[x[0].level] ?? 3) - (rank[y[0].level] ?? 3)) || x[1] - y[1]).map(x => x[0]);
  if(!all.length) return "";
  const lock = locked();
  return `<section class="sec" id="alerts"><div class="sh"><h2>${t("На что обратить внимание", "What needs attention")}</h2><span class="muted">${all.length}</span></div>
    <div class="alerts">${all.map((a, i) => {
      const hide = lock && i > 0;
      return `<article class="card alert lv-${esc(a.level)}${hide ? " locked" : ""}"><div class="al"><span class="lvl lv-${esc(a.level)}">${LVL[a.level] || ""}</span>${a.auto ? "" : `<span class="by">${ICON.spark}Claude</span>`}</div>
        <h3>${esc(a.title)}</h3>${hide ? `<p class="muted lockline">${ICON.lock}${t("Подробности — в полном отчёте", "Details are in the full report")}</p>` : `<p>${esc(a.text)}</p>`}
        ${!hide && (a.refs || []).some(id => pos(id)) ? `<button class="link" type="button" data-show="${esc((a.refs || []).filter(id => pos(id)).slice(0, 40).join(","))}">${t("Показать позиции", "Show positions")}</button>` : ""}</article>`; }).join("")}</div>
  </section>`;
}

function questions(){
  const r = S().review;
  if(!r || !Array.isArray(r.questions) || !r.questions.length) return "";
  return `<section class="sec" id="questions"><div class="sh"><h2>${t("Что стоит уточнить", "Worth checking")}</h2></div>
    <ul class="qlist card">${r.questions.map(q => `<li>${ICON.spark}<span>${esc(q.text)}</span></li>`).join("")}</ul></section>`;
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
function row(p){
  const w = p.w, price = p.price != null ? (p.unit === "%" ? fmt.num(p.price, 2) + "%" : fmt.num(p.price, p.price >= 1000 ? 0 : 2)) : "—";
  return `<tr class="pr" data-pos="${esc(p.id)}" tabindex="0">
    <td class="nm"><b>${esc(p.name || p.isin || "—")}</b><span class="sub">${esc(detailOf(p))}</span></td>
    <td class="ac">${esc(p.inst)}${p.acct ? `<span class="sub">${esc(p.acct)}</span>` : ""}</td>
    <td class="n">${p.cls === "cash" || (p.cls === "deposit" && p.qty == null) ? "" : esc(fmt.qty(p.qty))}</td>
    <td class="n">${p.cls === "cash" || (p.cls === "deposit" && p.price == null) ? "" : esc(price)}</td>
    <td class="n">${esc(p.value != null ? fmt.money(p.value, p.ccy || "", p.cls === "cash" ? 2 : 0) : "—")}${p.accrued ? `<span class="sub">+ ${t("НКД", "acc.")} ${esc(fmt.money(p.accrued, p.ccy || "", 0))}</span>` : ""}</td>
    <td class="n strong">${p.vb == null ? `<span class="unk" title="${t("нет курса", "no FX rate")}">—</span>` : esc(money(p.vb + (p.ab || 0)))}</td>
    <td class="n w">${esc(fmt.pct(w, Math.abs(w) < 0.1 ? 1 : 0))}</td></tr>`;
}
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
    return `<tbody class="grp"><tr class="gh"><td colspan="5"><span class="k c-${c.key}"></span>${esc(c.label)} <span class="muted">· ${ps.length}</span></td>
        <td class="n strong">${esc(money(c.value))}</td><td class="n w">${esc(fmt.pct(c.share, 0))}</td></tr>
      ${shown.map(row).join("")}
      ${hidden ? `<tr class="lockrow"><td colspan="7">${ICON.lock}${t(`Ещё ${hidden} ${WL.pl(hidden, ["позиция", "позиции", "позиций"], ["position", "positions"])} — в полном отчёте`, `${hidden} more ${WL.pl(hidden, ["position", "positions"], ["position", "positions"])} in the full report`)}
        <button class="link" type="button" data-buy="holdings">${t("Открыть", "Unlock")}</button></td></tr>` : ""}</tbody>`;
  }).join("");
  return `<section class="sec" id="holdings"><div class="sh"><h2>${t("Все позиции", "All positions")}</h2><span class="muted">${m.positions.length}</span></div>
    <div class="tools no-print">
      <div class="chips" role="group">${[{key: "all", label: t("Все", "All")}].concat(m.byCat).map(c => `<button type="button" data-cat="${c.key}" aria-pressed="${f === c.key}">${esc(c.label)}</button>`).join("")}</div>
      <input class="search" id="search" type="search" value="${esc(WL.ui.search || "")}" placeholder="${t("Найти бумагу, ISIN, банк", "Find a security, ISIN, bank")}" aria-label="${t("Поиск по позициям", "Search positions")}">
    </div>
    ${WL.ui.only ? `<p class="only no-print">${t("Показаны позиции из предупреждения.", "Showing the positions from a finding.")} <button class="link" type="button" data-clear-only>${t("Показать все", "Show all")}</button></p>` : ""}
    <div class="tw"><table class="pos"><thead><tr><th class="l">${t("Бумага", "Security")}</th><th class="l">${t("Где", "Where")}</th><th>${t("Кол-во", "Qty")}</th><th>${t("Цена", "Price")}</th>
      <th>${t("Стоимость", "Value")}</th><th>${esc(m.base)}</th><th>${t("Доля", "Share")}</th></tr></thead>
      ${groups || `<tbody><tr><td colspan="7" class="muted">${t("Ничего не найдено.", "Nothing found.")}</td></tr></tbody>`}
      <tfoot><tr><td colspan="5">${t("Итого", "Total")}</td><td class="n strong">${esc(money(m.total))}</td><td class="n w">100%</td></tr></tfoot></table></div>
  </section>`;
}

function currenciesAndDates(){
  const m = M(), lock = locked() && !WL.printing;
  const cc = m.byCcy.filter(c => Math.abs(c.value) > 0.5);
  const tl = m.timeline.slice(0, 14);
  return `<section class="sec two">
    <div class="card pad"><div class="eyebrow">${t("Валюты", "Currencies")}</div>
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
  return `<footer class="method"><p>${t("Позиции и итоги прочитал Claude (Anthropic) прямо из страниц выписок; числа не пересчитывались, кроме перевода в валюту отчёта", "Positions and totals were read by Claude (Anthropic) straight from the statement pages; numbers are as printed, except the conversion to the report currency")}${rates.length ? ": " + esc(rates.join("; ")) : ""}.
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
    <p class="muted">${t("В этих файлах Claude не нашёл ни остатков, ни бумаг. Проверьте, что это выписки по счетам, — ниже по каждому файлу написано, что в нём.", "Claude found no balances or securities in these files. Check that they are account statements — each file below says what it contains.")}</p></section>`) + files();
  return printHead + demoBar() + readingPanel() + hero() + paywall() + claude() + alertsBlock() + questions() + holdings() + currenciesAndDates() + files() + method();
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
    [t("Доля портфеля", "Share of portfolio"), fmt.pct(p.w, 2)],
    [t("Себестоимость", "Cost"), p.cost != null ? fmt.money(p.cost, p.ccy || "", 2) : ""],
    [t("Результат к себестоимости", "Gain vs cost"), p.cost != null && p.value != null ? fmt.money(p.value - p.cost, p.ccy || "", 2) + (p.cost ? ` (${fmt.pct((p.value - p.cost) / Math.abs(p.cost))})` : "") : ""],
    [["option", "future"].includes(p.cls) ? t("Экспирация", "Expiry") : t("Погашение", "Maturity"), p.date ? fmt.date(p.date) : ""],
    [t("Купон", "Coupon"), p.coupon != null ? fmt.num(p.coupon, 3).replace(/([,.]\d*?)0+$/, "$1").replace(/[,.]$/, "") + "%" : ""],
    [t("Опцион", "Option"), p.right ? `${p.right === "C" ? t("колл", "call") : t("пут", "put")} ${p.strike ?? ""} ${p.under || ""}` : ""],
    ["ISIN", p.isin], [t("Тикер", "Ticker"), p.ticker],
    [t("Курс", "FX"), {statement: t("из выписки", "from the statement"), ecb: t("ЕЦБ на дату выписки", "ECB on the statement date"), alt: "currency-api", peg: t("привязка к доллару", "dollar peg"), same: ""}[p.fxSrc] || ""],
  ].filter(r => r[1] !== "" && r[1] != null);
  const dr = $("#drawer");
  dr.innerHTML = `<button class="x" type="button" data-close aria-label="${t("Закрыть", "Close")}">×</button>
    <div class="eyebrow">${esc(WL.catOf(p.cls).label)}</div><h3>${esc(p.name || p.isin)}</h3>
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
  if(r.summary) sum.push([], [t("Коротко (Claude)", "In brief (Claude)")], [r.summary]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sum), t("Сводка", "Summary"));
  const head = [t("Категория", "Category"), t("Бумага", "Security"), "ISIN", t("Тикер", "Ticker"), t("Банк", "Institution"), t("Счёт", "Account"), t("Количество", "Quantity"),
    t("Цена", "Price"), t("Цена в % номинала", "Price in % of nominal"), t("Стоимость", "Value"), t("Валюта", "Currency"), t("Накопленный купон", "Accrued interest"),
    t(`Стоимость, ${base}`, `Value, ${base}`), t("Доля, %", "Share, %"), t("Погашение / экспирация", "Maturity / expiry"), t("Купон, %", "Coupon, %"), t("Опцион", "Option"),
    t("Себестоимость", "Cost"), t("Файл", "File"), t("Страница", "Page"), t("Дата выписки", "Statement date")];
  const rows = m.positions.slice().sort((a, b) => a.cat.localeCompare(b.cat) || ((b.vb || 0) - (a.vb || 0))).map(p => [WL.catOf(p.cls).label, p.name, p.isin, p.ticker, p.inst, p.acct,
    p.qty, p.price, p.unit === "%" ? t("да", "yes") : "", p.value, p.ccy, p.accrued, round((p.vb || 0) + (p.ab || 0)), round(p.w * 100, 3), p.date, p.coupon,
    p.right ? `${p.right} ${p.strike ?? ""} ${p.under || ""}`.trim() : "", p.cost, p.docFile, p.page || null, p.as_of]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([head, ...rows]), t("Позиции", "Positions"));
  const docs = [[t("Файл", "File"), t("Банк", "Institution"), t("Документ", "Document"), t("Дата", "As of"), t("Страниц", "Pages"), t("В отчёте", "Included"), t("Причина", "Reason"),
    t("Сверка", "Reconciliation"), t("Итог банка", "Bank total"), t("Валюта итога", "Total currency"), t("Сумма позиций", "Positions sum")]];
  for(const d of m.docs){ const c = d.recon && (d.recon.checks.find(x => x.scope === "total") || d.recon.checks[0]);
    docs.push([d.file, d.institution, TYPE[d.type] || d.type, d.as_of, d.pageCount, d.use ? t("да", "yes") : t("нет", "no"), d.use ? "" : WHY[d.why] || d.why,
      d.recon ? {ok: t("сошлось", "matches"), partial: t("частично", "partly"), mismatch: t("не сошлось", "mismatch"), none: t("нет итога", "no total")}[d.recon.status] : "",
      c ? c.amount : null, c ? c.ccy : "", c ? round(c.sum) : null]); }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(docs), t("Выписки", "Statements"));
  const al = [[t("Уровень", "Level"), t("Что", "What"), t("Подробно", "Details"), t("Источник", "Source")]];
  for(const a of m.alerts) al.push([LVL[a.level], a.title, a.text, t("расчёт", "calculation")]);
  for(const a of (r.alerts || [])) al.push([LVL[a.level], a.title, a.text, "Claude"]);
  for(const q of (r.questions || [])) al.push([t("Уточнить", "Check"), q.text, "", "Claude"]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(al), t("Внимание", "Attention"));
  const name = `${(s.client || "WealthLens").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()} ${WL.today()}.xlsx`;
  X.writeFile(wb, name);
};
})();
