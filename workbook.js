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

  const T = { ITEMS: 'התקציב', VAR: 'משתנות', FIXED: 'קבועות', LOG: 'יומן הוצאות', SNAP: 'תקציב לפי חודש', SET: 'הגדרות אפליקציה' };
  const ID = { ITEMS: 1, VAR: 2, FIXED: 3, LOG: 4, SNAP: 5, SET: 6 };
  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const LOG_HEADER = ['מזהה', 'תאריך ושעה', 'סוג', 'קבוצה', 'קטגוריה', 'סכום', 'תגיות', 'הערה', 'חודש', 'שבוע', 'יעד בבקרה', 'מפתח', 'נוסף ע"י'];
  const SNAP_HEADER = ['חודש (שנה+חודש)', 'מפתח', 'קבוצה', 'קטגוריה', 'תקציב', 'עמודה'];
  const SET_HEADER = ['הגדרה', 'ערך', 'בתוקף מחודש (שנה+חודש)'];
  const ITEMS_HEADER = ['סוג', 'קבוצה', 'סעיף', 'תקציב חודשי', 'מפתח'];
  const NUMFMT = '#,##0;[Red]-#,##0';
  const q = t => "'" + t + "'";
  const col = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  const SAMPLE = [['קבועה', 'הוצאות בית', 'שכר דירה / משכנתא'], ['קבועה', 'הוצאות בית', 'חשמל'], ['קבועה', 'הוצאות בית', 'ארנונה'], ['קבועה', 'תקשורת', 'אינטרנט'],
    ['שוטפת', 'קניות', 'סופר'], ['שוטפת', 'קניות', 'סופר פארם'], ['שוטפת', 'בילויים', 'מסעדות'], ['שוטפת', 'בילויים', 'בילויים']];
  function sampleItems() {
    let nf = 0, nv = 0;
    return SAMPLE.map(s => ({ type: s[0], group: s[1], name: s[2], budget: 0, key: s[0] === 'קבועה' ? 'fixed:' + nf++ : 'var:' + nv++ }));
  }
  /* קבועות קודם, אחר כך שוטפות; בתוך כל סוג הסדר המקורי. המפתח לא משתנה. */
  const orderItems = items => items.filter(i => i.type === 'קבועה').concat(items.filter(i => i.type !== 'קבועה'));

  function monthList(startYm, count) {
    const out = []; let y = Math.floor(startYm / 100), m = startYm % 100;
    for (let i = 0; i < count; i++) { out.push({ ym: y * 100 + m, mo: m, yr: y }); m++; if (m === 13) { m = 1; y++; } }
    return out;
  }

  /* ---- לשונית התקציב ---- */
  function itemsValues(items) {
    const rows = [ITEMS_HEADER.slice()];
    items.forEach(it => rows.push([it.type === 'קבועה' ? 'קבועה' : 'שוטפת', it.group, it.name, it.budget || 0, it.key]));
    return rows;
  }
  const NOTES = ['איך משתמשים בלשונית הזאת', '• כותבים כאן את התקציב: שורה לכל סעיף.', '• סוג: "קבועה" (למשל שכר דירה) או "שוטפת" (למשל סופר).',
    '• שורה חדשה בסוף הרשימה: מוסיפים סעיף. האפליקציה תיתן לו מפתח לבד.', '• שינוי תקציב חל רק קדימה: חודשים שעברו נשארים כמו שהיו.',
    '• אל תמחקי את עמודת "מפתח": היא מחברת את הסעיף להוצאות.', '• לא מוחקים שורה של סעיף שכבר היו לו הוצאות. מאפסים את התקציב שלו.'];
  function itemsSideValues() {
    return { range: q(T.ITEMS) + '!G1:H12', values: [[NOTES[0]], [NOTES[1]], [NOTES[2]], [NOTES[3]], [NOTES[4]], [NOTES[5]], [NOTES[6]], [], [],
      ['סך תקציב קבועות', '=SUMIF($A$2:$A$500,"קבועה",$D$2:$D$500)'], ['סך תקציב שוטפות', '=SUMIF($A$2:$A$500,"שוטפת",$D$2:$D$500)'], ['סך הכול בחודש', '=H10+H11']] };
  }

  /* ---- לשוניות הצפייה (נוסחאות בלבד) ---- */
  function viewValues(items, isVar, startYm, count) {
    const rows = [];   // br = השורה של הסעיף בלשונית "התקציב" (it.row אם ידועה, אחרת לפי הסדר)
    items.forEach((it, i) => { if ((it.type !== 'קבועה') === isVar) rows.push({ it: it, br: it.row || i + 2 }); });
    const per = isVar ? 9 : 3, months = monthList(startYm, count), width = 2 + per * count, first = 5;
    const grid = []; for (let r = 0; r < first + rows.length; r++) grid.push(new Array(width).fill(''));
    grid[0][0] = 'הוצאות ' + (isVar ? 'שוטפות' : 'קבועות') + ' לפי חודש. לצפייה בלבד: הכול מחושב מהלשוניות "התקציב" ו"יומן הוצאות". האפליקציה לא תלויה בלשונית הזאת.';
    grid[1][0] = 'מזהה חודש (לא לגעת)';
    grid[3][0] = 'קבוצה'; grid[3][1] = 'סעיף';
    rows.forEach((r, i) => { grid[first - 1 + i][0] = '=' + q(T.ITEMS) + '!$B$' + r.br; grid[first - 1 + i][1] = '=' + q(T.ITEMS) + '!$C$' + r.br; });
    months.forEach((m, mi) => {
      const c0 = 2 + mi * per, L0 = col(c0 + 1);
      grid[1][c0] = m.ym; grid[2][c0] = MONTHS[m.mo - 1] + ' ' + m.yr;
      const labels = isVar ? ['תקציב', 'שבועי', 'שבוע 1', 'שבוע 2', 'שבוע 3', 'שבוע 4', 'שבוע 5', 'בפועל', 'יתרה'] : ['תקציב', 'בפועל', 'יתרה'];
      labels.forEach((l, j) => { grid[3][c0 + j] = l; });
      const ymc = L0 + '$2';
      rows.forEach((r, i) => {
        const row = grid[first - 1 + i], R = first + i, key = q(T.ITEMS) + '!$E$' + r.br;
        row[c0] = '=IF(COUNTIFS(' + q(T.SNAP) + '!$A:$A,' + ymc + ',' + q(T.SNAP) + '!$B:$B,' + key + ')>0,SUMIFS(' + q(T.SNAP) + '!$E:$E,' + q(T.SNAP) + '!$A:$A,' + ymc + ',' + q(T.SNAP) + '!$B:$B,' + key + '),' + q(T.ITEMS) + '!$D$' + r.br + ')';
        const sum = w => '=SUMIFS(' + q(T.LOG) + '!$F:$F,' + q(T.LOG) + '!$L:$L,' + key + ',' + q(T.LOG) + '!$I:$I,MOD(' + ymc + ',100)' + (w ? ',' + q(T.LOG) + '!$J:$J,' + w : '') + ')';
        if (isVar) {
          row[c0 + 1] = '=' + L0 + R + '/4.3';
          for (let w = 1; w <= 5; w++) row[c0 + 1 + w] = sum(w);
          row[c0 + 7] = '=SUM(' + col(c0 + 3) + R + ':' + col(c0 + 7) + R + ')';
          row[c0 + 8] = '=' + L0 + R + '-' + col(c0 + 8) + R;
        } else { row[c0 + 1] = sum(0); row[c0 + 2] = '=' + L0 + R + '-' + col(c0 + 2) + R; }
      });
    });
    // שורת סיכום
    const tr = []; for (let c = 0; c < width; c++) tr.push('');
    tr[0] = 'סה"כ';
    months.forEach((m, mi) => { const c0 = 2 + mi * per; for (let j = 0; j < per; j++) { if (isVar && j === 1) continue; const L1 = col(c0 + j + 1); tr[c0 + j] = rows.length ? '=SUM(' + L1 + first + ':' + L1 + (first + rows.length - 1) + ')' : 0; } });
    grid.push(tr);
    return { grid: grid, per: per, count: count, rowCount: rows.length, width: width, first: first };
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
    const reqs = [headerFmt(sheetId, 3, 4, 0, v.width), width(sheetId, 0, 1, 130), width(sheetId, 1, 2, 190), width(sheetId, 2, v.width, 78),
      { repeatCell: { range: { sheetId: sheetId, startRowIndex: 4, endRowIndex: 4 + v.rowCount + 1, startColumnIndex: 2, endColumnIndex: v.width }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: NUMFMT } } }, fields: 'userEnteredFormat.numberFormat' } },
      { repeatCell: { range: { sheetId: sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: v.width }, cell: { userEnteredFormat: { backgroundColor: rgb('EFE9DC'), textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
      { repeatCell: { range: { sheetId: sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: v.width }, cell: { userEnteredFormat: { textFormat: { fontSize: 8, foregroundColor: rgb('9A958A') } } }, fields: 'userEnteredFormat.textFormat' } },
      { updateSheetProperties: { properties: { sheetId: sheetId, gridProperties: { frozenRowCount: 4, frozenColumnCount: 2 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
      protect(sheetId, 'לשונית לצפייה בלבד: נוסחאות. אם מחקת בטעות, בהגדרות האפליקציה יש "תיקון הגיליון"')];
    return reqs;
  }
  /* הגנות ועיצוב של הלשוניות הקבועות. מוחקים הגנות קיימות לפני כן (נקרא מהגיליון), כדי לא לשכפל. */
  function staticFormat(items) {
    const n = Math.max(items.length + 1, 2);
    return [
      headerFmt(ID.ITEMS, 0, 1, 0, 5), width(ID.ITEMS, 0, 1, 70), width(ID.ITEMS, 1, 2, 150), width(ID.ITEMS, 2, 3, 220), width(ID.ITEMS, 3, 4, 100), width(ID.ITEMS, 4, 5, 80), width(ID.ITEMS, 6, 7, 440),
      { repeatCell: { range: { sheetId: ID.ITEMS, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: NUMFMT } } }, fields: 'userEnteredFormat.numberFormat' } },
      { repeatCell: { range: { sheetId: ID.ITEMS, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 4, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { fontSize: 8, foregroundColor: rgb('9A958A') } } }, fields: 'userEnteredFormat.textFormat' } },
      { repeatCell: { range: { sheetId: ID.ITEMS, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
      { setDataValidation: { range: { sheetId: ID.ITEMS, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 1 }, rule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'קבועה' }, { userEnteredValue: 'שוטפת' }] }, showCustomUi: true, strict: false } } },
      { updateSheetProperties: { properties: { sheetId: ID.ITEMS, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      // בלשונית התקציב מגינים רק על המפתח ועל הסיכומים. את הסכומים והשמות כותבים בחופשיות.
      protect(ID.ITEMS, 'עמודת המפתח מחברת סעיף להוצאות. אל תמחקי', { range: { sheetId: ID.ITEMS, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 4, endColumnIndex: 5 } }),
      protect(ID.ITEMS, 'סיכומי התקציב (נוסחאות)', { range: { sheetId: ID.ITEMS, startRowIndex: 9, endRowIndex: 12, startColumnIndex: 6, endColumnIndex: 8 } }),
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
    const vv = viewValues(items, true, startYm, months), fv = viewValues(items, false, startYm, months);
    const sheets = [[ID.ITEMS, T.ITEMS, '2E7D32'], [ID.VAR, T.VAR, '9A958A'], [ID.FIXED, T.FIXED, '9A958A'], [ID.LOG, T.LOG, '1565C0'], [ID.SNAP, T.SNAP, '9A958A'], [ID.SET, T.SET, '9A958A']];
    const formulas = [   // נכנסים כנוסחאות (USER_ENTERED)
      itemsSideValues(), { range: q(T.VAR) + '!A1', values: vv.grid }, { range: q(T.FIXED) + '!A1', values: fv.grid }];
    const raw = [   // נכנסים כמו שהם (RAW): שמות סעיפים לא צריכים להתפרש כתאריך או נוסחה
      { range: q(T.ITEMS) + '!A1', values: itemsValues(items) }, { range: q(T.LOG) + '!A1', values: [LOG_HEADER] }, { range: q(T.SNAP) + '!A1', values: [SNAP_HEADER] },
      { range: q(T.SET) + '!A1', values: settingsValues(startYm, months, opts.startDay, opts.opening) }, { range: q(T.SET) + '!A7', values: [[NOTE_SET]] }];
    if (opts.prefsJson) raw.push({ range: q(T.SET) + '!E1', values: [['העדפות האפליקציה (לא לערוך)'], [opts.prefsJson]] });
    else raw.push({ range: q(T.SET) + '!E1', values: [['העדפות האפליקציה (לא לערוך)']] });
    return { items: items, startYm: startYm, months: months, sheets: sheets, formulas: formulas, raw: raw, views: { VAR: vv, FIXED: fv } };
  }
  function formatRequests(p) {
    return staticFormat(p.items).concat(viewFormat(ID.VAR, p.views.VAR), viewFormat(ID.FIXED, p.views.FIXED));
  }
  const createBody = (title, p) => ({
    properties: { title: title, locale: 'he_IL', timeZone: 'Asia/Jerusalem' },
    sheets: p.sheets.map((s, i) => ({ properties: { sheetId: s[0], title: s[1], index: i, rightToLeft: true, tabColorStyle: { rgbColor: rgb(s[2]) }, gridProperties: { rowCount: s[0] === ID.LOG ? 2000 : 600, columnCount: Math.max(14, s[0] === ID.VAR ? p.views.VAR.width + 1 : s[0] === ID.FIXED ? p.views.FIXED.width + 1 : 14) } } }))
  });

  /* תיקון קובץ קיים: נוסחאות הצפייה והגנות בלבד (לא נוגעים בנתונים). items: כל הסעיפים עם row = שורה בלשונית התקציב */
  function repairPlan(items, startYm, months) {
    const vv = viewValues(items, true, startYm, months), fv = viewValues(items, false, startYm, months);
    return { items: items, views: { VAR: vv, FIXED: fv }, formulas: [itemsSideValues(), { range: q(T.VAR) + '!A1', values: vv.grid }, { range: q(T.FIXED) + '!A1', values: fv.grid }],
      raw: [{ range: q(T.LOG) + '!A1:M1', values: [LOG_HEADER] }, { range: q(T.SNAP) + '!A1:F1', values: [SNAP_HEADER] }, { range: q(T.SET) + '!A1:C1', values: [SET_HEADER] }], sheets: [[ID.ITEMS, T.ITEMS, '2E7D32'], [ID.VAR, T.VAR, '9A958A'], [ID.FIXED, T.FIXED, '9A958A'], [ID.LOG, T.LOG, '1565C0'], [ID.SNAP, T.SNAP, '9A958A'], [ID.SET, T.SET, '9A958A']] };
  }
  const Workbook = { repairPlan: repairPlan, T: T, ID: ID, MONTHS: MONTHS, LOG_HEADER: LOG_HEADER, sampleItems: sampleItems, orderItems: orderItems, monthList: monthList, plan: plan, formatRequests: formatRequests, createBody: createBody,
    viewValues: viewValues, viewFormat: viewFormat, staticFormat: staticFormat, protect: protect };
  if (typeof module !== 'undefined' && module.exports) module.exports = Workbook; else root.Workbook = Workbook;
})(typeof window !== 'undefined' ? window : globalThis);
