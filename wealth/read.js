/* WealthLens · чтение файлов. Каждый файл превращается в страницы: изображение страницы и текстовый слой PDF (для таблиц
   Excel/CSV — текст). Страницы уходят на сервер частями по несколько штук, сервер передаёт их Claude и возвращает, что
   лежит на счетах. Первая часть файла читается первой: из неё берутся банк, дата и номера счетов — остальные части
   читаются параллельно уже с этой подсказкой. */
(function(){
const WL = window.WL, t = WL.t;

const PAGE_PX = 1600;                 // длинная сторона изображения страницы
const PAGE_MAX_BYTES = 300 * 1024;    // изображение страницы после сжатия: часть укладывается в предел запроса 4,5 МБ
const PART_PAGES = 8, PART_CHARS = 26000, PART_DENSE = 4;
const SHEET_PART = 60000;             // знаков таблицы в одной части
const MAX_PAGES = 400;                // страниц в одном файле

const SUPPORTED = /\.(pdf|png|jpe?g|webp|gif|bmp|csv|tsv|txt|xlsx|xlsm|xls|ods|html?)$/i;
function kindOf(file){
  const n = file.name || "", ty = file.type || "";
  if(/\.pdf$/i.test(n) || ty === "application/pdf") return "pdf";
  if(/\.(png|jpe?g|webp|gif|bmp)$/i.test(n) || /^image\/(png|jpeg|webp|gif|bmp)$/.test(ty)) return "image";
  if(/\.(xlsx|xlsm|xls|ods)$/i.test(n)) return "xlsx";
  if(/\.(csv|tsv|txt)$/i.test(n) || /^text\/(csv|plain|tab-separated-values)$/.test(ty)) return "text";
  if(/\.html?$/i.test(n) || ty === "text/html") return "html";
  return null;
}
function unsupportedReason(file){
  const n = (file.name || "").toLowerCase();
  if(/\.(docx?|rtf|pages|odt)$/.test(n)) return t("документ Word — сохраните его как PDF и добавьте снова", "a Word document — save it as PDF and add it again");
  if(/\.(zip|rar|7z)$/.test(n)) return t("архив — распакуйте его и добавьте папку", "an archive — unzip it and add the folder");
  if(/\.(heic|heif)$/.test(n)) return t("фото HEIC — сохраните его как JPEG или сделайте снимок экрана", "a HEIC photo — save it as JPEG or take a screenshot");
  if(/\.(numbers|key|pptx?)$/.test(n)) return t("этот формат не читается — экспортируйте в PDF или Excel", "this format can't be read — export it to PDF or Excel");
  return t("формат не поддерживается — нужен PDF, фото или скан, Excel или CSV", "unsupported format — use PDF, a photo or scan, Excel or CSV");
}
WL.fileKind = kindOf;
WL.unsupportedReason = unsupportedReason;

async function sha256(buf){
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("");
}
WL.hashFile = async file => sha256(await file.arrayBuffer());

function b64(buf){
  const u = new Uint8Array(buf); let s = "";
  for(let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const blobOf = (canvas, q) => new Promise(res => canvas.toBlob(b => res(b), "image/jpeg", q));
async function jpeg(canvas){
  let b = null;
  for(const q of [0.82, 0.72, 0.62, 0.5]){ b = await blobOf(canvas, q); if(b && b.size <= PAGE_MAX_BYTES) break; }
  if(b && b.size > PAGE_MAX_BYTES * 1.4){            // очень плотная или цветная страница: уменьшаем размер
    const c2 = document.createElement("canvas"); c2.width = Math.round(canvas.width * 0.8); c2.height = Math.round(canvas.height * 0.8);
    c2.getContext("2d").drawImage(canvas, 0, 0, c2.width, c2.height); b = await blobOf(c2, 0.6);
  }
  return b64(await b.arrayBuffer());
}

/* ── PDF ─────────────────────────────────────────────────────────────── */
const pdfjsReady = () => window.pdfjsLib ? Promise.resolve(window.pdfjsLib)
  : new Promise(res => window.addEventListener("pdfjs-ready", () => res(window.pdfjsLib), {once: true}));

/* Текстовый слой страницы строками. Повторы одного и того же текста почти в той же точке — «жирный» шрифт, нарисованный
   дважды: из-за него в выписке IB читалось «70,00070,000» — такие повторы убираем. Координаты — в развороте страницы,
   поэтому повёрнутые страницы тоже читаются строками. */
async function pageText(page){
  const vp = page.getViewport({scale: 1});
  const tc = await page.getTextContent();
  const items = [];
  for(const it of tc.items){
    const s = String(it.str || "").replace(/[​-‍⁠﻿]/g, "").replace(/[  ]/g, " ");
    if(!s.trim()) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const h = Math.max(4, Math.hypot(it.transform[2], it.transform[3]));
    items.push({s, x, y, h, w: Math.max(0, it.width || 0)});
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const kept = [];
  for(const it of items){
    const dup = kept.slice(-12).some(k => k.s === it.s && Math.abs(k.x - it.x) < Math.max(1.6, it.h * 0.35) && Math.abs(k.y - it.y) < it.h * 0.35);
    if(!dup) kept.push(it);
  }
  const lines = [];
  for(const it of kept){
    const ln = lines.length ? lines[lines.length - 1] : null;
    if(ln && Math.abs(ln.y - it.y) < Math.min(ln.h, it.h) * 0.5) ln.items.push(it);
    else lines.push({y: it.y, h: it.h, items: [it]});
  }
  return lines.map(ln => {
    ln.items.sort((a, b) => a.x - b.x);
    let out = "", end = null;
    for(const it of ln.items){
      if(end != null){ const gap = it.x - end; out += gap > it.h * 1.1 ? "  |  " : gap > it.h * 0.12 ? " " : ""; }
      out += it.s; end = it.x + it.w;
    }
    return out.replace(/\s+$/, "");
  }).join("\n");
}

async function openPdf(file, askPassword){
  const lib = await pdfjsReady();
  const data = new Uint8Array(await file.arrayBuffer());
  let password;
  for(let attempt = 0; attempt < 4; attempt++){
    try{
      const pdf = await lib.getDocument({data: data.slice(), password, isEvalSupported: false}).promise;
      return pdf;
    }catch(e){
      if(e && e.name === "PasswordException"){
        password = await askPassword(file.name, e.code === 2);
        if(password == null) throw Object.assign(new Error("password"), {code: "password"});
        continue;
      }
      throw Object.assign(new Error("pdf"), {code: "broken"});
    }
  }
  throw Object.assign(new Error("password"), {code: "password"});
}

async function renderPage(page, px = PAGE_PX){
  const vp1 = page.getViewport({scale: 1});
  const scale = Math.min(3, Math.max(0.6, px / Math.max(vp1.width, vp1.height)));
  const vp = page.getViewport({scale});
  const c = document.createElement("canvas");
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext("2d", {alpha: false});
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({canvasContext: ctx, viewport: vp}).promise;
  const img = await jpeg(c);
  c.width = c.height = 0;
  return img;
}
WL.renderPdfPage = async (blob, n, px = 1400) => {
  const lib = await pdfjsReady();
  const pdf = await lib.getDocument({data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false}).promise;
  try{
    const page = await pdf.getPage(Math.min(Math.max(1, n), pdf.numPages));
    const vp1 = page.getViewport({scale: 1}), vp = page.getViewport({scale: Math.min(3, px / vp1.width)});
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({canvasContext: c.getContext("2d"), viewport: vp}).promise;
    return c;
  }finally{ pdf.destroy(); }
};

/* ── Картинки, таблицы, HTML ─────────────────────────────────────────── */
async function imageToJpeg(file, px = 2000){
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, px / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d", {alpha: false}); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  return jpeg(c);
}
function loadXLSX(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => { const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = () => res(window.XLSX); s.onerror = rej; document.head.appendChild(s); });
}
WL.loadXLSX = loadXLSX;
async function sheetText(file, kind){
  if(kind === "text") return (await file.text()).replace(/\r\n?/g, "\n");
  if(kind === "html"){
    const doc = new DOMParser().parseFromString(await file.text(), "text/html");
    doc.querySelectorAll("script,style,noscript").forEach(n => n.remove());
    // таблицы — строками с разделителем ячеек, остальное — текстом
    doc.querySelectorAll("tr").forEach(tr => { tr.textContent = [...tr.children].map(td => td.textContent.replace(/\s+/g, " ").trim()).join(" | ") + "\n"; });
    return (doc.body ? doc.body.textContent : "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }
  const X = await loadXLSX();
  const wb = X.read(new Uint8Array(await file.arrayBuffer()), {type: "array", cellDates: true});
  return wb.SheetNames.map(n => {
    const csv = X.utils.sheet_to_csv(wb.Sheets[n], {FS: " | ", blankrows: false}).split("\n").filter(l => l.replace(/[\s|]/g, "")).join("\n");
    return csv ? `### Sheet: ${n}\n${csv}` : "";
  }).filter(Boolean).join("\n\n");
}
function splitSheet(text){
  if(text.length <= SHEET_PART) return [text];
  const lines = text.split("\n"), head = lines.find(l => l.trim() && !l.startsWith("###")) || "", parts = [];
  let cur = [];
  for(const l of lines){
    if(cur.join("\n").length + l.length > SHEET_PART && cur.length){ parts.push(cur.join("\n")); cur = l.startsWith("###") ? [] : [head]; }
    cur.push(l);
  }
  if(cur.length) parts.push(cur.join("\n"));
  return parts;
}

/* ── Части и чтение ──────────────────────────────────────────────────── */
function planParts(chars){
  const parts = [];
  let from = 1, sum = 0, dense = 0;
  chars.forEach((c, i) => {
    const n = i + 1, count = n - from;
    if(count > 0 && (count >= PART_PAGES || sum + c > PART_CHARS || dense >= PART_DENSE)){ parts.push({from, to: n - 1}); from = n; sum = 0; dense = 0; }
    sum += c; if(c > 3500) dense++;
  });
  if(chars.length) parts.push({from, to: chars.length});
  return parts;
}

class Quota extends Error { constructor(scope){ super("quota"); this.scope = scope; } }
WL.Quota = Quota;

/* Одна часть: до трёх повторов при перегрузке, деление пополам при слишком длинном ответе. */
async function readPart(src, part, env, depth = 0){
  const body = Object.assign({file: src.name, lang: WL.lang, part: {from: part.from, to: part.to, total: src.total}, ctx: env.ctx || undefined}, env.auth ? env.auth() : {});
  if(src.kind === "sheet") body.sheet = src.sheets[part.from - 1];
  else body.pages = await src.pages(part.from, part.to);
  let res = null;
  if(WL.quotaHit) return [{part, error: "quota"}];
  for(let attempt = 0; attempt < 4; attempt++){
    if(env.signal && env.signal.aborted) return [{part, error: "aborted"}];
    res = await WL.api("/read", body, {signal: env.signal});
    // Лимит бесплатного чтения: остальные части не отправляем, прочитанное сохраняется — дочитать можно позже.
    if(res.error === "quota"){ WL.quotaHit = res.scope || "free"; return [{part, error: "quota"}]; }
    if(!["busy", "network", "timeout", "http"].includes(res.error) || attempt === 3) break;
    await WL.sleep([2500, 7000, 16000][attempt] + Math.random() * 1500);
  }
  body.pages = null;
  if((res.error === "too_large" || res.error === "timeout") && part.to > part.from && depth < 3){
    const mid = Math.floor((part.from + part.to) / 2);
    const a = await readPart(src, {from: part.from, to: mid}, env, depth + 1), b = await readPart(src, {from: mid + 1, to: part.to}, env, depth + 1);
    return [].concat(a, b);
  }
  if(res.error) return [{part, error: res.error}];
  env.onPages && env.onPages(part.to - part.from + 1);
  env.onPart && env.onPart(res);
  return [{part, data: res}];
}

/* Файл → источник страниц. askPassword(name, wrong) → пароль или null. */
async function openSource(file, kind, askPassword){
  if(kind === "pdf"){
    const pdf = await openPdf(file, askPassword);
    const total = Math.min(pdf.numPages, MAX_PAGES), chars = [], texts = [];
    for(let n = 1; n <= total; n++){
      const page = await pdf.getPage(n);
      const text = (await pageText(page)).slice(0, 60000);
      texts.push(text); chars.push(text.length); page.cleanup();
    }
    return {kind, name: file.name, total, truncated: pdf.numPages > MAX_PAGES, fullPages: pdf.numPages, parts: planParts(chars),
      pages: async (from, to) => { const out = [];
        for(let n = from; n <= to; n++){ const page = await pdf.getPage(n); out.push({n, img: await renderPage(page), type: "image/jpeg", text: texts[n - 1]}); page.cleanup(); }
        return out; },
      close: () => pdf.destroy()};
  }
  if(kind === "image"){
    const img = await imageToJpeg(file);
    return {kind, name: file.name, total: 1, parts: [{from: 1, to: 1}], pages: async () => [{n: 1, img, type: "image/jpeg", text: ""}], close(){}};
  }
  const sheets = splitSheet(await sheetText(file, kind));
  if(!sheets.length || !sheets.join("").trim()) throw Object.assign(new Error("empty"), {code: "empty"});
  return {kind: "sheet", name: file.name, total: sheets.length, sheets, parts: sheets.map((_, i) => ({from: i + 1, to: i + 1})), close(){}};
}

/* Слияние частей в документ. Сведения о документе — из первой части, где они есть; счета, итоги и курсы — без повторов. */
const TYPE_RANK = {portfolio: 5, brokerage: 4, bank: 3, transactions: 2, other_financial: 1, not_financial: 0};
function merge(file, src, results){
  const doc = {id: file.id, fileId: file.id, file: file.name, kind: src.kind, pageCount: src.total, fullPages: src.fullPages || src.total, truncated: !!src.truncated,
    type: "", institution: "", as_of: "", period: "", ref_ccy: "", accounts: [], totals: [], fx: [], pages: [], notes: [], rows: [], failed: [], usage: {in: 0, out: 0, model: ""}};
  const ok = results.filter(r => r.data).sort((a, b) => a.part.from - b.part.from);
  for(const {data: d} of ok){
    const m = d.doc || {};
    if(m.type && (!doc.type || (TYPE_RANK[m.type] || 0) > (TYPE_RANK[doc.type] || 0))) doc.type = m.type;
    for(const k of ["institution", "as_of", "period", "ref_ccy"]) if(!doc[k] && m[k]) doc[k] = String(m[k]).trim();
    for(const a of d.accounts || []) if(a.id && !doc.accounts.some(x => x.id === a.id)) doc.accounts.push({id: a.id, label: a.label || "", currency: (a.currency || "").toUpperCase()});
    for(const x of d.totals || []){ const key = [x.label, x.currency, x.amount, x.account].join("|");
      if(isFinite(x.amount) && !doc.totals.some(y => [y.label, y.currency, y.amount, y.account].join("|") === key)) doc.totals.push(Object.assign({}, x, {currency: (x.currency || "").toUpperCase()})); }
    for(const x of d.fx || []) if(x.currency && x.rate > 0 && !doc.fx.some(y => y.currency === x.currency.toUpperCase())) doc.fx.push({currency: x.currency.toUpperCase(), rate: x.rate, page: x.page});
    doc.pages.push(...(d.pages || []));
    for(const n of d.notes || []) if(n && !doc.notes.includes(n)) doc.notes.push(n);
    doc.rows.push(...(d.rows || []));
    if(d.usage){ doc.usage.in += d.usage.in || 0; doc.usage.out += d.usage.out || 0; doc.usage.model = d.usage.model || doc.usage.model; }
  }
  if(/^[a-z]{3}$/i.test(doc.ref_ccy)) doc.ref_ccy = doc.ref_ccy.toUpperCase(); else doc.ref_ccy = "";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) doc.as_of = "";
  doc.rows.forEach((r, i) => { r.id = `${doc.id}:${i + 1}`; r.doc = doc.id; });
  doc.failed = results.filter(r => r.error).map(r => ({from: r.part.from, to: r.part.to, error: r.error})).sort((a, b) => a.from - b.from);
  return doc;
}

/* Дочитанные страницы — в уже прочитанный документ. */
WL.mergeDocs = (a, b) => {
  const out = Object.assign({}, a);
  for(const k of ["type", "institution", "as_of", "period", "ref_ccy"]) if(!out[k] && b[k]) out[k] = b[k];
  out.accounts = a.accounts.concat(b.accounts.filter(x => !a.accounts.some(y => y.id === x.id)));
  out.totals = a.totals.concat(b.totals.filter(x => !a.totals.some(y => y.label === x.label && y.amount === x.amount && y.currency === x.currency)));
  out.fx = a.fx.concat(b.fx.filter(x => !a.fx.some(y => y.currency === x.currency)));
  out.pages = a.pages.concat(b.pages.filter(x => !a.pages.some(y => y.n === x.n))).sort((x, y) => x.n - y.n);
  out.notes = a.notes.concat(b.notes.filter(x => !a.notes.includes(x)));
  out.rows = a.rows.concat(b.rows).map((r, i) => Object.assign({}, r, {id: `${a.id}:${i + 1}`, doc: a.id}));
  out.failed = b.failed;
  out.usage = {in: (a.usage.in || 0) + (b.usage.in || 0), out: (a.usage.out || 0) + (b.usage.out || 0), model: b.usage.model || a.usage.model};
  return out;
};

/* Чтение файла целиком. env: {pool, auth, signal, askPassword, onProgress(done, total)} */
WL.readFile = async (file, blob, env) => {
  const kind = kindOf(blob);
  if(!kind) throw Object.assign(new Error("unsupported"), {code: "unsupported"});
  const src = await openSource(blob, kind, env.askPassword);
  // Дочитать только непрочитанные страницы: части — в пределах переданных диапазонов.
  if(env.only && env.only.length){
    const lim = src.kind === "sheet" ? 1 : PART_PAGES;
    src.parts = env.only.flatMap(r => { const out = []; for(let a = r.from; a <= Math.min(r.to, src.total); a += lim) out.push({from: a, to: Math.min(r.to, a + lim - 1, src.total)}); return out; });
  }
  const want = src.parts.reduce((s, x) => s + x.to - x.from + 1, 0);
  let done = 0;
  const progress = n => { done += n; env.onProgress && env.onProgress(done, want); };
  env.onProgress && env.onProgress(0, want);
  try{
    const partEnv = {auth: env.auth, signal: env.signal, onPages: progress, onPart: env.onPart};
    const [first, ...rest] = src.parts;
    if(env.ctx) partEnv.ctx = env.ctx;
    const r1 = await env.pool(() => readPart(src, first, partEnv));
    const firstOk = !env.ctx && r1.find(r => r.data);
    if(firstOk){
      const d = firstOk.data, m = d.doc || {};
      partEnv.ctx = {institution: m.institution || "", as_of: m.as_of || "", ref_ccy: m.ref_ccy || "", type: m.type || "", accounts: d.accounts || []};
    }
    const more = await Promise.all(rest.map(p => env.pool(() => readPart(src, p, partEnv))));
    return merge(file, src, r1.concat(...more));
  }finally{ try{ src.close(); }catch(e){} }
};

/* Пул: не больше n частей одновременно на весь отчёт (лимиты Anthropic и сервера). */
WL.makePool = n => {
  let active = 0; const q = [];
  const next = () => { while(active < n && q.length){ const {fn, res, rej} = q.shift(); active++;
    Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); }); } };
  return fn => new Promise((res, rej) => { q.push({fn, res, rej}); next(); });
};
})();
