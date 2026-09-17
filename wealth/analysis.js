/* Экран анализа. Пока первые выписки читаются, сверяются и дополняются рыночными данными, человек видит, что именно
   происходит: шаги с настоящими числами разбора, мини-сцену текущего шага и видео, которое идёт в такт работе.
   Числа — только из состояния приложения; темп — свой: шаг не закрывается быстрее, чем успевает сыграть его сцена.
   Модуль необязательный: если он не загрузился, приложение работает как раньше, с лотком загрузок. */
(() => {
const WL = window.WL = window.WL || {};
const t = (ru, en) => (WL.t ? WL.t(ru, en) : ru);
const EN = WL.lang === "en";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const CK = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.3l2.3 2.2 4.7-5"/></svg>';
const WARN = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 2.2v4.6M6 9.3v.1"/></svg>';
const ease = k => 1 - Math.pow(1 - k, 3);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pl = (n, ru, en) => (WL.pl ? WL.pl(n, ru, en) : ru[2]);
const money = (v, ccy = "USD") => (WL.fmt ? WL.fmt.money(v, ccy, 0) : "$" + Math.round(v));

// Видео: сканирование до HOLD секунд, дальше панель делится на кольцо и столбики — это доигрывается, когда разбор готов.
const MEDIA = "wealth/media/", SLOW_AT = 4.3, HOLD_AT = 5.0, LIVE_WAIT = 8000;
const ACTIVE = /^(queued|reading|later|ask|ai|ready|mapping)$/, WAITING = /^(ask|mapping|later|ai)$/;

let A = null;     // текущий показ

/* Состояние разбора из приложения: пачка файлов, выписки этой пачки, портфель, рыночные данные. */
function facts(){
  const c = A.ctx, docs = c.docs(), P = c.P();
  let items = c.items().filter(i => i.id > c.since);
  const hashes = new Set(items.map(i => i.hash).filter(Boolean));
  let batchDocs = docs.filter(d => hashes.has(d.hash));
  // Очередь после разбора очищается — числа пачки берём из запомненного среза, иначе экран показал бы «0 файлов».
  if(items.length) A.seen = {items: items.map(i => ({id: i.id, name: i.name, state: i.state, hash: i.hash})), batchDocs};
  else if(A.seen){ items = A.seen.items; batchDocs = A.seen.batchDocs.filter(d => docs.includes(d)); }
  const read = items.filter(i => !/^(queued|reading)$/.test(i.state)).length;
  const waiting = items.some(i => WAITING.test(i.state));
  const queueDone = !c.running() && !items.some(i => ACTIVE.test(i.state));
  const added = batchDocs.length;
  const positions = batchDocs.reduce((a, d) => a + (d.positions || []).length, 0);
  const liveFresh = !!(P && A.liveP === P);
  return {items, docs, batchDocs, P, read, waiting, queueDone, added, positions, liveFresh};
}

/* Шаги. ready(f) — данные готовы; val(f) — число справа; scene — мини-сцена (build разметка, draw(el, f, k, now) кадр). */
const STEPS = [
  {key: "files", lbl: () => t("Читаю файлы", "Reading files"), min: 900,
   ready: f => f.read === f.items.length && f.items.length > 0,
   val: f => t(`${f.read} из ${f.items.length}`, `${f.read} of ${f.items.length}`),
   build: f => `<div class="an-files">${f.items.slice(0, 5).map(i => `<div class="an-file" data-id="${i.id}"><span>${esc(i.name)}</span><i><b></b></i></div>`).join("")}</div>`,
   draw: (el, f, k, now) => el.querySelectorAll(".an-file").forEach(row => {
     const it = f.items.find(i => i.id === +row.dataset.id); if(!it) return;
     const b = row.querySelector("b"), busy = /^(queued|reading)$/.test(it.state);
     row.className = "an-file" + (it.state === "error" ? " bad" : it.state === "skip" ? " off" : WAITING.test(it.state) ? " wait" : "");
     b.style.width = busy ? (18 + 62 * ((now / 1400 + it.id * .37) % 1)) + "%" : "100%";
   })},
  {key: "tables", lbl: () => t("Нахожу таблицы позиций", "Finding position tables"), min: 1100,
   ready: f => f.queueDone || (f.read === f.items.length && !f.items.some(i => /^(ready)$/.test(i.state)) && !f.waiting),
   val: f => f.waiting ? t("жду вашего решения", "waiting for you") : `${f.positions} ${pl(f.positions, ["позиция", "позиции", "позиций"], ["position", "positions"])}`,
   build: () => `<div class="an-table">${Array.from({length: 7}, (_, i) => `<div class="an-row"><u></u><s style="width:${58 + (i * 37) % 38}%"></s><em></em><span class="ck">${CK}</span></div>`).join("")}<div class="an-scan"></div></div>`,
   draw: (el, f, k, now) => {
     const rows = el.querySelectorAll(".an-row"), h = rows.length * 17, done = STEPS[1].ready(f) && k >= 1;
     const y = done ? h + 8 : ((now % 1900) / 1900) * (h + 8);
     el.querySelector(".an-scan").style.top = (10 + y) + "px";
     const lit = Math.min(rows.length, Math.round(f.positions ? rows.length * clamp(k * 1.2) : 0));
     rows.forEach((r, i) => { const on = i < lit; r.classList.toggle("read", on); r.querySelector("em").style.width = on ? (38 + (i * 23) % 58) + "%" : "0"; });
   }},
  {key: "totals", lbl: () => t("Сверяю с итогами выписок", "Checking statement totals"), min: 1100,
   ready: f => f.queueDone,
   val: f => { const q = f.batchDocs.map(d => WL.quality(d).status), ok = q.filter(s => s === "ok").length;
     return q.length ? t(`сошлось ${ok} из ${q.length}`, `${ok} of ${q.length} match`) : "—"; },
   build: f => `<div class="an-banks">${f.batchDocs.slice(0, 4).map((d, i) => `<div class="an-bank" data-i="${i}"><span>${esc(d.brokerShort || d.broker)}</span><span class="mono">—</span><span class="st"></span></div>`).join("")
     || `<div class="an-empty">${t("Жду прочитанные выписки…", "Waiting for statements…")}</div>`}</div>`,
   rebuildWhen: (el, f) => el.querySelectorAll(".an-bank").length !== Math.min(4, f.batchDocs.length),
   draw: (el, f, k) => el.querySelectorAll(".an-bank").forEach(row => {
     const i = +row.dataset.i, d = f.batchDocs[i]; if(!d) return;
     const ccy = (d.positions || []).find(p => p.ccy) ? d.positions.find(p => p.ccy).ccy : "USD";
     const sum = (d.positions || []).filter(p => !p.ccy || p.ccy === ccy).reduce((a, p) => a + (p.value || 0), 0);
     const p = clamp(k * 1.6 - i * .25);
     row.querySelector(".mono").textContent = money(sum * ease(p), ccy);
     const st = WL.quality(d).status, shown = p >= 1;
     row.className = "an-bank" + (shown ? " " + st : "");
     row.querySelector(".st").innerHTML = !shown ? "" : st === "ok" ? CK : st === "partial" ? WARN : "";
     row.title = !shown ? "" : st === "ok" ? t("итог сошёлся", "total matches") : st === "partial" ? t("есть пропуски", "gaps found") : t("итога для сверки нет", "no total to check");
   })},
  {key: "match", lbl: () => t("Сопоставляю бумаги с биржей", "Matching holdings to listings"), min: 1100,
   ready: f => f.queueDone && (f.liveFresh || A.liveLate),
   val: f => { const e = eligible(f.P); if(!f.P) return "—"; if(!e.length) return t("бумаг для биржи США нет", "no US holdings");
     if(!(f.liveFresh || A.liveLate)) return t("ищу…", "matching…");
     const ok = e.filter(p => WL.idOf(f.P, p).ok).length; return t(`${ok} из ${e.length}`, `${ok} of ${e.length}`); },
   build: f => { const e = eligible(f.P).slice(0, 10);
     return `<div class="an-chips">${e.map((p, i) => `<span class="an-chip" data-i="${i}">${esc(sym(p))}</span>`).join("")
       || `<div class="an-empty">${t("В выписках нет бумаг с американскими котировками — оценка по ценам выписок.", "No holdings with US quotes — values come from the statements.")}</div>`}</div>`; },
   rebuildWhen: (el, f) => el.querySelectorAll(".an-chip").length !== Math.min(10, eligible(f.P).length),
   draw: (el, f, k, now) => { const e = eligible(f.P), fresh = f.liveFresh || A.liveLate;
     el.querySelectorAll(".an-chip").forEach(c => { const p = e[+c.dataset.i]; if(!p) return;
       const shown = k * e.length * 1.3 >= +c.dataset.i, id = fresh ? WL.idOf(f.P, p) : null;
       c.className = "an-chip" + (shown ? " in" : "") + (id ? (id.ok ? " ok" : " stmt") : " busy");
       c.title = id && !id.ok ? t("по цене выписки", "statement price") : ""; }); }},
  {key: "quotes", lbl: () => t("Загружаю котировки Cboe и курсы ЕЦБ", "Loading Cboe quotes and ECB rates"), min: 1000,
   ready: f => f.queueDone && (f.liveFresh || A.liveLate),
   val: f => { if(!(f.liveFresh || A.liveLate)) return t("загружаю…", "loading…"); if(A.liveLate && !f.liveFresh) return t("продолжаю в фоне", "continuing in background");
     return f.P && f.P.live && f.P.live.ok ? currencies(f.P).join(" · ") : t("сервер не ответил", "server did not respond"); },
   build: f => `<div class="an-quotes">${quoteRows(f).map((r, i) => `<div class="an-q" data-i="${i}"><span>${esc(r.name)}</span><span class="mono">—</span><span class="${r.cls}">${esc(r.note)}</span></div>`).join("")}</div>`,
   rebuildWhen: (el, f) => el.querySelectorAll(".an-q").length !== quoteRows(f).length || el.dataset.fresh !== String(f.liveFresh),
   draw: (el, f, k) => { el.dataset.fresh = String(f.liveFresh); const rows = quoteRows(f);
     el.querySelectorAll(".an-q").forEach(row => { const r = rows[+row.dataset.i]; if(!r) return;
       const p = clamp(k * 1.5 - +row.dataset.i * .3);
       row.querySelector(".mono").textContent = r.value == null ? r.text || "—" : p <= 0 ? "—"
         : (p >= 1 ? r.value : r.value * (.85 + ((performance.now() / 90 | 0) % 7) * .05)).toLocaleString(EN ? "en-US" : "ru-RU", {minimumFractionDigits: r.dec, maximumFractionDigits: r.dec}); }); }},
  {key: "risks", lbl: () => t("Считаю риски и выводы", "Calculating risks and findings"), min: 1100,
   ready: f => f.queueDone && (f.liveFresh || A.liveLate),
   val: f => { const n = f.P ? WL.insights(f.P).length : 0; return `${n} ${pl(n, ["вывод", "вывода", "выводов"], ["finding", "findings"])}`; },
   build: f => { const mix = mixOf(f.P), C = 2 * Math.PI * 44; let acc = 0;
     const arcs = mix.map(m => { const s = `<circle cx="56" cy="56" r="44" fill="none" stroke="var(--cls-${m.k})" stroke-width="12" stroke-dasharray="0 ${C}" data-p="${m.share}" data-o="${acc}"/>`; acc += m.share; return s; }).join("");
     const I = f.P ? WL.insights(f.P) : [], n = lvl => I.filter(x => x.level === lvl).length;
     return `<div class="an-risk"><svg viewBox="0 0 112 112" aria-hidden="true"><circle cx="56" cy="56" r="44" fill="none" stroke="rgba(226,236,255,.07)" stroke-width="12"/>${arcs}</svg>
       <div><div class="an-legend">${mix.slice(0, 4).map(m => `<div><i style="background:var(--cls-${m.k})"></i>${esc(m.label)} <b>${Math.round(m.share * 100)}%</b></div>`).join("")}</div>
       <div class="an-badges">${[["high", t("Важно", "Important")], ["watch", t("Внимание", "Watch")], ["info", t("К сведению", "FYI")]].filter(([l]) => n(l)).map(([l, s]) => `<span class="an-badge ${l}">${s} · <b data-n="${n(l)}">0</b></span>`).join("")}</div></div></div>`; },
   draw: (el, f, k) => { const C = 2 * Math.PI * 44, e = ease(k);
     el.querySelectorAll("circle[data-p]").forEach(c => { const p = +c.dataset.p, o = +c.dataset.o, vis = clamp(e - o, 0, p);
       c.setAttribute("stroke-dasharray", `${Math.max(0, vis * C - 1.5)} ${C}`); c.setAttribute("stroke-dashoffset", String(-o * C)); });
     el.querySelectorAll("[data-n]").forEach(b => { b.textContent = String(Math.round(+b.dataset.n * clamp(k * 1.3))); }); }},
];

const sym = p => (p.type === "option" ? p.underlying : p.symbol) || p.isin || p.name;
// Бумаги, которые вообще сопоставляются с биржей США: акции, фонды и опционы в долларах (как в WL.idOf).
const eligible = P => !P ? [] : P.positions.filter(p => WL.idOf(P, p).how !== "none");
const currencies = P => [...new Set(["USD", ...P.positions.map(p => p.ccy).filter(Boolean)])];
function quoteRows(f){
  const P = f.P; if(!P) return [];
  if(!(f.liveFresh || A.liveLate)) return [{name: t("Котировки и курсы", "Quotes and rates"), value: null, text: t("загружаю…", "loading…"), note: "", cls: ""}];
  if(!P.live || !P.live.ok) return [{name: t("Сервер данных", "Data server"), value: null, text: t("не ответил", "no response"), note: t("суммы по выпискам", "statement values"), cls: "warn"}];
  const rows = [];
  const q = P.positions.find(p => WL.eq(p) && p.live && p.live.price && WL.idOf(P, p).ok);
  if(q){ const ch = q.live.prevClose ? (q.live.price / q.live.prevClose - 1) * 100 : null;
    rows.push({name: sym(q) + " · Cboe", value: q.live.price, dec: 2, note: ch == null ? "" : (WL.fmt ? WL.fmt.pct(ch) : ch.toFixed(1) + "%"), cls: ch == null ? "" : ch >= 0 ? "up" : "down"}); }
  currencies(P).filter(c => c !== "USD").slice(0, 2).forEach(c => { const r = P.live.fx && P.live.fx[c];
    if(r) rows.push(["EUR", "GBP"].includes(c) ? {name: `${c}/USD · ${t("ЕЦБ", "ECB")}`, value: 1 / r, dec: 4, note: "", cls: ""} : {name: `USD/${c} · ${t("ЕЦБ", "ECB")}`, value: r, dec: 4, note: "", cls: ""}); });
  if(!rows.length) rows.push({name: t("Позиции в долларах", "USD holdings"), value: null, text: t("по ценам выписок", "statement prices"), note: "", cls: ""});
  return rows.slice(0, 3);
}
function mixOf(P){
  if(!P) return [];
  const names = {stock: t("Акции", "Stocks"), fund: t("Фонды", "Funds"), bond: t("Облигации", "Bonds"), note: t("Ноты", "Notes"), cash: t("Деньги", "Cash"), other: t("Прочее", "Other")};
  const by = {};
  P.positions.forEach(p => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy, p); if(v == null || k == null || v * k <= 0) return;
    const key = WL.clsKey ? WL.clsKey(p.type) : "other"; by[key] = (by[key] || 0) + v * k; });
  const sum = Object.values(by).reduce((a, v) => a + v, 0);
  return sum ? Object.entries(by).map(([k, v]) => ({k, label: names[k] || k, share: v / sum})).sort((a, b) => b.share - a.share) : [];
}
function totalOf(P){
  return !P ? 0 : P.positions.reduce((a, p) => { const v = WL.current(P, p).value, k = WL.usd(P, p.ccy, p); return v != null && k != null ? a + v * k : a; }, 0);
}

