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

  /* קטלוג סעיפים מוכן: המשתמשת רואה מה אפשר למלא, מוחקת מה שלא רלוונטי ומשנה שמות */
  const CATALOG = {
    income: ['הכנסה מעבודה', 'הכנסה נוספת / עסק', 'דמי אבטלה', 'קצבת ילדים', 'שכירות', 'דיבידנדים וריבית', 'אחר'],
    fixed: [
      ['הוצאות בית', ['שכר דירה / משכנתא', 'ארנונה', 'חשמל', 'מים', 'גז', 'ועד בית', 'עוזרת בית', 'גינון', 'ביטוח דירה', 'אבטחה / אזעקה', 'תיקונים ותחזוקה', 'אחר']],
      ['תקשורת', ['טלפון נייד', 'אינטרנט', 'טלוויזיה וסטרימינג', 'אחסון בענן ומנויים', 'אחר']],
      ['חינוך', ['מעון / גן', 'בית ספר', 'חוגים ושיעורי עזר', 'טיפולים (פסיכולוג / הוראה מתקנת)', 'קורסים', 'תשלומי הורים', 'אחר']],
      ['תחבורה', ['ביטוח רכב', 'רישוי וטיפולים', 'כביש 6 וחניות', 'תחבורה ציבורית', 'איתורן / מצלמת רכב', 'אחר']],
      ['בריאות', ['קופת חולים', 'ביטוח בריאות', 'ביטוח חיים', 'אחר']],
      ['בנקים ואשראי', ['הלוואות', 'ריבית על המינוס', 'עמלות בנק וכרטיס אשראי', 'חיסכון', 'אחר']],
      ['שונות', ['חופשות', 'תרומה / מעשר', 'קרן חירום', 'הוצאות לא מתוכננות', 'אחר']]],
    variable: [
      ['קניות', ['סופר', 'אוכל מהיר', 'סופר פארם', 'ביגוד והנעלה', 'אחר']],
      ['טיפוח ורפואה', ['קוסמטיקה וטיפולים', 'מספרה', 'הוצאות רפואיות', 'טיפולי שיניים', 'אחר']],
      ['תחבורה', ['דלק', 'אחזקת רכב', 'חניונים', 'אחר']],
      ['בית', ['מוצרים ורהיטים לבית', 'ספרים ודיסקים', 'חיות מחמד', 'אחזקת הבית']],
      ['בילויים', ['בילויים', 'מסעדות', 'מתנות לילדים וחגים', 'מתנות לאירועים', 'צעצועים', 'אחר']],
      ['שונות', ['כיסוי מינוס', 'מזומן', 'חשבון ילדים', 'על עצמי', 'אחר']]]
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

  /* ---- לשונית התקציב: כמו הקובץ המקורי. הכנסות, הוצאות קבועות, הוצאות שוטפות, הערות, וסיכום בצד ----
   * האפליקציה קוראת רק שורות שבהן יש סוג (קבועה/שוטפת) וגם שם סעיף. שורות כותרת וסוג "הכנסה" מתעלמת מהן. */
  const ITEMS_HDR = ['סוג', 'קבוצה', 'סעיף', 'תקציב חודשי', 'מפתח', 'הערות'];
  function buildItemsLayout(items, income) {
    const values = [ITEMS_HDR.slice()], meta = [], placed = [];
    const banner = t => { values.push([t, '', '', '', '', '']); meta.push({ row: values.length, kind: 'banner' }); };
    const rowOf = (kind, vals, group, first) => { values.push(vals); meta.push({ row: values.length, kind: kind, group: group, first: first }); return values.length; };
    const grp = list => { let prev = null, band = -1; list.forEach(it => { if (it.group !== prev) { band++; prev = it.group; it._first = true; } else it._first = false; it._band = band; }); };
    banner('הכנסות');
    let g0 = null, b0 = -1;
    (income && income.length ? income : CATALOG.income.map(n => ({ name: n, budget: 0, group: 'הכנסות' }))).forEach(it => {
      const r = rowOf('income', ['הכנסה', it.group || 'הכנסות', it.name, it.budget || '', '', it.note || ''], 'הכנסות', false); meta[meta.length - 1].band = 0;
    });
    const fixed = items.filter(i => i.type === 'קבועה').map(i => Object.assign({}, i)), variable = items.filter(i => i.type !== 'קבועה').map(i => Object.assign({}, i));
    [['הוצאות קבועות', fixed], ['הוצאות שוטפות', variable]].forEach(pair => {
      banner(pair[0]); grp(pair[1]);
      pair[1].forEach(it => { it.row = rowOf('item', [it.type === 'קבועה' ? 'קבועה' : 'שוטפת', it.group, it.name, it.budget || '', it.key || '', it.note || ''], it.group, it._first); meta[meta.length - 1].band = it._band; placed.push(it); });
    });
    return { values: values, meta: meta, items: placed };
  }
  const NOTES = ['איך משתמשים בלשונית הזאת',
    '• כותבים בעמודה "תקציב חודשי" סכום ליד כל סעיף שרלוונטי לך. סעיף בלי סכום לא מופיע באפליקציה.',
    '• אפשר לשנות שמות, למחוק סעיפים שלא צריך ולהוסיף שורות. בעמודת "הערות" כותבים מה שרוצים.',
    '• הכנסות הן לתכנון בלבד: האפליקציה רושמת הוצאות, והיתרה מחושבת כאן.',
    '• שינוי תקציב חל רק קדימה: חודשים שעברו נשארים כמו שהיו.',
    '• אל תמחקי את עמודת "מפתח": היא מחברת את הסעיף להוצאות.',
    '• לא מוחקים שורה של סעיף שכבר היו לו הוצאות. מאפסים את התקציב שלו.',
    '• סעיף חדש מופיע באפליקציה מיד, ובלשוניות "הוצאות משתנות" ו"הוצאות קבועות" אחרי "תיקון הגיליון" בהגדרות האפליקציה.'];
  function itemsSideValues() {
    const sum = t => '=SUMIF($A$2:$A$500,"' + t + '",$D$2:$D$500)';
    const v = [['סיכום תקציב חודשי', ''], ['סך הכנסות', sum('הכנסה')], ['סך הוצאות קבועות', sum('קבועה')], ['סך הוצאות שוטפות', sum('שוטפת')], ['סך כל ההוצאות', '=I3+I4'],
      ['יתרה חודשית (הכנסות פחות הוצאות)', '=I2-I5'], ['', '']];
    NOTES.forEach(n => v.push([n, '']));
    return { range: q(T.ITEMS) + '!H1:I' + v.length, values: v };
  }

  /* ---- לשוניות הצפייה (נוסחאות בלבד) ---- */
  /* אותו מבנה כמו "בקרה קבועות" / "בקרה משתנות" בקובץ המקורי: קבוצה, סעיף, תקציב (ובמשתנות גם תקציב שבועי),
   * ואז לכל חודש: בפועל ויתרה מצטברת (בקבועות), או חמישה שבועות ויתרה מצטברת (במשתנות).
   * היתרה כאן פשוטה: יתרה קודמת + תקציב החודש פחות מה שהוצא. כללי סוף החודש (גלגול/הפקדה/שאלה) נקבעים באפליקציה. */
  function viewValues(items, isVar, startYm, count) {
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
      row[0] = '=' + IT + '!$B$' + r.br; row[1] = '=' + IT + '!$C$' + r.br; row[2] = '=N(' + IT + '!$D$' + r.br + ')';
      if (isVar) row[3] = '=C' + R + '/4.3';
    });
    months.forEach((m, mi) => {
      const c0 = pre + mi * per, ymc = col(c0 + 1) + '$2';
      grid[1][c0] = m.ym; grid[2][c0] = MONTHS[m.mo - 1] + ' ' + m.yr;
      (isVar ? ['שבוע 1', 'שבוע 2', 'שבוע 3', 'שבוע 4', 'שבוע 5', 'יתרה'] : ['בפועל', 'יתרה']).forEach((l, j) => { grid[3][c0 + j] = l; });
      rows.forEach((r, i) => {
        const row = grid[first - 1 + i], R = first + i, key = IT + '!$E$' + r.br;
        const bud = 'IF(COUNTIFS(' + SN + '!$A:$A,' + ymc + ',' + SN + '!$B:$B,' + key + ')>0,SUMIFS(' + SN + '!$E:$E,' + SN + '!$A:$A,' + ymc + ',' + SN + '!$B:$B,' + key + '),N(' + IT + '!$D$' + r.br + '))';
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
  /* עיצוב של לשונית התקציב לפי הפריסה (יצירה בלבד): כותרות מדורים, פסי קבוצות, תאי מילוי */
  function layoutFormat(meta) {
    const S = ID.ITEMS, out = [];
    const fill = (r1, r2, c1, c2, hex, extra) => ({ repeatCell: { range: { sheetId: S, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }, cell: { userEnteredFormat: Object.assign({ backgroundColor: rgb(hex) }, extra || {}) }, fields: 'userEnteredFormat(' + ['backgroundColor'].concat(Object.keys(extra || {})).join(',') + ')' } });
    meta.forEach(m => {
      const r = m.row - 1;
      if (m.kind === 'banner') { out.push(fill(r, r + 1, 0, 6, 'E7DFCC', { textFormat: { bold: true, fontSize: 12 } })); out.push({ mergeCells: { range: { sheetId: S, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } }); return; }
      out.push(fill(r, r + 1, 0, 6, m.band % 2 ? 'F7F4EC' : 'FFFFFF'));
      out.push(fill(r, r + 1, 3, 4, 'FFF6D6'));
      if (m.first) out.push({ updateBorders: { range: { sheetId: S, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 6 }, top: { style: 'SOLID', color: rgb('CFC9BB') } } });
    });
    return out;
  }
  /* הגנות ועיצוב של הלשוניות הקבועות. מוחקים הגנות קיימות לפני כן (נקרא מהגיליון), כדי לא לשכפל. */
  function staticFormat(items) {
    return [
      headerFmt(ID.ITEMS, 0, 1, 0, 6), headerFmt(ID.ITEMS, 0, 1, 7, 9), width(ID.ITEMS, 0, 1, 80), width(ID.ITEMS, 1, 2, 140), width(ID.ITEMS, 2, 3, 230), width(ID.ITEMS, 3, 4, 100), width(ID.ITEMS, 4, 5, 70), width(ID.ITEMS, 5, 6, 260), width(ID.ITEMS, 6, 7, 24), width(ID.ITEMS, 7, 8, 380), width(ID.ITEMS, 8, 9, 110),
      { repeatCell: { range: { sheetId: ID.ITEMS, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: NUMFMT } } }, fields: 'userEnteredFormat.numberFormat' } },
      { repeatCell: { range: { sheetId: ID.ITEMS, startRowIndex: 1, endRowIndex: 7, startColumnIndex: 8, endColumnIndex: 9 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: NUMFMT }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(numberFormat,textFormat)' } },
      { repeatCell: { range: { sheetId: ID.ITEMS, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 4, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { fontSize: 8, foregroundColor: rgb('9A958A') } } }, fields: 'userEnteredFormat.textFormat' } },
      { repeatCell: { range: { sheetId: ID.ITEMS, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontSize: 9, foregroundColor: rgb('6F6A5F') } } }, fields: 'userEnteredFormat.textFormat' } },
      { repeatCell: { range: { sheetId: ID.ITEMS, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 7, endColumnIndex: 8 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
      { setDataValidation: { range: { sheetId: ID.ITEMS, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 1 }, rule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'הכנסה' }, { userEnteredValue: 'קבועה' }, { userEnteredValue: 'שוטפת' }] }, strict: false, showCustomUi: true } } },
      { updateSheetProperties: { properties: { sheetId: ID.ITEMS, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      // בלשונית התקציב מגינים רק על המפתח ועל הסיכום. את הסכומים והשמות כותבים בחופשיות.
      protect(ID.ITEMS, 'עמודת המפתח מחברת סעיף להוצאות. אל תמחקי', { range: { sheetId: ID.ITEMS, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 4, endColumnIndex: 5 } }),
      protect(ID.ITEMS, 'סיכום התקציב (נוסחאות)', { range: { sheetId: ID.ITEMS, startRowIndex: 0, endRowIndex: 6, startColumnIndex: 7, endColumnIndex: 9 } }),
      headerFmt(ID.LOG, 0, 1, 0, 13), { updateSheetProperties: { properties: { sheetId: ID.LOG, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      width(ID.LOG, 0, 1, 110), width(ID.LOG, 1, 2, 130), width(ID.LOG, 2, 4, 90), width(ID.LOG, 4, 5, 150), width(ID.LOG, 5, 6, 70), width(ID.LOG, 7, 8, 190), width(ID.LOG, 11, 12, 80),
      { updateDimensionProperties: { range: { sheetId: ID.LOG, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
      protect(ID.LOG, 'כותרות היומן. האפליקציה תלויה בהן', { range: { sheetId: ID.LOG, startRowIndex: 0, endRowIndex: 1 } }),
      headerFmt(ID.SNAP, 0, 1, 0, 6), protect(ID.SNAP, 'עותק התקציב לכל חודש. האפליקציה כותבת אותו, ואל תשני אותו ידנית'),
      headerFmt(ID.SET, 0, 1, 0, 3), width(ID.SET, 0, 1, 120), width(ID.SET, 1, 2, 110), width(ID.SET, 2, 3, 170),
      protect(ID.SET, 'הגדרות האפליקציה. אל תשני ידנית')
    ];
  }

  /* ---- תוכנית יצירה: גיליון חדש בדרייב של המשתמשת ---- */
  function plan(opts) {
    const items = orderItems(opts.items && opts.items.length ? opts.items : sampleItems());
    const startYm = opts.startYm, months = Math.max(1, Math.min(12, opts.months || 12));
    const lay = buildItemsLayout(items, opts.income);
    const vv = viewValues(lay.items, true, startYm, months), fv = viewValues(lay.items, false, startYm, months);
    const sheets = [[ID.ITEMS, T.ITEMS, '2E7D32'], [ID.VAR, T.VAR, '9A958A'], [ID.FIXED, T.FIXED, '9A958A'], [ID.LOG, T.LOG, '1565C0'], [ID.SNAP, T.SNAP, '9A958A'], [ID.SET, T.SET, '9A958A']];
    const formulas = [   // נכנסים כנוסחאות (USER_ENTERED)
      itemsSideValues(), { range: q(T.VAR) + '!A1', values: vv.grid }, { range: q(T.FIXED) + '!A1', values: fv.grid }];
    const raw = [   // נכנסים כמו שהם (RAW): שמות סעיפים לא צריכים להתפרש כתאריך או נוסחה
      { range: q(T.ITEMS) + '!A1', values: lay.values }, { range: q(T.LOG) + '!A1', values: [LOG_HEADER] }, { range: q(T.SNAP) + '!A1', values: [SNAP_HEADER] },
      { range: q(T.SET) + '!A1', values: settingsValues(startYm, months, opts.startDay, opts.opening) }, { range: q(T.SET) + '!A7', values: [[NOTE_SET]] }];
    if (opts.prefsJson) raw.push({ range: q(T.SET) + '!E1', values: [['העדפות האפליקציה (לא לערוך)'], [opts.prefsJson]] });
    else raw.push({ range: q(T.SET) + '!E1', values: [['העדפות האפליקציה (לא לערוך)']] });
    return { items: lay.items, meta: lay.meta, startYm: startYm, months: months, sheets: sheets, formulas: formulas, raw: raw, views: { VAR: vv, FIXED: fv } };
  }
  function formatRequests(p) {
    return staticFormat(p.items).concat(p.meta ? layoutFormat(p.meta) : [], viewFormat(ID.VAR, p.views.VAR), viewFormat(ID.FIXED, p.views.FIXED));
  }
  const createBody = (title, p) => ({
    properties: { title: title, timeZone: 'Asia/Jerusalem' },
    sheets: p.sheets.map((s, i) => ({ properties: { sheetId: s[0], title: s[1], index: i, rightToLeft: true, tabColorStyle: { rgbColor: rgb(s[2]) }, gridProperties: { rowCount: s[0] === ID.LOG ? 2000 : 600, columnCount: Math.max(14, s[0] === ID.VAR ? p.views.VAR.width + 1 : s[0] === ID.FIXED ? p.views.FIXED.width + 1 : 14) } } }))
  });

  /* תיקון קובץ קיים: נוסחאות הצפייה והגנות בלבד (לא נוגעים בנתונים). items: כל הסעיפים עם row = שורה בלשונית התקציב */
  function repairPlan(items, startYm, months) {
    const vv = viewValues(items, true, startYm, months), fv = viewValues(items, false, startYm, months);
    return { items: items, views: { VAR: vv, FIXED: fv }, formulas: [itemsSideValues(), { range: q(T.VAR) + '!A1', values: vv.grid }, { range: q(T.FIXED) + '!A1', values: fv.grid }],
      raw: [{ range: q(T.LOG) + '!A1:M1', values: [LOG_HEADER] }, { range: q(T.SNAP) + '!A1:F1', values: [SNAP_HEADER] }, { range: q(T.SET) + '!A1:C1', values: [SET_HEADER] }], sheets: [[ID.ITEMS, T.ITEMS, '2E7D32'], [ID.VAR, T.VAR, '9A958A'], [ID.FIXED, T.FIXED, '9A958A'], [ID.LOG, T.LOG, '1565C0'], [ID.SNAP, T.SNAP, '9A958A'], [ID.SET, T.SET, '9A958A']] };
  }
  const Workbook = { repairPlan: repairPlan, T: T, ID: ID, MONTHS: MONTHS, LOG_HEADER: LOG_HEADER, sampleItems: sampleItems, CATALOG: CATALOG, buildItemsLayout: buildItemsLayout, orderItems: orderItems, monthList: monthList, plan: plan, formatRequests: formatRequests, createBody: createBody,
    viewValues: viewValues, viewFormat: viewFormat, staticFormat: staticFormat, protect: protect };
  if (typeof module !== 'undefined' && module.exports) module.exports = Workbook; else root.Workbook = Workbook;
})(typeof window !== 'undefined' ? window : globalThis);
