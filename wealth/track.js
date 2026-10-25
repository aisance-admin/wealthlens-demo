/* Флоу велса · аналитика воронки для холодного трафика. Два получателя, оба — только явные события, без автоматического
   сбора полей и надписей: на странице разбираются выписки клиента.
   · Mixpanel (проект WealthLens, данные в ЕС) — путь по сайту и приложению: какие шаги проходят и где уходят. Уходят имя шага
     и счётчики (файлов, страниц, бумаг), язык, метки кампании. Не уходят суммы, названия бумаг и банков, ISIN, имена файлов,
     адрес страницы с параметрами; записи экрана нет. Библиотека — со своего адреса (wealth/vendor/mixpanel).
   · пиксель Meta — только стандартные события для оценки рекламы.
   UTM-метки первого касания запоминаются и передаются в оплату.
   Cookies: в ЕЭЗ, Великобритании и Швейцарии аналитика и пиксель ждут согласия (события до ответа — только в памяти страницы,
   при отказе выбрасываются), в остальных странах включаются сразу, а внизу один раз появляется короткое уведомление с отказом.
   На локальном стенде аналитика выключена; для проверок — ?mp=<ключ>&mp_host=http://127.0.0.1:<порт>. */
(function(){
const WL = window.WL = window.WL || {};
/* Настройки: у приложения — из wealth/config.js, у лендингов — атрибутами тега этого скрипта (встроенные скрипты
   политика безопасности страницы не разрешает). */
const TAG = document.currentScript, D = (TAG && TAG.dataset) || {};
if(!window.WL_AUDIENCE && D.audience) window.WL_AUDIENCE = D.audience;
const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname), Q = new URLSearchParams(location.search);
const PIXEL = String(window.WL_PIXEL_ID || D.pixel || "");
/* Google Ads: номер тега и метки конверсий (покупка, начало оплаты, предпросмотр) — из wealth/config.js или атрибута лендинга. */
let GADS = window.WL_GADS || null;
if(!GADS && D.gads){ try{ GADS = JSON.parse(D.gads); }catch(e){} }
if(!GADS || !/^AW-\d{6,}$/.test(String(GADS.id || ""))) GADS = null;
/* Стенд: ?mp=…&mp_host=… запоминаются на вкладку — после возврата со страницы оплаты их в адресе уже нет. */
const tab = (k, v) => { try{ if(v) sessionStorage.setItem("wl_" + k, v); return v || sessionStorage.getItem("wl_" + k) || ""; }catch(e){ return v || ""; } };
const MP = LOCAL ? String(tab("mp", Q.get("mp"))) : String(window.WL_MP_TOKEN || D.mp || "");
const MP_HOST_Q = LOCAL ? tab("mp_host", Q.get("mp_host")) : "";
const MP_HOST = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(MP_HOST_Q) ? MP_HOST_Q : "https://api-eu.mixpanel.com";
const ENV = LOCAL ? "local" : String(window.WL_ENV || D.env || "production");
const PAGE = D.page || "app";
const CONSENT = "wl_consent_v1", SEEN = "wl_consent_seen", ATTR = "wl_attr_v1", ATTR_LAST = "wl_attr_last_v1", CLICK = "wl_click_v1";
const get = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const set = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
const en = () => (document.documentElement.lang || "ru").startsWith("en");

/* Регион — по часовому поясу устройства: без сетевого запроса и без IP. Там, где cookies аналитики и рекламы нужно
   явное согласие (ЕЭЗ с заморскими территориями, Великобритания, Швейцария), и там, где пояс неизвестен, ждём «Разрешить». */
const STRICT = (() => {
  let tz = "";
  try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; }catch(e){}
  if(!tz) return true;
  if(/^Europe\//.test(tz)) return !/^Europe\/(Moscow|Minsk|Kirov|Volgograd|Samara|Ulyanovsk|Saratov|Astrakhan|Kaliningrad|Istanbul|Simferopol)$/.test(tz);
  return /^(Asia\/(Nicosia|Famagusta)|Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe)|Arctic\/Longyearbyen|Africa\/Ceuta|America\/(Guadeloupe|Martinique|Cayenne|St_Barthelemy|Marigot)|Indian\/(Reunion|Mayotte)|CET|MET|EET|WET|GB|GB-Eire|Eire|Iceland|Poland|Portugal)$/.test(tz);
})();
const allowed = () => { const c = get(CONSENT); return c === "all" || (!c && !STRICT); };

