'use strict';
/* מעקב הוצאות · גרסה 1
 * - הצעד הראשון הוא חיבור לגיליון (התחברות עם גוגל ובחירת הגיליון). בלי חיבור אין מסך בית.
 * - התקציב והקטגוריות נקראים מהגיליון (app/bridge.js, Google Sheets API).
 * - כל הוצאה נשמרת ביומן בגיליון ומעדכנת את התא הנכון בבקרה קבועה או בבקרה משתנה.
 * - מצב הדגמה קיים לפיתוח בלבד: כתובת עם ?demo.
 */

const COLORS = ['#BBD6FF', '#FFE49A', '#DDD3FF', '#EFE9DC', '#CBE6FF', '#FFEFC0', '#E8E3FF', '#C7DAFF', '#E6D3F0'];
const GROUPS = {
  'קניות': ['shopping-cart', 0], 'בילויים': ['cake-2', 1], 'שונות': ['shapes', 2], 'הוצאות בית': ['home-4', 3], 'בית': ['home-4', 3],
  'תקשורת': ['smartphone', 4], 'חינוך': ['graduation-cap', 5], 'תחבורה': ['car', 6], 'בריאות': ['heart-pulse', 7],
  'טיפוח ורפואה': ['heart-pulse', 7], 'בנקים ואשראי': ['bank', 8]
};
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/* ---------- עזרים ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const fmt = n => (n < 0 ? '−' : '') + '₪' + Math.abs(Math.round(n)).toLocaleString('en-US');
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* מצב פרטי */ } }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const searchField = (id, ph, val, act, type) => `<div class="field srch"><i class="ri-search-line"></i><input id="${id}" type="${type || 'search'}" placeholder="${ph}" autocomplete="off" value="${esc(val)}"><button class="clr" data-act="${act}" aria-label="ניקוי החיפוש" ${val ? '' : 'hidden'}><i class="ri-close-circle-fill"></i></button></div>`;
const icon = n => `<i class="ri-${n}-fill"></i>`;
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const parseDT = s => { const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(s); return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); };
// חודש פיננסי: אם החודש מתחיל ביום 10, ה-5 בפברואר שייך לינואר.
const finMonth = (d, start) => { let m = d.getMonth() + 1; if (d.getDate() < start) m = m === 1 ? 12 : m - 1; return m; };
const weekIdx = (d, start, m) => {
  const y = d.getFullYear(); let sd = new Date(y, m - 1, start); if (sd > d) sd = new Date(y - 1, m - 1, start);
  return Math.max(0, Math.min(4, Math.floor(Math.floor((d - sd) / 86400000) / 7)));
};
function whenText(dt) {
  const d = parseDT(dt), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const day = same(d, t) ? 'היום' : same(d, y) ? 'אתמול' : `${DAYS[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]}`;
  return { day, time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }

/* ---------- מצב ---------- */
const S = {
  cfg: LS.get('cfg', { sheetId: '', sheetName: '' }),
  month: null, current: { month: null, week: 0 }, startDay: 1,
  tab: 'var', period: 'month',
  data: { fixed: [], variable: [] }, entries: [],
  screen: 'home', detailKey: null, sheet: null,
  order: LS.get('order', { g: {}, i: {} }), tags: LS.get('tags', {}),
  pending: LS.get('pending', []), lastSync: LS.get('lastSync', null),
  newVersion: '', who: LS.get('who', ''), eomRules: LS.get('eomRules', {}), decisions: LS.get('decisions', {}), deposits: LS.get('deposits', {}), ym: 0, curYm: 0, firstMonth: 0, locked: LS.get('locked', false), lockStage: 'welcome', pinEntry: '', pinMsg: '', pinFail: 0, pinUntil: 0, pinSetup: null, prefsTs: LS.get('prefsTs', 0), q: '', eq: '', error: null, loading: false, status: null, budgetCfg: null, preview: false, needAuth: false
};
const isLive = () => !!S.cfg.sheetId;
// מצב הדגמה קיים רק לפיתוח ולעיצוב (כתובת עם ?demo). משתמשת רגילה חייבת להתחבר לגיליון.
const DEV = new URLSearchParams(location.search).has('demo');

/* ---------- מצב הדגמה: תמונת מצב של הגיליון + הוצאות מקומיות ---------- */
const Demo = {
  snap: null,
  entries: () => LS.get('demoEntries', []),
  save: a => LS.set('demoEntries', a),
  async load() { if (!this.snap) this.snap = await (await fetch('data/snapshot.json')).json(); return this.snap; },
  budget(month) {
    const sd = this.snap.startDay || 1, now = new Date(), cm = finMonth(now, sd), mo = month || cm;
    const ents = this.entries().filter(e => finMonth(parseDT(e.dt), sd) === mo);
    const mk = (groups, isVar) => groups.map(g => ({
      name: g.name, items: g.items.map(it => {
        const es = ents.filter(e => e.key === it.key), o = { ...it, spent: es.reduce((a, e) => a + e.amount, 0) };
        if (isVar) { o.weeks = [0, 0, 0, 0, 0]; es.forEach(e => { o.weeks[weekIdx(parseDT(e.dt), sd, mo)] += e.amount; }); }
        return o;
      })
    }));
    return { ok: true, month: mo, ym: 202600 + mo, currentYm: 202600 + cm, firstMonth: 1, startDay: sd, currentMonth: cm, currentWeek: weekIdx(now, sd, cm), fixed: mk(this.snap.fixed, false), variable: mk(this.snap.variable, true) };
  }
};

/* ---------- תקשורת עם הגשר ---------- */
const authErr = msg => Object.assign(new Error(msg), { code: 'auth' });

/* התחברות עם גוגל (Google Identity Services). ההרשאה: רק קבצים שהמשתמשת בוחרת בבורר הקבצים (drive.file). */
const TOK = {   // ההרשאה נשמרת רק לתקופת הלשונית (sessionStorage), ולכן שורדת רענון ונעלמת בסגירה
  load() { try { const v = JSON.parse(sessionStorage.getItem('tok')); return v && v.t && v.e > Date.now() + 30000 ? v : null; } catch { return null; } },
  save(t, e) { try { sessionStorage.setItem('tok', JSON.stringify({ t, e })); } catch { /* מצב פרטי */ } },
  clear() { try { sessionStorage.removeItem('tok'); } catch { /* מצב פרטי */ } }
};
/* הכתובת של החשבון נשמרת במכשיר בלבד, כדי שגוגל לא תציג שוב בחירת חשבון בכל כניסה */
async function rememberAccount(tok) {
  try { const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + tok } }); const j = await r.json(); if (j && j.email) LS.set('hint', j.email); } catch { /* לא קריטי */ }
}
const Auth = {
  tok: (TOK.load() || {}).t || null, exp: (TOK.load() || {}).e || 0, tc: null, _res: null, _rej: null,
  conf() { return window.APP_CONFIG || {}; },
  ready() { return !!this.conf().clientId; },
  valid() { return !!this.tok && Date.now() < this.exp - 30000; },
  init() {
    if (this.tc || !window.google || !google.accounts || !this.ready()) return;
    this.tc = google.accounts.oauth2.initTokenClient({
      client_id: this.conf().clientId, scope: 'https://www.googleapis.com/auth/drive.file openid email',
      callback: r => { if (r.error) { this._rej && this._rej(authErr(r.error)); return; } this.tok = r.access_token; this.exp = Date.now() + (r.expires_in || 3600) * 1000; TOK.save(this.tok, this.exp); LS.set('hadAuth', true); if (!LS.get('hint', '')) rememberAccount(this.tok); this._res && this._res(this.tok); },
      error_callback: e => this._rej && this._rej(authErr(e.type || 'popup'))
    });
  },
  request(prompt) {
    return new Promise((res, rej) => {
      this.init(); if (!this.tc) return rej(authErr('Google עדיין נטען או שחסרות הגדרות'));
      this._res = res; this._rej = rej; const hint = LS.get('hint', ''); this.tc.requestAccessToken(hint ? { prompt, hint } : { prompt });
    });
  },
  // אין חידוש אוטומטי בלי נגיעה של המשתמשת: חלון גוגל שנפתח לבד נחסם, ומציק. החידוש נעשה בנגיעה הראשונה או בכפתור "להתחבר לגיליון"
  token() { return this.valid() ? Promise.resolve(this.tok) : Promise.reject(authErr('פג תוקף ההתחברות')); },
  signIn() { return this.request(LS.get('hadAuth', false) ? '' : 'consent'); }          // בלחיצה של המשתמשת
};

/* העדפות: נשמרות במכשיר ובגיליון (תא אחד בלשונית "הגדרות אפליקציה"); הגרסה החדשה יותר קובעת */
const reloadSoon = () => { clearTimeout(reloadSoon.t); reloadSoon.t = setTimeout(() => { if (isLive() && !S.locked) load(S.month, true); }, 900); };
const PT = { timer: null, pulled: false, busy: false };
const prefsNow = () => ({ ts: S.prefsTs, order: S.order, tags: S.tags, eomRules: S.eomRules, decisions: S.decisions, deposits: S.deposits });
function touchPrefs() {
  S.prefsTs = Date.now(); LS.set('prefsTs', S.prefsTs); LS.set('prefsDirty', true);
  clearTimeout(PT.timer); PT.timer = setTimeout(pushPrefs, 1500); PT.status = 'saving'; paintPrefs();
}
async function pushPrefs() {
  if (!isLive() || PT.busy || !LS.get('prefsDirty', false)) return;
  PT.busy = true; PT.status = 'saving'; paintPrefs();
  try {
    /* מיזוג לפני שמירה: כללים/החלטות/הפקדות שקיימים בגיליון ולא אצלי נשארים (איחוד לפי מפתח), כדי שמכשיר עם הגדרות ריקות לא ימחק כללים */
    const rem = (await call('prefs')).prefs;
    if (rem) {
      const mergeMonths = (r, l) => { const o = { ...r }; Object.keys(l || {}).forEach(m => { o[m] = { ...(r && r[m]), ...l[m] }; }); return o; };
      S.eomRules = { ...(rem.eomRules || {}), ...S.eomRules };
      S.decisions = mergeMonths(rem.decisions, S.decisions); S.deposits = mergeMonths(rem.deposits, S.deposits);
      LS.set('eomRules', S.eomRules); LS.set('decisions', S.decisions); LS.set('deposits', S.deposits);
    }
    await call('setPrefs', { prefs: prefsNow() }); LS.set('prefsDirty', false); PT.status = 'saved'; PT.at = Date.now(); LS.set('prefsSavedAt', PT.at); }
  catch (e) { PT.status = 'error'; if (e.code === 'auth') S.needAuth = true; /* יישלח בפעם הבאה */ }
  finally { PT.busy = false; paintPrefs(); }
}
/* חיווי שמירה של ההעדפות: שומר / נשמר (ומתי) / לא נשמר */
function prefsStatusHtml() {
  const pill = (c, t) => `<span class="sync ${c}">${t}</span>`;
  if (!isLive()) return pill('warn', 'נשמר במכשיר הזה בלבד');
  if (PT.status === 'saving') return pill('busy', 'שומר בגיליון…');
  if (PT.status === 'error' || LS.get('prefsDirty', false)) return pill('warn', 'עוד לא נשמר בגיליון, ינסה שוב אוטומטית');
  const at = PT.at || LS.get('prefsSavedAt', 0);
  return pill('ok', 'נשמר בגיליון אוטומטית' + (at ? ' · ' + agoText(at) : ''));
}
function paintPrefs() { const e = $('#ps'); if (e) e.innerHTML = prefsStatusHtml(); }
async function pullPrefs() {
  if (!isLive() || PT.pulled) return;
  try {
    const r = await call('prefs'); PT.pulled = true;
    const p = r.prefs;
    if (p && p.ts > S.prefsTs) {
      S.order = p.order || { g: {}, i: {} }; S.tags = p.tags || {}; S.eomRules = p.eomRules || {}; S.decisions = p.decisions || {}; S.deposits = p.deposits || {}; S.prefsTs = p.ts;
      LS.set('order', S.order); LS.set('tags', S.tags); LS.set('eomRules', S.eomRules); LS.set('decisions', S.decisions); LS.set('deposits', S.deposits); LS.set('prefsTs', S.prefsTs); LS.set('prefsDirty', false);
      render(); reloadSoon();
    } else if (!p || p.ts < S.prefsTs || LS.get('prefsDirty', false)) { if (!p) touchPrefs(); else LS.set('prefsDirty', true); pushPrefs(); }
  } catch (e) { /* בפעם הבאה */ }
}

