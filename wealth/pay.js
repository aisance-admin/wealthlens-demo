/* WealthLens · оплата отчёта. Перенесено из прежнего приложения без изменения сути: Stripe принимает оплату с номером
   отчёта (rid), сервер после проверки платежа выдаёт подпись и разрешение (ECDSA P-256) со сроком; браузер проверяет
   разрешение открытым ключом сам. Отметки в хранилище браузера доказательством оплаты не считаются.
   Оплата — за портфель: отчёт с выписками других счетов снова закрыт. Платный режим — на wealth.euroaff.eu и с ?paywall=1. */
(function(){
const WL = window.WL, t = WL.t, esc = WL.esc;
const ON_SITE = /(^|\.)euroaff\.eu$/.test(location.hostname);
const PAYWALL = ON_SITE || (() => { const q = new URLSearchParams(location.search).has("paywall");
  try{ if(q) sessionStorage.setItem("wl_paywall", "1"); return q || sessionStorage.getItem("wl_paywall") === "1"; }catch(e){ return q; } })();
const PAY_API = "https://api.euroaff.eu";
const PRICE = {amount: 49, currency: "EUR", label: "€49"};
const UNLOCKS = "wl_unlock_v1", PENDING = "wl_pending_checkout", PROMO_KEY = "wl_promo";
const TOKEN = /^[a-f0-9]{40}$/, PROMO_RE = /^[A-Z0-9][A-Z0-9-]{3,31}$/;
const SUPPORT = String(window.WL_SUPPORT_EMAIL || "");
const S = () => WL.state;
const track = (n, p) => WL.track && WL.track(n, p);

const unlocks = () => WL.store.get(UNLOCKS, {}) || {};
const setUnlocks = m => WL.store.set(UNLOCKS, m);
const unlockOf = rid => { const v = rid && unlocks()[rid];
  if(typeof v === "string") return TOKEN.test(v) ? {t: v} : null;
  return v && typeof v === "object" && typeof v.t === "string" && TOKEN.test(v.t) ? v : null; };

const GRANTS = new Map(), SERVER_OK = new Set();
let keyP = null;
const grantId = (rid, u) => `${rid}|${u.s || ""}|${u.g.exp}|${u.g.sig}`;
const b64u = x => Uint8Array.from(atob(String(x).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(x).length / 4) * 4, "=")), c => c.charCodeAt(0));
function accessKey(){
  return keyP = keyP || (async () => {
    const jwk = window.WL_ACCESS_KEY && window.WL_ACCESS_KEY.x ? window.WL_ACCESS_KEY : await fetch(PAY_API + "/unlock/key").then(x => x.json());
    return crypto.subtle.importKey("jwk", {kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y}, {name: "ECDSA", namedCurve: "P-256"}, false, ["verify"]);
  })().catch(e => { keyP = null; throw e; });
}
async function primeGrant(rid = S().rid){
  const u = rid && unlockOf(rid);
  if(!u || !u.g || typeof u.g.sig !== "string" || !Number.isFinite(u.g.exp)) return false;
  const id = grantId(rid, u);
  if(GRANTS.has(id)) return GRANTS.get(id);
  let ok = false;
  try{ ok = u.g.exp * 1000 > Date.now() && await crypto.subtle.verify({name: "ECDSA", hash: "SHA-256"}, await accessKey(), b64u(u.g.sig),
    new TextEncoder().encode(`wl-grant|${rid}|${u.s || ""}|${u.g.exp}`)); }catch(e){ return false; }
  GRANTS.set(id, ok);
  return ok;
}
const confirmed = (u, rid = S().rid) => !!(u && ((u.g && u.g.exp * 1000 > Date.now() && GRANTS.get(grantId(rid, u)) === true) || SERVER_OK.has(`${rid}|${u.t}`)));

/* Отпечатки номеров счетов: SHA-256 с солью этого браузера. Сами номера никуда не уходят. */
const salt = () => { let s = WL.store.get("wl_salt_v1"); if(!s){ s = WL.uid(); WL.store.set("wl_salt_v1", s); } return s; };
WL.acctPrints = async doc => {
  const ids = [...new Set((doc.accounts || []).map(a => String(a.id || "").replace(/\D/g, "")).filter(x => x.length >= 4))];
  return Promise.all(ids.map(async v => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt() + "|" + v))).slice(0, 8),
    b => b.toString(16).padStart(2, "0")).join("")));
};
const curPrints = () => [...new Set(S().docs.flatMap(d => d.accts || []))];
const otherPortfolio = () => { const u = unlockOf(S().rid); if(!u || !u.a || !u.a.length) return false;
  const paid = new Set(u.a), cur = curPrints(); return cur.length > 0 && !cur.some(x => paid.has(x)); };
