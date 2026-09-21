/* Флоу велса · импорт выгрузок CSV и Excel.
   PDF у каждого банка свой, и под него нужен отдельный разборщик. Выгрузка таблицей
   есть почти у любого брокера, и колонки в ней уже размечены — поэтому это путь для
   всех остальных площадок. Заголовки сопоставляются автоматически; что не сошлось,
   честно показано в «Документах», а не подставлено по умолчанию. */
(function(){
const WL = window.WL;
const {pad, round2} = WL.util;

/* Синонимы заголовков. Порядок важен: поле, объявленное раньше, забирает колонку
   первым, поэтому «цена покупки» достаётся себестоимости, а не текущей цене. */
const HEAD = {
  broker: ["брокер", "банк", "площадка", "custodian", "broker", "bank", "account", "счёт", "счет"],
  name: ["наименование", "название", "бумага", "инструмент", "актив", "описание", "позиция",
         "security", "instrument", "description", "name", "position", "holding"],
  ticker: ["тикер", "символ", "код", "symbol", "ticker", "bbg", "bloomberg"],
  isin: ["isin", "изин"],
  type: ["тип", "класс", "класс актива", "вид", "asset class", "asset category", "assetclass", "type", "class", "category",
         "asset type", "security type", "instrument type", "product type"],
  qty: ["количество", "кол-во", "колво", "штук", "шт", "quantity", "qty", "shares", "units", "контракты",
        "nominal", "номинал", "nennwert"],
  costTotal: ["себестоимость", "сумма покупки", "затраты", "cost basis", "total cost", "book value", "стоимость покупки",
              "cost value"],
  costPrice: ["цена покупки", "средняя цена", "цена входа", "цена приобретения", "avg price", "average price",
              "average cost", "purchase price", "book price",
              "average cost price", "cost price", "unit cost", "cost per share", "cost/share"],
  price: ["текущая цена", "цена", "last price", "market price", "price", "last", "курс", "котировка",
          "current price", "close price", "closing price"],
  value: ["рыночная стоимость", "стоимость", "оценка", "сумма", "market value", "value", "amount", "mv",
          "current value", "position value"],
  ccy: ["валюта", "currency", "ccy", "cur"],
  date: ["дата покупки", "дата сделки", "дата приобретения", "purchase date", "trade date", "open date", "дата",
         "acquisition date", "date acquired", "buy date"],
  commission: ["комиссия", "комиссии", "сбор", "commission", "fee", "fees"],
  expiry: ["экспирация", "погашение", "expiry", "expiration", "maturity"],
};
const TOTAL_RE = /^\s*(итого|всего|итоговая|сумма по|total|subtotal|sub-?total|grand\s*total|gesamt)(\s|:|$|[^\wА-Яа-яЁё])/i;
const OCC = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
/* Класс актива из файла. Фонд ведёт себя как акция: тикер и биржевая цена. У облигации и
   структурной ноты цены у нас нет, поэтому они отдельные типы. Незнакомый класс не выдаём
   за акцию — это «прочее»: лучше честная строка, чем неверная подпись. */
const CLASS = [[/структурн|structured|\bnote|нот[аы]/i, "note"], [/облигац|\bbond|бонд|\bобл\b|fixed income|anleihe|obligation/i, "bond"],
  [/фонд|fund|\betf|бпиф|\bпиф|trust/i, "fund"],
  // Опционы и фьючерсы — до акций: «Equity and Index Options» иначе читается как акции.
  [/опцион|option|колл|пут|\bcall\b|\bput\b/i, "option"], [/фьючерс|фьюч|future/i, "future"],
  [/акци|equit|stock|share|aktie|\bactions\b/i, "stock"],
  [/cash|денеж|деньг|остат|balance|наличн|ликвидн|валют|currency|liquidit|account|konto|konten|compte/i, "cash"]];
const classOf = t => (CLASS.find(c => c[0].test(t)) || [null, null])[1];
// Класса в файле нет — по названию узнаём только очевидное: фонд, облигацию с купоном и годом, счёт.
// Остальное, как и раньше, акции. У кириллицы нет \b, поэтому русские слова — отдельными выражениями.
const nameClass = n => /\b(etf|ucits|sicav|fund|fonds)\b/i.test(n) || /фонд|бпиф/i.test(n) ? "fund"
  : /\d\s?%.*\b20\d\d\b|\b(treasury|bund|gilt|bonds?|anleihe|obligation)\b/i.test(n) || /облигац|^офз/i.test(n) ? "bond"
  : /^(account\b|konto|compte)|\b(current|cash|call|deposit|savings|checking)\s+accounts?\b/i.test(n) || /(текущий|расч[её]тный) сч[её]т/i.test(n) ? "cash" : null;
const IB_OPT = /^([A-Z][A-Z0-9.]{0,5})\s+(\d{1,2})([A-Z]{3})(\d{2})\s+([\d.]+)\s+([CP])$/;
const MONTHS = {JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
                JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12"};
/* Опцион из записи вида «MCD 18SEP26 230 P»: собираем из неё код OCC — по нему работают
   и календарь экспираций, и котировка контракта. */
function ibOption(symRaw){
  const m = IB_OPT.exec(String(symRaw || "").trim());
  if(!m || !MONTHS[m[3]]) return null;
  const dd = pad(m[2]), mm = MONTHS[m[3]], yy = m[4], strike = +m[5];
  return {underlying: m[1], right: m[6], strike, expiry: `20${yy}-${mm}-${dd}`,
          occ: m[1] + yy + mm + dd + m[6] + String(Math.round(strike * 1000)).padStart(8, "0")};
}
/* Выгрузка одним файлом из нескольких таблиц (так делают Interactive Brokers и Exante):
   в первой колонке имя раздела, во второй — Header/Data/Total. Берём строки только своего
   раздела, иначе в позиции попадут строки денежного отчёта и сводок. */
function sectionBody(rows, row){
  const key = clean(rows[row][0]);
  if(!key) return null;
  const same = rows.slice(row + 1).filter(r => clean(r[0]) === key);
  if(same.length < 2) return null;
  const marks = new Set(same.map(r => clean(r[1]).toLowerCase()));
  if(!marks.has("data")) return {key, data: same, totals: []};
  return {key, data: same.filter(r => clean(r[1]).toLowerCase() === "data"),
          totals: same.filter(r => /^(total|subtotal)/i.test(clean(r[1])))};
}

/* Разделитель нельзя брать по первой строке: сверху часто стоит заголовок отчёта без
   единого разделителя. И нельзя брать по общему количеству: в европейской выгрузке
   запятых внутри чисел больше, чем точек с запятой между колонками. Считаем по первым
   строкам и берём тот знак, который даёт ОДИНАКОВОЕ число колонок в большинстве строк —
   так выглядит настоящая таблица. */
function delimiter(text){
  const lines = String(text || "").split(/\r?\n/).filter(l => l.trim()).slice(0, 20);
  const count = (line, ch) => { let n = 0, q = false;
    for(let i = 0; i < line.length; i++){ const c = line[i];
      if(c === '"'){ if(q && line[i + 1] === '"') i++; else q = !q; }
      else if(!q && c === ch) n++; }
    return n; };
  let best = {ch: ",", agree: 0, cols: 0};
  for(const ch of [";", "\t", ",", "|"]){
    const counts = lines.map(l => count(l, ch)).filter(n => n > 0);
    if(!counts.length) continue;
    const mode = counts.sort((a, b) => counts.filter(x => x === b).length - counts.filter(x => x === a).length)[0];
    const agree = counts.filter(n => n === mode).length;
    if(agree > best.agree || (agree === best.agree && mode > best.cols)) best = {ch, agree, cols: mode};
  }
  return best.ch;
}
function parseCSV(text){
  const D = delimiter(text), rows = [];
  let row = [], cur = "", q = false;
  text = text.replace(/^﻿/, "");
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){ if(c === '"'){ if(text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else if(c === '"') q = true;
    else if(c === D){ row.push(cur); cur = ""; }
    else if(c === "\n"){ row.push(cur); rows.push(row); row = []; cur = ""; }
    else if(c !== "\r") cur += c;
  }
  if(cur !== "" || row.length){ row.push(cur); rows.push(row); }
  return rows;
}

// Числа читает общее правило parse.js (минусы, скобки, разделители, валюта рядом). Пустая ячейка — не ноль.
const numOrNull = v => { const a = WL.util.amount(v); return a ? a.value : null; };
function toISO(v, dayFirst = true){
  if(v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v == null ? "" : v).trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
  if(m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/.exec(s);          // день.месяц.год или месяц/день/год
  if(m){ const [d, mo] = dayFirst ? [m[1], m[2]] : [m[2], m[1]]; return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(mo)}-${pad(d)}`; }
  return null;
}
// Код валюты — только настоящий код ISO 4217: три буквы, прочитанные с картинки с ошибкой («USH» вместо «USD»), валютой не считаются
// и не расходятся со сверкой молча — тогда валюту спросят у человека.
const ISO_CCY = new Set(("AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNH CNY COP " +
  "CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GBX GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES " +
  "KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN " +
  "PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD " +
  "UYU UZS VES VND VUV WST XAF XAG XAU XCD XOF XPF YER ZAR ZMW ZWG").split(" "));
const ccy3 = v => (String(v == null ? "" : v).toUpperCase().match(/\b[A-Z]{3}\b/g) || []).find(c => ISO_CCY.has(c)) || null;
const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
/* Распознанный скан путает похожие знаки: «USD» приходит как «ush», «U5D», «USO». Молча валюту не подставляем:
   если код отличается от распространённой валюты одним похожим знаком, эта валюта предлагается человеку на подтверждение. */
const OCR_LIKE = {D: "OQ0HB", O: "DQ0", Q: "O0", "0": "ODQ", S: "5$", "5": "S", H: "DN", N: "H", B: "8", "8": "B", I: "1LJ", L: "1I", "1": "IL",
  U: "VW", V: "UY", E: "F", F: "EP", C: "G(", G: "C6", "6": "G", K: "X", X: "K", Y: "V", P: "F", R: "K", J: "I", A: "4", "4": "A"};
const COMMON_CCY = ["USD", "EUR", "CHF", "GBP", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "HKD", "SGD", "CNY", "RUB"];
const ocrCcy = v => {
  const tok = clean(v).toUpperCase();
  if(!/^[A-Z0-9$(]{3}$/.test(tok) || ISO_CCY.has(tok)) return null;
  const hits = COMMON_CCY.filter(c => { let diff = 0;
    for(let i = 0; i < 3; i++) if(c[i] !== tok[i]){ if(!(OCR_LIKE[c[i]] || "").includes(tok[i])) return false; diff++; }
    return diff === 1; });
  return hits.length === 1 ? hits[0] : null;
};

/* Колонка достаётся ровно одному полю: сначала точные совпадения заголовка, потом
   вхождение подстроки. Иначе «Цена» и «Цена покупки» дерутся за одно поле. */
const MONEY = new Set(["qty", "costTotal", "costPrice", "price", "value", "commission"]);
function mapHeaders(rowCells){
  const low = rowCells.map(h => clean(h).toLowerCase());
  const map = {}, taken = new Set();
  // Признак многосекционного файла: вторая ячейка шапки — метка строки.
  if(/^(header|data|total|subtotal)$/i.test(low[1] || "")){ taken.add(0); taken.add(1); }
  // Колонка с процентом — ставка, а не деньги: «Fee product %» это TER фонда, и принимать
  // её за комиссию сделки нельзя.
  // «% Of Account» у Schwab — доля позиции, а не брокер: процентная колонка не подходит никакому полю.
  const fits = (f, h, ix) => !taken.has(ix) && h && !h.includes("%");
  for(const [f, syn] of Object.entries(HEAD)){
    const i = low.findIndex((h, ix) => fits(f, h, ix) && syn.some(x => h === x));
    if(i >= 0){ map[f] = i; taken.add(i); }
  }
  for(const [f, syn] of Object.entries(HEAD)){
    if(map[f] != null) continue;
    const i = low.findIndex((h, ix) => fits(f, h, ix) && syn.some(x => h.includes(x)));
    if(i >= 0){ map[f] = i; taken.add(i); }
  }
  return map;
}
// В банковских выгрузках над таблицей часто идут шапки и пустые строки, поэтому
// заголовок ищется по первым тридцати строкам: берём самую «колоночную».
function findHeader(rows){
  let best = null;
  for(let i = 0; i < Math.min(rows.length, 30); i++){
    const map = mapHeaders(rows[i] || []);
    const named = map.name != null || map.ticker != null;
    const sized = map.qty != null || map.value != null;
    if(!named || !sized) continue;
    const score = Object.keys(map).length;
    if(!best || score > best.score) best = {row: i, map, score};
  }
  return best;
}

function loadXLSX(){
  if(window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    // Хеш содержимого: подменённый на CDN файл браузер не выполнит — у страницы есть доступ к выпискам.
    s.integrity = "sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==";
    s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer";
    s.onload = res; s.onerror = () => rej(new Error(WL.t("не удалось загрузить чтение Excel", "could not load the Excel reader")));
    document.head.appendChild(s);
  });
}

const BROKER_BY_NAME = [[/exante/i, "Exante"], [/interactive|(?<![a-z])ibkr(?![a-z])|(?<![a-z])ib_/i, "Interactive Brokers"],
  [/schwab/i, "Charles Schwab"], [/swissquote|(?<![a-z])sq[_-]/i, "Swissquote"], [/(?<![a-z])ubs(?![a-z])/i, "UBS"],
  [/morgan stanley/i, "Morgan Stanley"], [/jpmorgan|j\.?\s?p\.?\s?morgan|(?<![a-z])jpm(?![a-z])|morgan/i, "J.P. Morgan"], [/goldman|(?<![a-z])gs[_-]/i, "Goldman Sachs"], [/(?<![a-z])citi(?![a-z])/i, "Citi"],
  [/saxo/i, "Saxo Bank"], [/pictet/i, "Pictet"], [/julius|baer/i, "Julius Baer"], [/lombard/i, "Lombard Odier"],
  [/(?<![a-z])efg(?![a-z])/i, "EFG Bank"], [/vontobel/i, "Vontobel"], [/(?<![a-z])lgt(?![a-z])/i, "LGT"], [/mirabaud/i, "Mirabaud"], [/rothschild/i, "Rothschild"],
  [/credit suisse/i, "Credit Suisse"], [/safra sarasin/i, "J. Safra Sarasin"],
  [/emirates nbd/i, "Emirates NBD"], [/(?<![a-z])hsbc(?![a-z])/i, "HSBC"], [/barclays/i, "Barclays"],
  [/united bank (limited|ltd)|(?<![a-z])ubl(?![a-z])|ubldigital/i, "UBL United Bank"]];
const brokerFromFile = name => (BROKER_BY_NAME.find(b => b[0].test(name)) || [null, null])[1];

function brokerFromHead(rows, upto){
  for(const r of rows.slice(0, upto)){
    const i = r.findIndex(c => /^(brokername|broker|банк|брокер)$/i.test(clean(c)));
    if(i >= 0){ const v = clean(r[i + 1]) || clean(r[i + 2]); if(v) return v; }
  }
  return null;
}

function buildDoc(rows, head, file, ctx){
  const {row, map} = head;
  const tag = file.name.replace(/\.[^.]+$/, "").slice(0, 40);
  const g = (r, f) => map[f] != null ? r[map[f]] : undefined;
  const positions = [], totals = [], notes = [];
  const headBroker = brokerFromHead(rows, head.row) || (ctx && ctx.broker) || null;
  let dataRows = 0, sectionStart = 0, afterTotal = false;

  // Валюта: колонка валюты, код или знак в самой сумме («$1,234.56»), валюта в заголовке («Market Value (USD)»).
  // Не нашлась нигде — не подставляем доллары молча: позиция помечается, и очередь спрашивает валюту у человека.
  const CCY = /\b(USD|EUR|CHF|GBP|JPY|CAD|AUD|NZD|HKD|SGD|SEK|NOK|DKK|PLN|CZK|HUF|RUB|CNY|CNH|INR|AED|ILS|TRY|ZAR|MXN|BRL|KRW|TWD|THB)\b/;
  const SIGN = {"$": "USD", "€": "EUR", "£": "GBP", "₽": "RUB", "¥": "JPY"};
  const ccyIn = v => { const x = String(v == null || v instanceof Date ? "" : v).toUpperCase(), m = CCY.exec(x); if(m) return m[1];
    const g2 = /[$€£₽¥]/.exec(x); return g2 ? SIGN[g2[0]] : null; };
  const headCcy = [map.value, map.price, map.costTotal].filter(i => i != null).map(i => ccyIn((rows[row] || [])[i])).find(Boolean) || null;
  const sect = sectionBody(rows, row);
  const body = sect ? sect.data : rows.slice(row + 1);
  // Порядок дня и месяца — по всей колонке дат: 14/03/2024 бывает только «день первым»,
  // 03/14/2024 — только «месяц первым». Если по файлу не понять, как и раньше, день первым.
  const dayFirst = (() => {
    const ms = body.flatMap(r => [g(r || [], "date"), g(r || [], "expiry")])
      .map(v => /^(\d{1,2})[-./](\d{1,2})[-./]\d{2,4}/.exec(String(v == null || v instanceof Date ? "" : v).trim())).filter(Boolean);
    if(ms.some(m => +m[1] > 12)) return true;
    return !ms.some(m => +m[2] > 12);
  })();
  if(sect) sect.totals.forEach(r => {
    const v = numOrNull(g(r, "value"));
    if(v != null) totals.push({ccy: ccy3(g(r, "ccy")), value: v});
  });
  for(let i = 0; i < body.length; i++){
    const r = body[i] || [];
    if(!r.length || r.every(c => c === "" || c == null)) continue;
    const nameCol = clean(g(r, "name"));
    const symRaw = clean(g(r, "ticker")).toUpperCase();
    // В многосекционном файле первые две колонки служебные: имя раздела и метка строки —
    // в название бумаги они не годятся.
    const label = nameCol || symRaw || clean((sect ? r.slice(2) : r).find(c => clean(c)));
    const qty = numOrNull(g(r, "qty"));
    const priceA = WL.util.amount(g(r, "price"));
    const price = priceA ? priceA.value : null;
    const printed = numOrNull(g(r, "value"));
    let value = printed;
    if(TOTAL_RE.test(label)){                       // строка итога — не позиция, а сверка
      // Итог раздела относится к строкам после предыдущего итога: «Subtotal equities», потом облигации.
      if(value != null) totals.push({ccy: ccy3(g(r, "ccy")) || ccy3(label), value, from: sectionStart, to: positions.length});
      afterTotal = true;
      continue;
    }
    if(qty == null && value == null && price == null) continue;   // подзаголовок или примечание
    if(afterTotal){ sectionStart = positions.length; afterTotal = false; }
    dataRows++;

    const ccyFound = ccy3(g(r, "ccy")) || ccyIn(g(r, "value")) || ccyIn(g(r, "price")) || headCcy;
    const ccy = ccyFound || "USD";
    const kind = clean(g(r, "type")).toLowerCase();
    const ib = ibOption(symRaw) || ibOption(nameCol.toUpperCase());
    const sym = ib ? ib.occ : symRaw.replace(/\s+/g, "").replace(/\.(NASDAQ|NYSE|NYSEARCA|ARCA|AMEX|BATS|NMS|US)$/, "");
    const occ = OCC.exec(sym);
    const cls = kind ? classOf(kind) : null;
    // Колонки класса нет — считаем бумагу акцией: так устроены почти все выгрузки позиций.
    // Класс есть, но незнакомый — «прочее», выдумывать за него нельзя.
    const guess = occ ? "option" : cls || (kind ? "other" : nameClass(label) || "stock");
    // Цена со знаком процента без колонки класса — облигация или нота: у акций процентной цены не бывает.
    const type = !kind && guess === "stock" && priceA && priceA.pct ? "bond" : guess;
    const isCash = type === "cash" || (!kind && /^(денежные средства|деньги|cash|остаток|cash balance)/i.test(label));
    const isOption = type === "option", isFuture = type === "future";
    /* Основа цены. У облигаций и нот цена обычно в процентах номинала: 50 000 номинала по 99,50 стоят 49 750, а не 4 975 000.
       Основу берём из записи («99,50%») или из напечатанной стоимости: номинал × цена / 100 = стоимость. Если нет ни того,
       ни другого, стоимость не вычисляем и спрашиваем человека — одна конвенция на все облигации была бы догадкой. */
    const bondLike = type === "bond" || type === "note";
    let basis = null;
    if(priceA && priceA.pct) basis = "percent";
    else if(!bondLike) basis = "unit";
    else if(printed != null && qty != null && price != null){
      const near = v => Math.abs(v - printed) <= Math.max(1, Math.abs(printed) * 0.04);
      basis = near(qty * price / 100) ? "percent" : near(qty * price) ? "unit" : null;
    }
    // Основу указал человек (ctx.basis) — только для облигаций, где её не было ни в записи цены, ни в стоимости.
    if(!basis && bondLike && printed == null && ctx && ctx.basis) basis = ctx.basis;
    const unit = basis === "percent" ? 0.01 : 1;
    if(value == null && qty != null && price != null && basis) value = round2(qty * price * unit);
    const broker = clean(g(r, "broker")) || headBroker || brokerFromFile(file.name) || tag;
    const base = {id: `SHEET:${tag}:${i}`, broker, brokerShort: broker.length <= 22 ? broker : broker.slice(0, 21) + "…",
                  name: label || WL.t("Позиция ", "Position ") + i, ccy, value: value != null ? round2(value) : null};
    if(!ccyFound){
      base.ccyGuessed = true;
      const raw = clean(g(r, "ccy")).slice(0, 12);
      if(raw){ base.ccyRaw = raw; const s = ocrCcy(raw); if(s) base.ccySuggest = s; }
    }

    if(isCash){ positions.push({...base, type: "cash", symbol: ccy, name: label || WL.t("Денежные средства", "Cash")}); continue; }

    // Цена опциона указана за одну бумагу, а контракт — это 100 бумаг: без множителя стоимость
    // и себестоимость расходятся с живой ценой в сто раз.
    const mult = occ ? 100 : 1;
    if(occ && printed == null && qty != null && price != null) base.value = round2(qty * price * mult);
    const costA = WL.util.amount(g(r, "costPrice"));
    const costPrice = costA ? costA.value : null;
    const costTotal = numOrNull(g(r, "costTotal"));
    // Цена покупки облигации — в той же основе, что текущая цена, если сама не помечена процентом.
    const costUnit = costA && costA.pct ? 0.01 : basis ? unit : null;
    const cost = costTotal != null ? costTotal : (costPrice != null && qty != null && costUnit != null ? round2(costPrice * qty * mult * costUnit) : null);
    const p = {...base, type,
               symbol: sym || null, code: symRaw !== sym ? symRaw : null, qty, price, priceDate: null, cost,
               costNote: cost == null ? WL.t("нет в выгрузке", "not in the export") : null,
               purchaseDate: toISO(g(r, "date"), dayFirst), commission: numOrNull(g(r, "commission")),
               isin: clean(g(r, "isin")) || null};
    if(basis === "percent"){ p.priceBasis = "percent"; if(costPrice != null) p.costPrice = costPrice; }
    if(bondLike && !basis && price != null && printed == null) p.basisUnknown = true;
    if(r.page) p.page = r.page;
    if(occ){
      p.occ = sym; p.underlying = occ[1]; p.underlyingName = occ[1]; p.right = occ[5]; p.multiplier = 100;
      p.strike = +occ[6] / 1000;
      p.expiry = `20${occ[2]}-${occ[3]}-${occ[4]}`;
      // Запись брокера «MCD 18SEP26 230 P» заменяем на нашу: «MCD пут 230».
      p.name = (ib ? "" : label) || WL.t(`${occ[1]} ${occ[5] === "C" ? "колл" : "пут"} ${p.strike}`, `${occ[1]} ${p.strike} ${occ[5] === "C" ? "call" : "put"}`);
    } else if(isOption || isFuture){
      p.expiry = toISO(g(r, "expiry"), dayFirst);
    }
    if(!p.symbol && !occ){                           // тикер в скобках внутри названия: Apple Inc (AAPL)
      const m = /\(([A-Z][A-Z0-9.]{0,9})\)/.exec(label || "");
      if(m) p.symbol = m[1];
    }
    positions.push(p);
  }

  // Дата оценки: сначала шапка над таблицей («Отчёт по портфелю на 31.08.2026»),
  // потом имя файла. Выдумывать сегодняшнюю дату молча нельзя — от неё зависит,
  // считаются ли данные свежими.
  let asOf = (ctx && ctx.asOf) || null;           // PDF: дата из шапки документа
  for(let i = 0; i < row && !asOf; i++){
    const line = (rows[i] || []).map(clean).join(" ");
    const m = /(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d\d)|(20\d\d)[-.\/](\d{1,2})[-.\/](\d{1,2})/.exec(line);
    if(m) asOf = m[3] ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : `${m[4]}-${pad(m[5])}-${pad(m[6])}`;
  }
  if(!asOf){
    const n = /(\d{1,2})[.\-_](\d{1,2})[.\-_](20\d\d)/.exec(file.name) ;
    if(n) asOf = `${n[3]}-${pad(n[2])}-${pad(n[1])}`;
    else {
      const y = /(20\d\d)[-_.]?(\d{2})[-_.]?(\d{2})/.exec(file.name);
      if(y) asOf = `${y[1]}-${y[2]}-${y[3]}`;
    }
  }
  const asOfGuessed = !asOf;
  if(!asOf){ asOf = new Date().toISOString().slice(0, 10);
    notes.push(WL.t("даты оценки в файле нет — взята сегодняшняя", "no valuation date in the file — today's date used")); }
  positions.forEach(p => { if(p.priceDate == null) p.priceDate = asOf; });

  if(sect) notes.push(WL.t(`прочитан раздел «${sect.key}»`, `read section “${sect.key}”`));
  if(map.price == null) notes.push(WL.t("колонки текущей цены нет — цены подтянутся с рынка по тикеру",
    "no current price column — prices will be fetched from the market by ticker"));
  if(map.costPrice == null && map.costTotal == null) notes.push(WL.t("цены покупки в файле нет", "no purchase price or cost basis in the file"));
  if(map.commission == null) notes.push(WL.t("комиссий в файле нет", "no fees in the file"));
  const noSym = positions.filter(p => (p.type === "stock" || p.type === "fund") && !p.symbol).length;
  if(noSym) notes.push(WL.t(`без тикера: ${noSym} ${WL.plural(noSym, "бумага", "бумаги", "бумаг")} — живых котировок по ним не будет`,
    `no ticker for ${noSym} ${noSym === 1 ? "security" : "securities"} — no live quotes for ${noSym === 1 ? "it" : "them"}`));
  const other = positions.filter(p => p.type === "other").length;
  if(other) notes.push(WL.t(`класс актива не распознан: ${other}`, `asset class not recognised: ${other}`));

  const brokers = [...new Set(positions.map(p => p.broker))];
  const one = brokers.length === 1 ? brokers[0] : null;
  const checks = [{label: WL.t("Строк с позициями прочитано", "Position rows read"), parsed: positions.length, stated: dataRows,
                   ok: positions.length === dataRows, count: true}];
  let mixedTotal = false;
  totals.forEach(t => {
    const sum = ps => round2(ps.filter(p => !t.ccy || p.ccy === t.ccy).reduce((a, p) => a + (p.value || 0), 0));
    const near = v => Math.abs(v - t.value) < Math.max(1, Math.abs(t.value) * 1e-6);
    // Итог раздела сходится со строками раздела, общий — со всем, что выше него.
    const part = t.to != null ? positions.slice(t.from, t.to) : positions, upTo = t.to != null ? positions.slice(0, t.to) : positions;
    const parsed = near(sum(part)) ? sum(part) : sum(upTo);
    // В PDF банка итог обычно в валюте отчёта по бумагам в разных валютах: без курсов на дату выписки
    // его не сверить, и «не сошлось» было бы ложной тревогой. Такой итог пропускаем и говорим об этом.
    const mixed = ps => new Set(ps.map(p => p.ccy)).size > 1;
    if(ctx && !near(parsed) && (mixed(part) || mixed(upTo))){ mixedTotal = true; return; }
    checks.push({label: `${WL.t("Итог в файле", "File total")}${t.ccy ? " " + t.ccy : ""}`, parsed, stated: round2(t.value),
                 ok: near(parsed), ccy: t.ccy || undefined});
  });
  if(mixedTotal) notes.push(WL.t("итог в файле посчитан в валюте отчёта по бумагам в разных валютах — без курсов выписки его не сверить",
    "the file total is in the reference currency across several currencies — it cannot be reconciled without the statement's exchange rates"));
  if(!totals.length) notes.push(WL.t("итоговой строки в файле нет — сверять сумму не с чем",
    "no total row in the file — nothing to reconcile the sum against"));

  const ccyGuessed = positions.filter(p => p.ccyGuessed).length;
  // Предложение валюты для окна подтверждения: одна и та же у всех позиций без валюты, либо — если колонки валюты нет —
  // единственная валюта итоговых строк файла.
  const guessedRows = positions.filter(p => p.ccyGuessed), sugs = [...new Set(guessedRows.map(p => p.ccySuggest || ""))];
  const totalCcys = [...new Set(totals.map(t => t.ccy).filter(Boolean))];
  const ccyRaw = [...new Set(guessedRows.map(p => p.ccyRaw).filter(Boolean))].slice(0, 3).join(", ");
  const ccySuggest = guessedRows.length && sugs.length === 1 && sugs[0] ? sugs[0] : guessedRows.length && !ccyRaw && totalCcys.length === 1 ? totalCcys[0] : null;
  const basisUnknown = positions.filter(p => p.basisUnknown).length;
  const doc = {broker: one || `${WL.t("Выгрузка", "Export")} · ${tag}`, brokerShort: one ? positions[0].brokerShort : WL.t("Выгрузка", "Export"),
          kind: "positions", asOf, asOfGuessed: asOfGuessed || undefined, ccyGuessed: ccyGuessed || undefined, ccySuggest: ccySuggest || undefined, ccyRaw: ccyRaw || undefined,
          ccySuggestTotal: ccySuggest && totalCcys.length === 1 && totalCcys[0] === ccySuggest || undefined, basisUnknown: basisUnknown || undefined, fileName: file.name, from: "sheet", note: notes.join(" · "),
          positions, checks, transactions: []};
  // Номер счёта: колонка «Account»/«Счёт» или подпись над таблицей. В отчёте хранится только отпечаток.
  const ids = new Set();
  const acctCol = (rows[row] || []).findIndex(c => /^(account|account number|account no\.?|acct|счёт|счет|номер сч[её]та|konto|kontonummer|compte|depot)$/i.test(clean(c)));
  if(acctCol >= 0 && WL.accountIds) body.forEach(r => { const v = clean((r || [])[acctCol]); if(v) WL.accountIds([{text: "Account " + v}]).forEach(x => ids.add(x)); });
  if(WL.accountIds) WL.accountIds(rows.slice(0, row).map(r => ({text: (r || []).map(clean).join(" ")}))).forEach(x => ids.add(x));
  Object.defineProperty(doc, "accountIds", {value: [...ids], enumerable: false, configurable: true});
  return doc;
}

/* Файл читается отдельно от разбора: те же строки нужны панели ручного сопоставления,
   если заголовки названы не так, как мы ожидали. */
WL.readSheet = async function(file){
  let sheets;
  if(/\.(csv|txt|tsv)$/i.test(file.name)){
    sheets = [{name: "csv", rows: parseCSV(await file.text())}];
  } else {
    await loadXLSX();
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), {type: "array", cellDates: true});
    sheets = wb.SheetNames.map(n => ({name: n,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, defval: "", blankrows: false})}));
  }
  let best = null;
  sheets.forEach((sh, i) => {
    const h = findHeader(sh.rows);
    if(h && (!best || h.score > best.head.score)) best = {sheetIndex: i, head: h};
  });
  return {sheets, best};
};
WL.sheetDoc = buildDoc;          // (строки, {row, map}, файл) → документ
WL.sheetMap = mapHeaders;        // ячейки строки → карта колонок
WL.sheetFind = findHeader;       // строки листа → {row, map} или null
WL.brokerByName = brokerFromFile;  // строка текста → известный брокер или null
WL.isoCcy = c => ISO_CCY.has(String(c || "").toUpperCase());   // настоящий код валюты ISO 4217
WL.ocrCcy = ocrCcy;   // «usb» с картинки → USD на подтверждение (или null)
// Поля для панели сопоставления: порядок и подписи. Первые два — обязательный минимум.
WL.sheetFields = [["name", WL.t("Наименование", "Name")], ["ticker", WL.t("Тикер", "Ticker")],
  ["qty", WL.t("Количество", "Quantity")], ["value", WL.t("Стоимость", "Market value")],
  ["price", WL.t("Текущая цена", "Current price")], ["ccy", WL.t("Валюта", "Currency")], ["broker", WL.t("Брокер", "Broker")],
  ["type", WL.t("Тип актива", "Asset type")], ["costPrice", WL.t("Цена покупки", "Average cost price")],
  ["costTotal", WL.t("Себестоимость", "Cost basis")], ["date", WL.t("Дата покупки", "Purchase date")],
  ["commission", WL.t("Комиссия", "Fees")], ["expiry", WL.t("Экспирация", "Expiry")], ["isin", "ISIN"]];

WL.parseSheet = async function(file){
  const {sheets, best} = await WL.readSheet(file);
  if(!best){
    const first = (sheets[0] && sheets[0].rows.find(r => r.some(c => clean(c)))) || [];
    return {unknown: true, fileName: file.name, sheets, headers: first.map(clean).filter(Boolean).slice(0, 12)};
  }
  const doc = buildDoc(sheets[best.sheetIndex].rows, best.head, file);
  if(sheets.length > 1) doc.note = [WL.t(`лист «${sheets[best.sheetIndex].name}»`, `sheet “${sheets[best.sheetIndex].name}”`),
                                    doc.note].filter(Boolean).join(" · ");
  doc.sheetIndex = best.sheetIndex; doc.head = best.head;   // чтобы сопоставление можно было поправить руками
  Object.defineProperty(doc, "sheets", {value: sheets, enumerable: false});
  return doc;
};

/* Таблицы из PDF любого банка (см. parse.js): те же заголовки и разбор, что у CSV. Из нескольких
   таблиц берём самую похожую на позиции: больше узнанных колонок, нет даты сделки, итог сходится.
   Дата оценки и банк из шапки документа (ctx) едут вместе с листом — их берёт и ручная разметка. */
WL.parseRows = function(tables, file, ctx){
  // Вкладки в панели: сначала похожие на позиции, потом остальные, операции — в конце; без страницы
  // одинаковые названия («PORTF.») не отличить. Таблиц без чисел в строках не показываем.
  const order = tables.filter(tb => tb.data >= 1)
    .sort((a, b) => (b.positional - a.positional) || (a.ops - b.ops) || (b.data - a.data)).slice(0, 12);
  const sheets = order.map(tb => ({name: `${tb.name || WL.t("Таблица", "Table")} · ${WL.t("стр.", "p.")} ${tb.page || 1}`, rows: tb.rows, ctx, ops: tb.ops,
    page: tb.page || 1, holdings: !tb.ops && tb.positional && (tb.keys || []).some(k => k === "qty" || k === "price")}));
  let best = null;
  sheets.forEach((sh, si) => {
    if(sh.ops) return;                              // операции в позиции не превращаем
    const head = findHeader(sh.rows);
    if(!head) return;
    let doc;
    try{ doc = buildDoc(sh.rows, head, file, ctx); }catch(e){ return; }
    if(!doc.positions.length) return;
    const score = Object.keys(head.map).length - (head.map.date != null ? 2 : 0) + (doc.checks.some(c => !c.count && c.ok) ? 3 : 0);
    if(!best || score > best.score || (score === best.score && doc.positions.length > best.doc.positions.length))
      best = {score, doc, si, head};
  });
  if(!best) return {unknown: true, fileName: file.name, sheets, headers: [], pdf: true};
  const doc = best.doc;
  doc.sheetIndex = best.si; doc.head = best.head; doc.fromPdf = true;
  cashTables(doc, sheets, best.si, ctx);
  /* Разобрана одна таблица, а в файле есть ещё таблица позиций со своей шапкой (облигации отдельно от акций): её строки
     в отчёт не попали. Итог выбранной таблицы при этом может сойтись — полноты он не доказывает. */
  const other = sheets.filter((sh, si) => si !== best.si && sh.holdings && sh.rows.length - 1 >= 1);
  if(other.length) doc.checks.push({label: WL.t("Другие таблицы позиций в файле", "Other position tables in the file"), parsed: 0, stated: other.length, ok: false, count: true,
    pages: [...new Set(other.map(sh => sh.page))]});
  Object.defineProperty(doc, "sheets", {value: sheets, enumerable: false});
  return doc;
};

/* Денежные счета отдельной таблицей в выписке о портфеле: «Account | Opening balance | Closing balance | Currency». В таблицу позиций
   она не похожа (нет количества и цены), и раньше молча выпадала — отчёт недосчитывал деньги, а итог бумаг при этом сходился.
   Берём только таблицы про счета и деньги (заголовок раздела или подписи строк), значение — исходящий остаток. */
const CASH_WORD = /(cash|account|current|liquid|money market|deposit|konto|kontokorrent|liquidit|compte|liquidités|conto|деньги|денежн|сч[её]т)/i;
function cashTables(doc, sheets, bestSi, ctx){
  const amount = WL.util && WL.util.amount;
  if(!amount) return;
  const added = [];
  sheets.forEach((sh, si) => {
    if(si === bestSi || sh.ops || sh.holdings) return;
    const rows = sh.rows || [], hi = rows.findIndex(r => r.filter(c => clean(c)).length >= 2 && !r.some(c => amount(c) && /\d/.test(clean(c))));
    if(hi < 0) return;
    const H = rows[hi].map(c => clean(c).toLowerCase());
    const bal = [/^(closing|ending|end of period|final) balance/, /^(closing|ending)\b/, /^(balance|saldo|solde|остаток|kontostand)\b/, /^(market value|value|amount|сумма|betrag|montant)\b/]
      .map(re => H.findIndex(h => re.test(h))).find(i => i >= 0);
    if(bal == null || bal < 0 || H.some(h => /^(quantity|qty|units|nominal|price|количество|цена|stück|anzahl)\b/.test(h))) return;
    const lab = H.findIndex((h, i) => i !== bal && h && !/(currency|ccy|währung|devise|валюта|opening|asset class)/.test(h));
    const ci = H.findIndex(h => /(currency|ccy|währung|devise|валюта)/.test(h));
    if(lab < 0) return;
    const title = `${sh.name} ${rows.slice(0, hi).flat().join(" ")}`;
    rows.slice(hi + 1).forEach(r => {
      const name = clean(r[lab]), a = amount(r[bal]);
      if(!name || !a || /^(total|sub-?total|итого|всего|gesamt|summe)/i.test(name) || !(CASH_WORD.test(title) || CASH_WORD.test(name))) return;
      const ccy = ccy3(ci >= 0 ? r[ci] : "") || ccy3(name) || ccy3(r[bal]) || (ctx && ctx.currency) || null;
      if(!ccy) return;
      added.push({id: `CASHTB:${si}:${added.length}:${name}`, broker: doc.broker, brokerShort: doc.brokerShort, type: "cash", symbol: ccy, name,
        value: a.value, ccy, priceDate: doc.asOf, page: sh.page});
    });
  });
  if(!added.length) return;
  doc.positions.push(...added);
  doc.note = [doc.note, WL.t(`деньги на счетах — из отдельной таблицы: ${added.length}`, `account cash from a separate table: ${added.length}`)].filter(Boolean).join(" · ");
}

/* Шаблон для тех, у кого выгрузки нет: понятные заголовки, точка с запятой и
   десятичная запятая — так Excel на русской раскладке открывает файл без вопросов. */
WL.sheetTemplate = function(){
  /* Английский шаблон — для Excel с английскими настройками: запятая между колонками, точка
     в числах, даты в виде 2024-03-14 (американское 03/14/2024 читалось бы как день.месяц).
     Итог по каждой валюте отдельно — тогда сверка с файлом сходится. Заголовки — точные
     синонимы из HEAD. */
  if(WL.lang === "en")
    return ["Broker,Name,Ticker,ISIN,Type,Quantity,Average cost price,Purchase date,Fees,Current price,Market value,Currency",
            "Charles Schwab,Apple Inc,AAPL,US0378331005,Stock,1000,150.25,2024-03-14,1.50,332.58,332580.00,USD",
            "Charles Schwab,MCD put 230,MCD260918P00230000,,Option,-100,2.99,2026-05-12,7.80,0.015,-150.00,USD",
            "UBS,Nestle,NESN,CH0038863350,Stock,500,92.40,2025-02-03,12.00,88.10,44050.00,CHF",
            "UBS,Cash,CHF,,Cash,,,,,,125000.00,CHF",
            "Total USD,,,,,,,,,,332430.00,USD",
            "Total CHF,,,,,,,,,,169050.00,CHF"].join("\n");
  return ["Брокер;Наименование;Тикер;Тип;Количество;Цена покупки;Дата покупки;Комиссия;Текущая цена;Стоимость;Валюта",
          "Charles Schwab;Apple Inc;AAPL;акция;1000;150,25;14.03.2024;1,50;332,58;332580,00;USD",
          "Charles Schwab;MCD пут 230;MCD260918P00230000;опцион;-100;2,99;12.05.2026;7,80;0,015;-150,00;USD",
          "UBS;Nestle;NESN;акция;500;92,40;03.02.2025;12,00;88,10;44050,00;CHF",
          "UBS;Денежные средства;CHF;деньги;;;;;;125000,00;CHF",
          "Итого USD;;;;;;;;;332430,00;USD",
          "Итого CHF;;;;;;;;;169050,00;CHF"].join("\n");
};
})();
