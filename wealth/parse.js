/* Флоу велса · разбор выписок.
   Всё происходит в браузере: PDF не покидает компьютер. Разбор опирается на
   координаты текста — только так различаются колонки «списание» и «зачисление»,
   которые при чтении простого текста теряются. Каждый разбор сверяется с итогами
   самой выписки, и несошедшееся показывается, а не прячется. */
(function(){
const WL = window.WL = window.WL || {};
// PDF.js грузится модулем (см. wealth.html) и появляется чуть позже обычных скриптов: ждём его, если он ещё не готов.
const PDFJS = () => typeof pdfjsLib !== "undefined" ? Promise.resolve(pdfjsLib)
  : new Promise(res => window.addEventListener("pdfjs-ready", () => res(window.pdfjsLib), {once: true}));

const MONTHS = {January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8,
                September:9, October:10, November:11, December:12};
const pad = n => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dmy = s => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const round2 = v => Math.round(v * 100) / 100;
const isNumTok = s => /^\(?[-−]?\$?\(?[\d,']*\d(\.\d+)?\)?%?$/.test(s);
// 1,234.56 · (1,234.56) · ($53,921.75) · 1'234.56 · -21.86 · −21.86 · 3.38%
const num = s => {
  if(s == null || !isNumTok(String(s).trim())) return null;
  const t = String(s).trim();
  const v = parseFloat(t.replace(/[^\d.]/g, ""));
  return isNaN(v) ? null : ((t.includes("(") || /^[-−]/.test(t)) ? -v : v);
};
/* Сумма из ячейки — одно правило для всех путей: таблицы, PDF других банков, распознанные страницы, текст для ИИ.
   Минус бывает дефисом, типографским минусом (U+2212), тире, скобками и знаком после числа («1 234,56-»); «Dr» после
   суммы — дебет, то есть минус. Разделители: 1,234.56 · 1 234,56 · 1'234.56 · 1.234.567. Рядом с числом допустимы
   код и знак валюты, процент и подписи единиц; текст с цифрами («Portfolio 537630.120.6») — не число. pct — был знак %:
   цена облигации в процентах номинала считается иначе, чем цена за штуку. */
const DASHES = /[−‒–—‐‑﹣－]/g;
function amount(v){
  if(v == null || v instanceof Date) return null;
  if(typeof v === "number") return isFinite(v) ? {value: v, pct: false} : null;
  let t = String(v).replace(/[    ]/g, " ").replace(DASHES, "-").trim();
  if(!t || /^[-\s]+$/.test(t)) return null;
  const pct = t.includes("%");
  let neg = false;
  const side = /(?<!\p{L})(dr|cr)\.?\s*$/iu.exec(t);
  if(side){ neg = /^dr/i.test(side[1]); t = t.slice(0, side.index).trim(); }
  t = t.replace(/(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g, " ")
    .replace(/(?<!\p{L})(stk|stück|pcs|shares?|units?|nom|nominal|fr|sfr|p\.?\s?a|шт|руб)(?!\p{L})\.?/giu, " ")
    .replace(/[$€£¥₽%]/g, " ").replace(/\s+/g, " ").trim();
  if(/\p{L}/u.test(t)) return null;
  if(/^\(.*\)$/.test(t)){ neg = true; t = t.slice(1, -1).trim(); }
  if(t.startsWith("-")){ neg = true; t = t.slice(1).trim(); }
  else if(t.startsWith("+")) t = t.slice(1).trim();
  if(t.endsWith("-")){ neg = true; t = t.slice(0, -1).trim(); }
  if(!/^\d[\d\s'’.,]*$/.test(t)) return null;
  t = t.replace(/[\s'’]/g, "");
  const hasC = t.includes(","), hasD = t.includes(".");
  if(hasC && hasD) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(/,/g, ".") : t.replace(/,/g, "");
  else if(hasC){
    // Запятая — разделитель разрядов, только если за ней группы ровно по три цифры, а число не
    // начинается с нуля: 1,234 · 12,345,678. Иначе это дробь: 172,30 · 0,9860 · 0,015.
    const groups = /^[1-9]\d{0,2}(,\d{3})+$/.test(t);
    t = groups ? t.replace(/,/g, "") : t.split(",").length === 2 ? t.replace(",", ".") : t.replace(/,/g, "");
  }
  else if(hasD && (t.match(/\./g) || []).length > 1){
    // Несколько точек — разделители разрядов (1.234.567). С другими группами это номер или дата, а не сумма.
    if(!/^\d{1,3}(\.\d{3})+$/.test(t)) return null;
    t = t.replace(/\./g, "");
  }
  const n = parseFloat(t);
  return isFinite(n) ? {value: neg ? -Math.abs(n) : n, pct} : null;
}
const check = (label, parsed, stated) => ({label, parsed, stated,
  ok: parsed != null && stated != null && Math.abs(parsed - stated) < 0.01});
const KEEP_UPPER = new Set(["ETF", "ADR", "TR", "SA", "NV", "N.V.", "US", "USA", "AG", "PLC"]);
const titleCase = s => String(s || "").split(/\s+/).map(w =>
  KEEP_UPPER.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()).join(" ");

// password — пароль, который человек ввёл для защищённой выписки; хранится только в памяти вкладки.
const openPdf = async (buf, password) => (await PDFJS()).getDocument({data: buf, isEvalSupported: false, password: password || undefined}).promise;
async function pdfLines(buf, password){
  // isEvalSupported: false — рекомендованная Mozilla защита от CVE-2024-4367 для PDF.js до 4.2.67: шрифты из чужого файла
  // не превращаются в исполняемый код.
  const lib = await PDFJS();
  const pdf = await openPdf(buf, password);
  const pages = [], meta = [];
  try{
    for(let p = 1; p <= pdf.numPages; p++){
      const page = await pdf.getPage(p);
      const vp = page.getViewport({scale: 1});
      const tc = await page.getTextContent();
      // Координаты — через область просмотра страницы: у повёрнутой страницы (/Rotate 90, альбомные выписки IB) без этого
      // колонки превращались в «строки», и файл не читали ни разбор, ни ИИ. Высота буквы — длина вектора, а не одна ось матрицы.
      const items = tc.items.filter(i => i.str.trim()).map(i => { const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5]);
        return {s: i.str.trim(), x: Math.round(x), y: Math.round(y), w: i.width || 0, h: Math.hypot(i.transform[2], i.transform[3]) || i.height || 8}; });
      items.sort((a, b) => a.y - b.y || a.x - b.x);
      const lines = [];
      for(const it of items){
        const L = lines[lines.length - 1];
        if(L && Math.abs(L.y - it.y) <= 2) L.items.push(it); else lines.push({y: it.y, page: p, items: [it]});
      }
      lines.forEach(L => { L.items.sort((a, b) => a.x - b.x); L.text = L.items.map(i => i.s).join(" "); });
      pages.push(lines);
      meta.push(await pageArt(page, vp, lines, lib));
    }
  } finally { pdf.destroy().catch(() => {}); }
  Object.defineProperty(pages, "meta", {value: meta, enumerable: false});
  return pages;
}
/* Что на странице кроме текста. Страница без текста с картинкой — скан или закрашенная копия; картинка на месте, где нет
   текста, — возможно, таблица, вставленная изображением. Такие места программа не читает и должна сказать об этом, а не
   считать выписку прочитанной. Разбор операторов страницы дорогой (он раскрывает картинки), поэтому смотрим только страницы
   без текста и страницы с большим пустым по вертикали местом, где картинке есть где поместиться. Фон под текстом
   (бланк банка) картинкой без текста не считается: если внутри неё три строки текста и больше, это подложка. */
async function pageArt(page, vp, lines, lib){
  const W = vp.width, H = vp.height, info = {text: lines.length, boxes: [], blank: false};
  if(lines.length){
    const ys = lines.map(L => L.y).sort((a, b) => a - b);
    let gap = Math.max(ys[0], H - ys[ys.length - 1]);
    for(let i = 1; i < ys.length; i++) gap = Math.max(gap, ys[i] - ys[i - 1]);
    if(gap < H * 0.3) return info;
  }
  // Без таблицы операторов (другая сборка PDF.js) о странице без текста ничего не известно — считаем её картинкой, не пустой.
  const O = lib && lib.OPS;
  if(!O) return info;
  let list;
  try{ list = await page.getOperatorList(); }catch(e){ return info; }
  const fn = list.fnArray, args = list.argsArray, stack = [];
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  const PAINT = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintJpegXObject].filter(x => x != null));
  let m = [1, 0, 0, 1, 0, 0];
  for(let i = 0; i < fn.length; i++){
    const f = fn[i], a = args[i];
    if(f === O.save) stack.push(m);
    else if(f === O.restore) m = stack.pop() || m;
    else if(f === O.transform && a) m = mul(m, a);
    else if(f === O.paintFormXObjectBegin){ stack.push(m); if(a && Array.isArray(a[0]) && a[0].length === 6) m = mul(m, a[0]); }
    else if(f === O.paintFormXObjectEnd) m = stack.pop() || m;
    else if(PAINT.has(f)){
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => vp.convertToViewportPoint(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]));
      const x0 = Math.max(0, Math.min(...pts.map(q => q[0]))), x1 = Math.min(W, Math.max(...pts.map(q => q[0])));
      const y0 = Math.max(0, Math.min(...pts.map(q => q[1]))), y1 = Math.min(H, Math.max(...pts.map(q => q[1])));
      if(x1 - x0 < W * 0.35 || (x1 - x0) * (y1 - y0) < W * H * 0.12) continue;           // логотип, подпись, значок
      const inside = lines.filter(L => L.y >= y0 && L.y <= y1 && L.items.some(it => it.x >= x0 - 2 && it.x <= x1)).length;
      if(inside >= 3) continue;                                                             // подложка под текстом
      info.boxes.push({x0, y0, x1, y1});
    }
  }
  info.blank = !lines.length && !info.boxes.length && !fn.some(f => PAINT.has(f)) && fn.length < 40;
  return info;
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
  // Итоги берём из текста страницы, а не из распознанной картинки: там цифра может быть прочитана с ошибкой.
  const lineOf = re => all.find(l => re.test(l.text) && !l.ocr) || all.find(l => re.test(l.text));
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
  const heads = all.filter(l => !l.ocr && l.items.some(i => /^Market Value/.test(i.s)) && l.items.some(i => /^Quantity/.test(i.s)))
    .map(l => ({page: l.page, y: l.y, cols: HEADS.map(([k, re]) => { const it = l.items.find(i => re.test(i.s)); return it && {k, c: mid(it)}; }).filter(Boolean)}));
  const numbersOf = (items, at) => {
    const cells = items.filter(it => it.x >= 300 && (isNumTok(it.s) || /^N\/A/.test(it.s)));
    // Шапка над строкой на той же странице; на распознанной картинке — шапка того же шаблона с текстовой страницы.
    const h = heads.filter(x => x.page === at.page && x.y < at.y).pop() || (at.ocr ? heads[0] : null);
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
  // Распознанная страница теряет тире в заголовке («Positions Options»): тире необязательно.
  const eq = section(/^Positions\s*[-–—]?\s*Equities/, /^Total Equities/);
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
      symbol: sym, name: titleCase(name), qty, price, priceDate: doc.asOf, value, ccy: "USD", page: l.page,
      cost: costFlag ? null : cost, costReported: cost,
      costNote: cost == null ? WL.t("нет в выписке", "not in the statement") : (costFlag ? WL.t("неполная в выписке", "incomplete in the statement") : null),
      unrealized: costFlag ? null : unreal, purchaseDate: null, commission: null});
  });

  // Опционы: символ и CALL/PUT в строке позиции, страйк и экспирация — строкой ниже.
  const op = section(/^Positions\s*[-–—]?\s*Options/, /^Total Options/);
  let sumOp = 0, ocrRows = 0;
  const ocrBad = [];
  op.forEach((l, i) => {
    if(/^Total Options/.test(l.text)){ doc.checks.push(check(WL.t("Опционы Schwab", "Schwab options"), round2(sumOp), nums(l)[0])); return; }
    if(!isSym(l.items[0])) return;
    const items = rowItems(op, l), d = items.find(it => it.x > 40 && it.x < 300 && /^(CALL|PUT) /.test(it.s));
    if(!d) return;
    const {qty, price, value, cost, unreal} = numbersOf(items, l);
    // Страйк и экспирация — в строках под позицией. «ADJ EXP» и «REPS 100 FDX+50 FDXF» — скорректированный контракт:
    // поставка по нему не 100 акций одного тикера, и сравнивать страйк с ценой одной акции нельзя.
    let strike = null, expiry = null, adjusted = false, deliverable = null, strike2 = null;
    for(const n of op.filter(m => m.page === l.page && m.y > l.y + 4 && m.y <= l.y + 44 && !isSym(m.items[0]))){
      const rp = n.items.find(it => it.x < 60 && /^\d+\.\d{2}$/.test(it.s.split(/\s+/).pop()));
      if(rp && strike2 == null) strike2 = +rp.s.split(/\s+/).pop();
      const st = n.items.find(it => /^\$[\d.]+$/.test(it.s));
      const ex = n.items.find(it => /^(ADJ )?EXP \d{2}\/\d{2}\/\d{2}$/.test(it.s));
      if(st && ex && strike == null){ strike = num(st.s); adjusted = /^ADJ/.test(ex.s); const m = /(\d{2})\/(\d{2})\/(\d{2})/.exec(ex.s); expiry = `20${m[3]}-${m[1]}-${m[2]}`; }
      const rep = n.items.find(it => /^REPS /.test(it.s));
      if(rep) deliverable = rep.s.replace(/^REPS\s+/, "").replace(/\s*\+\s*/g, " + ");
    }
    const root = l.items[0].s, right = d.s.startsWith("CALL") ? "C" : "P";
    if(deliverable) adjusted = true;
    // Страйк напечатан дважды: «$27.5» и «27.50». Если распознавание потеряло точку («$275»), верим записи с двумя знаками.
    if(strike2 != null && (strike == null || Math.abs(strike - strike2) > 0.001)) strike = strike2;
    let q = qty;
    if(q == null && price && value != null){ const k = value / (price * 100); if(Math.round(k) !== 0 && Math.abs(k - Math.round(k)) < 0.02) q = Math.round(k); }
    // Строка с картинки проходит, только если количество × цена × 100 сходится со стоимостью: иначе цифра прочитана неверно.
    if(l.ocr){ ocrRows++; if(!(q != null && price != null && value != null && Math.abs(q * price * 100 - value) <= Math.max(1, Math.abs(value) * 0.01) && strike && expiry)) ocrBad.push(root); }
    const occ = expiry && strike != null
      ? root + expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10) + right + String(Math.round(strike * 1000)).padStart(8, "0")
      : null;
    sumOp += value || 0;
    doc.positions.push({id: "SCHW:" + (occ || root + i), broker: doc.broker, brokerShort: "Schwab", type: "option",
      right, underlying: adjusted ? root.replace(/\d+$/, "") : root, underlyingName: titleCase(d.s.replace(/^(CALL|PUT) /, "")), strike, expiry, occ,
      adjusted: adjusted || undefined, deliverable: deliverable || undefined,
      multiplier: 100, qty: q, price, priceDate: doc.asOf, value, ccy: "USD", cost, unrealized: unreal, ocr: l.ocr || undefined, page: l.page,
      purchaseDate: null, commission: null,
      name: WL.t(`${root} ${right === "C" ? "колл" : "пут"} ${strike}`, `${root} ${strike} ${right === "C" ? "call" : "put"}`)});
  });

  if(cash != null) doc.positions.push({id: "SCHW:CASH:USD", broker: doc.broker, brokerShort: "Schwab", type: "cash",
    name: WL.t("Денежные средства", "Cash"), symbol: "USD", value: cash, ccy: "USD", priceDate: doc.asOf});
  if(ocrRows) doc.checks.push({label: WL.t("Опционы со страниц-картинок: количество, цена и стоимость сходятся", "Options from image pages: quantity, price and value agree"),
    parsed: ocrRows - ocrBad.length, stated: ocrRows, ok: !ocrBad.length, count: true});
  const total = round2(doc.positions.reduce((a, p) => a + (p.value || 0), 0));
  // Итог всего счёта: если он сошёлся, на непрочитанных страницах позиций нет — иначе итог бы не сошёлся.
  doc.checks.push({...check(WL.t("Итог счёта Schwab", "Schwab account total"), total, S.ending), whole: true});
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
  doc.checks.push({...check(WL.t(`Чистые активы счёта, ${valCcy}`, `Net assets, ${valCcy}`), Math.round((mv + accruedTotal) * 100) / 100, totals["total net assets"] ?? null), whole: true});
  doc.checks.forEach(ch => { if(!ch.count) ch.ccy = valCcy; });
  doc.note = WL.t("стоимость бумаг — без НКД, НКД отдельной строкой; цены облигаций — в процентах номинала",
    "securities are valued without accrued interest, which is shown as a separate line; bond prices are in percent of nominal");
  return doc;
}

