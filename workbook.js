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

  const T = { ITEMS: 'התקציב', VAR: 'הוצאות משתנות', FIXED: 'הוצאות קבועות', LOG: 'יומן הוצאות', SNAP: 'תקציב לפי חודש', SET: 'הגדרות אפליקציה' };
  const ID = { ITEMS: 1, VAR: 2, FIXED: 3, LOG: 4, SNAP: 5, SET: 6 };
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
    income: ['הכנסה מעבודה', 'דמי אבטלה', 'הכנסה מדיבידנד', 'שונות', 'שכירות', 'קצבת ילדים'],
    fixed: [
      ['הוצאות בית', ['שכר דירה', 'גז', 'חשמל', 'מים', 'ארנונה', 'אזעקה', 'עוזרת בית', 'גנן', 'ביטוח בית', 'תיקונים בית', 'פיצויים עוזרת בית', 'אחר']],
      ['תקשורת', ['טלפון', 'apple music', 'אינטרנט', 'כבלים/ טלויזיה בלווין', 'דיסני+', 'אחסון בענן וגיבויים']],
      ['חינוך', ['מעון', 'חוגים/ שיעורי עזר', 'גן', 'פסיכולוג/ הוראה מתקנת', 'ביה"ס', 'קורסים (מבוגרים)', 'תשלומי הורים', 'אחר']],
      ['תחבורה', ['ביטוח רכב - מקיף + חובה', 'כביש 6 + חניות', 'רכב טיפולים ורישוי', 'מצלמת רכב', 'איתורן']],
      ['בריאות', ['קופת חולים', 'ביטוח רפואי', 'ביטוח חיים', 'שונות', 'שונות', 'שונות', 'אחר']],
      ['בנקים ואשראי', ['הלוואות', 'ריבית על המינוס', 'עמלות בנק + כ״א', 'חסכונות ילדים'].concat(X('אחר', 3))],
      ['שונות', ['חופשות', 'שונות', 'תרומה'].concat(X('שונות', 8), ['מעשר', 'קרן חרום', 'בלת"ם (הוצאות לא מתוכננות)'])]],
    variable: [
      ['קניות', ['סופר', 'אוכל מהיר', 'סופר פארם', 'ביגוד'].concat(X('אחר', 4))],
      ['טיפוח ורפואה', ['קוסמטיקה טיפולים ומוצרים', 'מספרה', 'הוצאות רפואיות', 'טיפולי שיניים', 'אחר', 'אחר']],
      ['תחבורה', ['דלק', 'אחזקת רכב', 'חניונים - פנגו', 'אחר', 'אחר']],
      ['בית', ['מוצרים ורהיטים לבית', 'ספרים דיסקים', 'חיות מחמד', 'אחזקת הבית']],
      ['בילויים', ['בילויים', 'מסעדות', 'מתנות לילדים + חגים', 'מתנות לאירועים', 'צעצועים', 'אחר', 'ויזה תשלומים']],
      ['שונות', ['כיסוי מינוס', 'מזומן שונות', 'שונות', 'שונות', 'על עצמי', 'שונות', 'שונות', 'שונות']]]
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
        items.push({ type: sec === 'fixed' ? 'קבועה' : 'שוטפת', group: group, name: b, budget: numv(r[5]), key: String(r[2] || ''), row: row, grow: grow || row });
      }
    });
    return { layout: 'sheet', items: items, marks: marks };
  }
  function buildItemsLayout(items, income) {
    const rows = [], meta = [], marks = {}, placed = [];
    const add = (cells, kind, extra) => { const r = ['', '', '', '', '', '', '', '']; Object.keys(cells).forEach(k => { r[k] = cells[k]; }); rows.push(r); meta.push(Object.assign({ row: rows.length + 0, kind: kind }, extra || {})); return rows.length; };
    // השורה הראשונה בגיליון היא הכותרת; rows[i] הוא שורה i+1
    add({ 0: 'תקציב משק בית' }, 'title');
    marks.top = add({ 0: 'סה"כ יתרת הכנסות בניכוי הוצאות:', 7: 'הערות' }, 'top');
    add({ 7: 'כותבים בעמודה "תקציב חדש" את התקציב החודשי של כל סעיף. אפשר להוסיף שורות ולמחוק שורות.' }, 'plain');
    add({ 4: 'למלא כאן', 5: 'למלא כאן', 7: 'שינוי תקציב חל רק קדימה: חודשים שעברו נשארים כמו שהיו. עמודת "מאזן קיים" היא לשימושך בלבד.' }, 'fillhint');
    marks.incH = add({ 0: 'הכנסות', 4: 'מאזן קיים', 5: 'תקציב חדש' }, 'sechdr');
    const inc = income && income.length ? income : CATALOG.income;
    inc.forEach(n => add({ 0: n }, 'income'));
    marks.incT = add({ 0: 'סה"כ הכנסות' }, 'total');
    add({ 3: 'תאריכים:' }, 'plain');
    const sections = [['fixH', 'fixT', 'הוצאות קבועות', 'קבועה'], ['varH', 'varT', 'הוצאות משתנות', 'שוטפת']];
    sections.forEach((sc, si) => {
      marks[sc[0]] = add({ 0: sc[2], 3: 'ציון ערכים', 4: 'מאזן קיים', 5: 'תקציב חדש' }, 'sechdr');
      const list = items.filter(i => (i.type === 'קבועה') === (sc[3] === 'קבועה'));
      let prev = null, band = -1, gr = 0;
      list.forEach(it => {
        const first = it.group !== prev; if (first) { band++; prev = it.group; }
        const r = add({ 0: first ? it.group : '', 1: it.name, 2: it.key || '', 5: it.budget || '' }, 'item', { band: band, first: first });
        if (first) gr = r;
        placed.push(Object.assign({}, it, { row: r, grow: gr }));
      });
      marks[sc[1]] = add({ 0: 'סה"כ ' + sc[2] }, 'total');
      add({}, 'plain');
    });
    marks.bot = add({ 0: 'השורה התחתונה' }, 'sechdr');
    marks.botInc = add({ 0: 'סה"כ הכנסות' }, 'total');
    marks.botExp = add({ 0: 'סה"כ הוצאות' }, 'total');
    marks.botBal = add({ 0: 'סה"כ יתרה' }, 'total');
    return { values: rows, meta: meta, items: placed, marks: marks };
  }
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
    const RF = layout === 'flat' ? { g: 'B', n: 'C', b: 'D', k: 'E', grow: false } : { g: 'A', n: 'B', b: 'F', k: 'C', grow: true };
    const rows = [];   // br = השורה של הסעיף בלשונית "התקציב" (it.row אם ידועה, אחרת לפי הסדר)
    items.forEach((it, i) => { if ((it.type !== 'קבועה') === isVar) rows.push({ it: it, br: it.row || i + 2 }); });
    const pre = isVar ? 4 : 3, per = isVar ? 6 : 2, months = monthList(startYm, count), width = pre + per * count, first = 5;
    const grid = []; for (let r = 0; r < first + rows.length; r++) grid.push(new Array(width).fill(''));
    grid[0][0] = 'הוצאות ' + (isVar ? 'משתנות' : 'קבועות') + ' לפי חודש. לצפייה בלבד: הכול מחושב מהלשוניות "התקציב" ו"יומן הוצאות". האפליקציה לא תלויה בלשונית הזאת.';
    grid[1][0] = 'מזהה חודש (לא לגעת)';
    grid[3][0] = 'קבוצה'; grid[3][1] = 'סעיף'; grid[3][2] = 'תקציב'; if (isVar) grid[3][3] = 'תקציב שבועי';
    const IT = q(T.ITEMS), SN = q(T.SNAP), LG = q(T.LOG);
    rows.forEach((r, i) => {
      const row = grid[first - 1 + i], R = first + i;
      row[0] = '=' + IT + '!$' + RF.g + '$' + (RF.grow ? (r.it.grow || r.br) : r.br); row[1] = '=' + IT + '!$' + RF.n + '$' + r.br; row[2] = '=N(' + IT + '!$' + RF.b + '$' + r.br + ')';
      if (isVar) row[3] = '=C' + R + '/4.3';
    });
    months.forEach((m, mi) => {
      const c0 = pre + mi * per, ymc = col(c0 + 1) + '$2';
      grid[1][c0] = m.ym; grid[2][c0] = MONTHS[m.mo - 1] + ' ' + m.yr;
      (isVar ? ['שבוע 1', 'שבוע 2', 'שבוע 3', 'שבוע 4', 'שבוע 5', 'יתרה'] : ['בפועל', 'יתרה']).forEach((l, j) => { grid[3][c0 + j] = l; });
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
    tr[0] = 'סה"כ';
    const tot = c => rows.length ? '=SUM(' + col(c + 1) + first + ':' + col(c + 1) + last + ')' : 0;
    tr[2] = tot(2); if (isVar) tr[3] = tot(3);
    months.forEach((m, mi) => { const c0 = pre + mi * per; for (let j = 0; j < per; j++) tr[c0 + j] = tot(c0 + j); });
    grid.push(tr);
    return { grid: grid, per: per, pre: pre, count: count, rowCount: rows.length, width: width, first: first };
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

  function viewFormat(sheetId, v) {
    const rng = (r1, r2, c1, c2) => ({ sheetId: sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 });
    const reqs = [headerFmt(sheetId, 3, 4, 0, v.width), width(sheetId, 0, 1, 130), width(sheetId, 1, 2, 190), width(sheetId, 2, v.pre, 90), width(sheetId, v.pre, v.width, 74),
      { repeatCell: { range: rng(4, 4 + v.rowCount + 1, 2, v.width), cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: NUMFMT } } }, fields: 'userEnteredFormat.numberFormat' } },
      { repeatCell: { range: rng(2, 3, 0, v.width), cell: { userEnteredFormat: { backgroundColor: rgb('EFE9DC'), horizontalAlignment: 'CENTER', textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)' } },
      { repeatCell: { range: rng(1, 2, 0, v.width), cell: { userEnteredFormat: { textFormat: { fontSize: 8, foregroundColor: rgb('9A958A') } } }, fields: 'userEnteredFormat.textFormat' } },
      { repeatCell: { range: rng(4 + v.rowCount, 5 + v.rowCount, 0, v.width), cell: { userEnteredFormat: { backgroundColor: rgb('F4F0E7'), textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
      { updateSheetProperties: { properties: { sheetId: sheetId, gridProperties: { frozenRowCount: 4, frozenColumnCount: 2 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
      protect(sheetId, 'לשונית לצפייה בלבד: נוסחאות. אם מחקת בטעות, בהגדרות האפליקציה יש "תיקון הגיליון"')];
    for (let mi = 0; mi < v.count; mi++) reqs.push({ mergeCells: { range: rng(2, 3, v.pre + mi * v.per, v.pre + (mi + 1) * v.per), mergeType: 'MERGE_ALL' } });
    return reqs;
  }
  /* עיצוב של לשונית התקציב (יצירה בלבד): כותרות מדורים, פסי קבוצות, תאי מילוי */
  function layoutFormat(meta) {
    const S = ID.ITEMS, out = [], N = '"₪ "#,##0;[Red]-"₪ "#,##0';
    const rg = (r, c1, c2) => ({ sheetId: S, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c1, endColumnIndex: c2 });
    const fill = (r, c1, c2, hex, extra) => ({ repeatCell: { range: rg(r, c1, c2), cell: { userEnteredFormat: Object.assign({ backgroundColor: rgb(hex) }, extra || {}) }, fields: 'userEnteredFormat(' + ['backgroundColor'].concat(Object.keys(extra || {})).join(',') + ')' } });
    const white = { bold: true, foregroundColor: rgb('FFFFFF') };
    meta.forEach(m => {
      const r = m.row - 1;
      if (m.kind === 'title') out.push({ repeatCell: { range: rg(r, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 16 } } }, fields: 'userEnteredFormat.textFormat' } });
      else if (m.kind === 'top') { out.push(fill(r, 0, 6, 'EFE9DC', { textFormat: { bold: true, fontSize: 12 } })); out.push(fill(r, 7, 8, '14161B', { textFormat: white, horizontalAlignment: 'CENTER' })); }
      else if (m.kind === 'sechdr') out.push(fill(r, 0, 6, '14161B', { textFormat: white }));
      else if (m.kind === 'fillhint') out.push(fill(r, 4, 6, 'FFF6D6', { textFormat: { italic: true, fontSize: 9 }, horizontalAlignment: 'CENTER' }));
      else if (m.kind === 'total') out.push(fill(r, 0, 6, 'EFE9DC', { textFormat: { bold: true } }));
      else if (m.kind === 'income' || m.kind === 'item') {
        out.push(fill(r, 0, 6, m.kind === 'income' ? 'FFFFFF' : (m.band % 2 ? 'F7F4EC' : 'FFFFFF')));
        out.push(fill(r, 5, 6, 'FFF6D6'));
        if (m.kind === 'item') out.push({ repeatCell: { range: rg(r, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } });
        if (m.first) out.push({ updateBorders: { range: rg(r, 0, 6), top: { style: 'SOLID', color: rgb('CFC9BB') } } });
      }
    });
    out.push({ repeatCell: { range: { sheetId: S, startRowIndex: 1, endRowIndex: 200, startColumnIndex: 4, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: N } } }, fields: 'userEnteredFormat.numberFormat' } });
    out.push({ repeatCell: { range: { sheetId: S, startRowIndex: 1, endRowIndex: 200, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } });
    return out;
  }
  /* הגנות ועיצוב כללי של הלשוניות. marks = שורות הסכומים בלשונית התקציב (נחשבות מהגיליון בתיקון). layout 'flat' = הפריסה הראשונה (בלי עיצוב מיוחד). */
  function staticFormat(items, layout, marks) {
    const itemsPart = layout === 'flat' ? [] : [
      width(ID.ITEMS, 0, 1, 150), width(ID.ITEMS, 1, 2, 240), width(ID.ITEMS, 2, 3, 70), width(ID.ITEMS, 3, 4, 90), width(ID.ITEMS, 4, 6, 115), width(ID.ITEMS, 6, 7, 24), width(ID.ITEMS, 7, 8, 420),
      { updateDimensionProperties: { range: { sheetId: ID.ITEMS, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
      { updateSheetProperties: { properties: { sheetId: ID.ITEMS, gridProperties: { frozenRowCount: 4 } }, fields: 'gridProperties.frozenRowCount' } },
      protect(ID.ITEMS, 'עמודת המפתחות מחברת סעיף להוצאות. אל תמחקי', { range: { sheetId: ID.ITEMS, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 2, endColumnIndex: 3 } })
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
  function plan(opts) {
    const items = orderItems(opts.items && opts.items.length ? opts.items : sampleItems());
    const startYm = opts.startYm, months = Math.max(1, Math.min(12, opts.months || 12));
    const lay = buildItemsLayout(items, opts.income);
    const vv = viewValues(lay.items, true, startYm, months, 'sheet'), fv = viewValues(lay.items, false, startYm, months, 'sheet');
    const sheets = [[ID.ITEMS, T.ITEMS, '2E7D32'], [ID.VAR, T.VAR, '9A958A'], [ID.FIXED, T.FIXED, '9A958A'], [ID.LOG, T.LOG, '1565C0'], [ID.SNAP, T.SNAP, '9A958A'], [ID.SET, T.SET, '9A958A']];
    const formulas = [   // נכנסים כנוסחאות (USER_ENTERED)
      { range: q(T.VAR) + '!A1', values: vv.grid }, { range: q(T.FIXED) + '!A1', values: fv.grid }].concat(totalsFormulas(lay.marks));
    const raw = [   // נכנסים כמו שהם (RAW): שמות סעיפים לא צריכים להתפרש כתאריך או נוסחה
      { range: q(T.ITEMS) + '!A1', values: lay.values }, { range: q(T.LOG) + '!A1', values: [LOG_HEADER] }, { range: q(T.SNAP) + '!A1', values: [SNAP_HEADER] },
      { range: q(T.SET) + '!A1', values: settingsValues(startYm, months, opts.startDay, opts.opening) }, { range: q(T.SET) + '!A7', values: [[NOTE_SET]] }];
    if (opts.prefsJson) raw.push({ range: q(T.SET) + '!E1', values: [['העדפות האפליקציה (לא לערוך)'], [opts.prefsJson]] });
    else raw.push({ range: q(T.SET) + '!E1', values: [['העדפות האפליקציה (לא לערוך)']] });
    return { items: lay.items, meta: lay.meta, marks: lay.marks, layout: 'sheet', startYm: startYm, months: months, sheets: sheets, formulas: formulas, raw: raw, views: { VAR: vv, FIXED: fv } };
  }
  function formatRequests(p) {
    return staticFormat(p.items, p.layout, p.marks).concat(p.meta ? layoutFormat(p.meta) : [], viewFormat(ID.VAR, p.views.VAR), viewFormat(ID.FIXED, p.views.FIXED));
  }
  const createBody = (title, p) => ({
    properties: { title: title, timeZone: 'Asia/Jerusalem' },
    sheets: p.sheets.map((s, i) => ({ properties: { sheetId: s[0], title: s[1], index: i, rightToLeft: true, tabColorStyle: { rgbColor: rgb(s[2]) }, gridProperties: { rowCount: s[0] === ID.LOG ? 2000 : 600, columnCount: Math.max(14, s[0] === ID.VAR ? p.views.VAR.width + 1 : s[0] === ID.FIXED ? p.views.FIXED.width + 1 : 14) } } }))
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
