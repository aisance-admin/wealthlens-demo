/* Флоу велса · разбор выписок.
   Всё происходит в браузере: PDF не покидает компьютер. Разбор опирается на
   координаты текста — только так различаются колонки «списание» и «зачисление»,
   которые при чтении простого текста теряются. Каждый разбор сверяется с итогами
   самой выписки, и несошедшееся показывается, а не прячется. */
(function(){
const WL = window.WL = window.WL || {};
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const MONTHS = {January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8,
                September:9, October:10, November:11, December:12};
const pad = n => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dmy = s => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const round2 = v => Math.round(v * 100) / 100;
const isNumTok = s => /^\(?-?\$?\(?[\d,']*\d(\.\d+)?\)?%?$/.test(s);
// 1,234.56 · (1,234.56) · ($53,921.75) · 1'234.56 · -21.86 · 3.38%
const num = s => {
  if(s == null || !isNumTok(String(s).trim())) return null;
  const t = String(s).trim();
  const v = parseFloat(t.replace(/[^\d.]/g, ""));
  return isNaN(v) ? null : ((t.includes("(") || t.startsWith("-")) ? -v : v);
};
const check = (label, parsed, stated) => ({label, parsed, stated,
  ok: parsed != null && stated != null && Math.abs(parsed - stated) < 0.01});
const KEEP_UPPER = new Set(["ETF", "ADR", "TR", "SA", "NV", "N.V.", "US", "USA", "AG", "PLC"]);
const titleCase = s => String(s || "").split(/\s+/).map(w =>
  KEEP_UPPER.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()).join(" ");

async function pdfLines(buf){
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  const pages = [];
  for(let p = 1; p <= pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const vp = page.getViewport({scale: 1});
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str.trim()).map(i => ({
      s: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(vp.height - i.transform[5]),
      w: i.width || 0, h: Math.abs(i.transform[3]) || i.height || 8}));
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for(const it of items){
      const L = lines[lines.length - 1];
      if(L && Math.abs(L.y - it.y) <= 2) L.items.push(it); else lines.push({y: it.y, page: p, items: [it]});
    }
    lines.forEach(L => { L.items.sort((a, b) => a.x - b.x); L.text = L.items.map(i => i.s).join(" "); });
    pages.push(lines);
  }
  return pages;
}

/* ── Charles Schwab: месячный снимок позиций ─────────────────────────────── */
function parseSchwab(pages, fileName){
  const all = pages.flat();
  const text = all.map(l => l.text).join("\n");
  const doc = {broker: "Charles Schwab", brokerShort: "Schwab", kind: "positions", fileName,
               currency: "USD", positions: [], checks: [], transactions: [], summary: {}};
  const pm = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})-(\d{1,2}),\s+(\d{4})/.exec(text);
  if(pm){ doc.periodFrom = iso(pm[4], MONTHS[pm[1]], pm[2]); doc.asOf = iso(pm[4], MONTHS[pm[1]], pm[3]); }
  const nums = l => l ? l.items.map(i => i.s).filter(isNumTok).map(num) : [];
  const lineOf = re => all.find(l => re.test(l.text));
  // Сводка счёта стоит в правой колонке: на той же высоте слева идёт текст про
  // обслуживание, поэтому берём только числа правее середины страницы.
  const right = l => l ? l.items.filter(i => i.x >= 600 && isNumTok(i.s)).map(i => num(i.s)) : [];
  const pair = re => { const v = right(lineOf(re)); return {period: v[0] ?? null, ytd: v[1] ?? null}; };
  const S = doc.summary;
  S.beginning = pair(/Beginning Account Value \$/);
  S.deposits = pair(/\bDeposits \d/); S.withdrawals = pair(/\bWithdrawals [\d(]/);
  S.income = pair(/\bDividends and Interest \d/); S.transfers = pair(/\bTransfer of Securities \d/);
  S.market = pair(/\bMarket Appreciation/);
  S.ending = nums(lineOf(/^Ending Account Value \$/))[0] ?? null;
  S.unrealized = nums(lineOf(/^Unrealized \$/))[0] ?? null;
  const cash = nums(lineOf(/^Total Cash and Cash Investments/))[1] ?? null;

  const section = (from, to) => {
    const a = all.findIndex(l => from.test(l.text)); if(a < 0) return [];
    const b = all.findIndex((l, i) => i > a && to.test(l.text));
    return all.slice(a + 1, b < 0 ? undefined : b + 1);
  };
  const isSym = it => it && it.x < 40 && /^[A-Z][A-Z0-9.]{0,6}$/.test(it.s);
  const numbersRight = l => l.items.filter(it => it.x >= 300).map(it => /^N\/A/.test(it.s) ? null : num(it.s));

  // Акции. Над строкой позиции стоит строка-маркер: (M) и «i» в колонке себестоимости,
  // если та неполная. Неполную себестоимость показываем как неизвестную.
  const eq = section(/^Positions - Equities/, /^Total Equities/);
  let sumEq = 0;
  eq.forEach((l, i) => {
    if(/^Total Equities/.test(l.text)){ doc.checks.push(check(WL.t("Акции Schwab", "Schwab equities"), round2(sumEq), nums(l)[0])); return; }
    if(!isSym(l.items[0])) return;
    const v = numbersRight(l); if(v.length < 5) return;
    const prev = i > 0 && Math.abs(eq[i - 1].y - l.y) < 8 ? eq[i - 1] : null;
    const costFlag = !!prev && prev.items.some(it => it.s === "i" && it.x > 560 && it.x < 610);
    const [qty, price, value, cost, unreal] = v;
    const sym = l.items[0].s;
    const name = l.items.filter(it => it.x > 40 && it.x < 300 && it.s !== "F").map(it => it.s).join(" ");
    sumEq += value || 0;
    doc.positions.push({id: "SCHW:" + sym, broker: doc.broker, brokerShort: "Schwab", type: "stock",
      symbol: sym, name: titleCase(name), qty, price, priceDate: doc.asOf, value, ccy: "USD",
      cost: costFlag ? null : cost, costReported: cost,
      costNote: cost == null ? WL.t("нет в выписке", "not in the statement") : (costFlag ? WL.t("неполная в выписке", "incomplete in the statement") : null),
      unrealized: costFlag ? null : unreal, purchaseDate: null, commission: null});
  });

  // Опционы: символ и CALL/PUT в строке позиции, страйк и экспирация — строкой ниже.
  const op = section(/^Positions - Options/, /^Total Options/);
  let sumOp = 0;
  op.forEach((l, i) => {
    if(/^Total Options/.test(l.text)){ doc.checks.push(check(WL.t("Опционы Schwab", "Schwab options"), round2(sumOp), nums(l)[0])); return; }
    const d = l.items[1];
    if(!isSym(l.items[0]) || !d || !/^(CALL|PUT) /.test(d.s)) return;
    const [qty, price, value, cost, unreal] = numbersRight(l);
    let strike = null, expiry = null;
    for(const n of op.slice(i + 1, i + 4)){
      const st = n.items.find(it => /^\$[\d.]+$/.test(it.s));
      const ex = n.items.find(it => /^EXP \d{2}\/\d{2}\/\d{2}$/.test(it.s));
      if(st && ex){ strike = num(st.s); const m = /(\d{2})\/(\d{2})\/(\d{2})/.exec(ex.s); expiry = `20${m[3]}-${m[1]}-${m[2]}`; break; }
    }
    const root = l.items[0].s, right = d.s.startsWith("CALL") ? "C" : "P";
    const occ = expiry && strike != null
      ? root + expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10) + right + String(Math.round(strike * 1000)).padStart(8, "0")
      : null;
    sumOp += value || 0;
    doc.positions.push({id: "SCHW:" + (occ || root + i), broker: doc.broker, brokerShort: "Schwab", type: "option",
      right, underlying: root, underlyingName: titleCase(d.s.replace(/^(CALL|PUT) /, "")), strike, expiry, occ,
      multiplier: 100, qty, price, priceDate: doc.asOf, value, ccy: "USD", cost, unrealized: unreal,
      purchaseDate: null, commission: null,
      name: WL.t(`${root} ${right === "C" ? "колл" : "пут"} ${strike}`, `${root} ${strike} ${right === "C" ? "call" : "put"}`)});
  });

  if(cash != null) doc.positions.push({id: "SCHW:CASH:USD", broker: doc.broker, brokerShort: "Schwab", type: "cash",
    name: WL.t("Денежные средства", "Cash"), symbol: "USD", value: cash, ccy: "USD", priceDate: doc.asOf});
  const total = round2(doc.positions.reduce((a, p) => a + (p.value || 0), 0));
  doc.checks.push(check(WL.t("Итог счёта Schwab", "Schwab account total"), total, S.ending));

  // Операции месяца: дата, описание, сумма.
  section(/^Transaction Details/, /^Total Transactions/).forEach(l => {
    const m = /^(\d{2})\/(\d{2})\b/.exec(l.text);
    if(!m || l.items[0].x > 30 || !doc.asOf) return;
    const amt = l.items.filter(it => it.x > 600 && isNumTok(it.s)).map(it => num(it.s)).pop();
    doc.transactions.push({date: iso(doc.asOf.slice(0, 4), m[1], m[2]),
      text: l.text.replace(/^\d{2}\/\d{2}\s*/, "").replace(/[\d,]+\.\d{2,4}/g, "").trim(), amount: amt ?? null});
  });
  return doc;
}

/* ── Swissquote: кассовый журнал по валютам ──────────────────────────────── */
const OPT = /^([A-Z0-9]+) ([A-Z]{3})(\d{1,2}) ([\d.]+)([PC]) (Buy|Sell)$/;
const FUT = /^([A-Z]+) ([A-Z]{3})(\d{2}) (Buy|Sell)$/;
const VM = /^Variation Margin ([A-Z]+) ([A-Z]{3}\d{2})$/;

function parseSwissquote(pages, fileName){
  const all = pages.flat();
  const text = all.map(l => l.text).join("\n");
  const doc = {broker: "Swissquote Bank Europe", brokerShort: "Swissquote", kind: "ledger", fileName,
               records: [], checks: [], balances: {}, trades: [], vm: [], cancelled: []};
  const pm = /From (\d{2}\.\d{2}\.\d{4}) to (\d{2}\.\d{2}\.\d{4})/.exec(text);
  if(pm){ doc.periodFrom = dmy(pm[1]); doc.asOf = dmy(pm[2]); }
  const cl = /Closing balance ([\d']+\.\d{2}) ([A-Z]{3})/.exec(text);
  if(cl) doc.totalClosing = {value: num(cl[1]), ccy: cl[2]};

  let ccy = null, cols = null, prev = 0, cur = null;
  const flush = () => { if(cur){ doc.records.push(cur); cur = null; } };
  const NOISE = /^(This notification|Advice without|Swissquote Bank|\d+,? Rue |T: \+\d|Document generated|From \d|Information about|Balance at|Total debit|Total credit|Your account statement|Account statement fro)/;
  for(const l of all){
    const t = l.text; let m;
    if((m = /^Account statement in ([A-Z]{3})$/.exec(t))){ flush(); ccy = m[1]; prev = 0; continue; }
    if(!ccy) continue;
    if(/^DATE INFORMATION REFERENCE DEBIT CREDIT/.test(t)){
      const x = s => (l.items.find(i => i.s.startsWith(s)) || {}).x;
      cols = {ref: x("REFERENCE"), debit: x("DEBIT"), credit: x("CREDIT"), value: x("VALUE")};
      continue;
    }
    if(NOISE.test(t)) continue;
    const f = l.items[0];
    if(f.x < 60 && /^\d{2}\.\d{2}\.\d{4}$/.test(f.s) && cols){
      flush();
      const type = (l.items[1] || {}).s || "";
      const last = num(l.items[l.items.length - 1].s);
      if(/^Opening balance/.test(type)){ prev = last ?? 0; continue; }
      if(/^Closing balance/.test(type)){ doc.balances[ccy] = last; doc.checks.push(check(WL.t(`Остаток ${ccy} на конец`, `${ccy} closing balance`), round2(prev), last)); continue; }
      const rest = l.items.slice(2);
      const vd = rest.find(i => /^\d{2}\.\d{2}\.\d{4}$/.test(i.s));
      const ref = rest.find(i => /^\d{6,}$/.test(i.s) && i.x < cols.debit - 5);
      const amt = rest.find(i => i !== ref && i !== vd && /^-?[\d']+\.\d{2}$/.test(i.s)
                             && i.x > cols.ref + 20 && i.x < cols.value - 10);
      const side = amt ? (amt.x < (cols.debit + cols.credit) / 2 ? -1 : 1) : 0;
      const signed = amt ? side * Math.abs(num(amt.s)) : null;
      const ok = signed != null && last != null && Math.abs(round2(prev + signed) - last) < 0.006;
      cur = {ccy, date: dmy(f.s), type, ref: ref ? ref.s : null, amount: amt ? Math.abs(num(amt.s)) : null,
             signed, valueDate: vd ? dmy(vd.s) : null, balance: last, ok, detail: []};
      if(last != null) prev = last;
      continue;
    }
    if(cur && f.x >= 60 && f.x < 220) cur.detail.push(t);
  }
  flush();
  const okN = doc.records.filter(r => r.ok).length;
  doc.checks.unshift({label: WL.t("Строк журнала сверено с остатком", "Ledger lines reconciled to balance"), parsed: okN, stated: doc.records.length,
                      ok: okN === doc.records.length && okN > 0, count: true});

  // Одна сделка = одна ссылка: премия, комиссия и сбор идут под общим номером.
  // Сторно — та же ссылка с зеркальными суммами: такую сделку банк отменил.
  const byRef = new Map();
  doc.records.forEach(r => { if(r.ref){ if(!byRef.has(r.ref)) byRef.set(r.ref, []); byRef.get(r.ref).push(r); } });
  for(const [ref, rs] of byRef){
    if(rs.length >= 2 && Math.abs(rs.reduce((a, r) => a + r.signed, 0)) < 0.01){ doc.cancelled.push(ref); continue; }
    const d0 = rs[0].detail[0] || "";
    const o = OPT.exec(d0), fu = FUT.exec(d0);
    if(!o && !fu) continue;
    const q = /^Quantity: (\d+)/.exec(rs[0].detail[1] || "");
    const sum = re => -rs.filter(r => re.test(r.type)).reduce((a, r) => a + r.signed, 0);
    const premium = -sum(/^Option Premium/);
    const commission = sum(/^Commission$/), exchFees = sum(/^Exchange fees$/);
    doc.trades.push({ref, date: rs[0].date, ccy: rs[0].ccy, kind: o ? "option" : "future",
      side: o ? o[6] : fu[4], qty: q ? +q[1] : null, root: o ? o[1] : fu[1], month: o ? o[2] : fu[2],
      yearCode: o ? o[3] : fu[3], strike: o ? +o[4] : null, right: o ? o[5] : null,
      label: d0.replace(/ (Buy|Sell)$/, ""), premium: round2(premium), commission: round2(commission),
      exchFees: round2(exchFees), assigned: !!o && premium === 0 && commission === 0});
  }
  doc.records.forEach(r => {
    const m = r.type === "Transfer" && VM.exec(r.detail[0] || "");
    if(!m) return;
    const px = /(Prev Sett|open) ([\d.]+), (Sett|close) ([\d.]+)/.exec(r.detail[1] || "");
    doc.vm.push({date: r.date, contract: `${m[1]} ${m[2]}`, root: m[1], signed: r.signed,
                 from: px ? +px[2] : null, to: px ? +px[4] : null, opening: px ? px[1] === "open" : false,
                 closing: px ? px[3] === "close" : false});
  });
  return doc;
}

/* ── Любой другой PDF: таблицы по координатам текста ────────────────────────
   Строки уже собраны по высоте; куски текста без заметного промежутка — одна ячейка. Документ режется
   на таблицы по строкам-шапкам: та же шапка на следующей странице или в следующем разделе продолжает
   таблицу, другая (операции после позиций) начинает новую. Колонки считаются отдельно для каждого
   куска между шапками — вертикальные полосы, занятые текстом в строках с числами и разделённые
   просветами от 5 pt: у разделов и страниц своя ширина колонок, и общие полосы слипаются. Затем
   куски сводятся в одну таблицу по названиям колонок. Дальше таблицы идут в тот же разбор, что CSV
   и Excel, а пользователь проверяет колонки перед импортом. */
const NUMLIKE = /^[(\-−+]?\s?(?:[$€£]|CHF|USD|EUR|GBP)?\s?\d[\d\s'’.,]*\)?\s?%?$/;
const isNumCell = c => NUMLIKE.test(c.s);
function lineCells(L){
  const cells = [];
  for(const it of L.items){
    const c = cells[cells.length - 1], x2 = it.x + (it.w || it.s.length * 4.5);
    const gap = c ? it.x - c.x2 : Infinity;
    if(c && gap < Math.max(2.5, it.h * 0.55)){ c.s += (gap > 0.8 ? " " : "") + it.s; c.x2 = Math.max(c.x2, x2); }
    else cells.push({s: it.s, x: it.x, x2});
  }
  return cells;
}
// Шапка — строка без чисел, в которой узнаются хотя бы два поля: «Description · Quantity · Market value».
// Любая колонка даты («Date», «Datum», «Valuta») тоже в ключе: по ней операции отличаются от позиций.
function headKeyOf(cells){
  if(cells.length < 2 || cells.some(isNumCell) || !WL.sheetMap) return null;
  const k = Object.keys(WL.sheetMap(cells.map(c => c.s)));
  if(!k.includes("date") && cells.some(c => /(^|\s)(date|datum|дата|valuta|booking)(\s|$)/i.test(c.s))) k.push("date");
  return k.length >= 2 ? k.sort() : null;
}
const positional = k => (k.includes("name") || k.includes("ticker")) && (k.includes("qty") || k.includes("value"));
// Шапка с чуть другим набором полей — та же таблица, если выписка разбита по классам активов или pdf.js
// иначе склеил слова на новой странице: меньший набор — часть большего, в нём от трёх полей, а дата
// есть либо в обоих, либо ни в одном. «Description · Amount» операций к позициям так не приклеится.
function sameTable(a, b){
  if(a.join() === b.join()) return true;
  if(!positional(a) || !positional(b) || a.includes("date") !== b.includes("date")) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  return small.length >= 3 && small.every(f => big.includes(f));
}
// Заголовок раздела над шапкой («Positions», «Акции») — короткая строка без чисел.
const isTitle = cells => cells.length <= 2 && !cells.some(isNumCell) && cells.map(c => c.s).join(" ").length <= 48;
// Раздел выписки задаёт класс бумаг под ним: «Bonds», «Облигации», «Cash».
const SECTION = /^(equities|equity|shares|stocks|bonds|fixed income|cash|cash accounts|accounts|liquidity|funds|investment funds|structured products|options|futures|акции|облигации|фонды|денежные средства|деньги|aktien|anleihen|obligationen|liquidität|konten|fonds|actions|obligations|liquidités|comptes)(\s*\(.*\))?:?$/i;

function bandsOf(rows){
  const data = rows.filter(cells => cells.length >= 3 && cells.some(isNumCell));
  if(!data.length) return null;
  const W = Math.ceil(rows.reduce((m, cells) => cells.reduce((mm, c) => Math.max(mm, c.x2), m), 0)) + 2;
  const occ = new Uint16Array(W);
  data.forEach(cells => cells.forEach(c => { for(let x = Math.max(0, Math.floor(c.x)); x < Math.min(W, Math.ceil(c.x2)); x++) occ[x]++; }));
  const thr = Math.floor(data.length * 0.03), cols = [];
  let start = -1, last = -1, gap = 0;
  for(let x = 0; x < W; x++){
    if(occ[x] > thr){ if(start < 0) start = x; last = x; gap = 0; }
    else if(start >= 0 && ++gap >= 5){ cols.push([start, last + 1]); start = -1; gap = 0; }
  }
  if(start >= 0) cols.push([start, last + 1]);
  return {cols, data: data.length};
}
function place(cells, cols){
  const arr = new Array(cols.length).fill("");
  cells.forEach(c => {
    let best = 0, ov = -Infinity;
    cols.forEach(([a, b], i) => { const o = Math.min(b, c.x2) - Math.max(a, c.x); if(o > ov){ ov = o; best = i; } });
    arr[best] = arr[best] ? arr[best] + " " + c.s : c.s;
  });
  return arr;
}
// Куски одной таблицы (разделы, страницы) → общая сетка: колонка куска попадает в колонку с тем же
// полем, потом с той же подписью, а без подписи — в ту, над которой стоит.
function alignBlocks(blocks){
  const names = [], fields = [], xs = [], out = [], titles = [];
  let head = 0, data = 0, lastCols = null;
  blocks.forEach((bl, bi) => {
    const band = bandsOf(bl.rows);
    data += band ? band.data : 0;
    const cols = band && band.cols.length >= 2 ? band.cols : lastCols || bl.rows[bl.head].map(c => [c.x, c.x2]);
    lastCols = cols;
    const grid = bl.rows.map(cells => place(cells, cols));
    const hdr = grid[bl.head], fieldAt = {};
    Object.entries(WL.sheetMap(hdr)).forEach(([f, i]) => { fieldAt[i] = f; });
    const target = cols.map(([x1, x2], j) => {
      const f = fieldAt[j] || null, name = hdr[j].replace(/\s+/g, " ").trim();
      let t = f ? fields.indexOf(f) : -1;
      if(t < 0 && name) t = names.findIndex(n => n.toLowerCase() === name.toLowerCase());
      if(t < 0 && !name && !f){ let ov = 0; xs.forEach(([a, b], i) => { const o = Math.min(b, x2) - Math.max(a, x1); if(o > ov){ ov = o; t = i; } }); }
      if(t < 0){ names.push(name); fields.push(f); xs.push([x1, x2]); t = names.length - 1; }
      return t;
    });
    grid.forEach((cells, ri) => {
      if(bi > 0 && ri === bl.head) return;                       // повтор шапки в таблицу не идёт
      if(ri === bl.head - 1) titles.push(cells.filter(Boolean).join(" ").replace(/\s*\(.*\)\s*:?$/, ""));
      const row = [];
      cells.forEach((v, j) => { if(v) row[target[j]] = row[target[j]] ? row[target[j]] + " " + v : v; });
      if(bi === 0 && ri === bl.head) head = out.length;
      out.push(row);
    });
  });
  if(!data) return null;
  const rows = out.map(r => Array.from({length: names.length}, (_, i) => r[i] || ""));
  rows[head] = names.map((n, i) => n || rows[head][i]);
  // Класс актива по разделам — отдельной колонкой, если своей в выписке нет.
  if(!fields.includes("type")){
    let cls = "", any = false;
    const col = rows.map((r, i) => {
      const filled = r.filter(Boolean);
      if(filled.length === 1 && !NUMLIKE.test(filled[0]) && SECTION.test(filled[0].trim())){
        cls = filled[0].replace(/\s*\(.*\)\s*:?$/, "").trim(); any = true; return "";
      }
      return i > head ? cls : "";
    });
    if(any) rows.forEach((r, i) => r.push(i === head ? "Asset class" : col[i]));
  }
  const name = [...new Set(titles.filter(Boolean))].join(" · ");
  return {name: name.length > 48 ? name.slice(0, 47) + "…" : name, rows, head};
}
function pdfTables(pages){
  const rows = pages.flat().map(lineCells);
  const parts = [];
  let cur = {key: null, blocks: [{head: -1, rows: []}]};
  rows.forEach(cells => {
    const k = headKeyOf(cells);
    const last = cur.blocks[cur.blocks.length - 1];
    if(!k){ last.rows.push(cells); return; }
    // Заголовок раздела над шапкой переезжает к ней: «Bonds» относится к таблице ниже.
    const lead = [];
    if(last.rows.length > last.head + 1 && isTitle(last.rows[last.rows.length - 1])) lead.push(last.rows.pop());
    const bl = {head: lead.length, rows: [...lead, cells]};
    if(cur.key && sameTable(cur.key, k)) cur.blocks.push(bl);
    else { parts.push(cur); cur = {key: k, blocks: [bl]}; }
  });
  parts.push(cur);
  const headed = parts.some(p => p.key), tables = [];
  parts.forEach(p => {
    if(p.key){ const t = alignBlocks(p.blocks); if(t) tables.push(t); return; }
    if(headed) return;                          // текст до первой шапки: адрес, реквизиты, сводка
    // Шапку узнать не удалось: одна сетка на весь документ с первой строки, похожей на таблицу.
    let src = p.blocks[0].rows;
    const first = src.findIndex(cells => cells.length >= 3 && cells.some(isNumCell));
    src = src.slice(Math.max(0, first - 3));
    const band = bandsOf(src);
    if(band && band.data >= 2 && band.cols.length >= 3) tables.push({name: "", rows: src.map(cells => place(cells, band.cols))});
  });
  return tables;
}

/* Дата оценки и банк — из шапки первой страницы: над таблицей в PDF их нет, а молча брать
   сегодняшнюю дату нельзя. Дата после «as of», «per», «по состоянию на» или конец периода важнее
   первой попавшейся. */
const MON_PREFIX = [["jan", 1], ["jän", 1], ["янв", 1], ["feb", 2], ["fév", 2], ["fev", 2], ["фев", 2], ["mar", 3], ["mär", 3], ["мар", 3],
  ["apr", 4], ["avr", 4], ["апр", 4], ["may", 5], ["mai", 5], ["мая", 5], ["май", 5], ["juin", 6], ["jun", 6], ["июн", 6],
  ["juil", 7], ["jul", 7], ["июл", 7], ["aug", 8], ["aoû", 8], ["aou", 8], ["авг", 8], ["sep", 9], ["сен", 9],
  ["oct", 10], ["okt", 10], ["окт", 10], ["nov", 11], ["ноя", 11], ["dec", 12], ["dez", 12], ["déc", 12], ["дек", 12]];
const monthOf = w => { const l = String(w || "").toLowerCase(); const m = MON_PREFIX.find(([p]) => l.startsWith(p)); return m ? m[1] : null; };
function pdfDate(text, keyed){
  const found = [];
  const add = (idx, len, y, m, d) => { y = +y; m = +m; d = +d;
    if(y >= 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) found.push({idx, end: idx + len, v: iso(y, m, d)}); };
  let r;
  const numRe = /\b(\d{1,2})([./-])(\d{1,2})\2(20\d\d)\b|\b(20\d\d)-(\d{2})-(\d{2})\b/g;
  while((r = numRe.exec(text))){
    if(r[5]) add(r.index, r[0].length, r[5], r[6], r[7]);
    // Через косую черту американский порядок встречается чаще: 08/31/2026. Иначе — день первым.
    else if(r[2] === "/" && +r[3] > 12) add(r.index, r[0].length, r[4], r[1], r[3]);
    else add(r.index, r[0].length, r[4], r[3], r[1]);
  }
  const wordRe = /\b(\d{1,2})\.?\s+([A-Za-zÀ-ÿА-Яа-яЁё]{3,})\.?,?\s+(20\d\d)\b|\b([A-Za-zÀ-ÿ]{3,})\.?\s+(\d{1,2}),?\s+(20\d\d)\b/g;
  while((r = wordRe.exec(text))){
    const m = monthOf(r[2] || r[4]);
    if(m) add(r.index, r[0].length, r[3] || r[6], m, r[1] || r[5]);
  }
  if(!found.length) return null;
  const KEY = /(as of|as at|valuation|statement date|report date|closing date|\bper\b|\bstand\b|\bau\b|\bdu\b|по состоянию|на дату|\bна\b|\bdate\b)[^\n\d]{0,12}$/i;
  const score = f => {
    const before = text.slice(Math.max(0, f.idx - 40), f.idx);
    let s = KEY.test(before) ? 3 : 0;
    if(/(-|–|—|\bto\b|\bbis\b|\bau\b|\bпо\b)\s*$/i.test(before) && found.some(g => g.end <= f.idx && f.idx - g.end < 8)) s += 2;
    return s;
  };
  const best = found.map(f => ({...f, s: score(f)})).sort((a, b) => b.s - a.s || a.idx - b.idx)[0];
  return keyed && best.s < 3 ? null : best.v;
}
function pdfBank(lines){
  const known = WL.brokerByName ? lines.map(WL.brokerByName).find(Boolean) : null;
  if(known) return known;
  const BANK = /\b(bank|banque|banca|banco|bankhaus|privatbank|securities|brokerage|brokers?|wealth management|asset management|trust company|банк|брокер)\b/i;
  const small = /^(&|and|und|et|of|de|du|des|la|le|di|y|и)$/i;
  return lines.slice(0, 12).find(s => BANK.test(s) && s.length <= 48 && !/\d/.test(s) &&
    s.split(/\s+/).length <= 6 && s.split(/\s+/).every(w => small.test(w) || /^[A-ZÀ-ÞА-ЯЁ"«(]/.test(w))) || null;
}

WL.parseFile = async function(file){
  // Таблицу разбирает sheet.js: у выгрузки колонки уже размечены, и гадать не нужно.
  if(!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return WL.parseSheet(file);
  const pages = await pdfLines(await file.arrayBuffer());
  const head = pages.slice(0, 2).flat().map(l => l.text).join("\n");
  if(/Schwab One|Charles Schwab/.test(head)) return parseSchwab(pages, file.name);
  if(/Swissquote Bank/.test(head)) return parseSwissquote(pages, file.name);
  // Скан — это картинка без текста: читать в нём нечего, и сказать надо именно это.
  if(!pages.some(lines => lines.length)) return {unknown: true, fileName: file.name, pdf: true, scan: true};
  const tables = pdfTables(pages);
  // Шапка документа — строки первой страницы до первой таблицы: ниже в позициях свои даты
  // (погашения) и свои банки («UBS Group AG» среди акций).
  const p1 = pages[0] || [];
  const cut = p1.findIndex(L => { const cells = lineCells(L); return headKeyOf(cells) || (cells.length >= 3 && cells.some(isNumCell)); });
  const top = p1.slice(0, cut < 0 ? 12 : Math.min(cut, 12)).map(l => l.text);
  const ctx = {asOf: pdfDate(top.join("\n")) || pdfDate(p1.map(l => l.text).join("\n"), true), broker: pdfBank(top)};
  const doc = tables.length && WL.parseRows ? WL.parseRows(tables, file, ctx) : null;
  // Узнанной шапки нет: разметку предлагаем, только если в файле правда есть таблица с числами —
  // иначе договор или письмо откроются «таблицей» из дат, номеров пунктов и страниц.
  const tabular = sh => sh.rows.filter(r => r.filter(c => c && NUMLIKE.test(c)).length >= 2 && r.some(c => c && !NUMLIKE.test(c))).length >= 3;
  if(!doc || (doc.unknown && !doc.sheets.some(tabular))) return {unknown: true, fileName: file.name, pdf: true};
  return doc;
};
WL.util = {num, dmy, iso, pad, round2, titleCase};
})();