/* ── Показ ─────────────────────────────────────────────────────────────── */
function begin(ctx){
  if(A) return;
  const el = document.createElement("div");
  el.className = "an no-print";
  el.setAttribute("role", "status");
  el.setAttribute("aria-label", t("Разбор выписок", "Analysing statements"));
  const tall = matchMedia("(max-width: 700px), (orientation: portrait) and (max-width: 1024px)").matches;
  const name = tall ? "analysis-tall" : "analysis-wide";
  el.innerHTML = `<div class="an-media" aria-hidden="true"><img class="an-poster" src="${MEDIA}${name}.jpg" alt="">${reduce() ? "" : `<video muted playsinline preload="auto" src="${MEDIA}${name}.mp4"></video>`}</div>
    <div class="an-body">
      <div class="an-title"><div class="eyebrow" id="anEyebrow"></div><h2 id="anHead">${t("Собираю портфель", "Building the portfolio")}</h2><p id="anSub"></p></div>
      <ol class="an-steps">${STEPS.map(s => `<li class="an-step"><span class="ico">${CK}</span><span class="lbl">${esc(s.lbl())}</span><span class="val">—</span></li>`).join("")}</ol>
      <div class="an-bar" aria-hidden="true"><i></i></div>
      <div class="an-viz" aria-hidden="true"></div>
      <div class="an-done" hidden>
        <div class="eyebrow">${t("Всего в долларах", "Total in USD")}</div>
        <div class="an-total">$0</div>
        <div class="an-note muted" hidden></div>
        <div class="an-foot"><span class="an-facts"></span><button class="btn primary" type="button" data-an-open>${t("Открыть отчёт", "Open the report")}</button></div>
      </div>
    </div>
    <button class="an-skip" type="button" data-an-open>${t("Скрыть", "Hide")}</button>`;
  document.body.appendChild(el);
  document.body.classList.add("analyzing");
  A = {ctx, el, step: 0, stepStart: 0, shownDone: new Set(), liveP: null, liveLate: false, queueDoneAt: 0, t0: performance.now(), finalAt: 0, raf: 0, closing: false};
  const v = el.querySelector("video");
  if(v){
    v.addEventListener("canplay", () => { v.classList.add("on"); const p = v.play(); if(p) p.catch(() => {}); }, {once: true});
    v.addEventListener("error", () => v.remove(), {once: true});
  }
  el.addEventListener("click", e => { if(e.target.closest("[data-an-open]")) close(); });
  A.onKey = e => { if(e.key === "Escape" && !document.querySelector(".modal")) close(); };
  document.addEventListener("keydown", A.onKey);
  requestAnimationFrame(() => el.classList.add("show"));
  A.raf = requestAnimationFrame(frame);
}

