/* WealthLens · управление: файлы → Claude → отчёт. Отчёт и прочитанное хранятся в этом браузере; файлы выписок — в
   IndexedDB, чтобы после перезагрузки или возврата с оплаты показать страницу-источник и дочитать непрочитанное. */
(function(){
const WL = window.WL, t = WL.t, $ = WL.$, esc = WL.esc;
const STORE = "wl_report_v2", CONSENT = "wl_claude_ok_v1";
const FILE_PARALLEL = 3, PART_PARALLEL = 4;
WL.blobs = {};

const fresh = () => ({v: 2, rid: WL.uid(), client: t("Мой портфель", "My portfolio"), base: "USD", files: [], docs: [], include: {}, review: null, qa: [], fx: {}, created: Date.now()});
function load(){
  const s = WL.store.get(STORE);
  if(!s || s.v !== 2 || !Array.isArray(s.files) || !Array.isArray(s.docs)) return fresh();
  // Чтение, прерванное закрытием вкладки, не продолжается само: файл помечается, его можно повторить.
  s.files.forEach(f => { if(/queued|reading/.test(f.status)){ f.status = "error"; f.reason = t("чтение прервалось — нажмите «Повторить»", "reading was interrupted — use “Try again”"); } });
  return Object.assign(fresh(), s);
}
const params = new URLSearchParams(location.search);
WL.state = params.has("demo") && WL.demoState ? WL.demoState() : load();

WL.save = () => {
  const s = WL.state;
  if(s.demo) return true;
  const ok = WL.store.set(STORE, s);
  if(!ok && !WL.saveWarned){ WL.saveWarned = true; WL.toast(t("Браузер не сохраняет отчёт: после перезагрузки его не будет. Скачайте PDF или Excel.", "The browser is not saving the report: it will be gone after a reload. Download the PDF or Excel.")); }
  return ok;
};

WL.rebuild = async () => {
  const s = WL.state;
  if(!s.docs.length){ WL.model = null; WL.render(); return; }
  await WL.ensureFx(s, s.base);
  WL.model = WL.build(s);
  if(s.demo && WL.demoReview) s.review = WL.demoReview(WL.model);
  WL.save(); WL.render();
};

/* ── Согласие и пароль ──────────────────────────────────────────────── */
async function consent(){
  if(WL.store.get(CONSENT)) return true;
  const {choice} = await WL.dialog({eyebrow: "Claude", title: t("Выписки прочитает Claude", "Claude will read your statements"),
    body: `<p>${t("Страницы файлов — изображение и текст — уйдут через наш сервер в модель Claude компании Anthropic. Claude вернёт позиции, остатки и итоги, из них соберётся отчёт.",
      "The file pages — image and text — go through our server to Anthropic's Claude model. Claude returns holdings, balances and totals, and the report is built from them.")}</p>
      <p class="muted">${t("Мы не храним ни файлы, ни ответ. Отчёт остаётся только в этом браузере, кнопка «Новый отчёт» его удаляет.",
      "We store neither the files nor the answer. The report stays only in this browser; “New report” deletes it.")}</p>`,
    buttons: [{id: "ok", label: t("Продолжить", "Continue"), primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}]});
  if(choice !== "ok") return false;
  WL.store.set(CONSENT, 1);
  return true;
}
async function askPassword(name, wrong){
  const {choice, value} = await WL.dialog({eyebrow: t("Файл защищён паролем", "Password-protected file"), title: esc(name),
    body: `<p>${wrong ? t("Пароль не подошёл. Попробуйте ещё раз.", "The password didn't work. Try again.") : t("Введите пароль от файла — его знает только этот браузер, на сервер он не уходит.", "Enter the file's password — it stays in this browser and is not sent to the server.")}</p>`,
    input: {type: "password", placeholder: t("Пароль", "Password")},
    buttons: [{id: "ok", label: t("Открыть", "Open"), primary: true}, {id: "skip", label: t("Пропустить файл", "Skip the file")}], cancel: "skip"});
  return choice === "ok" && value ? value : null;
}

/* ── Добавление файлов ──────────────────────────────────────────────── */
/* Файл из поля выбора или перетаскивания — сразу в память: после очистки поля (или нового выбора) Chrome больше не даёт
   читать прежние файлы («NotReadableError»), а чтение идёт минутами. */
async function inMemory(f){
  try{ return new File([await f.arrayBuffer()], f.name, {type: f.type || "", lastModified: f.lastModified}); }catch(e){ console.error("WealthLens: файл недоступен", e); return null; }
}
async function addFiles(list){
  let files = [...(list || [])].filter(f => f && f.size > 0 && !/^\.|^~\$/.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.webkitRelativePath || ""));
  if(!files.length) return;
  const paths = new Map(files.map(f => [f, f.webkitRelativePath || ""]));
  files = (await Promise.all(files.map(async f => { const m = await inMemory(f); if(m) m.relPath = paths.get(f); return m; }))).filter(Boolean);
  if(!files.length){ WL.toast(t("Файлы не удалось открыть — выберите их ещё раз.", "The files could not be opened — select them again.")); return; }
  if(WL.state.demo) leaveDemo(false);
  if(!await consent()) return;
  const s = WL.state;
  let dup = 0;
  for(const f of files){
    const kind = WL.fileKind(f);
    const entry = {id: WL.uid(), name: f.name, path: f.relPath || "", size: f.size, kind: kind || "", status: kind ? "queued" : "skipped",
      reason: kind ? "" : WL.unsupportedReason(f), done: 0, total: 0, hash: ""};
    if(kind){
      try{ entry.hash = await WL.hashFile(f); }catch(e){ console.error("WealthLens: хеш файла", e); }
      if(entry.hash && s.files.some(x => x.hash === entry.hash)){ dup++; continue; }
      WL.blobs[entry.id] = f; WL.files.put(entry.id, f);
    }
    s.files.push(entry);
  }
  if(dup) WL.toast(dup === 1 ? t("Этот файл уже в отчёте", "This file is already in the report") : t(`${dup} файла уже в отчёте`, `${dup} files are already in the report`));
  WL.save(); WL.render(); runQueue();
}

/* ── Очередь чтения ─────────────────────────────────────────────────── */
let readingTimer = null;
const renderReadingSoon = () => { if(readingTimer) return; readingTimer = setTimeout(() => { readingTimer = null; WL.renderReading(); }, 300); };
let abort = new AbortController();
async function runQueue(){
  if(WL.reading) return;
  WL.reading = true; WL.quotaHit = null;
  const partPool = WL.makePool(PART_PARALLEL), filePool = WL.makePool(FILE_PARALLEL);
  WL.render();
  try{
    for(;;){
      const queued = WL.state.files.filter(f => f.status === "queued");
      if(!queued.length) break;
      queued.forEach(f => { f.status = "reading"; });
      await Promise.all(queued.map(f => filePool(() => readOne(f, partPool))));
    }
  }finally{
    WL.reading = false;
    await WL.rebuild();
    if(WL.quotaHit) quotaMessage();
    requestReview();
  }
}
function errText(e){
  const c = e && e.code;
  return c === "password" ? t("файл защищён паролем — пропущен", "password-protected — skipped")
    : c === "broken" ? t("файл повреждён или это не PDF", "the file is damaged or not a PDF")
    : c === "empty" ? t("в файле нет данных", "the file has no data")
    : c === "unsupported" ? t("формат не поддерживается", "unsupported format")
    : t("не удалось прочитать файл — попробуйте ещё раз", "could not read the file — try again");
}
async function readOne(f, pool, only){
  const s = WL.state, gen = s.rid;
  f.status = "reading"; f.done = 0; f.total = 0; f.reason = ""; f.found = 0;
  renderReadingSoon();
  let blob = WL.blobs[f.id] || await WL.files.get(f.id);
  if(!blob){ f.status = "error"; f.reason = t("файла нет в этом браузере — добавьте его снова", "the file isn't in this browser — add it again"); return; }
  WL.blobs[f.id] = blob;
  try{
    const prev = only ? s.docs.find(d => d.fileId === f.id) : null;
    const doc = await WL.readFile(f, blob, {pool, auth: WL.pay.auth, signal: abort.signal, askPassword, only,
      ctx: prev ? {institution: prev.institution, as_of: prev.as_of, ref_ccy: prev.ref_ccy, type: prev.type, accounts: prev.accounts} : undefined,
      onProgress: (done, total) => { f.done = done; f.total = total; renderReadingSoon(); },
      onPart: d => { f.found = (f.found || 0) + (d.rows || []).filter(r => r.table !== "S").length; if(!f.inst && d.doc && d.doc.institution) f.inst = d.doc.institution; renderReadingSoon(); }});
    if(WL.state.rid !== gen) return;                   // пока читали, начали новый отчёт
    const merged = prev ? WL.mergeDocs(prev, doc) : doc;
    merged.accts = await WL.acctPrints(merged);
    const i = s.docs.findIndex(d => d.fileId === f.id);
    if(i >= 0) s.docs[i] = merged; else s.docs.push(merged);
    const quota = merged.failed.some(x => x.error === "quota"), readAny = merged.pages.length || merged.rows.length;
    f.status = readAny ? "done" : "error";
    if(!readAny) f.reason = quota ? t("лимит бесплатного чтения на сегодня исчерпан", "today's free reading limit is used up") : t("Claude не смог прочитать файл — попробуйте ещё раз", "Claude could not read the file — try again");
    WL.pay.extendPaid();
  }catch(e){
    if(WL.state.rid !== gen) return;
    if(!(e && e.code)) console.error("WealthLens: файл не прочитан", e);
    f.status = e && e.code === "password" ? "skipped" : "error"; f.reason = errText(e);
  }
  WL.save();
  if(!WL.quotaHit) await WL.rebuild();
}
async function reread(id){
  const s = WL.state, f = s.files.find(x => x.id === id); if(!f || WL.reading) return;
  const d = s.docs.find(x => x.fileId === id);
  WL.quotaHit = null;
  WL.reading = true; WL.render();
  try{ await readOne(f, WL.makePool(PART_PARALLEL), d && d.failed && d.failed.length && f.status === "done" ? d.failed.map(x => ({from: x.from, to: x.to})) : undefined); }
  finally{ WL.reading = false; await WL.rebuild(); if(WL.quotaHit) quotaMessage(); requestReview(); }
}
function quotaMessage(){
  const paid = !WL.pay.locked();
  WL.dialog({eyebrow: t("Лимит чтения", "Reading limit"), title: t("На сегодня страницы закончились", "No more pages for today"),
    body: `<p>${WL.quotaHit === "free" && !paid ? t("Бесплатно Claude читает ограниченное число страниц в сутки. Прочитанное сохранено — откройте полный отчёт (лимит станет больше) или дочитайте файлы завтра кнопкой «Дочитать».",
      "Claude reads a limited number of pages per day for free. What was read is saved — unlock the full report for a higher limit, or finish tomorrow with “Read again”.")
      : t("Сервис сегодня перегружен. Прочитанное сохранено — дочитайте файлы позже кнопкой «Дочитать».", "The service is at capacity today. What was read is saved — finish later with “Read again”.")}</p>`,
    buttons: WL.quotaHit === "free" && !paid && WL.pay.PAYWALL ? [{id: "buy", label: t("Открыть полный отчёт", "Unlock the full report"), primary: true}, {id: "cancel", label: t("Позже", "Later")}] : [{id: "cancel", label: "OK", primary: true}]})
    .then(({choice}) => { if(choice === "buy") WL.pay.open("quota"); });
}

/* ── Сводка и вопросы ───────────────────────────────────────────────── */
let reviewSeq = 0, reviewTimer = null;
function reviewKey(){ const m = WL.model, s = WL.state; return JSON.stringify([m.base, Math.round(m.total), m.positions.length, s.docs.map(d => d.id + (s.include[d.id] ?? "")).join(","), WL.lang]); }
async function requestReview(force){
  const s = WL.state, m = WL.model;
  if(s.demo || !m || !m.positions.length || WL.reading) return;
  const key = reviewKey();
  if(!force && s.review && s.review.key === key && !s.review.error) return;
  const seq = ++reviewSeq;
  WL.reviewing = true; WL.render();
  const r = await WL.api("/review", Object.assign({lang: WL.lang, report: WL.compact(m, s)}, WL.pay.auth()), {timeout: 240000});
  if(seq !== reviewSeq) return;
  WL.reviewing = false;
  s.review = r && !r.error && r.summary ? {summary: r.summary, alerts: r.alerts || [], documents: r.documents || [], questions: r.questions || [], key, base: m.base, lang: WL.lang, at: Date.now()}
    : {error: (r && r.error) || "failed", key};
  WL.save(); WL.render();
}
const reviewSoon = () => { clearTimeout(reviewTimer); reviewTimer = setTimeout(() => requestReview(), 1500); };
async function ask(q){
  const s = WL.state, m = WL.model;
  if(!q || !m) return;
  s.qa = s.qa || [];
  const item = {q, a: null};
  s.qa.push(item); WL.render();
  const box = $("#qa"); if(box) box.lastElementChild && box.lastElementChild.scrollIntoView({block: "nearest", behavior: "smooth"});
  const r = await WL.api("/ask", Object.assign({lang: WL.lang, question: q, history: s.qa.filter(x => x !== item && x.a).slice(-6), report: WL.compact(m, s)}, WL.pay.auth()), {timeout: 150000});
  item.a = r && r.answer ? r.answer : r && r.error === "quota" ? t("На этот час вопросы закончились — попробуйте позже.", "No more questions this hour — try again later.") : t("Не удалось получить ответ. Попробуйте ещё раз.", "Could not get an answer. Please try again.");
  WL.save(); WL.render();
  const f = $("#ask input"); if(f) f.focus();
}

/* ── Отчёт целиком ──────────────────────────────────────────────────── */
async function newReport(){
  const s = WL.state;
  const paid = WL.pay.PAYWALL && !WL.pay.locked();
  const {choice} = await WL.dialog({title: t("Начать новый отчёт?", "Start a new report?"),
    body: `<p>${t("Текущий отчёт и его файлы будут удалены из этого браузера.", "The current report and its files will be deleted from this browser.")}</p>
      ${paid ? `<p class="muted">${t("Оплата привязана к этому отчёту. Чтобы добавить выписки того же портфеля, нажмите «Добавить файлы» — платить снова не придётся.", "Payment is tied to this report. To add statements of the same portfolio, use “Add files” instead — no need to pay again.")}</p>` : ""}`,
    buttons: [{id: "ok", label: t("Удалить и начать заново", "Delete and start over"), primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}]});
  if(choice !== "ok") return;
  abort.abort(); abort = new AbortController();
  await WL.files.clear();
  WL.store.del(STORE); WL.blobs = {}; WL.state = fresh(); WL.model = null; WL.reviewing = false; WL.ui = {filter: "all", search: "", only: null};
  WL.closeDrawer(); WL.render(); scrollTo(0, 0);
}
function leaveDemo(render = true){
  const u = new URL(location.href); u.searchParams.delete("demo"); history.replaceState(null, "", u.pathname + u.search + u.hash);
  WL.state = load(); WL.model = null;
  if(WL.state.docs.length) WL.rebuild(); else if(render) WL.render();
}
async function removeFile(id){
  const s = WL.state, f = s.files.find(x => x.id === id); if(!f) return;
  const {choice} = await WL.dialog({title: t("Убрать файл из отчёта?", "Remove the file from the report?"), body: `<p>${esc(f.name)}</p>`,
    buttons: [{id: "ok", label: t("Убрать", "Remove"), primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}]});
  if(choice !== "ok") return;
  s.files = s.files.filter(x => x.id !== id); s.docs = s.docs.filter(x => x.fileId !== id); delete s.include[id]; delete WL.blobs[id];
  WL.files.del(id);
  await WL.rebuild(); reviewSoon();
}

/* ── Панель сверху ──────────────────────────────────────────────────── */
WL.renderBar = () => {
  const lock = WL.pay.locked(), s = WL.state;
  const dl = $("#dlBtn");
  if(dl) dl.textContent = lock ? (WL.pay.promo() ? t("Полный отчёт · €0", "Full report · €0") : t(`Полный отчёт · ${WL.pay.PRICE.label}`, `Full report · ${WL.pay.PRICE.label}`)) : t("Скачать", "Download");
  const busy = WL.reading;
  ["#addBtn", "#newBtn"].forEach(k => { const b = $(k); if(b) b.disabled = !!s.demo && k === "#addBtn" ? false : false; });
  const menu = $("#dlMenu"); if(menu && lock) menu.hidden = true;
  document.body.classList.toggle("is-reading", !!busy);
};

/* ── События ────────────────────────────────────────────────────────── */
const pick = kind => { const el = $(kind === "folder" ? "#folderInput" : "#fileInput"); if(el) el.click(); };
document.addEventListener("change", e => {
  if(e.target.id === "fileInput" || e.target.id === "folderInput"){ const input = e.target, list = [...input.files]; addFiles(list).finally(() => { input.value = ""; }); }
});
async function filesFromDrop(dt){
  const entries = [...(dt.items || [])].map(i => i.kind === "file" && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null).filter(Boolean);
  if(!entries.length) return [...(dt.files || [])];
  const out = [];
  const walk = async e => {
    if(e.isFile) out.push(await new Promise((res, rej) => e.file(res, rej)).catch(() => null));
    else if(e.isDirectory){ const r = e.createReader(); for(;;){ const batch = await new Promise((res, rej) => r.readEntries(res, rej)).catch(() => []); if(!batch.length) break; for(const x of batch) await walk(x); } }
  };
  for(const e of entries) await walk(e);
  return out.filter(Boolean);
}
let dragDepth = 0;
window.addEventListener("dragenter", e => { if([...(e.dataTransfer?.types || [])].includes("Files")){ dragDepth++; document.body.classList.add("dragging"); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if(!dragDepth) document.body.classList.remove("dragging"); });
window.addEventListener("dragover", e => { if([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
window.addEventListener("drop", e => {
  if(!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
  filesFromDrop(e.dataTransfer).then(addFiles);
});

let searchTimer = null, clientTimer = null;
document.addEventListener("input", e => {
  if(e.target.id === "search"){ clearTimeout(searchTimer); const v = e.target.value; searchTimer = setTimeout(() => { WL.ui.search = v; WL.ui.only = null; WL.render(); }, 140); }
  if(e.target.id === "client"){ clearTimeout(clientTimer); const v = e.target.value; clientTimer = setTimeout(() => { WL.state.client = v.slice(0, 80); WL.save(); }, 250); }
});
document.addEventListener("submit", e => {
  if(e.target.id !== "ask") return;
  e.preventDefault();
  const q = (e.target.q.value || "").trim(); if(!q) return;
  e.target.q.value = ""; ask(q);
});
document.addEventListener("keydown", e => {
  if(e.key === "Escape" && $("#drawer").classList.contains("open")) WL.closeDrawer();
  if(e.key === "Enter" && e.target.matches && e.target.matches("tr.pr")) WL.openPos(e.target.dataset.pos);
});
document.addEventListener("click", async e => {
  const el = e.target.closest("button, a, tr.pr, #scrim"); if(!el) { const m = $("#dlMenu"); if(m) m.hidden = true; return; }
  const d = el.dataset || {};
  if(el.id === "scrim" || d.close !== undefined) return WL.closeDrawer();
  if(d.pick) return pick(d.pick);
  if(el.id === "addBtn") return pick("files");
  if(el.id === "newBtn") return WL.state.demo ? leaveDemo() : newReport();
  if(el.id === "langBtn"){ const u = new URL(location.href); u.searchParams.set("lang", WL.EN ? "ru" : "en"); location.href = u.toString(); return; }
  if(el.id === "dlBtn"){ if(WL.pay.locked()) return WL.pay.open("bar"); const m = $("#dlMenu"); m.hidden = !m.hidden; e.stopPropagation(); return; }
  if(d.dl){ $("#dlMenu").hidden = true; return d.dl === "pdf" ? WL.printReport() : WL.excel(); }
  const menu = $("#dlMenu"); if(menu && !menu.hidden && !el.closest("#dlMenu")) menu.hidden = true;
  if(d.base){ if(d.base === WL.state.base) return; WL.state.base = d.base; await WL.rebuild(); return; }
  if(d.cat){ WL.ui.filter = d.cat; WL.ui.only = null; return WL.render(); }
  if(d.show){ WL.ui.only = d.show.split(","); WL.ui.filter = "all"; WL.ui.search = ""; WL.render(); const h = $("#holdings"); if(h) h.scrollIntoView({behavior: "smooth", block: "start"}); return; }
  if(d.clearOnly !== undefined){ WL.ui.only = null; return WL.render(); }
  if(el.matches("tr.pr")) return WL.openPos(el.dataset.pos);
  if(d.buy) return WL.pay.open(d.buy);
  if(d.restore !== undefined) return WL.pay.restore(el);
  if(d.review !== undefined) return requestReview(true);
  if(d.reread) return reread(d.reread);
  if(d.include){ WL.state.include[d.include] = true; await WL.rebuild(); return reviewSoon(); }
  if(d.exclude){ WL.state.include[d.exclude] = false; await WL.rebuild(); return reviewSoon(); }
  if(d.remove) return removeFile(d.remove);
  if(d.setccy){
    let [id, c] = d.setccy.split("|");
    if(c === "?"){ const r = await WL.dialog({title: t("Валюта выписки", "Statement currency"), body: `<p>${t("Трёхбуквенный код: USD, EUR, KZT, AED…", "A three-letter code: USD, EUR, KZT, AED…")}</p>`,
      input: {placeholder: "USD"}, buttons: [{id: "ok", label: "OK", primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}]}); if(r.choice !== "ok") return; c = String(r.value || "").trim().toUpperCase(); }
    if(!/^[A-Z]{3}$/.test(c)) return WL.toast(t("Нужен трёхбуквенный код валюты, например USD.", "Use a three-letter currency code, for example USD."));
    const doc = WL.state.docs.find(x => x.fileId === id); if(!doc) return;
    doc.ref_ccy = c; doc.rows.forEach(r => { if(!r.ccy) r.ccy = c; }); doc.totals.forEach(x => { if(!x.currency) x.currency = c; });
    await WL.rebuild(); return reviewSoon();
  }
  if(d.new !== undefined) return leaveDemo();
});
window.addEventListener("beforeunload", e => { if(WL.reading && !WL.leaving){ e.preventDefault(); e.returnValue = ""; } });

/* ── Запуск ─────────────────────────────────────────────────────────── */
(async () => {
  if(WL.state.docs.length){ try{ WL.model = WL.build(WL.state); }catch(e){ console.error(e); WL.model = null; } }
  WL.render();
  if(WL.state.docs.length) await WL.rebuild();
  await WL.pay.returnFromStripe();
  await WL.pay.check();
  if(WL.model && !WL.state.demo && (!WL.state.review || WL.state.review.error || (WL.state.review.lang && WL.state.review.lang !== WL.lang))) requestReview(!!(WL.state.review && WL.state.review.lang !== WL.lang));
  if(WL.track) WL.track("ViewContent", {content_name: WL.state.demo ? "demo_report" : WL.state.docs.length ? "report" : "upload"});
})();
})();
