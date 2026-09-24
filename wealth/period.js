/* WealthLens · динамика за выбранный период (модель Саши, 24.09.2026). Клиент выбирает окно — день, неделя, месяц, 3 месяца,
   полгода, с начала года, год, 5 лет, вся история, — и видит два числа:
   · «изменение стоимости» — стоимость сейчас минус стоимость на начало окна; нужна выписка на начало окна (история);
   · «заработано» — изменение без пополнений и снятий. Точно — когда сводки выписок покрывают всё окно без пропусков; иначе
     оценка по позициям: у каждой бумаги своя точка отсчёта — выписка на начало окна, дата и цена покупки (куплена внутри
     окна), текущая цена минус изменение за период (биржевые бумаги), а для «всей истории» — цена покупки.
   Деньги на счетах не «зарабатывают»: пополнение — не доход. Валюта — по курсу ЕЦБ на нужную дату (ряд /fx/series). */
(function(){
const WL = window.WL, t = WL.t;
const WINDOWS = WL.WINDOWS = [["1d", t("День", "Day")], ["1w", t("Неделя", "Week")], ["1m", t("Месяц", "Month")], ["3m", t("3 месяца", "3 months")],
  ["6m", t("Полгода", "6 months")], ["ytd", t("С начала года", "Year to date")], ["1y", t("Год", "Year")], ["5y", t("5 лет", "5 years")], ["all", t("Вся история", "All time")]];
WL.windowLabel = id => (WINDOWS.find(x => x[0] === id) || WINDOWS[2])[1];
const DAY = 864e5, dms = s => Date.parse(s + "T00:00:00Z"), dISO = v => new Date(v).toISOString().slice(0, 10);
// Допуск: выписка на начало окна может быть на несколько дней раньше или позже (конец месяца, выходные)
const TOL = {"1d": 0, "1w": 2, "1m": 6, "3m": 10, "6m": 12, "ytd": 7, "1y": 16, "5y": 45};
function startOf(id, end){
  const e = new Date(dms(end)), y = e.getUTCFullYear(), m = e.getUTCMonth(), d = e.getUTCDate();
  const back = n => { const x = new Date(Date.UTC(y, m - n, 1)), last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
    return dISO(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), Math.min(d, last))); };
  return {"1d": dISO(dms(end) - DAY), "1w": dISO(dms(end) - 7 * DAY), "1m": back(1), "3m": back(3), "6m": back(6), "ytd": `${y - 1}-12-31`, "1y": back(12), "5y": back(60)}[id] || "";
}
WL.windowStart = startOf;

/* Курсы ЕЦБ по дням — один запрос на отчёт: валюты позиций, с самой ранней нужной даты по сегодня. */
let fxs = null, fxsKey = "";
WL.ensureFxSeries = async (M) => {
  if(!M) return false;
  const base = M.base, ccys = [...new Set(M.positions.map(p => p.ccy).filter(c => c && c !== base))].sort();
  if(!ccys.length) return false;
  const dates = M.positions.map(p => p.bought).filter(Boolean).concat((M.hist ? M.hist.lines : []).flatMap(L => L.points.map(p => p.date)));
  const five = startOf("5y", WL.today()), from = dates.concat(five).sort()[0];
  const key = [base, ccys.join(","), from].join("|");
  if(fxs && fxsKey === key) return false;
  const r = await WL.api(`/fx/series?base=${base}&symbols=${ccys.join(",")}&from=${from}`, undefined, {timeout: 30000});
  if(!r || !Array.isArray(r.dates) || !r.dates.length) return false;
  fxs = r; fxsKey = key;
  return true;
};
/* Единиц валюты за 1 единицу валюты отчёта на дату (последний рабочий день ЕЦБ не позже даты). */
function rateOn(base, ccy, date){
  if(!fxs || fxs.base !== base || !fxs.rates[ccy]) return null;
  const ds = fxs.dates;
  let lo = 0, hi = ds.length - 1, at = -1;
  while(lo <= hi){ const mid = (lo + hi) >> 1; if(ds[mid] <= date){ at = mid; lo = mid + 1; } else hi = mid - 1; }
  for(let i = at; i >= 0 && i > at - 10; i--) if(fxs.rates[ccy][i] > 0) return fxs.rates[ccy][i];
  return null;
}
WL.rateOn = rateOn;

