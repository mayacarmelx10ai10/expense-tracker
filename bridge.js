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

  const SHEETS = { BUDGET: 'תקציב משק בית', FIXED: 'בקרה קבועות', VAR: 'בקרה משתנות', SUMMARY: 'סיכום בקרה קבועות ומשתנות', LOG: 'יומן הוצאות', SETTINGS: 'הגדרות אפליקציה', SNAP: 'תקציב לפי חודש' };
  const LOG_HEADER = ['מזהה', 'תאריך ושעה', 'סוג', 'קבוצה', 'קטגוריה', 'סכום', 'תגיות', 'הערה', 'חודש', 'שבוע', 'יעד בבקרה', 'מפתח'];
  const L = { ID: 0, DT: 1, TYPE: 2, GROUP: 3, NAME: 4, AMOUNT: 5, TAGS: 6, NOTE: 7, MONTH: 8, WEEK: 9, TARGET: 10, KEY: 11 };
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
    let url = 'https://sheets.googleapis.com/v4/spreadsheets/' + cfg.sheetId + path;
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
  /* סדר החודשים בגיליון (מתחיל באוקטובר בגיליון שלך) ושנה לכל חודש */
  const monthOrder = mod => Object.keys(mod.variable.cols).map(Number).sort((x, y) => mod.variable.cols[x][0] - mod.variable.cols[y][0]);
  function ymFor(mod, m) {
    const now = cfg.now(), first = monthOrder(mod)[0] || 1, cur = finMonth(now, mod.startDay);
    const firstYear = cur >= first ? now.getFullYear() : now.getFullYear() - 1;
    return m >= first ? firstYear * 100 + m : (firstYear + 1) * 100 + m;
  }
  const curYm = m => ymFor(m, finMonth(cfg.now(), m.startDay));

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
    const live = liveBudgets(mod, await colHistory(), ym);
    const rows = [[ym, '_meta', '', '', 0, live.col]];
    mod.fixed.list.forEach((it, i) => { if (live.fixed[i] > 0) rows.push([ym, 'fixed:' + it.n, it.group, it.name, live.fixed[i], live.col]); });
    mod.variable.list.forEach((it, i) => { if (live.variable[i] > 0) rows.push([ym, 'var:' + it.n, it.group, it.name, live.variable[i], live.col]); });
    await appendVals(SHEETS.SNAP, rows);
    cache.snaps = cache.snaps || {}; cache.snaps[ym] = live;
    return live;
  }
  async function budgets(mod, ym) {
    const frozen = ym <= curYm(mod);
    const b = frozen ? await snapshotIfMissing(mod, ym) : liveBudgets(mod, await colHistory(), ym);
    b.frozen = frozen;
    return b;
  }

  async function settings() {
    const mod = await model(), hist = await colHistory(), cy = curYm(mod);
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
    const key = mo + '|' + JSON.stringify((opts && opts.rules) || {}) + '|' + JSON.stringify((opts && opts.decisions) || {});
    if (cache.carry && cache.carry.key === key && Date.now() - cache.carry.at < 20000) return cache.carry.v;
    const v = await carries0(mod, mo, opts); cache.carry = { key: key, at: Date.now(), v: v }; return v;
  }
  async function carries0(mod, mo, opts) {
    const order = monthOrder(mod), cur = finMonth(cfg.now(), mod.startDay);
    const tIdx = order.indexOf(mo), cIdx = order.indexOf(cur);
    const lim = Math.max(0, Math.min(tIdx, cIdx < 0 ? tIdx : cIdx));   // רק חודשים שהסתיימו
    const rules = (opts && opts.rules) || {}, dec = (opts && opts.decisions) || {};
    const any = Object.keys(rules).some(k => rules[k] === 'carry' || rules[k] === 'aside' || rules[k] === 'ask') || Object.keys(dec).some(y => Object.keys(dec[y] || {}).length > 0);
    let cf = mod.fixed.list.map(() => 0), cv = mod.variable.list.map(() => 0);
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
        if (rule === 'aside' || (rule === 'ask' && !decided)) return R < 0 ? R : 0;
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
    const fcN = mod.fixed.cols[mo], vcN = mod.variable.cols[mo];
    if (!fcN || !vcN) throw new Error('בגיליון אין עמודות לחודש ' + mo);
    const fc = colLetter(fcN), vc1 = colLetter(vcN[0]), vc2 = colLetter(vcN[vcN.length - 1]);
    const fr = mod.fixed.first, vr = mod.variable.first;
    const [fa, va] = await batchVals([
      q(SHEETS.FIXED) + '!' + fc + fr + ':' + fc + (fr + mod.fixed.list.length - 1),
      q(SHEETS.VAR) + '!' + vc1 + vr + ':' + vc2 + (vr + mod.variable.list.length - 1)
    ]);
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
    return { ok: true, month: mo, ym: ym, currentYm: curYm(mod), firstMonth: monthOrder(mod)[0] || 1, startDay: mod.startDay, currentMonth: curMonth, currentWeek: weekIdx(now, mod.startDay, curMonth), budgetColumn: b.col, budgetFrozen: b.frozen,
      fixed: group(mod.fixed.list, b.fixed, fa, false, cr.fixed), variable: group(mod.variable.list, b.variable, va, true, cr.variable) };
  }

  async function entries(month) {
    await ensureSheet(SHEETS.LOG, LOG_HEADER);
    const rows = await getVals(q(SHEETS.LOG) + '!A2:L20000');
    const out = [];
    rows.forEach(r => {
      if (month && Number(r[L.MONTH]) !== Number(month)) return;
      out.push({ id: String(r[L.ID]), dt: String(r[L.DT]), key: String(r[L.KEY]), amount: num(r[L.AMOUNT]), tags: String(r[L.TAGS] || '').split(',').map(trim).filter(Boolean), note: String(r[L.NOTE] || '') });
    });
    return { ok: true, entries: out };
  }

  /* ---------- כתיבה ---------- */
  function parseKey(key) { const m = /^(fixed|var):(\d+)$/.exec(String(key)); if (!m) throw new Error('מפתח קטגוריה לא תקין'); return { isVar: m[1] === 'var', n: Number(m[2]) }; }
  function target(mod, key, dt) {
    const k = parseKey(key), sec = k.isVar ? mod.variable : mod.fixed, item = sec.list[k.n];
    if (!item) throw new Error('הקטגוריה לא קיימת בגיליון');
    const mo = finMonth(dt, mod.startDay), week = k.isVar ? weekIdx(dt, mod.startDay, mo) : null;
    const mc = sec.cols[mo]; if (!mc) throw new Error('בגיליון אין עמודות לחודש ' + mo);
    const row = sec.first + k.n, col = k.isVar ? mc[Math.min(week, mc.length - 1)] : mc;
    const a1 = colLetter(col) + row;
    return { item: item, isVar: k.isVar, month: mo, week: week, a1: a1, ref: sec.title + '!' + a1, title: sec.title };
  }
  async function ensureFormula(t, key) {
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
  const logRow = (e, t, amount) => [e.id, e.dt, t.isVar ? 'משתנה' : 'קבועה', t.item.group, t.item.name, amount, (e.tags || []).join(','), e.note || '', t.month, t.isVar ? t.week + 1 : '', t.ref, e.key];

  async function findRow(id) {
    const ids = await getVals(q(SHEETS.LOG) + '!A2:A20000');
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
    return -1;
  }
  async function add(e) {
    await ensureSheet(SHEETS.LOG, LOG_HEADER);
    if (!e || !e.id) throw new Error('חסר מזהה');
    const amount = Number(e.amount); if (!(amount > 0)) throw new Error('הסכום חייב להיות גדול מאפס');
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
    await putVals(q(SHEETS.LOG) + '!A' + row + ':L' + row, [logRow(e, t, amount)], 'RAW');
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
  async function ping() { const mod = await model(); return { ok: true, startDay: mod.startDay, version: 3 }; }

  /* ---------- ממשק אחיד לאפליקציה ---------- */
  /* העדפות (סדר קטגוריות, תגיות, בחירות סוף חודש): תא אחד בלשונית ההגדרות, בעמודה E, רחוק מהעמודות של התקציב */
  async function prefs() {
    await ensureSheet(SHEETS.SETTINGS, SETTINGS_HEADER);
    const v = await getVals(q(SHEETS.SETTINGS) + '!E2:E2');
    let out = null;
    try { out = v[0] && v[0][0] ? JSON.parse(v[0][0]) : null; } catch (e) { out = null; }
    return { ok: true, prefs: out };
  }
  async function setPrefs(pr) {
    if (!pr || typeof pr !== 'object') throw new Error('העדפות לא תקינות');
    const json = JSON.stringify(pr);
    if (json.length > 45000) throw new Error('ההעדפות גדולות מדי');
    await ensureSheet(SHEETS.SETTINGS, SETTINGS_HEADER);
    await putVals(q(SHEETS.SETTINGS) + '!E1:E2', [['העדפות האפליקציה (לא לערוך)'], [json]], 'RAW');
    return { ok: true };
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
      case 'setBudgetColumn': cache.model = null; return setBudgetColumn(p.col);
      case 'add': cache.carry = null; return add(p.entry);
      case 'update': cache.carry = null; return update(p.entry);
      case 'delete': cache.carry = null; return del(p.id);
      default: throw new Error('פעולה לא מוכרת');
    }
  }

  const Bridge = { configure: configure, call: call, _internals: { calls: () => apiCalls, colIndex: colIndex, colLetter: colLetter, SHEETS: SHEETS } };
  if (typeof module !== 'undefined' && module.exports) module.exports = Bridge; else root.Bridge = Bridge;
})(typeof window !== 'undefined' ? window : globalThis);