/* ── Выписка по счёту: операции и остаток ─────────────────────────────────
   Банковская выписка (Account Statement, Transaction History) бумаг не содержит, но остаток на счёте — деньги клиента,
   и в сводном отчёте они должны быть. Берём исходящий остаток на конец периода и сверяем: входящий остаток плюс операции
   даёт исходящий, остаток каждой строки — предыдущий плюс сумма операции. Разбор работает и по тексту страницы, и по
   распознанной картинке (закрашенная копия): числа берём по колонкам шапки таблицы. */
// «**OPENING BALANCE**» распознавание картинки иногда отдаёт одним словом «**OPENING» — строка, которая с него начинается, тоже остаток.
const OPEN_BAL = /^[*\s"'“”]*opening\b(?!\s+(?:date|price|time|hours))|(opening|beginning|previous|start(?:ing)?)\s+(?:ledger\s+|available\s+|book\s+)?balance|balance\s+(?:brought\s+forward|b\/f|at\s+start)|brought\s+forward|solde\s+(?:initial|pr[ée]c[ée]dent|d'ouverture)|anfangs(?:saldo|bestand)|alter\s+saldo|saldo\s+(?:inicial|anterior|iniziale)|входящий\s+остаток|остаток\s+на\s+начало/i;
const CLOSE_BAL = /^[*\s"'“”]*closing\b(?!\s+(?:date|price|time|hours))|(closing|ending|end\s+of\s+period|final)\s+(?:ledger\s+|available\s+|book\s+)?balance|balance\s+(?:carried\s+forward|c\/f|at\s+end)|carried\s+forward|solde\s+(?:final|de\s+cl[ôo]ture|[àa]\s+reporter)|(?:end|schluss)saldo|neuer\s+saldo|saldo\s+(?:final|finale)|исходящий\s+остаток|остаток\s+на\s+конец/i;
const DATE_CELL = /^(?:\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}[\s-][A-Za-z]{3}[a-z]*[\s-]\d{2,4})$/;
const BAL_HEAD = [["date", /^(date|value date|booking date|transaction date|posting date|post date|trans\.? date|datum|buchungsdatum|valuta|date valeur|дата)$/i],
  ["debit", /^(debit|debits|withdrawals?|paid out|money out|dr|списание|расход|soll|débit)$/i],
  ["credit", /^(credit|credits|deposits?|paid in|money in|cr|зачисление|приход|haben|crédit)$/i],
  ["amount", /^(amount|transaction amount|сумма|betrag|montant)(\s*\(?[A-Z]{3}\)?)?$/i],
  ["balance", /^(balance|running balance|ledger balance|saldo|solde|остаток)(\s*\(?[A-Z]{3}\)?)?$/i]];
// Выписка о портфеле (есть шапка с количеством и ценой) — не выписка по счёту, даже если в ней есть раздел денег с остатком.
const holdingsHead = all => all.some(L => L.items.some(i => /^(quantity|qty|units|nominal|shares|no\.? of shares|st[üu]ck|anzahl|quantit[ée]|количество)$/i.test(i.s.trim())) &&
  L.items.some(i => /^(price|market price|market value|valuation|kurs|cours|курс|цена)(\s*\(?[A-Z$€£]{1,3}\)?)?$/i.test(i.s.trim())));
const isoCode = c => c && (WL.isoCcy ? WL.isoCcy(c) : /^[A-Z]{3}$/.test(c)) ? c : null;
function parseCashStatement(pages, fileName){
  const all = pages.flat();
  if(!all.length || holdingsHead(all)) return null;
  const mid = it => it.x + (it.w || it.s.length * 4.5) / 2;
  const clean = s => String(s).replace(/[*:]/g, "").replace(/\s+/g, " ").trim();
  // Шапка таблицы операций: дата, остаток и сумма (списание и зачисление или одна колонка суммы).
  let head = null;
  for(const L of all){
    const cols = {};
    L.items.forEach(it => { const k = BAL_HEAD.find(([, re]) => re.test(clean(it.s))); if(k && !(k[0] in cols)) cols[k[0]] = mid(it); });
    if(cols.date != null && cols.balance != null && (cols.debit != null || cols.credit != null || cols.amount != null)){ head = {L, cols}; break; }
  }
  const closeLines = all.filter(L => CLOSE_BAL.test(L.text));
  if(!head && !closeLines.length) return null;
  const val = it => { const a = amount(it.s); return a && !a.pct ? a.value : null; };
  const numItems = L => L.items.filter(it => !DATE_CELL.test(it.s.trim()) && val(it) != null && /\d[.,]\d{2}\b|\d{1,3}(,\d{3})+/.test(it.s));
  // Число строки остатка: правое число строки, а если строка разорвана (надпись и сумма на разной высоте) — ближайшее справа ниже.
  const lastNum = L => {
    let ns = numItems(L);
    if(!ns.length){ const near = all.filter(M => M !== L && M.page === L.page && Math.abs(M.y - L.y) <= 6); ns = near.flatMap(numItems).filter(it => it.x > L.items[0].x); }
    return ns.length ? val(ns.sort((a, b) => a.x - b.x)[ns.length - 1]) : null;
  };
  const colOf = x => { let best = null, d = Infinity;
    Object.entries(head.cols).forEach(([k, c]) => { if(k !== "date" && Math.abs(x - c) < d){ d = Math.abs(x - c); best = k; } }); return best; };
  // Операции: строки после шапки, начинающиеся с даты.
  const rows = [];
  if(head){
    const start = all.indexOf(head.L);
    for(let i = start + 1; i < all.length; i++){
      const L = all[i], f = L.items[0];
      if(!f || !DATE_CELL.test(f.s.trim()) || CLOSE_BAL.test(L.text) || OPEN_BAL.test(L.text)) continue;
      const r = {date: f.s.trim(), text: L.items.slice(1).filter(it => val(it) == null).map(it => it.s).join(" ").trim(), signed: null, bal: null};
      numItems(L).forEach(it => {
        const k = colOf(mid(it)), v = val(it);
        if(k === "balance"){ if(r.bal == null) r.bal = v; }
        else if(k === "debit") r.signed = (r.signed || 0) - Math.abs(v);
        else if(k === "credit") r.signed = (r.signed || 0) + Math.abs(v);
        else if(k === "amount") r.signed = (r.signed || 0) + v;
      });
      if(r.signed != null || r.bal != null) rows.push(r);
    }
  }
  const openLine = all.find(L => OPEN_BAL.test(L.text));
  let opening = openLine ? lastNum(openLine) : null;
  let closing = closeLines.length ? lastNum(closeLines[closeLines.length - 1]) : null;
  if(closing == null && rows.length && rows[rows.length - 1].bal != null) closing = rows[rows.length - 1].bal;
  if(closing == null) return null;
  if(opening == null && rows.length && rows[0].bal != null && rows[0].signed != null) opening = round2(rows[0].bal - rows[0].signed);
  // Остаток в шапке («BALANCE: 2,557.75»): подпись и сумма справа от неё, вне таблицы.
  const headBal = (() => { for(const L of all){ if(head && L === head.L) continue;
    const k = L.items.findIndex(it => /^(current |available |ledger |account |closing )?balance\s*:?$/i.test(it.s.trim()) || /^остаток\s*:?$/i.test(it.s.trim()));
    if(k < 0) continue; const n = L.items.slice(k + 1).find(it => val(it) != null); if(n) return val(n); } return null; })();
  const text = all.map(l => l.text).join("\n");
  const ccyTok = (/\bcurrency\s*:?\s*([A-Z]{3})\b/i.exec(text) || [])[1];
  const fromName = (String(fileName).match(/(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g) || []).find(c => c !== "PDF" && isoCode(c));
  const inText = [...new Set((text.match(/(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g) || []).filter(isoCode))];
  const ccy = isoCode(ccyTok && ccyTok.toUpperCase()) || fromName || (inText.length === 1 ? inText[0] : null);
  const period = /(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,}\.?\s+\d{4})\s*(?:-|–|—|to|till|until|bis|au|по)\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,}\.?\s+\d{4})/i.exec(text);
  const asOf = (period && pdfDate(period[2])) || (rows.length && pdfDate(rows[rows.length - 1].date.replace(/-/g, "/"))) || pdfDate(text);
  // Банк — из шапки, а если логотип картинкой — по известному имени в любой строке (адрес сайта, подвал).
  const top = (pages[0] || []).slice(0, 14).map(l => l.text);
  const broker = pdfBank(top) || (WL.brokerByName ? all.map(l => WL.brokerByName(l.text)).find(Boolean) : null) || WL.t("Банк", "Bank");
  const name = WL.t(`Текущий счёт ${ccy || ""}`.trim(), `Current account ${ccy || ""}`.trim());
  const pos = {id: `BAL:${ccy || "?"}:${fileName}`, broker, brokerShort: broker.length <= 22 ? broker : broker.slice(0, 21) + "…", type: "cash",
    symbol: ccy || "", name, value: closing, ccy: ccy || "USD", priceDate: asOf, page: closeLines.length ? closeLines[closeLines.length - 1].page : null};
  if(!ccy){ pos.ccyGuessed = true; }
  const doc = {broker, brokerShort: pos.brokerShort, kind: "positions", fileName, asOf, currency: ccy || null, positions: [pos], checks: [], cashOnly: true,
    transactions: rows.map(r => ({date: r.date, text: r.text, amount: r.signed}))};
  const sum = round2(rows.reduce((a, r) => a + (r.signed || 0), 0));
  if(openLine && opening != null)
    doc.checks.push({...check(WL.t("Входящий остаток и операции дают исходящий", "Opening balance plus transactions gives the closing balance"), round2(opening + sum), closing), whole: true, ccy: pos.ccy});
  const withBal = rows.filter(r => r.bal != null && r.signed != null);
  if(withBal.length && opening != null){
    let prev = opening, good = 0;
    rows.forEach(r => { if(r.bal == null || r.signed == null){ if(r.bal != null) prev = r.bal; return; } if(Math.abs(prev + r.signed - r.bal) < 0.01) good++; prev = r.bal; });
    doc.checks.push({label: WL.t("Остатки по строкам сходятся с суммами операций", "Running balances agree with the transaction amounts"), parsed: good, stated: withBal.length, ok: good === withBal.length, count: true});
  }
  const notes = [WL.t("выписка по счёту: в отчёт идёт остаток на конец периода", "account statement: the closing balance goes into the report")];
  if(headBal != null && Math.abs(headBal - closing) < 0.01) notes.push(WL.t("остаток в шапке выписки тот же", "the balance in the statement header is the same"));
  else if(headBal != null) notes.push(WL.t(`в шапке выписки другой остаток (${headBal}) — видимо, на дату формирования, а не на конец периода`, `the statement header shows another balance (${headBal}), probably as of the generation date rather than the period end`));
  if(!ccy){ doc.ccyGuessed = 1; }
  doc.note = notes.join(" · ");
  return doc;
}