function extendPaid(){
  const u = unlockOf(S().rid); if(!u || !u.a || otherPortfolio()) return;
  const add = curPrints().filter(x => !u.a.includes(x)); if(!add.length) return;
  const m = unlocks(); m[S().rid] = Object.assign({}, u, {a: u.a.concat(add)}); setUnlocks(m);
}

const pay = WL.pay = {
  PAYWALL, ON_SITE, PRICE,
  locked: () => PAYWALL && !S().demo && (!confirmed(unlockOf(S().rid)) || otherPortfolio()),
  // Для сервера чтения: оплаченный отчёт читает больше страниц в сутки.
  auth(){ const s = S(), u = s && unlockOf(s.rid); return u ? {rid: s.rid, token: u.t, sid: u.s || ""} : {}; },
  extendPaid,
  promo(){ const c = WL.store.get(PROMO_KEY, ""); return typeof c === "string" && PROMO_RE.test(c) ? c : ""; },
};
function capturePromo(){
  const u = new URL(location.href);
  if(!u.searchParams.has("promo")) return;
  const c = (u.searchParams.get("promo") || "").trim().toUpperCase();
  u.searchParams.delete("promo"); history.replaceState(null, "", u.pathname + u.search + u.hash);
  if(PROMO_RE.test(c)) WL.store.set(PROMO_KEY, c);
}
capturePromo();

async function unlockWith(sid, r, restored){
  const s = S(), m = unlocks();
  m[s.rid] = {t: r.token, s: r.sid || sid || null, a: curPrints(), g: r.grant || null};
  setUnlocks(m);
  SERVER_OK.add(`${s.rid}|${r.token}`);
  WL.store.del(PENDING);
  if(r.amount === 0) WL.store.del(PROMO_KEY);
  await primeGrant();
  if(restored) return;
  const seen = "wl_purchase_" + String(sid).slice(-16);
  if(!WL.store.get(seen)){ WL.store.set(seen, 1); track("Purchase", {value: typeof r.amount === "number" ? r.amount : PRICE.amount, currency: r.currency || PRICE.currency, content_name: "portfolio_report"}); }
}

let checking = false;
pay.check = async () => {
  const s = S();
  if(!PAYWALL || s.demo || !s.rid || checking) return;
  const u = unlockOf(s.rid);
  if(!u){ const m = unlocks(); if(s.rid in m){ delete m[s.rid]; setUnlocks(m); } return; }
  await primeGrant();
  const key = `${s.rid}|${u.t}`;
  if(SERVER_OK.has(key)) return;
  checking = true;
  let r = null;
  try{ r = await fetch(`${PAY_API}/unlock/check?rid=${encodeURIComponent(s.rid)}&token=${encodeURIComponent(u.t)}&sid=${encodeURIComponent(u.s || "")}`).then(x => x.json()); }catch(e){}
  checking = false;
  const now = unlockOf(s.rid);
  if(!now || now.t !== u.t) return WL.render();
  if(r && r.ok === true){
    if(r.grant){ const m = unlocks(); m[s.rid] = Object.assign({}, now, {g: r.grant}); setUnlocks(m); }
    SERVER_OK.add(key); await primeGrant(); return WL.render();
  }
  if(r && r.ok === false){
    const m = unlocks(); delete m[s.rid]; setUnlocks(m); SERVER_OK.delete(key);
    WL.toast(r.reason === "refunded" ? t("Оплата этого отчёта возвращена — полный отчёт закрыт.", "Payment for this report was refunded, so the full report is locked.")
      : t("Доступ к полному отчёту не подтвердился. Если вы оплачивали, нажмите «Восстановить доступ».", "Access to the full report could not be confirmed. If you paid, use “Restore access”."));
    return WL.render();
  }
  if(!confirmed(u)) WL.toast(t("Не удалось проверить оплату: нет связи с сервером. Отчёт откроется, когда проверка пройдёт.", "Could not verify the payment: no connection to the server. The report unlocks once the check succeeds."));
  WL.render();
};

pay.restore = async btn => {
  const s = S(); if(!s.rid) return;
  if(btn) btn.disabled = true;
  let r = null;
  try{ r = await fetch(PAY_API + "/unlock/restore", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({rid: s.rid})}).then(x => x.json()); }catch(e){}
  if(btn) btn.disabled = false;
  if(r && r.ok){ await unlockWith(r.sid, r, true); WL.toast(t("Оплата найдена — полный отчёт открыт", "Payment found — the full report is unlocked")); return WL.render(); }
  WL.toast(SUPPORT ? t(`Оплату этого отчёта не нашли. Напишите на ${SUPPORT} и укажите номер отчёта ${s.rid}.`, `No payment was found for this report. Email ${SUPPORT} with report number ${s.rid}.`)
    : t(`Оплату этого отчёта не нашли. Номер отчёта: ${s.rid}.`, `No payment was found for this report. Report number: ${s.rid}.`));
};

