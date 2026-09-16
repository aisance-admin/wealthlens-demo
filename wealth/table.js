/* Флоу велса · таблица позиций в системе координат велса и график против бенчмарка.
   В каждой ячейке либо число с его основой (сейчас / на дату выписки), либо честное
   «нет в выписке». Суммы по брокерам с разными датами не выдаются за одно «сейчас». */
(function(){
const WL = window.WL = window.WL || {};
const {fmt} = WL;
const esc = WL.esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const unk = t => `<span class="unk">${esc(t)}</span>`;
// Прочерк вместо повторяющегося «нет в выписке»: причина — во всплывающей подсказке и в легенде под таблицей.
const dash = t => `<span class="unk" title="${esc(t)}">—</span>`;
const sub = t => `<span class="sub2">${t}</span>`;
const cls = v => v > 0 ? "up" : v < 0 ? "down" : "";
const TYPE_ORDER = ["stock", "fund", "bond", "note", "other", "option", "future", "cash"];
const staleDoc = (P, d) => d && WL.days(d.asOf, P.today) > 45;

function row(P, p, per){
  const k = WL.usd(P, p.ccy), cur = WL.current(P, p), doc = P.docs.find(d => d.fileName === p.source);
  const stale = staleDoc(P, doc);
  const code = p.type === "cash" ? p.ccy : (p.occ || p.symbol || p.code || p.isin);
  let note = "";
  if(p.type === "option") note = `${p.qty < 0 ? "продан" : "куплен"} · истекает ${fmt.date(p.expiry)}`;
  if(p.type === "future") note = `последний торговый день ${fmt.date(p.expiry)}`;
  if(p.expiry && p.expiry < P.today) note += " · истёк после даты выписки";
  const td = [];
  td.push(`<td class="l nm">${esc(p.name)}${sub(`<span class="code">${esc(code)}</span>${note ? " · " + esc(note) : ""}`)}</td>`);
  // Брокер — колонка, а не отдельная таблица. Дата выписки стоит здесь же: в общем списке
  // соседние строки могут быть на разные даты, и это должно быть видно в самой строке.
  td.push(`<td class="l brk" data-l="Брокер">${esc(p.brokerShort)}${stale ? sub(`на ${fmt.date(doc.asOf)}`) : ""}</td>`);
  const contracts = p.type === "option" || p.type === "future";
  td.push(`<td class="qty" data-l="Кол-во">${p.type === "cash" || p.qty == null ? "" : fmt.qty(p.qty) + (contracts ? sub("контр.") : "")}</td>`);

  // Цена и дата покупки — один пункт у велса, одна колонка здесь.
  let buyMain = "", buyNote = "";
  if(!contracts && p.type !== "cash"){
    if(p.cost != null && p.qty){ buyMain = fmt.px(p.cost / p.qty); buyNote = "средняя"; }
    else buyMain = unk(p.costNote || "нет в выписке");
  } else if(p.type === "option"){
    const prem = p.cost != null ? p.cost : p.premium;
    if(prem != null && p.multiplier && p.qty){ buyMain = fmt.px(Math.abs(prem / (p.qty * p.multiplier))); buyNote = "премия"; }
    else if(prem != null){ buyMain = fmt.money(prem, p.ccy, 0); buyNote = "премия всего"; }
    else buyMain = dash("нет в выписке");
  } else if(p.type === "future") buyMain = unk("по сделкам");
  if(p.type !== "cash") buyNote = [buyNote, p.purchaseDate
    ? `${fmt.date(p.purchaseDate)}${p.purchaseNote ? " (" + esc(p.purchaseNote) + ")" : ""}` : ""].filter(Boolean).join(" · ");
  td.push(`<td class="buy" data-l="Покупка">${buyMain}${buyNote ? sub(buyNote) : ""}</td>`);
  td.push(`<td class="fee" data-l="Комиссия">${p.type === "cash" ? "" : p.commission != null ? fmt.money(p.commission, p.ccy) : dash("нет в выписке")}</td>`);

  let px = "";
  if(p.type !== "cash"){
    if(cur.live) px = fmt.px(cur.price) + sub(`сейчас${p.live.delta != null ? " · дельта " + fmt.px(Math.abs(p.live.delta)) : ""}`);
    else if(p.price != null) px = fmt.px(p.price) + sub(`на ${fmt.date(p.priceDate)}`);
    else px = dash("нет в выписке");
  }
  td.push(`<td class="px" data-l="Цена">${px}</td>`);

  const ch = p.type === "cash" ? null : WL.change(P, p, per);
  td.push(`<td class="chg" data-l="Изменение">${p.type === "cash" ? "" : ch ? `<span class="${cls(ch.abs)}">${fmt.signed(ch.abs, p.ccy)}</span>` +
    (ch.pct != null ? sub(`<span class="${cls(ch.abs)}">${fmt.pct(ch.pct)}</span>`) : "") : dash("нет данных за этот период")}</td>`);

  let val, usd;
  if(cur.value != null){
    val = fmt.money(cur.value, p.ccy, 0);
    usd = k != null ? fmt.money(cur.value * k, "USD", 0) : unk("нет курса");
  } else {
    val = p.type === "future" ? unk("в деньгах счёта") : dash(p.valueNote || "нет в выписке");
    usd = dash("стоимости нет в выписке");
  }
  if(p.notional != null) { val += sub(`номинал ${fmt.short(p.notional, p.ccy)}`); }
  if(p.type === "option" && p.qty < 0 && p.multiplier){
    // Проданный колл, полностью покрытый акциями на том же счёте, — не обязательство купить что-то на рынке.
    const n = Math.abs(p.qty) * p.multiplier;
    const held = p.right === "C" && P.positions.find(s => WL.eq(s) && s.symbol === p.underlying && s.source === p.source);
    val += sub(held && held.qty >= n ? `покрыт ${fmt.int(n)} акций`
      : `${p.right === "P" ? "обязательство купить" : "обязательство продать"} на ${fmt.short(n * p.strike, p.ccy)}`);
  }
  td.push(`<td class="loc" data-l="В валюте">${val}</td>`, `<td class="usd" data-l="В USD">${usd}</td>`);
  return {html: `<tr class="row" data-id="${esc(p.id)}" tabindex="0">${td.join("")}</tr>`, usd: cur.value != null && k != null ? cur.value * k : null,
          change: ch && k != null ? ch.abs * k : null, counts: p.type !== "cash"};
}

/* Единый список по всему портфелю: по умолчанию всё вместе, брокер — колонка. Внутри типа
   акции, фьючерсы и деньги идут по размеру позиции, опционы — по сроку, истёкшие в конце.
   Отдельная площадка смотрится переключателем «Брокер» и карточками вверху страницы. */
const TYPE_LABEL = {stock: "Акции", fund: "Фонды", bond: "Облигации", note: "Структурные ноты",
  other: "Прочее", option: "Опционы", future: "Фьючерсы", cash: "Деньги"};
function sortKey(P, p){
  if(p.type === "option") return (p.expiry && p.expiry < P.today ? "Z" : "A") + (p.expiry || "");
  const k = WL.usd(P, p.ccy), v = WL.current(P, p).value;
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
    const label = t === "option" && ps.every(p => p.qty < 0) ? "Опционы проданные" : TYPE_LABEL[t];
    if(rows) body += `<tr class="grp"><td class="l" colspan="8">${label} <span class="muted">· ${ps.length} ${WL.plural(ps.length, "позиция", "позиции", "позиций")}</span></td>` +
      `<td>${anyUsd ? fmt.money(sum, "USD", 0) : t === "future" ? unk("в деньгах счёта") : dash("нет текущих цен")}</td></tr>` + rows;
  }
  if(hiddenRows) body += `<tr class="lockrow"><td class="l" colspan="9">Ещё ${hiddenRows} ${WL.plural(hiddenRows, "позиция", "позиции", "позиций")}
    с ценой и датой покупки, комиссиями и изменением за восемь периодов — в полном отчёте
    <button class="btn small" type="button" data-buy="positions">Открыть</button></td></tr>`;
  const docs = P.docs.filter(d => only === "all" || d.brokerShort === only);
  const mixed = docs.some(d => staleDoc(P, d));
  el.innerHTML = `<table class="pos"><thead><tr>
      <th class="l">Бумага</th><th class="l">Брокер</th><th>Кол-во</th><th>Покупка${sub("цена · дата")}</th>
      <th>Комиссия</th><th>Текущая цена</th><th>Изменение${sub(`${esc(per.label.toLowerCase())} · ${covered} из ${countable}`)}</th>
      <th>В валюте</th><th>В USD</th></tr></thead><tbody>${body ||
      `<tr><td class="l" colspan="9"><span class="muted">По выбранному фильтру позиций нет.</span></td></tr>`}
    <tr class="foot"><td class="l" colspan="6">Всего${only === "all" ? " по портфелю" : " · " + esc(only)}${!mixed ? ""
        : only === "all" ? sub(docs.map(d => `${esc(d.brokerShort)} — ${staleDoc(P, d) ? "на " + fmt.date(d.asOf) : "сейчас"}`).join(", "))
        : sub(`на ${fmt.date(docs[0].asOf)}`)}</td>
      <td>${covered ? `<span class="${cls(change)}">${fmt.signed(change)}</span>${sub(`по ${covered} из ${countable} позиций`)}` : dash("нет данных за этот период")}</td>
      <td></td><td>${fmt.money(grand, "USD", 0)}</td></tr></tbody></table>
    <p class="basis" style="margin:0; padding:10px 12px">Прочерк — таких данных нет в выписке брокера или нет котировок за период<span class="no-print">; наведите курсор, чтобы увидеть причину</span>.
      Что запросить у клиента, собрано ниже в разделе «Документы и чего не хватает».</p>`;
  return {grand, covered, countable, change, only};
};

/* ── График: акции в текущем составе против бенчмарка ─────────────────── */
WL.BENCH = [["SPY", "S&P 500 · SPY"], ["QQQ", "Nasdaq 100 · QQQ"], ["IWM", "Russell 2000 · IWM"], ["VT", "Весь мир · VT"],
  ["EFA", "Развитые рынки без США · EFA"], ["AGG", "Облигации США · AGG"], ["IEF", "Казначейские 7–10 лет · IEF"],
  ["TLT", "Казначейские 20+ лет · TLT"], ["GLD", "Золото · GLD"], ["IBIT", "Биткоин · IBIT"]];
const WINDOW = {"1d": 30, "1m": 30, "3m": 91, "1y": 365, "5y": 1826, "all": null, "stmt": "stmt", "cost": 365};
const niceStep = raw => { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || 10 * p; };

WL.renderChart = function(el, P, S){
  const stocks = P.positions.filter(p => WL.eq(p) && (P.history[p.symbol] || []).length);
  const bh = P.history[S.bench] || [];
  if(!stocks.length || bh.length < 2){
    const limited = Object.values(P.historyStatus || {}).includes("limited");
    el.innerHTML = `<p class="muted">${limited ? "CBOE временно ограничил частоту запросов. История цен подгрузится автоматически, повтор через полторы минуты."
                                              : "История цен ещё загружается…"}</p>`;
    return;
  }
  const spec = WINDOW[S.period];
  const start = spec === "stmt" ? stocks[0].priceDate
    : spec == null ? stocks.map(p => P.history[p.symbol][0][0]).sort()[0]
    : new Date(+new Date(P.today + "T00:00:00Z") - spec * 864e5).toISOString().slice(0, 10);
  const dates = bh.map(x => x[0]).filter(d => d >= start);
  if(dates.length < 2){ el.innerHTML = `<p class="muted">За этот период мало данных для графика.</p>`; return; }
  const weight = new Map(stocks.map(p => [p.symbol, Math.max(WL.current(P, p).value, 0)]));
  const maps = new Map(stocks.map(p => [p.symbol, new Map(P.history[p.symbol])]));
  const bmap = new Map(bh), b0 = bmap.get(dates[0]);
  const port = [100], bench = [100];
  for(let i = 1; i < dates.length; i++){
    let n = 0, d = 0;
    for(const p of stocks){
      const m = maps.get(p.symbol), a = m.get(dates[i - 1]), c = m.get(dates[i]);
      if(a && c){ const w = weight.get(p.symbol); n += w * (c / a - 1); d += w; }
    }
    port.push(port[i - 1] * (1 + (d ? n / d : 0)));
    bench.push(bmap.get(dates[i]) / b0 * 100);
  }
  const startCover = stocks.filter(p => maps.get(p.symbol).has(dates[0])).length;
  const W = 1000, H = 300, L = 54, R = 20, T = 14, B = 28;
  const vals = port.concat(bench); let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || 2) * .08; lo -= pad; hi += pad;
  const X = i => L + (W - L - R) * i / (dates.length - 1);
  const Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const path = a => a.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const step = niceStep((hi - lo) / 4);
  let grid = "";
  for(let t = Math.ceil((lo - 100) / step) * step; t <= hi - 100 + 1e-9; t += step){
    const y = Y(100 + t).toFixed(1);
    grid += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)" ${Math.abs(t) < 1e-9 ? 'stroke-width="1.5" stroke="var(--line-2)"' : ""}/>` +
            `<text x="${L - 8}" y="${+y + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt.pct(t, step < 1 ? 1 : 0)}</text>`;
  }
  let xl = "";
  for(let j = 0; j < 5; j++){
    const i = Math.round((dates.length - 1) * j / 4), [y, m, d] = dates[i].split("-");
    xl += `<text x="${X(i)}" y="${H - 8}" text-anchor="${j === 0 ? "start" : j === 4 ? "end" : "middle"}" font-size="11" fill="var(--muted)">${spec && spec <= 91 ? `${d}.${m}` : `${m}.${y}`}</text>`;
  }
  const benchName = (WL.BENCH.find(b => b[0] === S.bench) || [S.bench, S.bench])[1];
  const pLast = port[port.length - 1] - 100, bLast = bench[bench.length - 1] - 100;
  el.innerHTML = `
    <div class="legend">
      <span><span class="sw" style="background:var(--series-1)"></span>Акции в текущем составе <b class="num" data-r="p">${fmt.pct(pLast)}</b></span>
      <span><span class="sw" style="background:var(--series-2)"></span>${esc(benchName)} <b class="num" data-r="b">${fmt.pct(bLast)}</b></span>
      <span class="muted" data-r="d">${fmt.date(dates[0])} — ${fmt.date(dates[dates.length - 1])}</span>
    </div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="График акций против бенчмарка">
      ${grid}${xl}
      <path d="${path(bench)}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"/>
      <path d="${path(port)}" fill="none" stroke="var(--series-1)" stroke-width="2.25" stroke-linejoin="round"/>
      <line data-r="x" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" data-r="hit"/>
    </svg>
    <p class="basis">Разница за период: ${fmt.pct(pLast - bLast)} п.п. Веса — текущая стоимость позиций; в начале периода есть цены по ${startCover} из ${stocks.length} бумаг.
      Это не фактическая история счёта: сделки и ввод-вывод денег не учитываются. Цены CBOE без учёта дивидендов.</p>`;
  const svg = el.querySelector("svg"), hit = el.querySelector('[data-r="hit"]'), cross = el.querySelector('[data-r="x"]');
  const show = i => {
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
    el.querySelector('[data-r="p"]').textContent = fmt.pct(port[i] - 100);
    el.querySelector('[data-r="b"]').textContent = fmt.pct(bench[i] - 100);
    el.querySelector('[data-r="d"]').textContent = `${fmt.date(dates[0])} — ${fmt.date(dates[i])}`;
  };
  hit.addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W;
    show(Math.max(0, Math.min(dates.length - 1, Math.round((x - L) / (W - L - R) * (dates.length - 1)))));
  });
  hit.addEventListener("mouseleave", () => show(dates.length - 1));
};
})();