function loadPixel(){
  if(!PIXEL) return;
  if(window.fbq){ try{ window.fbq("consent", "grant"); }catch(e){} return; }
  /* стандартный загрузчик Meta */
  !function(f, b, e, v, n, t, s){ if(f.fbq) return; n = f.fbq = function(){ n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if(!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  window.fbq("set", "autoConfig", false, PIXEL);   // не собирать кнопки и поля страницы автоматически
  window.fbq("init", PIXEL);
  window.fbq("track", "PageView");
}

/* Тег Google Ads — только измерение рекламы: персонализация (ремаркетинг) и расширенные конверсии выключены, просмотры страниц
   в Google не уходят. Клик по рекламе (gclid), если cookies разрешили уже в приложении, передаётся запомненным. */
let gtOn = false;
function loadGtag(){
  if(!GADS) return;
  if(gtOn){ try{ window.gtag("consent", "update", {ad_storage: "granted", ad_user_data: "granted"}); }catch(e){} return; }
  gtOn = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
  window.gtag("consent", "default", {ad_storage: "granted", ad_user_data: "granted", ad_personalization: "denied", analytics_storage: "denied"});
  window.gtag("js", new Date());
  const cfg = {allow_enhanced_conversions: false, send_page_view: false};
  let c = {}; try{ c = JSON.parse(get(CLICK) || "{}"); }catch(e){}
  if(c.gclid && Date.now() - (c.gat || 0) < 90 * 864e5 && !Q.get("gclid")) cfg.page_location = location.origin + location.pathname + "?gclid=" + encodeURIComponent(c.gclid);
  window.gtag("config", GADS.id, cfg);
  const t = document.createElement("script"); t.async = true; t.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GADS.id);
  document.head.appendChild(t);
}

/* Mixpanel: только значения-числа, да/нет и короткие строки-метки; всё прочее отбрасывается. */
const clean = p => {
  const o = {};
  for(const [k, v] of Object.entries(p || {})){
    if(typeof v === "number" && isFinite(v)) o[k] = Math.round(v * 100) / 100;
    else if(typeof v === "boolean") o[k] = v;
    else if(typeof v === "string" && v) o[k] = v.slice(0, 60);
  }
  return o;
};
const superProps = () => {
  const a = WL.attribution ? WL.attribution() : {};
  const l = WL.attributionLast ? WL.attributionLast() : {};
  return clean({page_type: PAGE, lang: en() ? "en" : "ru", env: ENV, audience: a.audience || window.WL_AUDIENCE, first_seen: a.first_seen,
    utm_source: a.utm_source, utm_medium: a.utm_medium, utm_campaign: a.utm_campaign, utm_content: a.utm_content,
    last_utm_source: l.utm_source, last_utm_campaign: l.utm_campaign, last_utm_content: l.utm_content, last_seen_ad: l.seen});
};
let mpOn = false;
const mpQueue = [];
function loadMixpanel(){
  if(!MP || !TAG) return;
  const mp = window.mixpanel;
  if(mpOn){ try{ if(mp) mp.opt_in_tracking({track: false}); }catch(e){} return; }      // снова разрешили на этой же странице
  mpOn = true;
  try{
    window.MIXPANEL_CUSTOM_LIB_URL = new URL("vendor/mixpanel/mixpanel.min.js", TAG.src).href;
    /* официальный загрузчик Mixpanel (mixpanel-jslib-snippet 2.83.0): очередь вызовов, пока библиотека грузится */
    (function(e,c){if(!c.__SV){var l,h;window.mixpanel=c;c._i=[];c.init=function(q,r,f){function t(d,a){var g=a.split(".");2==g.length&&(d=d[g[0]],a=g[1]);d[a]=function(){d.push([a].concat(Array.prototype.slice.call(arguments,0)))}}var b=c;"undefined"!==typeof f?b=c[f]=[]:f="mixpanel";b.people=b.people||[];b.toString=function(d){var a="mixpanel";"mixpanel"!==f&&(a+="."+f);d||(a+=" (stub)");return a};b.people.toString=function(){return b.toString(1)+".people (stub)"};l="disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking start_batch_senders start_session_recording stop_session_recording people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove".split(" ");
    for(h=0;h<l.length;h++)t(b,l[h]);var n="set set_once union unset remove delete".split(" ");b.get_group=function(){function d(p){a[p]=function(){b.push([g,[p].concat(Array.prototype.slice.call(arguments,0))])}}for(var a={},g=["get_group"].concat(Array.prototype.slice.call(arguments,0)),m=0;m<n.length;m++)d(n[m]);return a};c._i.push([q,r,f])};c.__SV=1.2;var k=e.createElement("script");k.type="text/javascript";k.async=!0;k.src="undefined"!==typeof MIXPANEL_CUSTOM_LIB_URL?MIXPANEL_CUSTOM_LIB_URL:"file:"===
    e.location.protocol&&"//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js".match(/^\/\//)?"https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js":"//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";e=e.getElementsByTagName("script")[0];e.parentNode.insertBefore(k,e)}})(document,window.mixpanel||[]);
    window.mixpanel.init(MP, {api_host: MP_HOST, persistence: "localStorage", opt_out_tracking_persistence_type: "localStorage",
      autocapture: false, track_pageview: false, record_sessions_percent: 0, batch_flush_interval_ms: LOCAL ? 500 : 3000,
      property_blacklist: ["$current_url", "$referrer", "$initial_referrer"]});    // адрес с параметрами (номер оплаты) — не уходит
    window.mixpanel.opt_in_tracking({track: false});        // согласие — наше (wl_consent_v1); прежний отказ в Mixpanel снимается без события
    window.mixpanel.register(superProps());
    mpQueue.splice(0).forEach(([n, p]) => window.mixpanel.track(n, p));
  }catch(e){}
}
function stopMixpanel(){
  mpQueue.length = 0;
  try{ if(mpOn && window.mixpanel) window.mixpanel.opt_out_tracking({clear_persistence: true}); }catch(e){}
}

/* Имена шагов в Mixpanel: стандартные события пикселя — понятными словами, остальные — как есть. */
const STANDARD = new Set(["PageView", "ViewContent", "Lead", "InitiateCheckout", "Purchase", "CompleteRegistration"]);
const MP_NAME = {ViewContent: "App Opened", InitiateCheckout: "Checkout Started", Purchase: "Purchase", Lead: "Lead", CompleteRegistration: "Sign Up"};
/* Шаги воронки, которые видит и реклама: кампании учатся на шаге, где событий больше, чем оплат. Предпросмотр — наш
   «пробный период» (StartTrial), окно оплаты — «положил в корзину» (AddToCart), пакет сообщений — тоже покупка. В пиксель
   уходят только имя, сумма, валюта и что куплено. */
const PIXEL_MAP = {"Files Added": ["trackCustom", "UploadStatements"], "Paywall Opened": ["track", "AddToCart"], "Chat Pack Purchased": ["track", "Purchase"]};
const pixelEvent = (name, p) => STANDARD.has(name) ? ["track", name] : PIXEL_MAP[name]
  || ((name === "Preview Ready" || name === "Report Ready") && p.locked === true ? ["track", "StartTrial"] : null);
const pixelParams = (name, p) => { const o = {}; ["value", "currency", "content_name"].forEach(k => { if(p[k] !== undefined && p[k] !== "") o[k] = p[k]; });
  if(name === "Paywall Opened") Object.assign(o, {value: 49, currency: "EUR", content_name: "portfolio_report"});
  if(name === "Preview Ready" || name === "Report Ready") Object.assign(o, {value: 0, currency: "EUR", content_name: "portfolio_report"});
  return o; };
/* Номер события: одна покупка из браузера и с сервера считается один раз (Mixpanel — до 36 букв и цифр, как на сервере). */
const insertId = id => String(id || "").replace(/[^A-Za-z0-9]/g, "").slice(-36);
/* Конверсии Google Ads: те же шаги, у покупки — номер оплаты (Google не посчитает её дважды). */
const GADS_MAP = {Purchase: "purchase", "Chat Pack Purchased": "purchase", InitiateCheckout: "checkout"};
const gadsKey = (name, p) => GADS_MAP[name] || ((name === "Preview Ready" || name === "Report Ready") && p.locked === true ? "preview" : null);
WL.track = function(name, params, opts = {}){
  const p = Object.assign({}, params || {});
  try{ const px = pixelEvent(name, p); if(px && allowed() && window.fbq) window.fbq(px[0], px[1], pixelParams(name, p), opts.id ? {eventID: String(opts.id)} : undefined); }catch(e){}
  try{ const k = gadsKey(name, p), q = pixelParams(name, p);
    if(k && GADS && GADS[k] && gtOn && allowed() && window.gtag) window.gtag("event", "conversion", Object.assign({send_to: GADS.id + "/" + GADS[k]},
      q.value !== undefined ? {value: q.value, currency: q.currency || "EUR"} : {}, opts.id ? {transaction_id: String(opts.id)} : {})); }catch(e){}
  try{ if(window.va) window.va("event", {name, data: p}); }catch(e){}
  if(!MP || get(CONSENT) === "necessary") return;
  const ev = [MP_NAME[name] || name, clean(p)];
  if(opts.id) ev[1].$insert_id = insertId(opts.id);
  try{ if(mpOn && window.mixpanel) window.mixpanel.track(ev[0], ev[1]); else if(mpQueue.length < 50) mpQueue.push([ev[0], Object.assign(ev[1], {time: Date.now() / 1000})]); }catch(e){}   // до согласия — со своим временем
};

// Первое касание: метки кампании и аудитория лендинга; последнее касание — метки свежего захода из рекламы (повторный
// показ, другая кампания). Номер клика по рекламе Meta (fbclid) — чтобы сопоставить оплату с кликом, когда человек
// разрешит cookies уже в приложении, где адреса с fbclid больше нет. В Mixpanel номер клика не уходит.
(function(){
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "audience"];
  const found = {}; keys.forEach(k => { const v = Q.get(k); if(v) found[k] = v.slice(0, 120); });
  const day = new Date().toISOString().slice(0, 10);
  if(Object.keys(found).length) set(ATTR_LAST, JSON.stringify(Object.assign({seen: day}, found)));
  if(window.WL_AUDIENCE && !found.audience) found.audience = window.WL_AUDIENCE;
  if(Object.keys(found).length && !get(ATTR)) set(ATTR, JSON.stringify(Object.assign({first_seen: day}, found)));
  let ck = {}; try{ ck = JSON.parse(get(CLICK) || "{}"); }catch(e){}
  const fbclid = Q.get("fbclid"), gclid = Q.get("gclid");
  if(fbclid && /^[A-Za-z0-9_-]{8,400}$/.test(fbclid)) Object.assign(ck, {fbclid, at: Date.now()});
  if(gclid && /^[A-Za-z0-9_-]{8,400}$/.test(gclid)) Object.assign(ck, {gclid, gat: Date.now()});
  if(fbclid || gclid) set(CLICK, JSON.stringify(ck));
})();
WL.attribution = () => { try{ return JSON.parse(get(ATTR) || "{}"); }catch(e){ return {}; } };
WL.attributionLast = () => { try{ return JSON.parse(get(ATTR_LAST) || "{}"); }catch(e){ return {}; } };
/* Метки для покупки с сервера (см. api/index.py, _conversion): только с согласием на cookies — иначе пусто. */
const cookie = n => { const m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : ""; };
WL.adIds = () => {
  if(!allowed() || get(CONSENT) === "necessary") return null;
  const o = {};
  try{ if(mpOn && window.mixpanel && window.mixpanel.get_distinct_id) o.mp_id = String(window.mixpanel.get_distinct_id() || ""); }catch(e){}
  if(PIXEL){
    o.fbp = cookie("_fbp");
    let c = {}; try{ c = JSON.parse(get(CLICK) || "{}"); }catch(e){}
    o.fbc = cookie("_fbc") || (c.fbclid && Date.now() - c.at < 90 * 864e5 ? `fb.1.${c.at}.${c.fbclid}` : "");
  }
  Object.keys(o).forEach(k => { if(!o[k]) delete o[k]; });
  return Object.keys(o).length ? o : null;
};

// Уведомление о cookies — маленькая карточка в углу, не перекрывает страницу и не требует ответа.
// Без согласия по умолчанию (ЕЭЗ и соседи) показывается, пока не выбрали; в остальных странах — один раз.
// «Настройки cookies» внизу страницы открывают его снова.
function notice(force){
  const ADS = PIXEL || GADS;
  if(!(ADS || MP) || document.querySelector(".consent")) return;
  if(!force && (get(CONSENT) || (!STRICT && get(SEEN)))) return;
  if(!STRICT && !force) set(SEEN, "1");
  const EN = en(), ask = STRICT || force;
  const why = MP && ADS ? (EN ? "for site analytics and to measure our ads" : "для аналитики сайта и оценки рекламы")
    : MP ? (EN ? "for site analytics" : "для аналитики сайта") : (EN ? "to measure our ads" : "для оценки рекламы");
  const b = document.createElement("div");
  b.className = "consent no-print";
  b.setAttribute("role", "region"); b.setAttribute("aria-label", "Cookies");
  const text = ask
    ? (EN ? `May we use cookies ${why}? Cookies have nothing to do with your statements.` : `Разрешите cookies ${why}? К выпискам cookies отношения не имеют.`)
    : (EN ? `We use cookies ${why}. Cookies have nothing to do with your statements.` : `Мы используем cookies ${why}. К выпискам cookies отношения не имеют.`);
  const [yes, no] = ask ? (EN ? ["Allow", "No, thanks"] : ["Разрешить", "Не нужно"]) : (EN ? ["OK", "Opt out"] : ["Хорошо", "Отказаться"]);
  b.innerHTML = `<p>${text} <a href="${EN ? "/en/legal/privacy/" : "/legal/privacy/"}">${EN ? "Details" : "Подробнее"}</a></p>
    <div><button type="button" data-c="necessary">${no}</button><button type="button" data-c="all" class="primary">${yes}</button></div>`;
  b.onclick = e => {
    const x = e.target.closest("[data-c]"); if(!x) return;
    set(CONSENT, x.dataset.c);
    if(x.dataset.c === "all"){ loadPixel(); loadGtag(); loadMixpanel(); }
    else { if(window.fbq){ try{ window.fbq("consent", "revoke"); }catch(err){} }
      if(gtOn && window.gtag){ try{ window.gtag("consent", "update", {ad_storage: "denied", ad_user_data: "denied"}); }catch(err){} }
      stopMixpanel(); }
    b.classList.remove("in"); setTimeout(() => { b.remove(); if(window.WL && WL.renderChatLauncher) WL.renderChatLauncher(); }, 260);
  };
  document.body.appendChild(b);
  setTimeout(() => b.classList.add("in"), force ? 0 : 900);
}
function init(){
  if(allowed()){ if(PIXEL) loadPixel(); if(GADS) loadGtag(); if(MP) loadMixpanel(); }
  WL.track("Page View", {page: PAGE});
  notice(false);
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
WL.cookieSettings = () => notice(true);
WL.resetConsent = WL.cookieSettings;
document.addEventListener("click", e => { const a = e.target.closest("[data-cookies]"); if(!a) return; e.preventDefault(); WL.cookieSettings(); });
})();
