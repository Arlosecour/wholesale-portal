/* ===== Commission ledger — shared by the server (Apps Script) and the portal preview =====
   Rules (Sales Rep Agreement §4, Compensation Framework; the Agreement governs where they differ):
   • Commission on invoices paid in full, base = product subtotal after discounts, less refunds, before shipping & tax.
     Opening order 15%. Reorders 10% (year one, and after year one while the account is in good standing; house accounts earn nothing).
     Each line goes on the statement paid on the 1st of the month after the invoice was paid.
   • Year-one bonuses (first 12 months after the opening order, invoice paid in full, account not a house account):
     Fast Reorder $150 — 2nd order placed AND paid within 45 days of the opening order.
     Loyal Account $250 — 4 orders (opening counts) placed & paid in year one, OR $3,500 of paid reorders (opening excluded), whichever first.
     Account Quality — paid reorders in year one: $5,000 → $200, $8,000 → $400, $12,000 → $750 (replace-up: paid as top-ups).
   • After year one: good standing = 2 paid reorders in the prior 12 months + a touchpoint every quarter (shown, not enforced:
     converting to a house account follows the review process in §6.1 and is set by Arlo Secour on the Rep Accounts tab).
   • Welcome bonus $1,000 on signing.
   Paid status: commission is paid when its invoice was paid on/before the rep's "Paid through" date (or listed on Payouts).
   Bonuses are paid only when listed on the Payouts tab; an unpaid bonus from a past month carries to the next statement. */