function setupBridge() { Bridge.configure({ sheetId: S.cfg.sheetId, getToken: () => Auth.token() }); }
const call = (action, payload = {}) => S.locked ? Promise.reject(Object.assign(new Error('האפליקציה נעולה'), { code: 'locked' })) : Bridge.call(action, payload);

/* אנימציית חיבור לגיליון: מתחברת, קוראת את התקציב, מכינה את היומן, ואז האפליקציה עובדת */
function renderConn() {
  const c = S.conn, el = $('#conn');
  if (!c) { el.className = ''; el.innerHTML = ''; return; }
  const st = n => c.step > n ? 'done' : c.step === n ? 'act' : '';
  const done = c.step >= 4;
  el.className = 'on';
  el.innerHTML = `<div class="cn">
    <div class="cn-stage">
      <div class="cn-node"><img src="icon.svg" alt="" width="64" height="64"></div>
      <div class="cn-line ${done ? 'done' : ''}"><i class="cn-dot"></i></div>
      <div class="cn-node">${SHEETS_ICON}</div>
      ${done ? '<div class="cn-check"><span>✓</span>' + [0, 1, 2, 3, 4, 5, 6, 7].map(i => `<i style="--a:${i * 45}deg"></i>`).join('') + '</div>' : ''}
    </div>
    <h2>${done ? 'מחובר' : 'מחברים את התקציב…'}</h2>
    <ul class="cn-steps">
      <li class="${st(1)}"><b></b>מתחברים לגיליון</li>
      <li class="${st(2)}"><b></b>קוראים את התקציב${c.info ? `<small>${esc(c.info)}</small>` : ''}</li>
      <li class="${st(3)}"><b></b>מכינים את יומן ההוצאות</li>
    </ul>
    <p class="cn-sub">${done ? 'מעכשיו כל הוצאה שמזינים נכנסת לגיליון, וכל שינוי בגיליון מופיע כאן.' : ''}</p></div>`;
}

async function connectFlow() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  S.conn = { step: 1, info: '' }; renderConn();
  try {
    await Promise.all([call('ping'), wait(800)]);
    S.conn.step = 2; renderConn();
    const [b] = await Promise.all([call('budget', { rules: S.eomRules, decisions: S.decisions, deposits: S.deposits }), wait(900)]);
    const nv = b.variable.reduce((a, g) => a + g.items.length, 0), nf = b.fixed.reduce((a, g) => a + g.items.length, 0);
    S.conn.info = `${nv} שוטפות ו-${nf} קבועות`; S.conn.step = 3; renderConn();
    const [en] = await Promise.all([call('entries', { month: b.month }), wait(800)]);
    applyBudget(b); S.entries = en.entries; S.lastSync = Date.now(); LS.set('lastSync', S.lastSync); LS.set('cache', { b, en: en.entries });
    S.conn.step = 4; renderConn(); await wait(1700);
    S.conn = null; renderConn(); S.screen = 'home'; render();
  } catch (err) {
    S.conn = null; renderConn();
    if (err.code === 'auth') S.needAuth = true;
    if (err.code === 'quota') { clearTimeout(load.qt); load.qt = setTimeout(() => { if (isLive() && !S.locked) load(S.month, true); }, 65000); }   // מנסה שוב לבד אחרי דקה
    S.error = err.code === 'quota' ? 'גוגל מאפשרת מספר מוגבל של פעולות בדקה, והגענו לגבול. הנתונים שלך בטוחים, והאפליקציה תתחבר שוב לבד בעוד דקה.' : err.code === 'access' ? 'אין גישה לגיליון. בחרי אותו שוב.' : err.code === 'auth' ? null : (err instanceof TypeError ? 'אין חיבור לאינטרנט.' : 'לא הצלחתי לקרוא את הגיליון: ' + err.message);
    if (/חסרה לשונית|לא נמצא/.test(err.message || '')) { S.cfg = { sheetId: '', sheetName: '' }; LS.set('cfg', S.cfg); setupBridge(); S.error = 'זה לא נראה כמו גיליון התקציב: ' + err.message; }
    render();
  }
}

/* בורר הקבצים של גוגל: ההרשאה ניתנת רק לגיליון שנבחר */
async function pickSheet() {
  const c = Auth.conf();
  if (!Auth.ready() || !c.apiKey || !c.appId) { toast('חסרות הגדרות Google ב-config.js'); return; }
  try { await Auth.signIn(); } catch (e) { toast('ההתחברות לא הושלמה'); return; }
  await new Promise(res => { if (window.gapi && gapi.load) gapi.load('picker', res); else setTimeout(res, 800); });
  if (!window.google || !google.picker) { toast('בורר הקבצים לא נטען, נסי שוב'); return; }
  const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMode(google.picker.DocsViewMode.LIST);
  new google.picker.PickerBuilder().setAppId(c.appId).setOAuthToken(Auth.tok).setDeveloperKey(c.apiKey).setLocale('iw').addView(view)
    .setCallback(async d => {
      if (d.action !== google.picker.Action.PICKED) return;
      const f = d.docs[0]; S.cfg = { sheetId: f.id, sheetName: f.name }; LS.set('cfg', S.cfg); setupBridge();
      S.needAuth = false; S.budgetCfg = null; S.error = null;
      await connectFlow(); flush();
    }).build().setVisible(true);
}

function applyBudget(b) {
  S.ym = b.ym || 0; S.curYm = b.currentYm || 0; if (S.curYm && !LS.get('seenYm', 0)) LS.set('seenYm', S.curYm);   // התקנה ראשונה: בלי התרעה
  S.firstMonth = b.firstMonth || 0; S.month = b.month; S.startDay = b.startDay; S.current = { month: b.currentMonth, week: b.currentWeek };
  S.data = { fixed: b.fixed, variable: b.variable };
  S.preview = b.budgetFrozen === false;   // חודש עתידי: תצוגה מקדימה של התקציב
}

async function load(month, silent) {
  if (S.locked) return;
  if (!isLive() && !DEV) { S.loading = false; render(); return; }
  S.loading = true; S.error = null; if (!silent) render();
  try {
    if (isLive()) {
      const b = await call('budget', { month, rules: S.eomRules, decisions: S.decisions, deposits: S.deposits });
      const en = await call('entries', { month: b.month });
      applyBudget(b); S.entries = en.entries; S.lastSync = Date.now(); LS.set('lastSync', S.lastSync); LS.set('cache', { b, en: en.entries });
      pullPrefs(); pushPrefs();
    } else {
      await Demo.load();
      const b = Demo.budget(month); applyBudget(b);
      S.entries = Demo.entries().filter(e => finMonth(parseDT(e.dt), b.startDay) === b.month);
    }
  } catch (err) {
    if (err.code === 'auth') { S.needAuth = true; S.error = null; }
    else S.error = err instanceof TypeError ? 'אין חיבור לגיליון כרגע.' : err.code === 'access' ? 'אין גישה לגיליון. בחרי אותו שוב בהגדרות.' : 'שגיאה מהגיליון: ' + err.message;
    const c = isLive() && LS.get('cache', null);
    if (c && !S.data.fixed.length && !S.data.variable.length) { applyBudget(c.b); S.entries = c.en; }
  }
  S.loading = false; render();
}

/* ---------- נתונים ---------- */
function findItem(key) {
  for (const [isVar, groups] of [[true, S.data.variable], [false, S.data.fixed]])
    for (const g of groups) for (const item of g.items) if (item.key === key) return { group: g.name, item, isVar };
  return null;
}
const gInfo = name => { const g = GROUPS[name]; return g ? { i: g[0], c: COLORS[g[1]] } : { i: 'folder-3', c: COLORS[3] }; };
function sortedGroups(groups, tab) {
  const ord = S.order.g[tab] || [];
  const gs = groups.slice().sort((a, b) => (ord.indexOf(a.name) + 1 || 99) - (ord.indexOf(b.name) + 1 || 99));
  return gs.map(g => {
    const io = S.order.i[tab + '|' + g.name] || [];
    return { ...g, items: g.items.slice().sort((a, b) => (io.indexOf(a.key) + 1 || 99) - (io.indexOf(b.key) + 1 || 99)) };
  });
}
function view(item, isVar) {
  const wk = isVar && S.period === 'week' && S.month === S.current.month;
  const weekly = item.weekly || Math.round(item.budget / 4.3);
  const carry = wk ? 0 : (item.carry || 0), planned = wk ? weekly : item.budget;
  const eff = planned + carry, budget = Math.max(0, eff), spent = wk ? (item.weeks[S.current.week] || 0) : item.spent;
  const p = budget > 0 ? spent / budget : (spent > 0 ? 2 : 0);
  const st = p > 1.0000001 ? 'over' : (isVar && p >= 0.8 && p < 1) ? 'warn' : 'ok';
  return { budget, spent, p, st, carry, planned, left: eff - spent };
}
const tagsFor = key => { const set = new Set(S.tags[key] || []); S.entries.filter(e => e.key === key).forEach(e => (e.tags || []).forEach(t => set.add(t))); return [...set]; };