/* ── Interactive Brokers: Activity Statement ─────────────────────────────────
   Когда на счёте только деньги, позиций в выписке нет, но остаток есть: «Ending Cash» в Cash Report по каждой валюте
   (или по базовой) и строка Cash в Net Asset Value. Сверяем одно с другим и с итогом NAV. Если в NAV есть бумаги, этот
   разбор не берётся за позиции — файл идёт общим разбором таблиц или в ИИ, как раньше. */
function parseIBActivity(pages, fileName){
  const all = pages.flat(), text = all.map(l => l.text).join("\n");
  const pm = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s*[-–]\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/.exec(text)
    || /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/.exec(text);
  if(!pm) return null;
  const asOf = pm[6] ? iso(pm[6], MONTHS[pm[4]], pm[5]) : iso(pm[3], MONTHS[pm[1]], pm[2]);
  const base = isoCode((/Base Currency\s+([A-Z]{3})\b/.exec(text) || [])[1]) || "USD";
  const nums = L => L.items.map(i => i.s).filter(isNumTok).map(num);
  const label = L => L.items.filter(i => !isNumTok(i.s)).map(i => i.s).join(" ").trim();
  const SECTION = /^(Net Asset Value|Change in NAV|Mark-to-Market Performance Summary|Realized & Unrealized|Cash Report|Open Positions|Trades|Deposits & Withdrawals|Dividends|Withholding Tax|Interest\b(?! Accruals)|Fees|Financial Instrument Information|Codes|Notes\/Legal Notes|Time Weighted Rate of Return)/i;
  // Разделы идут от левого поля; справа на тех же строках бывает соседняя таблица («Change in NAV» рядом с NAV) — она раздел не закрывает.
  const left = L => L.items[0] && L.items[0].x < 120;
  const sectionAfter = re => { const a = all.findIndex(L => left(L) && re.test(L.text)); if(a < 0) return [];
    const b = all.findIndex((L, i) => i > a && left(L) && SECTION.test(L.text) && !re.test(L.text)); return all.slice(a + 1, b < 0 ? undefined : b); };
  // Net Asset Value: класс · прошлый итог · длинные · короткие · итог · изменение.
  const nav = {};
  sectionAfter(/^Net Asset Value\b/i).forEach(L => { const n = nums(L), k = label(L);
    if(!k || n.length < 4 || /^(Total Long|Long|Short)$/i.test(k)) return; nav[k.toLowerCase()] = n[3]; });
  if(nav.cash == null && nav.total == null) return null;
  const ACCR = /^(interest accruals|dividend accruals|accruals)$/i;
  if(Object.keys(nav).some(k => k !== "total" && k !== "cash" && !ACCR.test(k) && Math.abs(nav[k]) >= 0.005)) return null;
  // Cash Report: «Ending Cash» по базовой валюте и по каждой валюте счёта.
  const ending = {}; let cur = null;
  sectionAfter(/^Cash Report\b/i).forEach(L => { const k = label(L);
    if(/^Base Currency Summary$/i.test(k)) cur = "BASE";
    else if(/^[A-Z]{3}$/.test(k) && isoCode(k)) cur = k;
    else if(/^Ending Cash$/i.test(k) && cur && nums(L).length) ending[cur] = nums(L)[0]; });
  const broker = "Interactive Brokers";
  const P = (ccy, value, name) => ({id: `IB:CASH:${ccy}${name ? ":" + name : ""}`, broker, brokerShort: broker, type: "cash", symbol: ccy,
    name: name || WL.t(`Денежные средства ${ccy}`, `Cash ${ccy}`), value, ccy, priceDate: asOf});
  const ccys = Object.keys(ending).filter(c => c !== "BASE");
  const positions = ccys.length ? ccys.map(c => P(c, ending[c])) : ending.BASE != null ? [P(base, ending.BASE)] : nav.cash != null ? [P(base, nav.cash)] : [];
  Object.keys(nav).filter(k => ACCR.test(k) && Math.abs(nav[k]) >= 0.005).forEach(k =>
    positions.push(P(base, nav[k], /dividend/i.test(k) ? WL.t("Начисленные дивиденды", "Accrued dividends") : WL.t("Начисленные проценты", "Accrued interest"))));
  if(!positions.length) return null;
  const doc = {broker, brokerShort: broker, kind: "positions", fileName, asOf, currency: base, positions, checks: [], cashOnly: true, transactions: []};
  if(ending.BASE != null && nav.cash != null)
    doc.checks.push({...check(WL.t("Деньги: Cash Report и Net Asset Value", "Cash: Cash Report and Net Asset Value"), ending.BASE, nav.cash), ccy: base});
  if(positions.every(p => p.ccy === base) && nav.total != null)
    doc.checks.push({...check(WL.t("Чистые активы счёта (NAV)", "Account net asset value (NAV)"), round2(positions.reduce((a, p) => a + p.value, 0)), nav.total), whole: true, ccy: base});
  doc.note = WL.t("бумаг на счёте нет: деньги — из Cash Report, сверены с Net Asset Value", "no securities in the account: cash from the Cash Report, reconciled with the Net Asset Value");
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
const NUMLIKE = /^[(\-−–‒﹣－+]?\s?(?:[$€£]|CHF|USD|EUR|GBP)?\s?\d[\d\s'’.,]*\)?-?\s?%?$/;
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
  const names = [], fields = [], xs = [], out = [], titles = [], rowPages = [];
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
      out.push(row); rowPages.push(bl.rows[ri].page);
    });
  });
  if(!data) return null;
  const keys = fields.filter(Boolean);
  const dated = keys.includes("date") || names.some(n => /(^|\s)(date|datum|дата|valuta|booking)(\s|$)/i.test(n));
  const page = (blocks[0].rows[blocks[0].head] || {}).page || 1;
  // Страница каждой строки едет вместе с ней: по ней видно, с каких страниц прочитаны позиции.
  const rows = out.map((r, k) => Object.defineProperty(Array.from({length: names.length}, (_, i) => r[i] || ""), "page", {value: rowPages[k], enumerable: false}));
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
  return {name: name.length > 48 ? name.slice(0, 47) + "…" : name, rows, head, page, data, keys,
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
      tables.push({name: "", rows: src.map(cells => Object.defineProperty(place(cells, band.cols), "page", {value: cells.page, enumerable: false})),
        page: (src[0] || {}).page || 1, data: band.data, positional: false, ops: false, keys: []});
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

/* Номера счёта, портфеля и договора из подписей: «ACCOUNT NUMBER: 537630», «Portfolio 537630-1», «Konto 1234 5678».
   Нужны, чтобы узнать тот же счёт в другой выписке (в отчёте хранится только отпечаток номера) и чтобы закрыть
   номера перед отправкой в ИИ. Даты («from 01.08.2026») номером не считаются. */
// Номер без пробелов («537630.120.6») или группами через пробел («1234 5678 90»), но без соседней суммы («… 459,667.08»).
const ID_LABEL = /(?<![\p{L}])(account|acct|portfolio|portefeuille|depot|konto|client|customer|kunden|relationship|mandate|contract|vertrag|cif|номер|сч[её]т|договор|портфел)[^\d\n|]{0,24}?([A-Z]{0,4}\d[\d.\/-]{2,}\d(?: \d{2,4}(?![.,]\d)){0,4})/giu;
const DATE_LIKE = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})$/;
// Подпись говорит, чей это номер: счёта или портфеля («Account», «Konto», «Счёт») — или клиента и договора («Client», «CIF»).
const ACCT_WORD = /(account|acct|portfolio|portefeuille|depot|konto|сч[её]т|портфел)/i;
function accountTokens(lines){
  const out = [];
  lines.forEach(L => { let m; ID_LABEL.lastIndex = 0; while((m = ID_LABEL.exec(L.text))){
    // Дата («from 01.08.2026») и сумма («Home Depot Inc 123.45») — не номер.
    const tok = m[2].trim(); if(DATE_LIKE.test(tok) || /^\d{1,3}(,\d{3})*[.,]\d{1,2}$|^\d+[.,]\d{2}$/.test(tok)) continue;
    out.push({tok, kind: ACCT_WORD.test(m[0].slice(0, m[0].length - m[2].length)) ? "A" : "C"}); } });
  return out;
}
/* Отпечаток счёта строится из этих значений: буквы и цифры без разделителей, с видом номера впереди.
   A:номер — счёт или портфель без составной части.
   S:корень/номер — составной номер («123456-1», «537630.001.1»): субсчета «123456-1» и «123456-2» — разные счета с общим корнем.
   C:номер — номер клиента или договора: у одного клиента бывает несколько счетов, это только подсказка. */