function frame(now){
  if(!A || A.closing) return;
  A.raf = requestAnimationFrame(frame);
  if(A.ctx.gen() !== A.gen && A.gen != null) return close(true);
  if(A.gen == null) A.gen = A.ctx.gen();
  const f = facts(), el = A.el, rows = el.querySelectorAll(".an-step");
  if(f.queueDone && !A.queueDoneAt) A.queueDoneAt = now;
  // Ничего не добавилось — экран не нужен: ошибки и пропуски показывает лоток загрузок.
  if(f.queueDone && !f.added && !f.docs.length) return close();
  if(f.queueDone && !A.liveLate && now - A.queueDoneAt > LIVE_WAIT) A.liveLate = true;

  el.querySelector("#anEyebrow").textContent = t(`Разбор выписок · ${f.items.length} ${pl(f.items.length, ["файл", "файла", "файлов"], ["file", "files"])}`,
    `Statement analysis · ${f.items.length} ${pl(f.items.length, ["file", "files", "files"], ["file", "files"])}`);
  el.querySelector("#anSub").textContent = [...new Set(f.batchDocs.map(d => d.brokerShort || d.broker).filter(Boolean))].join(", ") || t("Читаю файлы на этом устройстве", "Reading files on this device");

  const fast = reduce();
  if(A.step < STEPS.length){
    const s = STEPS[A.step], viz = el.querySelector(".an-viz");
    if(!A.stepStart){ A.stepStart = now; viz.innerHTML = s.build(f); }
    else if(s.rebuildWhen && viz.firstElementChild && s.rebuildWhen(viz.firstElementChild, f)) viz.innerHTML = s.build(f);
    const k = fast ? 1 : clamp((now - A.stepStart) / s.min);
    rows.forEach((r, i) => { r.className = "an-step" + (i < A.step ? " done" : i === A.step ? " active" : ""); });
    rows[A.step].querySelector(".val").textContent = s.val(f);
    if(viz.firstElementChild) s.draw(viz.firstElementChild, f, k, now);
    if(k >= 1 && s.ready(f)){
      rows[A.step].className = "an-step done";
      rows[A.step].querySelector(".val").textContent = s.val(f);
      A.step++; A.stepStart = 0;
    }
  }
  // Полоса: пройденные шаги плюс доля текущего
  const part = A.step >= STEPS.length ? 1 : (A.step + (A.stepStart ? clamp((now - A.stepStart) / STEPS[A.step].min) * .9 : 0)) / STEPS.length;
  el.querySelector(".an-bar i").style.width = (part * 100).toFixed(1) + "%";
  video(now);
  if(A.step >= STEPS.length) final(now, f);
}

