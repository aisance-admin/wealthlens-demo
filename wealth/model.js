/* Флоу велса · модель портфеля, календарь сроков, живые данные и выводы.
   Выводы строятся только из того, что есть в выписках и котировках. Чего нет —
   перечисляется отдельно и не подменяется допущениями. */
(function(){
const WL = window.WL = window.WL || {};
const {round2} = WL.util;
const DAY = 864e5;
const D = s => new Date(s + "T00:00:00Z");
const ISO = d => d.toISOString().slice(0, 10);
const days = (a, b) => Math.round((D(b) - D(a)) / DAY);
const MON = {JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12};
const MONTH_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const weekend = d => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const lastBiz = (y, m) => { let d = new Date(Date.UTC(y, m, 0)); while(weekend(d)) d = new Date(+d - DAY); return d; };
const shiftBiz = (d, n) => { let x = new Date(d), k = 0; while(k < Math.abs(n)){ x = new Date(+x + Math.sign(n) * DAY); if(!weekend(x)) k++; } return x; };
const nthWeekday = (y, m, wd, n) => { const f = new Date(Date.UTC(y, m - 1, 1)); return new Date(Date.UTC(y, m - 1, 1 + (wd - f.getUTCDay() + 7) % 7 + 7 * (n - 1))); };
const yearOf = (code, ref) => { if(code.length === 2) return 2000 + +code; let y = Math.floor(ref / 10) * 10 + +code; if(y < ref - 5) y += 10; if(y > ref + 5) y -= 10; return y; };
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };

/* ── Форматы: русская запись чисел, валюта впереди ─────────────────────── */
const nf = (a, b) => new Intl.NumberFormat("ru-RU", {minimumFractionDigits: a, maximumFractionDigits: b});
const SYM = {USD: "$", EUR: "€", CHF: "CHF ", GBP: "£"};
const fmt = WL.fmt = {
  money: (v, ccy = "USD", dec = 2) => v == null ? "—" : `${v < 0 ? "−" : ""}${SYM[ccy] || ccy + " "}${nf(dec, dec).format(Math.abs(v))}`,
  short: (v, ccy = "USD") => {
    if(v == null) return "—";
    const a = Math.abs(v), s = v < 0 ? "−" : "", c = SYM[ccy] || ccy + " ";
    if(a >= 1e6) return `${s}${c}${nf(1, 2).format(a / 1e6)} млн`;
    if(a >= 1e3) return `${s}${c}${nf(0, 1).format(a / 1e3)} тыс.`;
    return `${s}${c}${nf(0, 2).format(a)}`;
  },
  px: v => v == null ? "—" : nf(2, v < 1 ? 4 : 2).format(v),
  int: v => v == null ? "—" : nf(0, 0).format(v),
  qty: v => v == null ? "—" : (v < 0 ? "−" : "") + nf(0, 4).format(Math.abs(v)),
  pct: (v, dec = 1) => v == null || !isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(dec, dec).format(Math.abs(v))}%`,
  signed: (v, ccy = "USD") => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt.short(Math.abs(v), ccy)}`,
  date: s => s ? s.split("-").reverse().join(".") : "—",
};
WL.days = days; WL.plural = plural;

/* ── Календарь контрактов CME: даты без учёта биржевых праздников ──────── */
const TREASURY = {
  ZN: {name: "10-летние казначейские облигации США", short: "10-летние UST", mult: 1000, ltd: (y, m) => shiftBiz(lastBiz(y, m), -7)},
  ZB: {name: "30-летние казначейские облигации США", short: "30-летние UST", mult: 1000, ltd: (y, m) => shiftBiz(lastBiz(y, m), -7)},
  ZF: {name: "5-летние казначейские облигации США", short: "5-летние UST", mult: 1000, ltd: (y, m) => lastBiz(y, m)},
  ZT: {name: "2-летние казначейские облигации США", short: "2-летние UST", mult: 2000, ltd: (y, m) => lastBiz(y, m)},
};
const firstNotice = (y, m) => m === 1 ? lastBiz(y - 1, 12) : lastBiz(y, m - 1);
function optionSpec(root, y, m){
  let r;
  if((r = /^OZ([NTFB])$/.exec(root))){   // месячные: последняя пятница минимум за 2 рабочих дня до конца предыдущего месяца
    let d = shiftBiz(firstNotice(y, m), -2); while(d.getUTCDay() !== 5) d = new Date(+d - DAY);
    return {fut: "Z" + r[1], expiry: d};
  }
  if((r = /^ZN(\d)$/.exec(root))) return {fut: "ZN", expiry: nthWeekday(y, m, 5, +r[1])};
  if((r = /^WY(\d)$/.exec(root))) return {fut: "ZN", expiry: nthWeekday(y, m, 3, +r[1])};
  if((r = /^VY(\d)$/.exec(root))) return {fut: "ZN", expiry: nthWeekday(y, m, 1, +r[1])};
  if(root === "EUU") return {name: "фьючерс евро/доллар", expiry: new Date(+nthWeekday(y, m, 3, 3) - 12 * DAY)};
  if(root === "NESN") return {name: "акции Nestlé (Eurex)", expiry: nthWeekday(y, m, 5, 3)};
  return null;
}