const digits5 = x => (x.match(/\d/g) || []).length >= 5;
WL.accountIds = lines => [...new Set(accountTokens(lines).flatMap(({tok, kind}) => {
  const whole = tok.replace(/[^A-Za-z0-9]/g, "").toUpperCase(), lead = (/^[A-Z]{0,4}\d{5,}/i.exec(tok) || [""])[0].toUpperCase();
  if(!digits5(whole)) return [];
  if(kind === "C") return ["C:" + whole];
  return lead && lead !== whole && digits5(lead) ? ["S:" + lead + "/" + whole] : ["A:" + whole];
}))];
/* Сравнение номеров двух выписок (номера уже в виде отпечатков, но устроены так же).
   different — есть субсчета одного корня, и ни один не совпал: 123456-1 против 123456-2. Это разные счета, даже если у обеих
     выписок совпал общий «номер счёта» клиента (у EFG «Account number 537630» и «Portfolio 537630-1»).
   same — совпал полный номер счёта или субсчёта.
   maybe — в одной выписке только корень, в другой — субсчёт с этим корнем.
   client — совпал только номер клиента или договора. */
WL.compareAccounts = (a, b) => {
  const parse = xs => { const whole = new Set(), roots = new Map(), client = new Set();
    (xs || []).forEach(x => { const k = x.slice(0, 2), v = x.slice(2);
      if(k === "S:"){ const [r, w] = v.split("/"); whole.add(w); if(!roots.has(r)) roots.set(r, new Set()); roots.get(r).add(w); }
      else if(k === "C:") client.add(v);
      else whole.add(k === "A:" ? v : x);          // старые отпечатки без вида: как раньше, полный номер
    });
    return {whole, roots, client, known: whole.size > 0}; };
  const A = parse(a), B = parse(b), meet = (x, y) => [...x].some(v => y.has(v));
  for(const [r, ws] of A.roots) if(B.roots.has(r) && !meet(ws, B.roots.get(r))) return "different";
  if(meet(A.whole, B.whole)) return "same";
  if(meet(A.whole, new Set(B.roots.keys())) || meet(new Set(A.roots.keys()), B.whole)) return "maybe";
  if(A.known && B.known) return "different";
  if(meet(A.client, B.client)) return "client";
  return null;
};
/* ── Страницы-картинки: распознавание текста на этом компьютере ─────────────────
   Закрашивание реквизитов и «печать в PDF» картинкой превращают страницу в изображение без текста. Такие страницы
   распознаём Tesseract прямо в браузере: изображение никуда не уходит, библиотека и языковые данные — со своего адреса.
   Это медленно, поэтому только когда без этих страниц выписка не читается или не сходится, и распознанное принимаем,
   только если после него выписка сошлась с итогами банка: ошибка распознавания в цифре иначе стала бы ошибкой в отчёте. */