// Видео идёт в такт: пока разбор не готов — сканирование, у границы сборки замедляется и ждёт; готов — доигрывается.
function video(now){
  const v = A.el.querySelector("video"); if(!v || !v.classList.contains("on")) return;
  const done = A.step >= STEPS.length;
  if(done){ if(v.paused || v.playbackRate !== 1.15){ v.playbackRate = 1.15; const p = v.play(); if(p) p.catch(() => {}); } return; }
  if(v.currentTime >= HOLD_AT){ if(!v.paused) v.pause(); }
  else v.playbackRate = v.currentTime >= SLOW_AT ? .35 : 1;
}

function final(now, f){
  const el = A.el, box = el.querySelector(".an-done");
  if(!A.finalAt){
    A.finalAt = now;
    el.querySelector("#anHead").textContent = t("Отчёт готов", "Report ready");
    const n = f.P ? f.P.positions.length : 0, docs = f.docs.length;
    el.querySelector(".an-facts").textContent = t(`${n} ${pl(n, ["позиция", "позиции", "позиций"], ["position", "positions"])} · ${docs} ${pl(docs, ["выписка", "выписки", "выписок"], ["statement", "statements"])} · ${f.P ? currencies(f.P).join(", ") : ""}`,
      `${n} ${pl(n, ["position", "positions", "positions"], ["position", "positions"])} · ${docs} ${docs === 1 ? "statement" : "statements"} · ${f.P ? currencies(f.P).join(", ") : ""}`);
    // Часть позиций без цены или курса — итог ещё не окончательный, как и в самом отчёте.
    const wait = f.P ? f.P.positions.filter(p => WL.current(f.P, p).value == null || WL.usd(f.P, p.ccy, p) == null).length : 0;
    el.querySelector(".an-note").textContent = wait ? t("Итог уточняется: ещё загружаю цены и курсы", "Total not final yet: still loading prices and rates") : "";
    el.querySelector(".an-note").hidden = !wait;
    el.querySelector(".an-viz").hidden = true;      // место под карточку итога
    box.hidden = false; requestAnimationFrame(() => box.classList.add("shine"));
    el.querySelector(".an-skip").hidden = true;
    const b = box.querySelector("[data-an-open]"); if(b) b.focus({preventScroll: true});
  }
  const k = reduce() ? 1 : clamp((now - A.finalAt) / 1000);
  el.querySelector(".an-total").textContent = money(totalOf(f.P) * ease(k));
  // Отчёт открывается сам, когда итог досчитан и панель в видео собралась.
  if(now - A.finalAt > (reduce() ? 1400 : 2600)) close();
}

function close(silent){
  if(!A || A.closing) return;
  const {el, ctx} = A;
  A.closing = true;
  cancelAnimationFrame(A.raf);
  document.removeEventListener("keydown", A.onKey);
  document.body.classList.remove("analyzing");
  el.classList.remove("show");
  const v = el.querySelector("video"); if(v) setTimeout(() => v.pause(), 450);
  setTimeout(() => el.remove(), silent ? 0 : 450);
  A = null;
  if(ctx.onClose) ctx.onClose();
}

WL.analysis = {
  begin,
  // Приложение сообщает о загрузке рыночных данных; «готово» засчитывается только для актуального портфеля.
  live(phase, P){ if(A && phase === "done") A.liveP = P; },
  active: () => !!A,
  close: () => close(),
};
})();
