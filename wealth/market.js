/* Флоу велса · рынок и новости — пятый пункт Саши.
   Блок информационный: в расчётах и выводах по клиенту не участвует.
   Индексы, ставки и VIX — CBOE с задержкой; валюты, золото, нефть и биткоин — лента
   TradingView в отдельном окне с чужого домена, поэтому её код не выполняется на
   странице с данными клиента. Новости — RSS деловых изданий и Google News по бумагам
   клиента: наружу уходят только тикеры и названия компаний. */
(function(){
const WL = window.WL;
const {fmt, esc} = WL;
const QUOTES = [
  {sym: "_SPX", label: "S&P 500"}, {sym: "_NDX", label: "Nasdaq 100"}, {sym: "_RUT", label: "Russell 2000"},
  {sym: "_VIX", label: "VIX", vol: true},
  {sym: "_IRX", label: WL.t("UST 3 мес.", "US 3-month yield"), yld: true}, {sym: "_FVX", label: WL.t("UST 5 лет", "US 5-year yield"), yld: true},
  {sym: "_TNX", label: WL.t("UST 10 лет", "US 10-year yield"), yld: true}, {sym: "_TYX", label: WL.t("UST 30 лет", "US 30-year yield"), yld: true},
  // Сырьё и крипто — через биржевые фонды: у них есть котировки CBOE, и в отличие от ленты
  // TradingView они попадают в печатный отчёт.
  {sym: "GLD", label: WL.t("Золото · фонд GLD", "Gold · GLD ETF")}, {sym: "BNO", label: WL.t("Brent · фонд BNO", "Brent crude · BNO ETF")},
  {sym: "IBIT", label: WL.t("Биткоин · фонд IBIT", "Bitcoin · IBIT ETF")}];
const FXQ = [{ccy: "EUR", label: "EUR/USD", inv: true}, {ccy: "CHF", label: "USD/CHF"}, {ccy: "GBP", label: "GBP/USD", inv: true}];
const TAPE = [
  {proName: "FX_IDC:EURUSD", title: "EUR/USD"}, {proName: "FX_IDC:USDCHF", title: "USD/CHF"},
  {proName: "FX_IDC:GBPUSD", title: "GBP/USD"}, {proName: "OANDA:XAUUSD", title: WL.t("Золото", "Gold")},
  {proName: "TVC:UKOIL", title: "Brent"}, {proName: "BITSTAMP:BTCUSD", title: WL.t("Биткоин", "Bitcoin")}];
// В английском интерфейсе лента рынка по умолчанию — англоязычные источники.
const M = {quotes: null, quotesAt: null, quotesFailed: false, fx: null, fxDate: null, market: null, holdings: null,
  lang: WL.lang === "en" ? "en" : "all", tick: "all", showAllMarket: false};
let timer = null;

const getJSON = (u, ms = 120000) => WL.getJSON(u, ms);
const ago = iso => {
  if(!iso) return "";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if(m < 1) return WL.t("только что", "just now");
  if(m < 60) return WL.t(`${m} мин назад`, `${m} min ago`);
  const h = Math.round(m / 60);
  if(h < 24) return WL.t(`${h} ч назад`, `${h} ${h === 1 ? "hour" : "hours"} ago`);
  const d = Math.round(h / 24);
  return d === 1 ? WL.t("вчера", "yesterday") : `${d} ${WL.pl(d, ["день", "дня", "дней"], ["day", "days"])} ${WL.t("назад", "ago")}`;
};
// Дата по местному времени в виде 2026-09-16 — для WL.fmt.date.
const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const safeLink = u => /^https?:\/\//i.test(u || "") ? u : "#";
// Названия русских изданий в английском интерфейсе; для сопоставления и группировки берётся исходное имя.
const SOURCE_EN = {"Ведомости": "Vedomosti", "Коммерсантъ": "Kommersant"};
const srcName = s => WL.t(s, SOURCE_EN[s] || s);

/* Релевантность новостей по бумаге. Заголовок засчитывается, только если в нём есть
   биржевое обозначение — (CAT), NYSE:CAT, $CAT — или название компании. Одинокий тикер
   не в счёт: короткие тикеры совпадают с обычными словами (CAT, ALL, NOW, FAST). */
const GENERIC = new Set(("corp corporation inc incorporated ltd limited plc group holdings holding company sa nv ag se lp llc " +
  "technologies technology tech systems resh research class ordinary shares sponsored adr reps the and " +
  "aerospace freight interactive communicatio communications international global industries financial capital trust " +
  "energy bank ishr ishares fund brasileiro").split(" "));
/* Как компанию называют в заголовках, если это не следует из названия в выписке: брокеры
   сокращают названия, а бренд часто не совпадает с юридическим лицом. Слова, которые легко
   спутать с обычными («ups», «visa»), сюда не входят. */
const ALIAS = {
  AAPL: ["apple"], MSFT: ["microsoft"], NVDA: ["nvidia"], AMZN: ["amazon"], GOOGL: ["alphabet", "google"], GOOG: ["alphabet", "google"],
  META: ["meta platforms", "meta", "facebook"], TSLA: ["tesla"], AVGO: ["broadcom"], NFLX: ["netflix"], ORCL: ["oracle"],
  CRM: ["salesforce"], ADBE: ["adobe"], AMD: ["advanced micro devices", "amd"], INTC: ["intel"], TSM: ["tsmc", "taiwan semiconductor"],
  ASML: ["asml"], PLTR: ["palantir"], UBER: ["uber"], ABNB: ["airbnb"], BABA: ["alibaba"], PDD: ["pdd holdings", "temu"],
  "BRK.B": ["berkshire"], JPM: ["jpmorgan", "jp morgan"], BAC: ["bank of america"], WFC: ["wells fargo"], GS: ["goldman sachs"],
  MS: ["morgan stanley"], C: ["citigroup"], SCHW: ["charles schwab"], BLK: ["blackrock"], NTRS: ["northern trust"],
  MA: ["mastercard"], SPGI: ["s&p global"], MCO: ["moody"], FDS: ["factset"], MSTR: ["microstrategy", "saylor"], COIN: ["coinbase"],
  LLY: ["eli lilly"], UNH: ["unitedhealth"], JNJ: ["johnson & johnson"], PFE: ["pfizer"], MRK: ["merck"], ABBV: ["abbvie"],
  NVO: ["novo nordisk"], XOM: ["exxon"], CVX: ["chevron"], PBR: ["petrobras"], SCCO: ["southern copper"], FCX: ["freeport mcmoran"],
  WMT: ["walmart"], COST: ["costco"], HD: ["home depot"], MCD: ["mcdonald"], KO: ["coca-cola"], PEP: ["pepsico"], PG: ["procter"],
  NKE: ["nike"], SBUX: ["starbucks"], DIS: ["disney"], CCL: ["carnival"], TTWO: ["take-two", "taketwo"], EA: ["electronic arts"],
  BA: ["boeing"], RTX: ["raytheon", "rtx corp"], LMT: ["lockheed"], NOC: ["northrop"], GD: ["general dynamics"], SPCX: ["spacex"],
  CAT: ["caterpillar"], DE: ["deere"], GE: ["ge aerospace", "general electric"], UPS: ["united parcel"], FDX: ["fedex"],
  ODFL: ["old dominion"], VZ: ["verizon"], TMUS: ["t-mobile"], RHI: ["robert half"], IBIT: ["ishares bitcoin", "blackrock bitcoin"],
  GLD: ["spdr gold"]};
const norm = s => String(s || "").toLowerCase().replace(/[’'`]/g, "").replace(/[‐–—-]/g, " ");
const clean = s => norm(s).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const nameWords = name => norm(name).split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !GENERIC.has(w));
const keywords = (sym, name) => [...new Set([...(ALIAS[sym] || []), ...nameWords(name)].map(clean).filter(Boolean))];
const queryWord = (sym, name) => (ALIAS[sym] || nameWords(name))[0] || "";
function relevant(title, sym, kws){
  if(new RegExp(`(\\(|:|\\$)${sym.replace(/\./g, "\\.")}\\b`).test(title || "")) return true;
  const t = " " + clean(title) + " ";
  // Короткое название — только отдельным словом, можно с притяжательным -s («Apple's»).
  return kws.some(k => k.length >= 6 ? t.includes(" " + k) : t.includes(" " + k + " ") || t.includes(" " + k + "s "));
}
/* Шум, который Google News отдаёт почти по любой бумаге: автоматические заметки о том, какой
   фонд купил или продал акции (по отчётам 13F), и страницы с финансовыми показателями. */
const NOISE = [
  // «Shares Bought by …», «Position in … Lessened by …»
  /\b(shares?|stake|position|holdings?)\b.*\b(bought|sold|acquired|purchased|raised|lowered|trimmed|boosted|increased|decreased|reduced|cut|added|lifted|lessened|grown)\b.*\bby\b/i,
  // «… LLC Invests $42 Million in …»
  /\b(llc|l\.?p\.?|advis[eo]rs?|advisory|associates|(wealth|asset|capital|investment|portfolio) management|private wealth|family office)\b.*\b(invests?|acquires?|buys?|sells?|purchases?|takes?|trims?|boosts?|raises?|lowers?|cuts?|increases?|decreases?|reduces?|grows?|lifts?)\b.*\b(stake|position|shares|holdings|million|billion)\b/i,
  // «… Grows Stock Position in …», «Acquires New Stake in …»; обычное «takes stake in» — новость, его не трогаем
  /\b(grows?|raises?|lifts?|lowers?|trims?|boosts?|cuts?|increases?|decreases?|reduces?|takes?|acquires?|purchases?|buys?|sells?|builds?|initiates?|establishes?|opens?)\s+(its\s+|a\s+|an\s+)?((new|stock|share|equity)\s+(position|stake|holdings?)|position|holdings?)\s+in\b/i,
  // «… Has $1.2 Million Stock Position in …»
  /\bhas\s+\$[\d.,]+\s*(thousand|million|billion)?\s+(stock\s+|share\s+|equity\s+)?(position|stake|holdings?)\s+in\b/i,
  // страницы показателей: «Return on invested capital % of … – NYSE:XXX»
  /\s[–—-]\s[A-Z]{2,6}:[A-Z.]{1,10}\s*$/];
const noisy = it => NOISE.some(r => r.test(it.title || ""));

/* Тикеры клиента для новостей: бумаги в портфеле и базовые активы опционов,
   которые истекают в ближайшие 45 дней. */
function holdingTickers(P){
  const set = new Map();
  P.positions.filter(p => WL.eq(p) && p.symbol && p.ccy === "USD").forEach(p => set.set(p.symbol, {why: WL.t("в портфеле", "in the portfolio"), name: p.name}));
  P.positions.filter(p => p.type === "option" && p.occ && p.expiry >= P.today && WL.days(P.today, p.expiry) <= 45)
    .forEach(p => { if(!set.has(p.underlying)) set.set(p.underlying, {why: WL.t("опцион истекает скоро", "option expiring soon"), name: p.underlyingName}); });
  return [...set].map(([sym, v]) => ({sym, why: v.why, name: v.name, kws: keywords(sym, v.name)}));
}

function quoteTile(q){
  const x = M.quotes && M.quotes[q.sym];
  if(!x || x.price == null) return `<div class="q"><div class="q-l">${esc(q.label)}</div><div class="q-v unk">—</div><div class="q-c unk">${WL.t("нет данных", "no data")}</div></div>`;
  let value, change, dir = x.price - (x.prev_close ?? x.price);
  if(q.yld){
    value = `${fmt.px(x.price / 10)}%`;
    const bp = (x.price - x.prev_close) * 10;
    change = x.prev_close != null ? `${bp > 0 ? "+" : bp < 0 ? "−" : ""}${WL.t(`${Math.abs(bp).toFixed(1).replace(".", ",")} б.п.`, `${fmt.dec(Math.abs(bp), 1)} bp`)}` : "";
  } else {
    value = fmt.px(x.price);
    change = x.change_pct != null ? fmt.pct(x.change_pct, 2) : "";
  }
  // Для VIX рост — плохой знак: цвет по смыслу, а не по знаку. Ставки без цвета:
  // их рост сам по себе не хорош и не плох, всё зависит от позиций клиента.
  const cls = q.yld ? "" : q.vol ? (dir > 0 ? "down" : dir < 0 ? "up" : "") : (dir > 0 ? "up" : dir < 0 ? "down" : "");
  return `<div class="q"><div class="q-l">${esc(q.label)}</div><div class="q-v">${value}</div><div class="q-c ${cls}">${change}</div></div>`;
}

function fxTile(f){
  const r = M.fx && M.fx[f.ccy];
  if(!r) return `<div class="q"><div class="q-l">${esc(f.label)}</div><div class="q-v unk">—</div><div class="q-c unk">${WL.t("нет данных", "no data")}</div></div>`;
  const v = f.inv ? 1 / r : r;
  return `<div class="q"><div class="q-l">${esc(f.label)}</div><div class="q-v">${WL.t(v.toFixed(4).replace(".", ","), fmt.dec(v, 4))}</div><div class="q-c muted">${WL.t("ЕЦБ", "ECB")}, ${fmt.date(M.fxDate)}</div></div>`;
}

function tapeSrc(){
  const cfg = {symbols: TAPE, showSymbolLogo: true, colorTheme: "dark", isTransparent: true,
    displayMode: "adaptive", width: "100%", height: 46, utm_source: location.hostname, utm_medium: "widget", utm_campaign: "ticker-tape"};
  return `https://www.tradingview-widget.com/embed-widget/ticker-tape/?locale=${WL.t("ru", "en")}#` + encodeURIComponent(JSON.stringify(cfg));
}

function newsItem(it, tick){
  const other = WL.t("en", "ru");   // плашкой помечаем материалы не на языке интерфейса
  return `<li><div class="nmeta">${tick ? `<span class="tick">${esc(tick)}</span>` : ""}<span>${esc(srcName(it.source || ""))}</span>` +
    `${it.time ? `<span>· ${ago(it.time)}</span>` : ""}${it.lang === other && !tick ? `<span class="pill">${other.toUpperCase()}</span>` : ""}</div>` +
    `<a href="${esc(safeLink(it.link))}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a></li>`;
}

function renderQuotes(){
  const el = document.querySelector("#mktQuotes"); if(!el) return;
  el.innerHTML = QUOTES.map(quoteTile).join("") + FXQ.map(fxTile).join("");
  const t = document.querySelector("#mktQuotesAt");
  if(t) t.textContent = M.quotesAt ? WL.t(`котировки на ${M.quotesAt.toLocaleDateString("ru-RU")}, ${M.quotesAt.toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit"})}`,
      `quotes as of ${fmt.date(localDay(M.quotesAt))}, ${M.quotesAt.toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})}`)
    : M.quotesFailed ? WL.t("котировки не загрузились", "quotes failed to load") : WL.t("загружаю…", "loading…");
}
/* Первые десять новостей рынка — самые свежие, но не больше трёх из одного источника:
   иначе самая частая лента занимает весь список. */
function balanced(items, n, perSource){
  const used = {}, out = [];
  for(const it of items){
    if(out.length >= n) break;
    const s = it.source || "";
    if((used[s] || 0) < perSource){ out.push(it); used[s] = (used[s] || 0) + 1; }
  }
  if(out.length < n) out.push(...items.filter(it => !out.includes(it)).slice(0, n - out.length));
  return out.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
}
function renderMarketNews(){
  const el = document.querySelector("#mktNews"); if(!el) return;
  if(!M.market){ el.innerHTML = `<li class="muted">${WL.t("Загружаю новости…", "Loading news…")}</li>`; return; }
  const items = (M.market.items || []).filter(it => M.lang === "all" || it.lang === M.lang);
  const shown = M.showAllMarket ? items : balanced(items, 10, 3);
  el.innerHTML = (shown.length ? shown.map(it => newsItem(it)).join("") : `<li class="muted">${WL.t("Новостей нет.", "No news.")}</li>`) +
    (items.length > shown.length ? `<li class="no-print"><button class="btn small" type="button" data-more="market">${WL.t(`Ещё ${items.length - shown.length}`, `Show ${items.length - shown.length} more`)}</button></li>` : "") +
    ((M.market.errors || []).length ? `<li class="muted" style="font-size:12px">${WL.t("Не ответили", "Unavailable")}: ${esc(M.market.errors.map(srcName).join(", "))}</li>` : "");
  document.querySelectorAll("#mktLang button").forEach(b => b.setAttribute("aria-pressed", b.dataset.lang === M.lang));
}
function renderHoldingNews(P){
  const el = document.querySelector("#holdNews"); if(!el) return;
  const ticks = holdingTickers(P);
  const chips = document.querySelector("#holdChips");
  // Искать не по чему (нет бумаг в долларах и близких опционов) — запроса не будет, ждать нечего.
  if(!ticks.length){
    if(chips) chips.innerHTML = "";
    el.innerHTML = `<li class="muted">${WL.t("В портфеле нет бумаг с американскими котировками — новости по ним не ищем.", "No US-listed holdings in the portfolio, so there is no holdings news to look up.")}</li>`;
    return;
  }
  if(M.holdings && M.holdings.failed){
    if(chips) chips.innerHTML = "";
    el.innerHTML = `<li class="muted">${WL.t("Новости по бумагам не загрузились: сервер новостей не ответил.", "News on holdings failed to load: the news server did not respond.")}</li>`;
    return;
  }
  const raw = M.holdings && M.holdings.symbols;
  const data = raw && Object.fromEntries(ticks.map(t => [t.sym, Array.isArray(raw[t.sym])
    ? raw[t.sym].filter(it => relevant(it.title, t.sym, t.kws) && !noisy(it)).slice(0, 6) : raw[t.sym]]));
  if(chips) chips.innerHTML = [`<button class="chip" type="button" data-tick="all" aria-pressed="${M.tick === "all"}">${WL.t("Все", "All")}</button>`]
    .concat(ticks.map(t => { const n = data && Array.isArray(data[t.sym]) ? data[t.sym].length : 0;
      return `<button class="chip" type="button" data-tick="${esc(t.sym)}" title="${esc(t.why)}" aria-pressed="${M.tick === t.sym}">${esc(t.sym)}${data ? ` · ${n}` : ""}</button>`; })).join("");
  if(!data){ el.innerHTML = `<li class="muted">${WL.t("Загружаю новости по", "Loading news for")} ${ticks.length} ${WL.pl(ticks.length, ["бумаге", "бумагам", "бумагам"], ["holding", "holdings"])}…</li>`; return; }
  let items = [];
  ticks.forEach(t => { if(Array.isArray(data[t.sym]) && (M.tick === "all" || M.tick === t.sym)) data[t.sym].forEach(it => items.push({it, sym: t.sym})); });
  items.sort((a, b) => (b.it.time || "").localeCompare(a.it.time || ""));
  if(M.tick === "all") items = items.slice(0, 12);
  el.innerHTML = items.length ? items.map(x => newsItem(x.it, x.sym)).join("") : `<li class="muted">${WL.t("За неделю новостей не нашлось.", "No news in the past week.")}</li>`;
}

/* Новости по бумагам клиента. Выписки добавляют по одной, поэтому набор тикеров меняется после первого
   показа: тогда новости загружаются заново. MP — портфель, по которому они показаны сейчас. */
let MP = null;
const holdKey = P => holdingTickers(P).map(x => x.sym).sort().join(",");
function loadHoldings(P){
  const ticks = holdingTickers(P), key = holdKey(P);
  if(!ticks.length) return Promise.resolve();
  // Пока шёл запрос, портфель могли пересобрать с теми же бумагами: ответ по-прежнему подходит.
  return getJSON("/market/news?symbols=" + ticks.map(x => x.sym).join(",") +
      "&q=" + ticks.map(x => encodeURIComponent(queryWord(x.sym, x.name).replace(/,/g, " "))).join(","))
    .then(r => { if(!MP || holdKey(MP) !== key) return; M.holdings = r && r.symbols ? r : {symbols: {}, failed: true}; renderHoldingNews(MP); });
}
WL.updateMarketHoldings = function(P){
  if(!document.querySelector("#holdNews")) return;
  const changed = !MP || holdKey(MP) !== holdKey(P);
  MP = P;
  if(!changed) return;
  M.holdings = null; M.tick = "all";
  renderHoldingNews(P);
  loadHoldings(P);
};

async function loadAll(P, {quotesOnly = false} = {}){
  const jobs = [getJSON("/market/quotes?symbols=" + QUOTES.map(q => q.sym).join(",")).then(r => {
    if(r && r.quotes){ M.quotes = r.quotes; M.quotesAt = new Date(); M.quotesFailed = false; } else if(!M.quotesAt) M.quotesFailed = true;
    renderQuotes(); }),
    getJSON("/fx?base=USD").then(r => { if(r && r.rates){ M.fx = r.rates; M.fxDate = r.date; } renderQuotes(); })];
  if(!quotesOnly){
    jobs.push(getJSON("/market/news").then(r => { M.market = r || {items: [], errors: [WL.t("все источники", "all sources")]}; renderMarketNews(); }));
    jobs.push(loadHoldings(P));
  }
  await Promise.all(jobs);
}

WL.renderMarket = function(el, P){
  if(!el) return;
  el.innerHTML = `
    <div class="sec-h"><h2>${WL.t("Рынок и новости", "Market and news")}</h2><span class="aside">${WL.t("для информации · в выводах по клиенту не участвует", "for reference only · not part of the portfolio findings")}</span>
      <span class="spacer"></span><span class="muted" id="mktQuotesAt" style="font-size:12.5px"></span>
      <button class="btn small no-print" type="button" id="mktRefresh">${WL.t("Обновить", "Refresh")}</button></div>
    <div class="card mkt">
      <div class="qgrid" id="mktQuotes"></div>
      <div class="tape no-print"><iframe title="${WL.t("Котировки TradingView", "TradingView quotes")}" loading="lazy" scrolling="no" src="${esc(tapeSrc())}"></iframe></div>
      <div class="basis">${WL.t("Индексы, ставки, VIX и фонды — CBOE с задержкой 15 минут; курсы валют — ЕЦБ.", "Indices, yields, VIX and ETFs — CBOE quotes delayed by 15 minutes; exchange rates — ECB.")}<span class="no-print"> ${WL.t("Лента", "Ticker tape")} — <a href="${WL.t("https://ru.tradingview.com/", "https://www.tradingview.com/")}" target="_blank" rel="noopener noreferrer">TradingView</a>.</span></div>
    </div>
    <div class="news">
      <div class="card newscol">
        <div class="newsh"><b>${WL.t("Рынки", "Markets")}</b><span class="spacer"></span>
          <div class="chips no-print" id="mktLang"><button class="chip" type="button" data-lang="all">${WL.t("Все", "All")}</button><button class="chip" type="button" data-lang="ru">RU</button><button class="chip" type="button" data-lang="en">EN</button></div></div>
        <ul class="nlist" id="mktNews"></ul>
        <div class="basis">${WL.t("Investing.com, «Ведомости», «Коммерсантъ», CNBC, MarketWatch — не больше трёх материалов из одного источника.",
          "Investing.com, Vedomosti and Kommersant in Russian; CNBC and MarketWatch in English. At most three stories from any one source.")}</div>
      </div>
      <div class="card newscol">
        <div class="newsh"><b>${WL.t("По бумагам клиента", "Portfolio holdings")}</b><span class="spacer"></span></div>
        <div class="chips no-print" id="holdChips" style="margin-bottom:6px"></div>
        <ul class="nlist" id="holdNews"></ul>
        <div class="basis">${WL.t("Google News за неделю, без автоматических заметок о сделках фондов. Для поиска наружу уходят только тикеры и названия компаний.",
          "Google News for the past week, excluding automated stories about funds buying or selling shares. Only tickers and company names are sent out for the search.")}</div>
      </div>
    </div>`;
  MP = P; M.holdings = null; M.tick = "all";
  renderQuotes(); renderMarketNews(); renderHoldingNews(P);
  el.onclick = e => {
    const b = e.target.closest("button"); if(!b) return;
    if(b.id === "mktRefresh"){ M.quotes = null; renderQuotes(); loadAll(MP); }
    if(b.dataset.lang){ M.lang = b.dataset.lang; M.showAllMarket = false; renderMarketNews(); }
    if(b.dataset.more === "market"){ M.showAllMarket = true; renderMarketNews(); }
    if(b.dataset.tick){ M.tick = b.dataset.tick; renderHoldingNews(MP); }
  };
  loadAll(P);
  clearInterval(timer);
  timer = setInterval(() => { if(!document.hidden) loadAll(MP, {quotesOnly: true}); }, 5 * 60000);
};
})();
