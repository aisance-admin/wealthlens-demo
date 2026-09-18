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
const EN = WL.lang === "en", t = WL.t || ((ru, en) => ru);
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Форма слова по числу: WL.pl(n, ["позиция", "позиции", "позиций"], ["position", "positions"])
const pl = (n, ru, en) => EN ? (Math.abs(n) === 1 ? en[0] : en[1]) : plural(n, ru[0], ru[1], ru[2]);

/* ── Форматы: запись чисел по языку интерфейса, валюта впереди ─────────── */
const nf = (a, b) => new Intl.NumberFormat(EN ? "en-US" : "ru-RU", {minimumFractionDigits: a, maximumFractionDigits: b});
const SYM = {USD: "$", EUR: "€", CHF: "CHF ", GBP: "£"};
const fmt = WL.fmt = {
  // Знак и валюта не отрываются от числа при переносе строки (U+2060), единицы — неразрывным пробелом.
  money: (v, ccy = "USD", dec = 2) => v == null ? "—" : `${v < 0 ? "−\u2060" : ""}${SYM[ccy] || ccy + "\u00a0"}${nf(dec, dec).format(Math.abs(v))}`,
  short: (v, ccy = "USD") => {
    if(v == null) return "—";
    const a = Math.abs(v), s = v < 0 ? "−\u2060" : "", c = SYM[ccy] || ccy + "\u00a0";
    if(a >= 1e6) return `${s}${c}${nf(1, 2).format(a / 1e6)}${EN ? "M" : "\u00a0млн"}`;
    if(a >= 1e3) return `${s}${c}${nf(0, 1).format(a / 1e3)}${EN ? "K" : "\u00a0тыс."}`;
    return `${s}${c}${nf(0, 2).format(a)}`;
  },
  px: v => v == null ? "—" : nf(2, v < 1 ? 4 : 2).format(v),
  int: v => v == null ? "—" : nf(0, 0).format(v),
  qty: v => v == null ? "—" : (v < 0 ? "−" : "") + nf(0, 4).format(Math.abs(v)),
  pct: (v, dec = 1) => v == null || !isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(dec, dec).format(Math.abs(v))}%`,
  signed: (v, ccy = "USD") => v == null ? "—" : `${v > 0 ? "+\u2060" : v < 0 ? "−\u2060" : ""}${fmt.short(Math.abs(v), ccy)}`,
  date: s => !s ? "—" : EN ? `${+s.slice(8, 10)}\u00a0${MON_EN[+s.slice(5, 7) - 1]}\u00a0${s.slice(0, 4)}` : s.split("-").reverse().join("."),
  // десятичная дробь без знака: «3,8» / «3.8»
  dec: (v, d = 1) => v == null || !isFinite(v) ? "—" : nf(d, d).format(v),
};
WL.days = days; WL.plural = plural; WL.pl = pl;

/* ── Насколько выписке можно верить ───────────────────────────────────────
   Три состояния, одинаковые для загрузки, «Документов», оплаты и PDF:
   ok — «Сверено с выпиской»: прочитанное сошлось с итогами самой выписки, и ничего не известно о пропусках;
   unverified — «Прочитано, итога нет»: противоречий не нашлось, но сверить сумму не с чем (в выгрузке нет итоговой строки,
     итог в другой валюте);
   partial — «Есть пропуски или противоречия»: сверка не сошлась, страница или таблица не прочитана, количество × цена
     не равно стоимости, число из ответа ИИ не нашлось в строке своей бумаги. С такой выпиской отчёт не продаётся.
   issues — что именно не так; basis — на чём держится доверие (сошедшиеся итоги, прочитанные страницы, подтверждения человека). */
const bondLike = p => p.type === "bond" || p.type === "note";
// Количество × цена × множитель против стоимости. Цена в пенсах при стоимости в фунтах (отношение ровно 1/100 у всех бумаг
// валюты) — запись биржи, а не ошибка. Любое другое расхождение больше допуска — противоречие: знак, лишний ноль, чужая колонка.
function mismatches(ps){
  const out = [];
  ps.forEach(p => {
    if(p.type === "cash" || p.accruedLine || p.qty == null || p.price == null || p.value == null || !p.qty) return;
    const mult = p.type === "option" || p.type === "future" ? p.multiplier : 1;
    if(!mult) return;
    const exp = p.qty * p.price * mult * (p.priceBasis === "percent" ? 0.01 : 1);
    if(Math.abs(exp - p.value) <= Math.max(1, Math.abs(p.value) * (bondLike(p) ? 0.04 : 0.01))) return;
    out.push({p, r: exp ? p.value / exp : null});
  });
  const minor = x => x.r != null && Math.abs(x.r - 0.01) < 0.00005;
  return out.filter(x => !(minor(x) && out.filter(y => y.p.ccy === x.p.ccy).every(minor)));
}
WL.mismatches = mismatches;
const pagesText = ns => t(`${ns.length === 1 ? "страница" : "страницы"} ${ns.join(", ")}`, `${ns.length === 1 ? "page" : "pages"} ${ns.join(", ")}`);
WL.quality = d => {
  const issues = [], basis = [];
  (d.checks || []).forEach(c => {
    if(c.ok){
      if(c.human) basis.push(c.label);
      else if(c.count) basis.push(t(`${c.label}: ${c.parsed} из ${c.stated}`, `${c.label}: ${c.parsed} of ${c.stated}`));
      else basis.push(t(`${c.label}: сошлось, ${fmt.money(c.stated, c.ccy || "USD")}`, `${c.label}: matches, ${fmt.money(c.stated, c.ccy || "USD")}`));
      return;
    }
    if(c.pages) issues.push(t(`в файле есть ещё таблица позиций (${pagesText(c.pages)}) — её строки не прочитаны`,
      `the file has another positions table (${pagesText(c.pages)}) — its rows were not read`));
    else if(c.count) issues.push(t(`${c.label}: ${c.parsed} из ${c.stated}`, `${c.label}: ${c.parsed} of ${c.stated}`));
    else if(c.stated == null) issues.push(t(`${c.label}: итога в выписке не нашлось`, `${c.label}: no total found in the statement`));
    else issues.push(t(`${c.label}: прочитано ${fmt.money(c.parsed, c.ccy || "USD")} вместо ${fmt.money(c.stated, c.ccy || "USD")}`,
      `${c.label}: read ${fmt.money(c.parsed, c.ccy || "USD")} instead of ${fmt.money(c.stated, c.ccy || "USD")}`));
  });
  // Полнота страниц: непрочитанная страница — пропуск, даже если итог прочитанного сошёлся, пока итог не покрывает весь счёт.
  const pg = d.pages;
  if(pg){
    const said = d.pagesConfirmed || [], whole = (d.checks || []).some(c => c.whole && c.ok);
    const open = (pg.unread || []).filter(n => !said.includes(n));
    if(open.length && !whole) issues.push(t(`${pagesText(open)} — ${open.length === 1 ? "картинка" : "картинки"}: позиции на ${open.length === 1 ? "ней" : "них"} не прочитаны`,
      `${pagesText(open)}: image${open.length === 1 ? "" : "s"} — positions on ${open.length === 1 ? "it" : "them"} were not read`));
    else if(open.length) basis.push(t(`${pagesText(open)} — ${open.length === 1 ? "картинка" : "картинки"} без позиций: итог всего счёта сошёлся`,
      `${pagesText(open)}: image${open.length === 1 ? "" : "s"} with no positions — the whole account total matches`));
    const read = pg.count - (pg.unread || []).length, ocr = pg.ocr || [];
    basis.push(t(`страниц прочитано: ${read} из ${pg.count}`, `pages read: ${read} of ${pg.count}`) +
      (ocr.length ? t(` (${pagesText(ocr)} — ${ocr.length === 1 ? "распознана" : "распознаны"} на этом компьютере)`, ` (${pagesText(ocr)} recognised on this computer)`) : ""));
    if(said.length) basis.push(t(`${pagesText(said)}: позиций нет — со слов пользователя`, `${pagesText(said)}: no positions, as confirmed by the user`));
  } else if(issues.length && d.imagePages && d.imagePages.length)
    issues.push(t(`страницы ${d.imagePages.join(", ")} — картинки без текста, прочитать их нельзя`, `pages ${d.imagePages.join(", ")} are images without text and cannot be read`));
  const bad = mismatches(d.positions || []);
  if(bad.length){
    const x = bad[0].p, mult = x.type === "option" || x.type === "future" ? ` × ${x.multiplier}` : "";
    issues.push(t(`количество × цена не равно стоимости: ${x.name} — ${fmt.qty(x.qty)} × ${fmt.px(x.price)}${x.priceBasis === "percent" ? "%" : ""}${mult}, а в выписке ${fmt.money(x.value, x.ccy)}`,
      `quantity × price does not equal the value: ${x.name} — ${fmt.qty(x.qty)} × ${fmt.px(x.price)}${x.priceBasis === "percent" ? "%" : ""}${mult}, but the statement shows ${fmt.money(x.value, x.ccy)}`) +
      (bad.length > 1 ? t(` (и ещё у ${bad.length - 1})`, ` (and ${bad.length - 1} more)`) : ""));
  }
  const unknown = (d.positions || []).filter(p => p.basisUnknown && p.value == null);
  if(unknown.length) issues.push(t(`у ${unknown.length} ${pl(unknown.length, ["облигации", "облигаций", "облигаций"], ["bond", "bonds"])} не указано, цена в процентах номинала или за штуку, — стоимость не посчитана`,
    `${unknown.length} ${pl(unknown.length, ["", "", ""], ["bond has", "bonds have"])} a price without a stated basis (% of nominal or per unit), so the value was not calculated`));
  if(d.aiIssues && d.aiIssues.length) issues.push(...d.aiIssues);
  else if(d.aiDoubt && d.aiDoubt.length)
    issues.push(t(`суммы ИИ не подтверждены текстом выписки: ${d.aiDoubt.join(", ")}`, `AI amounts not confirmed by the statement text: ${d.aiDoubt.join(", ")}`));
  // Строки таблицы, которых нет в ответе ИИ, при несошедшемся итоге: пропуск, пока человек не подтвердит, что это не позиции.
  const missed = d.aiMissed || [], rows = missed.slice(0, 5).join(", ") + (missed.length > 5 ? t(` и ещё ${missed.length - 5}`, ` and ${missed.length - 5} more`) : "");
  if(missed.length && !d.rowsConfirmed) issues.push(t(`в таблице позиций есть строки, которых нет в ответе ИИ: ${rows}`, `the positions table has rows missing from the AI result: ${rows}`));
  else if(missed.length) basis.push(t(`строки ${rows} — не позиции, со слов пользователя`, `rows ${rows} are not positions, as confirmed by the user`));
  (d.aiNotes || []).forEach(x => basis.push(x));
  const totals = (d.checks || []).some(c => !c.count && !c.human);
  return {status: issues.length ? "partial" : totals ? "ok" : "unverified", issues, basis};
};
// Подписи состояний — одни и те же везде.
WL.qualityLabel = s => s === "ok" ? t("Сверено с выпиской", "Matches the statement") : s === "unverified" ? t("Прочитано, итога для сверки нет", "Read, no total to reconcile")
  : t("Есть пропуски или противоречия", "Gaps or contradictions");

/* ── Календарь контрактов CME: даты без учёта биржевых праздников ──────── */
const TREASURY = {
  ZN: {name: t("10-летние казначейские облигации США", "10-year US Treasury notes"), short: t("10-летние UST", "10-year UST"), mult: 1000, ltd: (y, m) => shiftBiz(lastBiz(y, m), -7)},
  ZB: {name: t("30-летние казначейские облигации США", "30-year US Treasury bonds"), short: t("30-летние UST", "30-year UST"), mult: 1000, ltd: (y, m) => shiftBiz(lastBiz(y, m), -7)},
  ZF: {name: t("5-летние казначейские облигации США", "5-year US Treasury notes"), short: t("5-летние UST", "5-year UST"), mult: 1000, ltd: (y, m) => lastBiz(y, m)},
  ZT: {name: t("2-летние казначейские облигации США", "2-year US Treasury notes"), short: t("2-летние UST", "2-year UST"), mult: 2000, ltd: (y, m) => lastBiz(y, m)},
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
  if(root === "EUU") return {name: t("фьючерс евро/доллар", "EUR/USD future"), expiry: new Date(+nthWeekday(y, m, 3, 3) - 12 * DAY)};
  if(root === "NESN") return {name: t("акции Nestlé (Eurex)", "Nestlé shares (Eurex)"), expiry: nthWeekday(y, m, 5, 3)};
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
                  purchaseDate: first, purchaseNote: t("первая сделка", "first trade"), asOf: d.asOf, priceDate: d.asOf, source: d.fileName};
    if(t0.kind === "future"){
      if(!net || !m) continue;
      const spec = TREASURY[t0.root] || {name: t0.root, short: t0.root, mult: null, ltd: lastBiz};
      // Цена на дату выписки — расчётная цена дня (Sett), а не цена закрытия отдельной сделки (close).
      const vm = d.vm.filter(v => v.contract === label && v.to != null && !v.closing);
      const settle = vm.length ? vm[vm.length - 1].to : null;
      const id = "SQ:" + label;
      out.push({...base, id, type: "future", root: t0.root, name: t(`Фьючерс на ${spec.short} · ${MONTH_RU[m - 1]} ${y}`, `${spec.short} future · ${MONTH_EN[m - 1]} ${y}`),
        qty: net, price: settle, multiplier: spec.mult, value: null,
        valueNote: t("переоценка ежедневно зачитывается деньгами (вариационная маржа)", "revaluation is settled in cash daily (variation margin)"),
        notional: settle != null && spec.mult ? round2(net * settle * spec.mult) : null,
        firstNotice: ISO(firstNotice(y, m)), expiry: ISO(spec.ltd(y, m))});
      events.push({date: ISO(firstNotice(y, m)), kind: "roll", posId: id, text: t(`${label}: первый день уведомления — переложить до этой даты`, `${label}: first notice day — roll before this date`)});
      events.push({date: ISO(spec.ltd(y, m)), kind: "expiry", posId: id, text: t(`${label}: последний торговый день`, `${label}: last trading day`)});
      continue;
    }
    const spec = m && optionSpec(t0.root, y, m);
    const expiry = spec ? ISO(spec.expiry) : null;
    if(!net || !expiry || expiry <= d.asOf) continue;          // закрыта или истекла внутри периода выписки
    const fut = spec.fut && TREASURY[spec.fut];
    const under = fut ? t(`фьючерс на ${fut.short}`, `${fut.short} future`) : spec.name;
    const id = "SQ:" + label;
    out.push({...base, id, type: "option", right: t0.right, strike: t0.strike, expiry, underlying: spec.fut || t0.root,
      underlyingName: under, multiplier: fut ? fut.mult : null,
      name: t(`${t0.right === "P" ? "Пут" : "Колл"} на ${under} · страйк ${t0.strike}`, `${t0.right === "P" ? "Put" : "Call"} on ${under} · strike ${t0.strike}`), qty: net, price: null, value: null,
      valueNote: t("цены опциона нет в выписке", "option price is not in the statement"), premium: round2(ts.reduce((a, x) => a + x.premium, 0)),
      obligation: fut && net < 0 ? round2(Math.abs(net) * t0.strike * fut.mult) : null});
    events.push({date: expiry, kind: "expiry", posId: id, text: t(`${label}: экспирация`, `${label}: expiry`)});
  }
  Object.entries(d.balances).forEach(([ccy, v]) => out.push({id: "SQ:CASH:" + ccy, broker: d.broker, brokerShort: d.brokerShort,
    type: "cash", name: t("Денежные средства", "Cash"), symbol: ccy, value: v, ccy, priceDate: d.asOf, asOf: d.asOf, source: d.fileName}));
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
    // Имя файла уникально в отчёте (ui.js следит): им и помечаем позиции. Иначе у двух выписок одного
    // брокера совпадают id («SCHW:AAPL»), и строка таблицы открывает чужую позицию.
    const key = d.fileName + "|";
    if(d.kind === "positions"){
      // Бумаги, записанные американским брокером (разбор Schwab) или демо-портфелем, — сразу биржевые тикеры США.
      const us = d.from === "demo" || d.brokerShort === "Schwab" && !d.from;
      d.positions.forEach(p => P.positions.push({...p, id: key + p.id, asOf: d.asOf, source: d.fileName, listing: p.listing || (us ? "US" : undefined)}));
      d.positions.filter(p => p.type === "option" && p.expiry).forEach(p =>
        P.events.push({date: p.expiry, kind: "expiry", posId: key + p.id, text: t(`${p.name}: экспирация`, `${p.name}: expiry`)}));
    }
    if(d.kind === "ledger"){
      const r = fromLedger(d);
      r.positions.forEach(p => { p.id = key + p.id; });
      r.events.forEach(ev => { if(ev.posId != null) ev.posId = key + ev.posId; });
      P.positions.push(...r.positions); P.events.push(...r.events); P.flows[d.fileName] = ledgerFlows(d);
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

/* ── Какая бумага стоит за тикером ─────────────────────────────────────────
   Текущую цену подставляем, только если бумага из выписки — та же, что торгуется под тикером на бирже США:
   source — так её записал американский брокер (разбор Schwab) или демо; isin — ISIN из выписки на бирже США означает
   именно этот тикер; name — название в выписке совпало с названием бумаги в справочнике OpenFIGI (значимые слова в обе
   стороны); underlying — опцион на бумагу, уже подтверждённую в отчёте; user — сопоставление подтвердил человек.
   Иначе остаются цена и стоимость из выписки: вымышленная «Beta Corp» с тикером BETA не станет BETA Technologies. */
const ID = {};                       // "t:BETA" / "i:US…" → ответ справочника (или ошибка с временем); в памяти страницы
// Служебные слова названий: форма компании, «акции», «обычные», «фонд». Класс акций, UCITS, ADR, валюта класса,
// accumulating/distributing, страна и номер серии — не служебные: они отличают один инструмент от другого и должны совпасть.
const GENERIC_WORD = /^(inc|incorporated|corp|corporation|co|cos|company|companies|ltd|limited|plc|ag|sa|nv|se|as|asa|ab|oyj|spa|gmbh|kgaa|bv|llc|lp|the|of|and|shares?|shs|common|stock|ord|ordinary|sponsored|spon|spons|registered|reg|new|del|holding|holdings|hldg|hldgs|group|grp|trust|tr|fund|etf|etp)$/;
// Сокращения справочников (у Bloomberg и OpenFIGI название не длиннее 28 знаков). Только явный словарь: совпадение по началу
// слова не годится — Apple ≠ Appleton, Meta ≠ Metaverse. Обрезанное справочником слово («MARKE») тоже не совпадёт: спросим человека.
const ABBR = {intl: "international", tot: "total", stk: "stock", mkt: "market", mkts: "markets", idx: "index", govt: "government",
  tech: "technologies", technology: "technologies", mfg: "manufacturing", svcs: "services", svc: "services", sys: "systems",
  fin: "financial", finl: "financial", natl: "national", amer: "american", pharma: "pharmaceuticals", pharm: "pharmaceuticals",
  pharmaceutical: "pharmaceuticals", inds: "industries", mgmt: "management", comm: "communications", commun: "communications",
  communication: "communications", ent: "entertainment", res: "resources", props: "properties", engy: "energy", hlth: "health",
  ins: "insurance", elec: "electric", chem: "chemical", chemicals: "chemical", dvd: "dividend", eqty: "equity", bd: "bond",
  trsy: "treasury", tsy: "treasury", agg: "aggregate", vg: "vanguard", registry: "registered", pfd: "preferred", pref: "preferred",
  wts: "warrants", wt: "warrants", rts: "rights", hdg: "hedged", accumulating: "acc", accumulation: "acc", accum: "acc",
  distributing: "dist", distribution: "dist", ads: "adr",
  // Сокращения из описаний опционов Schwab: «FACTSET RESH SYS», «AUTOMATIC DATA PROCE», «EXXONMOBIL HLDGS».
  resh: "research", rsch: "research", proce: "processing", proc: "processing", hldgs: "holdings", hldg: "holdings", grp: "group"};
const nameParts = x => {
  let raw = String(x || "").toLowerCase().replace(/s\s*&\s*p/g, "sp")
    .replace(/(^|[^a-z0-9])((?:[a-z][.\/]){1,3}[a-z])(?![a-z0-9])/g, (m, pre, ab) => pre + ab.replace(/[.\/]/g, ""))   // U.S., S.A., A/S, J.M.
    .split(/[^a-z0-9]+/).filter(Boolean);
  // Инициалы через пробел — одно слово: «J M Smucker» = «JM SMUCKER».
  raw = raw.reduce((out, w) => { const last = out[out.length - 1];
    if(/^[a-z]$/.test(w) && last && last.initials){ last.w += w; return out; }
    out.push({w, initials: /^[a-z]$/.test(w)}); return out; }, []).map(o => o.w);
  const words = new Set();
  let cls = null;
  for(let i = 0; i < raw.length; i++){
    const w = ABBR[raw[i]] || raw[i], next = raw[i + 1] || "";
    // Класс акций: «Class A», «CL B», «Series C» или буква в конце («LIBERTY GLOBAL LTD-A») — сравнивается отдельно.
    if(/^(class|cl|cls|series)$/.test(w) && /^[a-z]$/.test(next)){ cls = next; i++; continue; }
    if(/^[a-z]$/.test(w)){ if(i === raw.length - 1) cls = cls || w; continue; }
    if(w === "ss" && next === "spdr") continue;                      // SS SPDR — State Street
    if(w === "sp" && /^(adr|ads|gdr)$/.test(next)) continue;         // SP ADR — sponsored ADR
    if(w === "us" && i === raw.length - 1) continue;                 // ETF-US — пометка американского листинга
    if(GENERIC_WORD.test(w)) continue;
    words.add(w);
  }
  return {words: [...words], cls};
};
// Названия совпадают, только если наборы значимых слов равны (после развёртывания сокращений) и класс акций не противоречит.
WL.sameName = (a, b) => {
  const A = nameParts(a), B = nameParts(b);
  if(!A.words.length || A.words.length !== B.words.length || !A.words.every(w => B.words.includes(w))) return false;
  return !(A.cls && B.cls && A.cls !== B.cls);
};
const tick = x => String(x || "").toUpperCase().replace(/[\/\s]+/g, ".");
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const isUsd = p => p.ccy === "USD";
WL.idOf = (P, p) => {
  const opt = p.type === "option";
  if(!(WL.eq(p) || opt) || !isUsd(p)) return {ok: false, how: "none"};
  if(p.listing === "US") return {ok: true, how: "source"};
  const sym = tick(opt ? p.underlying : p.symbol);
  if(p.idUser && tick(p.idUser.ticker) === sym) return {ok: true, how: "user", market: p.idUser};
  if(opt){
    if(!p.occ || !sym) return {ok: false, how: "none"};
    const base = P.positions.find(q => WL.eq(q) && q !== p && tick(q.symbol) === sym && WL.idOf(P, q).ok);
    if(base) return {ok: true, how: "underlying"};
  }
  const isin = !opt && ISIN.test(p.isin || "") ? p.isin : null;
  if(isin){
    const r = ID["i:" + isin];
    if(!r) return {ok: false, how: "pending"};
    if(!r.error && r.matches.length){
      const same = r.matches.find(m => tick(m.ticker) === sym);
      if(same) return {ok: true, how: "isin", market: same};
      // Тикера в выписке нет, а бумага американская и на бирже одна: берём её тикер.
      if(!sym && isin.startsWith("US") && r.matches.length === 1) return {ok: true, how: "isin", market: r.matches[0], ticker: tick(r.matches[0].ticker)};
      // ISIN и тикер указывают на разные бумаги — цена из выписки. Человеку показываем обе: что торгуется под тикером и что по ISIN.
      if(sym){ const byTick = ID["t:" + sym];
        return {ok: false, how: "mismatch", market: (byTick && !byTick.error && byTick.matches[0]) || null, isinMarket: r.matches[0]}; }
    }
    if(r.error && !sym) return {ok: false, how: "error"};
  }
  if(!sym) return {ok: false, how: "none"};
  const r = ID["t:" + sym];
  if(!r) return {ok: false, how: "pending"};
  if(r.error) return {ok: false, how: "error"};
  if(!r.matches.length) return {ok: false, how: "notfound"};
  const label = opt ? p.underlyingName : p.name;
  const named = label && tick(label) !== sym ? r.matches.find(m => WL.sameName(label, m.name)) : null;
  return named ? {ok: true, how: "name", market: named} : {ok: false, how: "mismatch", market: r.matches[0]};
};
// Тикер для котировки: из выписки или найденный по ISIN.
WL.quoteSymbol = (P, p) => { const id = WL.idOf(P, p); return id.ok ? id.ticker || tick(p.type === "option" ? p.underlying : p.symbol) : null; };
WL.identify = async function(P){
  const now = Date.now(), want = {t: new Set(), i: new Set()};
  const stale = k => !ID[k] || (ID[k].error && now - ID[k].at > 60000);
  P.positions.forEach(p => {
    const opt = p.type === "option";
    if(!(WL.eq(p) || opt) || !isUsd(p) || p.listing === "US") return;
    const sym = tick(opt ? p.underlying : p.symbol);
    if(sym && /^[A-Z][A-Z0-9.]{0,9}$/.test(sym) && stale("t:" + sym)) want.t.add(sym);
    if(!opt && ISIN.test(p.isin || "") && stale("i:" + p.isin)) want.i.add(p.isin);
  });
  const ts = [...want.t], is = [...want.i];
  for(let k = 0; k < Math.max(ts.length, is.length); k += 30){
    const r = await getJSON(`/market/identify?t=${ts.slice(k, k + 30).join(",")}&i=${is.slice(k, k + 30).join(",")}`, 45000);
    const res = r && r.results;
    [...ts.slice(k, k + 30).map(x => "t:" + x), ...is.slice(k, k + 30).map(x => "i:" + x)].forEach(key => {
      const v = res && res[key];
      ID[key] = v && !v.error ? {matches: v.matches || []} : {error: (v && v.error) || "unavailable", at: Date.now()};
    });
  }
};

/* ── Основание оценки ─────────────────────────────────────────────────────
   «now» — оценка сейчас: подтверждённые бумаги по текущим ценам Cboe, остальное по выпискам, валюты по текущему курсу ЕЦБ.
   «stmt» — снимок выписок: цены и стоимости из выписок, валюты по курсу ЕЦБ на дату выписки. Итог, карточки счетов,
   структура, строки таблицы и PDF берут стоимость и курс из одних функций (WL.current, WL.usd), поэтому основание одно. */
const FX_AT = {};                    // дата выписки → {rates, date}; исторический курс не меняется
WL.fetchFxAt = async function(P){
  const dates = [...new Set(P.positions.filter(p => p.ccy && p.ccy !== "USD" && p.asOf).map(p => p.asOf))].filter(d => !FX_AT[d]);
  await Promise.all(dates.map(async d => { const r = await getJSON("/fx?base=USD&date=" + d, 30000); if(r && r.rates) FX_AT[d] = {rates: r.rates, date: r.date}; }));
  P.fxAt = FX_AT;
};
WL.fxAtDate = d => FX_AT[d] || null;

/* Последние котировки и курсы. Портфель пересобирается после каждой добавленной выписки, и без
   них итог на секунду падал бы до цен из выписок, а позиции в других валютах выпадали из суммы.
   Котировка годится 15 минут с момента, когда её получили: старше — это уже не «цена сейчас», и бумага
   показывается по цене из выписки. Курсы ЕЦБ дневные и подписаны своей датой — их держим дольше. */
const FRESH = 15 * 60000;
let LIVE = null;
function applyLive(P, L){
  const now = Date.now(), fresh = m => Object.fromEntries(Object.entries(m || {}).filter(([, x]) => x && now - x._at < FRESH));
  const quotes = fresh(L.quotes), options = fresh(L.options);
  const oldest = Math.min(...[...Object.values(quotes), ...Object.values(options)].map(x => x._at));
  // «Получены в …» — время самой старой из показанных котировок; «сервер ответил» — если есть что показать.
  P.live = {quotes, fx: L.fx, fxDate: L.fxDate, fxSource: L.fxSource, at: isFinite(oldest) ? new Date(oldest).toISOString() : L.at,
            ok: L.ok || Object.keys(quotes).length > 0};
  P.positions.forEach(p => {
    delete p.live; delete p.underlyingLive;
    const sym = WL.eq(p) && p.ccy === "USD" ? WL.quoteSymbol(P, p) : null;
    if(sym && quotes[sym] && quotes[sym].price) {
      const x = quotes[sym]; p.live = {price: x.price, prevClose: x.prev_close, time: x.time, symbol: sym};
    }
    if(p.type === "option" && p.occ && WL.idOf(P, p).ok){
      const x = options[p.occ], u = quotes[p.underlying];
      if(x && !x.error && (x.mid != null || x.last != null)) p.live = {price: x.mid ?? x.last, bid: x.bid, ask: x.ask, delta: x.delta, time: u && u.time};
      // У скорректированного контракта (FDX1: 100 FDX + 50 FDXF) поставка — не одна акция: сравнивать страйк с её ценой нельзя.
      if(!p.adjusted && u && u.price) p.underlyingLive = u.price;
      else if(!p.adjusted && x && !x.error && x.underlying_price) p.underlyingLive = x.underlying_price;   // цена базового актива из цепочки опционов
    }
  });
}
WL.applyLiveCache = P => { if(LIVE) applyLive(P, LIVE); P.fxAt = FX_AT; };

WL.fetchLive = async function(P){
  const started = Date.now();
  // Cboe — американский рынок в долларах. Бумагу в другой валюте его котировкой не оцениваем (у Roche в франках тикер ROG,
  // а в США ROG — это Rogers Corp), а бумагу в долларах — только если подтверждено, что под тикером она же (WL.idOf).
  await WL.identify(P);
  const opts = P.positions.filter(p => p.type === "option" && p.occ && WL.idOf(P, p).ok);
  const syms = [...new Set([...P.positions.filter(p => WL.eq(p) && p.ccy === "USD").map(p => WL.quoteSymbol(P, p)).filter(Boolean), ...opts.map(p => p.underlying)])];
  const [q, o, fx] = await Promise.all([
    syms.length ? getJSON("/market/quotes?symbols=" + syms.join(",")) : null,
    opts.length ? getJSON("/market/options?contracts=" + opts.map(p => p.occ).join(",")) : null,
    getJSON("/fx?base=USD")]);
  const quotes = (q && q.quotes) || {}, options = (o && o.options) || {};
  // Cboe иногда не отдаёт отдельный тикер с первого раза: один повтор для пропущенных.
  const missed = syms.filter(s => !(quotes[s] && quotes[s].price));
  if(missed.length){
    await new Promise(r => setTimeout(r, 1500));
    const q2 = await getJSON("/market/quotes?symbols=" + missed.join(","));
    Object.entries((q2 && q2.quotes) || {}).forEach(([s, v]) => { if(v && v.price) quotes[s] = v; });
  }
  const ok = !!((q && q.quotes) || (o && o.options) || (fx && fx.rates));   // сервер данных ответил хоть чем-то
  // Кэш дополняется, а не перезаписывается: бумаги, которых в этом запросе не было, сохраняют свои цены. Ошибка
  // котировки прежнюю не затирает, но и не продлевает; ответ, пришедший позже более свежего, его не перекрывает.
  const put = (was, got, usable) => { const m = Object.assign({}, was);
    Object.entries(got).forEach(([k, v]) => { if(usable(v) && !(m[k] && m[k]._at > started)) m[k] = {...v, _at: started}; });
    return m; };
  LIVE = {quotes: put(LIVE && LIVE.quotes, quotes, v => v && v.price),
    options: put(LIVE && LIVE.options, options, v => v && !v.error && (v.mid != null || v.last != null || v.underlying_price)),
    fx: fx && fx.rates ? fx.rates : LIVE && LIVE.fx || null, fxDate: fx && fx.rates ? fx.date : LIVE && LIVE.fxDate,
    fxSource: fx && fx.rates ? fx.source : LIVE && LIVE.fxSource, at: new Date().toISOString(), ok};
  applyLive(P, LIVE);        // курсы из прошлого удачного запроса лучше, чем выпавшие из итога позиции в других валютах
  await WL.fetchFxAt(P);
};
/* История грузится по одной бумаге: Cboe ограничивает частоту. Неудачу не
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
// Цвет класса актива один на весь отчёт (сводка, «Структура», группы таблицы): --cls-<ключ> в wealth.html.
// Опционы, фьючерсы и незнакомые классы делят нейтральный «прочее».
WL.clsKey = type => ["stock", "fund", "bond", "note", "cash"].includes(type) ? type : "other";
// Курс в доллары. Снимок выписок — по курсу ЕЦБ на дату выписки позиции (p.asOf); оценка сейчас — по текущему.
WL.usd = (P, ccy, p) => {
  if(ccy === "USD") return 1;
  if(P.basis === "stmt"){ const f = p && p.asOf && P.fxAt && P.fxAt[p.asOf]; return f && f.rates[ccy] ? 1 / f.rates[ccy] : null; }
  return P.live && P.live.fx && P.live.fx[ccy] ? 1 / P.live.fx[ccy] : null;
};
WL.current = (P, p) => {
  if(P.basis === "stmt") return {price: p.price, value: p.value, live: false};
  // Без количества новая цена ничего не говорит о стоимости: null × цена дал бы ноль вместо суммы из выписки.
  if(WL.eq(p) && p.live && p.qty != null) return {price: p.live.price, value: round2(p.qty * p.live.price), live: true};
  if(p.type === "option" && p.live && p.multiplier && p.qty != null) return {price: p.live.price, value: round2(p.qty * p.live.price * p.multiplier), live: true};
  return {price: p.price, value: p.value, live: false};
};

WL.PERIODS = [
  {id: "1d", label: t("День", "Day")}, {id: "1m", label: t("Месяц", "Month"), days: 30}, {id: "3m", label: t("Квартал", "Quarter"), days: 91},
  {id: "1y", label: t("Год", "Year"), days: 365}, {id: "5y", label: t("5 лет", "5 years"), days: 1826}, {id: "all", label: t("Вся история", "All time")},
  {id: "stmt", label: t("С даты выписки", "Since statement"), }, {id: "cost", label: t("С покупки", "Since purchase")}];
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
  // Изменение за период — рыночное: в снимке выписок его нет, и считается оно только по подтверждённой бумаге (WL.idOf).
  if(!WL.eq(p) || P.basis === "stmt") return null;
  const sym = WL.quoteSymbol(P, p);
  if(!sym) return null;
  let start = null;
  if(per === "1d") start = p.live && p.live.prevClose ? {price: p.live.prevClose} : null;
  else {
    const h = P.history[sym];
    if(per === "all") start = h && h.length ? {price: h[0][1], date: h[0][0]} : null;
    else start = WL.priceAt(h, ISO(new Date(+D(P.today) - WL.PERIODS.find(x => x.id === per).days * DAY)));
  }
  if(!start) return null;
  return {abs: round2(p.qty * (cur.price - start.price)), pct: (cur.price / start.price - 1) * 100, from: start.date};
};
})();
