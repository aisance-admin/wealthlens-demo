/* Флоу велса · аналитика воронки для холодного трафика.
   Пиксель Meta грузится только после согласия на cookies и без автоматической настройки
   событий и расширенного сопоставления: на странице разбираются выписки клиента, и
   пиксель не должен сам собирать поля и надписи. Уходят только явные события воронки.
   UTM-метки первого касания запоминаются и передаются в оплату. */
(function(){
const WL = window.WL = window.WL || {};
const PIXEL = String(window.WL_PIXEL_ID || "");
const CONSENT = "wl_consent_v1", ATTR = "wl_attr_v1";
const get = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const set = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
const en = () => (document.documentElement.lang || "ru").startsWith("en");

function loadPixel(){
  if(!PIXEL || window.fbq) return;
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
  try{ if(get(CONSENT) === "all" && window.fbq) STANDARD.has(name) ? window.fbq("track", name, p) : window.fbq("trackCustom", name, p); }catch(e){}
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

// Баннер согласия: необходимые cookies работают всегда, рекламные — только с разрешения.
function banner(){
  const c = get(CONSENT);
  if(c){ if(c === "all") loadPixel(); return; }
  if(!PIXEL) return;          // пикселя нет — спрашивать не о чем
  const b = document.createElement("div");
  b.className = "consent";
  b.setAttribute("role", "dialog"); b.setAttribute("aria-label", en() ? "Cookies" : "Cookies");
  b.innerHTML = en()
    ? `<p>We use cookies to measure our ads. Your statements never leave your browser either way. <a href="/legal/privacy/?lang=en">Privacy</a></p>
       <div><button type="button" data-c="necessary">Necessary only</button><button type="button" data-c="all" class="primary">Allow</button></div>`
    : `<p>Мы используем cookies, чтобы оценивать рекламу. Выписки при этом в любом случае не покидают ваш браузер. <a href="/legal/privacy/">Подробнее</a></p>
       <div><button type="button" data-c="necessary">Только необходимые</button><button type="button" data-c="all" class="primary">Разрешить</button></div>`;
  b.onclick = e => { const x = e.target.closest("[data-c]"); if(!x) return; set(CONSENT, x.dataset.c); b.remove(); if(x.dataset.c === "all") loadPixel(); };
  document.body.appendChild(b);
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", banner) : banner();
WL.resetConsent = () => { try{ localStorage.removeItem(CONSENT); }catch(e){} banner(); };
})();
