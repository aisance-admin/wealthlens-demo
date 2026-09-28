/* WealthLens · отчёты о сбоях приложения — в Sentry (проект wealthlens-web, регион ЕС). Уходят тип ошибки, место в коде,
   начало текста ошибки (числа, ISIN, почта скрыты), браузер и шаг отчёта (загрузка, чтение, предпросмотр, отчёт). Не уходят:
   IP-адрес (Sentry сам вычисляет по нему только страну и город), содержимое выписок и отчёта, названия файлов, адрес страницы
   с параметрами, вывод консоли, запись экрана.
   Cookies Sentry не ставит, это защита работы сервиса — согласия не ждёт. Ключ — из настроек страницы (сборка сайта берёт
   его с сервера); на локальном стенде выключено, для проверок — ?sentry=http://<ключ>@127.0.0.1:<порт>/<проект>.
   Библиотека — со своего адреса (wealth/vendor/sentry); ошибки до её загрузки копятся и уходят после. */
(function(){
const WL = window.WL = window.WL || {};
const TAG = document.currentScript;
const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname), q = new URLSearchParams(location.search).get("sentry") || "";
const DSN = LOCAL ? (/^http:\/\/\w+@(127\.0\.0\.1|localhost):\d{2,5}\/\d+$/.test(q) ? q : "") : String(window.WL_SENTRY_DSN || "");
WL.reportError = () => {};
if(!DSN || !TAG) return;
const ENV = LOCAL ? "local" : String(window.WL_ENV || "production");
const early = [];
const keep = e => { if(early.length < 10) early.push(e); };
const onError = e => keep(e.error instanceof Error ? e.error : new Error(String(e.message || "script error")));
const onReject = e => keep(e.reason instanceof Error ? e.reason : new Error(typeof e.reason === "string" ? e.reason : "unhandled rejection"));
addEventListener("error", onError); addEventListener("unhandledrejection", onReject);

const mask = s => String(s == null ? "" : s).slice(0, 300)
  .replace(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/g, "[isin]").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").replace(/\d[\d\s.,'’]{2,}\d/g, "[n]");
const bare = u => { try{ const x = new URL(u, location.href); return x.origin + x.pathname; }catch(e){ return ""; } };
const stage = () => { const s = WL.state || {}, m = WL.model; return s.demo ? "demo" : m ? (m.preview ? "preview" : "report") : (s.files || []).length ? "reading" : "upload"; };
WL.reportError = (e, where) => keep(Object.assign(e instanceof Error ? e : new Error(String(e)), {wlWhere: String(where || "")}));

const s = document.createElement("script");
s.src = new URL("vendor/sentry/sentry.min.js", TAG.src).href; s.async = true;
s.onload = () => {
  const S = window.Sentry;
  if(!S || !S.init) return;
  try{
    S.init({dsn: DSN, environment: ENV, release: "wealthlens-web@" + String(window.WL_RELEASE || "dev"), sendDefaultPii: false, maxBreadcrumbs: 30,
      // Sentry 11 по умолчанию собирает почти всё (IP, cookies, заголовки, тела запросов) — здесь всё выключено явно
      dataCollection: {userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, graphQL: {document: false, variables: false},
        genAI: {inputs: false, outputs: false}, databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0},
      integrations: all => all.filter(i => i.name !== "Breadcrumbs").concat([S.breadcrumbsIntegration({console: false, dom: true, fetch: true, xhr: true, history: true})]),
      ignoreErrors: [/ResizeObserver loop/i],
      denyUrls: [/^(chrome|moz|safari-web)-extension:/i, /^chrome:\/\//i],
      beforeBreadcrumb(b){
        if(b.category === "console") return null;
        if(b.data) for(const k of ["url", "from", "to"]) if(b.data[k]) b.data[k] = bare(b.data[k]);
        if(b.message) b.message = mask(b.message.replace(/\[(title|alt|name|aria-label)="[^"]*"\]/g, ""));   // надписи элементов не нужны
        return b;
      },
      beforeSend(ev, hint){
        ((ev.exception && ev.exception.values) || []).forEach(x => { x.value = mask(x.value); });
        if(ev.message) ev.message = mask(ev.message);
        ev.request = ev.request ? {url: bare(ev.request.url)} : undefined;
        delete ev.extra; delete ev.user;
        ev.sdk = Object.assign({}, ev.sdk, {settings: Object.assign({}, ev.sdk && ev.sdk.settings, {infer_ip: "never"})});   // сервер Sentry не выводит IP сам
        const where = hint && hint.originalException && hint.originalException.wlWhere;
        ev.tags = Object.assign({}, ev.tags, {stage: stage(), lang: WL.lang || "", paid: !(WL.state || {}).demo && !!(WL.pay && WL.pay.locked && !WL.pay.locked())}, where ? {where} : {});
        return ev;
      }});
    removeEventListener("error", onError); removeEventListener("unhandledrejection", onReject);
    WL.reportError = (e, where) => { try{ S.captureException(Object.assign(e instanceof Error ? e : new Error(String(e)), {wlWhere: String(where || "")})); }catch(x){} };
    early.splice(0).forEach(e => S.captureException(e));
  }catch(e){}
};
document.head.appendChild(s);
})();
