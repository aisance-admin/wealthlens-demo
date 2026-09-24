/* WealthLens · обсуждение отчёта. Любой вывод, вопрос, позицию, рынок или портфель целиком можно открыть как тему: ассистент
   сам начинает разговор — что это значит для портфеля и какие есть варианты, — дальше идёт переписка. Сообщения считаются на
   отчёт: несколько бесплатных, пакет входит в полный отчёт, дальше — пакеты сообщений. Переписка хранится вместе с отчётом
   в этом браузере. */
(function(){
const WL = window.WL, t = WL.t, esc = WL.esc, fmt = WL.fmt, $ = WL.$;
const S = () => WL.state, M = () => WL.model;
const LVL = {high: t("Важно", "Important"), watch: t("Внимание", "Watch"), info: t("К сведению", "Note")};
const SPARK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z" fill="currentColor"/></svg>';
const C = WL.chat = {open: false, topic: null, credits: null, pending: new Set(), errors: {}, draft: ""};
const hash = s => { let h = 0; for(const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

/* Номер темы: свой вывод — по его коду, вывод ИИ и вопрос — по тексту (после нового анализа старые разговоры остаются). */
WL.topicId = a => a.question ? "q:" + hash(a.question) : a.auto === false ? "ai:" + hash(a.title) : "alert:" + a.id;

/* Номер отчёта для учёта сообщений; у примера — свой на этот браузер. */
function rid(){
  const s = S();
  if(s.rid && !s.demo) return s.rid;
  let r = WL.store.get("wl_demo_chat_rid");
  if(!r){ r = WL.uid(); WL.store.set("wl_demo_chat_rid", r); }
  return r;
}
const auth = () => S().demo ? {} : WL.pay.auth();

/* Учёт сообщений хранится вместе с отчётом: счётчик с подписью сервера (изменить его нельзя) и номера оплаченных пакетов
   (сервер сверяет каждый со Stripe). У примера счётчик свой на этот браузер. */
const TALLY_DEMO = "wl_demo_chat_tally";
function tally(){
  if(!S().demo) return S().chatTally || null;
  const t = WL.store.get(TALLY_DEMO); return t && t.rid === rid() ? t : null;
}
function keepTally(c){
  const t = c && c.tally; if(!t || !t.sig) return;
  if(S().demo) WL.store.set(TALLY_DEMO, {rid: rid(), used: t.used, opens: t.opens, sig: t.sig});
  else { S().chatTally = {used: t.used, opens: t.opens, sig: t.sig}; WL.save(); }
}
const packs = () => S().demo ? [] : (S().chatPacks || []);
function ledgerQuery(extra){
  const a = auth(), t = tally(), q = Object.assign({rid: rid()}, extra || {});
  if(a.token){ q.token = a.token; q.sid = a.sid || ""; }
  if(t) q.tally = `${t.used}.${t.opens}.${t.sig}`;
  if(packs().length) q.packs = packs().join(",");
  return new URLSearchParams(q).toString();
}
const chats = () => (S().chats = S().chats || {});
const talked = id => !!(chats()[id] && chats()[id].messages && chats()[id].messages.length);

/* Темы: портфель, рынок, выводы (в закрытом отчёте — только открытый), вопросы. */
function topics(){
  const m = M(), r = S().review || {};
  if(!m) return [];
  const out = [{id: "portfolio", kind: "portfolio", title: t("Портфель целиком", "The whole portfolio"), text: r.summary || "", level: ""}];
  if(m.mkt) out.push({id: "market", kind: "market", title: t("Портфель и рынок сейчас", "The portfolio and the market now"), level: "",
    text: t("Как изменилась стоимость с даты выписок, как портфель идёт против рынка, что происходит на рынке.", "How the value changed since the statements, how the portfolio compares with the market, what is happening in markets.")});
  const list = WL.alertList ? WL.alertList() : [];
  (WL.pay.locked() ? list.slice(0, 1) : list).forEach(a => out.push({id: WL.topicId(a), kind: "alert", title: a.title, text: a.text, level: a.level, refs: a.refs || []}));
  (r.questions || []).forEach(q => out.push({id: WL.topicId({question: q.text}), kind: "question", title: q.text, text: "", level: "", refs: q.refs || []}));
  return out;
}
function topicById(id){
  if(!id) return null;
  if(id.startsWith("pos:")){
    const p = M() && M().positions.find(x => x.id === id.slice(4)); if(!p) return chats()[id] || null;
    return {id, kind: "position", title: p.name || p.isin || "", level: "", refs: [p.id],
      text: [p.inst, WL.CLS && WL.CLS[p.cls], p.value != null ? fmt.money(p.value, p.ccy || "", 0) : "", p.date ? fmt.date(p.date) : ""].filter(Boolean).join(" · ")};
  }
  return topics().find(x => x.id === id) || chats()[id] || null;
}

/* Ответ: абзацы, списки, жирный — только после экранирования. */
function rich(text){
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\n/);
  let html = "", list = null;
  for(const raw of lines){
    const l = raw.trim(), m = l.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if(m){ const kind = /^\d/.test(l) ? "ol" : "ul"; if(list !== kind){ if(list) html += `</${list}>`; list = kind; html += `<${list}>`; } html += `<li>${m[1]}</li>`; continue; }
    if(list){ html += `</${list}>`; list = null; }
    if(l) html += `<p>${l}</p>`;
  }
  if(list) html += `</${list}>`;
  return html;
}

function creditsPill(){
  const c = C.credits; if(!c) return "";
  const n = c.left, free = !(c.paid || c.bought || c.test);
  const txt = free ? t(`${n} ${WL.pl(n, ["бесплатное сообщение", "бесплатных сообщения", "бесплатных сообщений"], ["", ""])}`, `${n} free ${n === 1 ? "message" : "messages"}`)
    : t(`${n} ${WL.pl(n, ["сообщение", "сообщения", "сообщений"], ["", ""])}`, `${n} ${n === 1 ? "message" : "messages"} left`);
  return `<span class="credits${n <= 0 ? " out" : n <= 2 ? " low" : ""}" title="${t("Сообщения считаются на этот отчёт. Вступление ассистента по теме — бесплатно.", "Messages are counted per report. The assistant's opening on a topic is free.")}">${esc(txt)}</span>`;
}

function topicButton(x){
  const n = talked(x.id) ? chats()[x.id].messages.filter(m => m.role === "user").length : 0;
  return `<button type="button" class="topic" data-topic="${esc(x.id)}">${x.level ? `<span class="lvl lv-${esc(x.level)}">${LVL[x.level]}</span>` : `<span class="tico">${SPARK}</span>`}
    <span class="tt">${esc(x.title)}</span>${talked(x.id) ? `<span class="tn" title="${t("уже обсуждали", "discussed")}">${n ? n : "✓"}</span>` : `<span class="ta">→</span>`}</button>`;
}
function hub(){
  const list = topics(), mine = Object.values(chats()).filter(x => x.messages && x.messages.length).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const fresh = list.filter(x => !talked(x.id)), important = fresh.filter(x => x.level === "high" || x.level === "watch").length;
  return `<div class="msg a"><div class="av">${SPARK}</div><div class="bubble"><p>${important
      ? t(`Я разобрал ваши выписки. ${important} ${WL.pl(important, ["момент стоит", "момента стоит", "моментов стоит"], ["", ""])} обсудить — выберите тему, и я начну с того, что это значит для портфеля и какие есть варианты.`,
        `I have gone through your statements. ${important} ${important === 1 ? "point is" : "points are"} worth discussing — pick a topic and I will start with what it means for the portfolio and what the options are.`)
      : t("Я разобрал ваши выписки. Выберите тему — начну с того, что это значит для портфеля и какие есть варианты. Или задайте свой вопрос внизу.",
        "I have gone through your statements. Pick a topic — I will start with what it means for the portfolio and what the options are. Or ask your own question below.")}</p></div></div>
    ${mine.length ? `<div class="hub-h">${t("Ваши обсуждения", "Your discussions")}</div><div class="topics">${mine.map(x => topicButton(topicById(x.id) || x)).join("")}</div>` : ""}
    ${fresh.length ? `<div class="hub-h">${t("О чём стоит поговорить", "Worth discussing")}</div><div class="topics">${fresh.map(topicButton).join("")}</div>` : ""}
    <p class="hub-note">${t("Ассистент видит все позиции, выводы и котировки этого отчёта. Он объясняет варианты, но не советует купить или продать конкретную бумагу.",
      "The assistant sees every position, finding and quote in this report. It explains the options but does not tell you to buy or sell a specific security.")}</p>`;
}

function convo(){
  const tp = C.topic, ch = chats()[tp.id] || {messages: []}, busy = C.pending.has(tp.id), err = C.errors[tp.id];
  const msgs = ch.messages.map(m => m.role === "user" ? `<div class="msg u"><div class="bubble">${esc(m.text)}</div></div>`
    : `<div class="msg a"><div class="av">${SPARK}</div><div class="bubble">${rich(m.text)}</div></div>`).join("");
  const canTalk = C.credits && C.credits.left > 0;
  const sug = !busy && ch.suggestions && ch.suggestions.length && canTalk
    ? `<div class="sugs">${ch.suggestions.map(s => `<button type="button" class="sug" data-say="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : "";
  return `<div class="ctx">${tp.level ? `<span class="lvl lv-${esc(tp.level)}">${LVL[tp.level]}</span>` : `<span class="tico">${SPARK}</span>`}<div><b>${esc(tp.title)}</b>${tp.text ? `<p>${esc(tp.text.length > 280 ? tp.text.slice(0, 277) + "…" : tp.text)}</p>` : ""}</div></div>
    ${msgs}
    ${busy ? `<div class="msg a"><div class="av">${SPARK}</div><div class="bubble typing" aria-label="${t("Ассистент пишет", "The assistant is typing")}"><i></i><i></i><i></i></div></div>` : ""}
    ${err ? `<div class="chat-err">${esc(err.text)}${err.retry ? ` <button class="link" type="button" data-chat-retry>${t("Повторить", "Try again")}</button>` : ""}</div>` : ""}
    ${sug}${noCredits()}`;
}

function noCredits(){
  const c = C.credits;
  if(!c || c.left > 0) return "";
  if(S().demo) return `<div class="nocred"><b>${t("В примере бесплатные сообщения закончились", "The free messages in the sample are used up")}</b>
    <p>${t("Загрузите свои выписки — по вашему портфелю ассистент разберёт каждую тему так же.", "Upload your statements — the assistant will go through every topic of your own portfolio the same way.")}</p>
    <div class="nb-a"><button type="button" class="btn primary small" data-new>${t("Загрузить свои выписки", "Upload your statements")}</button></div></div>`;
  const lockedReport = WL.pay.PAYWALL && WL.pay.locked() && !S().demo;
  const packs = (c.packs || []).map(p => `<button type="button" class="btn small" data-pack="${esc(p.id)}">${t(`${p.messages} сообщений`, `${p.messages} messages`)}${p.label ? " · " + esc(p.label) : ""}</button>`).join("");
  return `<div class="nocred"><b>${c.paid || c.bought ? t("Сообщения закончились", "You are out of messages") : t("Бесплатные сообщения закончились", "The free messages are used up")}</b>
    <p>${lockedReport ? t(`В полный отчёт входит ${c.included_if_paid} сообщений ассистенту — а ещё все позиции, выводы, PDF и Excel.`, `The full report includes ${c.included_if_paid} messages to the assistant, plus every position, all findings, PDF and Excel.`)
      : packs ? t("Докупите сообщения — они добавятся к этому отчёту и не сгорают.", "Buy more messages — they are added to this report and don't expire.")
      : t("Скоро здесь можно будет докупить сообщения. Если нужно больше прямо сейчас — напишите нам.", "You will soon be able to buy more messages here. If you need more right now, write to us.")}</p>
    ${lockedReport || packs ? `<div class="nb-a">${lockedReport ? `<button type="button" class="btn primary small" data-buy="chat">${t(`Открыть полный отчёт · ${WL.pay.PRICE.label}`, `Unlock the full report · ${WL.pay.PRICE.label}`)}</button>` : ""}${lockedReport ? "" : packs}</div>` : ""}</div>`;
}

function renderPanel(){
  let el = $("#chat");
  if(!el){
    el = document.createElement("aside"); el.id = "chat"; el.className = "chat"; el.setAttribute("aria-label", t("Обсуждение портфеля", "Portfolio discussion"));
    document.body.appendChild(el);
  }
  const prev = $("#chatForm textarea");                  // черновик хранится в C.draft (обновляется при вводе), здесь только фокус
  const focused = prev && document.activeElement === prev;
  el.classList.toggle("open", C.open);
  el.setAttribute("aria-hidden", C.open ? "false" : "true");
  document.body.classList.toggle("chat-open", C.open);
  if(!C.open){ el.innerHTML = ""; return; }
  const tp = C.topic, noCred = C.credits && C.credits.left <= 0;
  el.innerHTML = `<div class="chat-h">${tp ? `<button type="button" class="ib" data-chat-home title="${t("Все темы", "All topics")}" aria-label="${t("Все темы", "All topics")}">‹</button>` : `<span class="orb">${SPARK}</span>`}
      <div class="chat-t"><div class="eyebrow">${tp ? t("Обсуждение", "Discussion") : t("Ассистент по портфелю", "Portfolio assistant")}</div><b>${esc(tp ? tp.title : S().client || t("Ваш портфель", "Your portfolio"))}</b></div>
      ${creditsPill()}<button type="button" class="ib" data-chat-close aria-label="${t("Закрыть", "Close")}">×</button></div>
    <div class="chat-b" id="chatBody" aria-live="polite">${tp ? convo() : hub()}</div>
    <form class="chat-f" id="chatForm" autocomplete="off"><textarea name="q" rows="1" maxlength="1500" aria-label="${t("Сообщение", "Message")}" placeholder="${noCred ? t("Сообщения закончились", "No messages left")
      : tp ? t("Спросите, что делать…", "Ask what to do…") : t("Ваш вопрос о портфеле…", "Your question about the portfolio…")}"${noCred ? " disabled" : ""}></textarea>
      <button type="submit" class="btn primary send" ${noCred || (tp && C.pending.has(tp.id)) ? "disabled" : ""} aria-label="${t("Отправить", "Send")}">↑</button></form>`;
  const ta = $("#chatForm textarea");
  if(ta && C.draft){ ta.value = C.draft; grow(ta); }
  if(ta && focused) ta.focus();
  const b = $("#chatBody"); if(b) b.scrollTop = tp ? b.scrollHeight : 0;
}
WL.renderChat = renderPanel;
const grow = ta => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; };

/* Кнопка «Обсудить портфель» и ненавязчивая подсказка, когда есть что обсудить. */
function launcher(){
  let b = $("#chatFab");
  const ready = !!(M() && M().positions.length) && !WL.printing && !WL.reading;
  if(!b){ b = document.createElement("button"); b.id = "chatFab"; b.type = "button"; b.className = "chat-fab no-print"; b.dataset.chatOpen = ""; document.body.appendChild(b); }
  b.hidden = !ready || C.open;
  const fresh = ready ? topics().filter(x => x.kind === "alert" && (x.level === "high" || x.level === "watch") && !talked(x.id)) : [];
  b.innerHTML = `${SPARK}<span>${t("Обсудить портфель", "Discuss the portfolio")}</span>${fresh.length ? `<em>${fresh.length}</em>` : ""}`;
  b.setAttribute("aria-label", t("Обсудить портфель с ассистентом", "Discuss the portfolio with the assistant") + (fresh.length ? t(`: ${fresh.length} ${WL.pl(fresh.length, ["тема", "темы", "тем"], ["", ""])}`, `: ${fresh.length} ${fresh.length === 1 ? "topic" : "topics"}`) : ""));
  let n = $("#chatNudge");
  const show = ready && !C.open && fresh.length && !S().chatNudged && S().review && S().review.summary && !document.body.classList.contains("has-modal");
  if(!show){ if(n) n.remove(); return; }
  if(!n){ n = document.createElement("div"); n.id = "chatNudge"; n.className = "chat-nudge no-print"; n.setAttribute("role", "status"); document.body.appendChild(n);
    clearTimeout(C.nudgeTimer); C.nudgeTimer = setTimeout(dismissNudge, 20000); }
  n.innerHTML = `<button type="button" class="nx" data-nudge-close aria-label="${t("Скрыть", "Dismiss")}">×</button>
    <button type="button" class="nb" data-topic="${esc(fresh[0].id)}"><span class="eyebrow gold">${SPARK}${t("Ассистент", "Assistant")}</span>
      <b>${esc(fresh.length === 1 ? t("Есть момент, который стоит обсудить", "There is one point worth discussing") : t(`${fresh.length} ${WL.pl(fresh.length, ["момент", "момента", "моментов"], ["", ""])} в портфеле стоит обсудить`, `${fresh.length} points in the portfolio are worth discussing`))}</b>
      <span>${esc(fresh[0].title)}</span></button>`;
}
WL.renderChatLauncher = launcher;
const dismissNudge = () => { S().chatNudged = true; WL.save(); const n = $("#chatNudge"); if(n) n.remove(); };

async function loadCredits(){
  const r = await WL.api("/chat/credits?" + ledgerQuery(), undefined, {timeout: 20000});
  if(r && r.left != null){ C.credits = Object.assign(r, {rid: rid()}); keepTally(r); }
  if(C.open) renderPanel();
}

/* Отчёт для ассистента: данные портфеля и то, что пользователь уже видит в выводах. */
/* Отчёт для ассистента: данные портфеля и то, что пользователь уже видит в выводах. Позиций — не больше 150 крупнейших
   (остальные — одной суммой) плюс позиции темы разговора: так ответ по большому портфелю стоит как по среднему. */
const CHAT_POSITIONS = 150;
function reportFor(refs){
  const rep = WL.compact(M(), S(), {keep: refs}), r = S().review || {};
  const all = WL.alertList ? WL.alertList() : [], vis = WL.pay.locked() ? all.slice(0, 1) : all;
  rep.findings_shown_to_user = {summary: r.summary || undefined, alerts: vis.map(a => ({level: a.level, title: a.title, text: a.text, source: a.auto ? "checks" : "ai_analysis"})),
    more_in_full_report: all.length - vis.length || undefined, questions_to_check: (r.questions || []).map(q => q.text)};
  if(rep.positions.length > CHAT_POSITIONS){
    const want = new Set(refs || []);
    const keep = rep.positions.filter((p, i) => i < CHAT_POSITIONS || want.has(p.id)), cut = rep.positions.filter(p => !keep.includes(p));
    const prev = rep.positions_not_listed || {count: 0, value: 0};
    rep.positions = keep;
    rep.positions_not_listed = {count: prev.count + cut.length, value: Math.round((prev.value + cut.reduce((s, p) => s + (p.value_report_ccy || 0), 0)) * 100) / 100,
      note: "smallest positions, summed; ask the user to open the position card for details"};
    if(rep.market && rep.market.positions){ const ids = new Set(keep.map(p => p.id)); rep.market.positions = rep.market.positions.filter(p => ids.has(p.id)); }
  }
  return rep;
}
WL.chatReport = reportFor;

async function turn(topic, text){
  const id = topic.id;
  const ch = chats()[id] = chats()[id] || {id, kind: topic.kind, title: topic.title, text: topic.text, level: topic.level, refs: topic.refs, messages: [], suggestions: []};
  if(C.pending.has(id)) return;
  if(text){ ch.messages.push({role: "user", text, at: Date.now()}); ch.suggestions = []; }
  ch.updated = Date.now();
  C.pending.add(id); delete C.errors[id];
  dismissNudge(); WL.save(); renderPanel(); launcher();
  const body = Object.assign({lang: WL.lang, rid: rid(), topic: {kind: topic.kind, title: topic.title, text: topic.text, level: topic.level, positions: topic.refs || []},
    messages: ch.messages.map(m => ({role: m.role, text: m.text})), report: reportFor(topic.refs), preview: !S().demo && WL.pay.locked(),
    tally: tally() || undefined, packs: packs()}, auth());
  const r = await WL.api("/chat", body, {timeout: 285000});
  C.pending.delete(id);
  if(r && r.credits){ C.credits = Object.assign(r.credits, {rid: rid()}); keepTally(r.credits); }
  if(r && r.reply){ ch.messages.push({role: "assistant", text: r.reply, at: Date.now()}); ch.suggestions = r.suggestions || []; ch.updated = Date.now(); }
  else if(r && r.error === "no_credits"){ if(text){ ch.messages.pop(); C.draft = text; } }
  else if(r && r.error === "no_opens"){ C.errors[id] = {text: t("Ассистент уже открыл много тем в этом отчёте — задайте вопрос сами, внизу.", "The assistant has already opened many topics in this report — ask your question below.")}; }
  else if(r && r.error === "quota"){ if(text){ ch.messages.pop(); C.draft = text; } C.errors[id] = {text: t("Слишком много вопросов за час — попробуйте чуть позже.", "Too many questions this hour — try again a little later.")}; }
  else {
    if(text){ ch.messages.pop(); C.draft = text; }       // вопрос возвращается в поле ввода — набирать заново не нужно
    const why = {busy: t("Сервис сейчас перегружен — повторите через минуту.", "The service is busy right now — try again in a minute."),
      timeout: t("Ответ готовился слишком долго.", "The answer took too long."), network: t("Нет связи с сервером — проверьте интернет.", "No connection to the server — check the internet."),
      too_large: t("Ответ получился слишком длинным — сузьте вопрос.", "The answer came out too long — narrow the question.")}[r && r.error];
    C.errors[id] = {text: why || t("Ответ не пришёл.", "No answer came back."), retry: () => { C.draft = ""; turn(topic, text); }};
  }
  if(!ch.messages.length) delete chats()[id];
  WL.save(); renderPanel(); launcher();
}

WL.openChat = async (id, question) => {
  WL.closeDrawer && WL.closeDrawer();
  dismissNudge();
  C.open = true;
  C.topic = id ? topicById(id) : null;
  if(question && C.topic) C.draft = "";
  renderPanel(); launcher();
  const creditsReady = loadCredits();
  if(!C.credits || C.credits.rid !== rid()) await creditsReady;
  if(!C.topic) return;
  if(question){
    if(C.credits && C.credits.left <= 0){ C.draft = question; return renderPanel(); }
    return turn(C.topic, question);
  }
  if(!talked(C.topic.id)) return turn(C.topic, "");
};
WL.closeChat = () => { C.open = false; C.topic = null; renderPanel(); launcher(); };

/* Пакет сообщений: то же согласие на немедленное предоставление, что и у отчёта. */
async function buyPack(id){
  const c = C.credits, p = c && (c.packs || []).find(x => x.id === id); if(!p) return;
  const {choice} = await WL.dialog({eyebrow: t("Сообщения ассистенту", "Assistant messages"), title: t(`${p.messages} сообщений${p.label ? " за " + p.label : ""}`, `${p.messages} messages${p.label ? " for " + p.label : ""}`),
    body: `<p>${t("Сообщения добавятся к этому отчёту и не сгорают. Разовая оплата через Stripe.", "The messages are added to this report and don't expire. A one-off payment via Stripe.")}</p>
      <label class="check"><input type="checkbox" data-waiver> <span>${t("Прошу предоставить сообщения сразу после оплаты и понимаю, что после этого право отказаться от покупки в течение 14 дней не действует.",
        "I ask for the messages to be provided right after payment and understand that I then lose the 14-day right of withdrawal.")}</span></label>`,
    buttons: [{id: "pay", label: t("Перейти к оплате", "Continue to payment"), primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}], gate: "[data-waiver]"});
  if(choice !== "pay") return;
  WL.save();
  const r = await WL.api("/chat/checkout", {rid: rid(), pack: id, lang: WL.lang, path: location.pathname, waiver: true});
  if(r && r.url){ WL.store.set("wl_chat_pending", {rid: rid(), sid: r.id, at: Date.now()}); WL.leaving = true; location.href = r.url; return; }
  WL.toast(r && r.error === "packs_not_configured" ? t("Пакеты сообщений скоро появятся.", "Message packs are coming soon.") : t("Не удалось открыть оплату. Попробуйте ещё раз.", "Could not open checkout. Please try again."));
}
/* Возврат с оплаты пакета. */
WL.chatReturn = async () => {
  const u = new URL(location.href), sid = u.searchParams.get("chat_paid"), canceled = u.searchParams.has("chat_canceled");
  if(!sid && !canceled) return;
  u.searchParams.delete("chat_paid"); u.searchParams.delete("chat_canceled"); history.replaceState(null, "", u.pathname + u.search + u.hash);
  if(canceled){ WL.store.del("wl_chat_pending"); return WL.toast(t("Оплата не завершена — сообщения не добавлены.", "Payment was not completed — no messages were added.")); }
  const pend = WL.store.get("wl_chat_pending"), r0 = pend && pend.sid === sid ? pend.rid : rid();
  const r = await WL.api("/chat/verify?" + ledgerQuery({session_id: sid, rid: r0}), undefined, {timeout: 30000});
  if(r && r.ok){
    if(!S().demo && r0 === S().rid){ S().chatPacks = [...new Set([...(S().chatPacks || []), sid])]; keepTally(r.credits); WL.save(); }
    C.credits = Object.assign(r.credits, {rid: r0}); WL.store.del("wl_chat_pending");
    WL.toast(t(`Добавлено ${r.messages} сообщений`, `${r.messages} messages added`)); WL.openChat(null);
  }
  else WL.toast(t("Оплату сообщений не удалось подтвердить. Обновите страницу через минуту или напишите нам.", "Could not confirm the message payment. Refresh in a minute or write to us."));
};

document.addEventListener("click", e => {
  const el = e.target.closest("button, [data-topic]"); if(!el) return;
  const d = el.dataset;
  if(d.chatOpen !== undefined){ e.preventDefault(); return WL.openChat(null); }
  if(d.chatClose !== undefined) return WL.closeChat();
  if(d.chatHome !== undefined){ C.topic = null; return renderPanel(); }
  if(d.chatRetry !== undefined){ const er = C.topic && C.errors[C.topic.id]; if(er && er.retry){ delete C.errors[C.topic.id]; er.retry(); } return; }
  if(d.nudgeClose !== undefined) return dismissNudge();
  if(d.say && C.topic && !C.pending.has(C.topic.id)) return turn(C.topic, d.say);
  if(d.ask){ e.preventDefault(); return WL.openChat("portfolio", d.ask); }
  if(d.pack) return buyPack(d.pack);
  if(d.topic){ e.preventDefault(); e.stopPropagation(); return WL.openChat(d.topic); }
}, true);
document.addEventListener("submit", e => {
  if(e.target.id === "ask"){
    e.preventDefault();
    const q = (e.target.q.value || "").trim(); if(!q) return;
    e.target.q.value = ""; return WL.openChat("portfolio", q);
  }
  if(e.target.id !== "chatForm") return;
  e.preventDefault();
  const q = (e.target.q.value || "").trim(); if(!q) return;
  const tp = C.topic || topicById("portfolio"); if(!tp || C.pending.has(tp.id)) return;
  if(C.credits && C.credits.left <= 0) return renderPanel();
  e.target.q.value = ""; C.draft = ""; C.topic = tp;
  turn(tp, q);
});
document.addEventListener("keydown", e => {
  if(e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target.closest && e.target.closest("#chatForm")){ e.preventDefault(); e.target.form.requestSubmit(); }
  if(e.key === "Escape" && C.open && !document.querySelector(".modal-wrap") && !($("#drawer") && $("#drawer").classList.contains("open"))) WL.closeChat();
});
document.addEventListener("input", e => { if(e.target.closest && e.target.closest("#chatForm")){ C.draft = e.target.value; grow(e.target); } });
})();