/* ── Журнал Swissquote → позиции на дату выписки ───────────────────────── */
function fromLedger(d){
  const ref = +d.asOf.slice(0, 4), out = [], events = [];
  const groups = new Map();
  d.trades.forEach(t => { if(!groups.has(t.label)) groups.set(t.label, []); groups.get(t.label).push(t); });
  for(const [label, ts] of groups){
    const t0 = ts[0], y = yearOf(t0.yearCode, ref), m = MON[t0.month];
    const net = ts.reduce((a, t) => a + (t.side === "Buy" ? 1 : -1) * (t.qty || 0), 0);
    const commission = round2(ts.reduce((a, t) => a + t.commission + t.exchFees, 0));
    const first = ts.map(t => t.date).sort()[0];
    const base = {broker: d.broker, brokerShort: d.brokerShort, ccy: t0.ccy, code: label, trades: ts, commission,
                  purchaseDate: first, purchaseNote: "первая сделка", asOf: d.asOf, priceDate: d.asOf, source: d.fileName};
    if(t0.kind === "future"){
      if(!net || !m) continue;
      const spec = TREASURY[t0.root] || {name: t0.root, short: t0.root, mult: null, ltd: lastBiz};
      // Цена на дату выписки — расчётная цена дня (Sett), а не цена закрытия отдельной сделки (close).
      const vm = d.vm.filter(v => v.contract === label && v.to != null && !v.closing);
      const settle = vm.length ? vm[vm.length - 1].to : null;
      const id = "SQ:" + label;
      out.push({...base, id, type: "future", root: t0.root, name: `Фьючерс на ${spec.short} · ${MONTH_RU[m - 1]} ${y}`,
        qty: net, price: settle, multiplier: spec.mult, value: null,
        valueNote: "переоценка ежедневно зачитывается деньгами (вариационная маржа)",
        notional: settle != null && spec.mult ? round2(net * settle * spec.mult) : null,
        firstNotice: ISO(firstNotice(y, m)), expiry: ISO(spec.ltd(y, m))});
      events.push({date: ISO(firstNotice(y, m)), kind: "roll", posId: id, text: `${label}: первый день уведомления — переложить до этой даты`});
      events.push({date: ISO(spec.ltd(y, m)), kind: "expiry", posId: id, text: `${label}: последний торговый день`});
      continue;
    }
    const spec = m && optionSpec(t0.root, y, m);
    const expiry = spec ? ISO(spec.expiry) : null;
    if(!net || !expiry || expiry <= d.asOf) continue;          // закрыта или истекла внутри периода выписки
    const fut = spec.fut && TREASURY[spec.fut];
    const under = fut ? `фьючерс на ${fut.short}` : spec.name;
    const id = "SQ:" + label;
    out.push({...base, id, type: "option", right: t0.right, strike: t0.strike, expiry, underlying: spec.fut || t0.root,
      underlyingName: under, multiplier: fut ? fut.mult : null,
      name: `${t0.right === "P" ? "Пут" : "Колл"} на ${under} · страйк ${t0.strike}`, qty: net, price: null, value: null,
      valueNote: "цены опциона нет в выписке", premium: round2(ts.reduce((a, t) => a + t.premium, 0)),
      obligation: fut && net < 0 ? round2(Math.abs(net) * t0.strike * fut.mult) : null});
    events.push({date: expiry, kind: "expiry", posId: id, text: `${label}: экспирация`});
  }
  Object.entries(d.balances).forEach(([ccy, v]) => out.push({id: "SQ:CASH:" + ccy, broker: d.broker, brokerShort: d.brokerShort,
    type: "cash", name: "Денежные средства", symbol: ccy, value: v, ccy, priceDate: d.asOf, asOf: d.asOf, source: d.fileName}));
  return {positions: out, events};
}

