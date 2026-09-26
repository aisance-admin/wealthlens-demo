/* WealthLens · управление: файлы → чтение → отчёт. Отчёт и прочитанное хранятся в этом браузере; файлы выписок — в
   IndexedDB, чтобы после перезагрузки или возврата с оплаты показать страницу-источник и дочитать непрочитанное. */
(function(){
const WL = window.WL, t = WL.t, $ = WL.$, esc = WL.esc;
const STORE = "wl_report_v2";
const FILE_PARALLEL = 3, PART_PARALLEL = 4;
WL.blobs = {};

const fresh = () => ({v: 2, rid: WL.uid(), client: t("Мой портфель", "My portfolio"), base: "USD", files: [], docs: [], include: {}, review: null, chats: {}, fx: {}, created: Date.now()});
function load(){
  const s = WL.store.get(STORE);
  if(!s || s.v !== 2 || !Array.isArray(s.files) || !Array.isArray(s.docs)) return fresh();
  // Чтение, прерванное закрытием вкладки, не продолжается само: файл помечается, его можно повторить.
  delete s.qa;
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
  if(WL.market && WL.market.apply) WL.market.apply(WL.model, s);
  if(s.demo && WL.demoReview) s.review = WL.demoReview(WL.model);
  WL.save(); WL.render();
  // курсы ЕЦБ по дням — для динамики валютных бумаг (дата покупки, начало периода); пришли — пересчитать
  if(WL.ensureFxSeries) WL.ensureFxSeries(WL.model).then(ch => { if(ch){ WL.fxsVer = (WL.fxsVer || 0) + 1; WL.render(); } }).catch(() => {});
};
/* Свежие котировки — при каждом открытии отчёта, после чтения и по кнопке «Обновить». */
let marketBusy = null;
WL.refreshMarket = () => {
  if(marketBusy) return marketBusy;
  if(!WL.model || !WL.model.positions.length) return Promise.resolve(false);
  WL.marketLoading = true; WL.render();
  marketBusy = WL.market.refresh(WL.state, WL.model).then(ok => ok).catch(() => false).then(async ok => {
    WL.marketLoading = false; WL.marketTried = true; marketBusy = null;
    if(!ok) WL.toast(t("Котировки не загрузились — показаны данные выписок. Попробуйте «Обновить» позже.", "Market data did not load — statement values are shown. Try “Refresh” later."));
    await WL.rebuild();
    // цены закрытия по дням — для раздела «Стоимость по дням»; пришли — перерисовать
    if(WL.nav) WL.nav.load(WL.model, WL.state).then(async ch => {
      if(!ch) return;
      // в примере — цены на дату его выписки (demo.js), затем пересчёт; в настоящем отчёте — только перерисовать
      if(WL.state.demo && WL.demoReprice && WL.demoReprice(WL.state, WL.nav.series())) await WL.rebuild();
      WL.fxsVer = (WL.fxsVer || 0) + 1; WL.render();
    });
    return ok;
  });
  return marketBusy;
};

/* ── Пароль к защищённому файлу ─────────────────────────────────────── */
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
    await autoFix(partPool);
  }finally{
    WL.reading = false;
    await WL.rebuild();
    if(WL.quotaHit) quotaMessage();
    await WL.refreshMarket();
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
/* У каждого файла своя остановка чтения (кнопка «×» в панели чтения); «Новый отчёт» останавливает все. */
const fileAborts = {};
async function readOne(f, pool, only){
  const s = WL.state, gen = s.rid;
  if(!s.files.includes(f)) return;                       // файл отменили, пока он ждал очереди
  f.status = "reading"; f.done = 0; f.total = 0; f.reason = ""; f.found = 0;
  renderReadingSoon();
  let blob = WL.blobs[f.id] || await WL.files.get(f.id);
  if(!blob){ f.status = "error"; f.reason = t("файла нет в этом браузере — добавьте его снова", "the file isn't in this browser — add it again"); return; }
  WL.blobs[f.id] = blob;
  const ctl = new AbortController(), stop = () => ctl.abort();
  fileAborts[f.id] = ctl; abort.signal.addEventListener("abort", stop, {once: true});
  try{
    const prev = only ? s.docs.find(d => d.fileId === f.id) : null;
    const doc = await WL.readFile(f, blob, {pool, auth: WL.pay.auth, signal: ctl.signal, askPassword, only,
      ctx: prev ? {institution: prev.institution, as_of: prev.as_of, ref_ccy: prev.ref_ccy, type: prev.type, accounts: prev.accounts} : undefined,
      onProgress: (done, total) => { f.done = done; f.total = total; renderReadingSoon(); },
      onPart: d => { f.found = (f.found || 0) + (d.rows || []).filter(r => r.table !== "S").length; if(!f.inst && d.doc && d.doc.institution) f.inst = d.doc.institution; renderReadingSoon(); }});
    if(WL.state.rid !== gen || ctl.signal.aborted) return;   // пока читали, начали новый отчёт или отменили файл
    const merged = prev ? WL.mergeDocs(prev, doc) : doc;
    merged.accts = await WL.acctPrints(merged);
    const i = s.docs.findIndex(d => d.fileId === f.id);
    if(i >= 0) s.docs[i] = merged; else s.docs.push(merged);
    const quota = merged.failed.some(x => x.error === "quota"), readAny = merged.pages.length || merged.rows.length;
    f.status = readAny ? "done" : "error";
    if(!readAny) f.reason = quota ? t("лимит бесплатного чтения на сегодня исчерпан", "today's free reading limit is used up") : t("файл не удалось прочитать — попробуйте ещё раз", "the file could not be read — try again");
    WL.pay.extendPaid();
  }catch(e){
    if(WL.state.rid !== gen || ctl.signal.aborted) return;
    if(!(e && e.code)) console.error("WealthLens: файл не прочитан", e);
    f.status = e && e.code === "password" ? "skipped" : "error"; f.reason = errText(e);
  }finally{ delete fileAborts[f.id]; abort.signal.removeEventListener("abort", stop); }
  WL.save();
  if(!WL.quotaHit) await WL.rebuild();
}
/* После чтения — без участия клиента (модель Саши, 24.09.2026). Страницы, не прочитанные из-за сбоя сервиса, дочитываются
   один раз сами. Выписка, у которой сумма позиций не сошлась с её итогом, перечитывается с подсказкой, на сколько не
   сошлось, и остаётся тот вариант, что лучше сходится с итогом. Числа не подгоняются: не сошлось и после повтора — так и
   показано. Каждая выписка перепроверяется не больше одного раза (отметка recheck хранится в отчёте). */
const RETRY_ERR = /^(ai failed|busy|timeout|network|http|too_large|empty|bad_response)$/;
async function autoFix(pool){
  const s = WL.state;
  if(s.demo) return;
  for(const f of s.files.slice()){
    const d = s.docs.find(x => x.fileId === f.id);
    if(WL.quotaHit || !d || d.autoRetried || !d.failed.length || !d.failed.every(x => RETRY_ERR.test(x.error || ""))) continue;
    d.autoRetried = true;
    await WL.sleep(3000);
    await readOne(f, pool, d.failed.map(x => ({from: x.from, to: x.to})));
  }
  await WL.rebuild();
  const m = WL.model;
  if(!m) return;
  for(const info of m.docs.filter(x => (x.use || x.history) && x.recon && (x.recon.status === "mismatch" || x.recon.status === "partial"))){
    const d = s.docs.find(x => x.id === info.id), f = s.files.find(x => x.id === info.id);
    if(WL.quotaHit || !d || !f || d.recheck) continue;
    const c = info.recon.checks.filter(x => !x.ok && !x.unchecked).sort((a, b) => (b.scope === "total") - (a.scope === "total"))[0];
    if(c) await recheck(f, d, c, pool);
  }
}
function recheckPages(d){
  const n = d.pageCount || 1;
  if(n <= 12) return Array.from({length: n}, (_, i) => i + 1);
  const set = new Set();
  d.rows.forEach(r => r.page && set.add(r.page));
  d.totals.forEach(x => x.page && set.add(x.page));
  (d.pages || []).filter(p => ["holdings", "cash", "summary"].includes(p.kind)).forEach(p => set.add(p.n));
  return [...set].filter(p => p >= 1 && p <= n).sort((a, b) => a - b).slice(0, 12);
}
const toRanges = ps => ps.reduce((out, p) => { const last = out[out.length - 1]; if(last && last.to === p - 1) last.to = p; else out.push({from: p, to: p}); return out; }, []);
const recScore = r => { const c = r.checks.filter(x => !x.unchecked).sort((a, b) => (b.scope === "total") - (a.scope === "total"))[0];
  return {status: r.status, rank: {ok: 3, partial: 1}[r.status] || 0, diff: c ? Math.abs(c.diff) : Infinity}; };
async function recheck(f, d, c, pool){
  const s = WL.state, pages = recheckPages(d);
  const blob = WL.blobs[f.id] || await WL.files.get(f.id);
  if(!pages.length || !blob) return;
  WL.blobs[f.id] = blob;
  const before = recScore(WL.reconOf(d, s));
  d.recheck = {at: Date.now(), pages: pages.length, before, kept: "old"};      // отметка сразу: второй раз не перечитываем
  f.status = "reading"; f.checking = true; f.done = 0; f.total = 0; renderReadingSoon();
  const ctl = new AbortController(), stop = () => ctl.abort();
  fileAborts[f.id] = ctl; abort.signal.addEventListener("abort", stop, {once: true});
  try{
    const fresh = await WL.readFile(f, blob, {pool, auth: WL.pay.auth, signal: ctl.signal, askPassword, only: toRanges(pages),
      ctx: {institution: d.institution, as_of: d.as_of, ref_ccy: d.ref_ccy, type: d.type, accounts: d.accounts, check: {label: c.label, printed: c.amount, read: c.shown ?? c.sum, ccy: c.ccy}},
      onProgress: (done, total) => { f.done = done; f.total = total; renderReadingSoon(); }});
    if(ctl.signal.aborted || !fresh.rows.length) return;
    const on = new Set(pages);
    const cand = Object.assign({}, d, {rows: d.rows.filter(r => !on.has(r.page)).concat(fresh.rows).map((r, i) => Object.assign({}, r, {id: `${d.id}:${i + 1}`, doc: d.id})),
      totals: d.totals.concat(fresh.totals.filter(x => !d.totals.some(y => y.label === x.label && y.amount === x.amount))),
      flows: (d.flows || []).concat((fresh.flows || []).filter(x => !(d.flows || []).some(y => y.kind === x.kind && y.amount === x.amount))),
      notes: d.notes.concat(fresh.notes.filter(n => !d.notes.includes(n))),
      usage: {in: (d.usage.in || 0) + (fresh.usage.in || 0), out: (d.usage.out || 0) + (fresh.usage.out || 0), model: fresh.usage.model || d.usage.model, key: fresh.usage.key || d.usage.key}});
    const after = recScore(WL.reconOf(cand, s)), better = after.rank > before.rank || (after.rank === before.rank && after.diff < before.diff * 0.5);
    Object.assign(d.recheck, {after, kept: better ? "new" : "old"});
    if(better) s.docs[s.docs.indexOf(d)] = Object.assign(cand, {recheck: d.recheck});
  }catch(e){ if(!(e && e.code)) console.error("WealthLens: самопроверка", e); }
  finally{ delete fileAborts[f.id]; abort.signal.removeEventListener("abort", stop); f.status = "done"; f.checking = false; WL.save(); await WL.rebuild(); }
}
async function reread(id){
  const s = WL.state, f = s.files.find(x => x.id === id); if(!f || WL.reading) return;
  const d = s.docs.find(x => x.fileId === id);
  WL.quotaHit = null;
  WL.reading = true; WL.render();
  try{ await readOne(f, WL.makePool(PART_PARALLEL), d && d.failed && d.failed.length && f.status === "done" ? d.failed.map(x => ({from: x.from, to: x.to})) : undefined); }
  finally{ WL.reading = false; await WL.rebuild(); if(WL.quotaHit) quotaMessage(); requestReview(); }
}
/* Отмена файла во время чтения: ещё не прочитанный файл убирается из отчёта; у прочитанного останавливается только
   дочитывание, прочитанное остаётся. */
function cancelFile(id){
  const s = WL.state, f = s.files.find(x => x.id === id); if(!f) return;
  const had = s.docs.some(d => d.fileId === id);
  if(fileAborts[id]) fileAborts[id].abort();
  if(had) f.status = "done";
  else { s.files = s.files.filter(x => x !== f); delete s.include[id]; delete WL.blobs[id]; WL.files.del(id); }
  WL.save(); WL.render();
  WL.toast(had ? t(`Дочитывание «${f.name}» остановлено`, `Stopped reading “${f.name}”`) : t(`Чтение остановлено — «${f.name}» убран из отчёта`, `Reading stopped — “${f.name}” removed from the report`));
}
function quotaMessage(){
  const paid = !WL.pay.locked();
  WL.dialog({eyebrow: t("Лимит чтения", "Reading limit"), title: t("На сегодня страницы закончились", "No more pages for today"),
    body: `<p>${WL.quotaHit === "free" && !paid ? t("Бесплатно мы читаем ограниченное число страниц в сутки. Прочитанное сохранено — откройте полный отчёт (лимит станет больше) или дочитайте файлы завтра кнопкой «Дочитать».",
      "We read a limited number of pages per day for free. What was read is saved — unlock the full report for a higher limit, or finish tomorrow with “Read again”.")
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
  const key = reviewKey(), comp = WL.reviewComp(m, s);
  if(!force && s.review && s.review.key === key && !s.review.error) return;
  const seq = ++reviewSeq;
  WL.reviewing = true; WL.render();
  const r = await WL.api("/review", Object.assign({lang: WL.lang, report: WL.compact(m, s)}, WL.pay.auth()), {timeout: 240000});
  if(seq !== reviewSeq) return;
  WL.reviewing = false;
  s.review = r && !r.error && r.summary ? {summary: r.summary, alerts: r.alerts || [], documents: r.documents || [], questions: r.questions || [], key, comp, base: m.base, lang: WL.lang, at: Date.now()}
    : {error: (r && r.error) || "failed", key, comp};
  WL.save(); WL.render();
}
const reviewSoon = () => { clearTimeout(reviewTimer); reviewTimer = setTimeout(() => requestReview(), 1500); };
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
  WL.closeDrawer(); if(WL.closeChat) WL.closeChat(); WL.render(); scrollTo(0, 0);
}
function leaveDemo(render = true){
  if(WL.closeChat) WL.closeChat();
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
  if(dl) dl.textContent = lock && WL.pay.pending() ? t("Проверяем доступ…", "Checking access…")
    : lock ? (WL.pay.promo() ? t("Полный отчёт · €0", "Full report · €0") : t(`Полный отчёт · ${WL.pay.PRICE.label}`, `Full report · ${WL.pay.PRICE.label}`)) : t("Скачать", "Download");
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
/* График «Стоимость по дням»: подсказка под указателем или пальцем (палец — ведением по графику), стрелки — по дням. */
const navOf = e => e.target && e.target.closest ? e.target.closest(".navchart") : null;
document.addEventListener("pointermove", e => { const g = navOf(e); if(g && WL.navHover) WL.navHover(g, e.clientX); });
document.addEventListener("pointerdown", e => { const g = navOf(e); if(g){ if(WL.navHover) WL.navHover(g, e.clientX); } else if(WL.navLeave) WL.navLeave(); });
document.addEventListener("pointerout", e => { const g = navOf(e); if(g && e.pointerType === "mouse" && !(e.relatedTarget && g.contains(e.relatedTarget)) && WL.navLeave) WL.navLeave(g); });
document.addEventListener("focusout", e => { const g = navOf(e); if(g && WL.navLeave) WL.navLeave(g); });
document.addEventListener("keydown", e => {
  if(e.key === "Escape" && $("#drawer").classList.contains("open")) WL.closeDrawer();
  if(navOf(e) && WL.navKey && WL.navKey(e.target, e.key)) e.preventDefault();
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
  if(el.id === "dlBtn"){ if(WL.pay.locked()) return WL.pay.pending() ? undefined : WL.pay.open("bar"); const m = $("#dlMenu"); m.hidden = !m.hidden; e.stopPropagation(); return; }
  if(d.dl){ $("#dlMenu").hidden = true; return d.dl === "pdf" ? WL.printReport() : WL.excel(); }
  const menu = $("#dlMenu"); if(menu && !menu.hidden && !el.closest("#dlMenu")) menu.hidden = true;
  if(d.base){ if(d.base === WL.state.base) return; WL.state.base = d.base; await WL.rebuild(); return; }
  if(d.per){ WL.ui.per = d.per; return WL.render(); }
  if(d.navAll !== undefined){ WL.ui.navAll = !WL.ui.navAll; return WL.render(); }
  if(d.tab){ WL.ui.tab = d.tab; WL.render(); const b = document.querySelector(".tabs"); if(b && b.getBoundingClientRect().top < 0) b.scrollIntoView({block: "start"}); return; }
  if(d.val){ WL.ui.val = d.val; return WL.render(); }
  if(d.bench){ WL.ui.bench = d.bench; return WL.render(); }
  if(d.refreshMarket !== undefined) return WL.refreshMarket();
  if(d.cat){ WL.ui.filter = d.cat; WL.ui.only = null; return WL.render(); }
  if(d.show){ WL.ui.only = d.show.split(","); WL.ui.filter = "all"; WL.ui.search = ""; WL.render(); const h = $("#holdings"); if(h) h.scrollIntoView({behavior: "smooth", block: "start"}); return; }
  if(d.clearOnly !== undefined){ WL.ui.only = null; return WL.render(); }
  if(el.matches("tr.pr")) return WL.openPos(el.dataset.pos);
  if(d.buy) return WL.pay.open(d.buy);
  if(d.restore !== undefined) return WL.pay.restore(el);
  if(d.review !== undefined) return requestReview(true);
  if(d.reread) return reread(d.reread);
  if(d.cancel) return cancelFile(d.cancel);
  if(d.goto){ const g = $("#" + d.goto); if(g) g.scrollIntoView({behavior: "smooth", block: "start"}); return; }
  if(d.include){ WL.state.include[d.include] = true; await WL.rebuild(); WL.refreshMarket(); return reviewSoon(); }
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
  if(WL.state.docs.length) await Promise.race([WL.pay.prime(), new Promise(r => setTimeout(r, 400))]);   // оплаченный отчёт открывается сразу открытым
  WL.render();
  const access = WL.pay.returnFromStripe().then(() => WL.pay.check());   // проверка оплаты — сразу, параллельно с курсами и котировками
  if(WL.state.docs.length){ await WL.rebuild(); WL.refreshMarket(); }
  await access;
  if(WL.chatReturn) await WL.chatReturn();
  if(WL.model && !WL.state.demo && (!WL.reviewNow() || WL.state.review.error || (WL.state.review.lang && WL.state.review.lang !== WL.lang))) requestReview(!!(WL.state.review && WL.state.review.lang !== WL.lang));
  if(WL.track) WL.track("ViewContent", {content_name: WL.state.demo ? "demo_report" : WL.state.docs.length ? "report" : "upload"});
})();
})();
