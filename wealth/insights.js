/* Флоу велса · выводы и недостающие данные.
   Каждый вывод опирается на конкретные числа из выписок или котировок и называет
   свою основу. Недостающее выводам не мешает: оно перечисляется отдельно, вместе
   с готовым текстом запроса. */
(function(){
const WL = window.WL = window.WL || {};
const {fmt, days, pl} = WL;
const t = WL.t || ((ru, en) => ru);   // t("русский", "English"): строка на языке интерфейса
const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
const nextDay = s => new Date(+new Date(s + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
const tick = p => String(p.symbol || p.name || "").replace(/\.[A-Z]{2,}$/, "");

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
      const inDays = `${d} ${pl(d, ["день", "дня", "дней"], ["day", "days"])}`, shares = n === 1 ? "share" : "shares";
      const text = t(`${p.underlying} ${p.right === "C" ? "колл" : "пут"} ${K} · ${fmt.date(p.expiry)}, через ${inDays}`,
                     `${p.underlying} ${K} ${p.right === "C" ? "call" : "put"} · ${fmt.date(p.expiry)}, ${d === 0 ? "expires today" : "in " + inDays}`);
      if(u == null) return {text, note: t("текущей цены базового актива нет", "no current price for the underlying")};
      const itm = p.right === "C" ? u > K : u < K;
      if(itm) itmAny = true;
      const held = P.positions.some(s => WL.eq(s) && s.symbol === p.underlying && s.brokerShort === p.brokerShort);
      let note = t(`${p.underlying} сейчас ${fmt.px(u)}, опцион ${itm ? "в деньгах" : "вне денег"}`,
                   `${p.underlying} now at ${fmt.px(u)}, ${itm ? "in the money" : "out of the money"}`);
      if(p.qty < 0 && p.right === "C") note += itm
        ? (held ? t(` — ${fmt.int(n)} акций, скорее всего, заберут по ${K}`, ` — ${fmt.int(n)} ${shares} likely to be called away at ${K}`)
                : t(` — возможна поставка ${fmt.int(n)} акций`, ` — may require delivering ${fmt.int(n)} ${shares}`))
        : t(` — скорее всего, истечёт без исполнения${held ? ", акции останутся" : ""}`, ` — likely to expire unexercised${held ? ", leaving the shares in place" : ""}`);
      if(p.qty < 0 && p.right === "P") note += itm
        ? t(` — придётся купить ${fmt.int(n)} акций на ${fmt.short(n * K)}`, ` — would require buying ${fmt.int(n)} ${shares} for ${fmt.short(n * K)}`)
        : t(" — скорее всего, истечёт без исполнения", " — likely to expire unexercised");
      return {text, note, level: itm ? "high" : "watch"};
    });
    out.push({level: itmAny ? "high" : "watch", kind: "expiry", lines,
      title: `${soon.length} ${pl(soon.length, ["опцион истекает", "опциона истекают", "опционов истекают"], ["option expires", "options expire"])} ${t("в ближайшие 45 дней", "in the next 45 days")}`,
      basis: t(`выписка · текущие цены CBOE с задержкой`, "statement · delayed CBOE prices")});
  }

  // 2. Обязательства по проданным путам против денег у того же брокера.
  snapshots.forEach(d => {
    const mine = P.positions.filter(p => p.source === d.fileName);
    const puts = mine.filter(p => p.type === "option" && p.right === "P" && p.qty < 0);
    if(!puts.length) return;
    const obl = sum(puts, p => Math.abs(p.qty) * p.multiplier * p.strike);
    const cash = sum(mine.filter(p => p.type === "cash"), p => p.value);
    const mv = sum(puts, p => WL.current(P, p).value);
    const nPuts = `${puts.length} ${pl(puts.length, ["позиция", "позиции", "позиций"], ["position", "positions"])}`;
    out.push({level: obl > cash ? "high" : "watch", kind: "obligation",
      title: t(`${puts.length === 1 ? "Проданный пут обязывает" : "Проданные путы обязывают"} купить акций на ${fmt.short(obl)}`,
               `${puts.length === 1 ? "Short put obligates" : "Short puts obligate"} the account to buy ${fmt.short(obl)} of stock`),
      text: `${cash > 0 && obl > cash ? t(`Это в ${fmt.dec(obl / cash)} раза больше денег на счёте ${d.brokerShort} (${fmt.short(cash)}). `,
                            `That is ${fmt.dec(obl / cash)} times the cash in the ${d.brokerShort} account (${fmt.short(cash)}). `)
            : cash > 0 ? t(`Это ${Math.round(obl / cash * 100)}% денег на счёте ${d.brokerShort} (${fmt.short(cash)}). `,
                           `That is ${Math.round(obl / cash * 100)}% of the cash in the ${d.brokerShort} account (${fmt.short(cash)}). `) : ""}` +
            (puts.length === 1 ? t(`В стоимости портфеля эта позиция видна всего как ${fmt.short(mv)}.`, `In the portfolio value this position shows up as just ${fmt.short(mv)}.`)
              : t(`В стоимости портфеля эти ${nPuts} видны всего как ${fmt.short(mv)}.`, `In the portfolio value these ${nPuts} show up as just ${fmt.short(mv)}.`)),
      basis: t(`выписка ${d.brokerShort} на ${fmt.date(d.asOf)}`, `${d.brokerShort} statement as of ${fmt.date(d.asOf)}`)});
  });

  // 3. Концентрация — по всему портфелю в долларах. Смысл сводного отчёта в том, чтобы видеть
  // риск целиком: доля бумаги в одном счёте ничего не говорит, если у клиента четыре брокера.
  // Считаем одиночные акции и структурные ноты: фонд и госбумага сами по себе не концентрация.
  // Валюты пересчитываются по курсу ЕЦБ; без курса позиция в доли не входит.
  const usdOf = p => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy); return v != null && k != null ? v * k : null; };
  const assets = P.positions.filter(p => p.type !== "option" && p.type !== "future")
    .map(p => ({p, v: usdOf(p)})).filter(x => x.v != null && x.v > 0);
  const totalUsd = sum(assets, x => x.v);
  const single = assets.filter(x => ["stock", "note", "other"].includes(x.p.type)).sort((a, b) => b.v - a.v);
  if(single.length && totalUsd > 0){
    const top = single[0], share = top.v / totalUsd * 100, top3 = sum(single.slice(0, 3), x => x.v) / totalUsd * 100;
    const where = [...new Set(P.positions.filter(p => (p.symbol || p.name) === (top.p.symbol || top.p.name)).map(p => p.brokerShort))];
    const big3 = single.slice(0, 3).map(x => tick(x.p)).join(", ");
    if(share >= 10) out.push({level: share >= 25 ? "watch" : "info", kind: "concentration",
      title: t(`${top.p.name} — ${Math.round(share)}% всего портфеля`, `${top.p.name} is ${Math.round(share)}% of the whole portfolio`),
      text: t(`Держится у ${where.join(", ")}.`, `Held at ${where.join(", ")}.`) + (single.length >= 3
              ? t(` Три крупнейшие позиции (${big3}) — ${Math.round(top3)}% стоимости портфеля в долларах.`,
                  ` The three largest positions (${big3}) are ${Math.round(top3)}% of the portfolio value in dollars.`) : "") +
            (top.p.costNote ? t(` Себестоимость ${top.p.symbol || top.p.name} ${top.p.costNote}: результат по крупнейшей позиции посчитать нельзя.`,
                                ` Cost basis for ${top.p.symbol || top.p.name}: ${top.p.costNote}. The result for the largest position cannot be calculated.`) : ""),
      basis: t(`все счета${P.live && P.live.fx ? " · курсы ЕЦБ" : ""}`, `all accounts${P.live && P.live.fx ? " · ECB rates" : ""}`)});
  }

  // 4. Что изменилось с даты выписки.
  const live = P.positions.filter(p => (WL.eq(p) || p.type === "option") && p.live && p.value != null);
  if(live.length){
    const delta = sum(live, p => WL.current(P, p).value - p.value);
    const movers = live.filter(p => WL.eq(p)).map(p => ({p, pct: (p.live.price / p.price - 1) * 100}))
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 3);
    const from = live[0].priceDate;
    const moved = movers.map(m => `${m.p.symbol} ${fmt.pct(m.pct)}`).join(", ");
    out.push({level: Math.abs(delta) >= 250000 ? "watch" : "info", kind: "since",
      title: t(`С ${fmt.date(from)} позиции ${delta < 0 ? "подешевели" : "подорожали"} на ${fmt.short(Math.abs(delta))}`,
               `Since ${fmt.date(from)}, positions are ${delta < 0 ? "down" : "up"} ${fmt.short(Math.abs(delta))}`),
      text: t(`Сильнее всего изменились ${moved}. В выписке цены на ${fmt.date(from)}, здесь — текущие.`,
              `Largest moves: ${moved}. The statement has prices as of ${fmt.date(from)}; the figures here use current prices.`),
      basis: t("выписка · текущие цены CBOE с задержкой", "statement · delayed CBOE prices")});
  }

  // 5. Результат к себестоимости: лучшая и худшая бумага. Считается так же, как колонка
  // «Изменение с покупки» в таблице: по текущим ценам, если они есть, иначе по ценам выписки.
  // Иначе вывод и таблица показывали бы для одной бумаги два разных результата.
  // Сравниваем в долларах: результат по франковой бумаге в франках рядом с долларовым —
  // несопоставимые числа, а подпись со знаком доллара была бы неправдой.
  const withCost = P.positions.filter(p => WL.eq(p) && p.cost > 0)
    .map(p => { const c = WL.change(P, p, "cost"), k = WL.usd(P, p.ccy); return c && k != null ? {p, c, usd: c.abs * k} : null; })
    .filter(Boolean);
  if(withCost.length >= 2){
    const s = [...withCost].sort((a, b) => b.usd - a.usd), best = s[0], worst = s[s.length - 1];
    const isLive = withCost.some(x => x.p.live);
    // Бумаги из PDF банка часто без тикера — тогда по названию; длинный список обрезаем.
    const noCostAll = P.positions.filter(p => WL.eq(p) && p.cost == null).map(p => p.symbol || p.name);
    const noCost = noCostAll.length > 5 ? [...noCostAll.slice(0, 4), t(`ещё ${noCostAll.length - 4}`, `${noCostAll.length - 4} more`)] : noCostAll;
    out.push({level: "info", kind: "pnl",
      title: t(`Лучший результат к покупке — ${tick(best.p)} ${fmt.signed(best.usd)}, худший — ${tick(worst.p)} ${fmt.signed(worst.usd)}`,
               `Best result vs cost: ${tick(best.p)} ${fmt.signed(best.usd)}; worst: ${tick(worst.p)} ${fmt.signed(worst.usd)}`),
      text: t(`${best.p.name} ${fmt.pct(best.c.pct, 0)}, ${worst.p.name} ${fmt.pct(worst.c.pct, 0)} к средней цене покупки${isLive ? ", по текущим ценам" : ""}.`,
              `${best.p.name} ${fmt.pct(best.c.pct, 0)}, ${worst.p.name} ${fmt.pct(worst.c.pct, 0)} vs average cost${isLive ? ", at current prices" : ""}.`) +
            (noCost.length ? t(` Без себестоимости в выписке: ${noCost.join(", ")}.`, ` No cost basis in the statement: ${noCost.join(", ")}.`) : ""),
      basis: isLive ? t(`выписка ${best.p.brokerShort} · текущие цены CBOE с задержкой`, `${best.p.brokerShort} statement · delayed CBOE prices`)
                    : t(`выписка ${best.p.brokerShort} на ${fmt.date(best.p.priceDate)}`, `${best.p.brokerShort} statement as of ${fmt.date(best.p.priceDate)}`)});
  }

  // 6. Журналы: состояние на дату выписки и результат за период.
  ledgers.forEach(d => {
    const mine = P.positions.filter(p => p.source === d.fileName);
    const derivs = mine.filter(p => p.type === "future" || p.type === "option");
    const notional = sum(mine.filter(p => p.type === "future"), p => Math.abs(p.notional || 0));
    const cashUSD = sum(mine.filter(p => p.type === "cash"), p => p.value * (WL.usd(P, p.ccy) ?? 0));
    const age = Math.round(days(d.asOf, T) / 30.44);
    const expired = derivs.filter(p => p.expiry && p.expiry < T).length;
    const ago = `${age} ${pl(age, ["месяц", "месяца", "месяцев"], ["month", "months"])}`;
    out.push({level: "watch", kind: "stale",
      title: t(`${d.brokerShort}: данные на ${fmt.date(d.asOf)}, ${ago} назад`, `${d.brokerShort}: data as of ${fmt.date(d.asOf)}, ${ago} ago`),
      text: (notional && cashUSD ? t(`На ту дату открыты фьючерсы на казначейские облигации США номиналом ${fmt.short(notional)} при ${fmt.short(cashUSD)} денег на счёте — в ${fmt.dec(notional / cashUSD)} раза больше. `,
                                     `On that date, open US Treasury futures had a notional value of ${fmt.short(notional)} against ${fmt.short(cashUSD)} of cash in the account — ${fmt.dec(notional / cashUSD)} times as much. `) : "") +
            (expired ? t(`${expired === derivs.length ? "Все " : ""}${expired} ${pl(expired, ["контракт", "контракта", "контрактов"], ["contract", "contracts"])} с тех пор ${expired === 1 ? "истёк" : "истекли"}; что открыто сейчас, из этой выписки не узнать.`,
                         `${expired !== derivs.length ? `${expired} ${expired === 1 ? "contract has" : "contracts have"}` : expired === 1 ? "The contract has" : `All ${expired} contracts have`} since expired; this statement does not show what is open now.`) : ""),
      basis: t(`журнал ${d.brokerShort} за ${fmt.date(d.periodFrom)}–${fmt.date(d.asOf)}`, `${d.brokerShort} ledger for ${fmt.date(d.periodFrom)} – ${fmt.date(d.asOf)}`)});
    const f = (P.flows[d.brokerShort] || {}).USD;
    if(f){
      const result = sum(Object.entries(f).filter(([k]) => k !== "deposits"), ([, v]) => v);
      out.push({level: result < 0 ? "watch" : "info", kind: "period",
        title: t(`${d.brokerShort} за период выписки: результат операций ${fmt.signed(result)}`, `${d.brokerShort} over the statement period: net result ${fmt.signed(result)}`),
        text: t(`Зачислено ${fmt.short(f.deposits || 0)}, в результат это не входит. Вариационная маржа ${fmt.signed(f.vm || 0)}, ` +
                `премии по опционам ${fmt.signed((f.premiumIn || 0) + (f.premiumOut || 0))} нетто, комиссии и биржевые сборы ${fmt.signed((f.commission || 0) + (f.fees || 0))}.`,
                `Deposits of ${fmt.short(f.deposits || 0)} are not included in the result. Variation margin ${fmt.signed(f.vm || 0)}, ` +
                `option premiums ${fmt.signed((f.premiumIn || 0) + (f.premiumOut || 0))} net, commissions and exchange fees ${fmt.signed((f.commission || 0) + (f.fees || 0))}.`),
        basis: t(`журнал ${d.brokerShort}, счёт в долларах`, `${d.brokerShort} ledger, USD account`)});
    }
  });

  // 7. Вывод денег с начала года.
  snapshots.forEach(d => {
    const w = d.summary && d.summary.withdrawals && d.summary.withdrawals.ytd;
    if(w) out.push({level: "info", kind: "flows",
      title: t(`С начала года со счёта ${d.brokerShort} выведено ${fmt.short(Math.abs(w))}`, `Year to date, ${fmt.short(Math.abs(w))} has been withdrawn from the ${d.brokerShort} account`),
      text: t("Счёт уменьшился из-за вывода денег, а не из-за рынка: в результат за год вывод не входит.",
              "The account shrank because money was withdrawn, not because of the market; withdrawals are excluded from the year-to-date result."),
      basis: t(`выписка ${d.brokerShort} на ${fmt.date(d.asOf)}`, `${d.brokerShort} statement as of ${fmt.date(d.asOf)}`)});
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
    M.push({broker: d.brokerShort, title: t("Даты и цены покупки по лотам", "Purchase dates and prices by lot"),
      affects: t("«Цена покупки», «Дата покупки», период «С покупки»", "purchase price, purchase date, the “Since purchase” period") +
               (noCost.length ? t(`; себестоимость ${noCost.map(p => `${p.symbol || p.name} ${p.costNote}`).join(", ")}`, `; cost basis: ${noCost.map(p => `${p.symbol || p.name} (${p.costNote})`).join(", ")}`) : ""),
      now: t("цена покупки — средняя из себестоимости, дата — «нет в выписке»", "purchase price is the average from the cost basis; the date is “not in statement”"),
      ask: t(`${d.broker}: отчёт о прибыли и убытках с разбивкой по лотам (Realized/Unrealized Gain/Loss, lot details) или история сделок с датами и ценами покупки.`,
             `${d.broker}: a gain and loss report broken down by lot (Realized/Unrealized Gain/Loss, lot details) or a trade history with purchase dates and prices.`)});
  });
  P.docs.filter(d => d.kind === "ledger").forEach(d => {
    M.push({broker: d.brokerShort, title: t(`Позиции на сегодня и журнал после ${fmt.date(d.asOf)}`, `Current positions and the ledger after ${fmt.date(d.asOf)}`),
      affects: t("всё по этому счёту на сегодня: позиции, стоимость, сроки", "everything in this account as of today: positions, value, key dates"),
      now: t(`счёт показан на ${fmt.date(d.asOf)}`, `the account is shown as of ${fmt.date(d.asOf)}`),
      ask: t(`${d.broker}: отчёт о позициях на текущую дату (positions statement) и выписки по счёту с ${fmt.date(nextDay(d.asOf))} по сегодня.`,
             `${d.broker}: a positions statement as of today and account statements from ${fmt.date(nextDay(d.asOf))} to date.`)});
    M.push({broker: d.brokerShort, title: t("Текущие цены фьючерсов и опционов CME", "Current prices for CME futures and options"),
      affects: t("текущая цена и изменение по деривативам счёта", "current price and change for the account’s derivatives"),
      now: t("цены на дату выписки — расчётные из вариационной маржи", "prices as of the statement date, derived from variation margin"),
      ask: t("Нужен поставщик рыночных данных с лицензией CME: бесплатного источника нет.", "Requires a market data provider with a CME license; there is no free source."), noRequest: true});
  });
  if(P.positions.some(p => p.type === "option" && p.occ))
    M.push({broker: t("Рынок", "Market"), title: t("История цен опционов", "Option price history"),
      affects: t("изменение опционов за месяц, квартал и год", "option price changes over a month, quarter and year"),
      now: t("по опционам доступны периоды «С даты выписки» и «С покупки»", "for options, only the “Since statement” and “Since purchase” periods are available"),
      ask: t("Бесплатного источника истории опционов нет.", "There is no free source of option price history."), noRequest: true});
  return M;
};

WL.requestText = M => t("Добрый день!\n\nДля полного анализа портфеля пришлите, пожалуйста:\n", "Hello,\n\nFor a full portfolio analysis, please send:\n") +
  M.filter(m => !m.noRequest).map((m, i) => `${i + 1}. ${m.ask}`).join("\n") +
  t("\n\nЕсли брокер даёт выгрузку в CSV или Excel, она подойдёт даже лучше PDF.\n\nСпасибо!", "\n\nIf the broker offers a CSV or Excel export, that works even better than PDF.\n\nThank you!");
})();
