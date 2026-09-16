/* Флоу велса · аналитика воронки для холодного трафика.
   Пиксель Meta грузится без автоматической настройки событий и расширенного сопоставления:
   на странице разбираются выписки клиента, и пиксель не должен сам собирать поля и надписи.
   Уходят только явные события воронки. UTM-метки первого касания запоминаются и передаются в оплату.
   Cookies: в ЕЭЗ, Великобритании и Швейцарии пиксель ждёт согласия, в остальных странах включается
   сразу, а внизу один раз появляется короткое уведомление с отказом (см. ниже). */
(function(){
const WL = window.WL = window.WL || {};
const PIXEL = String(window.WL_PIXEL_ID || "");
const CONSENT = "wl_consent_v1", SEEN = "wl_consent_seen", ATTR = "wl_attr_v1";
const get = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const set = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
const en = () => (document.documentElement.lang || "ru").startsWith("en");

/* Регион — по часовому поясу устройства: без сетевого запроса и без IP. Там, где рекламным cookies
   нужно явное согласие (ЕЭЗ с заморскими территориями, Великобритания, Швейцария), и там, где пояс
   неизвестен, пиксель ждёт «Разрешить». */
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

const STANDARD = new Set(["PageView", "ViewContent", "Lead", "InitiateCheckout", "Purchase", "CompleteRegistration"]);
WL.track = function(name, params){
  const p = Object.assign({}, params || {});
  try{ if(allowed() && window.fbq) STANDARD.has(name) ? window.fbq("track", name, p) : window.fbq("trackCustom", name, p); }catch(e){}
  try{ if(window.va) window.va("event", {name, data: p}); }catch(e){}
};

// Первое касание: метки кампании и аудитория лендинга.
(function(){
  const q = new URLSearchParams(location.search), keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "audience"];
  const found = {}; keys.forEach(k => { const v = q.get(k); if(v) found[k] = v.slice(0, 120); });
  if(window.WL_AUDIENCE && !found.audience) found.audience = window.WL_AUDIENCE;
  if(Object.keys(found).length && !get(ATTR)) set(ATTR, JSON.stringify(Object.assign({first_seen: new Date().toISOString().slice(0, 10)}, found)));
})();
WL.attribution = () => { try{ return JSON.parse(get(ATTR) || "{}"); }catch(e){ return {}; } };

// Уведомление о cookies — маленькая карточка в углу, не перекрывает страницу и не требует ответа.
// Без согласия по умолчанию (ЕЭЗ и соседи) показывается, пока не выбрали; в остальных странах — один раз.
// «Настройки cookies» в подвале открывают его снова.
function notice(force){
  if(!PIXEL || document.querySelector(".consent")) return;
  if(!force && (get(CONSENT) || (!STRICT && get(SEEN)))) return;
  if(!STRICT && !force) set(SEEN, "1");
  const EN = en(), ask = STRICT || force;
  const b = document.createElement("div");
  b.className = "consent";
  b.setAttribute("role", "region"); b.setAttribute("aria-label", "Cookies");
  const text = ask
    ? (EN ? "May we use cookies to measure our ads? Cookies have nothing to do with your statements." : "Разрешите cookies для оценки рекламы? К выпискам cookies отношения не имеют.")
    : (EN ? "We use cookies to measure our ads. Cookies have nothing to do with your statements." : "Мы используем cookies для оценки рекламы. К выпискам cookies отношения не имеют.");
  const [yes, no] = ask ? (EN ? ["Allow", "No, thanks"] : ["Разрешить", "Не нужно"]) : (EN ? ["OK", "Opt out"] : ["Хорошо", "Отказаться"]);
  b.innerHTML = `<p>${text} <a href="${EN ? "/en/legal/privacy/" : "/legal/privacy/"}">${EN ? "Details" : "Подробнее"}</a></p>
    <div><button type="button" data-c="necessary">${no}</button><button type="button" data-c="all" class="primary">${yes}</button></div>`;
  b.onclick = e => {
    const x = e.target.closest("[data-c]"); if(!x) return;
    set(CONSENT, x.dataset.c);
    if(x.dataset.c === "all") loadPixel(); else if(window.fbq){ try{ window.fbq("consent", "revoke"); }catch(err){} }
    b.classList.remove("in"); setTimeout(() => b.remove(), 260);
  };
  document.body.appendChild(b);
  setTimeout(() => b.classList.add("in"), force ? 0 : 900);
}
function init(){
  if(PIXEL && allowed()) loadPixel();
  notice(false);
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
WL.cookieSettings = () => notice(true);
WL.resetConsent = WL.cookieSettings;
document.addEventListener("click", e => { const a = e.target.closest("[data-cookies]"); if(!a) return; e.preventDefault(); WL.cookieSettings(); });
})();
