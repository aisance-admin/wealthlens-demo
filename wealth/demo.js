/* WealthLens · пример отчёта на вымышленном портфеле: три банка, облигации, фонды, структурная нота, опционы, дирхамы.
   Данные вымышленные и собраны так, как их вернуло бы чтение выписок; даты считаются от сегодняшнего дня, чтобы пример не устаревал.
   В хранилище браузера пример не пишется. */
(function(){
const WL = window.WL, t = WL.t;
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function monthEnd(){ const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 0); }
function thirdFriday(minDays){
  const d = new Date(); d.setDate(d.getDate() + minDays);
  for(let k = 0; k < 4; k++){ const f = new Date(d.getFullYear(), d.getMonth() + k, 1); f.setDate(1 + ((5 - f.getDay() + 7) % 7) + 14); if(f >= d) return f; }
  return d;
}
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

WL.demoState = () => {
  const asOf = iso(monthEnd());
  const row = (o, i, doc) => Object.assign({cls: "other", name: "", isin: "", ticker: "", qty: null, price: null, unit: "", value: null, ccy: "", value_ref: null, accrued: null, cost: null,
    date: "", coupon: null, right: "", strike: null, under: "", acct: "", page: 1, table: "D"}, o, {id: `${doc}:${i + 1}`, doc});
  const docA = {id: "demo-zh", fileId: "demo-zh", file: "Portfolio_Statement_Zurich.pdf", kind: "pdf", pageCount: 14, type: "portfolio", institution: "Demo Private Bank Zürich",
    as_of: asOf, period: "", ref_ccy: "USD", accounts: [{id: "4471-02", label: t("Портфель", "Portfolio"), currency: "USD"}], fx: [{currency: "EUR", rate: 1.1648, page: 2}, {currency: "CHF", rate: 1.2472, page: 2}],
    pages: [], notes: [], failed: [], usage: {in: 0, out: 0}, rows: [
      {cls: "cash", name: "Current account USD", value: 185400.25, ccy: "USD", page: 3},
      {cls: "cash", name: "Current account EUR", value: 62300, ccy: "EUR", value_ref: 72567.04, page: 3},
      {cls: "cash", name: "Current account CHF", value: 18750.4, ccy: "CHF", value_ref: 23385.50, page: 3},
      {cls: "deposit", name: "Fiduciary deposit USD 4.10%", value: 300000, ccy: "USD", accrued: 1742.5, date: iso(plusDays(46)), coupon: 4.1, page: 3},
      {cls: "bond", name: "Apple Inc. 4.30% 10.05.2033", isin: "US037833EW68", qty: 250000, price: 98.04, unit: "%", value: 245100, ccy: "USD", accrued: 2299.31, date: "2033-05-10", coupon: 4.3, cost: 243875, page: 5},
      {cls: "bond", name: "US Treasury 4.25% 15.11.2034", isin: "US91282CLW90", qty: 300000, price: 99.12, unit: "%", value: 297360, ccy: "USD", accrued: 3810.8, date: "2034-11-15", coupon: 4.25, cost: 301500, page: 5},
      {cls: "bond", name: "Nestlé Holdings 1.50% 2028", isin: "XS2169243479", qty: 200000, price: 96.9, unit: "%", value: 193800, ccy: "EUR", value_ref: 225738.24, accrued: 1175.34, date: "2028-04-14", coupon: 1.5, cost: 197000, page: 6},
      {cls: "bond", name: "Novartis Finance 2.00% 2029", isin: "CH1133330015", qty: 150000, price: 100.8, unit: "%", value: 151200, ccy: "CHF", value_ref: 188576.64, accrued: 950, date: "2029-06-22", coupon: 2, page: 6},
      {cls: "etf", name: "iShares Core S&P 500 UCITS ETF", isin: "IE00B5BMR087", ticker: "CSPX", qty: 1200, price: 612.3, value: 734760, ccy: "USD", cost: 598200, page: 7},
      {cls: "etf", name: "Vanguard FTSE All-World UCITS ETF", isin: "IE00BK5BQT80", ticker: "VWRA", qty: 2000, price: 138.4, value: 276800, ccy: "USD", cost: 241000, page: 7},
      {cls: "fund", name: "Global Megatrend Equity Fund P EUR", isin: "LU0386882277", qty: 800, price: 402.1, value: 321680, ccy: "EUR", value_ref: 374692.86, page: 8},
      {cls: "note", name: "Autocallable on EURO STOXX 50, barrier 60%, 2027", isin: "CH1300000017", qty: 200000, price: 97.3, unit: "%", value: 194600, ccy: "USD", date: "2027-11-19", coupon: 7.2, page: 9},
      {cls: "metal", name: "Physical gold, 2 kg", qty: 2, price: 83650, value: 167300, ccy: "USD", page: 10},
    ].map((o, i) => row(o, i, "demo-zh"))};
  const exp1 = iso(thirdFriday(21)), exp2 = iso(thirdFriday(70));
  const docB = {id: "demo-us", fileId: "demo-us", file: "Brokerage_Statement.pdf", kind: "pdf", pageCount: 9, type: "brokerage", institution: "Demo Brokerage US",
    as_of: asOf, period: "", ref_ccy: "USD", accounts: [{id: "...8120", label: t("Брокерский счёт", "Brokerage account"), currency: "USD"}], fx: [], pages: [], notes: [], failed: [], usage: {in: 0, out: 0}, rows: [
      {cls: "stock", name: "NVIDIA Corp", ticker: "NVDA", isin: "US67066G1040", qty: 1500, price: 172.1, value: 258150, ccy: "USD", cost: 96400, page: 2},
      {cls: "stock", name: "Apple Inc", ticker: "AAPL", isin: "US0378331005", qty: 900, price: 232.5, value: 209250, ccy: "USD", cost: 151200, page: 2},
      {cls: "stock", name: "Microsoft Corp", ticker: "MSFT", isin: "US5949181045", qty: 400, price: 505.2, value: 202080, ccy: "USD", cost: 139600, page: 2},
      {cls: "stock", name: "Amazon.com Inc", ticker: "AMZN", isin: "US0231351067", qty: 600, price: 229.8, value: 137880, ccy: "USD", cost: 104100, page: 2},
      {cls: "stock", name: "Alphabet Inc Class A", ticker: "GOOGL", isin: "US02079K3059", qty: 700, price: 208.4, value: 145880, ccy: "USD", cost: 98700, page: 2},
      {cls: "stock", name: "Berkshire Hathaway Class B", ticker: "BRK.B", isin: "US0846707026", qty: 300, price: 490.1, value: 147030, ccy: "USD", cost: 121800, page: 3},
      {cls: "option", name: `NVDA ${exp1} 160 Put`, ticker: "NVDA", qty: -5, price: 3.2, value: -1600, ccy: "USD", date: exp1, right: "P", strike: 160, under: "NVDA", page: 4},
      {cls: "option", name: `AAPL ${exp2} 250 Call`, ticker: "AAPL", qty: 10, price: 4.1, value: 4100, ccy: "USD", date: exp2, right: "C", strike: 250, under: "AAPL", page: 4},
      {cls: "cash", name: "Cash & sweep", value: 42810.55, ccy: "USD", page: 5},
    ].map((o, i) => row(o, i, "demo-us"))};
  const docC = {id: "demo-dxb", fileId: "demo-dxb", file: "Account_Statement_AED.pdf", kind: "pdf", pageCount: 3, type: "bank", institution: "Demo Bank Dubai",
    as_of: asOf, period: "", ref_ccy: "AED", accounts: [{id: "...0917", label: t("Текущий счёт", "Current account"), currency: "AED"}, {id: "...0925", label: t("Срочный депозит", "Time deposit"), currency: "AED"}],
    fx: [], pages: [], notes: [], failed: [], usage: {in: 0, out: 0}, rows: [
      {cls: "cash", name: "Current account AED", value: 1250000, ccy: "AED", acct: "...0917", page: 1},
      {cls: "deposit", name: "Time deposit AED 4.50%", value: 2000000, ccy: "AED", accrued: 22191.78, date: iso(plusDays(152)), coupon: 4.5, acct: "...0925", page: 2},
    ].map((o, i) => row(o, i, "demo-dxb"))};
  const sum = (d, f) => d.rows.reduce((s, r) => s + (r[f] != null ? r[f] : r.value_ref == null && d.ref_ccy === (r.ccy || d.ref_ccy) ? r.value || 0 : 0), 0);
  const refSum = d => d.rows.reduce((s, r) => s + (r.ccy === d.ref_ccy ? r.value : r.value_ref || 0), 0);
  const accr = d => d.rows.reduce((s, r) => s + (r.ccy === d.ref_ccy ? (r.accrued || 0) : r.value && r.value_ref && r.accrued ? r.accrued * r.value_ref / r.value : 0), 0);
  const r2 = v => Math.round(v * 100) / 100;
  docA.totals = [{label: t("Итого портфель, включая НКД", "Total portfolio incl. accrued interest"), scope: "total", account: "", currency: "USD", amount: r2(refSum(docA) + accr(docA)), accrued: "incl", page: 2}];
  docB.totals = [{label: "Total Account Value", scope: "total", account: "", currency: "USD", amount: r2(refSum(docB)), accrued: "unknown", page: 1}];
  docC.totals = [{label: "Closing balance", scope: "account", account: "...0917", currency: "AED", amount: 1250000, accrued: "unknown", page: 1},
    {label: "Deposit principal", scope: "account", account: "...0925", currency: "AED", amount: 2000000, accrued: "excl", page: 2}];
  void sum;
  const files = [docA, docB, docC].map(d => ({id: d.id, name: d.file, size: 0, kind: "pdf", status: "done", done: d.pageCount, total: d.pageCount, hash: d.id}));
  return {v: 2, demo: true, rid: "", client: t("Пример: семья Ивановых", "Sample: the Smith family"), base: "USD", files, docs: [docA, docB, docC], include: {}, review: null, chats: {}, fx: {}};
};

/* Сводка и пояснения к примеру: числа берутся из самой модели, чтобы текст всегда совпадал с таблицами. */
WL.demoReview = M => {
  const f = WL.fmt, money = v => f.money(v, M.base);
  const cat = k => M.byCat.find(c => c.key === k) || {value: 0, share: 0};
  const nvda = M.positions.find(p => p.ticker === "NVDA" && p.cls === "stock"), stocksUS = M.positions.filter(p => p.cls === "stock");
  const aed = M.byCcy.find(c => c.ccy === "AED") || {value: 0, share: 0};
  return {
    summary: t(`Всего ${money(M.total)} в трёх банках: Швейцария, США и Дубай. Больше всего — в фондах и ETF (${f.pct(cat("fund").share, 0)}) и в деньгах с депозитами (${f.pct(cat("cash").share, 0)}); облигаций на ${money(cat("bond").value)}. Главное: акции у американского брокера — шесть крупных технологических компаний, и продан пут на NVIDIA, по которому через несколько недель может понадобиться выкупить бумаги.`,
      `${money(M.total)} in total across three banks: Switzerland, the US and Dubai. The largest parts are funds and ETFs (${f.pct(cat("fund").share, 0)}) and cash with deposits (${f.pct(cat("cash").share, 0)}); bonds come to ${money(cat("bond").value)}. What matters most: the US brokerage account holds six large tech names, and a put on NVIDIA was sold that may require buying the shares within weeks.`),
    alerts: [
      {level: "watch", title: t("Акции США сосредоточены в технологиях", "US stocks are concentrated in tech"),
        text: t(`${stocksUS.length} акций у брокера на ${money(stocksUS.reduce((s, p) => s + (p.vb || 0), 0))}, из них NVIDIA — ${nvda ? money(nvda.vb) : "—"}. Плюс S&P 500 и All-World в фондах тоже во многом состоят из этих же компаний.`,
          `${stocksUS.length} stocks at the broker worth ${money(stocksUS.reduce((s, p) => s + (p.vb || 0), 0))}, NVIDIA alone ${nvda ? money(nvda.vb) : "—"}. The S&P 500 and All-World funds hold largely the same companies.`),
        refs: stocksUS.map(p => p.id)},
      {level: "info", title: t(`Дирхамы — ${f.pct(aed.share, 0)} портфеля`, `Dirhams are ${f.pct(aed.share, 0)} of the portfolio`),
        text: t(`${money(aed.value)} в банке в Дубае: текущий счёт и срочный депозит. Дирхам привязан к доллару (3,6725), поэтому валютный риск здесь небольшой.`,
          `${money(aed.value)} at the Dubai bank: a current account and a time deposit. The dirham is pegged to the dollar (3.6725), so the currency risk is small.`),
        refs: M.positions.filter(p => p.ccy === "AED").map(p => p.id)},
    ],
    documents: [
      {id: "demo-zh", text: t("Портфельная выписка на 14 страниц. Сумма позиций вместе с накопленным купоном совпала с итогом банка.", "A 14-page portfolio statement. Positions plus accrued interest match the bank's total.")},
      {id: "demo-us", text: t("Брокерская выписка: акции, два опциона и деньги. Итог счёта сошёлся.", "A brokerage statement: stocks, two options and cash. The account total matches.")},
      {id: "demo-dxb", text: t("Банковская выписка в дирхамах: остаток на текущем счёте и депозит, оба совпали с выпиской.", "A bank statement in dirhams: the current account balance and a deposit, both match the statement.")},
    ],
    questions: [{text: t("Структурная нота на EURO STOXX 50 — уточните у банка текущий уровень индекса относительно барьера 60%.", "For the EURO STOXX 50 note, ask the bank where the index stands against the 60% barrier."), refs: []}],
    base: M.base, lang: WL.lang, demo: true,
  };
};
})();