const vendorUrl = path => new URL("wealth/vendor/" + path, document.baseURI).href;
let tesseractLoad = null;
function loadTesseract(){
  if(window.Tesseract) return Promise.resolve(window.Tesseract);
  return tesseractLoad = tesseractLoad || new Promise((res, rej) => {
    const el = document.createElement("script");
    el.src = vendorUrl("tesseract/tesseract.min.js");
    el.onload = () => res(window.Tesseract);
    el.onerror = () => { tesseractLoad = null; rej(new Error("ocr_unavailable")); };
    document.head.appendChild(el);
  });
}
// Слова распознавания → строки и ячейки в том же виде, что у PDF.js: координаты в пунктах страницы, слова одной ячейки вместе.
function ocrLines(words, page){
  if(!words.length) return [];
  const hMed = words.map(w => w.h).sort((a, b) => a - b)[Math.floor(words.length / 2)] || 8;
  words.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for(const w of words){
    const L = lines[lines.length - 1];
    if(L && Math.abs(L.y - w.y) <= Math.max(2, hMed * 0.45)) L.words.push(w); else lines.push({y: w.y, words: [w]});
  }
  return lines.map(L => {
    const items = [];
    L.words.sort((a, b) => a.x - b.x).forEach(w => {
      const last = items[items.length - 1];
      if(last && w.x - last.x2 < Math.max(3.5, hMed * 0.9)){ last.s += " " + w.s; last.x2 = w.x2; last.w = last.x2 - last.x; }
      else items.push({s: w.s, x: Math.round(w.x), x2: w.x2, y: Math.round(w.y), w: w.x2 - w.x, h: w.h});
    });
    return {y: Math.round(L.y), page, ocr: true, items, text: items.map(i => i.s).join(" ")};
  });
}
// targets — [{n: страница, boxes}]: boxes — места картинок на странице с текстом; без них распознаётся вся страница.
async function ocrPages(buf, targets, progress, signal, password){
  // Каждый шаг ждём не дольше минуты и прерываем сразу по отмене: зависшая библиотека не должна держать очередь.
  const step = (p, ms = 60000) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("ocr_timeout")), ms);
    const abort = () => { clearTimeout(timer); rej(new Error("aborted")); };
    if(signal){ if(signal.aborted) return abort(); signal.addEventListener("abort", abort, {once: true}); }
    p.then(v => { clearTimeout(timer); res(v); }, e => { clearTimeout(timer); rej(e); });
  });
  const T = await step(loadTesseract());
  const pdf = await step(openPdf(buf, password));
  const worker = await step(T.createWorker("eng", 1, {workerPath: vendorUrl("tesseract/worker.min.js"), corePath: vendorUrl("tesseract/core").replace(/\/$/, ""),
    langPath: vendorUrl("tesseract/lang").replace(/\/$/, ""), workerBlobURL: false}));
  try{
    await worker.setParameters({tessedit_pageseg_mode: "11", preserve_interword_spaces: "1"});
    const out = {};
    for(let i = 0; i < targets.length; i++){
      if(signal && signal.aborted) throw new Error("aborted");
      const {n, boxes} = targets[i];
      if(progress) progress(i, targets.length, n);
      const page = await pdf.getPage(n), scale = 2.5, vp = page.getViewport({scale});
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      // intent "print": без кадров анимации — иначе в фоновой вкладке отрисовка встаёт до возвращения на неё.
      await step(page.render({canvasContext: ctx, viewport: vp, intent: "print"}).promise);
      const {data} = await step(worker.recognize(canvas, {}, {blocks: true, text: false}), 120000);
      const words = [];
      (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(pg => (pg.lines || []).forEach(ln => (ln.words || []).forEach(w => {
        const t = String(w.text || "").trim();
        if(!t || w.confidence < 30) return;
        const x = w.bbox.x0 / scale, x2 = w.bbox.x1 / scale, y = w.bbox.y1 / scale, h = (w.bbox.y1 - w.bbox.y0) / scale;
        // На странице с текстом берём только слова внутри картинок: остальное уже прочитано из текста страницы.
        if(boxes && !boxes.some(b => (x + x2) / 2 >= b.x0 && (x + x2) / 2 <= b.x1 && y - h / 2 >= b.y0 && y - h / 2 <= b.y1)) return;
        words.push({s: t, x, x2, y, h});
      }))));
      out[n] = ocrLines(words, n);
      canvas.width = canvas.height = 0;
    }
    return out;
  } finally {
    worker.terminate().catch(() => {});
    pdf.destroy().catch(() => {});
  }
}

/* Покрытие страниц. Непрочитанная страница — картинка без текста или картинка на месте, где нет текста (кроме обложки до
   первой таблицы), если её не распознали. Распознанная страница считается прочитанной, если из неё взяты позиции или в её
   тексте нет строк с суммами (условия, обложка); распознанный текст со строками сумм, из которых позиций не вышло, —
   по-прежнему пропуск. Итог выписки, сошедшийся по прочитанному, этого не отменяет — кроме итога всего счёта (см. WL.quality). */