pay.returnFromStripe = async () => {
  const u = new URL(location.href), sid = u.searchParams.get("paid"), canceled = u.searchParams.has("canceled");
  if(!sid && !canceled){
    // Оплатили, но закрыли вкладку раньше, чем Stripe вернул на сайт.
    const p = WL.store.get(PENDING), s = S();
    if(pay.locked() && p && p.rid === s.rid && p.sid && Date.now() - p.at < 2 * 864e5){
      let r = null; try{ r = await fetch(`${PAY_API}/checkout/verify?session_id=${encodeURIComponent(p.sid)}&rid=${s.rid}`).then(x => x.json()); }catch(e){}
      if(r && r.ok){ await unlockWith(p.sid, r); WL.toast(t("Оплата прошла — полный отчёт открыт", "Payment received — the full report is unlocked")); WL.render(); }
    }
    return;
  }
  u.searchParams.delete("paid"); u.searchParams.delete("canceled");
  history.replaceState(null, "", u.pathname + u.search + u.hash);
  if(canceled){ WL.store.del(PENDING); WL.toast(t("Оплата не завершена. Открыть полный отчёт можно в любой момент.", "Payment was not completed. You can unlock the full report at any time.")); return; }
  const s = S();
  if(!s.rid || !s.docs.length){ WL.toast(t("Оплата прошла, но отчёта в этом браузере нет. Откройте его там, где загружали выписки.", "Payment received, but this browser has no report. Open it in the browser where you uploaded the statements.")); return; }
  let r = null;
  try{ r = await fetch(`${PAY_API}/checkout/verify?session_id=${encodeURIComponent(sid)}&rid=${s.rid}`).then(x => x.json()); }catch(e){}
  if(r && r.ok){ await unlockWith(sid, r); WL.toast(t("Оплата прошла — полный отчёт открыт", "Payment received — the full report is unlocked")); }
  else WL.toast(r && r.reason === "not paid" ? t("Платёж ещё не подтверждён. Обновите страницу через минуту.", "Payment is not confirmed yet. Refresh the page in a minute.")
    : SUPPORT ? t(`Не удалось подтвердить оплату. Напишите на ${SUPPORT} — разберёмся.`, `Could not confirm the payment. Email ${SUPPORT} and we will look into it.`)
    : t("Не удалось подтвердить оплату. Напишите нам — разберёмся.", "Could not confirm the payment. Contact us and we will look into it."));
  WL.render();
};