function rpLedger_(inp){
  var r2 = function(n){ return Math.round((+n || 0) * 100) / 100; };
  var P = function(s){ s = String(s).slice(0, 10).split('-'); return new Date(+s[0], +s[1] - 1, +s[2]); };
  var I = function(d){ return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  var addD = function(s, n){ var d = P(s); d.setDate(d.getDate() + n); return I(d); };
  var addM = function(s, n){ var d = P(s); d.setMonth(d.getMonth() + n); return I(d); };
  var stmtOf = function(ymd){ return addM(ymd.slice(0, 7) + '-01', 1); };   /* invoice paid in Oct → Nov 1 statement */
  var today = inp.today, rep = inp.rep || {}, pt = rep.paidThrough || '';
  var paidKeys = {}; (inp.payouts || []).forEach(function(p){ paidKeys[p.key] = p; });
  /* next statement that hasn't been paid: the one after "paid through" (Sep 30 → Nov 1, covering October) */
  var nextStmt = pt ? addM(addD(pt, 1).slice(0, 7) + '-01', 1) : stmtOf(today);
  var lines = [], progress = {};
  var base = function(o){ var b = r2(Math.min(+o.subtotal || 0, (o.origSubtotal != null ? +o.origSubtotal : +o.subtotal || 0) - (+o.refunded || 0))); return b > 0 ? b : 0; };
  var push = function(l){
    l.amount = r2(l.amount);
    var po = paidKeys[l.key];
    l.paid = !!po || (l.type === 'commission' && !!pt && l.date <= pt);
    l.paidOn = po ? po.paidOn : (l.paid ? stmtOf(l.date) : '');
    l.statement = stmtOf(l.date);
    if (!l.paid && l.statement < nextStmt){ l.carried = l.statement; l.statement = nextStmt; }
    lines.push(l);
  };
  if (rep.signed) push({type: 'bonus', key: 'WELCOME', label: 'Welcome bonus', date: rep.signed, amount: 1000});

  (inp.accts || []).forEach(function(x){
    var a = x.acct, from = x.from || '', to = x.to || '', house = String(x.standing || a.standing || '').toLowerCase() === 'house';
    var all = (a.orders || []).filter(function(o){ return !o.cancelled; }).slice().sort(function(p, q){ return p.placed < q.placed ? -1 : p.placed > q.placed ? 1 : 0; });
    if (!all.length){ progress[a.id] = {orders: 0}; return; }
    var open = all[0], yEnd = addM(open.placed, 12), yEndLast = addD(yEnd, -1);
    var mine = function(o){ return (!from || o.placed >= from) && (!to || o.placed <= to); };
    all.forEach(function(o){
      if (!o.paid || !mine(o)) return;
      var b = base(o); if (!b) return;
      var isOpen = o.id === open.id, yr1 = o.placed < yEnd;
      if (!isOpen && !yr1 && house) return;
      var rate = isOpen ? 0.15 : 0.10;
      push({type: 'commission', key: 'C|' + o.id, acct: a.id, company: a.name, orderId: o.id, order: o.name, date: o.paid, placed: o.placed, base: b, rate: rate, amount: b * rate,
        label: (isOpen ? 'Opening order' : yr1 ? 'Reorder' : 'Reorder (year 2+)')});
    });
    /* year-one bonuses */
    var py = all.filter(function(o){ return o.paid && o.placed < yEnd && o.paid < yEnd && mine(o) && base(o) > 0; });
    var byPaid = py.slice().sort(function(p, q){ return p.paid < q.paid ? -1 : p.paid > q.paid ? 1 : 0; });
    var fastBy = addD(open.placed, 45), second = all[1];
    var fast = {deadline: fastBy, status: 'open'};
    if (second && second.placed <= fastBy && second.paid && second.paid <= fastBy && mine(second)) { fast.status = 'earned'; fast.date = second.paid; fast.order = second.name; }
    else if ((second && second.placed > fastBy) || today > fastBy || (second && second.paid && second.paid > fastBy)) fast.status = 'missed';
    else if (second){ fast.status = 'waiting'; fast.order = second.name; }
    /* loyal: 4th paid order, or $3,500 of paid reorders */
    var loyal = {status: today >= yEnd ? 'missed' : 'open', need: 4, reNeed: 3500}, cum = 0, cnt = 0, qual = {reorders: 0, tiers: []};
    var TIERS = [[5000, 200, 'Tier 1 — Established'], [8000, 400, 'Tier 2 — Strong'], [12000, 750, 'Tier 3 — Elite']], tierPaid = 0;
    byPaid.forEach(function(o){
      cnt++;
      if (o.id !== open.id) cum = r2(cum + base(o));
      if (loyal.status !== 'earned' && (cnt >= 4 || cum >= 3500)){ loyal.status = 'earned'; loyal.date = o.paid; loyal.order = o.name; loyal.via = cnt >= 4 ? 'orders' : 'reorders'; }
      TIERS.forEach(function(t, i){ if (cum >= t[0] && qual.tiers.indexOf(i) < 0){ qual.tiers.push(i); push({type: 'bonus', key: 'QUALITY' + (i + 1) + '|' + a.id, acct: a.id, company: a.name, label: 'Account Quality ' + t[2] + (tierPaid ? ' (top-up from ' + ('$' + tierPaid) + ')' : ''), date: o.paid, amount: t[1] - tierPaid, order: o.name}); tierPaid = t[1]; } });
    });
    loyal.orders = cnt; loyal.reorders = cum; qual.reorders = cum;
    var nextT = TIERS.filter(function(t){ return cum < t[0]; })[0];
    qual.next = nextT ? {at: nextT[0], bonus: nextT[1], name: nextT[2], left: r2(nextT[0] - cum)} : null;
    qual.tier = qual.tiers.length ? TIERS[qual.tiers[qual.tiers.length - 1]][2] : '';
    if (!house){
      if (fast.status === 'earned') push({type: 'bonus', key: 'FAST|' + a.id, acct: a.id, company: a.name, label: 'Fast Reorder bonus', date: fast.date, amount: 150, order: fast.order});
      if (loyal.status === 'earned') push({type: 'bonus', key: 'LOYAL|' + a.id, acct: a.id, company: a.name, label: 'Loyal Account bonus', date: loyal.date, amount: 250, order: loyal.order});
    } else lines = lines.filter(function(l){ return !(l.type === 'bonus' && l.acct === a.id && !l.paid); });
    /* good standing after year one: 2 paid reorders in the prior 12 months + quarterly touchpoints */
    var since = addM(today, -12), re12 = all.filter(function(o){ return o.id !== open.id && o.paid && o.paid > since && o.paid <= today; }).length;
    progress[a.id] = {opening: open.name, openingDate: open.placed, yearEnd: yEndLast, inYearOne: today < yEnd, fast: fast, loyal: loyal, quality: qual,
      reorders12: re12, standingOk: re12 >= 2, house: house};
  });

  /* statements */
  var by = {};
  lines.forEach(function(l){ (by[l.statement] = by[l.statement] || []).push(l); });
  var statements = Object.keys(by).sort().reverse().map(function(d){
    var ls = by[d].sort(function(p, q){ return p.type !== q.type ? (p.type === 'commission' ? -1 : 1) : p.date < q.date ? -1 : 1; });
    var tot = r2(ls.reduce(function(s, l){ return s + l.amount; }, 0)), allPaid = ls.every(function(l){ return l.paid; });
    return {date: d, covers: addM(d, -1).slice(0, 7), lines: ls, total: tot, commission: r2(ls.filter(function(l){ return l.type === 'commission'; }).reduce(function(s, l){ return s + l.amount; }, 0)),
      bonuses: r2(ls.filter(function(l){ return l.type === 'bonus'; }).reduce(function(s, l){ return s + l.amount; }, 0)),
      status: allPaid ? 'paid' : d > today ? (addM(d, -1) <= today ? 'building' : 'upcoming') : 'due'};
  });
  var unpaidLines = lines.filter(function(l){ return !l.paid; });
  var waiting = [];
  (inp.accts || []).forEach(function(x){
    var a = x.acct, all = (a.orders || []).filter(function(o){ return !o.cancelled; }).sort(function(p, q){ return p.placed < q.placed ? -1 : 1; });
    all.forEach(function(o, i){ if (!o.paid && (!x.from || o.placed >= x.from) && (!x.to || o.placed <= x.to)){ var b = base(o); waiting.push({acct: a.id, company: a.name, orderId: o.id, order: o.name, placed: o.placed, base: b, rate: i === 0 ? 0.15 : 0.10, amount: r2(b * (i === 0 ? 0.15 : 0.10))}); } });
  });
  var yr = today.slice(0, 4);
  return {today: today, paidThrough: pt, nextStatement: nextStmt, lines: lines, statements: statements, progress: progress, waiting: waiting,
    owed: r2(unpaidLines.reduce(function(s, l){ return s + l.amount; }, 0)),
    paidYtd: r2(lines.filter(function(l){ return l.paid && (l.paidOn || '').slice(0, 4) === yr; }).reduce(function(s, l){ return s + l.amount; }, 0)),
    earnedAll: r2(lines.reduce(function(s, l){ return s + l.amount; }, 0))};
}

/* ===== Arlo Secour · Wholesale portal — runs inside the Shopify admin (embedded app) =====
   Read-only towards Shopify. Orders, companies and customers are entered in Shopify itself.
   Who is signed in comes from Shopify: App Bridge gives a session token, the server (Apps Script) checks it
   with the app's secret and only answers for that rep's companies.
   Views: home · companies · company · location · customers · customer · orders · order · touch · sales · earnings · notices
   Preview: open with ?preview=1 (or file://) — sample data from window.__RP_SNAP, every save is mocked. */
(function(){
"use strict";
const CFG = window.RP_CONFIG || {};
const PV = !!window.__RP_SNAP && (location.protocol === "file:" || /[?&]preview=1/.test(location.search) || !window.shopify);
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- money + dates ---------- */
const money = n => { n = Math.round((+n || 0) * 100) / 100; return "$" + n.toLocaleString("en-US", {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2}); };
const money2 = n => "$" + (+n || 0).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const D = s => { if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate()); const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const fd = s => { const d = D(s); return MON[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear(); };
const fdt = s => { const d = D(s), t = D(TODAY); return MON[d.getMonth()] + " " + d.getDate() + (d.getFullYear() !== t.getFullYear() ? ", " + d.getFullYear() : ""); };
const ftime = s => { const d = new Date(s); return isNaN(d) ? fdt(s) : fdt(iso(d)) + " at " + d.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"}).toLowerCase(); };
const days = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
const addMonths = (s, n) => { const d = D(s); d.setMonth(d.getMonth() + n); return iso(d); };
let TODAY = iso(new Date());
const qOf = s => { const d = D(s), q = Math.floor(d.getMonth() / 3); return {y: d.getFullYear(), q: q + 1, key: d.getFullYear() + "-Q" + (q + 1), start: iso(new Date(d.getFullYear(), q * 3, 1)), end: iso(new Date(d.getFullYear(), q * 3 + 3, 0))}; };
const qPrev = k => { let [y, q] = k.split("-Q").map(Number); q--; if (!q){ q = 4; y--; } return qOf(iso(new Date(y, (q - 1) * 3, 1))); };
const uid = p => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const initials = s => String(s).split(/\s+/).filter(w => /[a-z0-9]/i.test(w)).slice(0, 2).map(w => w[0]).join("").toUpperCase();

/* ---------- icons ---------- */
const IC = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  store: '<path d="M4 9h16l-1.2-4.2A1 1 0 0 0 17.8 4H6.2a1 1 0 0 0-1 .8z"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  dollar: '<path d="M12 3v18M16.5 7.5c-.8-1.3-2.5-2-4.5-2-2.5 0-4.5 1.3-4.5 3.2 0 4.3 9.5 2.3 9.5 6.6 0 1.9-2.1 3.2-4.8 3.2-2.2 0-4-.8-4.8-2.2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5"/><path d="M20 3.5v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5"/><path d="M4 20.5v-5h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.4"/>',
  alert: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.3v.3"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="m9 6 6 6-6 6"/>'
};
const ic = n => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + IC[n] + "</svg>";

/* ---------- state ---------- */
const S = {data: null, err: "", view: "home", hist: [], acct: null, locId: null, custId: null, okey: null, oFilter: "all", tForm: null, tErr: {}, sMode: "placed", sYear: null, busy: false, lRep: null, mpConfirm: null, stOpen: null};
const NAV = [["home", "Home"], ["companies", "Companies"], ["customers", "Customers"], ["orders", "Orders"], ["touch", "Touchpoints"], ["sales", "Sales"], ["earnings", "Earnings"]];

/* ---------- server ---------- */
const wait = ms => new Promise(r => setTimeout(r, ms));
async function token(){
  if (!window.shopify || !shopify.idToken) throw new Error("Open the portal from your Shopify admin (Apps › Wholesale Portal).");
  return await shopify.idToken();
}
async function api(action, body){
  if (PV) return mock(action, body || {});
  const t = await token();
  const r = await fetch(CFG.server, {method: "POST", body: JSON.stringify(Object.assign({action, token: t}, body || {}))});
  let j; try{ j = await r.json(); }catch(_){ throw new Error("The portal server didn’t answer. Try again in a minute."); }
  if (!j.ok) throw Object.assign(new Error(j.error || "Something went wrong"), {code: j.code});
  return j;
}
async function mock(action, b){
  await wait(action === "load" ? 120 : 350);
  if (action === "load"){
    const d = Object.assign({ok: true}, JSON.parse(JSON.stringify(window.__RP_SNAP)));
    if (!d.ledger && !d.ledgers && typeof rpLedger_ === "function") d.ledger = rpLedger_({today: d.today, rep: {paidThrough: d.paidThrough, signed: d.signed}, payouts: d.payouts || [], accts: d.accounts.map(a => ({acct: a, from: a.assigned, standing: a.standing}))});
    return d;
  }
  if (action === "markPaid") return {ok: true, paidThrough: ""};
  if (action === "touch") return {ok: true, touch: Object.assign({}, b.touch, {id: uid("T"), at: new Date().toISOString(), by: S.data.me.name})};
  if (action === "noticesRead" || action === "prefs") return {ok: true};
  return {ok: false, error: "Unknown action"};
}

/* ---------- Shopify admin links (open the real record in Shopify) ---------- */
const adminUrl = path => PV ? "https://admin.shopify.com/store/" + (S.data.shop.handle || "") + "/" + path : "shopify://admin/" + path;
const gidNum = g => String(g || "").split("/").pop();
const aLink = (path, label, cls) => '<a class="' + (cls || "btn out") + '" href="' + esc(adminUrl(path)) + '" target="_top">' + label + "</a>";
const openOrder = o => aLink("orders/" + o.id, ic("ext") + "Open in Shopify");

/* ---------- derived data ---------- */
const acctOf = id => S.data.accounts.find(a => a.id === id);
const orderNet = o => (+o.subtotal || 0) - (+o.refunded || 0);
function stats(a){
  const os = a.orders.filter(o => !o.cancelled).slice().sort((x, y) => x.placed < y.placed ? -1 : 1);
  const open = os.find(o => o.opening) || os[0];
  const re = os.filter(o => o !== open);
  const gaps = []; for (let i = 1; i < os.length; i++) gaps.push(days(os[i - 1].placed, os[i].placed));
  const avg = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null;
  const last = os[os.length - 1], y = TODAY.slice(0, 4);
  return {orders: os, open, re, last, avgGap: avg, next: last && avg ? addDays(last.placed, avg) : null,
    life: os.reduce((s, o) => s + orderNet(o), 0), reTotal: re.reduce((s, o) => s + orderNet(o), 0),
    ytd: os.filter(o => o.placed.slice(0, 4) === y).reduce((s, o) => s + orderNet(o), 0),
    yearEnd: open ? addMonths(open.placed, 12) : null, unpaid: os.filter(o => !o.paid)};
}
const touchesOf = id => S.data.touchpoints.filter(t => t.acct === id).sort((a, b) => a.date < b.date ? 1 : -1);
function quarters(a){
  const portalStart = S.data.portalStart || TODAY, cur = qOf(TODAY), first = qOf(a.assigned || a.since), out = [];
  let q = cur;
  while (out.length < 4){ out.unshift(q); if (q.key === first.key) break; q = qPrev(q.key); }
  return out.map(q => {
    const hit = S.data.touchpoints.filter(t => t.acct === a.id && t.date >= q.start && t.date <= q.end);
    const st = hit.length ? "ok" : q.key === cur.key ? "due" : q.end < portalStart ? "pre" : "miss";
    return Object.assign({}, q, {st, n: hit.length, left: days(TODAY, q.end)});
  });
}
const curQ = a => quarters(a).slice(-1)[0];
function allOrders(){
  const out = [];
  S.data.accounts.forEach(a => a.orders.forEach(o => out.push({o, acct: a, date: o.placed, total: orderNet(o)})));
  return out.sort((x, y) => x.date < y.date ? 1 : -1);
}
const cName = c => ((c.first || "") + " " + (c.last || "")).trim() || c.email || "Customer";
function allContacts(){ const out = []; S.data.accounts.forEach(a => a.contacts.forEach(c => out.push({c, a}))); return out; }
function contactOf(id){ for (const a of S.data.accounts){ const c = a.contacts.find(x => x.id === id); if (c) return {c, a}; } return null; }
const locOf = (a, id) => a.locations.find(x => x.id === id);
const locName = (a, id) => { const L = locOf(a, id); return L ? (L.name || (L.ship && L.ship.address1) || "Location") : "—"; };
const custOrders = (c, a) => allOrders().filter(x => x.acct === a && x.o.customer === c.id);
function addrBlock(ad){
  if (!ad || !ad.address1) return '<span class="mut">No address</span>';
  return [((ad.first || "") + " " + (ad.last || "")).trim(), ad.company, ad.address1, ad.address2, ((ad.city || "") + " " + (ad.zone || "") + " " + (ad.zip || "")).replace(/\s+/g, " ").trim(), ad.country === "CA" ? "Canada" : "United States", ad.phone].filter(Boolean).map(esc).join("<br>");
}
const addrLine = ad => !ad || !ad.address1 ? "" : [ad.address1 + (ad.address2 ? ", " + ad.address2 : ""), ad.city, ((ad.zone || "") + " " + (ad.zip || "")).trim()].filter(Boolean).join(", ");
const TAX = {collect: "Collect tax", exempt: "Collect tax unless exemptions apply", none: "Don't collect tax"};
const taxLine = L => (TAX[L.tax] || TAX.collect) + (L.tax === "exempt" && L.exemptions && L.exemptions.length ? " · " + L.exemptions.map(e => e.replace(/^US_(..)_RESELLER_EXEMPTION$/, "$1 reseller")).join(", ") : "");
const checkoutLines = L => (L.anyAddress ? "Ship to any address" : "Ship to location address") + "<br>" + (L.toDraft ? "Submit all orders as drafts for review" : "Automatically submit orders");
/* commission estimate (stage 2 replaces this with the full ledger): 15% opening order, 10% reorders, on the net amount */
const isOpening = (o, a) => { const st = stats(a); return st.open && st.open.id === o.id; };
const estRate = (o, a) => isOpening(o, a) ? 0.15 : 0.10;
/* the commission ledger (built by the server with the same rules as src/ledger.js) */
function ledger(){ const d = S.data; if (d.ledger) return d.ledger; if (d.ledgers && d.reps && d.reps.length){ const id = S.lRep && d.ledgers[S.lRep] ? S.lRep : d.reps[0].staffId; return d.ledgers[id] || null; } return null; }
const lineOf = id => { const L = ledger(); return L ? L.lines.find(l => l.key === "C|" + id) : null; };
const nextSt = L => L ? L.statements.find(x => x.date === L.nextStatement) : null;
const stBadge = st => st.status === "paid" ? bd("Paid", "ok") : st.status === "building" ? bd("In progress", "info") : st.status === "due" ? bd("Due", "warn") : bd("Upcoming", "nodot");

/* ---------- badges + layout helpers ---------- */
const bd = (t, c) => '<span class="bd ' + (c || "") + '">' + t + "</span>";
const payBadge = o => o.cancelled ? bd("Cancelled", "bad") : o.refunded && o.refunded >= o.subtotal ? bd("Refunded") : o.refunded ? bd("Partially refunded", "att") : o.paid ? bd("Paid") : bd("Payment pending", "att half");
const fulBadge = o => o.cancelled ? "" : o.fulfilled ? bd("Fulfilled") : bd("Unfulfilled", "warn ring");
const standingBadge = a => a.standing === "house" ? bd("House account") : a.standing === "review" ? bd("Under review", "bad") : a.standing === "reminder" ? bd("Reminder sent", "att") : bd("Good standing", "ok");
const met = (k, v, s) => '<div class="met"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s || "&nbsp;") + "</div></div>";
const sec = (title, acts, body) => '<div class="sec"><div class="sh"><h2>' + title + "</h2>" + (acts || "") + "</div>" + body + "</div>";
const aside = (title, body, act) => '<div class="aside-s"><div class="ah"><h3>' + title + "</h3>" + (act || "") + "</div>" + body + "</div>";
const img = src => src ? '<img class="thumb" src="' + esc(src) + '" alt="" loading="lazy">' : '<span class="thumb"></span>';
const back = (label) => '<div class="bc"><button class="back" data-back="1" aria-label="Back">' + ic("left") + '</button><span class="crumb">' + esc(label) + "</span></div>";
const ph = (title, badges, acts, sub) => '<div class="ph"><h1>' + title + "</h1>" + (badges || "") + '<div class="acts">' + (acts || "") + "</div>" + (sub ? '<div class="sub">' + sub + "</div>" : "") + "</div>";

/* ---------- shell ---------- */
function unread(){ return S.data ? S.data.notices.filter(n => !n.read).length : 0; }
function shell(){
  const n = unread(), v = S.view;
  const on = k => (k === v || (k === "companies" && (v === "company" || v === "location")) || (k === "customers" && v === "customer") || (k === "orders" && v === "order") || (k === "earnings" && v === "earnco")) ? " on" : "";
  $("rpTop").innerHTML = '<div class="tb"><div class="brand"><span class="logo">AS</span><span><b>Wholesale portal</b><span>' + esc(S.data ? S.data.me.name : "") + "</span></span></div>" +
    '<nav class="navtabs" aria-label="Portal">' + NAV.map(x => '<button data-go="' + x[0] + '" class="' + on(x[0]) + '">' + x[1] + "</button>").join("") + "</nav>" +
    '<button class="bell' + on("notices") + '" data-go="notices" aria-label="Notifications">' + ic("bell") + (n ? '<span class="dot">' + n + "</span>" : "") + "</button></div>";
  $("rpPv").classList.toggle("hide", !PV);
}
function render(){
  shell();
  const m = $("rpMain");
  if (!S.data){ m.innerHTML = '<div class="pg">' + (S.err ? '<div class="card empty"><b>' + (S.errCode === "not_rep" ? "You’re not set up for the portal yet" : "Couldn’t load the portal") + "</b>" + esc(S.err) + (S.errCode === "not_rep" ? "" : '<div style="margin-top:12px"><button class="btn pri" data-reload="1">Try again</button></div>') + "</div>" : '<div class="empty">Loading…</div>') + "</div>"; return; }
  const V = {home: vHome, companies: vCompanies, company: vCompany, location: vLocation, customers: vCustomers, customer: vCustomer, orders: vOrders, order: vOrder, touch: vTouch, sales: vSales, earnings: vEarnings, earnco: vEarnCo, notices: vNotices}[S.view] || vHome;
  m.innerHTML = V();
}
function go(view, opt){
  opt = opt || {};
  if (!opt.isBack && S.view !== view) S.hist.push({view: S.view, acct: S.acct, locId: S.locId, custId: S.custId, okey: S.okey});
  if (S.hist.length > 30) S.hist.shift();
  ["acct", "locId", "custId", "okey"].forEach(k => { if (opt[k] !== undefined) S[k] = opt[k]; });
  if (view === "touch" && opt.acctForTouch){ S.tForm = blankTouch(opt.acctForTouch); S.tErr = {}; }
  S.view = view; render(); window.scrollTo(0, 0);
  if (view === "notices" && S.data && unread()){
    const ids = S.data.notices.filter(n => !n.read).map(n => n.id);
    setTimeout(() => { S.data.notices.forEach(n => { if (ids.includes(n.id)) n.read = true; }); shell(); }, 1500);
    api("noticesRead", {ids}).catch(() => {});
  }
}
function goBack(){ const h = S.hist.pop(); if (!h){ go("home", {isBack: true}); return; } Object.assign(S, {acct: h.acct, locId: h.locId, custId: h.custId, okey: h.okey}); go(h.view, {isBack: true}); }

/* ---------- home ---------- */
function vHome(){
  const me = S.data.me, h = new Date().getHours();
  const hi = (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening") + ", " + esc(me.first || me.name);
  const mo = TODAY.slice(0, 7), y = TODAY.slice(0, 4), all = allOrders().filter(x => !x.o.cancelled);
  const mth = all.filter(x => x.o.placed.slice(0, 7) === mo), ytd = all.filter(x => x.o.placed.slice(0, 4) === y);
  const pt = S.data.paidThrough, pend = all.filter(x => x.o.paid && (!pt || x.o.paid > pt));
  const pendEst = pend.reduce((s, x) => s + x.total * estRate(x.o, x.acct), 0);
  const todo = [];
  S.data.accounts.forEach(a => {
    const q = curQ(a), st = stats(a);
    if (q.st === "due") todo.push({ic: "chat", c: q.left <= 21 ? "warn" : "", t: "Log your Q" + q.q + " touchpoint for " + esc(a.name), s: "Due by " + fd(q.end) + " · " + q.left + " days left", b: '<button class="btn" data-tp="' + esc(a.id) + '">Log touchpoint</button>'});
    if (st.next && days(TODAY, st.next) <= 10) todo.push({ic: "repeat", c: "info", t: esc(a.name) + " is due to reorder", s: "Reorders about every " + st.avgGap + " days · last order " + fdt(st.last.placed) + " · next expected around " + fdt(st.next), b: aLink("draft_orders/new", "Create order in Shopify", "btn")});
    st.unpaid.forEach(o => todo.push({ic: "dollar", c: "att", t: esc(o.name) + " from " + esc(a.name) + " isn’t paid yet", s: money2(orderNet(o)) + " · placed " + fdt(o.placed) + " · commission waits until it’s paid in full", b: '<button class="btn" data-order="' + esc(o.id) + '">View</button>'}));
  });
  const recentN = S.data.notices.slice(0, 3);
  return '<div class="pg">' + ph(hi, "", '<button class="btn out" data-go="touch">Log touchpoint</button>' + aLink("draft_orders/new", "Create order in Shopify", "btn pri"), esc(D(TODAY).toLocaleDateString("en-US", {weekday: "long", month: "long", day: "numeric", year: "numeric"}))) +
    '<div class="card sec"><div class="mets">' +
      met(MONL[+mo.slice(5) - 1] + " sales", money2(mth.reduce((s, x) => s + x.total, 0)), plural(mth.length, "order")) +
      met(y + " sales", money2(ytd.reduce((s, x) => s + x.total, 0)), plural(ytd.length, "order")) +
      met("Companies", S.data.accounts.length, S.data.accounts.filter(a => a.standing === "good").length + " in good standing") +
      (ledger() ? (() => { const L = ledger(), ns = nextSt(L); return met("Next statement", money2(ns ? ns.total : 0), "on " + fdt(L.nextStatement) + (ns && ns.bonuses ? " · includes " + money2(ns.bonuses) + " bonus" : "")); })() : met("Next statement", money2(pendEst), pt ? "estimate · paid through " + fdt(pt) : "estimate")) +
    "</div></div>" +
    sec("Things to do", "", '<div class="card">' + (todo.length ? todo.map(t => '<div class="todo"><span class="ico ' + t.c + '">' + ic(t.ic) + '</span><div class="m"><b>' + t.t + '</b><span class="mut">' + t.s + "</span></div>" + t.b + "</div>").join("") : '<div class="empty"><b>You’re all caught up</b>Nothing needs your attention right now.</div>') + "</div>") +
    (recentN.length ? sec("Latest notifications", '<button class="btn plain" data-go="notices">View all</button>', '<div class="card">' + recentN.map(noticeRow).join("") + "</div>") : "") +
    sec("Recent orders", '<button class="btn plain" data-go="orders">View all</button>', '<div class="card">' + ordersTable(allOrders().slice(0, 5), true) + "</div>") +
  "</div>";
}

/* ---------- orders (read-only; open in Shopify) ---------- */
function ordersTable(list, compact){
  if (!list.length) return '<div class="empty"><b>No orders yet</b>Every order from your companies shows up here — ones you enter in Shopify and ones they place online.</div>';
  const cust = x => { const h = x.o.customer && contactOf(x.o.customer); return h ? cName(h.c) : ""; };
  return '<table class="tbl rsp"><thead><tr><th>Order</th>' + (compact ? "" : "<th>PO number</th>") + "<th>Date</th><th>Company</th><th>Payment</th><th>Fulfillment</th><th class=\"r\">Total</th></tr></thead><tbody>" +
    list.map(x => '<tr data-order="' + esc(x.o.id) + '"><td class="b">' + esc(x.o.name) + "</td>" + (compact ? "" : "<td>" + esc(x.o.po || "") + "</td>") + '<td class="mut">' + fdt(x.date) + '</td><td><span class="b" style="font-weight:450">' + esc(x.acct.name) + '</span><span class="two">' + esc(cust(x)) + "</span></td><td>" + payBadge(x.o) + "</td><td>" + fulBadge(x.o) + '</td><td class="r num">' + money2(x.total) + "</td></tr>").join("") + "</tbody></table>" +
    '<div class="mlist">' + list.map(x => '<div class="mrow" data-order="' + esc(x.o.id) + '"><div class="m"><b>' + esc(x.o.name) + '</b> <span class="mut" style="display:inline">· ' + fdt(x.date) + '</span><span class="mut">' + esc(x.acct.name) + '</span></div><div class="e"><b class="num">' + money2(x.total) + "</b>" + payBadge(x.o) + "</div></div>").join("") + "</div>";
}
function vOrders(){
  const all = allOrders();
  const F = [["all", "All"], ["unpaid", "Payment pending"], ["paid", "Paid"], ["unful", "Unfulfilled"]];
  const pass = (x, f) => f === "all" || (f === "unpaid" && !x.o.paid && !x.o.cancelled) || (f === "paid" && !!x.o.paid) || (f === "unful" && !x.o.fulfilled && !x.o.cancelled);
  return '<div class="pg wide">' + ph("Orders", "", aLink("draft_orders/new", "Create order in Shopify", "btn pri"), "Every order from your companies, however it was placed. Every one counts toward your sales.") +
    '<div class="card"><div class="tabs">' + F.map(f => '<button data-of="' + f[0] + '" class="' + (S.oFilter === f[0] ? "on" : "") + '">' + f[1] + (f[0] !== "all" ? ' <span class="mut">' + all.filter(x => pass(x, f[0])).length + "</span>" : "") + "</button>").join("") + "</div>" + ordersTable(all.filter(x => pass(x, S.oFilter))) + "</div></div>";
}
function vOrder(){
  const x = allOrders().find(z => z.o.id === S.okey); if (!x) return vOrders();
  const o = x.o, a = x.acct, units = o.lines.reduce((s, l) => s + l.qty, 0), gross = o.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const total = gross - (+o.discount || 0) + (+o.shipping || 0) + (+o.tax || 0) - (+o.refunded || 0);
  const ch = o.customer && contactOf(o.customer), L = locOf(a, o.loc) || a.locations[0];
  const rate = estRate(o, a), base = orderNet(o);
  return '<div class="pg">' + back("Orders") + ph(esc(o.name), payBadge(o) + fulBadge(o), openOrder(o), fd(o.placed) + (o.opening || isOpening(o, a) ? " · opening order" : "")) +
    '<div class="lay"><div>' +
      '<div class="card sec"><div class="ct-h">' + (o.fulfilled ? bd("Fulfilled") : bd("Unfulfilled", "warn ring")) + "<h3></h3></div>" +
        o.lines.map(l => '<div class="prow">' + img(l.img) + '<div class="nm"><b>' + esc(l.title) + '</b><span class="mut">' + esc(l.sku || "") + '</span></div><div class="pr mut">' + money2(l.price) + " × " + l.qty + '</div><div class="lt">' + money2(l.price * l.qty) + "</div></div>").join("") + "</div>" +
      '<div class="card sec"><div class="ct-h">' + payBadge(o) + '<h3></h3></div><div class="pay">' +
        '<div class="pr2"><span>Subtotal</span><span class="mid mut">' + plural(units, "item") + '</span><span class="r">' + money2(gross) + "</span></div>" +
        (o.discount ? '<div class="pr2"><span>Discount</span><span class="mid"></span><span class="r">−' + money2(o.discount) + "</span></div>" : "") +
        '<div class="pr2"><span>Shipping</span><span class="mid"></span><span class="r">' + money2(o.shipping) + "</span></div>" +
        '<div class="pr2"><span>Taxes</span><span class="mid mut">' + (o.tax ? "" : "None charged") + '</span><span class="r">' + money2(o.tax) + "</span></div>" +
        (o.refunded ? '<div class="pr2"><span>Refunded</span><span class="mid"></span><span class="r">−' + money2(o.refunded) + "</span></div>" : "") +
        '<div class="pr2 tot"><span>Total</span><span class="mid"></span><span class="r">' + money2(total) + " USD</span></div>" +
        '<div class="pr2 div"><span>Paid</span><span class="mid mut">' + (o.paid ? fd(o.paid) : "not yet") + '</span><span class="r">' + money2(o.paid ? total : 0) + "</span></div>" +
      "</div></div>" +
      (() => { const ln = lineOf(o.id), r = ln ? ln.rate : rate, b0 = ln ? ln.base : base;
        return '<div class="card sec"><div class="ct-h"><h3>Commission</h3>' + (ln ? (ln.paid ? bd("Paid", "ok") : bd("Earned", "info")) : o.cancelled ? bd("None", "nodot") : bd("Estimate", "info nodot")) + '</div><div class="pay">' +
        '<div class="pr2"><span>Rate</span><span class="mid mut">' + (isOpening(o, a) ? "opening order" : "reorder") + '</span><span class="r">' + Math.round(r * 100) + "%</span></div>" +
        '<div class="pr2"><span>Commission base</span><span class="mid mut">after discounts and refunds, before shipping &amp; tax</span><span class="r">' + money2(b0) + "</span></div>" +
        '<div class="pr2 tot"><span>' + (ln ? "Commission" : "Estimated commission") + '</span><span class="mid"></span><span class="r">' + money2(ln ? ln.amount : b0 * r) + "</span></div>" +
        '<p class="mut sm" style="margin-top:8px">' + (o.cancelled ? "Cancelled orders don’t earn commission." : ln ? (ln.paid ? "Paid on the " + fd(ln.statement) + " statement." : "Goes on the " + fd(ln.statement) + " statement.") : o.paid ? "Not commissionable." : "Earned once the invoice is paid in full.") + "</p>" +
        '</div></div>'; })() +
    '</div><div class="side-c">' +
      aside("Company", '<p><button class="link" data-acct="' + esc(a.id) + '">' + esc(a.name) + "</button></p>" + (L ? '<p class="mut">' + esc(locName(a, L.id)) + "</p>" : "")) +
      aside("Customer", ch ? '<p><button class="link" data-cust="' + esc(ch.c.id) + '">' + esc(cName(ch.c)) + "</button></p>" + (ch.c.email ? '<p class="mut">' + esc(ch.c.email) + "</p>" : "") : '<p class="mut">—</p>') +
      aside("Shipping address", "<p>" + addrBlock(L && L.ship) + "</p>") +
      (o.po ? aside("PO number", "<p>" + esc(o.po) + "</p>") : "") +
      aside("Notes", '<p class="' + (o.note ? "" : "mut") + '">' + esc(o.note || "No notes") + "</p>") +
      aside("Credited to", "<p>" + esc(S.data.me.name) + '</p><p class="mut sm" style="margin-top:4px">Every order under a company you’re assigned to counts as yours, however it was placed.</p>') +
    "</div></div></div>";
}

/* ---------- companies ---------- */
function vCompanies(){
  const rows = S.data.accounts.map(a => ({a, st: stats(a), q: curQ(a)}));
  return '<div class="pg wide">' + ph("Companies", "", aLink("companies", ic("ext") + "Companies in Shopify"), "The companies assigned to you in Shopify. To add or change a company, use Shopify.") +
    '<div class="card">' + (rows.length ? '<table class="tbl rsp"><thead><tr><th>Company</th><th>Main contact</th><th class="r">Locations</th><th class="r">Orders</th><th class="r">Total sales</th><th>Last order</th><th>Touchpoint</th><th>Standing</th></tr></thead><tbody>' +
      rows.map(r => '<tr data-acct="' + esc(r.a.id) + '"><td><span class="b">' + esc(r.a.name) + '</span><span class="two">' + esc(r.a.externalId || "") + "</span></td><td>" + esc(r.a.contacts[0] ? cName(r.a.contacts[0]) : "—") + '</td><td class="r num">' + r.a.locations.length + '</td><td class="r num">' + r.st.orders.length + '</td><td class="r num">' + money2(r.st.life) + '</td><td class="mut">' + (r.st.last ? fdt(r.st.last.placed) : "—") + "</td><td>" + (r.q.st === "ok" ? bd("Q" + r.q.q + " logged", "ok") : bd("Q" + r.q.q + " due " + fdt(r.q.end), r.q.left <= 21 ? "warn ring" : "ring")) + "</td><td>" + standingBadge(r.a) + "</td></tr>").join("") + "</tbody></table>" +
      '<div class="mlist">' + rows.map(r => '<div class="mrow" data-acct="' + esc(r.a.id) + '"><div class="m"><b>' + esc(r.a.name) + '</b><span class="mut">' + plural(r.st.orders.length, "order") + " · last " + (r.st.last ? fdt(r.st.last.placed) : "—") + '</span></div><div class="e"><b class="num">' + money2(r.st.life) + "</b>" + standingBadge(r.a) + "</div></div>").join("") + "</div>"
    : '<div class="empty"><b>No companies assigned yet</b>Arlo Secour assigns companies to you in Shopify.</div>') + "</div></div>";
}
function vCompany(){
  const a = acctOf(S.acct); if (!a) return vCompanies();
  const st = stats(a), qs = quarters(a), tps = touchesOf(a.id), L0 = a.locations[0] || {};
  const top = {}; st.orders.forEach(o => o.lines.forEach(l => { const k = l.kind || "Other"; top[k] = (top[k] || 0) + l.qty * l.price; }));
  const topL = Object.keys(top).sort((x, y) => top[y] - top[x]), maxT = Math.max(1, ...topL.map(k => top[k]));
  const months = Math.max(0, Math.round(days(a.since, TODAY) / 30.4)), yr = st.yearEnd ? days(TODAY, st.yearEnd) : null;
  const list = st.orders.slice().reverse();
  return '<div class="pg wide">' + back("Companies") + ph(esc(a.name), standingBadge(a), '<button class="btn out" data-tp="' + esc(a.id) + '">Log touchpoint</button>' + aLink("companies/" + gidNum(a.id), ic("ext") + "Open in Shopify", "btn pri"), "Customer for " + plural(months, "month") + (a.externalId ? " · " + esc(a.externalId) : "")) +
    '<div class="lay"><div>' +
      '<div class="card sec"><div class="mets">' + met("Total sales", money2(st.life), "all time") + met("Total orders", st.orders.length, st.open ? "opening " + fdt(st.open.placed) : "none yet") + met("Reorders every", st.avgGap ? "~" + st.avgGap + " days" : "—", st.next ? "next around " + fdt(st.next) : "after a second order") + met("First year", yr != null ? (yr > 0 ? yr + " days left" : "Complete") : "—", st.yearEnd ? "ends " + fd(st.yearEnd) : "") + "</div></div>" +
      sec("Orders", "", '<div class="card">' + (list.length ? '<table class="tbl rsp"><thead><tr><th>Order</th><th>Customer</th><th>Order date</th><th class="r">Total</th><th>Payment</th></tr></thead><tbody>' + list.map(o => { const h = o.customer && contactOf(o.customer); return '<tr data-order="' + esc(o.id) + '"><td class="b">' + esc(o.name) + "</td><td>" + esc(h ? cName(h.c) : "") + '</td><td class="mut">' + fdt(o.placed) + '</td><td class="r num">' + money2(orderNet(o)) + "</td><td>" + payBadge(o) + "</td></tr>"; }).join("") + "</tbody></table>" +
        '<div class="mlist">' + list.map(o => '<div class="mrow" data-order="' + esc(o.id) + '"><div class="m"><b>' + esc(o.name) + '</b><span class="mut">' + fd(o.placed) + '</span></div><div class="e"><b class="num">' + money2(orderNet(o)) + "</b>" + payBadge(o) + "</div></div>").join("") + "</div>" : '<div class="empty">No orders yet.</div>') + "</div>") +
      sec("Locations", "", '<div class="card">' + a.locations.map(L => '<div class="mrow" data-loc="' + esc(L.id) + '"><div class="m"><b>' + esc(L.name || L.ship.address1) + '</b><span class="mut">' + esc(L.terms || "No payment terms") + " • " + (L.toDraft ? "Submit orders as drafts" : "Automatically submit orders") + '</span></div><div class="e">' + ic("chev") + "</div></div>").join("") + "</div>") +
      (topL.length ? sec("What they buy", '<span class="mut">sales by product type</span>', '<div class="card mrows">' + topL.map(k => '<div><div class="row"><span>' + esc(k) + '</span><b class="num">' + money2(top[k]) + '</b></div><div class="meter"><i style="width:' + Math.round(top[k] / maxT * 100) + '%"></i></div></div>').join("") + "</div>") : "") +
    '</div><div class="side-c">' +
      aside("Customers", '<div class="chips">' + (a.contacts.length ? a.contacts.map(c => '<button class="tag tagb" data-cust="' + esc(c.id) + '">' + esc(cName(c)) + "</button>").join("") : '<span class="mut">No customers</span>') + "</div>") +
      aside("Assigned staff", '<div class="chips">' + (a.staff || []).map(n => '<span class="tag">' + esc(n) + "</span>").join("") + "</div>") +
      aside("Customizations", '<p style="font-weight:550;margin-bottom:6px">Markets</p><div class="chips" style="margin-bottom:10px">' + (a.markets || []).map(m => '<span class="tag">' + esc(m) + "</span>").join("") + "</div>" +
        '<p style="font-weight:550;margin-bottom:6px">Catalogs</p><div class="chips" style="margin-bottom:10px">' + (a.catalogs || []).map(m => '<span class="tag">' + esc(m) + "</span>").join("") + "</div>" +
        '<p style="font-weight:550">Payment terms</p><p style="margin-bottom:10px">' + esc(L0.terms || "—") + '</p><p style="font-weight:550">Checkout</p><p style="margin-bottom:10px">' + checkoutLines(L0) + '</p><p style="font-weight:550">Tax</p><p>' + esc(taxLine(L0)) + (L0.taxId ? '<br><span class="mut">Tax ID ' + esc(L0.taxId) + "</span>" : "") + "</p>") +
      aside("Notes", '<p class="' + (a.note ? "" : "mut") + '">' + (a.note ? esc(a.note).replace(/\n/g, "<br>") : "No notes") + "</p>") +
      aside("Quarterly touchpoints", '<div class="qtrs">' + qs.map(q => '<div class="qtr ' + q.st + '"><b>Q' + q.q + " " + String(q.y).slice(2) + "</b>" + (q.st === "ok" ? q.n + " logged" : q.st === "due" ? "due " + fdt(q.end) : q.st === "pre" ? "pre-portal" : "missed") + "</div>").join("") + "</div>" +
        (tps.length ? tps.slice(0, 3).map(t => '<p style="margin-top:10px"><b style="font-weight:550">' + esc(t.kind) + " · " + fdt(t.date) + '</b><br><span class="mut">' + esc(t.summary) + "</span></p>").join("") : '<p class="mut" style="margin-top:8px">No touchpoints logged in the portal yet.</p>'), '<button class="btn plain" data-tp="' + esc(a.id) + '">Log</button>') +
      bonusAside(a) +
      aside("Standing", standingBadge(a) + '<p class="mut sm" style="margin-top:6px">' + (st.yearEnd ? "First year ends " + fd(st.yearEnd) + ". " : "") + "One touchpoint a quarter and two paid reorders a year keep it in good standing.</p>") +
    "</div></div></div>";
}
function vLocation(){
  const a = acctOf(S.acct), L = a && locOf(a, S.locId); if (!L) return vCompany();
  const people = a.contacts.filter(c => !c.loc || c.loc === L.id);
  return '<div class="pg">' + back(a.name) + ph(esc(L.name || L.ship.address1), "", aLink("companies/" + gidNum(a.id) + "/locations/" + gidNum(L.id), ic("ext") + "Open in Shopify"), esc(a.name)) +
    '<div class="lay"><div>' +
      sec("Addresses", "", '<div class="card cp"><div class="g2"><div><p style="font-weight:550;margin-bottom:4px">Shipping address</p><p>' + addrBlock(L.ship) + '</p></div><div><p style="font-weight:550;margin-bottom:4px">Billing address</p><p>' + (L.billSame || !L.bill ? '<span class="mut">Same as shipping address</span>' : addrBlock(L.bill)) + "</p></div></div></div>") +
      sec("Customers", "", '<div class="card">' + (people.length ? people.map(c => '<div class="mrow" data-cust="' + esc(c.id) + '"><div class="m"><b>' + esc(cName(c)) + '</b><span class="mut">' + esc([c.title, c.email, c.phone].filter(Boolean).join(" · ")) + '</span></div><div class="e">' + bd(esc(c.role || "Ordering only"), "nodot") + "</div></div>").join("") : '<div class="empty">No customers at this location.</div>') + "</div>") +
    '</div><div class="side-c">' +
      aside("Catalogs", '<div class="chips">' + (L.catalogs || a.catalogs || []).map(m => '<span class="tag">' + esc(m) + "</span>").join("") + "</div>") +
      aside("Payment terms", "<p>" + esc(L.terms || "—") + "</p>") +
      aside("Checkout", "<p>" + checkoutLines(L) + "</p>") +
      aside("Tax details", "<p>" + esc(taxLine(L)) + (L.taxId ? '<br><span class="mut">Tax ID ' + esc(L.taxId) + "</span>" : "") + "</p>") +
      aside("Assigned staff", '<div class="chips">' + (L.staff || a.staff || []).map(n => '<span class="tag">' + esc(n) + "</span>").join("") + "</div>") +
      aside("Notes", '<p class="' + (L.note ? "" : "mut") + '">' + esc(L.note || "No notes") + "</p>") +
    "</div></div></div>";
}

/* ---------- customers ---------- */
function vCustomers(){
  const rows = allContacts().map(x => Object.assign(x, {os: custOrders(x.c, x.a)}));
  return '<div class="pg wide">' + ph("Customers", "", aLink("customers", ic("ext") + "Customers in Shopify"), "People who buy for your companies. Add or change customers in Shopify.") +
    '<div class="card">' + (rows.length ? '<table class="tbl rsp"><thead><tr><th>Customer name</th><th>Company</th><th>Location</th><th>Role</th><th class="r">Orders</th><th class="r">Amount spent</th></tr></thead><tbody>' +
      rows.map(r => '<tr data-cust="' + esc(r.c.id) + '"><td><span class="b">' + esc(cName(r.c)) + '</span><span class="two">' + esc(r.c.email || r.c.phone || "") + "</span></td><td>" + esc(r.a.name) + '</td><td class="mut">' + esc(locName(r.a, r.c.loc)) + "</td><td>" + bd(esc(r.c.role || "Ordering only"), "nodot") + '</td><td class="r num">' + r.os.length + '</td><td class="r num">' + money2(r.os.reduce((s, x) => s + x.total, 0)) + "</td></tr>").join("") + "</tbody></table>" +
      '<div class="mlist">' + rows.map(r => '<div class="mrow" data-cust="' + esc(r.c.id) + '"><div class="m"><b>' + esc(cName(r.c)) + '</b><span class="mut">' + esc(r.a.name) + '</span></div><div class="e"><b class="num">' + money2(r.os.reduce((s, x) => s + x.total, 0)) + "</b></div></div>").join("") + "</div>"
    : '<div class="empty"><b>No customers yet</b></div>') + "</div></div>";
}
function vCustomer(){
  const h = contactOf(S.custId); if (!h) return vCustomers();
  const {c, a} = h, os = custOrders(c, a), spent = os.reduce((s, x) => s + x.total, 0);
  return '<div class="pg">' + back("Customers") + ph(esc(cName(c)), "", c.customerId ? aLink("customers/" + c.customerId, ic("ext") + "Open in Shopify") : "", esc(a.name) + " · " + esc(locName(a, c.loc))) +
    '<div class="lay"><div>' +
      '<div class="card sec"><div class="mets mets3">' + met("Amount spent", money2(spent), "orders this customer placed") + met("Orders", os.length, os.length ? "last " + fdt(os[0].o.placed) : "none yet") + met("Customer since", c.since ? fdt(c.since) : "—", "") + "</div></div>" +
      sec("Orders placed", "", '<div class="card">' + (os.length ? os.map(x => '<div class="mrow" data-order="' + esc(x.o.id) + '"><div class="m"><b>' + esc(x.o.name) + '</b> <span class="mut" style="display:inline">· ' + fd(x.date) + '</span></div><div class="e"><b class="num">' + money2(x.total) + "</b>" + payBadge(x.o) + "</div></div>").join("") : '<div class="empty">No orders from this customer yet.</div>') + "</div>") +
    '</div><div class="side-c">' +
      aside("Contact information", "<p>" + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : '<span class="mut">No email</span>') + "<br>" + (c.phone ? '<a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + "</a>" : '<span class="mut">No phone number</span>') + (c.title ? '<br><span class="mut">' + esc(c.title) + "</span>" : "") + "</p>") +
      aside("Company", '<p><button class="link" data-acct="' + esc(a.id) + '">' + esc(a.name) + '</button></p><p style="margin-top:8px"><b style="font-weight:550">Location</b><br>' + esc(locName(a, c.loc)) + '</p><p style="margin-top:8px"><b style="font-weight:550">Role</b><br>' + esc(c.role || "Ordering only") + "</p>") +
      aside("Notes", '<p class="' + (c.note ? "" : "mut") + '">' + esc(c.note || "No notes") + "</p>") +
    "</div></div></div>";
}

/* ---------- touchpoints (the one thing she enters here) ---------- */
const TP_KIND = ["Visit", "Call", "Email", "Text", "Video call", "Other"];
const TP_STATUS = ["Plans to reorder soon", "Just placed an order", "Selling well · no order yet", "Selling slowly", "Not planning to reorder", "Other"];
function blankTouch(acct){ return {acct: acct || (S.data.accounts.length === 1 ? S.data.accounts[0].id : ""), date: TODAY, kind: "Visit", summary: "", status: "", statusNote: "", feedback: "", follow: ""}; }
function vTouch(){
  if (!S.tForm) S.tForm = blankTouch();
  const f = S.tForm, E = S.tErr || {};
  const fl = (k, label, html) => '<label class="fld' + (E[k] ? " err" : "") + '"><span>' + label + "</span>" + html + (E[k] ? '<span class="em">' + ic("alert") + E[k] + "</span>" : "") + "</label>";
  const all = S.data.touchpoints.slice().sort((a, b) => a.date < b.date ? 1 : -1);
  return '<div class="pg">' + ph("Touchpoints", "", "", "Your agreement asks for at least one documented contact with each company every quarter. Sending it here records it with Arlo Secour in writing.") +
    '<div class="lay"><div>' +
      sec("Log a touchpoint", "", '<div class="card cp"><div class="form">' +
        '<div class="g2">' + fl("acct", "Company", '<select id="tAcct"><option value="">Choose a company</option>' + S.data.accounts.map(a => '<option value="' + esc(a.id) + '"' + (a.id === f.acct ? " selected" : "") + ">" + esc(a.name) + "</option>").join("") + "</select>") +
          fl("date", "Date of contact", '<input id="tDate" type="date" max="' + TODAY + '" value="' + esc(f.date) + '">') + "</div>" +
        '<div class="fld"><span>How you connected</span><div class="segm">' + TP_KIND.map(k => '<button type="button" data-tk="' + k + '" class="' + (f.kind === k ? "on" : "") + '">' + k + "</button>").join("") + "</div></div>" +
        fl("summary", "What was the contact about?", '<textarea id="tSum" maxlength="1000" placeholder="e.g. Stopped in to check the display, restocked testers, talked through the holiday window.">' + esc(f.summary) + "</textarea>") +
        '<div class="g2">' + fl("status", "Their ordering status", '<select id="tStat"><option value="">Choose</option>' + TP_STATUS.map(s => "<option" + (f.status === s ? " selected" : "") + ">" + s + "</option>").join("") + "</select>") +
          '<label class="fld"><span>Plans <i>(optional)</i></span><input id="tStatN" maxlength="200" value="' + esc(f.statusNote) + '" placeholder="e.g. Reorder 50 mL sprays in early November"></label></div>' +
        fl("feedback", "Product feedback &amp; business conditions", '<textarea id="tFb" maxlength="1000" placeholder="What’s selling, what customers say, foot traffic — anything that affects the company.">' + esc(f.feedback) + "</textarea>") +
        '<div class="g2"><label class="fld"><span>Follow up on <i>(optional)</i></span><input id="tFol" type="date" min="' + TODAY + '" value="' + esc(f.follow) + '"></label><div></div></div>' +
        '<div class="row" style="justify-content:flex-end"><button class="btn pri" data-tsave="1"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "Sending…" : "Send to Arlo Secour") + "</button></div>" +
      "</div></div>") +
      sec("History", '<span class="mut">' + plural(all.length, "touchpoint") + "</span>", '<div class="card">' + (all.length ? all.map(t => { const a = acctOf(t.acct); return '<div class="tl"><div class="h"><b>' + esc(a ? a.name : "") + "</b>" + bd(esc(t.kind), "nodot") + '<span class="mut">' + fd(t.date) + "</span>" + bd(esc(t.status), "info nodot") + "</div><p>" + esc(t.summary) + "</p>" + (t.statusNote ? '<p class="mut">Plans: ' + esc(t.statusNote) + "</p>" : "") + '<p class="mut">Feedback: ' + esc(t.feedback) + "</p></div>"; }).join("") : '<div class="empty">Touchpoints you send appear here.</div>') + "</div>") +
    '</div><div class="side-c">' +
      aside("This quarter", S.data.accounts.map(a => { const q = curQ(a); return '<p style="margin-bottom:8px"><b style="font-weight:550">' + esc(a.name) + "</b><br>" + (q.st === "ok" ? bd("Q" + q.q + " touchpoint logged", "ok") : bd("Due by " + fdt(q.end) + " · " + q.left + " days left", q.left <= 21 ? "warn ring" : "ring")) + "</p>"; }).join("") || '<p class="mut">No companies yet.</p>') +
      aside("Why it matters", '<p class="mut">One documented touchpoint per quarter, plus two paid reorders a year, keeps a company in good standing and your 10% reorder rate after its first year. Two missed quarters in a row starts an account review.</p>') +
    "</div></div></div>";
}
function readTouch(){
  const f = S.tForm, v = id => ($(id) || {}).value;
  if ($("tAcct")) f.acct = v("tAcct"); if ($("tDate")) f.date = v("tDate"); if ($("tSum")) f.summary = v("tSum").trim();
  if ($("tStat")) f.status = v("tStat"); if ($("tStatN")) f.statusNote = v("tStatN").trim(); if ($("tFb")) f.feedback = v("tFb").trim(); if ($("tFol")) f.follow = v("tFol");
}
async function saveTouch(){
  readTouch(); const f = S.tForm, E = {};
  if (!f.acct) E.acct = "Choose the company.";
  if (!f.date || f.date > TODAY) E.date = "Pick the day you made contact (today or earlier).";
  if (f.summary.length < 10) E.summary = "Add a short summary of the contact.";
  if (!f.status) E.status = "Choose their ordering status.";
  if (f.feedback.length < 3) E.feedback = "Add product feedback or how business is going.";
  S.tErr = E; if (Object.keys(E).length){ render(); return; }
  S.busy = true; render();
  try{ const r = await api("touch", {touch: f}); S.data.touchpoints.push(r.touch); S.tForm = blankTouch(f.acct); S.tErr = {}; toast("Touchpoint sent to Arlo Secour"); }
  catch(e){ toast("Couldn’t send: " + e.message); }
  S.busy = false; render();
}

/* ---------- sales ---------- */
function vSales(){
  const shop = allOrders().filter(x => !x.o.cancelled);
  const years = [...new Set(shop.map(x => x.o.placed.slice(0, 4)).concat([TODAY.slice(0, 4)]))].sort().reverse();
  const y = S.sYear || years[0], dateOf = x => S.sMode === "paid" ? x.o.paid : x.o.placed;
  const inY = shop.filter(x => dateOf(x) && dateOf(x).slice(0, 4) === y);
  const by = Array(12).fill(0); inY.forEach(x => { by[+dateOf(x).slice(5, 7) - 1] += x.total; });
  const max = Math.max(1, ...by), curM = TODAY.slice(0, 4) === y ? +TODAY.slice(5, 7) - 1 : -1, tot = by.reduce((s, v) => s + v, 0);
  const lineT = {}; inY.forEach(x => x.o.lines.forEach(l => { const k = l.kind || "Other"; lineT[k] = (lineT[k] || 0) + l.qty * l.price; }));
  const lk = Object.keys(lineT).sort((a, b) => lineT[b] - lineT[a]), lmax = Math.max(1, ...lk.map(k => lineT[k]));
  const best = by.some(v => v) ? by.indexOf(Math.max(...by)) : -1;
  return '<div class="pg wide">' + ph("Sales", "", '<div class="segm">' + years.map(v => '<button data-sy="' + v + '" class="' + (v === y ? "on" : "") + '">' + v + "</button>").join("") + '</div><div class="segm"><button data-sm="placed" class="' + (S.sMode === "placed" ? "on" : "") + '">By order date</button><button data-sm="paid" class="' + (S.sMode === "paid" ? "on" : "") + '">By paid date</button></div>', "") +
    '<div class="card sec"><div class="mets">' + met("Total sales", money2(tot), plural(inY.length, "order") + " in " + y) + met("Average order", money2(inY.length ? tot / inY.length : 0), "after discounts, before shipping &amp; tax") + met("Best month", best >= 0 ? MONL[best] : "—", best >= 0 ? money2(by[best]) : "") + met("Companies ordering", new Set(inY.map(x => x.acct.id)).size, "of " + S.data.accounts.length) + "</div></div>" +
    sec("Sales over time", '<span class="mut">' + (S.sMode === "paid" ? "by the month each invoice was paid" : "by the month each order was placed") + "</span>", '<div class="card"><div class="bars">' + by.map((v, i) => '<div class="bar' + (v ? "" : " zero") + (i === curM ? " now" : "") + '" title="' + MONL[i] + ": " + money2(v) + '"><em>' + (v ? money(v) : "") + '</em><i style="height:' + (v ? Math.max(3, Math.round(v / max * 130)) : 1) + 'px"></i><small>' + MON[i] + "</small></div>").join("") + "</div></div>") +
    '<div class="lay"><div>' +
      sec("Sales by company", "", '<div class="card"><table class="tbl"><thead><tr><th>Company</th><th class="r">Orders</th><th>Last order</th><th class="r">Total sales</th></tr></thead><tbody>' + S.data.accounts.map(a => { const xs = inY.filter(x => x.acct === a); return '<tr data-acct="' + esc(a.id) + '"><td class="b">' + esc(a.name) + '</td><td class="r num">' + xs.length + '</td><td class="mut">' + (xs.length ? fdt(xs[0].o.placed) : "—") + '</td><td class="r num">' + money2(xs.reduce((s, x) => s + x.total, 0)) + "</td></tr>"; }).join("") + "</tbody></table></div>") +
    '</div><div class="side-c">' + aside("Sales by product type", lk.length ? lk.map(k => '<div style="margin-bottom:8px"><div class="row" style="justify-content:space-between"><span>' + esc(k) + '</span><b class="num">' + money(lineT[k]) + '</b></div><div class="meter"><i style="width:' + Math.round(lineT[k] / lmax * 100) + '%"></i></div></div>').join("") : '<p class="mut">No sales in ' + y + " yet.</p>") + "</div></div></div>";
}

/* ---------- earnings: statements, bonuses, what's waiting ---------- */
const meter = (v, max) => '<div class="meter"><i style="width:' + Math.min(100, Math.round((v / Math.max(1, max)) * 100)) + '%"></i></div>';
function bonusRows(a, p){
  if (!p || !p.opening) return '<p class="mut">Bonuses start with the opening order.</p>';
  if (p.house) return '<p class="mut">House account — no bonuses.</p>';
  const f = p.fast, l = p.loyal, q = p.quality;
  const fastS = f.status === "earned" ? bd("Earned", "ok") + ' <span class="mut sm">' + esc(f.order) + " · " + fdt(f.date) + "</span>" : f.status === "waiting" ? bd("Waiting on payment", "att") + ' <span class="mut sm">' + esc(f.order) + " must be paid by " + fdt(f.deadline) + "</span>" : f.status === "open" ? bd("Open", "info") + ' <span class="mut sm">2nd order placed &amp; paid by ' + fdt(f.deadline) + "</span>" : bd("Missed", "nodot");
  const loyS = l.status === "earned" ? bd("Earned", "ok") + ' <span class="mut sm">' + (l.via === "orders" ? "4th paid order" : "$3,500 in reorders") + " · " + esc(l.order) + " · " + fdt(l.date) + "</span>" : l.status === "missed" ? bd("Missed", "nodot") : '<span class="mut sm">' + Math.min(l.orders, 4) + " of 4 paid orders · " + money(l.reorders) + " of $3,500 in reorders</span>";
  return '<div class="bon"><div class="row"><b>Fast Reorder · $150</b><span class="bv">' + fastS + "</span></div>" +
    '<div class="row"><b>Loyal Account · $250</b><span class="bv">' + loyS + "</span></div>" + (l.status === "open" ? meter(Math.max(l.orders / 4, l.reorders / 3500), 1) : "") +
    '<div class="row"><b>Account Quality · $200–$750</b><span class="bv mut sm">' + (q.tier ? esc(q.tier) + " reached · " : "") + money(q.reorders) + " in reorders" + (q.next ? " · " + money(q.next.left) + " to " + esc(q.next.name.split(" — ")[0]) + " (" + money(q.next.bonus) + ")" : "") + "</span></div>" +
    (q.next ? meter(q.reorders, q.next.at) : "") +
    '<p class="mut sm" style="margin-top:6px">' + (p.inYearOne ? "Year one ends " + fd(p.yearEnd) + ". Bonuses count paid orders placed in the first 12 months." : "Year one ended " + fd(p.yearEnd) + ". " + plural(p.reorders12, "paid reorder") + " in the last 12 months (2 keep the 10% rate).") + "</p></div>";
}
function bonusAside(a){ const L = ledger(); return L && L.progress[a.id] ? aside("Year-one bonuses", bonusRows(a, L.progress[a.id])) : ""; }
/* ---------- earnings: summary → by company → statements ---------- */
function eCtx(){
  const L = ledger(), d = S.data, admin = d.me.role === "admin";
  const repPick = admin && d.reps && d.reps.length > 1 ? '<div class="segm">' + d.reps.map(r => '<button data-lrep="' + esc(r.staffId) + '" class="' + ((S.lRep || d.reps[0].staffId) === r.staffId ? "on" : "") + '">' + esc(r.name) + "</button>").join("") + "</div>" : "";
  const who = admin && d.reps && d.reps.length ? (d.reps.find(r => r.staffId === (S.lRep || d.reps[0].staffId)) || d.reps[0]) : null;
  return {L, d, admin, repPick, who};
}
const sum = (xs, f) => Math.round(xs.reduce((s, x) => s + (f ? f(x) : x.amount), 0) * 100) / 100;
function stLine(l, showCo){
  return '<tr' + (l.orderId ? ' data-order="' + esc(l.orderId) + '"' : "") + '><td><span class="b">' + esc(l.type === "bonus" ? l.label : (l.order + " · " + l.label)) + "</span>" + (l._st ? " " + (l.paid ? bd("Paid", "ok") : bd("Owed", "att")) : "") + (l.carried ? '<span class="two">carried from the ' + fdt(l.carried) + " statement</span>" : "") +
    '<span class="two sm-only">' + esc([showCo ? l.company : "", l.rate ? Math.round(l.rate * 100) + "% of " + money2(l.base) : ""].filter(Boolean).join(" · ")) + "</span></td>" +
    (showCo ? '<td class="hn">' + esc(l.company || "—") + "</td>" : "") + '<td class="mut nw">' + fdt(l.date) + '</td><td class="r num hn">' + (l.base != null ? money2(l.base) : "") + '</td><td class="r num hn">' + (l.rate ? Math.round(l.rate * 100) + "%" : "") + '</td><td class="r num">' + money2(l.amount) + "</td></tr>";
}
function linesTable(lines, showCo, totalLabel){
  const c = sum(lines.filter(l => l.type === "commission")), b = sum(lines.filter(l => l.type === "bonus"));
  return '<div class="twrap"><table class="tbl st"><thead><tr><th>Item</th>' + (showCo ? '<th class="hn">Company</th>' : "") + '<th>Date</th><th class="r hn">Base</th><th class="r hn">Rate</th><th class="r">Amount</th></tr></thead><tbody>' +
    lines.map(l => stLine(l, showCo)).join("") + '<tr><td class="b">' + (totalLabel || "Total") + (b && c ? '<span class="two" style="font-weight:400">' + money2(c) + " commission + " + money2(b) + " bonuses</span>" : "") + "</td>" + (showCo ? '<td class="hn"></td>' : "") + '<td></td><td class="hn"></td><td class="hn"></td><td class="r num b">' + money2(c + b) + "</td></tr></tbody></table></div>";
}
function bonusMini(p){
  if (!p || !p.opening) return '<span class="mut">—</span>';
  if (p.house) return bd("House account", "nodot");
  const n = (p.fast.status === "earned" ? 1 : 0) + (p.loyal.status === "earned" ? 1 : 0) + (p.quality.tier ? 1 : 0);
  return '<span class="b" style="font-weight:450">' + n + " of 3 earned</span>" + '<span class="two">' + (p.inYearOne ? "year one ends " + fdt(p.yearEnd) : "year one complete") + "</span>";
}
function vEarnings(){
  const {L, d, admin, repPick, who} = eCtx();
  if (!L) return '<div class="pg">' + ph("Earnings", "", repPick, "") + '<div class="card empty"><b>No earnings yet</b>' + (admin ? "Add a rep on the Reps tab to see their statements." : "Commission shows up here once an invoice is paid in full.") + "</div></div>";
  const ns = nextSt(L), wt = sum(L.waiting), owed = L.owed;
  const ids = Object.keys(L.progress), accts = ids.map(id => d.accounts.find(a => a.id === id)).filter(Boolean);
  const rep = L.lines.filter(l => !l.acct), y = TODAY.slice(0, 4);
  const rows = accts.map(a => { const ls = L.lines.filter(l => l.acct === a.id), w = L.waiting.filter(x => x.acct === a.id);
    return {a, p: L.progress[a.id], comm: sum(ls.filter(l => l.type === "commission")), bon: sum(ls.filter(l => l.type === "bonus")), owed: sum(ls.filter(l => !l.paid)), wait: sum(w), sales: sum(a.orders.filter(o => !o.cancelled && o.placed.slice(0, 4) === y), orderNet)}; })
    .sort((p, q) => q.owed - p.owed || q.comm + q.bon - p.comm - p.bon);
  const payBtn = st => !admin || st.status === "paid" ? "" : S.mpConfirm === st.date ? '<span class="row" style="gap:6px"><button class="btn" data-mpno="1">Cancel</button><button class="btn pri" data-mpyes="' + st.date + '"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "Saving…" : "Confirm: paid " + money2(st.total)) + "</button></span>" : st.status !== "due" ? "" : '<button class="btn out" data-mp="' + st.date + '">Mark paid</button>';
  const open = st => S.stOpen ? S.stOpen[st.date] : st.date === L.nextStatement;
  return '<div class="pg">' + ph("Earnings" + (who ? " · " + esc(who.name) : ""), "", repPick, "Paid on the 1st for invoices paid in full the month before.") +
    '<div class="card sec"><div class="mets">' +
      met("Next statement", money2(ns ? ns.total : 0), "on " + fdt(L.nextStatement) + (ns && ns.bonuses ? " · " + money2(ns.bonuses) + " in bonuses" : "")) +
      met("Owed to you", money2(owed), owed ? "earned, not yet paid" : "all caught up") +
      met("Waiting on payment", money2(wt), plural(L.waiting.length, "open invoice") + " · est.") +
      met("Paid in " + y, money2(L.paidYtd), L.paidThrough ? "paid through " + fdt(L.paidThrough) : "") +
    "</div></div>" +
    sec("By company", '<span class="mut">' + rows.length + (rows.length === 1 ? " company" : " companies") + "</span>", '<div class="card">' + (rows.length ? '<div class="twrap"><table class="tbl rsp ec"><thead><tr><th>Company</th><th class="r">' + y + ' sales</th><th class="r">Commission</th><th class="r">Bonuses</th><th class="r">Owed now</th><th>Year-one bonuses</th></tr></thead><tbody>' +
      rows.map(r => '<tr data-eco="' + esc(r.a.id) + '"><td><span class="b">' + esc(r.a.name) + "</span>" + (r.wait ? '<span class="two">' + money2(r.wait) + " waiting on payment</span>" : "") + '</td><td class="r num">' + money2(r.sales) + '</td><td class="r num">' + money2(r.comm) + '</td><td class="r num">' + money2(r.bon) + '</td><td class="r num' + (r.owed ? " b" : " mut") + '">' + money2(r.owed) + "</td><td>" + bonusMini(r.p) + "</td></tr>").join("") +
      (rep.length ? '<tr class="nohov"><td><span class="b">Welcome bonus</span><span class="two">not tied to a company</span></td><td></td><td></td><td class="r num">' + money2(sum(rep)) + '</td><td class="r num mut">' + money2(sum(rep.filter(l => !l.paid))) + "</td><td></td></tr>" : "") +
      "</tbody></table></div>" +
      '<div class="mlist">' + rows.map(r => '<div class="mrow" data-eco="' + esc(r.a.id) + '"><div class="m"><b>' + esc(r.a.name) + '</b><span class="mut">' + money2(r.comm) + " commission · " + money2(r.bon) + " bonuses</span>" + (r.p && r.p.opening && !r.p.house ? '<span class="mut sm">Year-one bonuses: ' + ((r.p.fast.status === "earned" ? 1 : 0) + (r.p.loyal.status === "earned" ? 1 : 0) + (r.p.quality.tier ? 1 : 0)) + " of 3 earned</span>" : "") + "</div><div class=\"e\"><b class=\"num\">" + money2(r.owed) + '</b><span class="mut sm">owed</span></div></div>').join("") + "</div>"
      : '<div class="empty">No companies yet.</div>') + "</div>") +
    sec("Statements", "", '<div class="card">' + L.statements.map(st => '<div class="stm' + (open(st) ? " open" : "") + '"><button class="stmh" data-st="' + st.date + '"><span class="chev">' + ic("chev") + '</span><span class="m"><b>' + fd(st.date) + '</b><span class="mut sm">' + (st.status === "building" ? "invoices paid in " + MONL[+st.covers.slice(5) - 1] + " so far" : "invoices paid in " + MONL[+st.covers.slice(5) - 1]) + '</span></span><span class="r num hn2">' + (st.bonuses ? money2(st.commission) + " + " + money2(st.bonuses) + " bonus" : "") + '</span><b class="r num">' + money2(st.total) + "</b>" + stBadge(st) + "</button>" +
      (open(st) ? '<div class="stmb">' + (payBtn(st) ? '<div class="row" style="justify-content:flex-end;padding:0 16px 8px">' + payBtn(st) + "</div>" : "") + linesTable(st.lines, rows.length > 1 || st.lines.some(l => !l.acct)) + "</div>" : "") + "</div>").join("") + "</div>") +
    (L.waiting.length ? sec("Waiting on payment", '<span class="mut">commission once paid in full</span>', '<div class="card"><div class="twrap"><table class="tbl"><thead><tr><th>Order</th><th>Company</th><th>Placed</th><th class="r">Base</th><th class="r">Est.</th></tr></thead><tbody>' + L.waiting.slice().sort((p, q) => p.placed < q.placed ? 1 : -1).slice(0, S.wAll ? 999 : 5).map(x => '<tr data-order="' + esc(x.orderId) + '"><td class="b">' + esc(x.order) + "</td><td>" + esc(x.company) + '</td><td class="mut">' + fdt(x.placed) + '</td><td class="r num">' + money2(x.base) + '</td><td class="r num">' + money2(x.amount) + "</td></tr>").join("") + "</tbody></table></div>" + (L.waiting.length > 5 ? '<div class="row" style="justify-content:center;padding:8px"><button class="btn plain" data-wall="1">' + (S.wAll ? "Show fewer" : "Show all " + L.waiting.length) + "</button></div>" : "") + "</div>") : "") +
    '<p class="mut sm" style="margin-top:4px">15% on opening orders and 10% on reorders, on the order total after discounts and refunds — shipping and tax excluded. Bonuses are paid once the qualifying invoice is paid in full.</p>' +
    "</div>";
}
/* one company's earnings */
function vEarnCo(){
  const {L, d} = eCtx(), a = acctOf(S.acct), p = L && a && L.progress[a.id]; if (!p) return vEarnings();
  const ls = L.lines.filter(l => l.acct === a.id).slice().sort((x, y) => x.date < y.date ? 1 : -1), w = L.waiting.filter(x => x.acct === a.id);
  return '<div class="pg">' + back("Earnings") + ph(esc(a.name), standingBadge(a), '<button class="btn out" data-acct="' + esc(a.id) + '">Company details</button>', "Opening order " + esc(p.opening) + " · " + fd(p.openingDate)) +
    '<div class="card sec"><div class="mets">' + met("Commission", money2(sum(ls.filter(l => l.type === "commission"))), "all time") + met("Bonuses", money2(sum(ls.filter(l => l.type === "bonus"))), "year one") + met("Owed now", money2(sum(ls.filter(l => !l.paid))), "earned, not yet paid") + met("Waiting on payment", money2(sum(w)), plural(w.length, "open invoice")) + "</div></div>" +
    sec("Year-one bonuses", "", '<div class="card cp">' + bonusRows(a, p) + "</div>") +
    sec("Everything earned", '<span class="mut">newest first</span>', '<div class="card">' + (ls.length ? linesTable(ls.map(l => Object.assign({}, l, {carried: l.paid ? "" : l.carried, _st: true})), false) + '<p class="mut sm cpx">Each line goes on the statement for the month its invoice was paid. Owed lines are on your next statement.</p>' : '<div class="empty">Nothing earned yet.</div>') + "</div>") +
    "</div>";
}
async function markPaid(date){
  const L = ledger(), d = S.data, id = S.lRep || (d.reps && d.reps[0] && d.reps[0].staffId);
  S.busy = true; render();
  try{ await api("markPaid", {staffId: id, statement: date, paidOn: TODAY}); S.mpConfirm = null; S.busy = false; toast("Statement marked paid"); await load(); go("earnings", {isBack: true}); return; }
  catch(e){ toast("Couldn’t save: " + e.message); }
  S.busy = false; render();
}

/* ---------- notifications ---------- */
function noticeRow(n){
  const a = acctOf(n.acct), est = n.kind === "paid" ? " · est. commission " + money2(n.amount * (n.rate || 0.1)) : "";
  if (n.kind === "bonus") return '<div class="todo' + (n.read ? "" : " unread") + '" data-go="earnings"><span class="ico ok">' + ic("dollar") + '</span><div class="m"><b>You earned the ' + esc(n.order) + (a ? " for " + esc(a.name) : "") + '</b><span class="mut">' + money2(n.amount) + " · " + ftime(n.at) + "</span></div>" + (n.read ? "" : '<span class="udot" aria-label="Unread"></span>') + "</div>";
  const t = n.kind === "new" ? "New order " + esc(n.order) + " from " + esc(a ? a.name : "") : n.kind === "paid" ? esc(n.order) + " is paid in full" : n.kind === "refund" ? esc(n.order) + " was refunded" : n.kind === "cancel" ? esc(n.order) + " was cancelled" : esc(n.text || "");
  return '<div class="todo' + (n.read ? "" : " unread") + '" data-order="' + esc(n.orderId || "") + '"><span class="ico ' + (n.kind === "paid" ? "ok" : n.kind === "new" ? "info" : "att") + '">' + ic(n.kind === "paid" ? "dollar" : n.kind === "new" ? "receipt" : "alert") + '</span><div class="m"><b>' + t + '</b><span class="mut">' + money2(n.amount) + est + " · " + ftime(n.at) + "</span></div>" + (n.read ? "" : '<span class="udot" aria-label="Unread"></span>') + "</div>";
}
function vNotices(){
  const p = S.data.prefs || {};
  const tg = (k, label, hint) => '<label class="ckl"><input type="checkbox" data-pref="' + k + '"' + (p[k] ? " checked" : "") + "><span>" + label + '<span class="hint">' + hint + "</span></span></label>";
  return '<div class="pg">' + ph("Notifications", "", unread() ? '<button class="btn out" data-allread="1">Mark all as read</button>' : "", "") +
    '<div class="lay"><div>' + '<div class="card">' + (S.data.notices.length ? S.data.notices.map(noticeRow).join("") : '<div class="empty"><b>No notifications yet</b>You’ll hear about new and paid orders from your companies here and by email.</div>') + "</div>" +
    '</div><div class="side-c">' + aside("Email me when", '<div class="form" style="gap:8px">' + tg("newOrder", "A company places an order", "Any order under your companies, however it’s placed") + tg("paid", "An invoice is paid in full", "With your estimated commission") + tg("refund", "An order is refunded or cancelled", "Commission is adjusted to match") + tg("touchRemind", "A quarterly touchpoint is due", "Two weeks before the quarter ends") + tg("reorderRemind", "A company is due to reorder", "Based on how often they usually order") + "</div>") +
    aside("Sent to", "<p>" + esc(S.data.me.email || "your email on file") + "</p>") + "</div></div></div>";
}

/* ---------- toast ---------- */
let toastT = 0;
function toast(t){ $("rpToast").innerHTML = '<div class="toast">' + esc(t) + "</div>"; clearTimeout(toastT); toastT = setTimeout(() => { $("rpToast").innerHTML = ""; }, 2800); }

/* ---------- events ---------- */
const root = $("rp");
root.addEventListener("click", async e => {
  if (e.target.closest("a")) return;
  const t = e.target.closest("button,[data-acct],[data-order],[data-cust],[data-loc],[data-go],[data-eco]"); if (!t) return;
  const d = t.dataset;
  if (d.reload){ load(); return; }
  if (d.back){ goBack(); return; }
  if (d.go){ go(d.go); return; }
  if (d.order){ if (d.order) go("order", {okey: d.order}); return; }
  if (d.acct){ go("company", {acct: d.acct}); return; }
  if (d.cust){ go("customer", {custId: d.cust}); return; }
  if (d.loc){ go("location", {locId: d.loc}); return; }
  if (d.tp){ go("touch", {acctForTouch: d.tp}); return; }
  if (d.of){ S.oFilter = d.of; render(); return; }
  if (d.sy){ S.sYear = d.sy; render(); return; }
  if (d.sm){ S.sMode = d.sm; render(); return; }
  if (d.tk){ readTouch(); S.tForm.kind = d.tk; render(); return; }
  if (d.tsave){ await saveTouch(); return; }
  if (d.lrep){ S.lRep = d.lrep; S.mpConfirm = null; S.stOpen = null; render(); return; }
  if (d.eco){ go("earnco", {acct: d.eco}); return; }
  if (d.wall){ S.wAll = !S.wAll; render(); return; }
  if (d.st){ const L = ledger(); if (!S.stOpen){ S.stOpen = {}; if (L) S.stOpen[L.nextStatement] = true; } S.stOpen[d.st] = !S.stOpen[d.st]; render(); return; }
  if (d.mp){ S.mpConfirm = d.mp; render(); return; }
  if (d.mpno){ S.mpConfirm = null; render(); return; }
  if (d.mpyes){ await markPaid(d.mpyes); return; }
  if (d.allread){ S.data.notices.forEach(n => n.read = true); render(); try{ await api("noticesRead", {all: true}); }catch(_){} return; }
});
root.addEventListener("change", async e => {
  const t = e.target;
  if (t.dataset.pref){ S.data.prefs[t.dataset.pref] = t.checked; try{ await api("prefs", {prefs: S.data.prefs}); toast("Saved"); }catch(err){ toast("Couldn’t save: " + err.message); } }
});

/* ---------- start ---------- */
async function load(){
  S.err = ""; S.errCode = ""; S.data = null; render();
  try{
    const r = await api("load");
    S.data = {me: r.me, shop: r.shop || {}, accounts: r.accounts || [], touchpoints: r.touchpoints || [], notices: r.notices || [], prefs: r.prefs || {}, paidThrough: r.paidThrough, portalStart: r.portalStart || r.today, ledger: r.ledger || null, ledgers: r.ledgers || null, reps: r.reps || null};
    if (r.today) TODAY = r.today;
  }catch(e){ S.err = e.message; S.errCode = e.code || ""; }
  render();
}
load();
})();