function ledgerFlows(d){
  const sum = {};
  d.records.forEach(r => {
    const c = r.type === "Payment from" ? "deposits" : r.type === "Commission" ? "commission" : r.type === "Exchange fees" ? "fees"
      : r.type === "Option Premium Receivable" ? "premiumIn" : r.type === "Option Premium Payable" ? "premiumOut"
      : r.type === "Transfer" && /^Variation Margin/.test(r.detail[0] || "") ? "vm" : /interest/i.test(r.type) ? "interest" : "other";
    const b = sum[r.ccy] = sum[r.ccy] || {};
    b[c] = round2((b[c] || 0) + r.signed);
  });
  return sum;
}

WL.build = function(docs, today){
  const P = {today, docs, positions: [], events: [], flows: {}, live: null, history: {}};
  docs.forEach(d => {
    if(d.kind === "positions"){
      d.positions.forEach(p => P.positions.push({...p, asOf: d.asOf, source: d.fileName}));
      d.positions.filter(p => p.type === "option" && p.expiry).forEach(p =>
        P.events.push({date: p.expiry, kind: "expiry", posId: p.id, text: `${p.name}: экспирация`}));
    }
    if(d.kind === "ledger"){
      const r = fromLedger(d);
      P.positions.push(...r.positions); P.events.push(...r.events); P.flows[d.brokerShort] = ledgerFlows(d);
    }
  });
  P.events.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return P;
};

/* ── Живые данные: только публичные тикеры уходят на наш сервер ────────── */
// Сервер данных может жить на другом адресе: опубликованная страница берёт котировки
// с нашего сервера, адрес — WL.API_BASE (см. wealth.html). Ошибка сети даёт null, не исключение.
WL.getJSON = async (path, ms = 90000) => {
  await WL.apiReady;
  return Promise.race([fetch((WL.API_BASE || "") + path).then(r => r.json()),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]).catch(() => null);
};
const getJSON = WL.getJSON;

WL.fetchLive = async function(P){
  const opts = P.positions.filter(p => p.type === "option" && p.occ);
  // CBOE — американский рынок в долларах. Бумагу в другой валюте его котировкой не оцениваем:
  // у Roche в франках тикер ROG, а в США ROG — это Rogers Corp.
  const syms = [...new Set([...P.positions.filter(p => WL.eq(p) && p.symbol && p.ccy === "USD").map(p => p.symbol), ...opts.map(p => p.underlying)])];
  const [q, o, fx] = await Promise.all([
    syms.length ? getJSON("/market/quotes?symbols=" + syms.join(",")) : null,
    opts.length ? getJSON("/market/options?contracts=" + opts.map(p => p.occ).join(",")) : null,
    getJSON("/fx?base=USD")]);
  const quotes = (q && q.quotes) || {}, options = (o && o.options) || {};
  // CBOE иногда не отдаёт отдельный тикер с первого раза: один повтор для пропущенных.
  const missed = syms.filter(s => !(quotes[s] && quotes[s].price));
  if(missed.length){
    await new Promise(r => setTimeout(r, 1500));
    const q2 = await getJSON("/market/quotes?symbols=" + missed.join(","));
    Object.entries((q2 && q2.quotes) || {}).forEach(([s, v]) => { if(v && v.price) quotes[s] = v; });
  }
  P.live = {quotes, fx: fx && fx.rates ? fx.rates : null, fxDate: fx && fx.date, fxSource: fx && fx.source, at: new Date().toISOString(),
    ok: !!((q && q.quotes) || (o && o.options) || (fx && fx.rates))};   // сервер данных ответил хоть чем-то
  P.positions.forEach(p => {
    if(WL.eq(p) && p.ccy === "USD" && quotes[p.symbol] && quotes[p.symbol].price) {
      const x = quotes[p.symbol]; p.live = {price: x.price, prevClose: x.prev_close, time: x.time};
    }
    if(p.type === "option" && p.occ){
      const x = options[p.occ], u = quotes[p.underlying];
      if(x && !x.error && (x.mid != null || x.last != null)) p.live = {price: x.mid ?? x.last, bid: x.bid, ask: x.ask, delta: x.delta, time: u && u.time};
      if(u && u.price) p.underlyingLive = u.price;
      else if(x && !x.error && x.underlying_price) p.underlyingLive = x.underlying_price;   // цена базового актива из цепочки опционов
    }
  });
};
/* История грузится по одной бумаге: CBOE ограничивает частоту. Неудачу не
   запоминаем как «истории нет» — при ограничении останавливаемся и повторим позже. */
