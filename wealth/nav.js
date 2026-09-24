/* WealthLens · стоимость портфеля по дням (просьба Саши, 24.09.2026): NAV на конец каждого торгового дня — по выпискам и
   открытым ценам закрытия. На каждый день состав берётся из последней выписки не позже этого дня (история из старых выписок
   уходит в прошлое). От выписки стоимость ведётся цепочкой: бумага с биржевой ценой — её стоимость в выписке × изменение цены
   закрытия и курса валюты котировки с даты выписки; деньги и бумаги без котировки — стоимость в выписке × изменение курса
   их валюты. Поэтому на дату выписки точка ровно равна её итогу, а между выписками движется вместе с рынком.
   Цены закрытия — сервер /market/history (Yahoo Finance для пилота), курсы — ЕЦБ (/fx/series). */
(function(){
const WL = window.WL;
const LISTED = ["stock", "etf", "fund", "metal", "crypto", "alt", "other"];
let hx = null, hxKey = "", hxVer = 0, loading = null;

const lines = M => (M && M.hist ? M.hist.lines : []).filter(L => L.current);
/* С какого дня считать: с даты, когда выписка есть у каждой линии (банк и его счета), — раньше портфель известен не целиком. */
const startOf = M => { const ds = lines(M).map(L => L.snaps[0] && L.snaps[0].as_of).filter(Boolean).sort(); return ds.length ? ds[ds.length - 1] : ""; };
/* Бумаги, для которых нужны цены закрытия: из выписок, действующих с начала ряда (у каждой линии — последняя выписка
   до начала и все после), самые крупные первыми — сервер берёт до 80. */
function items(M, S){
  const start = startOf(M), out = new Map();
  if(!start) return [];
  for(const L of lines(M)){
    const before = L.snaps.filter(s => s.as_of <= start).pop();
    for(const s of L.snaps) if(s === before || s.as_of > start) for(const p of s.pos){
      if(!LISTED.includes(p.cls)) continue;
      const k = WL.market.keyOf(p);
      if(!k) continue;
      const sym = (S.symbols && S.symbols[k] && S.symbols[k].symbol) || "";
      if(!sym && !p.isin) continue;
      const w = Math.abs(p.vb || 0), was = out.get(k);
      if(!was) out.set(k, {key: k, symbol: sym, isin: p.isin || "", ccy: p.ccy || "", w});
      else was.w = Math.max(was.w, w);
    }
  }
  return [...out.values()].sort((a, b) => b.w - a.w).map(({w, ...x}) => x);
}
/* Последняя цена закрытия не позже даты (не старше недели). */
function priceOn(ser, d){
  let lo = 0, hi = ser.dates.length - 1, at = -1;
  while(lo <= hi){ const mid = (lo + hi) >> 1; if(ser.dates[mid] <= d){ at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at >= 0 && (WL.dms(d) - WL.dms(ser.dates[at])) / 864e5 <= 7 && ser.close[at] > 0 ? ser.close[at] : null;
}

WL.nav = {
  /* Цены закрытия по дням для бумаг отчёта — один запрос; true, если пришло новое. */
  async load(M, S){
    if(!M || !S) return false;
    const start = startOf(M), list = items(M, S);
    if(!start || !list.length || start >= WL.today()) return false;
    const key = start + "|" + list.map(x => x.key + "=" + x.symbol).sort().join(",");
    if(hx && hxKey === key) return false;
    if(loading) return loading;
    loading = WL.api("/market/history", {items: list.slice(0, 80), from: start}, {timeout: 60000}).then(async r => {
      if(!r || !r.series) return false;
      // курсы ЕЦБ по дням — и для валют котировок (ETF в долларах на Лондонской бирже при позиции в евро и т. п.)
      if(WL.ensureFxSeries) await WL.ensureFxSeries(M, Object.values(r.series).map(x => x.ccy).filter(Boolean)).catch(() => false);
      hx = r; hxKey = key; hxVer++;
      return true;
    }).catch(() => false).finally(() => { loading = null; });
    return loading;
  },
  loaded: () => !!hx,
  ver: () => hxVer,
  series: () => hx ? hx.series : null,          // для проверок (qa)
  /* Ряд стоимости: {days: [{date, nav, anchor (в этот день — выписка), mkt (доля бумаг по ценам закрытия)}], start, source}.
     Без цен закрытия ряда нет: по одним датам выписок стоимость показывает раздел «История». */
  compute(M){
    const ls = lines(M), start = startOf(M), base = M && M.base;
    if(!hx || !ls.length || !start) return null;
    const today = WL.today(), days = new Set();
    for(const s of Object.values(hx.series)) for(const d of s.dates) if(d >= start && d <= today) days.add(d);
    for(const L of ls) for(const s of L.snaps) if(s.as_of >= start && s.as_of <= today) days.add(s.as_of);
    const list = [...days].sort();
    if(list.length < 2) return null;
    // единиц валюты отчёта за единицу валюты на дату (курс ЕЦБ); нет курса — null
    const fx = (ccy, d) => { if(!ccy || ccy === base) return 1; const r = WL.rateOn && WL.rateOn(base, ccy, d); return r ? 1 / r : null; };
    // тот ли листинг: на дату выписки цена закрытия (в валюте отчёта) должна быть близка к цене из выписки
    const okList = new Map();
    const listingOk = (k, ser, snap, p) => {
      const id = k + "|" + snap.id;
      if(!okList.has(id)){
        const px = priceOn(ser, snap.as_of), r = fx(ser.ccy, snap.as_of);
        let est = null;
        if(px != null && r != null){
          if(p.qty && isFinite(p.qty) && p.vb) est = p.qty * px * r / p.vb;
          else if(p.price && p.unit !== "%"){ const rp = fx(p.ccy, snap.as_of); if(rp) est = px * r / (p.price * rp); }
        }
        okList.set(id, est != null && est > 0.67 && est < 1.5);
      }
      return okList.get(id);
    };
    // множитель от даты выписки до дня: изменение цены закрытия × курса котировки или только курса валюты позиции
    const step = (p, k, ser, snap, d) => {
      if(ser && listingOk(k, ser, snap, p)){
        const a = priceOn(ser, snap.as_of), b = priceOn(ser, d), ra = fx(ser.ccy, snap.as_of), rb = fx(ser.ccy, d);
        if(a && b && ra && rb) return {k: (b * rb) / (a * ra), mkt: true};
      }
      if(p.ccy && p.ccy !== base){ const ra = fx(p.ccy, snap.as_of), rb = fx(p.ccy, d); if(ra && rb) return {k: rb / ra, mkt: false}; }
      return {k: 1, mkt: false};
    };
    const out = [];
    for(const d of list){
      let nav = 0, anchor = false, mkt = 0, sec = 0, ok = true;
      for(const L of ls){
        let snap = null;
        for(const s of L.snaps) if(s.as_of <= d) snap = s;
        if(!snap){ ok = false; break; }
        if(snap.as_of === d){ nav += snap.value; anchor = true; continue; }
        for(const p of snap.pos){
          const k = LISTED.includes(p.cls) ? WL.market.keyOf(p) : null, ser = k ? hx.series[k] : null;
          const st = step(p, k, ser, snap, d), v = (p.vb || 0) * st.k;
          nav += v;
          if(p.cls !== "cash"){ sec += Math.abs(v); if(st.mkt) mkt += Math.abs(v); }
        }
      }
      if(ok) out.push({date: d, nav, anchor, mkt: sec ? mkt / sec : 0});
    }
    return out.length >= 2 ? {days: out, start, source: hx.source || ""} : null;
  },
};
})();