let busy = false;
pay.open = async source => {
  const s = S();
  if(!WL.model || !WL.model.positions.length){ WL.toast(t("В отчёте пока нет позиций — оплачивать нечего.", "The report has no positions yet, so there is nothing to pay for.")); return; }
  if(WL.reading){ WL.toast(t("Дождитесь, пока Claude дочитает файлы: оплачивается отчёт со всеми выписками.", "Wait until Claude finishes reading: you pay for the report with all statements.")); return; }
  if(!pay.locked()){ WL.toast(t("Этот отчёт уже оплачен — полный отчёт открыт", "This report is already paid — the full report is unlocked")); return WL.render(); }
  if(busy) return;
  const u0 = unlockOf(s.rid);
  if(u0 && !confirmed(u0)){ busy = true; await pay.check(); busy = false; if(!pay.locked() || unlockOf(s.rid)) return; }
  const gift = pay.promo();
  busy = true;
  const {choice} = await WL.dialog({
    eyebrow: gift ? t("Подарочный код", "Gift code") : t("Полный отчёт", "Full report"),
    title: gift ? t("Открыть полный отчёт по подарочному коду", "Unlock the full report with your gift code") : t(`Открыть полный отчёт за ${PRICE.label}`, `Unlock the full report for ${PRICE.label}`),
    body: `<p>${gift ? t(`Код <b>${esc(gift)}</b> будет уже применён на странице Stripe — к оплате €0.`, `Code <b>${esc(gift)}</b> will already be applied on the Stripe page — you pay €0.`)
        : t("Разовая оплата через Stripe, без подписки.", "A one-off payment via Stripe, no subscription.")}
      ${t("Откроются все позиции, выводы и выгрузка отчёта в PDF и Excel. Выписки этого же портфеля можно добавлять и потом — платить снова не нужно.",
          "You get every position, all findings and the PDF and Excel downloads. You can add statements of the same portfolio later at no extra cost.")}</p>
      <p class="muted">${t("Отчёт и доступ хранятся в этом браузере. На другом устройстве загрузите выписки заново и нажмите «Восстановить доступ».",
        "The report and its access are kept in this browser. On another device, upload the statements again and use “Restore access”.")}</p>
      <label class="check"><input type="checkbox" data-waiver> <span>${t("Прошу открыть отчёт сразу после оплаты и понимаю, что после этого право отказаться от покупки в течение 14 дней не действует.",
        "I ask for the report to be unlocked right after payment and understand that I then lose the 14-day right of withdrawal.")}</span></label>
      ${ON_SITE ? `<p class="fine">${t(`<a href="/legal/terms/" target="_blank" rel="noopener">Условия</a> · <a href="/legal/refund/" target="_blank" rel="noopener">возврат, если отчёт не собрался</a>`,
        `<a href="/en/legal/terms/" target="_blank" rel="noopener">Terms</a> · <a href="/en/legal/refund/" target="_blank" rel="noopener">refund if the report can't be built</a>`)}</p>` : ""}`,
    buttons: [{id: "pay", label: gift ? t("Продолжить", "Continue") : t("Перейти к оплате", "Continue to payment"), primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}],
    gate: "[data-waiver]",
  });
  busy = false;
  if(choice !== "pay" || !pay.locked() || WL.reading) return;
  if(!WL.save()){ WL.toast(t("Браузер не сохраняет отчёт, поэтому после оплаты открыть его здесь не получится. Разрешите сайту хранить данные и попробуйте снова.",
    "The browser is not saving the report, so it could not be opened here after payment. Allow this site to store data and try again.")); return; }
  const rid = s.rid;
  const pend = WL.store.get(PENDING);
  if(pend && pend.rid === rid && pend.sid && Date.now() - pend.at < 2 * 864e5){
    let v = null; try{ v = await fetch(`${PAY_API}/checkout/verify?session_id=${encodeURIComponent(pend.sid)}&rid=${rid}`).then(x => x.json()); }catch(e){}
    if(v && v.ok){ await unlockWith(pend.sid, v); WL.toast(t("Этот отчёт уже оплачен — полный отчёт открыт", "This report is already paid — the full report is unlocked")); return WL.render(); }
  }
  const code = pay.promo();
  track("InitiateCheckout", {value: code ? 0 : PRICE.amount, currency: PRICE.currency, content_name: "portfolio_report", source});
  const body = Object.assign({}, WL.attribution ? WL.attribution() : {}, {rid, lang: WL.lang, path: location.pathname, waiver: true, paywall: PAYWALL && !ON_SITE}, code ? {promo: code} : {});
  let r = null;
  try{ r = await fetch(PAY_API + "/checkout", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}).then(x => x.json()); }catch(e){}
  if(r && r.url){
    if(code && r.promo !== "applied"){
      if(r.promo === "invalid") WL.store.del(PROMO_KEY);
      const {choice: go} = await WL.dialog({eyebrow: t("Подарочный код", "Gift code"),
        title: r.promo === "invalid" ? t("Код больше не действует", "This code is no longer valid") : t("Код не удалось применить автоматически", "The code could not be applied automatically"),
        body: `<p>${r.promo === "invalid" ? t(`Код <b>${esc(code)}</b> уже использован или истёк. Полный отчёт можно открыть за ${PRICE.label}.`, `Code <b>${esc(code)}</b> has already been used or has expired. You can unlock the full report for ${PRICE.label}.`)
          : t(`На странице Stripe нажмите «Добавить промокод» и введите <b>${esc(code)}</b>.`, `On the Stripe page, choose “Add promotion code” and enter <b>${esc(code)}</b>.`)}</p>`,
        buttons: [{id: "go", label: t("Перейти к оплате", "Continue to payment"), primary: true}, {id: "cancel", label: t("Отмена", "Cancel")}]});
      if(go !== "go") return;
    }
    WL.store.set(PENDING, {rid, sid: r.id, at: Date.now()});
    WL.leaving = true; location.href = r.url; return;
  }
  WL.toast(r && r.error === "payments_not_configured"
    ? (SUPPORT ? t(`Оплата подключается. Напишите на ${SUPPORT} — откроем отчёт вручную.`, `Payments are being set up. Email ${SUPPORT} and we will unlock the report manually.`) : t("Оплата скоро заработает.", "Payments are coming soon."))
    : SUPPORT ? t(`Не удалось открыть оплату. Попробуйте ещё раз или напишите на ${SUPPORT}.`, `Could not open checkout. Try again or email ${SUPPORT}.`) : t("Не удалось открыть оплату. Попробуйте ещё раз.", "Could not open checkout. Please try again."));
};
})();
