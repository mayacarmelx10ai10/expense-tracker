/* קריאה וכתיבה לגיליון "שיקוף ותקציב" דרך Google Sheets API (בלי Apps Script).
 *
 *  - התקציב נקרא מלשונית "תקציב משק בית", מהעמודה שהוגדרה (ברירת מחדל F, "תקציב חדש"), ורק שורות עם סכום.
 *  - הוצאה נשמרת בלשונית "יומן הוצאות" (שורה לכל הוצאה, עם תאריך ושעה) ומעדכנת תא בבקרה:
 *      קבועה: תא "בפועל" של החודש בשורת הקטגוריה (בקרה קבועות).
 *      משתנה: תא השבוע (1, 8, 15, 22, 29) של החודש בשורת הקטגוריה (בקרה משתנות).
 *    התא מקבל נוסחת SUMIFS על היומן, כך שמחיקה ועריכה מתעדכנות לבד.
 *  - שינוי תקציב חל רק קדימה: כל חודש שהתחיל "קופא" בלשונית "תקציב לפי חודש".
 */
(function (root) {
  'use strict';

  const SHEETS = { BUDGET: 'תקציב משק בית', FIXED: 'בקרה קבועות', VAR: 'בקרה משתנות', SUMMARY: 'סיכום בקרה קבועות ומשתנות', LOG: 'יומן הוצאות', SETTINGS: 'הגדרות אפליקציה', SNAP: 'תקציב לפי חודש', ITEMS: 'התקציב' };   // ITEMS: הפורמט החדש (קובץ שלא תלוי ב"שיקוף ותקציב")
  const ITEMS_HEADER = ['סוג', 'קבוצה', 'סעיף', 'תקציב חודשי', 'מפתח'];
  const LOG_HEADER = ['מזהה', 'תאריך ושעה', 'סוג', 'קבוצה', 'קטגוריה', 'סכום', 'תגיות', 'הערה', 'חודש', 'שבוע', 'יעד בבקרה', 'מפתח', 'נוסף ע"י'];
  const wb = () => (typeof module !== 'undefined' && module.exports) ? require('./workbook.js') : root.Workbook;
  const L = { ID: 0, DT: 1, TYPE: 2, GROUP: 3, NAME: 4, AMOUNT: 5, TAGS: 6, NOTE: 7, MONTH: 8, WEEK: 9, TARGET: 10, KEY: 11, BY: 12 };
  const SETTINGS_HEADER = ['הגדרה', 'ערך', 'בתוקף מחודש (שנה+חודש)'];
  const SNAP_HEADER = ['חודש (שנה+חודש)', 'מפתח', 'קבוצה', 'קטגוריה', 'תקציב', 'עמודה'];
  const DEFAULT_COL = 'F';
  const BUDGET_COLS = 12; // A עד L

  let cfg = { getToken: null, sheetId: null, fetch: null, now: () => new Date() };
  let cache = {};
  function configure(c) { cfg = Object.assign({}, cfg, c); cache = {}; }
  const fetcher = () => cfg.fetch || root.fetch.bind(root);

  /* ---------- עזרים ---------- */
  const num = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
  const trim = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const at = (row, i) => (row && row[i] != null) ? row[i] : '';
  function colIndex(letter) { const s = String(letter).toUpperCase(); let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  const parseDt = s => { const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(s); if (!m) throw new Error('תאריך לא תקין'); return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); };
  const finMonth = (d, start) => { let m = d.getMonth() + 1; if (d.getDate() < start) m = m === 1 ? 12 : m - 1; return m; };
  const weekIdx = (d, start, m) => { const y = d.getFullYear(); let sd = new Date(y, m - 1, start); if (sd > d) sd = new Date(y - 1, m - 1, start); return Math.max(0, Math.min(4, Math.floor(Math.floor((d - sd) / 86400000) / 7))); };
  const ymOf = (month, year) => year * 100 + month;
  const nextYm = ym => { const y = Math.floor(ym / 100), m = ym % 100; return m === 12 ? (y + 1) * 100 + 1 : ym + 1; };
  const q = title => "'" + title + "'";

  /* ---------- Sheets API ---------- */
  let apiCalls = 0;
  async function api(path, opts) {
    opts = opts || {}; apiCalls++;
    const token = await cfg.getToken();
    let url = /^https:/.test(path) ? path : 'https://sheets.googleapis.com/v4/spreadsheets/' + cfg.sheetId + path;
    if (opts.params) {
      const p = new URLSearchParams();
      Object.keys(opts.params).forEach(k => [].concat(opts.params[k]).forEach(v => p.append(k, v)));
      url += (path.includes('?') ? '&' : '?') + p.toString();
    }
    const r = await fetcher()(url, { method: opts.method || 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json();
    if (!r.ok) {
      const e = new Error((j.error && j.error.message) || ('שגיאה ' + r.status));
      if (r.status === 401) e.code = 'auth';
      if (r.status === 403 || r.status === 404) e.code = 'access';
      if (r.status === 429) e.code = 'quota';
      throw e;
    }
    return j;
  }
  const enc = encodeURIComponent;
  async function getVals(range, render) {
    const j = await api('/values/' + enc(range), { params: { valueRenderOption: render || 'UNFORMATTED_VALUE' } });
    return j.values || [];
  }
  async function batchVals(ranges, render) {
    const j = await api('/values:batchGet', { params: { ranges: ranges, valueRenderOption: render || 'UNFORMATTED_VALUE' } });
    return (j.valueRanges || []).map(v => v.values || []);
  }
  const putVals = (range, values, mode) => api('/values/' + enc(range), { method: 'PUT', params: { valueInputOption: mode || 'RAW' }, body: { values: values } });
  const appendVals = (title, rows, mode) => api('/values/' + enc(q(title) + '!A1') + ':append', { method: 'POST', params: { valueInputOption: mode || 'RAW', insertDataOption: 'INSERT_ROWS' }, body: { values: rows } });

  async function meta(force) {
    if (!force && cache.meta) return cache.meta;
    const j = await api('', { params: { fields: 'sheets.properties(sheetId,title)' } });
    cache.meta = {};
    (j.sheets || []).forEach(s => { cache.meta[s.properties.title] = s.properties.sheetId; });
    return cache.meta;
  }
  async function ensureSheet(title, header) {
    const m = await meta();
    if (m[title] != null) return m[title];
    const j = await api(':batchUpdate', { method: 'POST', body: { requests: [{ addSheet: { properties: { title: title, rightToLeft: true } } }] } });
    const id = j.replies[0].addSheet.properties.sheetId;
    cache.meta[title] = id;
    await putVals(q(title) + '!A1', [header], 'RAW');
    return id;
  }

  /* ---------- מבנה הגיליון ---------- */
  function readSection(rows, startLabel, endNeedle) {
    let start = -1, end = -1;
    for (let i = 0; i < rows.length; i++) {
      const a = trim(at(rows[i], 0));
      if (start < 0 && a === startLabel) { start = i + 1; continue; }
      if (start >= 0 && a.indexOf('סה"כ') >= 0 && a.indexOf(endNeedle) >= 0) { end = i; break; }
    }
    if (start < 0 || end < 0) throw new Error('לא נמצא החלק "' + startLabel + '" בלשונית "' + SHEETS.BUDGET + '"');
    const list = []; let group = '';
    for (let r = start; r < end; r++) {
      const g = trim(at(rows[r], 0)); if (g) group = g;
      const name = trim(at(rows[r], 1)); if (!name) continue;
      const row = []; for (let c = 0; c < BUDGET_COLS; c++) row.push(at(rows[r], c));
      list.push({ n: list.length, group: group, name: name, row: row });
    }
    return list;
  }
  function headerRow(vals, label, sheetTitle, colIdx) {
    for (let i = 0; i < vals.length; i++) if (trim(at(vals[i], colIdx)) === label) return i + 1;
    throw new Error('בלשונית "' + sheetTitle + '" לא נמצאה כותרת "' + label + '"');
  }
  const MON_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MON_HE = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
  function monthOf(v) {
    if (typeof v === 'number' && v > 12) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).getUTCMonth() + 1;   // תאריך (גם שנה 1900: Oct-00 הוא 1.10.1900)
    if (typeof v === 'number' && v >= 1 && v <= 12) return v;
    const t = trim(v).toLowerCase(); if (!t) return 0;
    let i = MON_EN.findIndex(m => t.indexOf(m) === 0); if (i >= 0) return i + 1;
    i = MON_HE.findIndex(m => t.indexOf(m) === 0); return i >= 0 ? i + 1 : 0;
  }
  /* עמודות החודשים נקראות מכותרות הגיליון (לא מניחים סדר חודשים): חודש -> עמודת "בפועל" או עמודות השבועות */
  function layout(rows, hdr, isVar, title) {
    const lab = rows[hdr - 2] || [], typ = rows[hdr - 1] || [], out = {};
    let last = 0;
    const width = Math.max(lab.length, typ.length);
    for (let c = 5; c <= width; c++) {
      const t = at(typ, c - 1), l = at(lab, c - 1);
      const isW = isVar ? typeof t === 'number' : trim(t) === 'בפועל';
      if (!isW) continue;
      let m = monthOf(l) || last;
      if (!m) throw new Error('בלשונית "' + title + '" לא הצלחתי לזהות את חודשי העמודות');
      last = m;
      if (isVar) (out[m] = out[m] || []).push(c); else out[m] = c;
    }
    if (!Object.keys(out).length) throw new Error('בלשונית "' + title + '" לא נמצאו עמודות חודשים');
    return out;
  }
  async function model() {
    if (cache.model && Date.now() - cache.modelAt < 15000) return cache.model;
    const m = await meta(true);
    if (m[SHEETS.ITEMS] != null) return model2();
    [SHEETS.BUDGET, SHEETS.FIXED, SHEETS.VAR].forEach(t => { if (m[t] == null) throw new Error('חסרה לשונית "' + t + '". זה הגיליון הנכון?'); });
    const ranges = [q(SHEETS.BUDGET) + '!A1:L400', q(SHEETS.FIXED) + '!A1:CZ8', q(SHEETS.VAR) + '!A1:CZ8'];
    if (m[SHEETS.SUMMARY] != null) ranges.push(q(SHEETS.SUMMARY) + '!A1:Z1');
    const v = await batchVals(ranges);
    let startDay = 1;
    if (v[3] && v[3][0]) {
      const row = v[3][0];
      for (let i = 0; i < row.length; i++) if (trim(row[i]).indexOf('חישוב חודש החל מיום') >= 0) { for (let j = i + 1; j < row.length; j++) if (typeof row[j] === 'number' && row[j] >= 1 && row[j] <= 28) { startDay = row[j]; break; } break; }
    }
    const bRows = v[0];
    let head = null; for (let i = 0; i < bRows.length; i++) if (trim(at(bRows[i], 0)) === 'הוצאות קבועות') { head = bRows[i]; break; }
    const fh = headerRow(v[1], 'תקציב', SHEETS.FIXED, 3), vh = headerRow(v[2], 'תקציב', SHEETS.VAR, 2);
    cache.model = {
      startDay: startDay,
      headRow: head,
      fixed: { title: SHEETS.FIXED, first: fh + 1, cols: layout(v[1], fh, false, SHEETS.FIXED), list: readSection(bRows, 'הוצאות קבועות', 'קבועות') },
      variable: { title: SHEETS.VAR, first: vh + 1, cols: layout(v[2], vh, true, SHEETS.VAR), list: readSection(bRows, 'הוצאות משתנות', 'משתנות') }
    };
    cache.modelAt = Date.now();
    return cache.model;
  }

  /* ---------- הפורמט החדש: האפליקציה קוראת רק לשוניות קלט (התקציב, היומן, ההגדרות) ולא תאי נוסחה ---------- */
  async function model2() {
    const v = await batchVals([q(SHEETS.ITEMS) + '!A1:I500', q(SHEETS.SETTINGS) + '!A2:C60']);
    const settingsRows = v[1], setting = name => { const r = settingsRows.find(x => trim(x[0]) === name); return r ? r[1] : undefined; };
    const startYm = Number(setting('startYm')) || (cfg.now().getFullYear() * 100 + cfg.now().getMonth() + 1);
    const months = Math.max(1, Math.min(12, Number(setting('months')) || 12));
    const startDay = Math.max(1, Math.min(28, Number(setting('startDay')) || 1));
    const parsed = wb().parseItems(v[0]), lists = { fixed: [], variable: [] }, keyed = [];
    let nextN = { fixed: 0, variable: 0 }, missing = [];
    parsed.items.forEach(pi => {
      const isVar = pi.type === 'שוטפת';
      const k = /^(fixed|var):(\d+)$/.exec(pi.key || '');
      if (k) nextN[isVar ? 'variable' : 'fixed'] = Math.max(nextN[isVar ? 'variable' : 'fixed'], Number(k[2]) + 1);
      keyed.push({ isVar: isVar, group: pi.group, name: pi.name, budget: pi.budget, n: k ? Number(k[2]) : -1, row: pi.row });
    });
    keyed.forEach(it => { if (it.n < 0) { it.n = nextN[it.isVar ? 'variable' : 'fixed']++; missing.push(it); } });
    keyed.forEach(it => { const list = lists[it.isVar ? 'variable' : 'fixed']; list[it.n] = { n: it.n, group: it.group, name: it.name, budget: it.budget, row: it.row }; });
    ['fixed', 'variable'].forEach(t => { for (let n = 0; n < lists[t].length; n++) if (!lists[t][n]) lists[t][n] = { n: n, group: '', name: '', budget: 0, row: 0, gone: true }; });
    if (missing.length) {   // סעיף חדש שנוסף ישירות בגיליון מקבל מפתח קבוע
      const kc = parsed.layout === 'flat' ? 'E' : 'I';
      await Promise.all(missing.map(it => putVals(q(SHEETS.ITEMS) + '!' + kc + it.row, [[(it.isVar ? 'var:' : 'fixed:') + it.n]], 'RAW')));
    }
    const first = Math.floor(startYm / 100) * 100 + (startYm % 100);
    let opening = {}; try { const o = setting('opening'); opening = o ? JSON.parse(o) : {}; } catch (e) { opening = {}; }
    cache.model = { v2: true, opening: opening, startDay: startDay, startYm: startYm, months: months, fixed: { list: lists.fixed }, variable: { list: lists.variable }, headRow: null };
    cache.modelAt = Date.now();
    await syncSeen(cache.model, settingsRows);
    return cache.model;
  }
  /* שינוי תקציב חל רק קדימה, בלי שהמשתמשת תצטרך לעשות משהו: האפליקציה זוכרת את התקציב שראתה בפעם הקודמת ("seen").
     אם סעיף שהיה לו תקציב השתנה, החודש הנוכחי נשמר בעותק עם התקציב הישן, והחדש חל מהחודש הבא.
     הזנה ראשונה של תקציב (מאפס) חלה מיד, כדי שמי שרק התחילה תראה את התקציב בחודש הנוכחי. */
  async function syncSeen(mod, settingsRows) {
    let seen = {}, row = -1;
    settingsRows.forEach((r, i) => { if (trim(r[0]) === 'seen') { row = i + 2; try { seen = r[1] ? JSON.parse(r[1]) : {}; } catch (e) { seen = {}; } } });
    const live = {}; mod.fixed.list.concat(mod.variable.list).forEach((it, i) => { if (!it.gone) live[(mod.fixed.list.includes(it) ? 'fixed:' : 'var:') + it.n] = it.budget; });
    const changed = Object.keys(live).filter(k => seen[k] > 0 && Math.abs(live[k] - seen[k]) > 0.005);
    const same = Object.keys(live).length === Object.keys(seen).length && Object.keys(live).every(k => Math.abs(live[k] - (seen[k] || 0)) < 0.005);
    if (same) return;
    const cur = curYm(mod);
    if (changed.length && !(await readSnap(mod, cur))) {
      const old = Object.assign({}, live, ...changed.map(k => ({ [k]: seen[k] })));
      const rows = [[cur, '_meta', '', '', 0, 'D']];
      [['fixed', mod.fixed.list], ['var', mod.variable.list]].forEach(([p, list]) => list.forEach(it => { if (!it.gone && old[p + ':' + it.n] > 0) rows.push([cur, p + ':' + it.n, it.group, it.name, old[p + ':' + it.n], 'D']); }));
      await ensureSheet(SHEETS.SNAP, SNAP_HEADER);
      await appendVals(SHEETS.SNAP, rows);
      cache.snaps = cache.snaps || {}; delete cache.snaps[cur];
    }
    const json = JSON.stringify(live);
    if (row > 0) await putVals(q(SHEETS.SETTINGS) + '!B' + row, [[json]], 'RAW'); else await appendVals(SHEETS.SETTINGS, [['seen', json]]);
  }
  /* סכומי הוצאות מהיומן: לפי מפתח וחודש (וקבועות/שוטפות: שבוע) */
  async function logSums() {
    if (cache.logSums && Date.now() - cache.logSums.at < 15000) return cache.logSums.v;
    const rows = await getVals(q(SHEETS.LOG) + '!A2:M20000');
    const fixed = {}, variable = {};
    rows.forEach(r => {
      const m = /^(fixed|var):(\d+)$/.exec(String(r[L.KEY])); if (!m) return;
      const mo = Number(r[L.MONTH]), amt = num(r[L.AMOUNT]), n = Number(m[2]);
      if (m[1] === 'fixed') { ((fixed[mo] = fixed[mo] || [])[n]) = (((fixed[mo] || [])[n]) || 0) + amt; }
      else { const w = Math.max(0, Math.min(4, (Number(r[L.WEEK]) || 1) - 1)); const a = ((variable[mo] = variable[mo] || [])[n] = (variable[mo][n] || [0, 0, 0, 0, 0])); a[w] += amt; }
    });
    const v = { fixed: fixed, variable: variable };
    cache.logSums = { at: Date.now(), v: v };
    return v;
  }
  async function actuals2(mod, mo) {
    const s = await logSums();
    return {
      fixed: mod.fixed.list.map((_, i) => ((s.fixed[mo] || [])[i]) || 0),
      weeks: mod.variable.list.map((_, i) => ((s.variable[mo] || [])[i]) || [0, 0, 0, 0, 0])
    };
  }
  /* סדר החודשים בגיליון (מתחיל באוקטובר בגיליון שלך) ושנה לכל חודש */
  const monthOrder = mod => mod.v2 ? Array.from({ length: mod.months }, (_, i) => ((Math.floor(mod.startYm % 100) - 1 + i) % 12) + 1) : Object.keys(mod.variable.cols).map(Number).sort((x, y) => mod.variable.cols[x][0] - mod.variable.cols[y][0]);
  function ymFor(mod, m) {
    if (mod.v2) { const sm = mod.startYm % 100, sy = Math.floor(mod.startYm / 100); return m >= sm ? sy * 100 + m : (sy + 1) * 100 + m; }
    const now = cfg.now(), first = monthOrder(mod)[0] || 1, cur = finMonth(now, mod.startDay);
    const firstYear = cur >= first ? now.getFullYear() : now.getFullYear() - 1;
    return m >= first ? firstYear * 100 + m : (firstYear + 1) * 100 + m;
  }
  const curYm = m => {
    if (!m.v2) return ymFor(m, finMonth(cfg.now(), m.startDay));
    const d = cfg.now(), fm = finMonth(d, m.startDay); return (d.getMonth() + 1 === 1 && fm === 12 ? d.getFullYear() - 1 : d.getFullYear()) * 100 + fm;
  };

  /* ---------- תקציב: עמודה מוגדרת, וקפיאה לפי חודש (שינוי חל רק קדימה) ---------- */
  async function colHistory() {
    if (cache.hist && Date.now() - cache.hist.at < 30000) return cache.hist.v;
    const v = await colHistory0(); cache.hist = { at: Date.now(), v: v }; return v;
  }
  async function colHistory0() {
    await ensureSheet(SHEETS.SETTINGS, SETTINGS_HEADER);
    let rows = await getVals(q(SHEETS.SETTINGS) + '!A2:C200');
    if (!rows.some(r => trim(r[0]) === 'budgetColumn')) { await appendVals(SHEETS.SETTINGS, [['budgetColumn', DEFAULT_COL, 0]]); rows = [['budgetColumn', DEFAULT_COL, 0]]; }
    const out = [];
    rows.forEach(r => { if (trim(r[0]) === 'budgetColumn') out.push({ col: trim(r[1]).toUpperCase(), from: Number(r[2]) || 0 }); });
    out.sort((a, b) => a.from - b.from);
    return out;
  }
  const colFor = (hist, ym) => { let col = hist[0].col; hist.forEach(h => { if (h.from <= ym) col = h.col; }); return col; };
  function liveBudgets(mod, hist, ym) {
    if (mod.v2) return { col: 'D', fixed: mod.fixed.list.map(it => it.budget), variable: mod.variable.list.map(it => it.budget) };
    const col = colFor(hist, ym), idx = colIndex(col) - 1;
    return { col: col, fixed: mod.fixed.list.map(it => num(it.row[idx])), variable: mod.variable.list.map(it => num(it.row[idx])) };
  }
  async function readSnap(mod, ym) {
    cache.snaps = cache.snaps || {};
    if (cache.snaps[ym]) return cache.snaps[ym];   // תקציב קפוא לא משתנה
    await ensureSheet(SHEETS.SNAP, SNAP_HEADER);
    const rows = (await getVals(q(SHEETS.SNAP) + '!A2:F5000')).filter(r => Number(r[0]) === ym);
    if (!rows.length) return null;
    const out = { col: '', fixed: mod.fixed.list.map(() => 0), variable: mod.variable.list.map(() => 0) };
    cache.snaps[ym] = out;
    rows.forEach(r => {
      out.col = trim(r[5]) || out.col;
      const m = /^(fixed|var):(\d+)$/.exec(String(r[1])); if (!m) return;
      (m[1] === 'var' ? out.variable : out.fixed)[Number(m[2])] = num(r[4]);
    });
    return out;
  }
  async function snapshotIfMissing(mod, ym) {
    const snap = await readSnap(mod, ym); if (snap) return snap;
    const live = liveBudgets(mod, mod.v2 ? null : await colHistory(), ym);
    const rows = [[ym, '_meta', '', '', 0, live.col]];
    mod.fixed.list.forEach((it, i) => { if (live.fixed[i] > 0) rows.push([ym, 'fixed:' + it.n, it.group, it.name, live.fixed[i], live.col]); });
    mod.variable.list.forEach((it, i) => { if (live.variable[i] > 0) rows.push([ym, 'var:' + it.n, it.group, it.name, live.variable[i], live.col]); });
    await appendVals(SHEETS.SNAP, rows);
    cache.snaps = cache.snaps || {}; cache.snaps[ym] = live;
    return live;
  }
  async function budgets(mod, ym) {
    const frozen = mod.v2 ? ym < curYm(mod) : ym <= curYm(mod);   // בקובץ החדש החודש הנוכחי נשאר חי עד ששינוי תקציב מתגלה (syncSeen)
    let b = frozen ? await snapshotIfMissing(mod, ym) : null;
    if (!b && mod.v2 && ym === curYm(mod)) b = await readSnap(mod, ym);   // החודש הנוכחי: אם כבר נשמר עותק (בגלל שינוי), משתמשים בו
    if (!b) b = liveBudgets(mod, mod.v2 ? null : await colHistory(), ym);
    b.frozen = !!(frozen || (mod.v2 && ym === curYm(mod) && cache.snaps && cache.snaps[ym]));
    return b;
  }

  async function settings() {
    const mod = await model();
    if (mod.v2) {
      const cy = curYm(mod), ord = monthOrder(mod), endYm = ymFor(mod, ord[ord.length - 1]);
      return { ok: true, format: 2, current: 'D', pending: null, currentYm: cy, nextYm: nextYm(cy), columns: [], startYm: mod.startYm, months: mod.months, endYm: endYm, ended: cy > endYm };
    }
    const hist = await colHistory(), cy = curYm(mod);
    const pending = hist.filter(h => h.from > cy)[0] || null;
    const cols = [];
    for (let c = 3; c <= BUDGET_COLS; c++) {
      let count = 0;
      mod.fixed.list.concat(mod.variable.list).forEach(it => { if (num(it.row[c - 1]) > 0) count++; });
      const header = mod.headRow ? trim(at(mod.headRow, c - 1)) : '';
      if (count > 0 || header) cols.push({ col: colLetter(c), header: header, count: count });
    }
    return { ok: true, current: colFor(hist, cy), pending: pending, currentYm: cy, nextYm: nextYm(cy), columns: cols };
  }

  async function setBudgetColumn(col) {
    col = trim(col).toUpperCase();
    if (!/^[A-L]$/.test(col) || colIndex(col) < 3) throw new Error('עמודה לא תקינה');
    const mod = await model(), cy = curYm(mod), idx = colIndex(col) - 1;
    const any = mod.fixed.list.concat(mod.variable.list).some(it => num(it.row[idx]) > 0);
    if (!any) throw new Error('בעמודה ' + col + ' אין סכומים בשורות ההוצאות');
    await snapshotIfMissing(mod, cy);   // החודש הנוכחי נשאר כמו שהוא
    const from = nextYm(cy);
    const hist = (await colHistory()).filter(h => h.from < from);
    if (colFor(hist, cy) !== col) hist.push({ col: col, from: from });
    cache.hist = null;
    await api('/values/' + enc(q(SHEETS.SETTINGS) + '!A2:C200') + ':clear', { method: 'POST', body: {} });
    await putVals(q(SHEETS.SETTINGS) + '!A2', hist.map(h => ['budgetColumn', h.col, h.from]), 'RAW');
    return { ok: true, col: col, from: from };
  }

  /* ---------- קריאה ---------- */
  async function actuals(mod, mo) {
    if (mod.v2) { const a = await actuals2(mod, mo); return { fixed: a.fixed, variable: a.weeks.map(w => w.reduce((s, x) => s + x, 0)) }; }
    const fcN = mod.fixed.cols[mo], vcN = mod.variable.cols[mo];
    if (!fcN || !vcN) return null;
    const fc = colLetter(fcN), vc1 = colLetter(vcN[0]), vc2 = colLetter(vcN[vcN.length - 1]);
    const fr = mod.fixed.first, vr = mod.variable.first;
    const [fa, va] = await batchVals([
      q(SHEETS.FIXED) + '!' + fc + fr + ':' + fc + (fr + mod.fixed.list.length - 1),
      q(SHEETS.VAR) + '!' + vc1 + vr + ':' + vc2 + (vr + mod.variable.list.length - 1)
    ]);
    return {
      fixed: mod.fixed.list.map((_, i) => num(at(fa[i], 0))),
      variable: mod.variable.list.map((_, i) => [0, 1, 2, 3, 4].reduce((s, w) => s + num(at(va[i], w)), 0))
    };
  }
  /* גלגול: מה שנשאר (או חסר) בחודש שהסתיים עובר לחודש הבא, רק בסעיפים שנקבע להם "לגלגל" */
  async function carries(mod, mo, opts) {
    const key = mo + '|' + JSON.stringify((opts && opts.rules) || {}) + '|' + JSON.stringify((opts && opts.decisions) || {}) + '|' + JSON.stringify((opts && opts.deposits) || {});
    if (cache.carry && cache.carry.key === key && Date.now() - cache.carry.at < 20000) return cache.carry.v;
    const v = await carries0(mod, mo, opts); cache.carry = { key: key, at: Date.now(), v: v }; return v;
  }
  async function carries0(mod, mo, opts, full) {
    const order = monthOrder(mod), cur = finMonth(cfg.now(), mod.startDay);
    const tIdx = order.indexOf(mo), cIdx = order.indexOf(cur);
    const lim = full ? order.length : Math.max(0, Math.min(tIdx, cIdx < 0 ? tIdx : cIdx));   // רק חודשים שהסתיימו (full: כל התקופה, לסוף שנה)
    const rules = (opts && opts.rules) || {}, dec = (opts && opts.decisions) || {}, deps = (opts && opts.deposits) || {};
    const any = Object.keys(rules).some(k => rules[k] === 'carry' || rules[k] === 'aside' || rules[k] === 'ask') || Object.keys(dec).some(y => Object.keys(dec[y] || {}).length > 0);
    const op = mod.opening || {};   // יתרות פתיחה מהקובץ הקודם
    let cf = mod.fixed.list.map((_, j) => num(op['fixed:' + j])), cv = mod.variable.list.map((_, j) => num(op['var:' + j]));
    for (let i = 0; any && i < lim; i++) {
      const m = order[i], ym = ymFor(mod, m), bud = await budgets(mod, ym), act = await actuals(mod, m);
      if (!act) continue;
      const step = (isVar, carry, bg, ac) => carry.map((c, j) => {
        const key = (isVar ? 'var:' : 'fixed:') + j, decided = dec[ym] && dec[ym][key], rule = decided || rules[key];
        if (!(bg[j] > 0 || c !== 0)) return 0;
        const R = (bg[j] + c) - ac[j];
        // לגלגל: הכול עובר הלאה. לשים בצד: יתרה חיובית מופקדת, אבל אי אפשר להפקיד מינוס, אז חוסר מתגלגל עד שיש פלוס.
        // לשאול ללא החלטה: חוסר מתגלגל, יתרה חיובית מחכה להחלטה. לא נבחר: אין גלגול.
        if (rule === 'carry') return R;
        // לשים בצד: הפקדה לא נחשבת הוצאה, והכסף נשאר שייך לסעיף. לכן גם יתרה וגם חוסר מתגלגלים לחודש הבא (הסימון "הפקדתי" הוא רק תזכורת).
        if (rule === 'aside') return R;
        if (rule === 'ask' && !decided) return R < 0 ? R : 0;
        return 0;
      });
      cf = step(false, cf, bud.fixed, act.fixed); cv = step(true, cv, bud.variable, act.variable);
    }
    return { fixed: cf, variable: cv };
  }
  async function budget(month, opts) {
    const mod = await model(), now = cfg.now();
    const curMonth = finMonth(now, mod.startDay), mo = month || curMonth, ym = ymFor(mod, mo);
    const b = await budgets(mod, ym), cr = await carries(mod, mo, opts);
    let fa, va;
    if (mod.v2) {
      const a = await actuals2(mod, mo);
      fa = a.fixed.map(x => [x]); va = a.weeks;
    } else {
      const fcN = mod.fixed.cols[mo], vcN = mod.variable.cols[mo];
      if (!fcN || !vcN) throw new Error('בגיליון אין עמודות לחודש ' + mo);
      const fc = colLetter(fcN), vc1 = colLetter(vcN[0]), vc2 = colLetter(vcN[vcN.length - 1]);
      const fr = mod.fixed.first, vr = mod.variable.first;
      [fa, va] = await batchVals([
        q(SHEETS.FIXED) + '!' + fc + fr + ':' + fc + (fr + mod.fixed.list.length - 1),
        q(SHEETS.VAR) + '!' + vc1 + vr + ':' + vc2 + (vr + mod.variable.list.length - 1)
      ]);
    }
    function group(list, arr, actual, isVar, carry) {
      const groups = []; let cur = null;
      list.forEach((it, i) => {
        if (!(arr[i] > 0)) return;
        if (!cur || cur.name !== it.group) { cur = { name: it.group, items: [] }; groups.push(cur); }
        const item = { key: (isVar ? 'var:' : 'fixed:') + it.n, name: it.name, budget: arr[i], carry: Math.round((carry[i] || 0) * 100) / 100 };
        if (isVar) {
          item.weekly = Math.round(arr[i] / 4.3);
          item.weeks = [0, 1, 2, 3, 4].map(w => num(at(actual[i], w)));
          item.spent = item.weeks.reduce((a, x) => a + x, 0);
        } else item.spent = num(at(actual[i], 0));
        cur.items.push(item);
      });
      return groups;
    }
    return { ok: true, format: mod.v2 ? 2 : 1, ended: !!(mod.v2 && curYm(mod) > ymFor(mod, monthOrder(mod)[monthOrder(mod).length - 1])), order: monthOrder(mod), month: mo, ym: ym, currentYm: curYm(mod), firstMonth: monthOrder(mod)[0] || 1, startDay: mod.startDay, currentMonth: curMonth, currentWeek: weekIdx(now, mod.startDay, curMonth), budgetColumn: b.col, budgetFrozen: b.frozen,
      fixed: group(mod.fixed.list, b.fixed, fa, false, cr.fixed), variable: group(mod.variable.list, b.variable, va, true, cr.variable) };
  }

  async function entries(month) {
    await ensureSheet(SHEETS.LOG, LOG_HEADER);
    const rows = await getVals(q(SHEETS.LOG) + '!A2:M20000');
    const out = [];
    rows.forEach(r => {
      if (month && Number(r[L.MONTH]) !== Number(month)) return;
      out.push({ id: String(r[L.ID]), dt: String(r[L.DT]), key: String(r[L.KEY]), amount: num(r[L.AMOUNT]), tags: String(r[L.TAGS] || '').split(',').map(trim).filter(Boolean), note: String(r[L.NOTE] || ''), by: String(r[L.BY] || '') });
    });
    return { ok: true, entries: out };
  }

  /* ---------- כתיבה ---------- */
  function parseKey(key) { const m = /^(fixed|var):(\d+)$/.exec(String(key)); if (!m) throw new Error('מפתח קטגוריה לא תקין'); return { isVar: m[1] === 'var', n: Number(m[2]) }; }
  function target(mod, key, dt) {
    const k = parseKey(key), sec = k.isVar ? mod.variable : mod.fixed, item = sec.list[k.n];
    if (!item || item.gone) throw new Error('הקטגוריה לא קיימת בגיליון');
    const mo = finMonth(dt, mod.startDay), week = k.isVar ? weekIdx(dt, mod.startDay, mo) : null;
    if (mod.v2) return { item: item, isVar: k.isVar, month: mo, week: week, a1: '', ref: '', title: '' };
    const mc = sec.cols[mo]; if (!mc) throw new Error('בגיליון אין עמודות לחודש ' + mo);
    const row = sec.first + k.n, col = k.isVar ? mc[Math.min(week, mc.length - 1)] : mc;
    const a1 = colLetter(col) + row;
    return { item: item, isVar: k.isVar, month: mo, week: week, a1: a1, ref: sec.title + '!' + a1, title: sec.title };
  }
  async function ensureFormula(t, key) {
    if (!t.ref) return;   // בפורמט החדש אין נוסחאות שהאפליקציה תלויה בהן
    const formula = "=SUMIFS('" + SHEETS.LOG + "'!$F:$F,'" + SHEETS.LOG + "'!$K:$K,\"" + t.ref + '")';
    const cell = q(t.title) + '!' + t.a1;
    const f = (await getVals(cell, 'FORMULA'))[0];
    const cur = f ? f[0] : '';
    if (cur === formula) return;
    if (cur !== '' && typeof cur === 'number' && cur !== 0) {   // ערך שהוקלד ידנית לא הולך לאיבוד
      await appendVals(SHEETS.LOG, [['pre-' + t.ref, nowText(), t.isVar ? 'משתנה' : 'קבועה', t.item.group, t.item.name, cur, '', 'יתרה קודמת בגיליון', t.month, t.isVar ? t.week + 1 : '', t.ref, key]]);
    }
    await putVals(cell, [[formula]], 'USER_ENTERED');
  }
  const nowText = () => { const d = cfg.now(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const logRow = (e, t, amount) => [e.id, e.dt, t.isVar ? 'משתנה' : 'קבועה', t.item.group, t.item.name, amount, (e.tags || []).join(','), e.note || '', t.month, t.isVar ? t.week + 1 : '', t.ref, e.key, e.by || ''];

  async function findRow(id) {
    const ids = await getVals(q(SHEETS.LOG) + '!A2:A20000');
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
    return -1;
  }
  async function add(e) {
    await ensureSheet(SHEETS.LOG, LOG_HEADER);
    if (!e || !e.id) throw new Error('חסר מזהה');
    const amount = Number(e.amount); if (!(amount > 0)) throw new Error('הסכום חייב להיות גדול מאפס');
    if (!cache.logHdr) { cache.logHdr = true; await putVals(q(SHEETS.LOG) + '!M1', [[LOG_HEADER[12]]], 'RAW'); }   // כותרת עמודת "נוסף ע"י" גם בגיליונות שנוצרו לפני כן
    if (await findRow(e.id) > 0) return { ok: true, duplicate: true };
    const mod = await model(), t = target(mod, e.key, parseDt(e.dt));
    await ensureFormula(t, e.key);
    await appendVals(SHEETS.LOG, [logRow(e, t, amount)]);
    return { ok: true };
  }
  async function update(e) {
    await ensureSheet(SHEETS.LOG, LOG_HEADER);
    const row = await findRow(e.id); if (row < 0) throw new Error('ההוצאה לא נמצאה');
    const amount = Number(e.amount); if (!(amount > 0)) throw new Error('הסכום חייב להיות גדול מאפס');
    const mod = await model(), t = target(mod, e.key, parseDt(e.dt));
    await ensureFormula(t, e.key);
    await putVals(q(SHEETS.LOG) + '!A' + row + ':M' + row, [logRow(e, t, amount)], 'RAW');
    return { ok: true };
  }
  async function del(id) {
    await ensureSheet(SHEETS.LOG, LOG_HEADER);
    const row = await findRow(id);
    if (row > 0) {
      const sheetId = (await meta())[SHEETS.LOG];
      await api(':batchUpdate', { method: 'POST', body: { requests: [{ deleteDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] } });
    }
    return { ok: true };
  }
  async function ping() { const mod = await model(); return { ok: true, startDay: mod.startDay, version: 3, format: mod.v2 ? 2 : 1 }; }

  /* ---------- ממשק אחיד לאפליקציה ---------- */
  /* העדפות (סדר קטגוריות, תגיות, בחירות סוף חודש): תא אחד בלשונית ההגדרות, בעמודה E, רחוק מהעמודות של התקציב */
  async function prefs() {
    await ensureSheet(SHEETS.SETTINGS, SETTINGS_HEADER);
    const v = await getVals(q(SHEETS.SETTINGS) + '!E2:E2');
    cache.prefsRaw = { at: Date.now(), raw: v[0] && v[0][0] ? v[0][0] : '' };
    let out = null;
    try { out = v[0] && v[0][0] ? JSON.parse(v[0][0]) : null; } catch (e) { out = null; }
    return { ok: true, prefs: out };
  }
  async function setPrefs(pr) {
    if (!pr || typeof pr !== 'object') throw new Error('העדפות לא תקינות');
    const json = JSON.stringify(pr);
    if (json.length > 45000) throw new Error('ההעדפות גדולות מדי');
    await ensureSheet(SHEETS.SETTINGS, SETTINGS_HEADER);
    // גיבוי: שומרים בצד את הגרסה עם הכי הרבה כללי סוף חודש, כדי שאפשר יהיה לשחזר אם מישהו דורס בטעות
    const ruleCount = o => (o && o.eomRules) ? Object.keys(o.eomRules).length : 0;
    // קריאה אחת בלבד (או בלי קריאה אם הערך נקרא ממש עכשיו), כדי לא לעבור את מכסת הקריאות של גוגל
    let curRaw, bakRaw = null;
    const pc = cache.prefsRaw;
    if (pc && Date.now() - pc.at < 15000) curRaw = pc.raw;
    else { const r = await batchVals([q(SHEETS.SETTINGS) + '!E2', q(SHEETS.SETTINGS) + '!G2']); curRaw = r[0][0] && r[0][0][0] ? r[0][0][0] : ''; bakRaw = r[1][0] && r[1][0][0] ? r[1][0][0] : ''; }
    let oldP = null;
    try { oldP = curRaw ? JSON.parse(curRaw) : null; } catch (e) { oldP = null; }
    if (oldP && ruleCount(oldP) > ruleCount(pr)) {
      if (bakRaw === null) { const g = await getVals(q(SHEETS.SETTINGS) + '!G2:G2'); bakRaw = g[0] && g[0][0] ? g[0][0] : ''; }
      let bakP = null; try { bakP = bakRaw ? JSON.parse(bakRaw) : null; } catch (e) { bakP = null; }
      if (ruleCount(oldP) >= ruleCount(bakP)) await putVals(q(SHEETS.SETTINGS) + '!G1:G2', [['גיבוי הגדרות סוף חודש (לא לערוך)'], [curRaw]], 'RAW');
    }
    await putVals(q(SHEETS.SETTINGS) + '!E1:E2', [['העדפות האפליקציה (לא לערוך)'], [json]], 'RAW');
    cache.prefsRaw = { at: Date.now(), raw: json };
    return { ok: true };
  }

  /* ---------- יצירה, תיקון והתחלת שנה חדשה (הפורמט החדש) ---------- */
  const sheetUrl = id => 'https://sheets.googleapis.com/v4/spreadsheets/' + id;
  /* גיליון חדש בדרייב של המשתמשת: לשוניות, נוסחאות, עיצוב והגנות. דורש רק את ההרשאה הקיימת (drive.file). */
  async function createFile(o) {
    o = o || {};
    const W = wb(), now = cfg.now();
    const startYm = Number(o.startYm) || (now.getFullYear() * 100 + now.getMonth() + 1);
    if (!(startYm % 100 >= 1 && startYm % 100 <= 12)) throw new Error('חודש התחלה לא תקין');
    const prog = (n, t) => { try { o.onProgress && o.onProgress(n, t); } catch (e) { /* התקדמות היא קישוט בלבד */ } };
    prog(8, 'בונה את מבנה הגיליון');
    const p = W.plan({ items: o.items, startYm: startYm, months: o.months, startDay: o.startDay, opening: o.opening, prefsJson: o.prefsJson });
    const j = await api('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: W.createBody(o.title || 'שיקוף תקציב - לעבודה עם אפליקציית ״הוצאות עם מאיה״', p) });
    const id = j.spreadsheetId, base = sheetUrl(id);
    prog(30, 'כותבת את הקטגוריות והנוסחאות');
    await api(base + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data: p.formulas } });
    prog(55, 'שומרת הגדרות');
    await api(base + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data: p.raw } });
    prog(68, 'מעצבת ומוסיפה הגנות');
    await api(base + ':batchUpdate', { method: 'POST', body: { requests: W.formatRequests(p) } });
    return { ok: true, id: id, name: (j.properties && j.properties.title) || o.title || 'שיקוף תקציב - לעבודה עם אפליקציית ״הוצאות עם מאיה״', url: j.spreadsheetUrl || ('https://docs.google.com/spreadsheets/d/' + id + '/edit'), months: p.months, startYm: startYm };
  }
  const swapIds = (x, map) => { if (Array.isArray(x)) return x.map(v => swapIds(v, map)); if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach(k => { o[k] = (k === 'sheetId' && map[x[k]] != null) ? map[x[k]] : swapIds(x[k], map); }); return o; } return x; };
  /* תיקון: כותב מחדש את נוסחאות הצפייה, העיצוב וההגנות. לא נוגע בתקציב, ביומן או בהגדרות. */
  async function repair() {
    cache.model = null;
    const mod = await model(); if (!mod.v2) throw new Error('התיקון מיועד לקובץ בפורמט החדש');
    const W = wb(), rows = await getVals(q(SHEETS.ITEMS) + '!A1:I500'), parsed = W.parseItems(rows);
    const items = parsed.items;
    const p = W.repairPlan(items, mod.startYm, mod.months, parsed.layout, parsed.marks);
    let m = await meta(true);
    const adds = p.sheets.filter(s => m[s[1]] == null).map(s => ({ addSheet: { properties: { title: s[1], rightToLeft: true } } }));
    if (adds.length) { await api(':batchUpdate', { method: 'POST', body: { requests: adds } }); m = await meta(true); }
    const map = {}; p.sheets.forEach(s => { map[s[0]] = m[s[1]]; });
    const info = await api('', { params: { fields: 'sheets.protectedRanges.protectedRangeId' } });
    const dels = []; (info.sheets || []).forEach(s => (s.protectedRanges || []).forEach(r => dels.push({ deleteProtectedRange: { protectedRangeId: r.protectedRangeId } })));
    await api('/values:batchClear', { method: 'POST', body: { ranges: [q(W.T.VAR) + '!A1:DZ300', q(W.T.FIXED) + '!A1:DZ300'] } });
    await api('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data: p.formulas } });
    await api('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data: p.raw } });
    const reqs = swapIds(W.formatRequests(p), map);
    await api(':batchUpdate', { method: 'POST', body: { requests: dels.concat(reqs) } });
    cache.model = null;
    return { ok: true, items: items.length };
  }
  /* יתרות בסוף התקופה: מה שעובר לקובץ הבא לפי כללי סוף החודש */
  async function closingCarry(mod, opts) { return carries0(mod, null, opts, true); }
  /* קובץ חדש לשנה הבאה: אותם סעיפים והתקציב הנוכחי, אותן העדפות, והיתרות מועברות כיתרות פתיחה */
  async function newYear(o) {
    o = o || {};
    cache.model = null;
    const mod = await model(); if (!mod.v2) throw new Error('פתיחת קובץ חדש זמינה בקובץ בפורמט החדש');
    const ord = monthOrder(mod), startYm = nextYm(ymFor(mod, ord[ord.length - 1]));
    const cr = await closingCarry(mod, o), opening = {};
    mod.fixed.list.forEach((it, j) => { if (!it.gone && Math.abs(cr.fixed[j]) > 0.005) opening['fixed:' + j] = Math.round(cr.fixed[j] * 100) / 100; });
    mod.variable.list.forEach((it, j) => { if (!it.gone && Math.abs(cr.variable[j]) > 0.005) opening['var:' + j] = Math.round(cr.variable[j] * 100) / 100; });
    const items = [];
    [['קבועה', mod.fixed.list, 'fixed:'], ['שוטפת', mod.variable.list, 'var:']].forEach(([type, list, pref]) => list.forEach(it => { if (!it.gone) items.push({ type: type, group: it.group, name: it.name, budget: it.budget, key: pref + it.n }); }));
    const pr = o.prefs ? Object.assign({}, o.prefs, { ts: cfg.now().getTime(), decisions: {}, deposits: {} }) : null;
    const f = await createFile({ title: o.title || 'שיקוף תקציב - לעבודה עם אפליקציית ״הוצאות עם מאיה״ ' + (startYm % 100 >= 1 ? Math.floor(startYm / 100) : ''), items: items, startYm: startYm, months: 12, startDay: mod.startDay, opening: opening, prefsJson: pr ? JSON.stringify(pr) : '' });
    f.opening = opening;
    return f;
  }
  async function call(action, p) {
    p = p || {};
    switch (action) {
      case 'ping': return ping();
      case 'budget': return budget(p.month, p);
      case 'entries': return entries(p.month);
      case 'settings': return settings();
      case 'prefs': return prefs();
      case 'setPrefs': return setPrefs(p.prefs);
      case 'prefsBackup': { await ensureSheet(SHEETS.SETTINGS, SETTINGS_HEADER); const v = await getVals(q(SHEETS.SETTINGS) + '!G2:G2'); let o = null; try { o = v[0] && v[0][0] ? JSON.parse(v[0][0]) : null; } catch (e) { o = null; } return { ok: true, prefs: o }; }
      case 'repair': return repair();
      case 'newYear': return newYear(p);
      case 'setBudgetColumn': cache.model = null; { const m0 = await model(); if (m0.v2) throw new Error('בקובץ הזה התקציב נכתב בלשונית "התקציב", בעמודה "תקציב חודשי"'); } return setBudgetColumn(p.col);
      case 'add': cache.carry = null; cache.logSums = null; return add(p.entry);
      case 'update': cache.carry = null; cache.logSums = null; return update(p.entry);
      case 'delete': cache.carry = null; cache.logSums = null; return del(p.id);
      default: throw new Error('פעולה לא מוכרת');
    }
  }

  /* הגיליונות שהאפליקציה יצרה או שנבחרו בה (הרשאת drive.file מחזירה רק אותם), לחיפוש אוטומטי בכניסה ממכשיר חדש */
  async function listFiles() {
    const j = await api('https://www.googleapis.com/drive/v3/files', { params: { q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false", fields: 'files(id,name,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: 20 } });
    return j.files || [];
  }
  const Bridge = { configure: configure, call: call, createFile: createFile, listFiles: listFiles, _internals: { model: () => model(), calls: () => apiCalls, colIndex: colIndex, colLetter: colLetter, SHEETS: SHEETS } };
  if (typeof module !== 'undefined' && module.exports) module.exports = Bridge; else root.Bridge = Bridge;
})(typeof window !== 'undefined' ? window : globalThis);