/* ---------- מסכים ---------- */
function agoText(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return 'לפני ' + m + ' דק׳';
  const d = new Date(ts), p = n => String(n).padStart(2, '0'), same = d.toDateString() === new Date().toDateString();
  return same ? 'בשעה ' + p(d.getHours()) + ':' + p(d.getMinutes()) : d.getDate() + '/' + (d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function syncPill() {
  if (!isLive()) return '';
  const busy = flushing || S.loading, n = S.pending.length, pill = (c, t) => `<span class="sync ${c}">${t}</span>`;
  const ago = agoText(S.lastSync), stale = S.lastSync && Date.now() - S.lastSync > 10 * 60000;
  if (S.needAuth) return pill('bad', 'לא מחובר' + (ago ? ' · עודכן ' + ago : ''));
  if (S.error) return /^אין חיבור/.test(S.error) ? pill('warn', 'אין חיבור' + (ago ? ' · עודכן ' + ago : '')) : pill('bad', 'שגיאה בגיליון');
  if (n) return busy ? pill('busy', 'שומר בגיליון…') : pill('warn', n + ' ממתינות');
  if (S.loading) return pill('busy', 'מתעדכן…');
  return stale ? pill('warn', 'עודכן ' + ago) : pill('ok', 'מעודכן ' + ago);
}

/* גרסה חדשה: בודקים אם הקובץ באתר שונה ממה שרץ עכשיו, ומציגים הודעה קטנה שלא חוסמת */
async function checkVersion() {
  try {
    const t = await (await fetch('app.js?v=' + Date.now(), { cache: 'no-store' })).text();
    const m = /\/\*v\*\/'([^']+)'/.exec(t);
    if (m && m[1] !== APP_VERSION && !S.newVersion) { S.newVersion = m[1]; if (S.screen === 'home' && !S.sheet) render(); }
  } catch { /* בלי רשת: לא קריטי */ }
}
function newVersionNotice() {
  return S.newVersion ? `<div class="banner soft nv"><i class="ri-refresh-fill"></i><span>יש גרסה חדשה של האפליקציה</span><button class="go" data-act="reloadApp">לרענון</button></div>` : '';
}
function newMonthNotice() {
  if (!isLive() || !S.curYm || S.ym !== S.curYm || S.month === S.firstMonth) return '';
  const seen = LS.get('seenYm', 0);
  if (!seen || seen >= S.curYm) return '';
  const prev = S.month === 1 ? 12 : S.month - 1;
  return `<div class="banner soft"><i class="ri-calendar-event-fill"></i><span>סיכום ${MONTHS[prev - 1]} מחכה לך</span><button class="go" data-act="summaryPrev">לסיכום</button><button class="x" data-act="dismissNew" aria-label="סגירה">${icon('close')}</button></div>`;
}
function banners() {
  let h = newVersionNotice() + newMonthNotice();
  if (!isLive() && DEV) h += `<div class="banner urgent"><i class="ri-link-unlink"></i><span><b>לא מחובר לגיליון</b></span><button class="go" data-act="pick">להתחבר לגיליון</button></div>`;
  if (S.needAuth) h += `<div class="banner urgent"><i class="ri-link-unlink"></i><span><b>לא מחובר לגיליון</b></span><button class="go" data-act="signin">להתחבר לגיליון</button></div>`;
  if (S.pending.length) h += `<div class="banner"><i class="ri-cloud-off-fill"></i><span><b>${S.pending.length} הוצאות ממתינות</b> לסנכרון עם הגיליון.</span><button class="go" data-act="retry">נסי שוב</button></div>`;
  if (S.error) h += `<div class="banner err"><i class="ri-error-warning-fill"></i><span>${esc(S.error)}</span><button class="go" data-act="retry">נסי שוב</button></div>`;
  return h;
}

const matchQ = (g, i, q) => !q || g.name.includes(q) || i.name.includes(q);
function groupHtml(g, isVar, q) {
  const gi = gInfo(g.name);
  return `<section class="cat" data-g="${esc(g.name)}" style="--c:${gi.c}">
      <div class="ch"><span class="ci">${icon(gi.i)}</span><b>${esc(g.name)}</b>${q ? '' : `<span class="grip">${icon('draggable')}</span>`}</div>
      <div class="sg" data-g="${esc(g.name)}">${g.items.map(i => card(i, isVar)).join('')}</div></section>`;
}
function loadingHtml() {
  const card = (c, n) => `<section class="cat skc" style="--c:${c}"><div class="ch"><span class="ci">${SHEETS_ICON}</span><b>טוען מהגיליון<span class="dots"><i></i><i></i><i></i></span></b></div>
    <div class="sg">${Array.from({ length: n }, () => '<div class="sc sk0"><div class="sl"></div><div class="sl s2"></div></div>').join('')}</div></section>`;
  return `<div aria-live="polite">${card(COLORS[0], 3)}${card(COLORS[1], 2)}${card(COLORS[2], 2)}</div>`;
}
function catsHtml() {
  const q = S.q.trim();
  if (q) {   // חיפוש: גם בשוטפות וגם בקבועות בו זמנית
    const sec = (title, list, isVar) => { const gs = list.map(g => ({ ...g, items: g.items.filter(i => matchQ(g, i, q)) })).filter(g => g.items.length); return gs.length ? `<div class="secl">${title}</div>` + gs.map(g => groupHtml(g, isVar, q)).join('') : ''; };
    return sec('שוטפות', S.data.variable, true) + sec('קבועות', S.data.fixed, false) || '<div class="empty">לא נמצאה קטגוריה</div>';
  }
  const isVar = S.tab === 'var';
  const list = isVar ? S.data.variable : S.data.fixed;
  if (S.loading && !list.length) return loadingHtml();
  const groups = sortedGroups(list, S.tab);
  return groups.length ? groups.map(g => groupHtml(g, isVar, '')).join('') : '<div class="empty">אין שורות עם תקציב בעמודה F.<br>ממלאים סכומים בגיליון, והן יופיעו כאן.</div>';
}
function renderCats() {
  const el = $('#cats'); if (!el) return;
  el.innerHTML = catsHtml();
  const tb = $('#tabs'); if (tb) tb.hidden = !!S.q.trim();
  initSort();
  const off = !!S.q.trim(), c = window.Sortable && Sortable.get(el); if (c) c.option('disabled', off);
  el.querySelectorAll('.sg').forEach(g => { const x = window.Sortable && Sortable.get(g); if (x) x.option('disabled', off); });
}

function home() {
  const isVar = S.tab === 'var';
  const groups = sortedGroups(isVar ? S.data.variable : S.data.fixed, S.tab);
  const total = groups.reduce((a, g) => a + g.items.reduce((x, i) => x + view(i, isVar).budget, 0), 0);
  const cur = S.month === S.current.month;
  return `
  <div class="top"><span class="app">מעקב הוצאות עם מאיה<span id="sp">${syncPill()}</span></span>${isLive() ? `<button class="gb" data-act="lock" aria-label="יציאה מהתקציב">${icon('lock')}</button>` : ''}</div>
  <div class="mt ${showSummary() ? 'hs' : ''}"><button class="st" data-act="prev" ${S.month <= 1 ? 'disabled' : ''} aria-label="חודש קודם">${icon('arrow-right-s')}</button>
    <b>${MONTHS[S.month - 1] || ''} ${new Date().getFullYear()}</b>
    <button class="st" data-act="next" ${S.month >= 12 ? 'disabled' : ''} aria-label="חודש הבא">${icon('arrow-left-s')}</button>
    ${showSummary() ? `<button class="sumbtn" data-act="summary">${icon('file-list-3')}סיכום ${S.curYm && S.ym < S.curYm ? (MONTHS[S.month - 1] || 'חודש') : 'החודש'}</button>` : ''}</div>
  ${banners()}
  ${searchField('hq', 'חיפוש בשוטפות ובקבועות', S.q, 'clearQ')}
  <div id="tabs" ${S.q.trim() ? 'hidden' : ''}>
  <div class="seg"><button data-act="tab" data-v="var" class="${isVar ? 'on' : ''}">שוטפות</button><button data-act="tab" data-v="fixed" class="${!isVar ? 'on' : ''}">קבועות</button></div>
  ${isVar ? `<div class="seg sm"><button data-act="period" data-v="week" class="${S.period === 'week' ? 'on' : ''}" ${cur ? '' : 'disabled'}>שבוע</button><button data-act="period" data-v="month" class="${S.period === 'month' || !cur ? 'on' : ''}">חודש</button></div>` : ''}
  <div class="bu2"><span>תקציב ${isVar ? 'שוטפות' : 'קבועות'} <b class="num">${fmt(total)}</b>${S.preview ? ' · תצוגה מקדימה' : ''}</span></div>
  </div>
  <div class="cats" id="cats">${catsHtml()}</div>
  ${nav()}`;
}

function card(item, isVar) {
  const v = view(item, isVar);
  const alert = v.st === 'over' ? `<div class="al pink">${v.carry < 0 ? 'במינוס' : 'חריגה של'} <span class="num">${fmt(v.left)}</span></div>` : v.st === 'warn' ? '<div class="al amb">מתקרבת לתקרה</div>' : '';
  return `<div class="sc ${v.st === 'over' ? 'ov' : ''}" data-act="open" data-k="${esc(item.key)}">
    <div class="tp"><div class="nm">${esc(item.name)}</div><button class="pls" data-act="add" data-k="${esc(item.key)}" aria-label="הוספת הוצאה ל${esc(item.name)}">+</button></div>
    <div class="am"><b class="num">${fmt(v.spent)}</b><span>מתוך <span class="num">${fmt(v.budget)}</span></span></div>
    ${v.p > 0 ? `<div class="ln"><i style="width:${Math.min(100, v.p * 100)}%"></i></div>` : ""}${alert}</div>`;
}

function nav() {
  return `<nav class="nav"><button class="${S.screen === 'home' ? 'on' : ''}" data-act="home">${icon('home-5')}בית</button><button class="fab" data-act="fab" aria-label="הוספת הוצאה">+</button><button class="${S.screen === 'settings' || S.screen === 'eom' ? 'on' : ''}" data-act="settings">${icon('settings-3')}הגדרות</button></nav>`;
}