/* Цена покупки позиции в валюте отчёта: себестоимость из выписки или количество × цена покупки, по курсу на дату покупки. */
function costOf(p, base, when){
  let v = p.cost != null && isFinite(p.cost) ? p.cost : p.cpx != null && p.qty != null ? p.qty * p.cpx * (p.cunit === "%" ? 0.01 : 1) : null;
  if(v == null || !isFinite(v)) return null;
  if(!p.ccy || p.ccy === base) return {v, approx: false};
  const r = rateOn(base, p.ccy, when);
  if(r) return {v: v / r, approx: false};
  return p.value ? {v: v * (p.vb || 0) / p.value, approx: true} : null;       // нет курса на дату — по курсу выписки
}
/* Стоимость биржевой бумаги на начало окна: цена сейчас минус изменение за период, по курсу на начало окна. */
function marketStart(p, pc, start, base){
  const k = 1 + pc / 100;
  if(!(k > 0)) return null;
  const px = p.mk.price / k, ccy = p.mk.ccy || p.ccy;
  if(ccy && ccy !== base && p.qty){
    const r = rateOn(base, ccy, start);
    if(r && p.nowB != null){ const mult = Math.abs(p.nowB / (p.qty * p.mk.price / (rateOn(base, ccy, WL.today()) || 1))) || 1;
      return p.qty * px * (Math.abs(mult - 1) < 0.05 ? 1 : mult) / r; }
  }
  return p.nowB != null ? p.nowB / k : null;
}
/* Ближайшая к дате точка стоимости линии (выписка или начало её периода) в пределах допуска. */
function pointAt(L, date, tol){
  let best = null;
  for(const p of L.points){ const dd = Math.abs(dms(p.date) - dms(date)) / DAY; if(dd <= tol && (!best || dd < best.dd)) best = Object.assign({dd}, p); }
  return best;
}
/* Пополнения, снятия, доходы и комиссии между двумя датами — по сводкам выписок, если их периоды идут без пропусков. */
function flowsBetween(L, from, to){
  const ss = L.snaps.filter(s => s.flows && s.from && s.as_of > from && s.as_of <= to).sort((a, b) => a.from.localeCompare(b.from));
  let cursor = from, net = 0, income = 0, fees = 0, complete = true;
  for(const s of ss){
    if((dms(s.from) - dms(cursor)) / DAY - 1 > 3){ complete = false; break; }
    const f = s.flows;
    net += (f.deposits || 0) - (f.withdrawals || 0) + (f.transfers_in || 0) - (f.transfers_out || 0);
    income += f.income || 0; fees += f.fees || 0; cursor = s.as_of;
  }
  if(Math.abs(dms(cursor) - dms(to)) / DAY > 3) complete = false;
  return {net, income, fees, complete};
}

