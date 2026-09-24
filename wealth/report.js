/* WealthLens · расчёт отчёта из прочитанного. Числа — только из выписок и курсов; здесь их складывают, пересчитывают в
   валюту отчёта и сверяют с итогами банка. Выводы ИИ (сводка, пояснения) приходят отдельно и сюда не смешиваются. */
(function(){
const WL = window.WL, t = WL.t, fmt = WL.fmt;

const CATS = WL.CATS = [
  {key: "cash", cls: ["cash", "deposit"], label: t("Деньги и депозиты", "Cash and deposits")},
  {key: "stock", cls: ["stock"], label: t("Акции", "Stocks")},
  {key: "fund", cls: ["etf", "fund"], label: t("Фонды и ETF", "Funds and ETFs")},
  {key: "bond", cls: ["bond"], label: t("Облигации", "Bonds")},
  {key: "note", cls: ["note"], label: t("Структурные продукты", "Structured products")},
  {key: "deriv", cls: ["option", "future"], label: t("Опционы и фьючерсы", "Options and futures")},
  {key: "alt", cls: ["metal", "crypto", "alt"], label: t("Альтернативные активы", "Alternatives")},
  {key: "other", cls: ["other"], label: t("Прочее", "Other")},
];
const catOf = cls => CATS.find(c => c.cls.includes(cls)) || CATS[CATS.length - 1];
WL.catOf = catOf;
WL.CLS = {cash: t("счёт", "account"), deposit: t("депозит", "deposit"), stock: t("акция", "stock"), etf: "ETF", fund: t("фонд", "fund"), bond: t("облигация", "bond"),
  note: t("структурный продукт", "structured product"), option: t("опцион", "option"), future: t("фьючерс", "future"), metal: t("металл", "metal"),
  crypto: t("криптовалюта", "crypto"), alt: t("альтернативный актив", "alternative"), other: t("прочее", "other")};
WL.BASES = ["USD", "EUR", "CHF", "GBP"];

const digits = s => String(s || "").replace(/\D/g, "");
/* Номер счёта: буквы значимы («ABC123» и «XYZ123» — разные счета), пробелы и разделители — нет. Маскированный номер
   («****7342», «U•••4411») совпадает с полным, если совпадают видимые начало и конец. */
function acctInfo(s){
  const raw = String(s || "").toUpperCase().replace(/[\s\-_.\/:#№]+/g, "");
  const m = raw.match(/^([A-Z0-9]*?)(?:[*•·…]+|X{3,})([A-Z0-9]*)$/);
  if(m && (m[2].length >= 3)) return {key: raw, masked: true, head: m[1], tail: m[2]};
  const key = raw.replace(/[^A-Z0-9]/g, "");
  return key.length >= 3 ? {key, masked: false} : null;
}
function sameAcct(a, b){
  if(!a || !b) return false;
  if(!a.masked && !b.masked) return a.key === b.key;
  if(a.masked && b.masked) return a.tail === b.tail && a.head === b.head;
  const [m, f] = a.masked ? [a, b] : [b, a];
  return f.key.length > m.tail.length && f.key.endsWith(m.tail) && f.key.startsWith(m.head);
}
WL.sameAcct = (x, y) => sameAcct(acctInfo(x), acctInfo(y));
const normInst = s => String(s || "").toLowerCase().replace(/\b(ag|sa|plc|ltd|limited|inc|llc|gmbh|bank|banque|& co\.?|co\.?|n\.a\.|s\.a\.|corp\.?|corporation|group|the)\b/g, "").replace(/[^a-zа-я0-9]+/g, "");
const ident = r => (r.isin || r.ticker || r.name || "").toLowerCase().replace(/\s+/g, " ").trim();
const accts = d => d.accounts.map(a => Object.assign({id: a.id}, acctInfo(a.id) || {})).filter(a => a.key);
/* Строка — к какому счёту выписки она относится: единственный счёт, совпавший номер или номер субсчёта (начинается
   с номера счёта). null — строку нельзя надёжно отнести к счёту. */
function rowAcct(d, r, list = accts(d)){
  if(list.length === 1) return list[0];
  const ri = acctInfo(r.acct);
  if(!ri) return null;
  return list.find(a => sameAcct(a, ri)) || list.find(a => !a.masked && !ri.masked && (ri.key.startsWith(a.key) || a.key.startsWith(ri.key))) || null;
}

/* Какие выписки учитывать. Не финансовые документы и файлы без позиций — в отчёт не входят. Две выписки одного счёта:
   на одну дату — дубль (учитывается та, где больше позиций), на разные — учитывается свежая. Решение принимается по
   каждому счёту: если в старой выписке есть и другие счета, они остаются в отчёте, убираются только строки счетов,
   по которым есть выписка свежее (x.drop). Если строки нельзя надёжно разнести по счетам — документ не исключается,
   а отчёт предупреждает о возможном двойном учёте (x.conflict). Без номеров счетов один счёт — тот же банк и больше
   половины одинаковых бумаг. Решение можно поменять вручную (S.include[id] = true/false). */
function chooseDocs(S){
  const docs = S.docs.map(d => ({d, use: true, why: "", by: "", drop: []}));
  for(const x of docs){
    const d = x.d;
    if(d.type === "not_financial"){ x.use = false; x.why = "not_financial"; }
    else if(!d.rows.length){ x.use = false; x.why = d.failed.length && !d.pages.length ? "unread" : "no_positions"; }
  }
  const live = docs.filter(x => x.use);
  for(let i = 0; i < live.length; i++) for(let j = i + 1; j < live.length; j++){
    const a = live[i], b = live[j];
    if(!a.use || !b.use) continue;
    const A = a.d, B = b.d;
    if(normInst(A.institution) && normInst(B.institution) && normInst(A.institution) !== normInst(B.institution)) continue;
    const ia = accts(A), ib = accts(B);
    let same = false;
    if(ia.length && ib.length) same = ia.some(x => ib.some(y => sameAcct(x, y)));
    else {
      const sa = new Set(A.rows.filter(r => r.cls !== "cash").map(ident)), sb = new Set(B.rows.filter(r => r.cls !== "cash").map(ident));
      const common = [...sa].filter(x => sb.has(x)).length;
      same = !!normInst(A.institution) && Math.min(sa.size, sb.size) >= 2 && common / Math.min(sa.size, sb.size) >= 0.6;
    }
    if(!same) continue;
    let keep, drop, why;
    if(A.as_of && B.as_of && A.as_of !== B.as_of){ [keep, drop] = A.as_of > B.as_of ? [a, b] : [b, a]; why = "older"; }
    else { [keep, drop] = B.rows.length > A.rows.length ? [b, a] : [a, b]; why = "duplicate"; }
    const mine = accts(drop.d), theirs = accts(keep.d);
    const covered = mine.length && theirs.length ? mine.filter(x => theirs.some(y => sameAcct(x, y))) : mine;
    if(covered.length === mine.length){ drop.use = false; drop.why = why; drop.by = keep.d.id; }         // все счета есть в другой выписке
    else covered.forEach(acct => { if(!drop.drop.some(z => z.acct.id === acct.id)) drop.drop.push({acct, by: keep.d.id, why}); });
  }
  const over = S.include || {};
  for(const x of docs) if(over[x.d.id] === true && x.why !== "not_financial" && x.d.rows.length){ x.use = true; x.forced = true; x.drop = []; }
    else if(over[x.d.id] === false){ x.use = false; x.why = "removed"; }
  return docs;
}

/* Строки выписки, которые идут в отчёт: если есть полный список позиций, сводные таблицы (топ-10, распределение) не
   считаются; одинаковые строки с разных страниц — один раз. */
/* Одна и та же бумага в двух таблицах одного файла (полный список и, например, «облигации ниже инвестиционного уровня»,
   которую ИИ при чтении по частям принял за полный список): то же количество и та же стоимость на разных страницах плюс
   общий ISIN, тикер или начало названия — это повтор, не вторая позиция. */
const words = s => String(s || "").toLowerCase().replace(/[^a-zа-я0-9.%/ ]+/g, " ").split(/\s+/).filter(Boolean);
function sameHolding(a, b){
  if(a.isin && b.isin) return a.isin === b.isin;
  if(a.ticker && b.ticker && a.ticker.toLowerCase() === b.ticker.toLowerCase()) return true;
  const wa = words(a.name), wb = words(b.name);
  if(!wa.length || !wb.length) return false;
  const na = wa.join(" "), nb = wb.join(" ");
  return na.includes(nb) || nb.includes(na) || (wa[0] === wb[0] && (wa[1] || "") === (wb[1] || ""));
}
function docRows(d, drop = []){
  const full = d.rows.some(r => r.table !== "S");
  const out = [], byQv = new Map(), list = accts(d);
  let summaryDropped = 0, dupDropped = 0, acctDropped = 0, unattributed = 0;
  // Счета, которые есть в выписке свежее: их строки не берём. Если хоть одну строку нельзя отнести к счёту — ничего не
  // убираем (решает пользователь, отчёт предупреждает).
  if(drop.length && d.rows.some(r => (!full || r.table !== "S") && !rowAcct(d, r, list))) unattributed = 1;
  const dropped = r => !unattributed && drop.length && (a => a && drop.some(z => sameAcct(z.acct, a)))(rowAcct(d, r, list));
  for(const r of d.rows){
    if(dropped(r)){ acctDropped++; continue; }
    if(full && r.table === "S"){ summaryDropped++; continue; }
    if(r.cls !== "cash" && r.value && r.qty != null){
      const k = [r.acct || "", r.ccy || "", r.qty, r.value].join("|"), prev = byQv.get(k) || [];
      if(prev.some(p => p.page !== r.page && sameHolding(p, r))){ dupDropped++; continue; }
      prev.push(r); byQv.set(k, prev);
    } else if(out.some(p => p.cls === r.cls && p.page === r.page && p.value === r.value && ident(p) === ident(r) && (p.acct || "") === (r.acct || ""))){ dupDropped++; continue; }
    const x = Object.assign({}, r);
    // Цена в процентах номинала, если выписка это не подписала: номинал × цена / 100 ≈ стоимость.
    if(!x.unit && x.qty && x.price && x.value && ["bond", "note", "deposit"].includes(x.cls)){
      const pct = Math.abs(x.qty * x.price / 100 - x.value) / Math.abs(x.value), unit = Math.abs(x.qty * x.price - x.value) / Math.abs(x.value);
      if(pct < 0.03 && unit > 0.5) x.unit = "%";
    }
    out.push(x);
  }
  return {rows: out, summaryDropped, dupDropped, acctDropped, conflict: !!(drop.length && unattributed), summaryOnly: !full && d.rows.length > 0};
}

/* Курсы: rates[ВАЛЮТА] — единиц валюты за 1 единицу валюты отчёта, на дату выписки. */
const fxKey = (base, date) => `${base}|${date || "latest"}`;
WL.ensureFx = async (S, base) => {
  S.fx = S.fx || {};
  const dates = [...new Set([""].concat(S.docs.map(d => d.as_of && d.as_of <= WL.today() ? d.as_of : "")))];   // «» — курсы сейчас, для оценки по текущим ценам
  await Promise.all(dates.map(async date => {
    const k = fxKey(base, date);
    if(S.fx[k] && S.fx[k].rates) return;
    const r = await WL.api(`/fx?base=${base}${date ? "&date=" + date : ""}`, undefined, {timeout: 30000});
    if(r && r.rates) S.fx[k] = {rates: r.rates, extra: r.extra || {}, date: r.date};
  }));
};

function converter(S, base){
  return (doc, r, field = "value") => {
    const v = r[field];
    if(v == null || !isFinite(v)) return {v: null};
    const ccy = r.ccy || doc.ref_ccy || (doc.accounts.length === 1 ? doc.accounts[0].currency : "") || "";
    if(!ccy) return {v: null, missing: "?"};
    if(ccy === base) return {v, src: "same"};
    if(doc.ref_ccy === base){
      if(field === "value" && r.value_ref != null && isFinite(r.value_ref)) return {v: r.value_ref, src: "statement"};
      if(field === "accrued" && r.value_ref != null && r.value) return {v: v * r.value_ref / r.value, src: "statement"};
      const fx = doc.fx.find(x => x.currency === ccy);
      if(fx) return {v: v * fx.rate, src: "statement"};
    }
    const date = doc.as_of && doc.as_of <= WL.today() ? doc.as_of : "";
    const tab = (S.fx || {})[fxKey(base, date)] || (S.fx || {})[fxKey(base, "")];
    const rate = tab && tab.rates[ccy];
    if(rate > 0) return {v: v / rate, src: tab.extra && tab.extra[ccy] ? (tab.extra[ccy] === "peg" ? "peg" : "alt") : "ecb"};
    return {v: null, missing: ccy};
  };
}

/* Сверка с итогами банка. Итог по валюте сравнивается с суммой позиций в этой валюте точно; общий итог — через стоимость
   в валюте выписки, если банк её напечатал, иначе через курс (допуск шире). НКД банк то включает, то нет — пробуем оба. */
function reconcile(doc, rows, S){
  const totals = doc.totals.filter(x => ["total", "account", "currency"].includes(x.scope) && isFinite(x.amount));
  if(!totals.length) return {status: "none", checks: []};
  const conv = converter(S, "");
  const checks = [];
  for(const tot of totals){
    const ccy = (tot.currency || doc.ref_ccy || "").toUpperCase();
    let pool = rows;
    if(tot.scope === "account" && tot.account){
      const ti = acctInfo(tot.account);
      const mine = rows.filter(r => r.acct && (r.acct === tot.account || (ti && (a => a && (sameAcct(a, ti) || (!a.masked && !ti.masked && a.key.startsWith(ti.key))))(acctInfo(r.acct)))));
      if(mine.length) pool = mine;
    }
    if(tot.scope === "currency") pool = pool.filter(r => (r.ccy || doc.ref_ccy) === ccy);
    let sum = 0, acc = 0, approx = false, missing = false;
    for(const r of pool){
      if(r.value == null) continue;
      const rc = r.ccy || doc.ref_ccy;
      if(rc === ccy){ sum += r.value; acc += r.accrued || 0; continue; }
      if(ccy === doc.ref_ccy && r.value_ref != null){ sum += r.value_ref; acc += r.value && r.accrued ? r.accrued * r.value_ref / r.value : 0; continue; }
      const fx = ccy === doc.ref_ccy && doc.fx.find(x => x.currency === rc);
      if(fx){ sum += r.value * fx.rate; acc += (r.accrued || 0) * fx.rate; continue; }
      // через курс ЕЦБ на дату выписки: переводим в валюту итога
      const tab = (S.fx || {})[fxKey(ccy, doc.as_of)] || null;
      const base = S.base, tb = (S.fx || {})[fxKey(base, doc.as_of && doc.as_of <= WL.today() ? doc.as_of : "")];
      if(tb && tb.rates[rc] && (ccy === base || tb.rates[ccy])){
        const inBase = r.value / tb.rates[rc], k = ccy === base ? 1 : tb.rates[ccy];
        sum += inBase * k; acc += (r.accrued || 0) / tb.rates[rc] * k; approx = true; continue;
      }
      missing = true;
    }
    const tol = approx ? Math.max(2, Math.abs(tot.amount) * 0.006) : Math.max(1.01, Math.abs(tot.amount) * 0.0005);
    const d0 = sum - tot.amount, d1 = sum + acc - tot.amount;
    const ok = !missing && (Math.abs(d0) <= tol || Math.abs(d1) <= tol);
    checks.push({label: tot.label, scope: tot.scope, account: tot.account, ccy, amount: tot.amount, sum, sumAcc: sum + acc,
      withAccrued: ok && Math.abs(d1) <= tol && Math.abs(d0) > tol, diff: Math.abs(d1) < Math.abs(d0) ? d1 : d0, ok, approx, missing, page: tot.page});
  }
  const grand = checks.filter(c => c.scope === "total");
  let status;
  if(grand.length) status = grand.some(c => c.ok) ? "ok" : checks.some(c => c.ok) ? "partial" : "mismatch";
  else status = checks.every(c => c.ok) ? "ok" : checks.some(c => c.ok) ? "partial" : "mismatch";
  return {status, checks};
}

/* Модель отчёта */
WL.build = S => {
  const base = S.base || "USD", conv = converter(S, base);
  const chosen = chooseDocs(S);
  const docs = [], positions = [], missingFx = new Set();
  for(const x of chosen){
    const d = x.d, info = {id: d.id, file: d.file, institution: d.institution || "", type: d.type, as_of: d.as_of, ref_ccy: d.ref_ccy, pageCount: d.pageCount,
      accounts: d.accounts, notes: d.notes, failed: d.failed, truncated: d.truncated, fullPages: d.fullPages, use: x.use, why: x.why, by: x.by, forced: !!x.forced,
      rowsRead: d.rows.length, pages: d.pages};
    docs.push(info);
    if(!x.use) continue;
    const all = docRows(d), pr = x.drop.length ? docRows(d, x.drop) : all;
    info.summaryDropped = pr.summaryDropped; info.dupDropped = pr.dupDropped; info.summaryOnly = pr.summaryOnly;
    info.recon = reconcile(d, all.rows, S);                   // сверка — по всему прочитанному, даже если часть счетов заменена
    if(x.drop.length){
      const byFile = id => (S.docs.find(z => z.id === id) || {});
      const items = x.drop.map(z => ({acct: z.acct.id, by: z.by, byFile: byFile(z.by).file || "", byDate: byFile(z.by).as_of || "", why: z.why}));
      if(pr.conflict) info.conflict = items; else { info.replaced = items; info.acctDropped = pr.acctDropped; }
    }
    info.positions = pr.rows.length;
    let docValue = 0;
    for(const r of pr.rows){
      const a = conv(d, r, "value"), b = r.accrued ? conv(d, r, "accrued") : {v: 0};
      if(a.missing) missingFx.add(a.missing);
      if(a.missing === "?") info.noCcy = true;
      const p = Object.assign({}, r, {cat: catOf(r.cls).key, inst: d.institution || d.file, docFile: d.file, as_of: d.as_of,
        ccy: r.ccy || d.ref_ccy || "", vb: a.v, ab: b.v || 0, fxSrc: a.src || "", ccyGuess: !r.ccy});
      positions.push(p);
      if(a.v != null) docValue += a.v + (b.v || 0);
    }
    info.value = docValue;
  }
  const total = positions.reduce((s, p) => s + (p.vb || 0) + (p.ab || 0), 0);
  const accrued = positions.reduce((s, p) => s + (p.ab || 0), 0);
  const gross = positions.reduce((s, p) => s + Math.max(0, (p.vb || 0) + (p.ab || 0)), 0);
  for(const p of positions) p.w = total ? ((p.vb || 0) + (p.ab || 0)) / total : 0;

  const byCat = CATS.map(c => { const ps = positions.filter(p => p.cat === c.key);
    return {key: c.key, label: c.label, value: ps.reduce((s, p) => s + (p.vb || 0) + (p.ab || 0), 0), count: ps.length}; }).filter(c => c.count);
  byCat.forEach(c => c.share = total ? c.value / total : 0);
  const ccyMap = {};
  for(const p of positions){ const k = p.ccy || "?"; ccyMap[k] = (ccyMap[k] || 0) + (p.vb || 0) + (p.ab || 0); }
  const byCcy = Object.entries(ccyMap).map(([ccy, value]) => ({ccy, value, share: total ? value / total : 0})).sort((a, b) => b.value - a.value);
  const instMap = {};
  for(const d of docs.filter(d => d.use)){
    const k = d.institution || d.file;
    const m = instMap[k] = instMap[k] || {name: k, value: 0, docs: [], as_of: [], positions: 0};
    m.value += d.value || 0; m.docs.push(d); m.positions += d.positions || 0; if(d.as_of) m.as_of.push(d.as_of);
  }
  const byInst = Object.values(instMap).map(m => Object.assign(m, {share: total ? m.value / total : 0, as_of: [...new Set(m.as_of)].sort()})).sort((a, b) => b.value - a.value);
  const dates = [...new Set(docs.filter(d => d.use && d.as_of).map(d => d.as_of))].sort();

  // Сроки: погашения и экспирации в ближайший год
  const timeline = positions.filter(p => p.date && ["bond", "note", "deposit", "option", "future"].includes(p.cls))
    .map(p => ({p, days: fmt.days(p.date)})).filter(x => x.days != null && x.days >= -3 && x.days <= 366).sort((a, b) => a.days - b.days);

  const M = {base, total, accrued, gross, positions, docs, byCat, byCcy, byInst, dates, timeline, missingFx: [...missingFx]};
  M.alerts = alerts(M, S);
  return M;
};

/* Автоматические предупреждения: только то, что следует из чисел. Остальное добавляет ИИ в сводке. */
function alerts(M, S){
  const out = [], base = M.base, money = v => fmt.money(v, base), name = p => p.name || p.isin || p.ticker || "—";
  const add = (level, id, title, text, refs = []) => out.push({level, id, title, text, refs, auto: true});
  for(const d of M.docs){
    if(d.failed && d.failed.length){
      const pages = d.failed.map(f => f.from === f.to ? f.from : `${f.from}–${f.to}`).join(", ");
      add("high", "unread-" + d.id, t(`Не прочитаны страницы ${pages} в «${d.file}»`, `Pages ${pages} of “${d.file}” were not read`),
        t("Позиции с этих страниц в отчёт не вошли. Нажмите «Дочитать» у файла в разделе «Файлы».", "Positions from these pages are missing. Use “Read again” on the file in the Files section."), [d.id]);
    }
    if(d.truncated) add("watch", "trunc-" + d.id, t(`Прочитаны первые ${d.pageCount} страниц из ${d.fullPages} в «${d.file}»`, `Only the first ${d.pageCount} of ${d.fullPages} pages of “${d.file}” were read`),
      t("Разделите файл на части и добавьте их отдельно.", "Split the file and add the parts separately."), [d.id]);
    if(d.use && d.conflict && d.conflict.length){
      const c = d.conflict[0], more = d.conflict.length - 1;
      add("watch", "overlap-" + d.id, t(`Счёт ${c.acct} есть в двух выписках на разные даты`, `Account ${c.acct} appears in two statements with different dates`),
        t(`«${d.file}»${d.as_of ? " на " + fmt.date(d.as_of) : ""} и «${c.byFile}»${c.byDate ? " на " + fmt.date(c.byDate) : ""}${more > 0 ? ` (и ещё ${more})` : ""}. В старой выписке строки не удалось разнести по счетам, поэтому она учтена целиком — итог может учитывать счёт дважды. Если в ней нет других счетов, нажмите у файла «Не учитывать».`,
          `“${d.file}”${d.as_of ? " as of " + fmt.date(d.as_of) : ""} and “${c.byFile}”${c.byDate ? " as of " + fmt.date(c.byDate) : ""}${more > 0 ? ` (and ${more} more)` : ""}. The older statement's rows could not be split by account, so it is counted in full — the total may count the account twice. If it holds no other accounts, use “Exclude” on the file.`), [d.id]);
    }
    if(!d.use || !d.recon) continue;
    if(d.recon.status === "mismatch" || d.recon.status === "partial"){
      const c = d.recon.checks.filter(x => !x.ok).sort((a, b) => (a.scope === "total" ? -1 : 0) - (b.scope === "total" ? -1 : 0))[0];
      if(c) add(d.recon.status === "mismatch" ? "high" : "watch", "recon-" + d.id,
        t(`«${d.institution || d.file}»: сумма позиций не совпала с итогом банка`, `“${d.institution || d.file}”: positions don't add up to the bank's total`),
        t(`Итог в выписке «${c.label}» — ${fmt.money(c.amount, c.ccy, 2)}, сумма прочитанных позиций — ${fmt.money(c.sum, c.ccy, 2)}${c.approx ? " (через курс)" : ""}, разница ${fmt.money(Math.abs(c.diff), c.ccy, 2)}.`,
          `The statement total “${c.label}” is ${fmt.money(c.amount, c.ccy, 2)}; the positions read add up to ${fmt.money(c.sum, c.ccy, 2)}${c.approx ? " (via FX)" : ""}, a difference of ${fmt.money(Math.abs(c.diff), c.ccy, 2)}.`), [d.id]);
    }
    if(d.summaryOnly) add("watch", "summary-" + d.id, t(`«${d.file}»: найдены только сводные таблицы`, `“${d.file}”: only summary tables were found`),
      t("Полного списка позиций в файле нет — отчёт построен по сводной таблице и может быть неполным.", "The file has no complete list of positions — the report uses a summary table and may be incomplete."), [d.id]);
  }
  const noCcy = M.docs.filter(d => d.use && d.noCcy);
  if(noCcy.length) add("high", "ccy", t("В выписке не указана валюта", "The statement doesn't show a currency"),
    t(`${noCcy.map(d => "«" + d.file + "»").join(", ")}: выберите валюту в разделе «Файлы» — до этого суммы из ${noCcy.length === 1 ? "неё" : "них"} в итог не входят.`,
      `${noCcy.map(d => "“" + d.file + "”").join(", ")}: choose the currency in the Files section — until then these amounts are left out of the total.`), noCcy.map(d => d.id));
  const fxMiss = M.missingFx.filter(c => c !== "?");
  if(fxMiss.length) add("high", "fx", t(`Нет курса для ${fxMiss.join(", ")}`, `No exchange rate for ${fxMiss.join(", ")}`),
    t("Позиции в этих валютах не пересчитаны и в итог не вошли.", "Positions in these currencies are not converted and are left out of the total."));
  if(!M.total) return out;
  const neg = M.positions.filter(p => p.cls === "cash" && (p.vb || 0) < -1);
  if(neg.length) add("high", "neg", t("Отрицательный остаток на счёте", "Negative cash balance"),
    neg.map(p => `${name(p)} (${p.inst}): ${fmt.money(p.value, p.ccy)}`).join("; ") + t(" — это долг банку или маржинальный кредит.", " — money owed to the bank or a margin loan."), neg.map(p => p.id));
  const big = M.positions.filter(p => ["stock", "bond", "note", "alt", "crypto", "other"].includes(p.cls) && p.w >= 0.1).sort((a, b) => b.w - a.w);
  if(big.length) add(big[0].w >= 0.2 ? "high" : "watch", "conc", t("Крупная доля в одной бумаге", "Large share in a single holding"),
    big.slice(0, 4).map(p => `${name(p)} — ${fmt.pct(p.w)} (${money((p.vb || 0) + (p.ab || 0))})`).join("; ") + ".", big.map(p => p.id));
  const cash = M.byCat.find(c => c.key === "cash");
  if(cash && cash.share >= 0.3 && M.positions.length > 2) add("info", "cash", t(`Деньги — ${fmt.pct(cash.share, 0)} портфеля`, `Cash is ${fmt.pct(cash.share, 0)} of the portfolio`),
    t(`${money(cash.value)} на счетах и депозитах.`, `${money(cash.value)} in accounts and deposits.`));
  /* Проданный пут в выписке стоит копейки, а обязывает купить акции по страйку: количество × страйк × множитель контракта.
     Множитель — из самой выписки (стоимость ÷ количество ÷ цена), иначе 100, как у опционов на акции США. */
  const puts = M.positions.filter(p => p.cls === "option" && p.right === "P" && p.qty < 0 && p.strike > 0);
  if(puts.length){
    const rate = p => p.value && p.vb != null ? p.vb / p.value : (p.ccy === base ? 1 : null);
    const mult = p => { const k = p.qty && p.price && p.value ? Math.abs(p.value / (p.qty * p.price)) : 0; const m = [1, 10, 100, 1000].find(x => Math.abs(k - x) / x < 0.05); return m || 100; };
    const ob = puts.map(p => ({p, v: Math.abs(p.qty) * p.strike * mult(p) * (rate(p) ?? NaN)})).filter(x => isFinite(x.v));
    const sum = ob.reduce((s, x) => s + x.v, 0);
    if(sum > 0){
      const insts = [...new Set(ob.map(x => x.p.inst))];
      const cashThere = M.positions.filter(p => p.cls === "cash" && insts.includes(p.inst)).reduce((s, p) => s + (p.vb || 0), 0);
      const k = cashThere > 0 ? sum / cashThere : null;
      add(k == null || k > 1 ? "high" : "watch", "puts", t(`Проданные путы обязывают купить акций на ${money(sum)}`, `Sold puts commit you to buy ${money(sum)} of stock`),
        t(`В выписке они стоят ${money(ob.reduce((s, x) => s + (x.p.vb || 0), 0))}, но при исполнении придётся купить бумаги по страйку`, `On the statement they are worth ${money(ob.reduce((s, x) => s + (x.p.vb || 0), 0))}, but if exercised the shares must be bought at the strike`)
        + (k != null ? t(` — это ${k >= 1 ? fmt.num(k, 1) + " раза больше" : fmt.pct(k, 0) + " от"} денег на счёте (${money(cashThere)}).`, ` — ${k >= 1 ? fmt.num(k, 1) + " times" : fmt.pct(k, 0) + " of"} the cash in the account (${money(cashThere)}).`) : ".")
        + " " + ob.sort((a, b) => b.v - a.v).slice(0, 4).map(x => `${name(x.p)}: ${money(x.v)}`).join("; ") + (ob.length > 4 ? "…" : ""), ob.map(x => x.p.id));
    }
  }
  const soon = M.timeline.filter(x => x.days >= 0 && ((["option", "future"].includes(x.p.cls) && x.days <= 45) || (!["option", "future"].includes(x.p.cls) && x.days <= 90)));
  const opts = soon.filter(x => ["option", "future"].includes(x.p.cls)), mats = soon.filter(x => !["option", "future"].includes(x.p.cls));
  if(opts.length) add("watch", "expiry", t(`${opts.length} ${WL.pl(opts.length, ["опцион истекает", "опциона истекают", "опционов истекают"], ["option expires", "options expire"])} в ближайшие 45 дней`, `${opts.length} ${WL.pl(opts.length, ["", "", ""], ["option expires", "options expire"])} within 45 days`),
    opts.slice(0, 5).map(x => `${name(x.p)} — ${fmt.date(x.p.date)}, ${t("через", "in")} ${x.days} ${WL.pl(x.days, ["день", "дня", "дней"], ["day", "days"])}${x.p.qty < 0 ? t(" (продан)", " (short)") : ""}`).join("; ") + (opts.length > 5 ? "…" : "."), opts.map(x => x.p.id));
  if(mats.length){ const sum = mats.reduce((s, x) => s + (x.p.vb || 0), 0);
    add("info", "maturity", t(`Погашения в ближайшие 90 дней: ${money(sum)}`, `Maturities within 90 days: ${money(sum)}`),
      mats.slice(0, 5).map(x => `${name(x.p)} — ${fmt.date(x.p.date)}`).join("; ") + (mats.length > 5 ? "…" : "."), mats.map(x => x.p.id)); }
  const zero = M.positions.filter(p => p.cls !== "cash" && (p.value === 0 || p.value == null));
  if(zero.length) add("info", "zero", t(`${zero.length} ${WL.pl(zero.length, ["позиция", "позиции", "позиций"], ["position", "positions"])} без стоимости`, `${zero.length} ${WL.pl(zero.length, ["", "", ""], ["position", "positions"])} with no value`),
    zero.slice(0, 5).map(name).join("; ") + t(" — в выписке стоимость нулевая или не указана.", " — the statement shows no value."), zero.map(p => p.id));
  const old = M.docs.filter(d => d.use && d.as_of && fmt.days(d.as_of) < -60);
  if(old.length) add("watch", "stale", t("Данные устарели", "Outdated statements"),
    old.map(d => `${d.institution || d.file} — ${t("на", "as of")} ${fmt.date(d.as_of)}`).join("; ") + t(". Загрузите свежие выписки.", ". Upload recent statements."), old.map(d => d.id));
  if(M.dates.length > 1 && (Date.parse(M.dates[M.dates.length - 1]) - Date.parse(M.dates[0])) / 864e5 > 31)
    add("info", "dates", t("Выписки на разные даты", "Statements from different dates"), t(`С ${fmt.date(M.dates[0])} по ${fmt.date(M.dates[M.dates.length - 1])} — итог складывает состояния счетов на разные даты.`,
      `From ${fmt.date(M.dates[0])} to ${fmt.date(M.dates[M.dates.length - 1])} — the total adds up accounts as of different dates.`));
  const guess = M.positions.filter(p => p.ccyGuess && p.value);
  if(guess.length) add("info", "ccy-guess", t("Валюта части позиций не указана", "Currency not shown for some positions"),
    t(`${guess.length} ${WL.pl(guess.length, ["позиция посчитана", "позиции посчитаны", "позиций посчитано"], ["", "", ""])} в валюте выписки.`, `${guess.length} ${guess.length === 1 ? "position is" : "positions are"} counted in the statement currency.`), guess.map(p => p.id));
  const order = {high: 0, watch: 1, info: 2};
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/* Данные отчёта для сводки ИИ: сводка, выписки со сверкой, позиции (до 700 крупнейших), автоматические предупреждения. */
WL.compact = (M, S, opts = {}) => {
  const r2 = v => v == null ? null : Math.round(v * 100) / 100;
  const ps = M.positions.slice().sort((a, b) => Math.abs((b.vb || 0)) - Math.abs((a.vb || 0)));
  const keep = new Set(opts.keep || []);                     // позиции, которые нужны всегда (тема разговора)
  const top = ps.filter((p, i) => i < 700 || keep.has(p.id)), rest = ps.filter((p, i) => i >= 700 && !keep.has(p.id));
  return {
    report_currency: M.base, total: r2(M.total), accrued_interest_included: r2(M.accrued), today: WL.today(),
    categories: M.byCat.map(c => ({category: c.label, value: r2(c.value), share: r2(c.share * 100)})),
    currencies: M.byCcy.map(c => ({currency: c.ccy, value: r2(c.value), share: r2(c.share * 100)})),
    documents: M.docs.map(d => ({id: d.id, file: d.file, institution: d.institution, type: d.type, as_of: d.as_of, reference_currency: d.ref_ccy,
      included: d.use, excluded_reason: d.use ? undefined : d.why, accounts: d.accounts.map(a => a.id + (a.label ? " " + a.label : "")),
      positions: d.positions, value_in_report_currency: r2(d.value), pages: d.pageCount, unread_pages: (d.failed || []).map(f => `${f.from}-${f.to}`),
      summary_rows_ignored: d.summaryDropped || 0, reconciliation: d.recon ? {status: d.recon.status, checks: d.recon.checks.map(c => ({label: c.label, scope: c.scope,
        currency: c.ccy, statement: r2(c.amount), positions: r2(c.sum), positions_with_accrued: r2(c.sumAcc), matched: c.ok, via_fx: c.approx}))} : undefined,
      reader_notes: d.notes})),
    positions: top.map(p => ({id: p.id, doc: p.doc, class: p.cls, name: p.name, isin: p.isin || undefined, ticker: p.ticker || undefined, qty: p.qty ?? undefined,
      price: p.price ?? undefined, price_in_percent: p.unit === "%" || undefined, value: r2(p.value), currency: p.ccy, value_report_ccy: r2(p.vb),
      accrued_report_ccy: p.ab ? r2(p.ab) : undefined, weight_pct: r2(p.w * 100), date: p.date || undefined, coupon: p.coupon ?? undefined,
      option: p.right ? `${p.right} ${p.strike ?? ""} ${p.under || ""}`.trim() : undefined, cost: p.cost ?? undefined, account: p.acct || undefined, institution: p.inst})),
    positions_not_listed: rest.length ? {count: rest.length, value: r2(rest.reduce((s, p) => s + (p.vb || 0), 0))} : undefined,
    automatic_alerts_already_shown: M.alerts.map(a => ({level: a.level, title: a.title})),
    market: M.mkt ? {as_of: M.mkt.at, value_now: r2(M.mkt.nowTotal), repriced_share_of_whole_portfolio_pct: r2(M.mkt.coverage * 100),
      listed_part_change_pct: Object.fromEntries(Object.entries(M.mkt.perf).filter(([, v]) => v && v.pct != null).map(([k, v]) => [k, r2(v.pct * 100)])),
      whole_portfolio_change_pct: Object.fromEntries(Object.entries(M.mkt.perf).filter(([, v]) => v && v.whole != null).map(([k, v]) => [k, r2(v.whole * 100)])),
      benchmarks: M.mkt.benchmarks.filter(b => b.perf).map(b => ({name: b.label, change_pct: {"1m": b.perf["1m"], "ytd": b.perf.ytd, "1y": b.perf["1y"], "5y": b.perf["5y"]}})),
      positions: M.positions.filter(p => p.mk || p.underQ).slice(0, 300).map(p => ({id: p.id, price_now: p.mk ? p.mk.price : undefined, value_now_report_ccy: p.nowB != null ? r2(p.nowB) : undefined,
        change_1d_pct: p.mk ? p.mk.change : undefined, change_1m_pct: p.mk && p.mk.perf ? p.mk.perf["1m"] : undefined, change_1y_pct: p.mk && p.mk.perf ? p.mk.perf["1y"] : undefined,
        underlying: p.underQ ? {name: p.underQ.name, level: p.underQ.price, change_1m_pct: p.underQ.perf["1m"], change_1y_pct: p.underQ.perf["1y"]} : p.mk && p.mk.underlying ? {price: p.mk.underlying} : undefined}))} : undefined,
  };
};
})();