const EMPTY_ART = '<svg class="noexp" viewBox="0 0 120 84" width="108" height="76" aria-hidden="true"><rect x="8" y="10" width="104" height="66" rx="12" fill="none" stroke="currentColor" stroke-width="4"/><path d="M8 30 H112" stroke="currentColor" stroke-width="4"/><path d="M22 56 H46" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M18 74 L102 8" stroke="#FAF8F4" stroke-width="10" stroke-linecap="round"/><path d="M18 74 L102 8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>';   // כרטיס אשראי עם קו: אין הוצאות
function detail() {
  const f = findItem(S.detailKey);
  if (!f) { S.screen = 'home'; return home(); }
  const { group, item, isVar } = f, gi = gInfo(group), v = view(item, isVar), eff = item.budget + (item.carry || 0), left = eff - item.spent;
  const ents = S.entries.filter(e => e.key === item.key).sort((a, b) => b.dt.localeCompare(a.dt));
  const multi = new Set(S.entries.map(e => e.by).filter(Boolean)).size > 1;
  const byTag = {}; ents.forEach(e => (e.tags || []).forEach(t => { byTag[t] = (byTag[t] || 0) + e.amount; }));
  const tagRows = Object.entries(byTag).sort((a, b) => b[1] - a[1]);
  const mx = tagRows.length ? tagRows[0][1] : 1;
  const alert = v.st === 'over' ? `<div class="al pink" style="margin-top:12px">חריגה של <span class="num">${fmt(v.spent - v.budget)}</span></div>` : v.st === 'warn' ? '<div class="al amb" style="margin-top:12px">מתקרבת לתקרה</div>' : '';
  return `
  <div class="dh"><button class="gb" data-act="back" aria-label="חזרה">${icon('arrow-right-s')}</button></div>
  <div class="dt" style="--c:${gi.c}"><span class="ci">${icon(gi.i)}</span><div><b>${esc(item.name)}</b><span>${esc(group)} · ${MONTHS[S.month - 1]}</span></div></div>
  <div class="card dcard" style="--c:${gi.c}">
    <div class="dtop"><span class="ico">${icon('bank-card')}</span><div><small>הוצאתי החודש</small><b class="big num">${fmt(item.spent)}</b></div><span class="pct ${v.st === 'over' ? 'over' : ''}">${Math.round(eff > 0 ? item.spent / eff * 100 : (item.spent > 0 ? 100 : 0))}%</span></div>
    <div class="ln thick"><i style="width:${Math.min(100, eff > 0 ? item.spent / eff * 100 : (item.spent > 0 ? 100 : 0))}%;background:${v.st === 'over' ? 'var(--pink)' : 'var(--ink)'}"></i></div>
    ${item.carry ? `<p class="cx">${item.carry > 0 ? `נשארו <span class="num">${fmt(item.carry)}</span> מהחודש הקודם, והם התווספו לתקציב החודש.` : `היה חוסר של <span class="num">${fmt(-item.carry)}</span> בחודש הקודם, והוא הופחת מהתקציב החודש.`}</p>` : ''}
    ${left < 0 && ruleFor(item.key) === 'aside' ? '<p class="cx neg">הסעיף במינוס, ולכן אי אפשר להפקיד. ההפקדה תחכה עד שיהיה פלוס.</p>' : ''}
    <div class="dstats ${item.carry ? 'c3' : ''}"><div><small>התקציב</small><b class="num">${fmt(item.budget)}</b></div>${item.carry ? `<div><small>מגולגל</small><b class="num">${item.carry > 0 ? '+' : '−'}${fmt(Math.abs(item.carry)).replace('−', '')}</b></div>` : ''}${left >= 0 ? `<div><small>נשאר</small><b class="num">${fmt(left)}</b></div>` : `<div class="ov"><small>${item.carry < 0 ? 'במינוס' : 'חריגה'}</small><b class="num">${fmt(left)}</b></div>`}</div>
    ${(() => {
      const d = (S.deposits[S.ym] || {})[item.key], dueAmt = left - Math.max(0, item.carry || 0), can = dueAmt > 0.005 && ruleFor(item.key) === 'aside' && ((S.curYm && S.ym < S.curYm) || showSummary() === 'now');
      if (d) return `<div class="dpbox done">${icon('checkbox-circle')}<span>הופקד <b class="num">${fmt(d.amt)}</b> · ${esc(d.day)}${item.carry > 0.005 ? `<small style="display:block">בחשבון הנפרד אמורים להיות בסך הכול <span class="num">${fmt(left)}</span></small>` : ''}</span><button class="lnk" data-act="undepo" data-k="${esc(item.key)}">ביטול</button></div>`;
      return can ? `<div class="dpbox"><p class="why">מכיוון שלא משתמשים בסעיף הזה בכל חודש, מומלץ להעביר את היתרה לחשבון נפרד, כדי שתישמר עד שתצטרכו אותה.<br><br>ההפקדה לא נחשבת הוצאה: הכסף נשאר שלך ומופיע בחודש הבא ב"נשאר".${item.carry > 0.005 ? `<br><br><b>בחשבון הנפרד אמורים להיות בסך הכול <span class="num">${fmt(left)}</span></b> אחרי ההפקדה (<span class="num">${fmt(item.carry)}</span> מחודשים קודמים ועוד <span class="num">${fmt(dueAmt)}</span> מהחודש).` : ''}</p><button class="chk" data-act="depo" data-k="${esc(item.key)}" data-v="${Math.round(dueAmt * 100) / 100}">${icon('coins')}הפקדתי <b class="num">${fmt(dueAmt)}</b></button></div>` : '';
    })()}
    ${v.st === 'warn' ? '<div class="al amb" style="margin-top:12px">מתקרבת לתקרה</div>' : ''}</div>
  ${tagRows.length ? `<div class="secl">לפי תגית</div><div class="tgl">${tagRows.map(([t, a]) => `<div class="tr"><div><span>${esc(t)}</span><span class="tp2"><b class="num">${fmt(a)}</b><em>${Math.round(item.spent > 0 ? a / item.spent * 100 : 0)}%</em></span></div><div class="ln"><i style="width:${a / mx * 100}%"></i></div></div>`).join('')}</div>` : ''}
  ${ents.length ? '<div class="secl">ההוצאות החודש</div>' : ''}
  <div class="list">${ents.length ? ents.map(e => { const w = whenText(e.dt); return `<div class="e"><div>${esc(w.day)}<div class="tm"><span class="num">${w.time}</span></div>${(e.tags || []).length ? `<div class="etg">${e.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}${e.note ? `<div class="en">${esc(e.note)}</div>` : ''}${multi && e.by ? `<div class="by">נוסף ע״י ${esc(e.by)}</div>` : ''}</div>
      <div class="ac"><b class="num">${fmt(e.amount)}</b><button data-act="edit" data-id="${esc(e.id)}" aria-label="עריכה">${icon('pencil')}</button><button data-act="del" data-id="${esc(e.id)}" aria-label="מחיקה">${icon('delete-bin-6')}</button></div></div>`; }).join('') : `<div class="emptyx">${EMPTY_ART}<p>עוד אין הוצאות החודש</p></div>`}</div>
  <div style="padding:var(--s4)"><button class="btn" data-act="add" data-k="${esc(item.key)}">+ הוספת הוצאה</button></div>
  ${nav()}`;
}

const EOM = { carry: 'לגלגל לחודש הבא', aside: 'לשים בצד', ask: 'לשאול' };
const EOM_HELP = [
  ['לגלגל לחודש הבא', 'היתרה עוברת לתקציב החודש הבא.'],
  ['לשים בצד', 'היתרה מועברת לחשבון נפרד. אם הסעיף במינוס אי אפשר להפקיד, והחוסר מתגלגל עד שיהיה פלוס.'],
  ['לשאול', 'בסוף החודש האפליקציה שואלת מה לעשות.']
];
const eomRule = k => { const v = S.eomRules[k]; return v === 'box' ? 'aside' : v === 'part' ? 'ask' : EOM[v] ? v : ''; };   // ערכים מגרסאות קודמות
/* ---------- סיכום חודש: חריגות, היתרה שלא נוצלה, הפקדות בצד, והחלטות ---------- */
const LARGE_CARRY = 300;   // מגולגל מעל הסכום הזה מקבל התרעה עם המלצה להפקיד
const ruleFor = key => (S.decisions[S.ym] && S.decisions[S.ym][key]) || eomRule(key);
const nowDay = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getDate() + '/' + (d.getMonth() + 1); };
/* סיכום החודש מופיע רק ביום האחרון של החודש הפיננסי (בהדגמה תמיד, לבדיקה) */
function showSummary() {
  if (DEV && !isLive()) return 'now';
  if (S.curYm && S.ym < S.curYm) return 'now';                       // צפייה בחודש שעבר: הסיכום שלו
  if (S.month !== S.current.month) return false;
  const t = new Date(), tm = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
  return finMonth(tm, S.startDay || 1) !== finMonth(t, S.startDay || 1) ? 'now' : false;   // היום האחרון של החודש
}
function summaryRows() {
  const rows = [];
  [['שוטפות', S.data.variable], ['קבועות', S.data.fixed]].forEach(([t, gs]) => gs.forEach(g => g.items.forEach(i => rows.push({ ...i, group: g.name, type: t, rule: ruleFor(i.key) }))));
  return rows;
}
function depToggle(key, val) {
  const d = (S.deposits[S.ym] || {})[key];
  return d ? `<button class="chk on" data-act="undepo" data-k="${esc(key)}" aria-label="ביטול סימון">${icon('check')}הופקד · ${esc(d.day)}</button>` : `<button class="chk" data-act="depo" data-k="${esc(key)}" data-v="${Math.round(val * 100) / 100}">${icon('coins')}הפקדתי</button>`;
}
function summaryScreen() {
  const rows = summaryRows(), dep = S.deposits[S.ym] || {};
  const left = r => r.budget + (r.carry || 0) - r.spent;     // היתרה (או החוסר) מול התקציב של החודש, כולל מה שגולגל אליו
  const E = 0.005, desc = (list, f) => list.slice().sort((x, y) => Math.abs(f(y)) - Math.abs(f(x)));   // מהסכום הגדול לקטן
  const over = desc(rows.filter(r => left(r) < -E), left), under = desc(rows.filter(r => left(r) > E), left);
  const tag = r => ({ carry: 'מתגלגל', aside: 'לשים בצד', ask: 'לשאול' }[r.rule] || 'לא נבחר');
  const notAside = under.filter(r => r.rule !== 'aside');
  const unspent = notAside.reduce((a, r) => a + left(r), 0);
  const due = r => left(r) - Math.max(0, r.carry || 0);   // להפקדה: רק מה שחדש החודש, מה שהופקד קודם כבר בחשבון הנפרד
  const asideRows = desc(rows.filter(r => r.rule === 'aside' && due(r) > E), due);
  const negAside = desc(rows.filter(r => r.rule === 'aside' && left(r) < -E), left);
  const askRows = desc(rows.filter(r => r.rule === 'ask' && left(r) > E), left);   // רק מי שבחרת עבורו "לשאול"
  const carryPos = rows.filter(r => r.rule === 'carry' && left(r) > E).reduce((a, r) => a + left(r), 0);
  const bigCarry = carryPos >= LARGE_CARRY;
  const done = S.curYm && S.ym < S.curYm;
  const amt = n => `<b class="num">${fmt(Math.abs(n))}</b>`;
  const rd = n => Math.round(n * 100) / 100;
  const toggle = (key, val) => { const d = dep[key]; return d ? `<button class="chk on" data-act="undepo" data-k="${esc(key)}" aria-label="ביטול סימון">${icon('check')}הופקד · ${esc(d.day)}</button>` : `<button class="chk" data-act="depo" data-k="${esc(key)}" data-v="${rd(val)}">${icon('coins')}הפקדתי</button>`; };
  const depRow = r => `<div class="er"><span class="en2">${esc(r.name)}<small class="ea">${esc(r.group)}${r.carry > 0.005 ? ` · בחשבון הנפרד אמורים להיות בסך הכול ${fmt(left(r))}` : ''}</small></span><div class="dpr">${amt(dep[r.key] ? dep[r.key].amt : due(r))}${toggle(r.key, due(r))}</div></div>`;
  const carryRow = `<div class="er hot"><span class="en2"><b>להפקיד בצד את הכסף שלא הוצאת</b><small class="ea">נשארו כמה מאות שקלים, כדאי לשמור אותם בצד כדי שיהיה ממה לשלם בחודש הבא.</small></span><div class="dpr">${amt(dep._carry ? dep._carry.amt : carryPos)}${toggle('_carry', carryPos)}</div></div>`;
  const negRow = r => `<div class="er negrow"><span class="en2">${esc(r.name)}<small class="ea">${esc(r.group)}</small></span><b class="num neg">${fmt(left(r))}</b></div>`;
  const askRow = r => `<div class="er"><span class="en2">${esc(r.name)}<small class="ea">נשאר ${fmt(left(r))}</small></span><div class="seg3"><button data-act="decide" data-k="${esc(r.key)}" data-v="carry">לגלגל</button><button data-act="decide" data-k="${esc(r.key)}" data-v="aside">לשים בצד</button></div></div>`;
  const line = (r, val, note) => `<div class="al2"><span>${esc(r.name)}<small>${esc(r.group)}</small></span><span class="v">${note ? `<em>${note}</em>` : ''}<b class="num ${val < 0 ? 'neg' : ''}">${fmt(val)}</b></span></div>`;
  const acc = (title, n, html, cls, sub, open) => `<details class="acc ${cls || ''}"${open ? ' open' : ''}><summary><span>${title}${sub ? `<small>${sub}</small>` : ''}</span><b class="num">${n}</b>${icon('arrow-down-s')}</summary><div class="accl">${html || '<p class="sp">אין</p>'}</div></details>`;
  const sec = (title, list, row, note) => list.length ? `<div class="secl">${title}</div><section class="sc2 eg sr">${note ? `<p class="sp" style="margin-top:0">${note}</p>` : ''}${list.map(row).join('')}</section>` : '';
  const showDeposit = asideRows.length || negAside.length;
  return `
  <div class="dh"><button class="gb" data-act="home" aria-label="חזרה">${icon('arrow-right-s')}</button></div>
  <div class="dt"><div><b>סיכום ${MONTHS[S.month - 1] || ''}</b><span>${done ? 'החודש הסתיים' : 'החודש עוד לא הסתיים, הנתונים עד עכשיו'}</span></div></div>
  <div class="ps" id="ps">${prefsStatusHtml()}</div>
  <section class="sc2 accs">
    ${acc('חרגו מהתקציב', over.length, over.map(r => line(r, left(r), r.rule === 'carry' || r.rule === 'aside' || r.rule === 'ask' ? 'יגולגל כחוסר' : '')).join(''), 'over')}
    ${acc('הוצאו פחות מהמתוכנן', under.length, under.map(r => line(r, left(r), tag(r))).join(''))}
    ${acc('נשאר כסף שלא הוצא', fmt(unspent), (bigCarry ? carryRow : '') + notAside.map(r => line(r, left(r), tag(r))).join(''), '', 'לא כולל מה שמופקד בצד', bigCarry)}
  </section>
  ${showDeposit ? `<div class="secl">להפקיד בצד</div><section class="sc2 eg sr">${asideRows.length ? `<p class="sp">כסף שנשאר בסעיפים שבחרת לשים בצד.<br>הפקדה לא נחשבת הוצאה: היא רק מונעת מהכסף להתערבב בשוטף, והיתרה ממשיכה לחודש הבא. סמני אחרי שהפקדת בפועל.</p>${asideRows.map(depRow).join('')}` : ''}${negAside.length ? `<p class="sp">הסעיפים האלה במינוס. אי אפשר להפקיד מינוס, אז החוסר מתגלגל לחודש הבא וההפקדה תחכה עד שיהיה פלוס.</p>${negAside.map(negRow).join('')}` : ''}</section>` : ''}
  ${sec('צריך להחליט', askRows, askRow, 'מה לעשות עם מה שנשאר בסעיפים האלה.')}
  ${nav()}`;
}
function eomItems() { return [['שוטפות', S.data.variable], ['קבועות', S.data.fixed]]; }
function eomCounts() {
  const c = { carry: 0, aside: 0, ask: 0 };
  eomItems().forEach(([, gs]) => gs.forEach(g => g.items.forEach(i => { const r = eomRule(i.key); if (r) c[r]++; })));
  return c;
}
const cnt = n => n === 1 ? 'סעיף אחד' : n + ' סעיפים';
function eomSummary() {   // מה שהוגדר עם וי, ואם יש סעיפים שעוד לא נבחרו: עיגול אדום עם המספר שלהם
  const c = eomCounts(), total = eomItems().reduce((n, [, gs]) => n + gs.reduce((m, g) => m + g.items.length, 0), 0), unsel = total - c.carry - c.aside - c.ask;
  const lines = [['carry', 'לגלגל לחודש הבא'], ['aside', 'לשים בצד'], ['ask', 'לשאול']].filter(([k]) => c[k] > 0);
  if (!lines.length && !unsel) return '<p class="sp" style="margin-top:0">עוד לא הוגדרו סעיפים.</p>';
  const rows = lines.map(([k, t]) => `<div class="eol"><i class="ri-checkbox-circle-fill"></i><b class="tg">${t}</b><b class="cn">${cnt(c[k])}</b></div>`);
  if (unsel > 0) rows.push(`<div class="eol bad"><i class="ri-close-circle-fill"></i><b class="tg">${unsel === 1 ? 'לא נבחר' : 'לא נבחרו'}</b><b class="cn">${cnt(unsel)}</b></div>`);
  return `<div class="eoml">${rows.join('')}</div>`;
}
function eomRows() {
  const q = S.eq.trim();
  const seg = k => `<div class="seg3">${Object.keys(EOM).map(v => `<button class="${eomRule(k) === v ? 'on' : ''}" data-act="eomSet" data-k="${esc(k)}" data-v="${v}">${EOM[v]}</button>`).join('')}</div>`;
  const left = i => `<small class="ea">תקציב <span class="num">${fmt(i.budget)}</span></small>`;   // רק התקציב, בלי המצב הנוכחי
  const out = eomItems().map(([t, gs]) => {
    const list = gs.map(g => ({ ...g, items: g.items.filter(i => matchQ(g, i, q)) })).filter(g => g.items.length);
    return list.length ? `<div class="secl">${t}</div>` + list.map(g => `<div class="sc2 eg"><div class="egh">${esc(g.name)}</div>${g.items.map(i => `<div class="er"><span class="en2">${esc(i.name)}${left(i)}</span>${seg(i.key)}</div>`).join('')}</div>`).join('') : '';
  }).join('');
  return out || (q ? '<div class="empty">לא נמצא סעיף</div>' : '<div class="empty">הסעיפים ייטענו אחרי החיבור לגיליון.</div>');
}
function eomScreen() {
  const all = []; eomItems().forEach(([, gs]) => gs.forEach(g => g.items.forEach(i => all.push(eomRule(i.key)))));
  const allCur = all.length && all.every(x => x === all[0]) ? all[0] : '';
  const segAll = `<div class="seg3">${Object.keys(EOM).map(v => `<button class="${allCur === v ? 'on' : ''}" data-act="eomAll" data-v="${v}">${EOM[v]}</button>`).join('')}</div>`;
  return `
  <div class="dh"><button class="gb" data-act="settings" aria-label="חזרה">${icon('arrow-right-s')}</button></div>
  <div class="dt"><div><b>סוף חודש</b><span>מה עושים עם היתרה בכל סעיף</span></div></div>
  <div class="ps" id="ps">${prefsStatusHtml()}</div>
  <section class="sc2 help">${EOM_HELP.map(([t, d]) => `<div class="hl"><b>${t}</b><span>${d}</span></div>`).join('')}</section>
  <section class="sc2 eg"><div class="er"><span class="en2"><b>עדכון סוף חודש לכל הסעיפים</b><small class="ea">בחירה כאן משנה את כולם</small></span>${segAll}</div></section>
  ${searchField('eq', 'חיפוש סעיף', S.eq, 'clearEq')}
  <div id="eomrows">${eomRows()}</div>
  <div class="foot">הבחירה נשמרת בגיליון, ומתעדכנת בכל המכשירים.</div>
  ${nav()}`;
}
function settings() {
  const live = isLive();
  const when = S.lastSync ? new Date(S.lastSync).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  return `
  <div class="dh"><button class="gb" data-act="back" aria-label="חזרה">${icon('arrow-right-s')}</button></div>
  <div class="dt"><div><b>הגדרות</b></div></div>

  <section class="sc2">
    <div class="sh2">${icon('links')}<b>חיבור לגיליון</b></div>
    <div class="status"><span class="dot ${live ? (S.error ? 'bad' : 'ok') : ''}"></span><b>${live ? 'מחובר' : 'לא מחובר'}</b></div>
    ${live ? `<p class="sp">${esc(S.cfg.sheetName || S.cfg.sheetId)}<br>סנכרון אחרון: ${esc(when)} · החודש מתחיל ביום ${S.startDay}</p>` : ''}
    ${!Auth.ready() ? '<p class="sp">חסרה הגדרת Google באפליקציה (קובץ config.js).</p>' : `<div class="brow">${live && !Auth.valid() ? '<button class="btn sm" data-act="signin">התחברות מחדש</button>' : ''}<button class="btn sm o" data-act="pick">${live ? 'החלפת גיליון' : 'התחברות עם גוגל'}</button>${live ? '<button class="btn sm danger" data-act="disconnect">ניתוק</button>' : ''}</div>`}
  </section>

  ${live ? `<section class="sc2">
    <div class="sh2">${icon('user-3')}<b>השם שלי</b></div>
    <p class="sp">אם כמה אנשים מוסיפים הוצאות באותו גיליון (למשל בני זוג), ליד כל הוצאה יופיע מי הוסיף אותה.</p>
    <input id="whoName" class="inp" type="text" maxlength="24" placeholder="למשל: מאיה" value="${esc(S.who)}" autocomplete="off">
  </section>

  <section class="sc2">
    <div class="sh2">${icon('lock')}<b>נעילה</b></div>
    <p class="sp">יציאה מהתקציב מסתירה את הנתונים מהמסך, והגיליון נשאר מחובר. הכניסה מחדש ${PIN.get() ? 'דורשת קוד.' : 'היא עם גוגל. מומלץ להגדיר קוד, כי בלעדיו מי שמחזיק במכשיר המחובר לגוגל יכול להיכנס.'}</p>
    <div class="brow"><button class="btn sm" data-act="lock">יציאה מהתקציב</button><button class="btn sm o" data-act="pinSetup">${PIN.get() ? 'שינוי קוד' : 'הגדרת קוד'}</button>${PIN.get() ? '<button class="btn sm danger" data-act="pinRemove">הסרת קוד</button>' : ''}</div>
  </section>` : ''}

  <section class="sc2">
    <div class="sh2">${icon('table')}<b>עמודת התקציב</b></div>
    ${budgetBlock()}
  </section>

  <section class="sc2">
    <div class="sh2">${icon('calendar-check')}<b>סוף חודש</b></div>
    <p class="sp">לכל סעיף בוחרים מה קורה עם היתרה שלו בסוף החודש.</p>
    ${eomSummary()}
    <button class="btn sm o" data-act="eomScreen">${(() => { const c = eomCounts(); return c.carry + c.aside + c.ask > 0 ? 'עדכון סעיפים' : 'הגדרת הסעיפים'; })()}</button>
  </section>

  ${!live && DEV ? `<section class="sc2"><div class="sh2">${icon('flask')}<b>הדגמה (פיתוח)</b></div><div class="brow"><button class="btn sm o" data-act="sample">הוצאות לדוגמה</button><button class="btn sm danger" data-act="resetDemo">איפוס</button></div></section>` : ''}
  <div class="foot">גרסה <span class="num">${APP_VERSION}</span></div>
  ${nav()}`;
}

/* ---------- נעילה: יציאה מהתקציב בלי לנתק את הגיליון ---------- */
const APP_VERSION = /*v*/'4.4 · 9.11';   // מתעדכן בכל שחרור, כדי לראות בטלפון שהגרסה החדשה נטענה
const PIN = {
  get() { return LS.get('pin', null); },
  async hash(pin, salt) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)); return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join(''); },
  async set(pin) { const salt = [...crypto.getRandomValues(new Uint32Array(3))].join('-'); LS.set('pin', { s: salt, h: await this.hash(pin, salt) }); },
  async check(pin) { const p = this.get(); return !!p && (await this.hash(pin, p.s)) === p.h; },
  clear() { try { localStorage.removeItem('pin'); } catch { /* מצב פרטי */ } }
};
function lockApp() {
  closeSheet();
  // בכוונה בלי revoke: ביטול ההרשאה מוחק את הרשאת הגיליון, והכניסה הבאה הייתה מבקשת הרשאות ובחירת גיליון מחדש
  S.locked = true; LS.set('locked', true);
  S.data = { fixed: [], variable: [] }; S.entries = []; S.budgetCfg = null; S.q = ''; S.eq = ''; S.lastSync = null; S.error = null;
  Auth.tok = null; Auth.exp = 0; TOK.clear();
  ['cache', 'lastSync'].forEach(k => { try { localStorage.removeItem(k); } catch { /* מצב פרטי */ } });
  S.screen = 'home'; S.pinEntry = ''; S.pinMsg = ''; S.lockStage = 'welcome'; render();
}
async function finishUnlock() {
  try { await Auth.signIn(); } catch { S.pinMsg = 'ההתחברות לגוגל לא הושלמה. נסי שוב.'; S.error = S.lockStage === 'pin' ? null : S.pinMsg; render(); return; }
  S.locked = false; LS.set('locked', false); S.lockStage = 'welcome'; S.pinMsg = ''; S.pinEntry = ''; S.needAuth = false; S.error = null; render();
  await load(S.month); flush();
}
const pinDots = n => `<div class="dots4">${[0, 1, 2, 3].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;
const pinPad = () => `<div class="pinpad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(k => k === '' ? '<span></span>' : `<button data-act="${k === '⌫' ? 'pinDel' : 'pin'}" data-v="${k}">${k}</button>`).join('')}</div>`;
function lockScreen() {
  if (S.lockStage !== 'pin') return onboarding(true);
  return `<div class="dh"><button class="gb" data-act="lockBack" aria-label="חזרה">${icon('arrow-right-s')}</button></div>
  <div class="lockw" style="padding-top:var(--s3)"><div class="lk">${icon('lock')}</div><h2>הקלידי את הקוד</h2>
    ${pinDots(S.pinEntry.length)}<div class="pmsg">${esc(S.pinMsg)}</div>${pinPad()}<button class="lnk" data-act="pinForgot">שכחתי קוד</button></div>`;
}
async function resetPin() {
  if (!confirm('לאפס את הקוד? תתחברי מחדש עם גוגל והקוד יימחק. אפשר להגדיר קוד חדש בהגדרות. הנתונים בגיליון לא נפגעים.')) return;
  try { await Auth.request('select_account'); } catch { S.pinMsg = 'ההתחברות לגוגל לא הושלמה. הקוד לא אופס.'; render(); return; }
  PIN.clear(); S.pinFail = 0; S.pinUntil = 0; S.locked = false; LS.set('locked', false); S.lockStage = 'welcome'; S.pinMsg = ''; S.pinEntry = ''; S.needAuth = false; S.error = null;
  render(); toast('הקוד אופס. אפשר להגדיר קוד חדש בהגדרות.'); await load(S.month); flush();
}
function pinSetupScreen() {
  const st = S.pinSetup || { step: 1 };
  return `<div class="dh"><button class="gb" data-act="settings" aria-label="חזרה">${icon('arrow-right-s')}</button></div>
  <div class="lockw" style="padding-top:var(--s3)"><div class="lk">${icon('key-2')}</div><h2>${st.step === 1 ? 'בחרי קוד בן 4 ספרות' : 'הקלידי שוב לאישור'}</h2>
    ${pinDots(S.pinEntry.length)}<div class="pmsg">${esc(S.pinMsg)}</div>${pinPad()}</div>`;
}
async function pinPress(v) {
  if (S.pinUntil > Date.now()) return;
  S.pinEntry += v; S.pinMsg = '';
  if (S.pinEntry.length < 4) { render(); return; }
  const code = S.pinEntry; render();   // הספרה הרביעית מתמלאת לפני הבדיקה
  S.pinEntry = '';
  if (S.screen === 'pinsetup') {
    const st = S.pinSetup || (S.pinSetup = { step: 1, first: '' });
    if (st.step === 1) { st.first = code; st.step = 2; render(); return; }
    if (code === st.first) { await PIN.set(code); S.pinSetup = null; S.screen = 'settings'; render(); toast('הקוד נשמר'); }
    else { st.step = 1; st.first = ''; S.pinMsg = 'הקודים לא תואמים. נסי שוב.'; render(); }
    return;
  }
  if (await PIN.check(code)) { S.pinFail = 0; finishUnlock(); return; }
  S.pinFail++;
  if (S.pinFail >= 5) { S.pinUntil = Date.now() + 30000; S.pinFail = 0; S.pinMsg = 'יותר מדי ניסיונות. נסי שוב בעוד 30 שניות.'; } else S.pinMsg = 'קוד שגוי';
  render();
}

const ymLabel = ym => MONTHS[(ym % 100) - 1];
function budgetBlock() {
  if (!isLive()) return `<p class="sp">אחרי החיבור אפשר לבחור לאיזו עמודה בגיליון להתייחס. שינוי חל רק מהחודש הבא.</p>`;
  const c = S.budgetCfg;
  if (!c) return `<p class="sp">טוען…</p>`;
  const sel = c.pending ? c.pending.col : c.current;
  return `<div class="selw"><select id="cfgCol" class="sel">${c.columns.map(x => `<option value="${x.col}" ${x.col === sel ? 'selected' : ''}>${esc(x.header || 'עמודה ' + x.col)} · עמודה ${x.col}</option>`).join('')}</select></div>
    <p class="sp">בשימוש עכשיו: עמודה ${esc(c.current)}.${c.pending ? ` <b>מתוכנן: עמודה ${esc(c.pending.col)} מחודש ${esc(ymLabel(c.pending.from))}.</b>` : ''}<br>שינוי חל רק מחודש ${esc(ymLabel(c.nextYm))}. החודש הנוכחי והחודשים שעברו לא משתנים.</p>
    <button class="btn sm" data-act="saveCol">שמירה</button>`;
}

const SHEETS_ICON = '<svg viewBox="0 0 40 52" width="56" height="72" aria-hidden="true"><path d="M4 0h20l16 16v32a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="#23A566"/><path d="M24 0l16 16H28a4 4 0 0 1-4-4z" fill="#188038"/><rect x="9" y="25" width="22" height="16" rx="1.5" fill="#fff"/><path d="M9 30.5h22M9 35.5h22M17.5 25v16" stroke="#23A566" stroke-width="1.6" fill="none"/></svg>';
function onboarding(locked) {
  const ready = Auth.ready();
  return `<div class="top"><span class="app">מעקב הוצאות עם מאיה</span></div>
  <div class="wel">
    <div class="hero" aria-hidden="true">
      <div class="doc">
        <div class="hr hr1"><span class="rk" style="background:#BBD6FF">${icon('shopping-cart')}</span><b>סופר</b><div class="bar"><i></i></div></div>
        <div class="hr hr2"><span class="rk" style="background:#FFE49A">${icon('restaurant')}</span><b>אוכל בחוץ</b><div class="bar"><i></i></div></div>
        <div class="hr hr3"><span class="rk" style="background:#DDD3FF">${icon('car')}</span><b>רכב</b><div class="bar"><i></i></div></div>
      </div>
      <div class="dbadge">${SHEETS_ICON}</div>
      <div class="chip c1">${icon('restaurant')}<span>קפה</span><span class="num">18 ₪</span></div>
      <div class="chip c2">${icon('shopping-cart')}<span>סופר</span><span class="num">240 ₪</span></div>
      <div class="chip c3">${icon('car')}<span>דלק</span><span class="num">150 ₪</span></div>
    </div>
    <h2>התקציב שלך, תמיד איתך</h2>
    <p>האפליקציה שמעדכנת את הגיליון שלך תוך כדי תנועה.</p>
    <ul class="pts">
      <li>${icon('check')}<span>התקציב נטען מהגיליון שלך</span></li>
      <li>${icon('check')}<span>כל הוצאה נרשמת בשורה הנכונה</span></li>
      <li>${icon('check')}<span>השינויים מתעדכנים בכל המכשירים</span></li>
    </ul>
    <div class="cta">
    ${locked ? `<div class="assure">${icon('lock')}האפליקציה נעולה והנתונים מוסתרים</div><button class="btn big" data-act="unlockStart">כניסה</button>` : ready ? `<div class="assure">${icon('lock')}האפליקציה רואה רק את הגיליון שתבחרי</div><button class="btn big" data-act="pick">התחברות עם גוגל</button>${Auth.conf().templateId ? `<a class="lnk tpl" href="https://docs.google.com/spreadsheets/d/${esc(Auth.conf().templateId)}/copy" target="_blank" rel="noopener">אין לי גיליון עדיין: יצירת עותק מהתבנית</a>` : ''}` : '<div class="banner err" style="margin:0;text-align:right"><i class="ri-error-warning-fill"></i><span>האפליקציה עדיין לא הוגדרה מול Google, ולכן אי אפשר להתחבר. למנהלת: ממלאים את <b>config.js</b> (README, "הגדרת Google").</span></div>'}
    ${S.error ? `<div class="hint" style="margin-top:var(--s3);color:var(--pt);text-align:center">${esc(S.error)}</div>` : ''}
    </div>
  </div>`;
}

function render() {
  const a = $('#app');
  if (S.locked && isLive()) { a.innerHTML = lockScreen(); return; }
  if (!isLive() && !DEV) { a.innerHTML = onboarding(); return; }
  if (S.screen === 'pinsetup') { a.innerHTML = pinSetupScreen(); return; }
  a.innerHTML = S.screen === 'detail' ? detail() : S.screen === 'settings' ? settings() : S.screen === 'eom' ? eomScreen() : S.screen === 'summary' ? summaryScreen() : home();
  if (S.screen === 'home') initSort();
}

function initSort() {
  if (!window.Sortable) return;
  const cats = $('.cats');
  if (cats && !Sortable.get(cats)) new Sortable(cats, { handle: '.grip', animation: 180, onEnd() { S.order.g[S.tab] = [...cats.children].map(c => c.dataset.g); LS.set('order', S.order); touchPrefs(); } });
  document.querySelectorAll('.sg').forEach(g => !Sortable.get(g) && new Sortable(g, {
    animation: 180, filter: '.pls', preventOnFilter: false, delay: 220, delayOnTouchOnly: true,
    onEnd() { S.order.i[S.tab + '|' + g.dataset.g] = [...g.children].map(c => c.dataset.k); LS.set('order', S.order); touchPrefs(); }
  }));
}

/* ---------- גיליון הוספה / עריכה ---------- */
function openSheet(opts) {
  S.sheet = { mode: 'add', key: null, id: null, amount: '', dt: nowLocal(), tags: [], note: '', ...opts };
  renderSheet();
}
function closeSheet() { S.sheet = null; const L = $('#layer'); L.className = ''; L.innerHTML = ''; }

function catList(q) {
  q = (q || '').trim();
  const out = [];
  [[S.data.variable, 'שוטפות'], [S.data.fixed, 'קבועות']].forEach(([groups, kind]) => groups.forEach(g => {
    const items = g.items.filter(i => !q || i.name.includes(q) || g.name.includes(q));
    if (!items.length) return;
    out.push(`<div class="cg"><div class="cgh">${esc(g.name)}<span>${kind}</span></div>${items.map(i => `<button data-act="pickCat" data-k="${esc(i.key)}">${esc(i.name)}</button>`).join('')}</div>`);
  }));
  return out.join('') || '<div class="cn0">לא נמצאה קטגוריה</div>';
}
function renderSheet() {
  const sh = S.sheet; if (!sh) return;
  const f = sh.key ? findItem(sh.key) : null, gi = f ? gInfo(f.group) : { i: 'add-circle', c: '#eee' };
  const opts = (groups, isVar) => groups.map(g => `<optgroup label="${esc((isVar ? 'שוטפות · ' : 'קבועות · ') + g.name)}">${g.items.map(i => `<option value="${esc(i.key)}" ${i.key === sh.key ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</optgroup>`).join('');
  const tags = sh.key ? tagsFor(sh.key) : [];
  const L = $('#layer');
  L.className = 'on';
  L.innerHTML = `<div class="scrim" data-act="closeSheet"></div><div class="sheet" role="dialog" aria-label="הוספת הוצאה"><div class="grab"></div>
    <div class="shd" style="--c:${gi.c}"><span class="ci">${icon(gi.i)}</span><div><b>${f ? esc(f.item.name) : 'הוספת הוצאה'}</b><span class="s">${f ? `הוצאתי <span class="num">${fmt(f.item.spent)}</span> מתוך <span class="num">${fmt(f.item.budget)}</span>` : 'בחרי קטגוריה והקלידי סכום'}</span></div></div>
    <div class="amt num" id="amt">${esc(sh.amount || '0')}<u></u></div>
    ${sh.key ? '' : `${searchField('catq', 'חיפוש קטגוריה', '', 'clearCat', 'text')}<div class="cl" id="catl">${catList('')}</div>`}
    <div class="field">${icon('calendar')}<input id="dt" type="datetime-local" value="${esc(sh.dt)}"></div>
    <div class="field">${icon('chat-3')}<input id="note" type="text" maxlength="200" placeholder="הערה (לא חובה)" value="${esc(sh.note || '')}"></div>
    ${sh.key ? `<div class="lab">תגיות</div><div class="tgs">${tags.map(t => `<button data-act="tagToggle" data-v="${esc(t)}" class="${sh.tags.includes(t) ? 'on' : ''}">${esc(t)}</button>`).join('')}<button class="add" data-act="tagNew">+ תגית חדשה</button></div>` : ''}
    <div class="pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => `<button data-act="key" data-v="${k}">${k}</button>`).join('')}</div>
    <button class="btn" data-act="save">${sh.mode === 'edit' ? 'שמירת שינויים' : 'הוספת הוצאה'}</button></div>`;
}

function pressKey(k) {
  const sh = S.sheet; let a = sh.amount;
  if (k === '⌫') a = a.slice(0, -1);
  else if (k === '.') { if (!a.includes('.')) a = (a || '0') + '.'; }
  else if (a.replace('.', '').length < 8 && !(a.includes('.') && a.split('.')[1].length >= 2)) a = (a === '0' ? '' : a) + k;
  sh.amount = a; const el = $('#amt'); if (el) el.innerHTML = esc(a || '0') + '<u></u>';
}

async function save() {
  const sh = S.sheet, amt = parseFloat(sh.amount);
  if (!sh.key) { toast('בחרי קטגוריה'); return; }
  if (!(amt > 0)) { toast('הקלידי סכום'); return; }
  const e = { id: sh.id || uid(), dt: sh.dt || nowLocal(), key: sh.key, amount: Math.round(amt * 100) / 100, tags: sh.tags, note: sh.note || '', by: sh.mode === 'edit' ? (sh.by || '') : (S.who || '') };
  const known = new Set(S.tags[sh.key] || []); sh.tags.forEach(t => known.add(t)); S.tags[sh.key] = [...known]; LS.set('tags', S.tags); touchPrefs();
  const mode = sh.mode; closeSheet();
  await doOp(mode === 'edit' ? { op: 'upd', e } : { op: 'add', e });
}

/* ---------- הוספה, עריכה ומחיקה: מיד במסך, ואז לגיליון ---------- */
function localAdd(e) {
  const d = parseDT(e.dt);
  if (finMonth(d, S.startDay) !== S.month) return;
  S.entries.push(e);
  const f = findItem(e.key);
  if (f) { f.item.spent += e.amount; if (f.isVar) { const w = weekIdx(d, S.startDay, S.month); f.item.weeks[w] = (f.item.weeks[w] || 0) + e.amount; } }
}
function localDel(id) {
  const i = S.entries.findIndex(x => x.id === id); if (i < 0) return;
  const e = S.entries[i]; S.entries.splice(i, 1);
  const f = findItem(e.key);
  if (f) { f.item.spent -= e.amount; if (f.isVar) { const w = weekIdx(parseDT(e.dt), S.startDay, S.month); f.item.weeks[w] = (f.item.weeks[w] || 0) - e.amount; } }
}

async function doOp(op) {
  if (op.op === 'add') localAdd(op.e); else if (op.op === 'del') localDel(op.id); else { localDel(op.e.id); localAdd(op.e); }
  if (!isLive()) {
    let a = Demo.entries();
    if (op.op === 'add') a.push(op.e); else if (op.op === 'del') a = a.filter(x => x.id !== op.id); else a = a.map(x => x.id === op.e.id ? op.e : x);
    Demo.save(a); render(); toast(op.op === 'del' ? 'נמחק' : 'נשמר'); return;
  }
  S.pending.push(op); LS.set('pending', S.pending); render(); toast('נשמר, מסתנכרן לגיליון…'); flush();
}

let flushing = false;
async function flush() {
  if (S.locked || flushing || !isLive() || !S.pending.length) return;
  flushing = true; let offline = false;
  while (S.pending.length) {
    const op = S.pending[0];
    try {
      await call(op.op === 'add' ? 'add' : op.op === 'upd' ? 'update' : 'delete', op.op === 'del' ? { id: op.id } : { entry: op.e });
      S.pending.shift(); LS.set('pending', S.pending);
    } catch (err) {
      if (err instanceof TypeError) { offline = true; break; }
      if (err.code === 'auth') { S.needAuth = true; break; }
      S.pending.shift(); LS.set('pending', S.pending); toast('הגיליון דחה: ' + err.message);
    }
  }
  flushing = false;
  if (S.needAuth) { render(); return; }
  if (offline) { toast('אין חיבור. ההוצאה נשמרה בטלפון ותישלח כשיהיה'); render(); return; }
  await load(S.month); toast('נשמר בגיליון');
}

/* ---------- אירועים ---------- */
async function act(a, t) {
  const v = t.dataset.v, k = t.dataset.k, id = t.dataset.id;
  switch (a) {
    case 'tab': S.tab = v; render(); break;
    case 'period': S.period = v; render(); break;
    case 'prev': load(S.month - 1); break;
    case 'next': load(S.month + 1); break;
    case 'open': S.detailKey = k; S.screen = 'detail'; window.scrollTo(0, 0); render(); break;
    case 'back': case 'home': S.screen = 'home'; render(); break;
    case 'settings':
      S.screen = 'settings'; window.scrollTo(0, 0); render();
      if (isLive() && Auth.valid()) { try { S.budgetCfg = await call('settings'); render(); } catch (err) { if (err.code === 'auth') { S.needAuth = true; render(); } else toast('לא הצלחתי לטעון הגדרות: ' + err.message); } }
      break;
    case 'summary': S.screen = 'summary'; window.scrollTo(0, 0); render(); break;
    case 'dismissNew': LS.set('seenYm', S.curYm); render(); break;
    case 'summaryPrev': LS.set('seenYm', S.curYm); await load(S.month === 1 ? 12 : S.month - 1); S.screen = 'summary'; window.scrollTo(0, 0); render(); break;
    case 'depo': { (S.deposits[S.ym] = S.deposits[S.ym] || {})[k] = { amt: Number(v), day: nowDay(), at: Date.now() }; LS.set('deposits', S.deposits); touchPrefs(); reloadSoon(); render(); break; }
    case 'undepo': if (S.deposits[S.ym]) { delete S.deposits[S.ym][k]; LS.set('deposits', S.deposits); touchPrefs(); reloadSoon(); render(); } break;
    case 'decide': (S.decisions[S.ym] = S.decisions[S.ym] || {})[k] = v; LS.set('decisions', S.decisions); touchPrefs(); reloadSoon(); render(); break;
    case 'clearQ': { S.q = ''; const i = $('#hq'); if (i) { i.value = ''; i.focus(); } renderCats(); t.hidden = true; break; }
    case 'clearEq': { S.eq = ''; const i = $('#eq'); if (i) { i.value = ''; i.focus(); } const r = $('#eomrows'); if (r) r.innerHTML = eomRows(); t.hidden = true; break; }
    case 'clearCat': { const i = $('#catq'), l = $('#catl'); if (i) { i.value = ''; i.focus(); } if (l) l.innerHTML = catList(''); t.hidden = true; break; }
    case 'reloadApp': location.reload(); break;
    case 'lock': lockApp(); break;
    case 'unlockStart': if (PIN.get()) { S.lockStage = 'pin'; S.pinEntry = ''; S.pinMsg = ''; S.error = null; render(); } else finishUnlock(); break;
    case 'lockBack': S.lockStage = 'welcome'; S.pinEntry = ''; S.pinMsg = ''; render(); break;
    case 'pinForgot': resetPin(); break;
    case 'pin': pinPress(v); break;
    case 'pinDel': S.pinEntry = S.pinEntry.slice(0, -1); render(); break;
    case 'pinSetup': S.pinSetup = { step: 1, first: '' }; S.pinEntry = ''; S.pinMsg = ''; S.screen = 'pinsetup'; window.scrollTo(0, 0); render(); break;
    case 'pinRemove': if (confirm('להסיר את קוד הנעילה?')) { PIN.clear(); render(); toast('הקוד הוסר'); } break;
    case 'eomScreen': S.screen = 'eom'; window.scrollTo(0, 0); render(); break;
    case 'eomSet': S.eomRules[k] = v; LS.set('eomRules', S.eomRules); touchPrefs(); reloadSoon(); render(); break;
    case 'eomAll': eomItems().forEach(([, gs]) => gs.forEach(g => g.items.forEach(i => { S.eomRules[i.key] = v; }))); LS.set('eomRules', S.eomRules); touchPrefs(); render(); break;
    case 'pickCat': { const sh = S.sheet; sh.key = k; sh.tags = []; renderSheet(); break; }
    case 'saveCol': {
      const col = $('#cfgCol') && $('#cfgCol').value; if (!col) return;
      try { const r = await call('setBudgetColumn', { col }); toast('עמודה ' + col + ' תחול מחודש ' + ymLabel(r.from)); S.budgetCfg = await call('settings'); render(); }
      catch (err) { toast(err.message); }
      break;
    }
    case 'add': openSheet({ key: k }); break;
    case 'fab': openSheet({ key: S.screen === 'detail' ? S.detailKey : null }); break;
    case 'closeSheet': closeSheet(); break;
    case 'key': pressKey(v); break;
    case 'tagToggle': { const s = S.sheet, i = s.tags.indexOf(v); i < 0 ? s.tags.push(v) : s.tags.splice(i, 1); renderSheet(); break; }
    case 'tagNew': { const n = (prompt('שם התגית (למשל: רמי לוי)') || '').trim(); if (n) { const s = S.sheet; if (!s.tags.includes(n)) s.tags.push(n); S.tags[s.key] = [...new Set([...(S.tags[s.key] || []), n])]; LS.set('tags', S.tags); touchPrefs(); renderSheet(); } break; }
    case 'save': save(); break;
    case 'edit': { const e = S.entries.find(x => x.id === id); if (e) openSheet({ mode: 'edit', by: e.by || '', key: e.key, id: e.id, amount: String(e.amount), dt: e.dt, tags: [...(e.tags || [])], note: e.note || '' }); break; }
    case 'del': if (confirm('למחוק את ההוצאה?')) doOp({ op: 'del', id }); break;
    case 'retry': S.pending.length ? flush() : load(S.month); break;
    case 'signin': try { await Auth.signIn(); S.needAuth = false; await load(S.month); flush(); } catch (e) { toast('ההתחברות לא הושלמה'); } break;
    case 'pick': pickSheet(); break;
    case 'disconnect': {
      const n = S.pending.length;
      if (!confirm(n ? `יש ${n} הוצאות שעוד לא נשלחו לגיליון, והן יימחקו מהמכשיר אם תנתקי עכשיו.\nלנתק בכל זאת?` : 'לנתק את הגיליון? ההוצאות והתקציב נשארים בגיליון, והעותק שלהם יימחק מהמכשיר הזה.')) break;
      S.cfg = { sheetId: '', sheetName: '' }; S.needAuth = false; S.budgetCfg = null; S.data = { fixed: [], variable: [] }; S.entries = []; S.pending = []; S.lastSync = null; S.error = null;
      PT.pulled = false;
      ['cache', 'pending', 'lastSync', 'demoEntries', 'hadAuth', 'prefsDirty', 'hint'].forEach(k => { try { localStorage.removeItem(k); } catch { /* מצב פרטי */ } });
      if (Auth.tok && window.google && google.accounts) { try { google.accounts.oauth2.revoke(Auth.tok, () => {}); } catch { /* לא קריטי */ } }
      Auth.tok = null; Auth.exp = 0; TOK.clear(); LS.set('cfg', S.cfg); S.screen = 'home'; await load(); break;
    }
    case 'sample': sampleData(); break;
    case 'resetDemo': if (confirm('למחוק את כל ההוצאות של ההדגמה?')) { Demo.save([]); S.screen = 'home'; await load(S.month); } break;
  }
}
document.addEventListener('click', ev => { const t = ev.target.closest('[data-act]'); if (!t) return; ev.preventDefault(); act(t.dataset.act, t); });
document.addEventListener('input', ev => { const clr = ev.target.parentElement && ev.target.parentElement.querySelector('.clr'); if (clr) clr.hidden = !ev.target.value; if (ev.target.id === 'hq') { S.q = ev.target.value; renderCats(); return; } if (ev.target.id === 'whoName') { S.who = ev.target.value.trim().slice(0, 24); LS.set('who', S.who); return; } if (ev.target.id === 'eq') { S.eq = ev.target.value; const r = $('#eomrows'); if (r) r.innerHTML = eomRows(); return; } if (ev.target.id === 'catq') { const l = $('#catl'); if (l) l.innerHTML = catList(ev.target.value); return; } if (!S.sheet) return; if (ev.target.id === 'dt') S.sheet.dt = ev.target.value; else if (ev.target.id === 'note') S.sheet.note = ev.target.value; });
document.addEventListener('keydown', ev => { if (ev.target.id === 'catq' && ev.key === 'Enter') { ev.preventDefault(); const b = $('#catl button'); if (b) b.click(); } });
document.addEventListener('change', ev => { if (ev.target.id === 'selKey' && S.sheet) { S.sheet.key = ev.target.value || null; S.sheet.tags = []; renderSheet(); } });
/* חידוש התחברות בלחיצה הראשונה: כשההרשאה פגה, כל נגיעה באפליקציה מחדשת אותה (פעולה של משתמשת, כדי שהדפדפן לא יחסום) */
let renewing = false;
document.addEventListener('pointerdown', async ev => {
  if (S.locked || renewing || !isLive() || !Auth.ready() || Auth.valid()) return;
  if (ev.target.closest('[data-act="signin"],[data-act="pick"],[data-act="disconnect"]')) return;
  renewing = true;
  try { await Auth.signIn(); S.needAuth = false; await load(S.month, true); flush(); }
  catch { /* ההודעה האדומה נשארת, והכפתור בה מחבר */ }
  finally { renewing = false; }
});
window.addEventListener('online', () => { if (isLive()) flush(); });
// מעודכן כל הזמן: בחזרה לאפליקציה, וגם בזמן שהיא פתוחה, קוראים מחדש מהגיליון (הוצאות שהוזנו במקום אחר, עריכות בגיליון)
function refreshIfIdle() { if (isLive() && !S.locked && Date.now() - (S.lastSync || 0) > 40000 && !S.sheet && !flushing && !S.pending.length && !S.needAuth && !S.loading && document.visibilityState === 'visible') load(S.month, true); }
/* חזרה לאפליקציה אחרי הפסקה (יותר משתי דקות): חוזרים לחודש הנוכחי ולמסך הבית, כמו פתיחה חדשה */
function backToNow() {
  if (S.locked || !isLive()) return;
  if (S.hiddenAt && Date.now() - S.hiddenAt > 120000) {
    S.hiddenAt = 0; S.screen = 'home'; S.q = ''; S.eq = ''; closeSheet(); S.period = 'month';
    load(undefined, true);
  } else refreshIfIdle();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') S.hiddenAt = Date.now(); else backToNow(); });
setTimeout(checkVersion, 12000); setInterval(checkVersion, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
window.addEventListener('pageshow', ev => { if (ev.persisted) backToNow(); });
setInterval(refreshIfIdle, 60000);
setInterval(() => { const e = $('#sp'); if (e) e.innerHTML = syncPill(); paintPrefs(); }, 20000);   // הזמן שליד "מעודכן" מתקדם גם בלי רענון

function sampleData() {
  const d = new Date(), day = n => { const x = new Date(d.getFullYear(), d.getMonth(), Math.max(1, d.getDate() - n), 9 + n, 15 + n); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}T${pad2(x.getHours())}:${pad2(x.getMinutes())}`; };
  const mk = (key, amount, n, tags = []) => ({ id: uid(), dt: day(n), key, amount, tags, note: '' });
  const a = Demo.entries().concat([
    mk('var:0', 450, 0, ['רמי לוי']), mk('var:0', 220, 1, ['שופרסל']), mk('var:0', 400, 2, ['רמי לוי']), mk('var:2', 60, 1), mk('var:3', 120, 3),
    mk('var:23', 300, 2), mk('var:24', 520, 1), mk('var:24', 600, 3), mk('var:32', 200, 2), mk('var:34', 360, 1),
    mk('fixed:1', 80, 3), mk('fixed:2', 760, 2), mk('fixed:4', 1791, 4), mk('fixed:5', 313, 4), mk('fixed:6', 1200, 3)
  ]);
  Demo.save(a); S.screen = 'home'; load(S.month); toast('נוספו הוצאות לדוגמה');
}

/* ---------- עלייה ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
setupBridge();
/* מסך פתיחה: נעלם כשהתוכן מוכן (אבל לא לפני חצי שנייה, כדי שלא יהבהב) */
const T0 = performance.now();
function hideSplash() {
  const el = document.getElementById('splash'); if (!el || new URLSearchParams(location.search).has('splash')) return;
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, Math.max(0, 500 - (performance.now() - T0)));
}
setTimeout(hideSplash, 8000);   // רשת בטחון
if (S.locked && isLive()) { render(); hideSplash(); } else { if (S.locked) { S.locked = false; LS.set('locked', false); } load().then(() => { hideSplash(); if (isLive()) flush(); }); }