/* Результат окна. live — оценка «Сейчас» (конец окна — сегодня, текущие цены), иначе — по выписке (конец окна — дата выписки). */
WL.period = (M, id, live) => {
  if(!M || !M.positions.length) return null;
  const base = M.base, lines = (M.hist ? M.hist.lines : []).filter(L => L.current);
  const lineOf = {}; for(const L of lines) lineOf[L.current.id] = L;
  const stmtEnd = M.dates.length ? M.dates[M.dates.length - 1] : WL.today();
  const end = live ? WL.today() : stmtEnd;
  // «вся история»: с самой ранней известной даты — точки истории до текущей выписки или даты покупки; если нет ни того,
  // ни другого — «с покупки» без даты (start пустой)
  const firstPoint = lines.flatMap(L => L.points.filter(p => p.date < L.current.as_of).map(p => p.date)).sort()[0] || "";
  const firstBuy = M.positions.map(p => p.bought).filter(Boolean).sort()[0] || "";
  const start = id === "all" ? [firstPoint, firstBuy].filter(Boolean).sort()[0] || "" : startOf(id, end);
  const tol = TOL[id] ?? 0;
  // по позициям
  const pos = {};
  let tot = 0, cov = 0, earnedEst = 0, startEst = 0, approx = false;
  for(const p of M.positions){
    const endV = live && p.nowV != null ? p.nowV : (p.vb || 0) + (p.ab || 0);
    if(p.cls === "cash"){ pos[p.id] = {end: endV, start: endV, src: "cash", chg: 0, pct: 0}; continue; }
    tot += Math.abs(endV);
    let st = null, src = "", when = "";
    if(id === "all" || (p.bought && p.bought > start)){
      const c = costOf(p, base, p.bought || start);
      if(c){ st = c.v; src = "buy"; when = p.bought || ""; approx = approx || c.approx; }
    }
    if(st == null && id !== "all" && !(p.bought && p.bought > start)){
      const L = lineOf[p.doc], sp = L && pointAt(L, start, tol), snap = sp && sp.src === "snap" && L.snaps.find(s => s.id === sp.snap);
      const old = snap && snap.pos.find(x => x.key === WL.posKey(p));
      if(old && old.vb != null){ st = old.vb * (p.qty && old.qty ? p.qty / old.qty : 1); src = "stmt"; when = snap.as_of; }
    }
    if(st == null && live && p.mk && !p.mk.suspect && p.nowB != null && p.cls !== "option"){
      const pc = id === "1d" ? p.mk.change : (p.mk.perf || {})[id];
      if(pc != null){ const v = marketStart(p, pc, start, base); if(v != null){ st = v + (p.ab || 0); src = "mkt"; when = start; } }
    }
    if(st == null){ pos[p.id] = {end: endV, start: null, src: ""}; continue; }
    cov += Math.abs(endV); earnedEst += endV - st; startEst += st;
    pos[p.id] = {end: endV, start: st, src, when, chg: endV - st, pct: st ? (endV - st) / Math.abs(st) : null};
  }
  // по выпискам: стоимость на начало окна и движения между — по каждой линии (банк и его счета)
  let hasStart = lines.length > 0, complete = true, dv = 0, startV = 0, net = 0, income = 0, fees = 0;
  const starts = new Set(), missing = [];
  for(const L of lines){
    const endV = M.positions.filter(p => p.doc === L.current.id).reduce((s, p) => s + (live && p.nowV != null ? p.nowV : (p.vb || 0) + (p.ab || 0)), 0);
    const sp = id === "all" ? (L.points[0] && L.points[0].date < L.current.as_of ? L.points[0] : null) : pointAt(L, start, tol);
    if(!sp || sp.date >= L.current.as_of){ hasStart = false; missing.push(L.name); continue; }
    const f = flowsBetween(L, sp.date, L.current.as_of);
    if(!f.complete) complete = false;
    dv += endV - sp.value; startV += sp.value; net += f.net; income += f.income; fees += f.fees; starts.add(sp.date);
  }
  const exact = hasStart && complete && id !== "all";
  const gaps = lines.flatMap(L => L.links.filter(k => k.gap && k.gapTo >= (start || "0") && k.gapFrom <= end).map(k => ({inst: L.name, from: k.gapFrom, to: k.gapTo})));
  const breaks = lines.flatMap(L => L.links.filter(k => k.ok === false && k.to > (start || "0")).map(k => ({inst: L.name, date: k.from, closing: k.closing, opening: k.opening})));
  const startDate = starts.size ? [...starts].sort()[0] : start;
  return {id, label: WL.windowLabel(id), live, start, end, startDate,
    change: hasStart ? dv : null, startValue: hasStart ? startV : null,
    flows: hasStart && complete ? net : null, income: hasStart && complete ? income : null, fees: hasStart && complete ? fees : null,
    earned: exact ? dv - net : earnedEst, earnedPct: exact ? (startV + net / 2 ? (dv - net) / (startV + net / 2) : null) : startEst ? earnedEst / Math.abs(startEst) : null,
    exact, estimate: !exact, coverage: exact ? 1 : tot ? cov / tot : 0, approx, missing, gaps, breaks, pos,
    srcCount: Object.values(pos).reduce((c, x) => (x.src && x.src !== "cash" ? (c[x.src] = (c[x.src] || 0) + 1, c) : c), {})};
};
})();
