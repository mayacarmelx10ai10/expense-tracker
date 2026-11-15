/* בונה את קובץ המעקב החדש (גיליון גוגל) בלי תלות בקובץ אחר, ומתקן אותו אם נמחקו נוסחאות או הגנות.
 *
 * מבנה (מפורט ב-docs/new-file-plan.md):
 *   התקציב            המשתמשת כותבת: סוג, קבוצה, סעיף, תקציב חודשי, מפתח
 *   משתנות / קבועות   נוסחאות לצפייה בלבד. האפליקציה לא קוראת אותן
 *   יומן הוצאות       האפליקציה כותבת
 *   תקציב לפי חודש    עותק התקציב לכל חודש (שינוי חל רק קדימה)
 *   הגדרות אפליקציה   תחילת התקציב, משך, העדפות
 * כל הלשוניות מוגנות באזהרה בלבד ("Heads up"): מונעת מחיקה בטעות, ולא חוסמת בכוונה.
 */
(function (root) {
  'use strict';

  const T = { ITEMS: 'התקציב', VAR: 'הוצאות משתנות', FIXED: 'הוצאות קבועות', LOG: 'יומן הוצאות', SNAP: 'תקציב לפי חודש', SET: 'הגדרות אפליקציה', SUM: 'סיכום בקרה קבועות ומשתנות', CREDIT: 'לא חובה - יתרת תשלומים באשראי', BIZ: 'תקציב לבעלי עסק' };
  const ID = { ITEMS: 1, VAR: 2, FIXED: 3, LOG: 4, SNAP: 5, SET: 6, SUM: 7, CREDIT: 8, BIZ: 9 };
  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const LOG_HEADER = ['מזהה', 'תאריך ושעה', 'סוג', 'קבוצה', 'קטגוריה', 'סכום', 'תגיות', 'הערה', 'חודש', 'שבוע', 'יעד בבקרה', 'מפתח', 'נוסף ע"י'];
  const SNAP_HEADER = ['חודש (שנה+חודש)', 'מפתח', 'קבוצה', 'קטגוריה', 'תקציב', 'עמודה'];
  const SET_HEADER = ['הגדרה', 'ערך', 'בתוקף מחודש (שנה+חודש)'];
    const NUMFMT = '#,##0;[Red]-#,##0';
  const q = t => "'" + t + "'";
  const col = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  /* קטלוג סעיפים: אותם סעיפים ואותו סדר כמו בקובץ המקורי, בלי שמות אישיים (הוחלפו ב"שונות") */
  const X = (n, c) => new Array(c).fill(n);
  const CATALOG = {
    income: ['הכנסה מעבודה', 'הכנסה מעבודה', 'הכנסה מקצבה', 'עזרה מהורים', 'הכנסה אחרת', 'קצבת ילדים'],
    fixed: [
      ['הוצאות בית', ['שכר דירה', 'גז', 'חשמל', 'מים', 'עגכע', 'ועד בית', 'משכנתא - כולל ביטוח', 'עוזרת בית', 'עיתונים', 'בר מים', 'אחר', 'אחר']],
      ['תקשורת', ['טלפון', 'טלפון נייד', 'אינטרנט', 'כבלים/ טלויזיה בלווין', 'שונות', 'אחר']],
      ['חינוך', ['מעון', 'חוגים/ שיעורי עזר', 'גן', 'פסיכולוג/ הוראה מתקנת', 'ביה"ס', 'אחר', 'אחר', 'אחר']],
      ['תחבורה', ['ביטוח רכב', 'כביש 6 + חניות', 'רכב טיפולים ורישוי', 'אחר', 'אחר']],
      ['בריאות', ['קופ"ח ביטוח בריאות משלים', 'ביטוח חיים ריסק+ מחלות', 'ביטוח סיעודי פרטי', 'ביטוח רפואי פרטי', 'אחר', 'אחר', 'אחר']],
      ['בנקים ואשראי', ['הלוואות', 'ריבית על המינוס', 'עמלות בנק', 'חסכונות', 'אחר', 'אחר', 'אחר']],
      ['שונות', ['נסיעות וחופשות', 'יעד אחר ראוי'].concat(X('שונות', 9), ['מעשר', 'קרן חרום', 'בלת"ם (הוצאות לא מתוכננות)'])]],
    variable: [
      ['קניות', ['אוכל ומוצרי מכולת', 'סיגריות', 'הוצאות תינוקות', 'ביגוד והנעלה', 'אחר', 'אחר', 'אחר', 'אחר']],
      ['טיפוח ורפואה', ['קוסמטיקה טיפולים ומוצרים', 'מספרה', 'הוצאות רפואיות', 'טיפולי שיניים', 'אחר', 'אחר']],
      ['תחבורה', ['דלק', 'אחזקת רכב', 'חניונים - פנגו', 'אחר', 'אחר']],
      ['בית', ['מוצרים ורהיטים לבית', 'ספרים דיסקים', 'חיות מחמד', 'אחזקת הבית']],
      ['בילויים', ['בילויים', 'מסעדות', 'מתנות לבני משפחה', 'דמי כיס', 'צעצועים', 'מתנות לאירועים', 'ויזה תשלומים']],
      ['שונות', ['כיסוי מינוס', 'מזומן שונות'].concat(X('שונות', 6))]]
  };
  function sampleItems() {
    const out = []; let nf = 0, nv = 0;
    CATALOG.fixed.forEach(g => g[1].forEach(n => out.push({ type: 'קבועה', group: g[0], name: n, budget: 0, key: 'fixed:' + nf++ })));
    CATALOG.variable.forEach(g => g[1].forEach(n => out.push({ type: 'שוטפת', group: g[0], name: n, budget: 0, key: 'var:' + nv++ })));
    return out;
  }
  /* קבועות קודם, אחר כך שוטפות; בתוך כל סוג הסדר המקורי. המפתח לא משתנה. */
  const orderItems = items => items.filter(i => i.type === 'קבועה').concat(items.filter(i => i.type !== 'קבועה'));

  function monthList(startYm, count) {
    const out = []; let y = Math.floor(startYm / 100), m = startYm % 100;
    for (let i = 0; i < count; i++) { out.push({ ym: y * 100 + m, mo: m, yr: y }); m++; if (m === 13) { m = 1; y++; } }
    return out;
  }

  /* ---- לשונית התקציב: אותה פריסה כמו "תקציב משק בית" בקובץ המקורי ----
   * A קבוצה (בשורה הראשונה של הקבוצה) / שם הכנסה, B סעיף, C מפתח (עמודה מוסתרת, האפליקציה כותבת), D תאריך חיוב,
   * E מאזן קיים, F תקציב חדש (מכאן האפליקציה קוראת את התקציב), H הערות.
   * האפליקציה מזהה את המדורים לפי הכותרות בעמודה A: "הכנסות", "הוצאות קבועות", "הוצאות משתנות", "השורה התחתונה". */
  const norm = v => String(v == null ? '' : v).replace(/[״“”]/g, '"').trim();
  const numv = v => { const n = Number(String(v == null ? '' : v).replace(/[₪,\s]/g, '')); return isFinite(n) ? n : 0; };
  function parseItems(rows) {
    const flat = norm(rows[0] && rows[0][0]) === 'סוג';
    const items = [], marks = {};
    if (flat) {   // הפריסה הראשונה של הקובץ החדש: טבלה שטוחה (סוג, קבוצה, סעיף, תקציב, מפתח)
      rows.forEach((r, i) => { if (i === 0) return; const t = norm(r[0]), n = norm(r[2]); if (!t || !n) return; if (t !== 'קבועה' && t !== 'שוטפת' && t !== 'משתנה') return;
        items.push({ type: t === 'קבועה' ? 'קבועה' : 'שוטפת', group: norm(r[1]), name: n, budget: numv(r[3]), key: String(r[4] || ''), row: i + 1 }); });
      return { layout: 'flat', items: items, marks: marks };
    }
    let sec = '', group = '', grow = 0;
    rows.forEach((r, i) => {
      const a = norm(r[0]), b = norm(r[1]), row = i + 1;
      if (a === 'הכנסות') { sec = 'income'; marks.incH = row; return; }
      if (a === 'הוצאות קבועות') { sec = 'fixed'; marks.fixH = row; group = ''; return; }
      if (a === 'הוצאות משתנות' || a === 'הוצאות שוטפות') { sec = 'var'; marks.varH = row; group = ''; return; }
      if (a === 'השורה התחתונה') { sec = 'bottom'; marks.bot = row; return; }
      if (/^סה"כ יתרת הכנסות/.test(a)) { marks.top = row; return; }
      if (a === 'סה"כ הכנסות') { if (sec === 'income') marks.incT = row; else marks.botInc = row; return; }
      if (a === 'סה"כ הוצאות קבועות') { marks.fixT = row; return; }
      if (a === 'סה"כ הוצאות משתנות') { marks.varT = row; return; }
      if (a === 'סה"כ הוצאות') { marks.botExp = row; return; }
      if (a === 'סה"כ יתרה') { marks.botBal = row; return; }
      if ((sec === 'fixed' || sec === 'var') && b) {
        if (a) { group = a; grow = row; }
        items.push({ type: sec === 'fixed' ? 'קבועה' : 'שוטפת', group: group, name: b, budget: numv(r[5]), key: String(r[8] || ''), row: row, grow: grow || row });
      }
    });
    return { layout: 'sheet', items: items, marks: marks };
  }
  function buildItemsLayout(items, income) {
    const rows = [], meta = [], marks = {}, placed = [], fdef = [];
    const add = (cells, kind, extra) => { const r = ['', '', '', '', '', '', '', '', '']; Object.keys(cells).forEach(k => { r[k] = cells[k]; }); rows.push(r); meta.push(Object.assign({ row: rows.length, kind: kind }, extra || {})); return rows.length; };
    // rows[i] היא שורה i+1 בגיליון. השורות זהות לקובץ המקורי (שורה 1 ריקה)
    add({}, 'blank');
    marks.top = add({ 0: 'סה"כ יתרת הכנסות בניכוי הוצאות:', 7: 'הערות' }, 'top');
    add({}, 'blank');
    add({ 4: 'למלא כאן' }, 'fillhint');
    marks.incH = add({ 0: 'הכנסות', 4: 'מאזן קיים', 5: 'תקציב חדש' }, 'sechdr');
    const inc = income && income.length ? income : CATALOG.income;
    inc.forEach(n => {   // שם בלבד (ברירת מחדל), או {name, balance, budget, note} (העברה מקובץ קודם)
      const o = typeof n === 'string' ? { name: n } : n, hasB = o.budget != null && o.budget !== '';
      const r = add({ 0: o.name, 4: o.balance != null ? o.balance : 0, 5: hasB ? o.budget : '', 7: o.note || '' }, 'income'); if (!hasB) fdef.push(r);
    });
    marks.incT = add({ 0: 'סה"כ הכנסות' }, 'inctotal');
    add({ 3: 'תאריכים:' }, 'datehdr');
    [['fixH', 'fixT', 'הוצאות קבועות', 'קבועה'], ['varH', 'varT', 'הוצאות משתנות', 'שוטפת']].forEach(sc => {
      marks[sc[0]] = add({ 0: sc[2], 3: 'ציון ערכים', 4: 'מאזן קיים', 5: 'תקציב חדש' }, 'sechdr');
      const list = items.filter(i => (i.type === 'קבועה') === (sc[3] === 'קבועה'));
      let prev = null, band = -1, gr = 0, gi = -1;
      list.forEach(it => {
        const first = it.group !== prev; if (first) { band++; prev = it.group; }
        const hasB = it.budget != null && it.budget !== '';   // 0 הוא תקציב מוגדר. רק "אין ערך" מקבל את ברירת המחדל (=מאזן קיים)
        const r = add({ 0: first ? it.group : '', 1: it.name, 3: it.score != null ? it.score : '', 4: it.balance != null ? it.balance : 0, 5: hasB ? it.budget : '', 7: it.note || '', 8: it.key || '' }, 'item', { band: band, first: first, span: 1 });
        if (first) { gr = r; gi = meta.length - 1; } else meta[gi].span++;
        if (!hasB) fdef.push(r);
        placed.push(Object.assign({}, it, { row: r, grow: gr }));
      });
      marks[sc[1]] = add({ 0: 'סה"כ ' + sc[2] }, 'exptotal');
      add({}, 'blank');
    });
    marks.bot = add({ 0: 'השורה התחתונה' }, 'bothdr');
    marks.botInc = add({ 0: 'סה"כ הכנסות' }, 'inctotal');
    marks.botExp = add({ 0: 'סה"כ הוצאות' }, 'exptotal');
    marks.botBal = add({ 0: 'סה"כ יתרה' }, 'botbal');
    return { values: rows, meta: meta, items: placed, marks: marks, fdef: fdef };
  }
  /* ברירת מחדל כמו במקור: "תקציב חדש" (F) שווה ל"מאזן קיים" (E) עד שמשנים אותו */
  const defaultBudgetFormulas = fdef => fdef.map(r => ({ range: q(T.ITEMS) + '!F' + r, values: [['=E' + r]] }));
  /* נוסחאות הסכומים בעמודות E ו-F, לפי השורות שנמצאו (יצירה ותיקון) */
  function totalsFormulas(m) {
    const out = [], put = (row, f) => { if (row) ['E', 'F'].forEach(c => out.push({ range: q(T.ITEMS) + '!' + c + row, values: [[f(c)]] })); };
    if (m.incH && m.incT) put(m.incT, c => '=SUM(' + c + (m.incH + 1) + ':' + c + (m.incT - 1) + ')');
    if (m.fixH && m.fixT) put(m.fixT, c => '=SUM(' + c + (m.fixH + 1) + ':' + c + (m.fixT - 1) + ')');
    if (m.varH && m.varT) put(m.varT, c => '=SUM(' + c + (m.varH + 1) + ':' + c + (m.varT - 1) + ')');
    if (m.botInc && m.incT) put(m.botInc, c => '=' + c + m.incT);
    if (m.botExp && m.fixT && m.varT) put(m.botExp, c => '=' + c + m.fixT + '+' + c + m.varT);
    if (m.botBal && m.botInc && m.botExp) put(m.botBal, c => '=' + c + m.botInc + '-' + c + m.botExp);
    if (m.top && m.botBal) put(m.top, c => '=' + c + m.botBal);
    return out;
  }

  /* ---- לשוניות הצפייה (נוסחאות בלבד) ---- */
  /* אותו מבנה כמו "בקרה קבועות" / "בקרה משתנות" בקובץ המקורי: קבוצה, סעיף, תקציב (ובמשתנות גם תקציב שבועי),
   * ואז לכל חודש: בפועל ויתרה מצטברת (בקבועות), או חמישה שבועות ויתרה מצטברת (במשתנות).
   * היתרה כאן פשוטה: יתרה קודמת + תקציב החודש פחות מה שהוצא. כללי סוף החודש (גלגול/הפקדה/שאלה) נקבעים באפליקציה. */
  function viewValues(items, isVar, startYm, count, layout) {
    const RF = layout === 'flat' ? { g: 'B', n: 'C', b: 'D', k: 'E', grow: false } : { g: 'A', n: 'B', b: 'F', k: 'I', grow: true };
    const rows = [];   // br = השורה של הסעיף בלשונית "התקציב" (it.row אם ידועה, אחרת לפי הסדר)
    items.forEach((it, i) => { if ((it.type !== 'קבועה') === isVar) rows.push({ it: it, br: it.row || i + 2 }); });
    // כמו "בקרה קבועות" / "בקרה משתנות": שורה 1 חודשים, שורה 2 כותרות, מכאן הסעיפים. בקבועות עמודה A ריקה
    const g = isVar ? 0 : 1, pre = 4, per = isVar ? 6 : 2, months = monthList(startYm, count), width = pre + per * count, first = 3;
    const grid = []; for (let r = 0; r < first - 1 + rows.length; r++) grid.push(new Array(width).fill(''));
    if (isVar) { grid[1][0] = 'הוצאות משתנות'; grid[1][2] = 'תקציב'; grid[1][3] = 'תקציב שבועי'; }
    else { grid[0][1] = 'תקציב חדש'; grid[1][1] = 'הוצאות קבועות'; grid[1][3] = 'תקציב'; }
    const IT = q(T.ITEMS), SN = q(T.SNAP), LG = q(T.LOG);
    rows.forEach((r, i) => {
      const row = grid[first - 1 + i], R = first + i;
      row[g] = '=' + IT + '!$' + RF.g + '$' + (RF.grow ? (r.it.grow || r.br) : r.br); row[g + 1] = '=' + IT + '!$' + RF.n + '$' + r.br; row[g + 2] = '=N(' + IT + '!$' + RF.b + '$' + r.br + ')';
      if (isVar) row[3] = '=C' + R + '/4.3';
    });
    months.forEach((m, mi) => {
      const c0 = pre + mi * per, ymc = '(YEAR(' + col(c0 + 1) + '$1)*100+MONTH(' + col(c0 + 1) + '$1))';
      grid[0][c0] = '=DATE(' + m.yr + ',' + m.mo + ',1)';
      (isVar ? ['שבוע 1', 'שבוע 2', 'שבוע 3', 'שבוע 4', 'שבוע 5', 'יתרה'] : ['בפועל', 'יתרה']).forEach((l, j) => { grid[1][c0 + j] = l; });
      rows.forEach((r, i) => {
        const row = grid[first - 1 + i], R = first + i, key = IT + '!$' + RF.k + '$' + r.br;
        const bud = 'IF(COUNTIFS(' + SN + '!$A:$A,' + ymc + ',' + SN + '!$B:$B,' + key + ')>0,SUMIFS(' + SN + '!$E:$E,' + SN + '!$A:$A,' + ymc + ',' + SN + '!$B:$B,' + key + '),N(' + IT + '!$' + RF.b + '$' + r.br + '))';
        const sum = w => 'SUMIFS(' + LG + '!$F:$F,' + LG + '!$L:$L,' + key + ',' + LG + '!$I:$I,MOD(' + ymc + ',100)' + (w ? ',' + LG + '!$J:$J,' + w : '') + ')';
        const prev = mi > 0 ? col(c0) + R : '0';
        if (isVar) {
          for (let w = 1; w <= 5; w++) row[c0 + w - 1] = '=' + sum(w);
          row[c0 + 5] = '=' + prev + '+' + bud + '-SUM(' + col(c0 + 1) + R + ':' + col(c0 + 5) + R + ')';
        } else { row[c0] = '=' + sum(0); row[c0 + 1] = '=' + prev + '+' + bud + '-' + col(c0 + 1) + R; }
      });
    });
    // שורת סיכום
    const tr = new Array(width).fill(''), last = first + rows.length - 1;
    tr[isVar ? 0 : 2] = isVar ? 'סה"כ הוצאות משתנות' : 'סה"כ הוצאות קבועות';
    const tot = c => rows.length ? '=SUM(' + col(c + 1) + first + ':' + col(c + 1) + last + ')' : 0;
    tr[g + 2] = tot(g + 2); if (isVar) tr[3] = tot(3);
    months.forEach((m, mi) => { const c0 = pre + mi * per; for (let j = 0; j < per; j++) tr[c0 + j] = tot(c0 + j); });
    grid.push(tr);
    if (isVar) {   // "סה"כ הוצאות משתנות לחודש" כמו במקור: סכום השבועות
      const t2 = new Array(width).fill(''); t2[0] = 'סה"כ הוצאות משתנות לחודש';
      months.forEach((m, mi) => { const c0 = pre + mi * per; t2[c0 + 5] = '=SUM(' + col(c0 + 1) + (last + 1) + ':' + col(c0 + 5) + (last + 1) + ')'; });
      grid.push(t2);
    }
    const groups = []; rows.forEach((r, i) => { if ((r.it.grow || r.br) === r.br) groups.push([first - 1 + i, 1]); else groups[groups.length - 1][1]++; });
    return { grid: grid, per: per, pre: pre, count: count, rowCount: rows.length, width: width, first: first, isVar: isVar, g: g, groups: groups, groupStarts: groups.slice(1).map(x => x[0]) };
  }

  /* ---- לשוניות שהאפליקציה כותבת ---- */
  const settingsValues = (startYm, months, startDay, opening) => [SET_HEADER.slice(), ['startYm', startYm], ['months', months], ['startDay', startDay || 1], ['opening', opening ? JSON.stringify(opening) : '']];
  const NOTE_SET = 'startYm = חודש תחילת התקציב (שנה+חודש). months = לכמה חודשים (עד 12). startDay = יום בחודש שבו החודש הפיננסי מתחיל. opening = יתרות פתיחה מהקובץ הקודם.';

  /* ---- בקשות עיצוב והגנה ---- */
  const rgb = hex => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
  function headerFmt(sheetId, r1, r2, c1, c2) {
    return { repeatCell: { range: { sheetId: sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
      cell: { userEnteredFormat: { backgroundColor: rgb('14161B'), horizontalAlignment: 'CENTER', textFormat: { bold: true, foregroundColor: rgb('FFFFFF') } } }, fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)' } };
  }
  const width = (sheetId, c1, c2, px) => ({ updateDimensionProperties: { range: { sheetId: sheetId, dimension: 'COLUMNS', startIndex: c1, endIndex: c2 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
  const protect = (sheetId, desc, extra) => ({ addProtectedRange: { protectedRange: Object.assign({ range: { sheetId: sheetId }, description: desc, warningOnly: true }, extra || {}) } });

  const DARK = { style: 'SOLID_MEDIUM', color: { red: 0.25, green: 0.25, blue: 0.25 } };
  function viewFormat(sheetId, v) {
    const rng = (r1, r2, c1, c2) => ({ sheetId: sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 });
    const f = (r1, r2, c1, c2, fmt, fields) => ({ repeatCell: { range: rng(r1, r2, c1, c2), cell: { userEnteredFormat: fmt }, fields: 'userEnteredFormat(' + fields + ')' } });
    const MED = { style: 'SOLID_MEDIUM', color: rgb('000000') }, THIN = { style: 'SOLID', color: rgb('B7B7B7') };
    const BLUE = 'BDD6EE', PINK = 'F9ADC3', NF = { type: 'NUMBER', pattern: '#,##0_ ;[Red]\\-#,##0\\ ' };
    const g = v.g, pre = v.pre, per = v.per, W = v.width, d0 = v.first - 1, d1 = d0 + v.rowCount, tot = d1;   // d0..d1 = שורות הסעיפים (0-based), tot = שורת הסכום
    const txt = (size, bold, white) => ({ fontFamily: 'Arial', fontSize: size, bold: !!bold, foregroundColor: rgb(white ? 'FFFFFF' : '000000') });
    const reqs = [f(0, tot + 3, 0, W, { backgroundColor: rgb('FFFFFF'), textFormat: txt(12), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'backgroundColor,textFormat,horizontalAlignment,verticalAlignment')];
    const wd = (c1, c2, px) => width(sheetId, c1, c2, px);
    if (v.isVar) reqs.push(wd(0, 1, 100), wd(1, 2, 170), wd(2, 3, 70), wd(3, 4, 85), wd(pre, W, 66));
    else reqs.push(wd(0, 1, 30), wd(1, 2, 110), wd(2, 3, 220), wd(3, 4, 75), wd(pre, W, 78));
    // כותרות (שורות 1-2)
    reqs.push(f(0, 2, g, W, { backgroundColor: rgb(BLUE), textFormat: txt(12, true) }, 'backgroundColor,textFormat'));
    reqs.push(f(0, 1, pre, W, { numberFormat: { type: 'DATE', pattern: 'mmm-yy' } }, 'numberFormat'));
    reqs.push({ updateBorders: { range: rng(0, 2, g, W), top: MED, bottom: MED, innerHorizontal: THIN } });
    for (let mi = 0; mi < v.count; mi++) {
      const c0 = pre + mi * per;
      reqs.push({ mergeCells: { range: rng(0, 1, c0, c0 + per), mergeType: 'MERGE_ALL' } });
      reqs.push({ updateBorders: { range: rng(0, tot + 1, c0, c0 + 1), left: MED } });
      if (!v.isVar) reqs.push(f(1, 2, c0, c0 + 1, { backgroundColor: rgb(PINK) }, 'backgroundColor'), f(1, 2, c0 + 1, c0 + 2, { backgroundColor: rgb('FFFFFF') }, 'backgroundColor'));
      else reqs.push(f(1, 2, c0 + 5, c0 + 6, { backgroundColor: rgb('FFFFFF') }, 'backgroundColor'));
    }
    if (!v.isVar) reqs.push({ mergeCells: { range: rng(0, 1, 1, 3), mergeType: 'MERGE_ALL' } }, { mergeCells: { range: rng(1, 2, 1, 3), mergeType: 'MERGE_ALL' } });
    // סעיפים
    reqs.push(f(d0, d1, g, W, { numberFormat: NF }, 'numberFormat'), { updateBorders: { range: rng(d0, d1, g, W), innerHorizontal: THIN, innerVertical: THIN, left: THIN, right: THIN, bottom: THIN } });
    reqs.push(f(d0, d1, g + 1, g + 2, { horizontalAlignment: 'RIGHT', textFormat: txt(12) }, 'horizontalAlignment,textFormat'));
    reqs.push(f(d0, d1, g, g + 1, { textFormat: txt(12, v.isVar) }, 'textFormat'));
    reqs.push(f(d0, d1, g + 2, v.isVar ? 4 : 4, { backgroundColor: rgb('666666'), textFormat: txt(11, false, true) }, 'backgroundColor,textFormat'));
    for (let mi = 0; mi < v.count; mi++) {
      const c0 = pre + mi * per;
      if (v.isVar) reqs.push(f(d0, d1, c0, c0 + 5, { backgroundColor: rgb('FFFFCC') }, 'backgroundColor'));
      else reqs.push(f(d0, d1, c0, c0 + 1, { backgroundColor: rgb('FFFFCC') }, 'backgroundColor'));
    }
    v.groups.forEach(x => {
      if (x[1] > 1) reqs.push({ mergeCells: { range: rng(x[0], x[0] + x[1], g, g + 1), mergeType: 'MERGE_ALL' } });
      reqs.push(f(x[0], x[0] + x[1], g, g + 1, { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: txt(13, v.isVar) }, 'horizontalAlignment,verticalAlignment,wrapStrategy,textFormat'));
      reqs.push({ updateBorders: { range: rng(x[0], x[0] + x[1], g, g + 1), left: MED } });
    });
    v.groups.forEach(x => reqs.push({ updateBorders: { range: rng(x[0], x[0] + 1, g, W), top: MED } }));
    // שורת סיכום
    const t0 = v.isVar ? 0 : 2;
    reqs.push(f(tot, tot + 1, t0, W, { backgroundColor: rgb('00B0F0'), textFormat: txt(12, true, true), numberFormat: NF }, 'backgroundColor,textFormat,numberFormat'));
    reqs.push({ updateBorders: { range: rng(tot, tot + 1, t0, W), top: MED, bottom: MED } });
    if (v.isVar) {
      reqs.push({ mergeCells: { range: rng(tot, tot + 1, 0, 2), mergeType: 'MERGE_ALL' } }, { mergeCells: { range: rng(tot + 1, tot + 2, 0, 2), mergeType: 'MERGE_ALL' } });
      reqs.push(f(tot + 1, tot + 2, 0, W, { textFormat: txt(12, true), numberFormat: NF }, 'textFormat,numberFormat'));
      for (let mi = 0; mi < v.count; mi++) { const c = pre + mi * per + 5; reqs.push(f(tot + 1, tot + 2, c, c + 1, { backgroundColor: rgb('00B0F0'), textFormat: txt(12, true, true) }, 'backgroundColor,textFormat')); }
    }
    reqs.push({ updateSheetProperties: { properties: { sheetId: sheetId, gridProperties: { frozenRowCount: 2, frozenColumnCount: 4 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
    reqs.push(protect(sheetId, 'לשונית לצפייה בלבד: נוסחאות. אם מחקת בטעות, בהגדרות האפליקציה יש "תיקון הגיליון"'));
    return reqs;
  }
  /* עיצוב של לשונית התקציב (יצירה בלבד): כמו הקובץ המקורי (Arial, כחול לכותרות, תכלת לסיכומים, אפור לשורה התחתונה),
   * עם קווי רשת בכל התאים וירוק לסה"כ הכנסות */
  function layoutFormat(meta, S0, nc0) {
    const S = S0 || ID.ITEMS, nc = nc0 || 6, out = [], N = '"₪"\\ #,##0;[Red]"₪"\\ \\-#,##0', n = meta.length + 2;
    const rg = (r1, r2, c1, c2) => ({ sheetId: S, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 });
    const fmt = (r1, r2, c1, c2, f, fields) => out.push({ repeatCell: { range: rg(r1, r2, c1, c2), cell: { userEnteredFormat: f }, fields: 'userEnteredFormat(' + fields + ')' } });
    const W = { foregroundColor: rgb('FFFFFF') }, thin = { style: 'SOLID', color: rgb('D0D0D0') };
    // בסיס: Arial 14 לכל הלשונית, יישור מרכז-אנכי
    fmt(0, n + 100, 0, Math.max(8, nc + 1), { textFormat: { fontFamily: 'Arial', fontSize: 12 }, verticalAlignment: 'MIDDLE' }, 'textFormat,verticalAlignment');
    fmt(0, n + 100, 4, nc, { numberFormat: { type: 'NUMBER', pattern: N }, horizontalAlignment: 'CENTER' }, 'numberFormat,horizontalAlignment');
    fmt(0, n + 100, 3, 4, { horizontalAlignment: 'CENTER' }, 'horizontalAlignment');
    fmt(0, n + 100, 0, 2, { horizontalAlignment: 'RIGHT' }, 'horizontalAlignment');
    meta.forEach(m => {
      const r = m.row - 1, k = m.kind;
      const box = () => out.push({ updateBorders: { range: rg(r, r + 1, 0, nc), top: thin, bottom: thin, left: thin, right: thin, innerVertical: thin } });
      const merge = () => out.push({ mergeCells: { range: rg(r, r + 1, 0, 2), mergeType: 'MERGE_ALL' } });
      const band = (hex, bold) => { fmt(r, r + 1, 0, nc, { backgroundColor: rgb(hex), textFormat: Object.assign({ fontFamily: 'Arial', fontSize: 12, bold: true }, bold ? W : {}) }, 'backgroundColor,textFormat'); };
      if (k === 'top') {
        fmt(r, r + 1, 0, nc, { backgroundColor: rgb('FFFFFF'), textFormat: { fontFamily: 'Arial', fontSize: 16, bold: true } }, 'backgroundColor,textFormat'); box(); merge();
        fmt(r, r + 1, 7, 8, { backgroundColor: rgb('FFFF00'), textFormat: { fontFamily: 'Calibri', fontSize: 16, bold: true } }, 'backgroundColor,textFormat');
        out.push({ updateDimensionProperties: { range: { sheetId: S, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 38 }, fields: 'pixelSize' } });
      } else if (k === 'fillhint') {
        fmt(r, r + 1, 4, 5, { backgroundColor: rgb('FFFF00'), textFormat: { fontFamily: 'Arial', fontSize: 13, bold: true }, horizontalAlignment: 'CENTER' }, 'backgroundColor,textFormat,horizontalAlignment');
        out.push({ updateBorders: { range: rg(r, r + 1, 4, 5), bottom: thin } });
      } else if (k === 'sechdr') { band('1F3864', true); box(); merge(); fmt(r, r + 1, 3, nc, { horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' }, 'horizontalAlignment,wrapStrategy'); }
      else if (k === 'total') { band('00B0F0', true); box(); merge(); }
      else if (k === 'inctotal') { band('1B6B35', true); box(); merge(); }
      else if (k === 'exptotal') { band('F9ADC3', false); box(); merge(); }
      else if (k === 'bothdr' || k === 'botbal') { band('7F7F7F', true); box(); merge(); }
      else if (k === 'botrow') { fmt(r, r + 1, 0, nc, { textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true } }, 'textFormat'); box(); merge(); }
      else if (k === 'datehdr') { fmt(r, r + 1, 3, 4, { textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true } }, 'textFormat'); }
      else if (k === 'income') { box(); merge(); fmt(r, r + 1, 4, 5, { backgroundColor: rgb('FFFFCC') }, 'backgroundColor'); }
      else if (k === 'item') {
        box(); fmt(r, r + 1, 4, 5, { backgroundColor: rgb('FFFFCC') }, 'backgroundColor');
        if (m.first) {
          out.push({ updateBorders: { range: rg(r, r + 1, 0, nc), top: DARK } }); out.push({ updateBorders: { range: rg(r - 1, r, 0, 6), bottom: DARK } });
          if (m.span > 1) out.push({ mergeCells: { range: rg(r, r + m.span, 0, 1), mergeType: 'MERGE_ALL' } });
          fmt(r, r + m.span, 0, 1, { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'horizontalAlignment,verticalAlignment,wrapStrategy');
          out.push({ updateBorders: { range: rg(r, r + m.span, 0, 1), top: thin, bottom: thin, left: thin, right: thin } });
        }
        // "ציון ערכים": תפריט נפתח 1 עד 10
        out.push({ setDataValidation: { range: rg(r, r + 1, 3, 4), rule: { condition: { type: 'ONE_OF_LIST', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => ({ userEnteredValue: String(v) })) }, strict: false, showCustomUi: true } } });
      }
    });
    return out;
  }
  /* הגנות ועיצוב כללי של הלשוניות. marks = שורות הסכומים בלשונית התקציב (נחשבות מהגיליון בתיקון). layout 'flat' = הפריסה הראשונה (בלי עיצוב מיוחד). */
  function staticFormat(items, layout, marks) {
    const itemsPart = layout === 'flat' ? [] : [
      width(ID.ITEMS, 0, 1, 115), width(ID.ITEMS, 1, 2, 220), width(ID.ITEMS, 2, 3, 24), width(ID.ITEMS, 3, 4, 100), width(ID.ITEMS, 4, 5, 140), width(ID.ITEMS, 5, 6, 160), width(ID.ITEMS, 6, 7, 40), width(ID.ITEMS, 7, 8, 260),
      { addDimensionGroup: { range: { sheetId: ID.ITEMS, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 } } },
      { updateDimensionGroup: { dimensionGroup: { range: { sheetId: ID.ITEMS, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, depth: 1, collapsed: true }, fields: 'collapsed' } },
      { updateSheetProperties: { properties: { sheetId: ID.ITEMS, gridProperties: { frozenRowCount: 5 } }, fields: 'gridProperties.frozenRowCount' } },
      protect(ID.ITEMS, 'עמודת המפתחות מחברת סעיף להוצאות. אל תמחקי', { range: { sheetId: ID.ITEMS, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 8, endColumnIndex: 9 } })
    ].concat(Object.keys(marks || {}).filter(k => ['top', 'incT', 'fixT', 'varT', 'botInc', 'botExp', 'botBal'].includes(k)).map(k =>
      protect(ID.ITEMS, 'סכומים (נוסחאות)', { range: { sheetId: ID.ITEMS, startRowIndex: marks[k] - 1, endRowIndex: marks[k], startColumnIndex: 4, endColumnIndex: 6 } })));
    return itemsPart.concat([
      headerFmt(ID.LOG, 0, 1, 0, 13), { updateSheetProperties: { properties: { sheetId: ID.LOG, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      width(ID.LOG, 0, 1, 110), width(ID.LOG, 1, 2, 130), width(ID.LOG, 2, 4, 90), width(ID.LOG, 4, 5, 150), width(ID.LOG, 5, 6, 70), width(ID.LOG, 7, 8, 190), width(ID.LOG, 11, 12, 80),
      { updateDimensionProperties: { range: { sheetId: ID.LOG, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
      protect(ID.LOG, 'כותרות היומן. האפליקציה תלויה בהן', { range: { sheetId: ID.LOG, startRowIndex: 0, endRowIndex: 1 } }),
      headerFmt(ID.SNAP, 0, 1, 0, 6), protect(ID.SNAP, 'עותק התקציב לכל חודש. האפליקציה כותבת אותו, ואל תשני אותו ידנית'),
      headerFmt(ID.SET, 0, 1, 0, 3), width(ID.SET, 0, 1, 120), width(ID.SET, 1, 2, 110), width(ID.SET, 2, 3, 170),
      protect(ID.SET, 'הגדרות האפליקציה. אל תשני ידנית')
    ]);
  }

  /* ---- תוכנית יצירה: גיליון חדש בדרייב של המשתמשת ---- */

  /* ---- לשוניות נוספות כמו בקובץ המקורי: סיכום, יתרת תשלומים באשראי, תקציב לבעלי עסק ---- */
  const BIZ = {"income": ["הכנסה מערוץ רווח אחד", "הכנסות מערוץ רווח שני", "הכנסות מערוץ רווח שלישי", "אחר", "אחר", "אחר", "אחר", "אחר"], "fixed": [["הוצאות משרד", ["שכר דירה", "גז", "חשמל", "מים", "ארנונה", "נקיון", "מיסי קהילה", "אחר", "אחר", "אחר"]], ["תקשורת", ["טלפון", "טלפון נייד", "אינטרנט", "אחר", "אחר"]], ["הפרשות קבועות", ["ביטוח לאומי", "פנסיה", "קרן השתלמות", "אחר", "אחר", "אחר"]], ["תחבורה", ["ביטוח רכב", "כביש 6 + מנהרות+צפון", "רכב טיפולים ורישוי", "חניות"]], ["תוכנות", ["אחר", "אחר", "אחר", "אחר", "אחר"]], ["ספקים בריטיינר", ["רו\"ח", "עו\"ד", "שירותי משרד", "שיווק", "אחר"]], ["עובדים קבועים", ["אחר", "אחר", "אחר", "אחר", "עובד"]], ["הוצאות עסק שונות", ["ביטוח מקצועי", "הוצאות משרד", "השתלמויות", "שונות", "שונות", "שונות", "שונות"]]], "variable": [["הוצאות שיווק ופרסום", ["פייסבוק", "אאטובריין", "טבולה", "גוגל"]], ["רשויות מס", ["מע\"מ", "מס הכנסה", "אחר", "אחר"]], ["תחבורה", ["דלק", "טיפולים לרכב לא צפויים", "חניונים", "תחבורה ציבורית"]], ["הוצאות משרדיות", ["הוצאות גביה משתנות", "אחר", "אחר", "אחר"]], ["עובדים לפי פרויקט", ["אחר", "אחר", "אחר", "אחר", "אחר", "אחר", "מתנות ללקוחות"]], ["שונות", ["שונות", "שונות", "שונות"]]]};
  const BLUE = '1F3864', LBLUE = 'BDD6EE';
  const dateF = (m) => '=DATE(' + m.yr + ',' + m.mo + ',1)';
  const monthLabel = m => MONTHS[m.mo - 1] + ' ' + m.yr;
  function bizBuild(startYm, count) {
    const ms = monthList(startYm, count), W = 6 + count, rows = [], meta = [], mk = {};
    const add = (cells, kind, extra) => { const r = new Array(W).fill(''); Object.keys(cells).forEach(k => { r[k] = cells[k]; }); rows.push(r); meta.push(Object.assign({ row: rows.length, kind: kind }, extra || {})); return rows.length; };
    const mcells = (o, fn) => { ms.forEach((m, i) => { o[6 + i] = fn(m, i); }); return o; };
    const L = i => col(i + 1);
    const sums = [], items = [];
    add({ 4: 'למלא כאן' }, 'fillhint');
    const balRow = add({}, 'blank');
    add(mcells({ 0: 'הכנסות', 4: 'מאזן קיים', 5: 'תקציב חדש' }, monthLabel), 'sechdr');
    const i0 = rows.length + 1;
    BIZ.income.forEach(n => { const r = add(mcells({ 0: n, 4: 0, 5: '' }, () => 0), 'income'); rows[r - 1][5] = '=E' + r; items.push(r); });
    const incT = add({ 0: 'סה"כ הכנסות' }, 'inctotal'); sums.push([incT, i0, incT - 1]);
    add({ 3: 'תאריכים:' }, 'datehdr');
    const sec = (title, groups, kind) => {
      const h = add(mcells({ 0: title, 3: 'ציון ערכים', 4: 'מאזן קיים', 5: 'תקציב חדש' }, monthLabel), 'sechdr'), f0 = rows.length + 1;
      groups.forEach((g, bi) => g[1].forEach((n, j) => {
        const r = add(mcells({ 0: j === 0 ? g[0] : '', 1: n, 4: 0 }, () => 0), 'item', { band: bi, first: j === 0, span: 1 });
        rows[r - 1][5] = '=E' + r; if (j === 0) mk.gi = meta.length - 1; else meta[mk.gi].span++;
      }));
      const t = add({ 0: 'סה"כ ' + title }, 'exptotal'); sums.push([t, f0, t - 1]); add({}, 'blank'); return t;
    };
    const fixT = sec('הוצאות קבועות', BIZ.fixed), varT = sec('הוצאות משתנות', BIZ.variable);
    add({ 0: 'השורה התחתונה' }, 'bothdr');
    const bi_ = add({ 0: 'סה"כ הכנסות' }, 'inctotal'), be_ = add({ 0: 'סה"כ הוצאות' }, 'exptotal'), bb_ = add({ 0: 'סה"כ יתרה' }, 'botbal');
    for (let c = 4; c < W; c++) {
      const cl = L(c);
      sums.forEach(sm => { rows[sm[0] - 1][c] = '=SUM(' + cl + sm[1] + ':' + cl + sm[2] + ')'; });
      rows[bi_ - 1][c] = '=' + cl + incT; rows[be_ - 1][c] = '=' + cl + varT + '+' + cl + fixT; rows[bb_ - 1][c] = '=' + cl + bi_ + '-' + cl + be_; rows[balRow - 1][c] = '=' + cl + bb_;
    }
    return { values: rows, meta: meta, width: W, count: count, ms: ms };
  }
  function bizFormat(b) {
    const S = ID.BIZ, rg = (r1, r2, c1, c2) => ({ sheetId: S, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 });
    const out = layoutFormat(b.meta, S, b.width);
    out.push(width(S, 0, 1, 115), width(S, 1, 2, 200), width(S, 2, 3, 24), width(S, 3, 4, 100), width(S, 4, 5, 120), width(S, 5, 6, 130), width(S, 6, b.width, 95));
    b.meta.forEach(m => { if (m.kind === 'item' || m.kind === 'income') out.push({ repeatCell: { range: rg(m.row - 1, m.row, 6, b.width), cell: { userEnteredFormat: { backgroundColor: rgb('FFFFCC') } }, fields: 'userEnteredFormat(backgroundColor)' } }); });
    out.push({ updateSheetProperties: { properties: { sheetId: S, gridProperties: { frozenRowCount: 3, frozenColumnCount: 6 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
    return out;
  }
  /* סיכום: חודש לחודש, מחושב מהלשוניות "התקציב", "הוצאות קבועות" ו"הוצאות משתנות". רק "הכנסה בפועל" מוזנת */
  function summaryBuild(startYm, count, vv, fv, marks) {
    const ms = monthList(startYm, count), W = 1 + count, rows = []; for (let r = 0; r < 12; r++) rows.push(new Array(W).fill(''));
    const FX = q(T.FIXED), VR = q(T.VAR), IT = q(T.ITEMS), ft = fv.first + fv.rowCount, vt = vv.first + vv.rowCount;
    rows[0][1] = 'חודש התחלה:'; rows[0][3] = dateF(ms[0]);
    ['', '', ''].length;
    ['הכנסה מתוכננת (אוטומטי)', 'הכנסה בפועל (להזין)', 'תקציב קבועות (אוטומטי)', 'קבועות בפועל (אוטומטי)', 'תקציב משתנות (אוטומטי)', 'משתנות בפועל (אוטומטי)', 'יתרת תקציב מתוכננת (אוטומטי)', 'יתרת תקציב בפועל (אוטומטי)', 'גרעון/עודף'].forEach((t, i) => { rows[3 + i][0] = t; });
    ms.forEach((m, i) => {
      const c = i + 1, cl = col(c + 1), fc = col(fv.pre + i * fv.per + 1), vc = col(vv.pre + i * vv.per + 6);
      rows[2][c] = dateF(m);
      rows[3][c] = '=' + IT + '!$F$' + (marks && marks.incT || 12); rows[4][c] = 0;
      rows[5][c] = '=' + FX + '!$D$' + ft; rows[6][c] = '=' + FX + '!' + fc + ft;
      rows[7][c] = '=' + VR + '!$C$' + vt; rows[8][c] = '=' + VR + '!' + vc + (vt + 1);
      rows[9][c] = '=' + cl + '4-' + cl + '6-' + cl + '8'; rows[10][c] = '=' + cl + '5-' + cl + '7-' + cl + '9'; rows[11][c] = '=' + cl + '11-' + cl + '10';
    });
    return { values: rows, width: W, count: count };
  }
  function summaryFormat(b) {
    const S = ID.SUM, rg = (r1, r2, c1, c2) => ({ sheetId: S, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 });
    const thin = { style: 'SOLID', color: rgb('B7B7B7') }, MED = { style: 'SOLID_MEDIUM', color: rgb('000000') }, NF = { type: 'NUMBER', pattern: '#,##0_ ;[Red]\\-#,##0\\ ' };
    const f = (r1, r2, c1, c2, fmt, fields) => ({ repeatCell: { range: rg(r1, r2, c1, c2), cell: { userEnteredFormat: fmt }, fields: 'userEnteredFormat(' + fields + ')' } });
    return [
      f(0, 20, 0, b.width + 1, { textFormat: { fontFamily: 'Arial', fontSize: 12 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'textFormat,horizontalAlignment,verticalAlignment'),
      width(S, 0, 1, 240), width(S, 1, b.width, 85),
      f(0, 1, 1, 2, { textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true }, horizontalAlignment: 'RIGHT' }, 'textFormat,horizontalAlignment'), { mergeCells: { range: rg(0, 1, 1, 3), mergeType: 'MERGE_ALL' } },
      f(0, 1, 3, 4, { backgroundColor: rgb('0070C0'), textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true, foregroundColor: rgb('FFFFFF') }, numberFormat: { type: 'DATE', pattern: 'mmm-yy' } }, 'backgroundColor,textFormat,numberFormat'),
      f(2, 3, 0, b.width, { backgroundColor: rgb('0070C0'), textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true, foregroundColor: rgb('FFFFFF') }, numberFormat: { type: 'DATE', pattern: 'mmm-yy' } }, 'backgroundColor,textFormat,numberFormat'),
      f(3, 12, 1, b.width, { numberFormat: NF }, 'numberFormat'), f(3, 12, 0, 1, { textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true } }, 'textFormat'),
      f(4, 5, 1, b.width, { backgroundColor: rgb('FFFFCC') }, 'backgroundColor'),
      f(11, 12, 0, b.width, { backgroundColor: rgb('00B0F0'), textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true } }, 'backgroundColor,textFormat'),
      { updateBorders: { range: rg(2, 12, 0, b.width), top: MED, bottom: MED, left: MED, right: MED, innerHorizontal: thin, innerVertical: thin } },
      { updateSheetProperties: { properties: { sheetId: S, gridProperties: { frozenRowCount: 3, frozenColumnCount: 1 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } }];
  }
  function creditBuild(startYm, count) {
    const ms = monthList(startYm, count), W = 2 + count, rows = []; for (let r = 0; r < 24; r++) rows.push(new Array(W).fill(''));
    rows[0][0] = 'יתרת תשלומים באשראי'; rows[1][0] = 'שם העסק'; rows[23][0] = 'סה"כ';
    ms.forEach((m, i) => { const c = 2 + i, cl = col(c + 1); rows[1][c] = dateF(m); rows[23][c] = '=SUM(' + cl + '3:' + cl + '23)'; });
    return { values: rows, width: W };
  }
  function creditFormat(b) {
    const S = ID.CREDIT, rg = (r1, r2, c1, c2) => ({ sheetId: S, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 });
    const thin = { style: 'SOLID', color: rgb('B7B7B7') }, NF = { type: 'NUMBER', pattern: '#,##0_ ;[Red]\\-#,##0\\ ' };
    const f = (r1, r2, c1, c2, fmt, fields) => ({ repeatCell: { range: rg(r1, r2, c1, c2), cell: { userEnteredFormat: fmt }, fields: 'userEnteredFormat(' + fields + ')' } });
    return [
      f(0, 30, 0, b.width + 1, { textFormat: { fontFamily: 'Arial', fontSize: 12 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'textFormat,horizontalAlignment,verticalAlignment'),
      width(S, 0, 1, 230), width(S, 1, 2, 30), width(S, 2, b.width, 85),
      f(0, 1, 0, 1, { textFormat: { fontFamily: 'Arial', fontSize: 16, bold: true }, horizontalAlignment: 'RIGHT' }, 'textFormat,horizontalAlignment'),
      f(1, 2, 0, b.width, { backgroundColor: rgb('BDD6EE'), textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true }, numberFormat: { type: 'DATE', pattern: 'mmm-yy' } }, 'backgroundColor,textFormat,numberFormat'),
      f(2, 24, 2, b.width, { numberFormat: NF }, 'numberFormat'), f(2, 23, 0, 1, { horizontalAlignment: 'RIGHT' }, 'horizontalAlignment'),
      f(23, 24, 0, b.width, { backgroundColor: rgb('00B0F0'), textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true } }, 'backgroundColor,textFormat'),
      { updateBorders: { range: rg(1, 24, 0, b.width), top: thin, bottom: thin, left: thin, right: thin, innerHorizontal: thin, innerVertical: thin } },
      { updateSheetProperties: { properties: { sheetId: S, gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } }];
  }

  function plan(opts) {
    const items = orderItems(opts.items && opts.items.length ? opts.items : sampleItems());
    const startYm = opts.startYm, months = Math.max(1, Math.min(12, opts.months || 12));
    const lay = buildItemsLayout(items, opts.income);
    const vv = viewValues(lay.items, true, startYm, months, 'sheet'), fv = viewValues(lay.items, false, startYm, months, 'sheet');
    const sm = summaryBuild(startYm, months, vv, fv, lay.marks);
    const sheets = [[ID.ITEMS, T.ITEMS, '2E7D32'], [ID.FIXED, T.FIXED, '9A958A'], [ID.VAR, T.VAR, '9A958A'], [ID.SUM, T.SUM, '2E7D32', sm.width + 2], [ID.LOG, T.LOG, '1565C0'], [ID.SNAP, T.SNAP, '9A958A'], [ID.SET, T.SET, '9A958A']];
    const formulas = [   // נכנסים כנוסחאות (USER_ENTERED)
      { range: q(T.VAR) + '!A1', values: vv.grid }, { range: q(T.FIXED) + '!A1', values: fv.grid }, { range: q(T.SUM) + '!A1', values: sm.values }].concat(totalsFormulas(lay.marks), defaultBudgetFormulas(lay.fdef));
    const raw = [   // נכנסים כמו שהם (RAW): שמות סעיפים לא צריכים להתפרש כתאריך או נוסחה
      { range: q(T.ITEMS) + '!A1', values: lay.values }, { range: q(T.LOG) + '!A1', values: [LOG_HEADER] }, { range: q(T.SNAP) + '!A1', values: [SNAP_HEADER] },
      { range: q(T.SET) + '!A1', values: settingsValues(startYm, months, opts.startDay, opts.opening) }, { range: q(T.SET) + '!A7', values: [[NOTE_SET]] }];
    if (opts.log && opts.log.length) raw.push({ range: q(T.LOG) + '!A2', values: opts.log });   // הוצאות שהועברו מקובץ קודם
    if (opts.prefsJson) raw.push({ range: q(T.SET) + '!E1', values: [['העדפות האפליקציה (לא לערוך)'], [opts.prefsJson]] });
    else raw.push({ range: q(T.SET) + '!E1', values: [['העדפות האפליקציה (לא לערוך)']] });
    return { items: lay.items, meta: lay.meta, marks: lay.marks, layout: 'sheet', startYm: startYm, months: months, sheets: sheets, formulas: formulas, raw: raw, views: { VAR: vv, FIXED: fv }, extras: { sum: sm } };
  }
  function formatRequests(p) {
    return staticFormat(p.items, p.layout, p.marks).concat(p.meta ? layoutFormat(p.meta) : [], viewFormat(ID.VAR, p.views.VAR), viewFormat(ID.FIXED, p.views.FIXED), p.extras ? summaryFormat(p.extras.sum) : []);
  }
  const createBody = (title, p) => ({
    properties: { title: title, timeZone: 'Asia/Jerusalem' },
    sheets: p.sheets.map((s, i) => ({ properties: { sheetId: s[0], title: s[1], index: i, rightToLeft: true, tabColorStyle: { rgbColor: rgb(s[2]) }, gridProperties: { rowCount: s[0] === ID.LOG ? 2000 : 600, columnCount: Math.max(s[3] || 14, s[0] === ID.VAR ? p.views.VAR.width + 1 : s[0] === ID.FIXED ? p.views.FIXED.width + 1 : 14) } } }))
  });

  /* תיקון קובץ קיים: נוסחאות הצפייה והגנות בלבד (לא נוגעים בנתונים). items: כל הסעיפים עם row = שורה בלשונית התקציב */
  function repairPlan(items, startYm, months, layout, marks) {
    const vv = viewValues(items, true, startYm, months, layout), fv = viewValues(items, false, startYm, months, layout);
    return { items: items, layout: layout, marks: marks || {}, views: { VAR: vv, FIXED: fv }, formulas: [{ range: q(T.VAR) + '!A1', values: vv.grid }, { range: q(T.FIXED) + '!A1', values: fv.grid }].concat(layout === 'flat' ? [] : totalsFormulas(marks || {})),
      raw: [{ range: q(T.LOG) + '!A1:M1', values: [LOG_HEADER] }, { range: q(T.SNAP) + '!A1:F1', values: [SNAP_HEADER] }, { range: q(T.SET) + '!A1:C1', values: [SET_HEADER] }], sheets: [[ID.ITEMS, T.ITEMS, '2E7D32'], [ID.VAR, T.VAR, '9A958A'], [ID.FIXED, T.FIXED, '9A958A'], [ID.LOG, T.LOG, '1565C0'], [ID.SNAP, T.SNAP, '9A958A'], [ID.SET, T.SET, '9A958A']] };
  }
  const Workbook = { repairPlan: repairPlan, T: T, ID: ID, MONTHS: MONTHS, LOG_HEADER: LOG_HEADER, sampleItems: sampleItems, CATALOG: CATALOG, buildItemsLayout: buildItemsLayout, parseItems: parseItems, totalsFormulas: totalsFormulas, orderItems: orderItems, monthList: monthList, plan: plan, formatRequests: formatRequests, createBody: createBody,
    viewValues: viewValues, viewFormat: viewFormat, staticFormat: staticFormat, protect: protect };
  if (typeof module !== 'undefined' && module.exports) module.exports = Workbook; else root.Workbook = Workbook;
})(typeof window !== 'undefined' ? window : globalThis);
