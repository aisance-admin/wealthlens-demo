/* Флоу велса · таблица позиций в системе координат велса и график против бенчмарка.
   В каждой ячейке либо число с его основой (сейчас / на дату выписки), либо честное
   «нет в выписке». Суммы по брокерам с разными датами не выдаются за одно «сейчас». */
(function(){
const WL = window.WL = window.WL || {};
const {fmt} = WL;
// Строки интерфейса — WL.t("русский", "English"); имя t здесь занято параметрами и переменными цикла.
const esc = WL.esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const unk = t => `<span class="unk">${esc(t)}</span>`;
// Прочерк вместо повторяющегося «нет в выписке»: причина — во всплывающей подсказке и в легенде под таблицей.
const dash = t => `<span class="unk" title="${esc(t)}">—</span>`;
const sub = t => `<span class="sub2">${t}</span>`;
const cls = v => v > 0 ? "up" : v < 0 ? "down" : "";
const TYPE_ORDER = ["stock", "fund", "bond", "note", "other", "option", "future", "cash"];
const staleDoc = (P, d) => d && WL.days(d.asOf, P.today) > 45;
const NOT_IN = () => WL.t("нет в выписке", "not in statement");
const NO_DATA = () => WL.t("нет данных за этот период", "no data for this period");
const IN_CASH = () => WL.t("в деньгах счёта", "in account cash");

function row(P, p, per){
  const k = WL.usd(P, p.ccy, p), cur = WL.current(P, p), doc = P.docs.find(d => d.fileName === p.source);
  const stale = staleDoc(P, doc);
  const code = p.type === "cash" ? p.ccy : (p.occ || p.symbol || p.code || p.isin);
  let note = "";
  if(p.type === "option") note = WL.t(`${p.qty < 0 ? "продан" : "куплен"} · истекает ${fmt.date(p.expiry)}`, `${p.qty < 0 ? "short" : "long"} · expires ${fmt.date(p.expiry)}`);
  if(p.type === "future") note = WL.t(`последний торговый день ${fmt.date(p.expiry)}`, `last trading day ${fmt.date(p.expiry)}`);
  if(p.expiry && p.expiry < P.today) note += WL.t(" · истёк после даты выписки", " · expired after the statement date");
  const td = [];
  td.push(`<td class="l nm">${esc(p.name)}${sub(`<span class="code">${esc(code)}</span>${note ? " · " + esc(note) : ""}`)}</td>`);
  // Брокер — колонка, а не отдельная таблица. Дата выписки стоит здесь же: в общем списке
  // соседние строки могут быть на разные даты, и это должно быть видно в самой строке.
  td.push(`<td class="l brk" data-l="${WL.t("Брокер", "Broker")}">${esc(p.brokerShort)}${stale ? sub(WL.t(`на ${fmt.date(doc.asOf)}`, `as of ${fmt.date(doc.asOf)}`)) : ""}</td>`);
  const contracts = p.type === "option" || p.type === "future";
  td.push(`<td class="qty" data-l="${WL.t("Кол-во", "Qty")}">${p.type === "cash" || p.qty == null ? "" : fmt.qty(p.qty) + (contracts ? sub(WL.t("контр.", Math.abs(p.qty) === 1 ? "contract" : "contracts")) : "")}</td>`);

  // Цена и дата покупки — один пункт у велса, одна колонка здесь.
  let buyMain = "", buyNote = "";
  if(!contracts && p.type !== "cash"){
    // Облигации и ноты котируются в процентах номинала: 99,47, а не 0,9947 за единицу номинала.
    if(p.priceBasis === "percent" && (p.costPrice != null || (p.cost != null && p.qty))){ buyMain = fmt.px(p.costPrice ?? p.cost / p.qty * 100) + "%"; buyNote = WL.t("средняя, % номинала", "average, % of nominal"); }
    else if(p.cost != null && p.qty){ buyMain = fmt.px(p.cost / p.qty); buyNote = WL.t("средняя", "average"); }
    else buyMain = unk(p.costNote || NOT_IN());
  } else if(p.type === "option"){
    const prem = p.cost != null ? p.cost : p.premium;
    if(prem != null && p.multiplier && p.qty){ buyMain = fmt.px(Math.abs(prem / (p.qty * p.multiplier))); buyNote = WL.t("премия", "premium"); }
    else if(prem != null){ buyMain = fmt.money(prem, p.ccy, 0); buyNote = WL.t("премия всего", "total premium"); }
    else buyMain = dash(NOT_IN());
  } else if(p.type === "future") buyMain = unk(WL.t("по сделкам", "by trade"));
  if(p.type !== "cash") buyNote = [buyNote, p.purchaseDate
    ? `${fmt.date(p.purchaseDate)}${p.purchaseNote ? " (" + esc(p.purchaseNote) + ")" : ""}` : ""].filter(Boolean).join(" · ");
  td.push(`<td class="buy" data-l="${WL.t("Покупка", "Cost")}">${buyMain}${buyNote ? sub(buyNote) : ""}</td>`);
  td.push(`<td class="fee" data-l="${WL.t("Комиссия", "Fees")}">${p.type === "cash" ? "" : p.commission != null ? fmt.money(p.commission, p.ccy) : dash(NOT_IN())}</td>`);

  let px = "";
  if(p.type !== "cash"){
    if(cur.live) px = fmt.px(cur.price) + sub(WL.t(`сейчас${p.live.delta != null ? " · дельта " + fmt.px(Math.abs(p.live.delta)) : ""}`,
                                                   `now${p.live.delta != null ? " · delta " + fmt.px(Math.abs(p.live.delta)) : ""}`));
    else if(p.price != null) px = fmt.px(p.price) + (p.priceBasis === "percent" ? "%" : "") + sub(WL.t(`на ${fmt.date(p.priceDate)}`, `as of ${fmt.date(p.priceDate)}`));
    else px = dash(NOT_IN());
  }
  td.push(`<td class="px" data-l="${WL.t("Цена", "Price")}">${px}</td>`);

  const ch = p.type === "cash" ? null : WL.change(P, p, per);
  td.push(`<td class="chg" data-l="${WL.t("Изменение", "Change")}">${p.type === "cash" ? "" : ch ? `<span class="${cls(ch.abs)}">${fmt.signed(ch.abs, p.ccy)}</span>` +
    (ch.pct != null ? sub(`<span class="${cls(ch.abs)}">${fmt.pct(ch.pct)}</span>`) : "") : dash(NO_DATA())}</td>`);

  let val, usd;
  if(cur.value != null){
    val = fmt.money(cur.value, p.ccy, 0);
    usd = k != null ? fmt.money(cur.value * k, "USD", 0) : unk(WL.t("нет курса", "no FX rate"));
  } else {
    val = p.type === "future" ? unk(IN_CASH()) : dash(p.valueNote || NOT_IN());
    usd = dash(WL.t("стоимости нет в выписке", "value not in statement"));
  }
  if(p.notional != null) { val += sub(WL.t(`номинал ${fmt.short(p.notional, p.ccy)}`, `notional ${fmt.short(p.notional, p.ccy)}`)); }
  if(p.type === "option" && p.qty < 0 && p.multiplier){
    // Проданный колл, полностью покрытый акциями на том же счёте, — не обязательство купить что-то на рынке.
    const n = Math.abs(p.qty) * p.multiplier;
    const held = p.right === "C" && P.positions.find(s => WL.eq(s) && s.symbol === p.underlying && s.source === p.source);
    val += sub(held && held.qty >= n ? WL.t(`покрыт ${fmt.int(n)} акций`, `covered by ${fmt.int(n)} ${n === 1 ? "share" : "shares"}`)
      : WL.t(`${p.right === "P" ? "обязательство купить" : "обязательство продать"} на ${fmt.short(n * p.strike, p.ccy)}`,
             `${p.right === "P" ? "obligation to buy" : "obligation to sell"} ${fmt.short(n * p.strike, p.ccy)}`));
  }
  td.push(`<td class="loc" data-l="${WL.t("В валюте", "Local")}">${val}</td>`, `<td class="usd" data-l="${WL.t("В USD", "USD")}">${usd}</td>`);
  return {html: `<tr class="row" data-id="${esc(p.id)}" tabindex="0">${td.join("")}</tr>`, usd: cur.value != null && k != null ? cur.value * k : null,
          change: ch && k != null ? ch.abs * k : null, counts: p.type !== "cash"};
}

/* Единый список по всему портфелю: по умолчанию всё вместе, брокер — колонка. Внутри типа
   акции, фьючерсы и деньги идут по размеру позиции, опционы — по сроку, истёкшие в конце.
   Отдельная площадка смотрится переключателем «Брокер» и карточками вверху страницы. */
const TYPE_LABEL = {stock: WL.t("Акции", "Stocks"), fund: WL.t("Фонды", "Funds"), bond: WL.t("Облигации", "Bonds"), note: WL.t("Структурные ноты", "Structured notes"),
  other: WL.t("Прочее", "Other"), option: WL.t("Опционы", "Options"), future: WL.t("Фьючерсы", "Futures"), cash: WL.t("Деньги", "Cash")};
function sortKey(P, p){
  if(p.type === "option") return (p.expiry && p.expiry < P.today ? "Z" : "A") + (p.expiry || "");
  const k = WL.usd(P, p.ccy, p), v = WL.current(P, p).value;
  const usd = v != null && k != null ? v * k : (p.notional != null && k != null ? p.notional * k : 0);
  return -Math.abs(usd);
}

WL.renderPositions = function(el, P, S){
  const per = WL.PERIODS.find(x => x.id === S.period);
  const brokers = [...new Set(P.positions.map(p => p.brokerShort))];
  const only = S.broker && brokers.includes(S.broker) ? S.broker : "all";
  const shown = P.positions.filter(p => (S.filter === "all" || p.type === S.filter) && (only === "all" || p.brokerShort === only));
  let body = "", covered = 0, countable = 0, change = 0, grand = 0;
  // Предпросмотр до оплаты: первые строки видны, остальные не попадают в страницу вовсе.
  const cap = S.cap == null ? Infinity : S.cap;
  let vis = 0, hiddenRows = 0;
  for(const t of TYPE_ORDER){
    const ps = shown.filter(p => p.type === t)
      .sort((a, b) => { const ka = sortKey(P, a), kb = sortKey(P, b); return ka < kb ? -1 : ka > kb ? 1 : 0; });
    if(!ps.length) continue;
    let sum = 0, rows = "", anyUsd = false;
    for(const p of ps){
      const r = row(P, p, per.id);
      if(vis < cap){ rows += r.html; vis++; } else hiddenRows++;
      if(r.usd != null){ sum += r.usd; anyUsd = true; }
      if(r.counts){ countable++; if(r.change != null){ covered++; change += r.change; } }
    }
    grand += sum;
    const label = t === "option" && ps.every(p => p.qty < 0) ? WL.t("Опционы проданные", "Short options") : TYPE_LABEL[t];
    if(rows) body += `<tr class="grp"><td class="l" colspan="8"><span class="cdot" style="--c:var(--cls-${WL.clsKey(t)})"></span>${label} <span class="muted">· ${ps.length} ${WL.pl(ps.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}</span></td>` +
      `<td>${anyUsd ? fmt.money(sum, "USD", 0) : t === "future" ? unk(IN_CASH()) : dash(WL.t("нет текущих цен", "no current prices"))}</td></tr>` + rows;
  }
  if(hiddenRows) body += `<tr class="lockrow"><td class="l" colspan="9">${WL.t(`Ещё ${hiddenRows} ${WL.pl(hiddenRows, ["позиция", "позиции", "позиций"], ["position", "positions"])}
    с ценой и датой покупки, комиссиями и изменением за восемь периодов — в полном отчёте`, `${hiddenRows} more ${WL.pl(hiddenRows, ["позиция", "позиции", "позиций"], ["position", "positions"])}
    in the full report, with purchase price and date, fees, and change over eight periods`)}
    <button class="btn small" type="button" data-buy="positions">${WL.t("Открыть", "Unlock")}</button></td></tr>`;
  const docs = P.docs.filter(d => only === "all" || d.brokerShort === only);
  const mixed = docs.some(d => staleDoc(P, d));
  el.innerHTML = `<table class="pos"><thead><tr>
      <th class="l">${WL.t("Бумага", "Security")}</th><th class="l">${WL.t("Брокер", "Broker")}</th><th>${WL.t("Кол-во", "Qty")}</th><th>${WL.t("Покупка", "Cost")}${sub(WL.t("цена · дата", "price · date"))}</th>
      <th>${WL.t("Комиссия", "Fees")}</th><th>${P.basis === "stmt" ? WL.t("Цена выписки", "Statement price") : WL.t("Текущая цена", "Price")}</th><th>${WL.t("Изменение", "Change")}${sub(P.basis === "stmt" ? WL.t("в снимок не входит", "not in the snapshot") : `${esc(per.label.toLowerCase())} · ${covered} ${WL.t("из", "of")} ${countable}`)}</th>
      <th>${WL.t("В валюте", "Local")}</th><th>${WL.t("В USD", "USD")}</th></tr></thead><tbody>${body ||
      `<tr><td class="l" colspan="9"><span class="muted">${WL.t("По выбранному фильтру позиций нет.", "No positions match the selected filter.")}</span></td></tr>`}
    <tr class="foot"><td class="l" colspan="6">${WL.t(`Всего${only === "all" ? " по портфелю" : " · " + esc(only)}`, only === "all" ? "Portfolio total" : "Total · " + esc(only))}${!mixed ? ""
        : only === "all" ? sub(docs.map(d => `${esc(d.brokerShort)} — ${staleDoc(P, d) ? WL.t("на ", "as of ") + fmt.date(d.asOf) : WL.t("сейчас", "now")}`).join(", "))
        : sub(WL.t(`на ${fmt.date(docs[0].asOf)}`, `as of ${fmt.date(docs[0].asOf)}`))}</td>
      <td>${covered ? `<span class="${cls(change)}">${fmt.signed(change)}</span>${sub(WL.t(`по ${covered} из ${countable} позиций`, `for ${covered} of ${countable} ${countable === 1 ? "position" : "positions"}`))}` : dash(NO_DATA())}</td>
      <td></td><td>${fmt.money(grand, "USD", 0)}</td></tr></tbody></table>
    <p class="basis" style="margin:0; padding:10px 12px">${WL.t("Прочерк — таких данных нет в выписке брокера или нет котировок за период", "A dash means the data is not in the broker statement or there are no quotes for the period")}<span class="no-print">${WL.t("; наведите курсор, чтобы увидеть причину", "; hover over it to see the reason")}</span>.
      ${WL.t("Что запросить у клиента, собрано ниже в разделе «Документы и чего не хватает».", "What to request from the client is listed below under “Documents and gaps”.")}</p>`;
  return {grand, covered, countable, change, only};
};

/* ── График: акции в текущем составе против бенчмарка ─────────────────── */
WL.BENCH = [["SPY", "S&P 500 · SPY"], ["QQQ", "Nasdaq 100 · QQQ"], ["IWM", "Russell 2000 · IWM"], ["VT", WL.t("Весь мир · VT", "All world · VT")],
  ["EFA", WL.t("Развитые рынки без США · EFA", "Developed markets ex-US · EFA")], ["AGG", WL.t("Облигации США · AGG", "US bonds · AGG")], ["IEF", WL.t("Казначейские 7–10 лет · IEF", "Treasuries 7–10y · IEF")],
  ["TLT", WL.t("Казначейские 20+ лет · TLT", "Treasuries 20+y · TLT")], ["GLD", WL.t("Золото · GLD", "Gold · GLD")], ["IBIT", WL.t("Биткоин · IBIT", "Bitcoin · IBIT")]];
const WINDOW = {"1d": 30, "1m": 30, "3m": 91, "1y": 365, "5y": 1826, "all": null, "stmt": "stmt", "cost": 365};
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const niceStep = raw => { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || 10 * p; };

WL.renderChart = function(el, P, S){
  // Только бумаги, сопоставленные с биржей (WL.idOf): историю чужой компании под тем же тикером не рисуем.
  const symOf = new Map(P.positions.filter(p => WL.eq(p)).map(p => [p, WL.quoteSymbol(P, p)]));
  const stocks = P.positions.filter(p => WL.eq(p) && symOf.get(p) && (P.history[symOf.get(p)] || []).length);
  const bh = P.history[S.bench] || [];
  // История грузится только по подтверждённым американским тикерам (см. loadHistory): без них ждать нечего.
  if(!P.positions.some(p => WL.eq(p) && symOf.get(p))){
    const waiting = P.positions.some(p => WL.eq(p) && p.ccy === "USD" && (p.symbol || p.isin));
    el.innerHTML = `<p class="muted">${waiting
      ? WL.t("Сравнение появится, когда бумаги портфеля будут сопоставлены с биржей: до этого не ясно, чью историю цен брать.",
             "The comparison appears once the holdings are matched to exchange listings: until then it is unclear whose price history to use.")
      : WL.t("Для сравнения нужны акции или фонды с американским тикером — в выписках таких нет.",
             "The comparison needs stocks or funds with a US ticker — the statements have none.")}</p>`;
    return;
  }
  if(!stocks.length || bh.length < 2){
    const limited = Object.values(P.historyStatus || {}).includes("limited");
    el.innerHTML = `<p class="muted">${limited ? WL.t("CBOE временно ограничил частоту запросов. История цен подгрузится автоматически, повтор через полторы минуты.",
                                                      "CBOE is temporarily rate-limiting requests. Price history will load automatically; retrying in 90 seconds.")
                                              : WL.t("История цен ещё загружается…", "Price history is still loading…")}</p>`;
    return;
  }
  const spec = WINDOW[S.period];
  const start = spec === "stmt" ? stocks[0].priceDate
    : spec == null ? stocks.map(p => P.history[symOf.get(p)][0][0]).sort()[0]
    : new Date(+new Date(P.today + "T00:00:00Z") - spec * 864e5).toISOString().slice(0, 10);
  const dates = bh.map(x => x[0]).filter(d => d >= start);
  if(dates.length < 2){ el.innerHTML = `<p class="muted">${WL.t("За этот период мало данных для графика.", "Not enough data to chart this period.")}</p>`; return; }
  const weight = new Map(stocks.map(p => [p, Math.max(WL.current(P, p).value, 0)]));
  const maps = new Map(stocks.map(p => [p, new Map(P.history[symOf.get(p)])]));
  const bmap = new Map(bh), b0 = bmap.get(dates[0]);
  const port = [100], bench = [100];
  for(let i = 1; i < dates.length; i++){
    let n = 0, d = 0;
    for(const p of stocks){
      const m = maps.get(p), a = m.get(dates[i - 1]), c = m.get(dates[i]);
      if(a && c){ const w = weight.get(p); n += w * (c / a - 1); d += w; }
    }
    port.push(port[i - 1] * (1 + (d ? n / d : 0)));
    bench.push(bmap.get(dates[i]) / b0 * 100);
  }
  const startCover = stocks.filter(p => maps.get(p).has(dates[0])).length;
  /* Форма «акцент»: портфель — золотая линия с лёгкой заливкой, бенчмарк — серая линия для сравнения.
     Значения на концах линий подписаны текстом, а не цветом серии; при наведении — перекрестие и точки на обеих линиях. */
  // На телефоне рисуем в масштабе экрана: иначе viewBox шириной 1000 ужимает подписи осей до трёх пикселей.
  const box = el.clientWidth - 36, narrow = box > 0 && box < 620;
  const W = narrow ? Math.max(320, Math.round(box)) : 1000, H = narrow ? 240 : 300, L = narrow ? 40 : 54, R = narrow ? 50 : 70, T = 16, B = 28;
  const vals = port.concat(bench); let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || 2) * .08; lo -= pad; hi += pad;
  const X = i => L + (W - L - R) * i / (dates.length - 1);
  const Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const path = a => a.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const step = niceStep((hi - lo) / 4);
  let grid = "";
  for(let t = Math.ceil((lo - 100) / step) * step; t <= hi - 100 + 1e-9; t += step){
    const y = Y(100 + t).toFixed(1), zero = Math.abs(t) < 1e-9;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${zero ? "var(--line-2)" : "var(--line)"}" stroke-width="1"/>` +
            `<text x="${L - 8}" y="${+y + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt.pct(t, step < 1 ? 1 : 0)}</text>`;
  }
  let xl = "";
  const nt = narrow ? 3 : 5;
  for(let j = 0; j < nt; j++){
    const i = Math.round((dates.length - 1) * j / (nt - 1)), [y, m, d] = dates[i].split("-");
    xl += `<text x="${X(i)}" y="${H - 8}" text-anchor="${j === 0 ? "start" : j === nt - 1 ? "end" : "middle"}" font-size="11" fill="var(--muted)">${spec && spec <= 91
      ? WL.t(`${d}.${m}`, `${+d} ${MON_EN[m - 1]}`) : WL.t(`${m}.${y}`, `${MON_EN[m - 1]} ${y}`)}</text>`;
  }
  const benchName = (WL.BENCH.find(b => b[0] === S.bench) || [S.bench, S.bench])[1];
  const last = dates.length - 1, pLast = port[last] - 100, bLast = bench[last] - 100;
  const area = `${path(port)}L${X(last).toFixed(1)},${H - B}L${X(0).toFixed(1)},${H - B}Z`;
  // Подписи на концах: если линии сошлись ближе 16 px, подписи не разводим — значения остаются в легенде.
  const yp = Y(port[last]), yb = Y(bench[last]), apart = Math.abs(yp - yb) >= 16;
  const endLabel = (v, y, ink) => apart ? `<text x="${X(last) + 10}" y="${(y + 4).toFixed(1)}" font-size="12" font-weight="600" fill="${ink}">${fmt.pct(v)}</text>` : "";
  const RING = "#0F1620";   // цвет карточки графика: кольцо отделяет точку от линии под ней
  const dot = (cls, color, x, y, hidden) => `<circle data-r="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${color}" stroke="${RING}" stroke-width="2"${hidden ? ' visibility="hidden"' : ""}/>`;
  el.innerHTML = `
    <div class="legend">
      <span><span class="sw" style="background:var(--series-1)"></span>${WL.t("Акции в текущем составе", "Current stock holdings")} <b class="num" data-r="p">${fmt.pct(pLast)}</b></span>
      <span><span class="sw" style="background:var(--series-2)"></span>${esc(benchName)} <b class="num" data-r="b">${fmt.pct(bLast)}</b></span>
      <span class="muted" data-r="d">${fmt.date(dates[0])} — ${fmt.date(dates[last])}</span>
    </div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="${WL.t(`График: акции ${fmt.pct(pLast)}, ${benchName} ${fmt.pct(bLast)} за период`, `Chart: stocks ${fmt.pct(pLast)}, ${benchName} ${fmt.pct(bLast)} over the period`)}">
      <defs><linearGradient id="wlArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--series-1);stop-opacity:.18"/><stop offset="1" style="stop-color:var(--series-1);stop-opacity:0"/></linearGradient></defs>
      ${grid}${xl}
      <path d="${area}" fill="url(#wlArea)" stroke="none"/>
      <path d="${path(bench)}" fill="none" stroke="var(--series-2)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${path(port)}" fill="none" stroke="var(--series-1)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
      ${endLabel(bLast, yb, "var(--ink-2)")}${endLabel(pLast, yp, "var(--ink)")}
      <line data-r="x" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--line-2)" stroke-width="1" visibility="hidden"/>
      ${dot("eb", "var(--series-2)", X(last), yb)}${dot("ep", "var(--series-1)", X(last), yp)}
      ${dot("hb", "var(--series-2)", 0, 0, true)}${dot("hp", "var(--series-1)", 0, 0, true)}
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" data-r="hit"/>
    </svg>
    <p class="basis">${WL.t(`Разница за период: ${fmt.pct(pLast - bLast)} п.п. Веса — текущая стоимость позиций; в начале периода есть цены по ${startCover} из ${stocks.length} бумаг.
      Это не фактическая история счёта: сделки и ввод-вывод денег не учитываются. Цены CBOE без учёта дивидендов.`,
      `Difference over the period: ${fmt.pct(pLast - bLast).replace("%", "")} pp. Weighted by current position value; start-of-period prices are available for ${startCover} of ${stocks.length} ${stocks.length === 1 ? "security" : "securities"}.
      This is not the account’s actual history: trades, deposits and withdrawals are not included. CBOE prices, excluding dividends.`)}</p>`;
  const svg = el.querySelector("svg"), hit = el.querySelector('[data-r="hit"]'), q = r => el.querySelector(`[data-r="${r}"]`);
  const move = (c, x, y) => { c.setAttribute("cx", x.toFixed(1)); c.setAttribute("cy", y.toFixed(1)); c.setAttribute("visibility", "visible"); };
  let cur = last;
  const show = i => {
    cur = i;
    const cross = q("x");
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
    move(q("hp"), X(i), Y(port[i])); move(q("hb"), X(i), Y(bench[i]));
    q("p").textContent = fmt.pct(port[i] - 100);
    q("b").textContent = fmt.pct(bench[i] - 100);
    q("d").textContent = `${fmt.date(dates[0])} — ${fmt.date(dates[i])}`;
  };
  const reset = () => {
    cur = last;
    ["x", "hp", "hb"].forEach(r => q(r).setAttribute("visibility", "hidden"));
    q("p").textContent = fmt.pct(pLast); q("b").textContent = fmt.pct(bLast);
    q("d").textContent = `${fmt.date(dates[0])} — ${fmt.date(dates[last])}`;
  };
  hit.addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W;
    show(Math.max(0, Math.min(last, Math.round((x - L) / (W - L - R) * last))));
  });
  hit.addEventListener("mouseleave", reset);
  // С клавиатуры — то же, что мышью: стрелки двигают перекрестие по датам.
  svg.addEventListener("keydown", e => {
    if(e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    show(Math.max(0, Math.min(last, cur + (e.key === "ArrowRight" ? 1 : -1))));
  });
  svg.addEventListener("blur", reset);
};
})();