WL.fetchHistory = async function(P, symbols){
  P.historyStatus = P.historyStatus || {};
  for(const s of symbols){
    if(P.history[s] && P.history[s].length) continue;
    const h = await getJSON("/market/history?symbol=" + encodeURIComponent(s));
    if(h && h.points && h.points.length){ P.history[s] = h.points; P.historyStatus[s] = "ok"; continue; }
    P.historyStatus[s] = h && h.error === "rate_limited" ? "limited" : "failed";
    if(P.historyStatus[s] === "limited") break;
  }
};

// Бумаги, которые ведут себя как акции: есть тикер и биржевая цена. Фонды сюда входят,
// облигации и структурные ноты — нет, у них своей котировки у нас нет.
WL.eq = p => p.type === "stock" || p.type === "fund";
WL.usd = (P, ccy) => ccy === "USD" ? 1 : (P.live && P.live.fx && P.live.fx[ccy] ? 1 / P.live.fx[ccy] : null);
WL.current = (P, p) => {
  if(WL.eq(p) && p.live) return {price: p.live.price, value: round2(p.qty * p.live.price), live: true};
  if(p.type === "option" && p.live && p.multiplier) return {price: p.live.price, value: round2(p.qty * p.live.price * p.multiplier), live: true};
  return {price: p.price, value: p.value, live: false};
};

WL.PERIODS = [
  {id: "1d", label: "День"}, {id: "1m", label: "Месяц", days: 30}, {id: "3m", label: "Квартал", days: 91},
  {id: "1y", label: "Год", days: 365}, {id: "5y", label: "5 лет", days: 1826}, {id: "all", label: "Вся история"},
  {id: "stmt", label: "С даты выписки"}, {id: "cost", label: "С покупки"}];
WL.priceAt = (h, target) => {
  if(!h || !h.length || h[0][0] > target) return null;
  let lo = 0, hi = h.length - 1;
  while(lo < hi){ const mid = (lo + hi + 1) >> 1; if(h[mid][0] <= target) lo = mid; else hi = mid - 1; }
  return {price: h[lo][1], date: h[lo][0]};
};
/* Изменение позиции за период. Ничего не достраиваем: нет базы — нет числа. */
WL.change = (P, p, per) => {
  const cur = WL.current(P, p);
  if(cur.value == null) return null;
  if(per === "cost"){
    if(p.cost == null) return null;
    // Процент не считаем по проданным опционам: знак премии делает отношение бессмысленным.
    return {abs: round2(cur.value - p.cost), pct: p.type === "option" || !p.cost ? null : (cur.value / p.cost - 1) * 100};
  }
  if(per === "stmt"){
    if(p.value == null || !cur.live) return null;
    return {abs: round2(cur.value - p.value), pct: p.value ? (cur.value / p.value - 1) * 100 * Math.sign(p.value) : null, from: p.priceDate};
  }
  if(!WL.eq(p)) return null;
  let start = null;
  if(per === "1d") start = p.live && p.live.prevClose ? {price: p.live.prevClose} : null;
  else {
    const h = P.history[p.symbol];
    if(per === "all") start = h && h.length ? {price: h[0][1], date: h[0][0]} : null;
    else start = WL.priceAt(h, ISO(new Date(+D(P.today) - WL.PERIODS.find(x => x.id === per).days * DAY)));
  }
  if(!start) return null;
  return {abs: round2(p.qty * (cur.price - start.price)), pct: (cur.price / start.price - 1) * 100, from: start.date};
};
})();
