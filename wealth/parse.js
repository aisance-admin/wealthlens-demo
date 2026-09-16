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
  // isEvalSupported: false — рекомендованная Mozilla защита от CVE-2024-4367 для PDF.js до 4.2.67: шрифты из чужого файла
  // не превращаются в исполняемый код.
  const pdf = await pdfjsLib.getDocument({data: buf, isEvalSupported: false}).promise;
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
  let cash = nums(lineOf(/^Total Cash and Cash Investments/))[1] ?? null;
  // В новом шаблоне страница с деньгами и сводкой бывает картинкой без текста (так её сохраняют программы
  // для закрашивания реквизитов). Тогда деньги и итог счёта берём из «Asset Allocation» — она текстом.
  const alloc = re => { const l = lineOf(re), it = l && l.items.find(i => i.x > 200 && i.x < 420 && isNumTok(i.s)); return it ? num(it.s) : null; };
  if(cash == null) cash = alloc(/^Cash and Cash Investments \$?[\d(]/);
  if(S.ending == null) S.ending = alloc(/^Total \$[\d(]/);
  doc.imagePages = pages.map((ls, i) => ls.length ? 0 : i + 1).filter(Boolean);

  const section = (from, to) => {
    const a = all.findIndex(l => from.test(l.text)); if(a < 0) return [];
    const b = all.findIndex((l, i) => i > a && to.test(l.text));
    return all.slice(a + 1, b < 0 ? undefined : b + 1);
  };
  const isSym = it => it && it.x < 40 && /^[A-Z][A-Z0-9.]{0,6}$/.test(it.s);
  /* Числа позиции раскладываем по колонкам шапки над строкой, а не по порядку: пометка короткой позиции «S»
     стоит между количеством и ценой, и порядок сдвигал стоимость в цену. Шапки нет (другой шаблон) — по порядку. */
  const mid = it => it.x + (it.w || it.s.length * 4.5) / 2;
  const HEADS = [["qty", /^Quantity/], ["price", /^Price/], ["value", /^Market Value/], ["cost", /^Cost Basis/], ["unreal", /^Gain/]];
  const heads = all.filter(l => l.items.some(i => /^Market Value/.test(i.s)) && l.items.some(i => /^Quantity/.test(i.s)))
    .map(l => ({page: l.page, y: l.y, cols: HEADS.map(([k, re]) => { const it = l.items.find(i => re.test(i.s)); return it && {k, c: mid(it)}; }).filter(Boolean)}));
  const numbersOf = (items, at) => {
    const cells = items.filter(it => it.x >= 300 && (isNumTok(it.s) || /^N\/A/.test(it.s)));
    const h = heads.filter(x => x.page === at.page && x.y < at.y).pop();
    if(!h || h.cols.length < 5){ const v = cells.map(it => /^N\/A/.test(it.s) ? null : num(it.s)); return {qty: v[0], price: v[1], value: v[2], cost: v[3], unreal: v[4]}; }
    const out = {};
    cells.forEach(it => {
      const c = h.cols.reduce((a, b) => Math.abs(mid(it) - b.c) < Math.abs(mid(it) - a.c) ? b : a);
      if(Math.abs(mid(it) - c.c) < 45 && !(c.k in out)) out[c.k] = /^N\/A/.test(it.s) ? null : num(it.s);
    });
    return out;
  };
  // Строка позиции бывает разорвана: пометка «S» на 3 pt выше, название — на 3 pt ниже. Собираем всё в пределах
  // 4 pt от строки с тикером, если там не начинается другая позиция.
  const rowItems = (sec, l) => [...l.items, ...sec.filter(m => m !== l && m.page === l.page && Math.abs(m.y - l.y) <= 4 && !isSym(m.items[0])).flatMap(m => m.items)]
    .sort((a, b) => a.x - b.x);

  // Акции. Над строкой позиции стоит строка-маркер: (M) и «i» в колонке себестоимости,
  // если та неполная. Неполную себестоимость показываем как неизвестную.
  const eq = section(/^Positions - Equities/, /^Total Equities/);
  let sumEq = 0;
  eq.forEach((l, i) => {
    if(/^Total Equities/.test(l.text)){ doc.checks.push(check(WL.t("Акции Schwab", "Schwab equities"), round2(sumEq), nums(l)[0])); return; }
    if(!isSym(l.items[0])) return;
    const items = rowItems(eq, l);
    const {qty, price, value, cost, unreal} = numbersOf(items, l);
    if(qty == null && value == null) return;
    const prev = i > 0 && Math.abs(eq[i - 1].y - l.y) < 8 ? eq[i - 1] : null;
    const costFlag = !!prev && prev.items.some(it => it.s === "i" && it.x > 560 && it.x < 610);
    const sym = l.items[0].s;
    const name = items.filter(it => it.x > 40 && it.x < 300 && it.s !== "F").map(it => it.s).join(" ");
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
    if(!isSym(l.items[0])) return;
    const items = rowItems(op, l), d = items.find(it => it.x > 40 && it.x < 300 && /^(CALL|PUT) /.test(it.s));
    if(!d) return;
    const {qty, price, value, cost, unreal} = numbersOf(items, l);
    // Страйк и экспирация — в строках под позицией. «ADJ EXP» и «REPS 100 FDX+50 FDXF» — скорректированный контракт:
    // поставка по нему не 100 акций одного тикера, и сравнивать страйк с ценой одной акции нельзя.
    let strike = null, expiry = null, adjusted = false, deliverable = null;
    for(const n of op.filter(m => m.page === l.page && m.y > l.y + 4 && m.y <= l.y + 44 && !isSym(m.items[0]))){
      const st = n.items.find(it => /^\$[\d.]+$/.test(it.s));
      const ex = n.items.find(it => /^(ADJ )?EXP \d{2}\/\d{2}\/\d{2}$/.test(it.s));
      if(st && ex && strike == null){ strike = num(st.s); adjusted = /^ADJ/.test(ex.s); const m = /(\d{2})\/(\d{2})\/(\d{2})/.exec(ex.s); expiry = `20${m[3]}-${m[1]}-${m[2]}`; }
      const rep = n.items.find(it => /^REPS /.test(it.s));
      if(rep) deliverable = rep.s.replace(/^REPS\s+/, "").replace(/\s*\+\s*/g, " + ");
    }
    const root = l.items[0].s, right = d.s.startsWith("CALL") ? "C" : "P";
    if(deliverable) adjusted = true;
    const occ = expiry && strike != null
      ? root + expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10) + right + String(Math.round(strike * 1000)).padStart(8, "0")
      : null;
    sumOp += value || 0;
    doc.positions.push({id: "SCHW:" + (occ || root + i), broker: doc.broker, brokerShort: "Schwab", type: "option",
      right, underlying: adjusted ? root.replace(/\d+$/, "") : root, underlyingName: titleCase(d.s.replace(/^(CALL|PUT) /, "")), strike, expiry, occ,
      adjusted: adjusted || undefined, deliverable: deliverable || undefined,
      multiplier: 100, qty, price, priceDate: doc.asOf, value, ccy: "USD", cost, unrealized: unreal,
      purchaseDate: null, commission: null,
      name: WL.t(`${root} ${right === "C" ? "колл" : "пут"} ${strike}`, `${root} ${strike} ${right === "C" ? "call" : "put"}`)});
  });

  if(cash != null) doc.positions.push({id: "SCHW:CASH:USD", broker: doc.broker, brokerShort: "Schwab", type: "cash",
    name: WL.t("Денежные средства", "Cash"), symbol: "USD", value: cash, ccy: "USD", priceDate: doc.asOf});
  const total = round2(doc.positions.reduce((a, p) => a + (p.value || 0), 0));
  doc.checks.push(check(WL.t("Итог счёта Schwab", "Schwab account total"), total, S.ending));
  // Страницы-картинки молча пропускать нельзя: если итог не сошёлся, на них и лежит недостающее.
  if(doc.imagePages.length && doc.checks.some(c => !c.ok))
    doc.note = WL.t(`страницы ${doc.imagePages.join(", ")} — картинки без текста, позиции на них не прочитаны`,
      `pages ${doc.imagePages.join(", ")} are images without text; positions on them were not read`);

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

/* ── Частные банки: «Detailed positions» (EFG и похожие) ────────────────────────
   Одна таблица на много страниц: CCY | NOMINAL | DESCRIPTION | COST PRICE | COST VALUE | MARKET PRICE | MARKET VALUE |
   WEIGHT | P/L. Позиция — строка с кодом валюты слева; под ней купон и погашение, накопленный купонный доход (НКД)
   в колонке стоимости, ISIN. Разделы (CASH…, BONDS, EQUITIES) и подразделы («Bonds», «Investment Funds») задают класс.
   Числа выровнены по правому краю, поэтому колонку определяем по правому краю числа между началами заголовков.
   Сверка: итоги разделов, «Total market value», «Total accrued interest» и «TOTAL NET ASSETS». НКД — отдельной
   строкой: в рыночной стоимости бумаг его нет, а в чистых активах счёта он есть. */
const MON3 = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
function parseDetailed(pages, fileName){
  const all = pages.flat();
  const title = all.find(l => /^DETAILED POSITIONS OF PORTFOLIO/i.test(l.text));
  const valCcy = (/Val\. Ccy ([A-Z]{3})/.exec(title.text) || [])[1] || "USD";
  const known = WL.brokerByName ? all.map(l => WL.brokerByName(l.text)).find(Boolean) : null;
  const broker = known || pdfBank(all.slice(0, 60).map(l => l.text)) || WL.t("Частный банк", "Private bank");
  const doc = {broker, brokerShort: broker.length <= 22 ? broker : broker.slice(0, 21) + "…", kind: "positions", fileName,
    asOf: pdfDate(title.text), currency: valCcy, positions: [], checks: [], transactions: []};
  const head = all.find(l => l.items.some(i => /^CCY$/.test(i.s)) && l.items.some(i => /^NOMINAL$/.test(i.s)) && l.items.some(i => /^MARKET VALUE/.test(i.s)));
  const at = re => { const it = head.items.find(i => re.test(i.s)); return it ? it.x : null; };
  const X = {costPrice: at(/^COST PRICE/), costValue: at(/^COST VALUE/), marketPrice: at(/^MARKET PRICE/), marketValue: at(/^MARKET VALUE/),
             weight: 685, pl: at(/^UNREALIZED/)};
  const right = it => it.x + (it.w || it.s.length * 4.5);
  const isNum = s => /^-?[\d',]*\d(\.\d+)?%?$/.test(s);
  const val = s => { const v = parseFloat(String(s).replace(/[',%]/g, "")); return isFinite(v) ? v : null; };
  // Колонка числа: полоса от начала своего заголовка до начала следующего, по правому краю числа.
  const bands = [["costPrice", X.costPrice], ["costValue", X.costValue], ["marketPrice", X.marketPrice], ["marketValue", X.marketValue],
                 ["weight", X.marketValue != null ? X.marketValue + 64 : null], ["pl", X.pl]].filter(b => b[1] != null);
  const colOf = it => { const r = right(it); let k = null; bands.forEach(([name, x]) => { if(r > x + 4) k = name; }); return k; };
  const isHeadLine = l => l === head || /^(CCY|MATURITY DATE|PORTF\.|MARKET P\/L)/.test(l.text) || /^DETAILED POSITIONS/i.test(l.text) || /^Page \d+ \/ \d+$/.test(l.text) ||
    l.items.some(i => /^(COST PRICE|FX RATE|ACCRUED INTEREST|WEIGHT|MARKET P\/L|CURRENCY P\/L)/.test(i.s));
  const dateOf = s => { const m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(s); return m && MON3[m[2].toLowerCase()] ? iso(m[3], MON3[m[2].toLowerCase()], m[1]) : null; };
  const classOf = (sec, sub) => /cash/i.test(sub || sec) && !/fund/i.test(sub || "") ? "cash"
    : /fund|etf|sicav|ucits/i.test(sub || "") ? "fund" : /bond|note|fixed income|convertible/i.test(sub || "") ? "bond"
    : /share|stock|equit/i.test(sub || "") ? "stock" : /structured/i.test(sub || "") ? "note"
    : /bond|fixed income/i.test(sec) ? "bond" : /equit/i.test(sec) ? "stock" : /cash|liquid/i.test(sec) ? "cash" : "other";

  const rows = [], totals = {}, secTotals = [];
  let sec = null, sub = null, cur = null, starts = 0, page = 0, pageTop = false;
  for(const l of all){
    if(l.page < title.page || isHeadLine(l)) continue;
    if(l.page !== page){ page = l.page; pageTop = true; }
    const top = pageTop; pageTop = false;
    const f = l.items[0], nums = l.items.filter(it => isNum(it.s));
    let m;
    if((m = /^(Total market value|Total accrued interest|TOTAL NET ASSETS)/i.exec(l.text)) && nums.length){ totals[m[1].toLowerCase()] = val(nums[nums.length - 1].s); cur = null; continue; }
    if(/^YEAR-TO-DATE|^DISCLAIMER|^TRANSACTIONS/i.test(l.text)) break;
    // Раздел: заглавные буквы слева, итог и доля портфеля.
    if(f.x < 80 && /^[A-Z][A-Z &,/-]{2,}$/.test(f.s) && !/^[A-Z]{3}$/.test(f.s)){
      sec = f.s; sub = null; cur = null;
      const t = nums.find(it => !/%$/.test(it.s));
      if(t) secTotals.push({sec, value: val(t.s), rows: []});
      continue;
    }
    // Позиция: код валюты слева. У денежного счёта сумма и описание слиты в одну ячейку.
    if(f.x < 80 && /^[A-Z]{3}$/.test(f.s) && sec){
      starts++;
      const second = l.items[1] || {s: ""};
      const glued = /^(-?[\d',]*\d(?:\.\d+)?) (.+)$/.exec(second.s);
      const nominalIt = glued ? null : l.items.find(it => it !== f && it.x < 125 && isNum(it.s));
      const nominal = glued ? val(glued[1]) : nominalIt ? val(nominalIt.s) : null;
      const desc = glued ? glued[2] : l.items.filter(it => it.x >= 120 && it.x < (X.costPrice || 420) - 10 && !isNum(it.s)).map(it => it.s).join(" ");
      const cells = {};
      l.items.filter(it => it.x > 300 && isNum(it.s)).forEach(it => {
        const k = /%$/.test(it.s) ? (cells.weight == null && right(it) < (X.pl || 740) ? "weight" : "plPct") : colOf(it);
        if(k && cells[k] == null) cells[k] = val(it.s);
      });
      cur = {ccy: f.s, nominal, desc, cells, lines: [], sec, sub, page: l.page};
      rows.push(cur);
      const st = secTotals[secTotals.length - 1]; if(st && st.sec === sec) st.rows.push(cur);
      continue;
    }
    // Подраздел: текст у колонки описания; с итогом и долей — в начале, без чисел — продолжение на новой странице.
    // На новой странице таблица продолжается названием подраздела без итога.
    if(f.x > 100 && f.x < 150 && (nums.some(it => /%$/.test(it.s)) || (top && !nums.length))){
      sub = l.items.filter(it => !isNum(it.s)).map(it => it.s).join(" "); cur = null; continue;
    }
    if(cur) cur.lines.push(l);
  }

  const pos = [];
  rows.forEach((r, i) => {
    const type = classOf(r.sec, r.sub);
    const info = r.lines.map(L => L.text);
    const isinLine = info.find(t => /^ISIN [A-Z]{2}[A-Z0-9]{9}\d/.test(t));
    const isin = isinLine ? /^ISIN ([A-Z]{2}[A-Z0-9]{9}\d)/.exec(isinLine)[1] : null;
    let accrued = null, maturity = null, priceDate = null, coupon = null;
    r.lines.forEach(L => L.items.forEach(it => {
      const d = dateOf(it.s); if(d && it.x > 330 && it.x < 420 && !maturity) maturity = d;
      const pd = /^\(as at (\d{2})-(\d{2})-(\d{2})\)$/.exec(it.s); if(pd) priceDate = iso("20" + pd[3], pd[2], pd[1]);
      if(isNum(it.s) && !/%$/.test(it.s) && colOf(it) === "marketValue" && accrued == null) accrued = val(it.s);
    }));
    const cp = info.map(t => /^(\d+(?:\.\d+)?) ?% /.exec(t)).find(Boolean); if(cp) coupon = +cp[1];
    // Продолжение названия (у длинных фондов) — строки до краткого имени «…/Sh USD» и до ISIN, не купон и не условия.
    const cont = [];
    for(const t of info){ if(/^ISIN |\/Sh\b|\/SH\b|^(Half-yearly|Quarterly|Annual|Monthly|Yearly|for a price|Rating|Last acq)|^\d+(\.\d+)? ?% /i.test(t) || cont.length >= 1) break; cont.push(t.replace(/ \(as at .*\)$/, "")); }
    const c = r.cells, mvRef = c.marketValue ?? null;
    const unit = type === "bond" || type === "note" ? 100 : 1;
    const native = r.nominal != null && c.marketPrice != null ? Math.round(r.nominal * c.marketPrice / unit * 100) / 100 : null;
    const base = {id: `DET:${isin || r.ccy + ":" + i}`, broker: doc.broker, brokerShort: doc.brokerShort, ccy: r.ccy, isin,
      priceDate: priceDate || doc.asOf, valueRef: mvRef, refCcy: valCcy, page: r.page};
    if(type === "cash"){
      pos.push({...base, type: "cash", symbol: r.ccy, name: WL.t(`Текущий счёт ${r.ccy}`, `Current account ${r.ccy}`),
        value: r.ccy === valCcy ? mvRef ?? r.nominal : r.nominal});
      return;
    }
    // Стоимость в валюте бумаги: номинал × цена (для облигаций — в процентах номинала). Для валюты отчёта сверяем с колонкой банка.
    const value = r.ccy === valCcy ? mvRef : native;
    let name = [r.desc, ...cont].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if(type === "bond" && coupon != null) name += ` ${coupon}%` + (maturity ? ` ${maturity.slice(0, 4)}` : "");
    pos.push({...base, type, name, symbol: null, qty: r.nominal, price: c.marketPrice ?? null, priceBasis: unit === 100 ? "percent" : "unit",
      value: value ?? mvRef, ccy: value != null ? r.ccy : valCcy, cost: r.ccy === valCcy ? c.costValue ?? null : null,
      costNote: r.ccy === valCcy ? null : WL.t("себестоимость в выписке — в валюте отчёта", "cost is shown in the report currency"),
      costPrice: c.costPrice ?? null, unrealized: r.ccy === valCcy ? c.pl ?? null : null, accruedRef: accrued, maturity, coupon,
      purchaseDate: null, commission: null,
      purchaseNote: (info.find(t => /^Last acq\. /.test(t)) || "").replace(/^Last acq\. ([A-Za-z]{3} \d{4}).*$/, "$1") || null});
  });
  const accruedTotal = Math.round(pos.reduce((a, p) => a + (p.accruedRef || 0), 0) * 100) / 100;
  doc.positions = pos.slice();
  if(accruedTotal) doc.positions.push({id: "DET:ACCRUED", broker: doc.broker, brokerShort: doc.brokerShort, type: "bond", accruedLine: true,
    name: WL.t("Накопленный купонный доход", "Accrued interest"), symbol: null, qty: null, price: null, value: accruedTotal, ccy: valCcy,
    valueRef: accruedTotal, refCcy: valCcy, priceDate: doc.asOf, cost: null, costNote: WL.t("не бумага: купон, накопленный к дате выписки", "not a security: coupon accrued to the statement date")});

  const ref = ps => Math.round(ps.reduce((a, p) => a + (p.valueRef || 0) + (p.accruedLine ? 0 : p.accruedRef || 0), 0) * 100) / 100;
  doc.checks.push({label: WL.t("Строк с позициями прочитано", "Position rows read"), parsed: pos.length, stated: starts, ok: pos.length === starts && starts > 0, count: true});
  secTotals.forEach(t => {
    doc.checks.push(check(WL.t(`Раздел «${titleCase(t.sec)}»`, `Section “${titleCase(t.sec)}”`), ref(t.rows.map(r => pos[rows.indexOf(r)]).filter(Boolean)), t.value));
  });
  const mv = Math.round(pos.reduce((a, p) => a + (p.valueRef || 0), 0) * 100) / 100;
  if(totals["total market value"] != null) doc.checks.push(check(WL.t("Рыночная стоимость без НКД", "Market value excluding accrued interest"), mv, totals["total market value"]));
  if(totals["total accrued interest"] != null) doc.checks.push(check(WL.t("Накопленный купонный доход", "Accrued interest"), accruedTotal, totals["total accrued interest"]));
  doc.checks.push(check(WL.t(`Чистые активы счёта, ${valCcy}`, `Net assets, ${valCcy}`), Math.round((mv + accruedTotal) * 100) / 100, totals["total net assets"] ?? null));
  doc.checks.forEach(ch => { if(!ch.count) ch.ccy = valCcy; });
  doc.note = WL.t("стоимость бумаг — без НКД, НКД отдельной строкой; цены облигаций — в процентах номинала",
    "securities are valued without accrued interest, which is shown as a separate line; bond prices are in percent of nominal");
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
const SECTION = /^(equities|equity|shares|stocks|bonds|fixed income|cash|cash accounts|accounts|liquidity|liquid assets|cash (and|&) (cash )?equivalents?|money market|funds|investment funds|hedge funds|structured products|alternative investments|precious metals|private equity|options|futures|акции|облигации|фонды|денежные средства|деньги|aktien|anleihen|obligationen|liquidität|konten|fonds|actions|obligations|liquidités|comptes)(\s*\(.*\))?:?$/i;

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
  const keys = fields.filter(Boolean);
  const dated = keys.includes("date") || names.some(n => /(^|\s)(date|datum|дата|valuta|booking)(\s|$)/i.test(n));
  const page = (blocks[0].rows[blocks[0].head] || {}).page || 1;
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
  // ops — движение денег (дата сделки, нет количества и цены): позиций в такой таблице нет.
  return {name: name.length > 48 ? name.slice(0, 47) + "…" : name, rows, head, page, data,
          positional: positional(keys), ops: dated && !keys.includes("qty") && !keys.includes("price")};
}
/* Шапка в две-три строки («MARKET» над «VALUE USD», «PORTF.» над «WEIGHT») по строкам узнаётся плохо и режет
   выписку на десятки ложных таблиц. Соседние строки без чисел, стоящие вплотную, склеиваем по колонкам — но только
   если так узнаётся больше полей, чем в лучшей строке по отдельности. Заголовок раздела у левого края
   («CASH AND CASH EQUIVALENT») и длинный текст в шапку не берём. */
function mergeCells(part){
  const all = part.flatMap((P, li) => P.cells.map(c => ({...c, li}))).sort((a, b) => a.x - b.x), cols = [];
  for(const c of all){
    const k = cols[cols.length - 1];
    if(k && c.x < k.x2 + 1.5){ k.items.push(c); k.x2 = Math.max(k.x2, c.x2); }
    else cols.push({x: c.x, x2: c.x2, items: [c]});
  }
  return cols.map(k => ({s: k.items.sort((a, b) => a.li - b.li || a.x - b.x).map(c => c.s).join(" "), x: k.x, x2: k.x2}));
}
function mergeHeaderLines(lines){
  const out = [], textOnly = L => L.cells.length > 0 && !L.cells.some(isNumCell);
  const keyCount = cells => (headKeyOf(cells) || []).length;
  for(let i = 0; i < lines.length; i++){
    const win = [lines[i]];
    if(textOnly(lines[i])){
      for(let j = i + 1; j < lines.length && win.length < 3; j++){
        const M = lines[j], prev = win[win.length - 1];
        if(M.page !== prev.page || !textOnly(M) || M.y - prev.y > Math.max(prev.h, M.h) * 1.9) break;
        win.push(M);
      }
    }
    let used = 1, merged = null;
    for(let n = win.length; n >= 2 && !merged; n--){
      const part = win.slice(0, n), minX = Math.min(...part.flatMap(P => P.cells.map(c => c.x)));
      if(part.some(P => P.cells.length === 1 && P.cells[0].x <= minX + 4)) continue;
      const cells = mergeCells(part);
      if(cells.some(c => c.s.length > 40)) continue;
      const k = headKeyOf(cells) || [];
      if(k.length > Math.max(...part.map(P => keyCount(P.cells))) && (positional(k) || k.length >= 3)){
        merged = {cells, page: part[0].page, y: part[n - 1].y, h: part[n - 1].h}; used = n;
      }
    }
    out.push(merged || lines[i]);
    i += used - 1;
  }
  return out;
}
function pdfTables(pages){
  const lines = mergeHeaderLines(pages.flat().map(L => ({cells: lineCells(L), page: L.page, y: L.y,
    h: Math.max(8, ...L.items.map(it => it.h || 0))})));
  const rows = lines.map(L => Object.assign(L.cells, {page: L.page}));
  // Таблица с той же шапкой дальше по документу продолжает прежнюю, даже если между ними была другая:
  // у выписки банка позиции идут по страницам вперемешку со сводками.
  const parts = [{key: null, blocks: [{head: -1, rows: []}]}];
  let cur = parts[0];
  rows.forEach(cells => {
    const k = headKeyOf(cells);
    const last = cur.blocks[cur.blocks.length - 1];
    if(!k){ last.rows.push(cells); return; }
    // Заголовок раздела над шапкой переезжает к ней: «Bonds» относится к таблице ниже.
    const lead = [];
    if(last.rows.length > last.head + 1 && isTitle(last.rows[last.rows.length - 1])) lead.push(last.rows.pop());
    const bl = {head: lead.length, rows: [...lead, cells]};
    const same = parts.find(p => p.key && sameTable(p.key, k));
    if(same){ same.blocks.push(bl); cur = same; }
    else { cur = {key: k, blocks: [bl]}; parts.push(cur); }
  });
  const headed = parts.some(p => p.key), tables = [];
  parts.forEach(p => {
    if(p.key){ const t = alignBlocks(p.blocks); if(t) tables.push(t); return; }
    if(headed) return;                          // текст до первой шапки: адрес, реквизиты, сводка
    // Шапку узнать не удалось: одна сетка на весь документ с первой строки, похожей на таблицу.
    let src = p.blocks[0].rows;
    const first = src.findIndex(cells => cells.length >= 3 && cells.some(isNumCell));
    src = src.slice(Math.max(0, first - 3));
    const band = bandsOf(src);
    if(band && band.data >= 2 && band.cols.length >= 3)
      tables.push({name: "", rows: src.map(cells => place(cells, band.cols)), page: (src[0] || {}).page || 1, data: band.data, positional: false, ops: false});
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
  const head = pages.slice(0, 3).flat().map(l => l.text).join("\n");
  // Schwab выпускает выписки в нескольких шаблонах; имя файла «Brokerage Statement_2026-08-31_241.PDF» — их.
  // Разборщик знает один шаблон: если позиций он не нашёл, отдаём файл общему разбору таблиц, а не пустой отчёт.
  const schwabName = /^Brokerage Statement_\d{4}-\d{2}-\d{2}_\d+\.pdf$/i.test(file.name);
  let schwabTried = false;
  if(/Schwab One|Charles Schwab/i.test(head) || (schwabName && /schwab/i.test(head))){
    const doc = parseSchwab(pages, file.name);
    if(doc.positions.length) return doc;
    schwabTried = true;
  }
  if(/Swissquote Bank/.test(head)) return parseSwissquote(pages, file.name);
  // Выписка частного банка с таблицей «Detailed positions» (EFG и похожие): обложки и сводка идут раньше таблицы.
  if(pages.some(ls => ls.some(l => /^DETAILED POSITIONS OF PORTFOLIO/i.test(l.text))) &&
     pages.some(ls => ls.some(l => l.items.some(i => /^CCY$/.test(i.s)) && l.items.some(i => /^NOMINAL$/.test(i.s))))){
    const doc = parseDetailed(pages, file.name);
    if(doc.positions.length) return doc;
  }
  // Скан — это картинка без текста: читать в нём нечего, и сказать надо именно это.
  if(!pages.some(lines => lines.length)) return {unknown: true, fileName: file.name, pdf: true, scan: true};
  const tables = pdfTables(pages);
  // Шапка документа — строки первой страницы до первой таблицы: ниже в позициях свои даты
  // (погашения) и свои банки («UBS Group AG» среди акций).
  const p1 = pages[0] || [];
  const cut = p1.findIndex(L => { const cells = lineCells(L); return headKeyOf(cells) || (cells.length >= 3 && cells.some(isNumCell)); });
  const top = p1.slice(0, cut < 0 ? 12 : Math.min(cut, 12)).map(l => l.text);
  const ctx = {asOf: pdfDate(top.join("\n")) || pdfDate(p1.map(l => l.text).join("\n"), true), broker: pdfBank(top)};
  if(schwabTried && !ctx.broker) ctx.broker = "Charles Schwab";
  const doc = tables.length && WL.parseRows ? WL.parseRows(tables, file, ctx) : null;
  // Только движение денег (даты, суммы, без количества и цен) — это выписка операций, позиций в ней нет. Но таблица
  // движения денег бывает и в конце выписки о портфеле, а сложные шапки позиций мы можем не узнать: если в заголовках
  // страниц есть признаки портфеля, файл не называем выпиской операций — его можно разметить вручную или распознать ИИ.
  const PORTFOLIO = /\b(portfolio valuation|valuation|detailed positions|positions|holdings|asset allocation|portfolio statement|vermögensaufstellung|depotauszug|vermögensübersicht|relevé de portefeuille|évaluation)\b|состав портфеля|оценка портфеля|позиции/i;
  const portfolioLike = pages.some(ls => ls.slice(0, 15).some(l => PORTFOLIO.test(l.text)));
  if(doc && doc.unknown && tables.every(tb => tb.ops) && !portfolioLike) return {unknown: true, fileName: file.name, pdf: true, ops: true};
  // Узнанной шапки нет: разметку предлагаем, только если в файле правда есть таблица с числами —
  // иначе договор или письмо откроются «таблицей» из дат, номеров пунктов и страниц.
  const tabular = sh => sh.rows.filter(r => r.filter(c => c && NUMLIKE.test(c)).length >= 2 && r.some(c => c && !NUMLIKE.test(c))).length >= 3;
  if(!doc || (doc.unknown && !doc.sheets.some(tabular))){
    // plain — в файле нет даже двух строк с числами в разных колонках: договор или письмо. Такой файл незачем отдавать ИИ.
    const numericRows = pages.flat().filter(L => lineCells(L).filter(isNumCell).length >= 2).length;
    return {unknown: true, fileName: file.name, pdf: true, plain: numericRows < 2};
  }
  return doc;
};
/* ── Текст для распознавания ИИ ────────────────────────────────────────────
   Уходит на сервер только по согласию пользователя и только когда выписку не удалось прочитать здесь.
   Не отправляем шапку первой страницы (имя и адрес клиента), её повторы дальше и короткие строки, повторяющиеся
   на страницах (колонтитулы с именем и номером портфеля); шапки таблиц оставляем — без них не понять колонки.
   Номера счетов, IBAN, почту и телефоны маскируем; имя файла не уходит. Числа текста запоминаем, чтобы
   проверить ответ: сумма, которой нет в выписке, — выдумка, и такой разбор не принимаем. */
const MASK = "▇";
function parseAmount(tok){
  let t = String(tok).replace(/[\s'’ ]/g, "");
  const neg = /^\(.*\)$/.test(t) || /^[-−]/.test(t);
  t = t.replace(/[()\-−+]/g, "");
  if(!/^\d[\d.,]*$/.test(t)) return null;
  const c = t.includes(","), d = t.includes(".");
  if(c && d) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if(c) t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.split(",").length === 2 ? t.replace(",", ".") : t.replace(/,/g, "");
  else if(d && (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, "");
  const v = parseFloat(t);
  return isFinite(v) ? (neg ? -v : v) : null;
}
function maskLine(line){
  return line
    .replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, MASK)                  // IBAN
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, MASK)                                                       // почта
    .replace(/\+\d[\d ()-]{7,}\d/g, MASK)                                                             // телефон
    .replace(/(^|[^\d.,'’])0\d{1,3}[ /]\d{2,4}(?: \d{2}){2}(?![\d.,])/g, (m, pre) => pre + MASK)         // телефон без кода страны: 044 123 45 67
    .replace(/\b\d{3,}(?:[./-]\d+){2,}\b/g, (m, at, str) =>                                            // номера счетов: 537630.120.6
      /^(19|20)\d\d[./-]\d{1,2}[./-]\d{1,2}$/.test(m) || /^(19|20)\d\d-\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(m) || /^,\d{2}/.test(str.slice(at + m.length)) ? m : MASK)
    .replace(/\b\d{4,}-\d{2,}\b/g, m => /^(19|20)\d\d-(\d\d|(19|20)\d\d)$/.test(m) ? m : MASK)            // 123456-78, 1234-5678; год и месяц, годы — нет
    .replace(/\b\d{2,3}-\d{5,}\b/g, MASK)                                                            // 12-345678
    .replace(/\b0\d{5,}\b/g, (m, at, str) => /^[.,]\d/.test(str.slice(at + m.length)) ? m : MASK)         // номер с нулём впереди: 0123456
    .replace(/\b\d{8,}\b/g, (m, at, str) => /^[.,]\d{2}\b/.test(str.slice(at + m.length)) ? m : MASK); // длинные номера
}
// Служебные слова шапок: фразу только из них («PORTFOLIO VALUATION», «This page is intentionally left blank») именем не считаем.
const GENERIC_HEAD = /^(portfolio|valuation|statement|report|account|accounts|summary|documents?|electronic|detailed|positions?|page|this|is|intentionally|left|blank|investment|type|risk|scoring|your|our|relationship|officer|manager|advisor|client|private|banking|wealth|management|the|of|and|for|as|at|to|in|on|a|an|confidential|period|date|overview|nickname|mandate|active|advisory|currency|valuation)$/i;
WL.pdfAiText = async function(file){
  const pages = await pdfLines(await file.arrayBuffer());
  const tableLine = L => { const cells = lineCells(L); return headKeyOf(cells) || (cells.length >= 3 && cells.some(isNumCell)); };
  // Шапка документа — всё до первой таблицы: обложки, адрес банка, номер счёта, имена клиента и сотрудника банка.
  // У одних банков это верх первой страницы, у других — несколько страниц перед таблицами.
  const fp = Math.max(0, pages.findIndex(ls => ls.some(tableLine)));
  const p1 = pages[fp] || [];
  const first = p1.findIndex(tableLine);
  // Шапку таблицы на незнакомом языке («Bezeichnung | Stück | Kurswert») мы не узнаём, и первой найдётся строка
  // с числами. Шапку и заголовок раздела прямо над ней отправляем: без них ИИ не поймёт колонок. Строки с цифрами
  // (адрес, номер портфеля, дата) сюда не попадают, а одиночная строка — только знакомое название раздела:
  // над таблицей часто стоит имя владельца.
  let cut = first;
  if(first > 0 && !headKeyOf(lineCells(p1[first]))){
    while(cut > 0 && first - cut < 3){
      const L = p1[cut - 1];
      if(/\d/.test(L.text) || !(lineCells(L).length >= 2 || SECTION.test(L.text.trim()))) break;
      cut--;
    }
  }
  const headLines = [...pages.slice(0, fp).flat(), ...p1.slice(0, cut < 0 ? p1.length : cut)];
  const top = headLines.map(l => l.text);
  const ctx = {asOf: pdfDate(top.join("\n")) || pdfDate(p1.map(l => l.text).join("\n"), true), broker: pdfBank(top.length ? top : p1.slice(0, 12).map(l => l.text))};
  const norm = t => t.replace(/\d/g, "#").replace(/\s+/g, " ").trim();
  const freq = new Map();
  pages.forEach(ls => new Set(ls.map(l => norm(l.text))).forEach(k => freq.set(k, (freq.get(k) || 0) + 1)));
  // Строки шапки, которые повторяются дальше (шапка на каждой странице), тоже не уходят, а имя из шапки
  // («Mr Ivan Petrov») закрываем и внутри других строк. Берём только строки без сумм и без названий колонок:
  // «Market value | 1 234 567» в сводке — подпись, а не имя, и в шапках таблиц её закрывать нельзя.
  const head = new Set(headLines.map(L => norm(L.text)).filter(k => k.length >= 10));
  const names = [...new Set(headLines.filter(L => !lineCells(L).some(isNumCell)).flatMap(L => lineCells(L).map(c => c.s.replace(/\s+/g, " ").trim()))
    .filter(x => !/\d/.test(x) && x.length >= 5 && x.length <= 48 && /^\S+(\s+\S+){1,5}$/.test(x) && !SECTION.test(x) && !Object.keys(WL.sheetMap ? WL.sheetMap([x]) : {}).length &&
      x.split(/[\s:.,;-]+/).filter(Boolean).some(w => !GENERIC_HEAD.test(w))))]
    .sort((a, b) => b.length - a.length)
    .map(x => new RegExp(`(^|[^\\p{L}\\p{N}])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "giu"));
  // Номера счёта, портфеля и договора из подписей «ACCOUNT NUMBER: 537630», «PORTFOLIO 537630-1» на любой странице —
  // и дальше закрываем их везде, где они встречаются: в заголовках таблиц, описаниях счетов, ссылках.
  const ids = new Set();
  const LABEL = /(account|acct|portfolio|portefeuille|depot|konto|client|customer|kunden|relationship|mandate|contract|vertrag|reference|cif|номер|сч[её]т|договор|портфел)[^\d\n|]{0,24}?([A-Z]{0,4}\d[\d.\/-]{2,}\d)/gi;
  pages.flat().forEach(L => { let m; LABEL.lastIndex = 0; while((m = LABEL.exec(L.text))) (m[2].match(/\d{5,}/g) || []).forEach(d => ids.add(d)); });
  const idRe = ids.size ? new RegExp(`[A-Z]{0,4}[\\d.\\/-]*(?:${[...ids].join("|")})[\\d.\\/-]*`, "g") : null;
  const hide = line => { let a = names.reduce((x, re) => x.replace(re, (m, pre) => pre + MASK), line); return idRe ? a.replace(idRe, MASK) : a; };
  const out = [], numbers = new Set(), lines = [];
  pages.forEach((ls, pi) => {
    if(pi < fp) return;                                                  // страницы до первой таблицы
    const rows = [];
    ls.forEach((L, li) => {
      if(pi === fp && (cut < 0 || li < cut)) return;                     // шапка на странице с первой таблицей
      const cells = lineCells(L), k = norm(L.text);
      if(!(pi === fp && li < first)){                                    // шапку первой таблицы оставляем как есть
        if(head.has(k) && !SECTION.test(L.text.trim())) return;          // повтор шапки документа
        // Колонтитул: строка без сумм, которая есть на многих страницах. Строки с суммами («Итого») остаются.
        if(k.length >= 8 && !headKeyOf(cells) && !cells.some(isNumCell) && !SECTION.test(L.text.trim()) &&
          pages.length >= 2 && freq.get(k) >= Math.max(2, pages.length * 0.34)) return;
      }
      rows.push(hide(maskLine(cells.map(c => c.s).join(" | "))));
    });
    if(!rows.length) return;
    out.push(`--- page ${pi + 1} ---`, ...rows);
    rows.forEach(r => lines.push({page: pi + 1, text: r}));
  });
  const text = out.join("\n");
  // Числа каждой строки со знаком: по ним ответ ИИ проверяется в строке своей бумаги, а не где-нибудь в документе.
  const TOK = /[(\-−]?\d[\d'’ .,]*\d\)?-?|\d/g;
  lines.forEach(L => {
    L.lower = L.text.toLowerCase(); L.signed = new Set(); L.abs = new Set();
    (L.text.match(TOK) || []).forEach(tok => {
      const trailing = /\d-$/.test(tok), v = parseAmount(tok.trim().replace(/-$/, ""));
      if(v == null) return;
      const c = Math.round(Math.abs(v) * 100);
      numbers.add(c); L.abs.add(c); L.signed.add((trailing ? -1 : 1) * Math.sign(v || 1) * c);
    });
  });
  return {text, ctx, numbers, lines};
};
WL.util = {num, dmy, iso, pad, round2, titleCase};
})();