// Сумма в распознанном тексте: число от трёх цифр или с дробной частью; даты, годы и номера страниц суммами не считаем.
const hasAmounts = lines => lines.some(L => (L.text.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b(19|20)\d\d\b/g, " ")
  .match(/\d[\d,.' ]*\d|\d/g) || []).some(tok => (tok.match(/\d/g) || []).length >= 3 || /[.,]\d/.test(tok)));
function coverage(doc, pages, ocr){
  const meta = pages.meta || [], fromPage = new Set((doc.positions || []).map(p => p.page).filter(Boolean));
  const first = fromPage.size ? Math.min(...fromPage) : 1, unread = [], read = [];
  meta.forEach((m, i) => {
    const n = i + 1;
    if(!m || m.blank || (m.text && (!m.boxes.length || n < first))) return;
    // Распознанная страница прочитана, если из неё взяты позиции или в её тексте нет сумм вовсе (условия, обложка).
    // Суммы есть, а позиций нет — распознавание что-то потеряло: «Total USD 500» без строки бумаги.
    if(ocr && ocr[n] && ocr[n].length && (fromPage.has(n) || !hasAmounts(ocr[n]))){ read.push(n); return; }
    unread.push(n);
  });
  doc.pages = {count: pages.length, unread, ocr: read};
  return doc;
}
// Страницы, которые стоит распознать: картинки без текста и картинки на месте таблицы.
const ocrTargets = (pages, doc) => (pages.meta || []).map((m, i) => {
  if(!m || m.blank) return null;
  if(!m.text) return {n: i + 1, boxes: null};
  return m.boxes.length ? {n: i + 1, boxes: m.boxes} : null;
}).filter(Boolean).filter(x => !doc || !doc.pages || doc.pages.unread.includes(x.n) || !x.boxes);

// Миниатюры страниц для вопроса «есть ли здесь позиции?»: рисуются здесь же, картинка никуда не уходит.
WL.pageThumbs = async function(file, pageNos, opts = {}){
  if(typeof document === "undefined") return [];
  const pdf = await openPdf(await file.arrayBuffer(), opts.password), out = [];
  try{
    for(const n of pageNos){
      const page = await pdf.getPage(n), base = page.getViewport({scale: 1}), vp = page.getViewport({scale: Math.min(1, 360 / base.width)});
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({canvasContext: ctx, viewport: vp, intent: "print"}).promise;
      out.push({n, url: canvas.toDataURL("image/jpeg", 0.82)});
      canvas.width = canvas.height = 0;
    }
  } finally { pdf.destroy().catch(() => {}); }
  return out;
};

// opts.ocr(i, n, страница) — ход распознавания страниц-картинок; без него (Node, проверки) картинки не распознаются.
// opts.password — пароль защищённой выписки, если человек его ввёл.
WL.parseFile = async function(file, opts = {}){
  // Таблицу разбирает sheet.js: у выгрузки колонки уже размечены, и гадать не нужно.
  if(!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return WL.parseSheet(file);
  let pages = await pdfLines(await file.arrayBuffer(), opts.password);
  let doc = await parsePdfPages(pages, file);
  if(doc && !doc.unknown) coverage(doc, pages, null);
  const rank = d => !d || d.unknown ? 0 : ({partial: 1, unverified: 2, ok: 3})[WL.quality ? WL.quality(d).status : "unverified"];
  const targets = ocrTargets(pages, doc && !doc.unknown ? doc : null);
  if(targets.length && targets.length <= 12 && opts.ocr && typeof document !== "undefined" && rank(doc) < 3){
    try{
      const ocr = await ocrPages(await file.arrayBuffer(), targets, opts.ocr, opts.signal, opts.password);
      const merged = pages.map((ls, i) => { const o = ocr[i + 1]; return !o || !o.length ? ls : ls.length ? [...ls, ...o].sort((a, b) => a.y - b.y) : o; });
      Object.defineProperty(merged, "meta", {value: pages.meta, enumerable: false});
      const doc2 = await parsePdfPages(merged, file);
      if(doc2 && !doc2.unknown){
        coverage(doc2, merged, ocr);
        // Распознанное принимаем, если выписка сошлась с итогами банка. Без итога — только если у каждой позиции с распознанной
        // страницы есть количество, цена и стоимость, и они сходятся между собой (иначе WL.quality отметила бы противоречие).
        const fromOcr = doc2.positions.filter(p => p.page && ocr[p.page] && ocr[p.page].length);
        const sure = rank(doc2) === 3 || (rank(doc2) === 2 && fromOcr.length && fromOcr.every(p => p.type === "cash" || (p.qty != null && p.price != null && p.value != null)));
        if(sure){
          const used = doc2.pages.ocr;
          doc = doc2; pages = merged;
          if(used.length) doc.note = [doc.note, used.length === 1
            ? WL.t(`страница ${used[0]} — картинка: текст распознан на этом компьютере и сверен`, `page ${used[0]} is an image: its text was recognised on this computer and checked`)
            : WL.t(`страницы ${used.join(", ")} — картинки: текст распознан на этом компьютере и сверен`, `pages ${used.join(", ")} are images: their text was recognised on this computer and checked`)].filter(Boolean).join(" · ");
        } else if(doc && !doc.unknown){
          doc.note = [doc.note, WL.t("распознавание текста на страницах-картинках не помогло сверить выписку", "recognising text on the image pages did not help reconcile the statement")].filter(Boolean).join(" · ");
        }
      }
    }catch(e){ if(!(opts.signal && opts.signal.aborted)) console.warn("OCR failed", e); }
  }
  if(doc && !doc.unknown) Object.defineProperty(doc, "accountIds", {value: WL.accountIds(pages.flat()), enumerable: false, configurable: true});
  return doc;
};
async function parsePdfPages(pages, file){
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
  // Interactive Brokers: счёт только с деньгами (с бумагами — общий разбор ниже или ИИ).
  if(/Activity Statement/i.test(head) && /Interactive Brokers/i.test(head)){
    const doc = parseIBActivity(pages, file.name);
    if(doc) return doc;
  }
  // Скан — это картинка без текста: читать в нём нечего, и сказать надо именно это.
  if(!pages.some(lines => lines.length)) return {unknown: true, fileName: file.name, pdf: true, scan: true};
  // Выписка по счёту с остатком (банк, история операций): деньги на конец периода — позиция отчёта.
  const cashDoc = parseCashStatement(pages, file.name);
  if(cashDoc) return cashDoc;
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
}
/* ── Текст для распознавания ИИ ────────────────────────────────────────────
   Уходит на сервер только по согласию пользователя и только когда выписку не удалось прочитать здесь.
   Не отправляем шапку первой страницы (имя и адрес клиента), её повторы дальше и короткие строки, повторяющиеся
   на страницах (колонтитулы с именем и номером портфеля); шапки таблиц оставляем — без них не понять колонки.
   Номера счетов, IBAN, почту и телефоны маскируем; имя файла не уходит. Числа текста запоминаем, чтобы
   проверить ответ: сумма, которой нет в выписке, — выдумка, и такой разбор не принимаем. */
const MASK = "▇";
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
// Подпись перед именем владельца: «Client», «Owner:», «Mr», «Владелец». Имя после неё закрываем в любой строке текста.
const OWNER_LABEL = /^(account holder|beneficial owner|beneficiary|client name|name of (?:the )?client|owner|holder|client|customer|titulaire|b[ée]n[ée]ficiaire|kontoinhaber|inhaber|kunde|attn\.?|c\/o|владелец|получатель|клиент)\s*[:\-–]?\s+(.+)$/iu;
const HONORIFIC = /^(mr|mrs|ms|miss|dr|prof|herr|frau|mme|madame|monsieur|m|sig|sra|sr|г-н|г-жа|господин|госпожа)\.?$/iu;
const personLike = x => { const ws = x.split(/\s+/).filter(Boolean);
  return ws.length >= 1 && ws.length <= 5 && !/\d/.test(x) && ws.some(w => !GENERIC_HEAD.test(w) && !HONORIFIC.test(w)) && ws.every(w => /^[\p{Lu}"«(]/u.test(w) || HONORIFIC.test(w) || /^(de|da|di|van|von|der|la|le|du|del|y|и)$/i.test(w)); };
// Числа строки текста для ИИ со знаком: по ним ответ модели проверяется в строке своей бумаги. Тот же разбор — для текста,
// который человек поправил перед отправкой: проверяется ровно то, что ушло.
const TOK = /[(\-]?\d[\d'’ .,]*\d\)?-?|\d/g;
function aiLines(text){
  const lines = [], numbers = new Set();
  let page = 1;
  String(text || "").split("\n").forEach(raw => {
    const pm = /^--- page (\d+) ---$/.exec(raw.trim());
    if(pm){ page = +pm[1]; return; }
    if(!raw.trim()) return;
    const L = {page, text: raw, lower: raw.toLowerCase(), cells: raw.split(" | ").map(c => c.trim()), signed: new Set(), abs: new Set()};
    (raw.replace(DASHES, "-").match(TOK) || []).forEach(tok => {
      const a = amount(tok.trim());
      if(!a) return;
      const c = Math.round(Math.abs(a.value) * 100);
      numbers.add(c); L.abs.add(c); L.signed.add(Math.sign(a.value || 1) * c);
    });
    lines.push(L);
  });
  return {lines, numbers};
}
WL.aiLines = aiLines;
WL.pdfAiText = async function(file, opts = {}){
  const pages = await pdfLines(await file.arrayBuffer(), opts.password);
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
  // «Market value | 1 234 567» в сводке — подпись, а не имя, и в шапках таблиц её закрывать нельзя. Из «Client Alice Qatest»
  // закрываем и саму фразу, и имя без подписи: в таблице оно встречается как «Owner Alice Qatest».
  const head = new Set(headLines.map(L => norm(L.text)).filter(k => k.length >= 10));
  const phrases = headLines.filter(L => !lineCells(L).some(isNumCell)).flatMap(L => lineCells(L).map(c => c.s.replace(/\s+/g, " ").trim()))
    .filter(x => !/\d/.test(x) && x.length >= 5 && x.length <= 48 && /^\S+(\s+\S+){1,5}$/.test(x) && !SECTION.test(x) && !Object.keys(WL.sheetMap ? WL.sheetMap([x]) : {}).length &&
      x.split(/[\s:.,;-]+/).filter(Boolean).some(w => !GENERIC_HEAD.test(w)));
  const bare = phrases.map(x => { const m = OWNER_LABEL.exec(x); let rest = (m ? m[2] : x).split(/\s+/); while(rest.length && HONORIFIC.test(rest[0])) rest = rest.slice(1); return rest.join(" "); })
    .filter(x => x.split(/\s+/).length >= 2 && x.length >= 5 && personLike(x));
  const names = [...new Set([...phrases, ...bare])].sort((a, b) => b.length - a.length)
    .map(x => new RegExp(`(^|[^\\p{L}\\p{N}])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "giu"));
  // Номера счёта, портфеля и договора из подписей «ACCOUNT NUMBER: 537630», «PORTFOLIO 537630-1» на любой странице —
  // и дальше закрываем их везде, где они встречаются: в заголовках таблиц, описаниях счетов, ссылках.
  const ids = new Set();
  accountTokens(pages.flat()).forEach(({tok}) => (tok.match(/\d{5,}/g) || []).forEach(d => ids.add(d)));
  // Номера сделок и платежей («Reference FT2603560827») тоже закрываем.
  pages.flat().forEach(L => (L.text.match(/\breference\b[^\d\n|]{0,12}?([A-Z]{0,4}\d{6,})/gi) || []).forEach(m => (m.match(/\d{6,}/g) || []).forEach(d => ids.add(d))));
  const idRe = ids.size ? new RegExp(`[A-Z]{0,4}[\\d.\\/-]*(?:${[...ids].join("|")})[\\d.\\/-]*`, "g") : null;
  // Ячейка «Owner Alice Qatest» или «Client: A. Qatest» в любом месте текста: подпись оставляем, имя закрываем.
  const owner = cell => { const m = OWNER_LABEL.exec(cell); return m && personLike(m[2].trim()) ? cell.slice(0, cell.length - m[2].length) + MASK : cell; };
  const hide = line => { let a = names.reduce((x, re) => x.replace(re, (m, pre) => pre + MASK), line); return idRe ? a.replace(idRe, MASK) : a; };
  const out = [];
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
      rows.push(hide(maskLine(cells.map(c => owner(c.s)).join(" | "))));
    });
    if(!rows.length) return;
    out.push(`--- page ${pi + 1} ---`, ...rows);
  });
  const text = out.join("\n");
  const {lines, numbers} = aiLines(text);
  // Страницы-картинки в текст не попадают: их модель не видит, и отчёт по такому тексту неполный, пока их не распознать.
  const unread = (pages.meta || []).map((m, i) => m && !m.blank && (!m.text || (m.boxes.length && i >= fp)) ? i + 1 : 0).filter(Boolean);
  return {text, ctx, numbers, lines, accountIds: WL.accountIds(pages.flat()), pages: {count: pages.length, unread}};
};

/* ── Проверка ответа ИИ по тексту, который ушёл в модель ─────────────────────
   Модель — не источник цифр, а указатель на них. Каждое число позиции должно стоять в строке этой бумаги (по ISIN, тикеру
   или названию; если их нет — в строке, где есть и количество, и стоимость) или в её продолжении до следующей строки таблицы,
   с тем же знаком. Сумма соседней бумаги, выдуманная себестоимость, чужая валюта так не подтвердятся. Итог берётся из строк
   итога самого текста, не из ответа: иначе модель, пропустив бумагу, «сверилась» бы с придуманной суммой. Строки таблиц
   позиций, которых нет в ответе, перечисляются. */
const CCY_RE = /(?<![A-Za-z])(USD|EUR|CHF|GBP|JPY|CAD|AUD|NZD|HKD|SGD|SEK|NOK|DKK|PLN|CZK|HUF|RUB|CNY|CNH|INR|AED|ILS|TRY|ZAR|MXN|BRL|KRW|TWD|THB)(?![A-Za-z])/g;
const CCY_SIGN = {"$": ["USD", "CAD", "AUD", "NZD", "HKD", "SGD", "MXN"], "€": ["EUR"], "£": ["GBP"], "¥": ["JPY", "CNY"], "₽": ["RUB"]};
const ccysIn = text => { const out = new Set((String(text).toUpperCase().match(CCY_RE) || []));
  Object.entries(CCY_SIGN).forEach(([sg, cs]) => { if(String(text).includes(sg)) cs.forEach(c => out.add(c + "?")); }); return out; };
const TOTAL_LINE = /(?<!\p{L})(total|sub-?total|grand total|net assets|total assets|portfolio value|account value|gesamt\p{L}*|summe|totale?|итого|всего|чистые активы)(?!\p{L})/iu;
const GENERIC_NAME = /^(inc|corp|corporation|co|ltd|limited|plc|ag|sa|nv|se|llc|lp|the|of|and|class|cl|shares?|common|stock|ord|ordinary|adr|fund|etf|ucits|acc|dist|bond|bonds|note|notes|trust|group|holdings?|company|reg|registered|put|call)$/i;
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
// Разделы выписки без позиций: операции, заявки, доходы, отчёт о деньгах, примечания. «Notes» без уточнения — нет: так бывает
// назван раздел структурных нот.
const NOT_HOLDINGS = /^(transactions?\b|transaction (details|summary|history)|account activity|activity\b|pending\b|open orders?\b|orders?\b|trades?\b|executed trades|cash (activity|transactions?|report|movements?)\b|income (summary|details)|dividends?\b|realized|deposits?\b|withdrawals?\b|transfers?\b|fees\b|corporate actions|mark-to-market|change in nav|endnotes|legal notes|notes\/legal|codes\b|disclosures?\b|terms and conditions|bank sweep activity|umsätze|buchungen|mouvements|opérations|операции|движение)/i;
const ACTION_ROW = /^(open orders?|pending|buy|sell|bought|sold|sell short|buy to (open|close)|sell to (open|close)|exercised?|assigned|assignment|expired)\b/i;
const CASH_LINE = /(balance|cash|ending|closing|остаток|saldo|solde|guthaben|kontostand)/i;
function dateForms(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); if(!m) return null;
  const [y, mo, d] = [m[1], m[2], m[3]], yy = y.slice(2), mon = Object.keys(MON3)[+mo - 1];
  return [`${y}-${mo}-${d}`, `${d}.${mo}.${y}`, `${d}/${mo}/${y}`, `${mo}/${d}/${y}`, `${d}.${mo}.${yy}`, `${mo}/${d}/${yy}`, `${d}/${mo}/${yy}`,
    `${+d} ${mon}`, `${mon} ${+d}`, `${d}${mon}${yy}`, `${mon}${yy}`].map(x => x.toLowerCase());
}
const DATE_ANY = new RegExp(`\\b(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}|\\d{1,2}\\s?${MONTH_RE}\\s?\\d{2,4}|${MONTH_RE}\\s\\d{1,2},?\\s\\d{4})\\b`, "i");
WL.aiVerify = function(prep, ps){
  const lines = prep.lines || [];
  const cellsOf = L => L.cells || L.text.split(" | ").map(c => c.trim());
  const numCells = L => cellsOf(L).filter(c => NUMLIKE.test(c)).length;
  const rowLike = L => /\p{L}{3,}/u.test(cellsOf(L)[0] || "") && numCells(L) >= 2;
  const totalLike = L => TOTAL_LINE.test(L.text);
  const headKeys = L => !numCells(L) && WL.sheetMap ? Object.keys(WL.sheetMap(cellsOf(L))) : [];
  // Таблица строки — ближайшая шапка выше; шапка позиций — с названием и количеством или стоимостью, без даты сделки.
  // Заголовок раздела без позиций («Transaction Details», «Pending / Open Activity», «Cash Report») закрывает таблицу позиций:
  // строки под ним до следующей шапки — заявки и операции, даже если шапку их таблицы узнать не удалось (−2).
  let tab = -1;
  const heads = {};
  const sectionOff = L => { const c = cellsOf(L); return c.length <= 3 && !numCells(L) && NOT_HOLDINGS.test(c.join(" ").trim()); };
  const tableOf = lines.map((L, i) => { const k = headKeys(L); if(k.length >= 2){ tab = i; heads[i] = k; } else if(sectionOff(L)) tab = -2; return tab; });
  const holdingsTable = ti => ti === -1 || (ti >= 0 && (() => { const k = heads[ti] || []; return (k.includes("name") || k.includes("ticker")) && (k.includes("qty") || k.includes("value")) && !k.includes("date"); })());
  const esc = x => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = (text, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
  const sig = p => String(p.name || "").toLowerCase().split(/[^\p{L}\p{N}&]+/u).filter(w => w.length >= 3 && !GENERIC_NAME.test(w) && !/^\d+$/.test(w));
  const strongAt = p => lines.map((L, i) => (p.isin && L.text.toUpperCase().includes(String(p.isin).toUpperCase())) ||
    (p.ticker && String(p.ticker).length >= 2 && word(L.text, String(p.ticker))) ? i : -1).filter(i => i >= 0);
  const nameAt = p => { const ws = sig(p), full = String(p.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    return lines.map((L, i) => (ws.length ? ws.filter(w => word(L.lower, w)).length / ws.length >= 0.6 : full.length >= 4 && L.lower.includes(full)) ? i : -1).filter(i => i >= 0); };
  const cents = v => Math.round(Math.abs(v) * 100);
  const anchors = ps.map(p => {
    let at = strongAt(p);
    if(!at.length) at = nameAt(p);
    if(!at.length && p.quantity != null && p.market_value != null)             // названия в тексте нет — строка, где есть оба числа
      at = lines.map((L, i) => L.abs.has(cents(p.quantity)) && L.abs.has(cents(p.market_value)) ? i : -1).filter(i => i >= 0);
    if(!at.length && p.asset_class === "cash" && p.market_value != null)     // остаток счёта: строка с этой суммой и словом «остаток»
      at = lines.map((L, i) => L.abs.has(cents(p.market_value)) && CASH_LINE.test(L.text) ? i : -1).filter(i => i >= 0);
    if(p.page){ const on = at.filter(i => lines[i].page === p.page); if(on.length) at = on; }
    return at;
  });
  const owner = new Map();
  anchors.forEach((at, k) => at.forEach(i => { if(!owner.has(i)) owner.set(i, new Set()); owner.get(i).add(k); }));
  const other = (i, k) => owner.has(i) && [...owner.get(i)].some(q => q !== k);
  // Строка бумаги и её продолжение. ISIN или название часто стоят в строке под числами («ISIN US…» у частных банков):
  // тогда начало — ближайшая строка таблицы выше, если она не чужая.
  const blockOf = (i, k) => {
    const ok = j => lines[j].page === lines[i].page && !totalLike(lines[j]) && headKeys(lines[j]).length < 2 && !other(j, k);
    let start = i;
    if(!rowLike(lines[i])) for(let j = i - 1; j >= 0 && j >= i - 3 && ok(j); j--){ if(rowLike(lines[j])){ start = j; break; } }
    const out = []; for(let j = start; j <= i; j++) out.push(j);
    const bare = !lines[i].abs.size && start === i;
    for(let j = i + 1; j < lines.length && j <= i + 3; j++){
      if(!ok(j)) break;
      if(rowLike(lines[j]) && !(bare && j === i + 1)) break;
      out.push(j);
    }
    return out;
  };
  const allCcy = new Set(lines.flatMap(L => [...ccysIn(L.text)]).map(c => c.replace("?", "")));
  const exact = new Set(lines.flatMap(L => (L.text.toUpperCase().match(CCY_RE) || [])));
  const claimed = new Set();
  const pos = ps.map((p, k) => {
    const has = (blk, v) => blk.some(i => lines[i].signed.has(v < 0 ? -cents(v) : cents(v)));
    const hasAbs = (blk, v) => blk.some(i => lines[i].abs.has(cents(v)));
    const short = blk => blk.some(i => /(^|\|\s*)S(\s*\||$)|\bshort\b|\bsold\b|\bwritten\b/i.test(lines[i].text));
    const money = (blk, v) => v == null || has(blk, v) || (v < 0 && hasAbs(blk, v) && short(blk));
    const MONEY = ["market_value", "quantity", "price", "accrued_interest"];
    let best = null;
    anchors[k].forEach(i => {
      const blk = blockOf(i, k), miss = MONEY.filter(f => !money(blk, p[f]));
      if(!best || miss.length < best.miss.length) best = {blk, miss};
    });
    if(!best) return {doubt: ["row"], drop: [], block: []};
    const blk = best.blk, text = blk.map(i => lines[i].text).join(" | ");
    blk.forEach(i => claimed.add(i));
    const doubt = [...best.miss], drop = [];
    ["cost_price", "cost_value"].forEach(f => { if(p[f] != null && !hasAbs(blk, p[f])) drop.push(f); });
    // Себестоимость потеряна, только если не подтвердилась её сумма. Цену покупки за штуку модель часто досчитывает сама
    // (сумма ÷ количество ÷ 100 у опционов): если сумма в строке есть, средняя цена следует из неё, и говорить не о чем.
    const costLost = drop.includes("cost_value") || (drop.includes("cost_price") && (p.cost_value == null || drop.includes("cost_value")));
    // Валюта: код в строке бумаги, в шапке её таблицы, а если во всём тексте одна валюта — она. Другой код там — противоречие;
    // кода нет нигде — валюту спросим у человека, как в выгрузке без валюты.
    let ccy = "ok";
    const c = String(p.currency || "").toUpperCase(), here = ccysIn(text);
    const headIx = tableOf[blk[0]], headC = headIx >= 0 ? ccysIn(lines[headIx].text) : new Set();
    const fits = set => set.has(c) || set.has(c + "?");
    if(here.size) ccy = fits(here) ? "ok" : "bad";
    else if(headC.size) ccy = fits(headC) ? "ok" : "bad";
    else if(exact.size === 1) ccy = exact.has(c) ? "ok" : "bad";
    else if(!allCcy.size) ccy = "guess";
    else ccy = allCcy.has(c) ? "guess" : "bad";
    if(!c) ccy = allCcy.size ? "bad" : "guess";
    if(ccy === "bad") doubt.push("currency");
    // Даты и условия опциона: чужая дата в строке — противоречие; даты нет — поле остаётся с пометкой «не подтверждено».
    const lower = text.toLowerCase(), forms = dateForms(p.maturity);
    const date = !p.maturity ? null : forms && forms.some(f => lower.includes(f)) ? "ok" : DATE_ANY.test(text) ? "bad" : "unknown";
    const strike = p.strike == null ? null : hasAbs(blk, p.strike) || String(p.name || "").includes(String(p.strike)) ? "ok" : "unknown";
    const under = !p.underlying ? null : word(text, p.underlying) || word(String(p.name || ""), p.underlying) ? "ok" : "unknown";
    return {doubt, drop, costLost, block: blk, ccy, date, strike, under};
  });
  // Итоги документа по валютам: числа строк итога.
  const totals = [];
  lines.forEach((L, i) => {
    if(!totalLike(L)) return;
    const cs = [...ccysIn(L.text)].filter(x => !x.endsWith("?"));
    const headC = tableOf[i] >= 0 ? [...ccysIn(lines[tableOf[i]].text)].filter(x => !x.endsWith("?")) : [];
    const ccy = cs.length === 1 ? cs[0] : !cs.length && headC.length === 1 ? headC[0] : !cs.length && exact.size === 1 ? [...exact][0] : null;
    totals.push({line: i, ccy, values: [...L.signed].map(v => v / 100)});
  });
  // Строки таблиц позиций, которых нет в ответе. Строка заявки или сделки («Sell», «Open Orders 07/15») — не позиция.
  const missed = lines.map((L, i) => rowLike(L) && !totalLike(L) && !claimed.has(i) && holdingsTable(tableOf[i]) && !ACTION_ROW.test(cellsOf(L)[0] || "") ? i : -1)
    .filter(i => i >= 0).map(i => ({line: i, label: cellsOf(lines[i])[0]}));
  return {pos, totals, missed};
};
WL.util = {num, amount, dmy, iso, pad, round2, titleCase};
})();
