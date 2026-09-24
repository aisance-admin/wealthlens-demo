/* WealthLens · рыночные данные. Бумаги из выписок сопоставляются с биржевыми (по ISIN, иначе по тикеру; облигации без биржевой
   котировки остаются на цене выписки), и при каждом открытии отчёта подтягиваются свежие котировки и изменения за периоды
   (TradingView, опционы США — Cboe), главные котировки рынка, бенчмарки и новости. На сервер уходят только обозначения бумаг.
   Цена, которая даёт стоимость, несовместимую с выпиской (не та бумага или не та единица цены), в оценку не берётся. */
(function(){
const WL = window.WL, t = WL.t, fmt = WL.fmt;
const PERIODS = WL.PERIODS = [["1d", t("День", "Day")], ["1w", t("Неделя", "Week")], ["1m", t("Месяц", "Month")], ["3m", t("Квартал", "Quarter")],
  ["ytd", t("С начала года", "YTD")], ["1y", t("Год", "Year")], ["5y", t("5 лет", "5 years")], ["all", t("Вся история", "All time")]];
WL.periodLabel = id => (PERIODS.find(x => x[0] === id) || PERIODS[0])[1];
const LIVE = ["stock", "etf", "fund", "metal", "crypto", "alt", "other"];
const RESOLVE_TTL = 7 * 864e5;

const keyOf = p => {
  if(p.cls === "note") return "note|" + String(p.under || p.name || "").slice(0, 80);
  if(!LIVE.includes(p.cls)) return null;
  if(!p.isin && !p.ticker && !p.name) return null;
  return [p.isin || "", (p.ticker || "").toUpperCase(), p.isin || p.ticker ? "" : String(p.name).slice(0, 60), p.ccy || ""].join("|");
};
const occOf = p => {
  if(p.cls !== "option" || !p.date || !p.right || !(p.strike > 0) || (p.ccy && p.ccy !== "USD")) return null;
  const root = String(p.under || p.ticker || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  if(!root) return null;
  const [y, m, d] = p.date.split("-");
  return root + y.slice(2) + m + d + p.right + String(Math.round(p.strike * 1000)).padStart(8, "0");
};
WL.market = {keyOf, occOf};

async function getJSON(path){ return WL.api(path, undefined, {timeout: 40000}); }

/* Свежие данные: сопоставление новых бумаг, котировки, опционы, главные котировки и бенчмарки, новости. */
WL.market.refresh = async (S, M) => {
  if(!M || !M.positions.length) return false;
  if(S.symbolsV !== 2){ S.symbols = {}; S.symbolsV = 2; }      // сопоставления прежних версий (до выбора домашней биржи) пересчитываются
  S.symbols = S.symbols || {};
  const now = Date.now();
  const want = new Map();
  for(const p of M.positions){
    const k = keyOf(p); if(!k) continue;
    const have = S.symbols[k];
    if(have && (have.symbol || now - (have.at || 0) < RESOLVE_TTL)) continue;
    if(!want.has(k)) want.set(k, {key: k, isin: p.isin || "", ticker: p.cls === "note" ? "" : (p.ticker || ""), name: p.cls === "note" ? (p.under || p.name) : p.name, ccy: p.ccy, cls: p.cls});
  }
  if(want.size){
    const r = await WL.api("/market/resolve", {items: [...want.values()]}, {timeout: 60000});
    if(r && r.results) for(const [k, v] of Object.entries(r.results)) S.symbols[k] = v && v.symbol ? Object.assign({}, v, {at: now}) : {none: true, at: now};
  }
  const syms = [...new Set(M.positions.map(p => { const k = keyOf(p); return k && S.symbols[k] && S.symbols[k].symbol; }).filter(Boolean))];
  const occs = [...new Set(M.positions.map(occOf).filter(Boolean))];
  const [q, o, ov, news] = await Promise.all([
    syms.length ? getJSON("/market/quotes?s=" + encodeURIComponent(syms.join(","))) : Promise.resolve({quotes: {}}),
    occs.length ? getJSON("/market/options?contracts=" + encodeURIComponent(occs.join(","))) : Promise.resolve({options: {}}),
    getJSON("/market/overview"),
    newsFor(M),
  ]);
  if(!q || q.error) return false;
  S.market = {at: new Date().toISOString(), quotes: q.quotes || {}, options: (o && o.options) || {}, overview: (ov && ov.overview) || [], benchmarks: (ov && ov.benchmarks) || [],
    news: news, source: "TradingView"};
  return true;
};
async function newsFor(M){
  const top = M.positions.filter(p => ["stock", "etf"].includes(p.cls) && p.ticker && /^[A-Z][A-Z0-9.]{0,9}$/.test(p.ticker)).sort((a, b) => Math.abs(b.vb || 0) - Math.abs(a.vb || 0)).slice(0, 5);
  const lang = WL.EN ? "en" : "ru";
  const [mkt, own] = await Promise.all([getJSON("/market/news?lang=" + lang),
    top.length ? getJSON("/market/news?lang=" + lang + "&symbols=" + encodeURIComponent(top.map(p => p.ticker).join(",")) + "&q=" + encodeURIComponent(top.map(p => String(p.name || "").split(/[\s,]/)[0]).join(","))) : Promise.resolve(null)]);
  const market = ((mkt && mkt.items) || []).filter(n => n.lang === lang).slice(0, 8);
  const byTicker = [], seen = new Set();
  const fresh = n => { const k = String(n.title || "").toLowerCase().replace(/\W+/g, " ").trim().slice(0, 80); if(!k || seen.has(k)) return false; seen.add(k); return true; };
  if(own && own.symbols) for(const p of top){ const items = own.symbols[p.ticker]; if(Array.isArray(items)){ const list = items.filter(fresh).slice(0, 3); if(list.length) byTicker.push({ticker: p.ticker, name: p.name, items: list}); } }
  return {market: market.filter(fresh), byTicker};
}

/* Рыночные данные — в модель отчёта: цена сейчас, стоимость сейчас, изменения за периоды, базовый актив ноты, опционы. */
WL.market.apply = (M, S) => {
  const m = S.market; M.mkt = null;
  if(!m || !m.quotes) return;
  const base = M.base, tab = (S.fx || {})[`${base}|latest`];
  const toBase = ccy => !ccy || ccy === base ? 1 : tab && tab.rates[ccy] ? 1 / tab.rates[ccy] : null;
  // Покрытие — доля всей стоимости портфеля (с деньгами и депозитами), которая переоценена по рыночной цене.
  let covered = 0, suspect = 0;
  const total = M.positions.reduce((s, p) => s + Math.abs((p.vb || 0) + (p.ab || 0)), 0);
  for(const p of M.positions){
    delete p.mk; delete p.nowB; delete p.underQ;
    const k = keyOf(p), sym = k && S.symbols && S.symbols[k] && S.symbols[k].symbol, q = sym && m.quotes[sym];
    if(p.cls === "note"){
      if(q && q.price != null) p.underQ = {symbol: sym, name: q.name || p.under, price: q.price, ccy: q.currency, change: q.change, perf: q.perf || {}, delayed: q.delayed};
      continue;
    }
    if(p.cls === "option"){
      const o = m.options && m.options[occOf(p)];
      if(o && (o.mid != null || o.last != null)){
        const px = o.mid != null ? o.mid : o.last, k2 = p.qty && p.price && p.value ? Math.abs(p.value / (p.qty * p.price)) : 100;
        const mult = [1, 10, 100, 1000].find(x => Math.abs(k2 - x) / x < 0.05) || 100, r = toBase("USD");
        p.mk = {price: px, ccy: "USD", underlying: o.underlying_price, delta: o.delta, iv: o.iv, src: "Cboe", delayed: true};
        if(r != null && p.qty) { p.nowB = p.qty * px * mult * r; covered += Math.abs(p.vb || 0); }
      }
      continue;
    }
    if(!q || q.price == null) continue;
    p.mk = {symbol: sym, price: q.price, ccy: q.currency || p.ccy, change: q.change, perf: q.perf || {}, delayed: q.delayed, src: "TradingView", name: q.name};
    const r = toBase(p.mk.ccy);
    if(p.qty && r != null){
      const nowB = p.qty * q.price * r, ratio = p.vb ? nowB / p.vb : 1;
      // Не та бумага (другой класс акций, другая биржа) или не та единица цены: стоимость «сейчас» не бьётся с выпиской в разы.
      if(p.vb && (ratio < 0.4 || ratio > 2.5)){ p.mk.suspect = true; suspect++; }
      else { p.nowB = nowB; covered += Math.abs(p.vb || 0); }
    }
  }
  const nowTotal = M.positions.reduce((s, p) => s + (p.nowB != null ? p.nowB : (p.vb || 0)) + (p.ab || 0), 0);
  // Доли, категории, банки и валюты по текущей оценке: в режиме «Сейчас» всё считается от одной базы.
  for(const p of M.positions){ p.nowV = (p.nowB != null ? p.nowB : (p.vb || 0)) + (p.ab || 0); p.wNow = nowTotal ? p.nowV / nowTotal : 0; }
  const group = (keyOf2, label) => { const m2 = new Map(); for(const p of M.positions){ const k2 = keyOf2(p); const g = m2.get(k2) || {value: 0, count: 0}; g.value += p.nowV; g.count++; m2.set(k2, g); }
    return m2; };
  const cats = group(p => p.cat), insts = group(p => p.inst), ccys = group(p => p.ccy || "?");
  const liveByCat = M.byCat.map(c => { const g = cats.get(c.key) || {value: 0}; return Object.assign({}, c, {value: g.value, share: nowTotal ? g.value / nowTotal : 0}); });
  const liveByInst = M.byInst.map(i => { const g = insts.get(i.name) || {value: 0}; return Object.assign({}, i, {value: g.value, share: nowTotal ? g.value / nowTotal : 0}); })
    .sort((a, b) => b.value - a.value);
  const liveByCcy = [...ccys.entries()].map(([ccy, g]) => ({ccy, value: g.value, share: nowTotal ? g.value / nowTotal : 0})).sort((a, b) => b.value - a.value);
  // Изменение за период: по бумагам с котировкой (pct — только котируемая часть, для сравнения с индексом) и для всего
  // портфеля (whole), где деньги и бумаги без котировки считаются неизменными.
  const perf = {};
  for(const [id] of PERIODS){
    let chg = 0, startVal = 0, n = 0;
    for(const p of M.positions){
      const v = p.nowB != null ? p.nowB : null, pc = !p.mk || p.mk.suspect ? null : id === "1d" ? p.mk.change : (p.mk.perf || {})[id];
      if(v == null || pc == null || p.cls === "option") continue;
      const abs = v * pc / (100 + pc); chg += abs; startVal += v - abs; n++;
    }
    perf[id] = n ? {abs: chg, pct: startVal ? chg / startVal : null, whole: nowTotal - chg ? chg / (nowTotal - chg) : null, n} : null;
  }
  M.mkt = {at: m.at, nowTotal, covered, coverage: total ? covered / total : 0, suspect, perf, overview: m.overview || [], benchmarks: m.benchmarks || [], news: m.news || {market: [], byTicker: []},
    delta: nowTotal - M.total, byCat: liveByCat, byInst: liveByInst, byCcy: liveByCcy};
  M.alerts = M.alerts.concat(marketAlerts(M));
  const rank = {high: 0, watch: 1, info: 2};
  M.alerts.sort((a, b) => rank[a.level] - rank[b.level]);
};

function marketAlerts(M){
  const out = [], money = v => fmt.money(v, M.base), at = M.mkt && M.mkt.at ? new Date(M.mkt.at) : null;
  const when = at ? at.toLocaleTimeString(WL.EN ? "en-GB" : "ru-RU", {hour: "2-digit", minute: "2-digit"}) : "";
  const basis = t(`Основа: котировки на ${when}, задержка до 15 минут`, `Source: quotes as of ${when}, delayed up to 15 minutes`);
  // Проданные путы: где базовая акция сейчас относительно страйка
  const puts = M.positions.filter(p => p.cls === "option" && p.right === "P" && p.qty < 0 && p.strike > 0 && p.mk && p.mk.underlying > 0);
  const itm = puts.filter(p => p.mk.underlying <= p.strike), near = puts.filter(p => p.mk.underlying > p.strike && p.mk.underlying < p.strike * 1.1);
  if(itm.length) out.push({level: "high", id: "puts-itm", auto: true, basis, refs: itm.map(p => p.id), title: t("Проданный пут в деньгах", "A sold put is in the money"),
    text: itm.map(p => t(`${p.name}: акция сейчас ${fmt.money(p.mk.underlying, "USD", 2)} при страйке ${fmt.money(p.strike, "USD", 2)} — исполнение вероятно`, `${p.name}: the stock is at ${fmt.money(p.mk.underlying, "USD", 2)} against a ${fmt.money(p.strike, "USD", 2)} strike — exercise is likely`)).join("; ") + "."});
  if(near.length) out.push({level: "watch", id: "puts-near", auto: true, basis, refs: near.map(p => p.id), title: t("Проданный пут близко к страйку", "A sold put is close to the strike"),
    text: near.map(p => t(`${p.name}: акция ${fmt.money(p.mk.underlying, "USD", 2)}, до страйка ${fmt.pct((p.mk.underlying - p.strike) / p.mk.underlying)}`, `${p.name}: stock at ${fmt.money(p.mk.underlying, "USD", 2)}, ${fmt.pct((p.mk.underlying - p.strike) / p.mk.underlying)} above the strike`)).join("; ") + "."});
  // Резкие движения за месяц
  const moves = M.positions.filter(p => p.mk && !p.mk.suspect && p.nowB != null && Math.abs((p.mk.perf || {})["1m"] || 0) >= 15 && Math.abs(p.nowB) >= Math.abs(M.total) * 0.005)
    .sort((a, b) => Math.abs(b.mk.perf["1m"]) - Math.abs(a.mk.perf["1m"]));
  if(moves.length) out.push({level: "watch", id: "moves", auto: true, basis, refs: moves.map(p => p.id), title: t("Резкое движение цены за месяц", "Sharp price move over the month"),
    text: moves.slice(0, 5).map(p => `${p.name}: ${p.mk.perf["1m"] > 0 ? "+" : ""}${fmt.num(p.mk.perf["1m"], 1)}%`).join("; ") + "."});
  // Базовые активы нот за месяц
  const notes = M.positions.filter(p => p.underQ && Math.abs((p.underQ.perf || {})["1m"] || 0) >= 7);
  if(notes.length) out.push({level: "watch", id: "notes-under", auto: true, basis, refs: notes.map(p => p.id), title: t("Базовый актив структурного продукта заметно сдвинулся", "A structured product's underlying moved notably"),
    text: notes.map(p => t(`${p.name}: ${p.underQ.name || p.under} ${p.underQ.perf["1m"] > 0 ? "+" : ""}${fmt.num(p.underQ.perf["1m"], 1)}% за месяц`, `${p.name}: ${p.underQ.name || p.under} ${p.underQ.perf["1m"] > 0 ? "+" : ""}${fmt.num(p.underQ.perf["1m"], 1)}% over the month`)).join("; ") + t(". Проверьте условия и барьеры в документации продукта.", ". Check the product's terms and barriers.")});
  // Изменение с даты выписки
  if(M.mkt && Math.abs(M.mkt.delta) > Math.abs(M.total) * 0.01 && M.mkt.coverage > 0.2) out.push({level: "info", id: "since", auto: true, basis,
    title: t(`С даты выписки портфель ${M.mkt.delta > 0 ? "вырос" : "снизился"} на ${money(Math.abs(M.mkt.delta))}`, `Since the statement date the portfolio ${M.mkt.delta > 0 ? "gained" : "lost"} ${money(Math.abs(M.mkt.delta))}`),
    text: t(`По текущим ценам — ${money(M.mkt.nowTotal)} против ${money(M.total)} по выпискам. Пересчитаны бумаги с биржевой котировкой (${fmt.pct(M.mkt.coverage, 0)} портфеля), остальное — по выпискам.`,
      `At current prices it is ${money(M.mkt.nowTotal)} versus ${money(M.total)} per the statements. Holdings with a listed price are repriced (${fmt.pct(M.mkt.coverage, 0)} of the portfolio), the rest stays at statement values.`)});
  return out;
}

/* Раздел «Рынок»: портфель против бенчмарка по периодам, главные котировки, новости. */
WL.marketSection = () => {
  const M = WL.model, S = WL.state, esc = WL.esc;
  if(!M || !M.mkt) return "";
  const mk = M.mkt, bid = WL.ui.bench || "SP:SPX", bench = mk.benchmarks.find(b => b.symbol === bid) || mk.benchmarks[0];
  const at = new Date(mk.at), when = at.toLocaleString(WL.EN ? "en-GB" : "ru-RU", {day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"});
  const periods = [["1m", t("Месяц", "Month")], ["3m", t("Квартал", "Quarter")], ["ytd", t("С начала года", "YTD")], ["1y", t("Год", "Year")], ["5y", t("5 лет", "5 years")]];
  const rows = periods.map(([id, label]) => ({label, p: mk.perf[id] ? mk.perf[id].pct * 100 : null, b: bench && bench.perf ? bench.perf[id] : null}));
  const max = Math.max(1, ...rows.flatMap(r => [Math.abs(r.p || 0), Math.abs(r.b || 0)]));
  const bar = (v, cls) => v == null ? `<span class="nb">—</span>` : `<span class="bw"><i class="${cls}${v < 0 ? " neg" : ""}" style="width:${Math.max(1, Math.abs(v) / max * 100)}%"></i></span><b class="${v < 0 ? "dn" : "up"}">${v > 0 ? "+" : ""}${fmt.num(v, 1)}%</b>`;
  const ov = mk.overview.filter(x => x.price != null);
  const news = mk.news || {market: [], byTicker: []};
  const newsItem = n => `<li><a href="${esc(/^https?:\/\//.test(n.link || "") ? n.link : "#")}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><span class="muted">${esc(n.source || "")}${n.time ? " · " + esc(fmt.date(n.time.slice(0, 10))) : ""}</span></li>`;
  return `<section class="sec" id="market"><div class="sh"><h2>${t("Рынок", "Market")}</h2><span class="muted">${t("данные на", "as of")} ${esc(when)}</span>
      <button class="btn small no-print" type="button" data-refresh-market>${t("Обновить", "Refresh")}</button></div>
    <div class="two">
      <div class="card pad"><div class="eyebrow">${t("Портфель и бенчмарк", "Portfolio vs benchmark")}</div>
        <div class="chips bench no-print" role="group">${mk.benchmarks.filter(b => b.price != null).map(b => `<button type="button" data-bench="${esc(b.symbol)}" aria-pressed="${bench && b.symbol === bench.symbol}">${esc(b.label)}</button>`).join("")}</div>
        <div class="print-only small muted">${t("Бенчмарк:", "Benchmark:")} ${esc(bench ? bench.label : "")}</div>
        <div class="cmp"><div class="cmp-h"><span></span><span><i class="k c-port"></i>${t("Котируемая часть", "Listed part")}</span><span><i class="k c-bench"></i>${esc(bench ? bench.label : "")}</span></div>
          ${rows.map(r => `<div class="cmp-r"><span class="cl">${esc(r.label)}</span><span class="cv">${bar(r.p, "port")}</span><span class="cv">${bar(r.b, "bench")}</span></div>`).join("")}</div>
        <p class="fine">${t(`«Портфель» здесь — только бумаги с биржевой котировкой (${fmt.pct(mk.coverage, 0)} стоимости) в нынешнем составе, без учёта взносов, выводов и дивидендов. Изменение всего портфеля — в строке «Итого» таблицы позиций.`,
          `“Portfolio” here means only the holdings with a listed price (${fmt.pct(mk.coverage, 0)} of the value) in the current mix, excluding deposits, withdrawals and dividends. The change of the whole portfolio is in the Total row of the positions table.`)}</p></div>
      <div class="card pad"><div class="eyebrow">${t("Главные котировки", "Key market quotes")}</div>
        <ul class="ov">${ov.map(x => `<li><span>${esc(x.label)}</span><b>${esc(fmt.num(x.price, x.price >= 1000 ? 0 : x.price >= 10 ? 2 : 4))}</b><em class="${(x.change || 0) < 0 ? "dn" : "up"}">${x.change > 0 ? "+" : ""}${esc(fmt.num(x.change || 0, 2))}%</em></li>`).join("")}</ul>
        <p class="fine">${t("TradingView, акции и индексы — с задержкой до 15 минут. В информационных целях.", "TradingView; stocks and indices delayed up to 15 minutes. For information only.")}</p></div>
    </div>
    ${news.market.length || news.byTicker.length ? `<div class="card pad news-card"><div class="eyebrow">${t("Новости", "News")}</div><div class="news-grid">
      ${news.byTicker.length ? `<div><h3>${t("По бумагам портфеля", "On your holdings")}</h3>${news.byTicker.map(b => `<div class="nt"><b>${esc(b.ticker)}</b><ul>${b.items.map(newsItem).join("")}</ul></div>`).join("")}</div>` : ""}
      ${news.market.length ? `<div><h3>${t("Рынок", "Markets")}</h3><ul>${news.market.map(newsItem).join("")}</ul></div>` : ""}
    </div></div>` : ""}
  </section>`;
};
})();
