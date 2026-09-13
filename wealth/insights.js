/* Флоу велса · выводы и недостающие данные.
   Каждый вывод опирается на конкретные числа из выписок или котировок и называет
   свою основу. Недостающее выводам не мешает: оно перечисляется отдельно, вместе
   с готовым текстом запроса. */
(function(){
const WL = window.WL = window.WL || {};
const {fmt, days, plural} = WL;
const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
const nextDay = s => new Date(+new Date(s + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
const times = v => v.toFixed(1).replace(".", ",");

WL.insights = function(P){
  const out = [], T = P.today;
  const snapshots = P.docs.filter(d => d.kind === "positions");
  const ledgers = P.docs.filter(d => d.kind === "ledger");

  // 1. Ближайшие экспирации — со статусом по текущей цене базового актива.
  const soon = P.positions.filter(p => p.type === "option" && p.expiry >= T && days(T, p.expiry) <= 45)
    .sort((a, b) => a.expiry < b.expiry ? -1 : 1);
  if(soon.length){
    let itmAny = false;
    const lines = soon.map(p => {
      const u = p.underlyingLive, K = p.strike, n = Math.abs(p.qty) * (p.multiplier || 100), d = days(T, p.expiry);
      const text = `${p.underlying} ${p.right === "C" ? "колл" : "пут"} ${K} · ${fmt.date(p.expiry)}, через ${d} ${plural(d, "день", "дня", "дней")}`;
      if(u == null) return {text, note: "текущей цены базового актива нет"};
      const itm = p.right === "C" ? u > K : u < K;
      if(itm) itmAny = true;
      const held = P.positions.some(s => WL.eq(s) && s.symbol === p.underlying && s.brokerShort === p.brokerShort);
      let note = `${p.underlying} сейчас ${fmt.px(u)}, опцион ${itm ? "в деньгах" : "вне денег"}`;
      if(p.qty < 0 && p.right === "C") note += itm
        ? (held ? ` — ${fmt.int(n)} акций, скорее всего, заберут по ${K}` : ` — возможна поставка ${fmt.int(n)} акций`)
        : ` — скорее всего, истечёт без исполнения${held ? ", акции останутся" : ""}`;
      if(p.qty < 0 && p.right === "P") note += itm
        ? ` — придётся купить ${fmt.int(n)} акций на ${fmt.short(n * K)}` : " — скорее всего, истечёт без исполнения";
      return {text, note, level: itm ? "high" : "watch"};
    });
    out.push({level: itmAny ? "high" : "watch", kind: "expiry", lines,
      title: `${soon.length} ${plural(soon.length, "опцион истекает", "опциона истекают", "опционов истекают")} в ближайшие 45 дней`,
      basis: `выписка · текущие цены CBOE с задержкой`});
  }

  // 2. Обязательства по проданным путам против денег у того же брокера.
  snapshots.forEach(d => {
    const mine = P.positions.filter(p => p.source === d.fileName);
    const puts = mine.filter(p => p.type === "option" && p.right === "P" && p.qty < 0);
    if(!puts.length) return;
    const obl = sum(puts, p => Math.abs(p.qty) * p.multiplier * p.strike);
    const cash = sum(mine.filter(p => p.type === "cash"), p => p.value);
    const mv = sum(puts, p => WL.current(P, p).value);
    out.push({level: obl > cash ? "high" : "watch", kind: "obligation",
      title: `Проданные путы обязывают купить акций на ${fmt.short(obl)}`,
      text: `${cash > 0 ? `Это в ${times(obl / cash)} раза больше денег на счёте ${d.brokerShort} (${fmt.short(cash)}). ` : ""}` +
            `В стоимости портфеля эти ${puts.length} ${plural(puts.length, "позиция", "позиции", "позиций")} видны всего как ${fmt.short(mv)}.`,
      basis: `выписка ${d.brokerShort} на ${fmt.date(d.asOf)}`});
  });

  // 3. Концентрация.
  snapshots.forEach(d => {
    const mine = P.positions.filter(p => p.source === d.fileName);
    const total = sum(mine, p => WL.current(P, p).value);
    const stocks = mine.filter(p => WL.eq(p)).map(p => ({p, v: WL.current(P, p).value})).sort((a, b) => b.v - a.v);
    if(!stocks.length || total <= 0) return;
    const top = stocks[0], share = top.v / total * 100, top3 = sum(stocks.slice(0, 3), x => x.v) / total * 100;
    if(share < 15) return;
    out.push({level: share >= 25 ? "watch" : "info", kind: "concentration",
      title: `${top.p.name} — ${Math.round(share)}% счёта ${d.brokerShort}`,
      text: `Три крупнейшие бумаги (${stocks.slice(0, 3).map(x => x.p.symbol).join(", ")}) — ${Math.round(top3)}% стоимости счёта.` +
            (top.p.costNote ? ` Себестоимость ${top.p.symbol} ${top.p.costNote}: результат по крупнейшей позиции посчитать нельзя.` : ""),
      basis: P.live ? "текущие цены CBOE" : `выписка ${d.brokerShort} на ${fmt.date(d.asOf)}`});
  });

  // 4. Что изменилось с даты выписки.
  const live = P.positions.filter(p => (WL.eq(p) || p.type === "option") && p.live && p.value != null);
  if(live.length){
    const delta = sum(live, p => WL.current(P, p).value - p.value);
    const movers = live.filter(p => WL.eq(p)).map(p => ({p, pct: (p.live.price / p.price - 1) * 100}))
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 3);
    const from = live[0].priceDate;
    out.push({level: Math.abs(delta) >= 250000 ? "watch" : "info", kind: "since",
      title: `С ${fmt.date(from)} позиции ${delta < 0 ? "подешевели" : "подорожали"} на ${fmt.short(Math.abs(delta))}`,
      text: `Сильнее всего изменились ${movers.map(m => `${m.p.symbol} ${fmt.pct(m.pct)}`).join(", ")}. В выписке цены на ${fmt.date(from)}, здесь — текущие.`,
      basis: "выписка · текущие цены CBOE с задержкой"});
  }

  // 5. Результат к себестоимости: лучшая и худшая бумага. Считается так же, как колонка
  // «Изменение с покупки» в таблице: по текущим ценам, если они есть, иначе по ценам выписки.
  // Иначе вывод и таблица показывали бы для одной бумаги два разных результата.
  const withCost = P.positions.filter(p => WL.eq(p) && p.cost > 0)
    .map(p => ({p, c: WL.change(P, p, "cost")})).filter(x => x.c);
  if(withCost.length >= 2){
    const s = [...withCost].sort((a, b) => b.c.abs - a.c.abs), best = s[0], worst = s[s.length - 1];
    const isLive = withCost.some(x => x.p.live);
    const noCost = P.positions.filter(p => WL.eq(p) && p.cost == null).map(p => p.symbol);
    out.push({level: "info", kind: "pnl",
      title: `Лучший результат к покупке — ${best.p.symbol} ${fmt.signed(best.c.abs)}, худший — ${worst.p.symbol} ${fmt.signed(worst.c.abs)}`,
      text: `${best.p.name} ${fmt.pct(best.c.pct, 0)}, ${worst.p.name} ${fmt.pct(worst.c.pct, 0)} к средней цене покупки${isLive ? ", по текущим ценам" : ""}.` +
            (noCost.length ? ` Без себестоимости в выписке: ${noCost.join(", ")}.` : ""),
      basis: isLive ? `выписка ${best.p.brokerShort} · текущие цены CBOE с задержкой` : `выписка ${best.p.brokerShort} на ${fmt.date(best.p.priceDate)}`});
  }

  // 6. Журналы: состояние на дату выписки и результат за период.
  ledgers.forEach(d => {
    const mine = P.positions.filter(p => p.source === d.fileName);
    const derivs = mine.filter(p => p.type === "future" || p.type === "option");
    const notional = sum(mine.filter(p => p.type === "future"), p => Math.abs(p.notional || 0));
    const cashUSD = sum(mine.filter(p => p.type === "cash"), p => p.value * (WL.usd(P, p.ccy) ?? 0));
    const age = Math.round(days(d.asOf, T) / 30.44);
    const expired = derivs.filter(p => p.expiry && p.expiry < T).length;
    out.push({level: "watch", kind: "stale",
      title: `${d.brokerShort}: данные на ${fmt.date(d.asOf)}, ${age} ${plural(age, "месяц", "месяца", "месяцев")} назад`,
      text: (notional && cashUSD ? `На ту дату открыты фьючерсы на казначейские облигации США номиналом ${fmt.short(notional)} при ${fmt.short(cashUSD)} денег на счёте — в ${times(notional / cashUSD)} раза больше. ` : "") +
            (expired ? `${expired === derivs.length ? "Все " : ""}${expired} ${plural(expired, "контракт", "контракта", "контрактов")} с тех пор ${expired === 1 ? "истёк" : "истекли"}; что открыто сейчас, из этой выписки не узнать.` : ""),
      basis: `журнал ${d.brokerShort} за ${fmt.date(d.periodFrom)}–${fmt.date(d.asOf)}`});
    const f = (P.flows[d.brokerShort] || {}).USD;
    if(f){
      const result = sum(Object.entries(f).filter(([k]) => k !== "deposits"), ([, v]) => v);
      out.push({level: result < 0 ? "watch" : "info", kind: "period",
        title: `${d.brokerShort} за период выписки: результат операций ${fmt.signed(result)}`,
        text: `Зачислено ${fmt.short(f.deposits || 0)}, в результат это не входит. Вариационная маржа ${fmt.signed(f.vm || 0)}, ` +
              `премии по опционам ${fmt.signed((f.premiumIn || 0) + (f.premiumOut || 0))} нетто, комиссии и биржевые сборы ${fmt.signed((f.commission || 0) + (f.fees || 0))}.`,
        basis: `журнал ${d.brokerShort}, счёт в долларах`});
    }
  });

  // 7. Вывод денег с начала года.
  snapshots.forEach(d => {
    const w = d.summary && d.summary.withdrawals && d.summary.withdrawals.ytd;
    if(w) out.push({level: "info", kind: "flows",
      title: `С начала года со счёта ${d.brokerShort} выведено ${fmt.short(Math.abs(w))}`,
      text: "Счёт уменьшился из-за вывода денег, а не из-за рынка: в результат за год вывод не входит.",
      basis: `выписка ${d.brokerShort} на ${fmt.date(d.asOf)}`});
  });

  // «тыс.» в конце фразы не должно давать двойную точку.
  out.forEach(x => { if(x.text) x.text = x.text.replace(/\.\.(?=\s|$)/g, "."); });
  const rank = {high: 0, watch: 1, info: 2};
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
};

WL.missing = function(P){
  const M = [];
  P.docs.filter(d => d.kind === "positions").forEach(d => {
    const noCost = P.positions.filter(p => p.source === d.fileName && WL.eq(p) && p.cost == null);
    M.push({broker: d.brokerShort, title: "Даты и цены покупки по лотам",
      affects: "«Цена покупки», «Дата покупки», период «С покупки»" +
               (noCost.length ? `; себестоимость ${noCost.map(p => `${p.symbol} ${p.costNote}`).join(", ")}` : ""),
      now: "цена покупки — средняя из себестоимости, дата — «нет в выписке»",
      ask: `${d.broker}: отчёт о прибыли и убытках с разбивкой по лотам (Realized/Unrealized Gain/Loss, lot details) или история сделок с датами и ценами покупки.`});
  });
  P.docs.filter(d => d.kind === "ledger").forEach(d => {
    M.push({broker: d.brokerShort, title: `Позиции на сегодня и журнал после ${fmt.date(d.asOf)}`,
      affects: "всё по этому счёту на сегодня: позиции, стоимость, сроки",
      now: `счёт показан на ${fmt.date(d.asOf)}`,
      ask: `${d.broker}: отчёт о позициях на текущую дату (positions statement) и выписки по счёту с ${fmt.date(nextDay(d.asOf))} по сегодня.`});
    M.push({broker: d.brokerShort, title: "Текущие цены фьючерсов и опционов CME",
      affects: "текущая цена и изменение по деривативам счёта",
      now: "цены на дату выписки — расчётные из вариационной маржи",
      ask: "Нужен поставщик рыночных данных с лицензией CME: бесплатного источника нет.", noRequest: true});
  });
  if(P.positions.some(p => p.type === "option" && p.occ))
    M.push({broker: "Рынок", title: "История цен опционов",
      affects: "изменение опционов за месяц, квартал и год",
      now: "по опционам доступны периоды «С даты выписки» и «С покупки»",
      ask: "Бесплатного источника истории опционов нет.", noRequest: true});
  return M;
};

WL.requestText = M => "Добрый день!\n\nДля полного анализа портфеля пришлите, пожалуйста:\n" +
  M.filter(m => !m.noRequest).map((m, i) => `${i + 1}. ${m.ask}`).join("\n") +
  "\n\nЕсли брокер даёт выгрузку в CSV или Excel, она подойдёт даже лучше PDF.\n\nСпасибо!";
})();
