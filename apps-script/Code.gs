/**
 * Biken ride requests
 *
 * Receives ride requests from the Biken website, saves each one as a row on the
 * "Requests" tab of the Biken Ride Requests sheet, and sends the emails:
 *   1. To the customer, straight away: "We've received your ride request".
 *   2. To Biken, straight away: a new-request notification.
 *   3. To the customer, when a coordinator sets Status to "Confirmed" and has
 *      filled in Rider and Fare: "Your Biken ride is confirmed" with the details.
 *
 * Setup steps are in the README of the website project.
 */

const SHEET_ID = '1WuuiJXybo2EIIGlIsT28IaEougBVbSeD00dnfKpSZLI';
const TAB = 'Requests';
const TIMEZONE = 'Africa/Kigali';
const LANGUAGES = ['English', 'French', 'Kiswahili', 'Kinyarwanda'];

// The Biken team. New-request alerts go to these addresses, and when a
// customer replies to one of our emails, the reply goes here too.
const TEAM_EMAILS = ['h.bello@alustudent.com', 't.oteniya@alustudent.com'];

// Column positions on the Requests tab (1-based).
const COL = {
  submitted: 1, id: 2, name: 3, email: 4, phone: 5, pickup: 6, destination: 7,
  date: 8, time: 9, language: 10, status: 11, rider: 12, riderPhone: 13,
  fare: 14, notes: 15, emailed: 16
};
const WIDTH = 16;

/* ---------- Website requests ---------- */

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

    const r = clean_(body);
    const problems = validate_(r);
    if (problems.length) return json_({ ok: false, error: 'invalid', fields: problems });

    const id = makeId_();
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      appendRequest_(r, id);
    } finally {
      lock.releaseLock();
    }

    try { sendReceived_(r, id); } catch (err) { console.error('Customer email failed', err); }
    try { notifyTeam_(r, id); } catch (err) { console.error('Team email failed', err); }
    return json_({ ok: true, id: id });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

function doGet() {
  return json_({ ok: true, service: 'Biken ride requests' });
}

function appendRequest_(r, id) {
  const sh = sheet_();
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  const range = sh.getRange(row, 1, 1, WIDTH);
  const formats = new Array(WIDTH).fill('@');
  formats[COL.submitted - 1] = 'ddd d mmm yyyy, hh:mm';
  formats[COL.fare - 1] = '#,##0';
  range.setNumberFormats([formats]);
  range.setValues([[
    new Date(), id, safe_(r.name), safe_(r.email), r.phone, safe_(r.pickup), safe_(r.destination),
    r.dateLabel, r.time, r.language, 'New', '', '', '', '', ''
  ]]);
  const rule = sh.getRange(2, COL.status).getDataValidation();
  if (rule) sh.getRange(row, COL.status).setDataValidation(rule);
}

/* ---------- Confirmed rides ---------- */

// Runs on every edit of the sheet (installed by setup()). When a row on the
// Requests tab is Confirmed and has a Rider and a Fare, the customer is emailed
// their ride details once. Clear "Ride details emailed" to send them again.
function onRequestEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== TAB) return;
  if (e.range.getLastColumn() < COL.status || e.range.getColumn() > COL.emailed) return;

  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  for (let row = first; row <= last; row++) {
    const v = sh.getRange(row, 1, 1, WIDTH).getValues()[0];
    if (String(v[COL.status - 1]).trim() !== 'Confirmed') continue;
    const emailed = String(v[COL.emailed - 1] || '');
    if (emailed.indexOf('Sent') === 0) continue;

    const rider = String(v[COL.rider - 1] || '').trim();
    const fare = v[COL.fare - 1];
    const email = String(v[COL.email - 1] || '').trim();
    const cell = sh.getRange(row, COL.emailed);
    if (!rider || fare === '' || fare === null) {
      cell.setValue('Not sent yet: add Rider and Fare');
      continue;
    }
    if (!email) {
      cell.setValue('Not sent: no customer email');
      continue;
    }
    try {
      sendConfirmed_({
        id: String(v[COL.id - 1]),
        name: String(v[COL.name - 1]),
        email: email,
        pickup: String(v[COL.pickup - 1]),
        destination: String(v[COL.destination - 1]),
        when: whenLabel_(String(v[COL.date - 1]), String(v[COL.time - 1])),
        rider: rider,
        riderPhone: String(v[COL.riderPhone - 1] || '').trim(),
        fare: fare
      });
      cell.setValue('Sent ' + Utilities.formatDate(new Date(), TIMEZONE, 'd MMM yyyy, HH:mm'));
    } catch (err) {
      console.error(err);
      cell.setValue('Not sent: email failed, try again');
    }
  }
}

/* ---------- One-time setup and testing ---------- */

// Run once from the Apps Script editor. It creates the shared secret (shown in
// the execution log, for Vercel) and the trigger that emails confirmed rides.
function setup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SHARED_SECRET');
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SHARED_SECRET', secret);
  }
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'onRequestEdit'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onRequestEdit').forSpreadsheet(SpreadsheetApp.openById(SHEET_ID)).onEdit().create();
  console.log('Setup done. Copy this value into Vercel as SHARED_SECRET:\n' + secret);
}

// Sends a sample request to yourself, as if a customer filled in the form.
function testRequest() {
  const me = Session.getEffectiveUser().getEmail();
  const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const res = doPost({ postData: { contents: JSON.stringify({
    secret: PropertiesService.getScriptProperties().getProperty('SHARED_SECRET'),
    name: 'Test', email: me, phone: '0788000000', pickup: 'Kimironko Market',
    destination: 'Kigali Convention Centre', date: today, time: '08:30', language: 'English'
  }) } });
  console.log(res.getContent());
}

/* ---------- Emails ---------- */

function sendReceived_(r, id) {
  const when = whenLabel_(r.dateLabel, r.time);
  const rows = [['Pickup', r.pickup], ['Destination', r.destination], ['When', when], ['Language', r.language], ['Request ID', id]];
  const intro = 'Thanks for booking with Biken. We\'ve received your ride request.';
  const next = 'What happens next: we find an available rider who speaks your language and agree the standard fare with them. ' +
    'Then we email you your ride details. You won\'t need to negotiate anything with the rider.';
  const outro = 'If any of these details are wrong, just reply to this email.';
  MailApp.sendEmail({
    to: r.email,
    subject: 'We\'ve received your Biken ride request (' + id + ')',
    name: 'Biken',
    replyTo: TEAM_EMAILS.join(','),
    body: textEmail_(r.name, [intro, '', textRows_(rows), '', next, '', outro]),
    htmlBody: htmlEmail_('Ride request received', r.name, intro, rows, next, outro)
  });
}

function sendConfirmed_(c) {
  const fare = formatFare_(c.fare);
  const rows = [['Pickup', c.pickup], ['Destination', c.destination], ['When', c.when], ['Rider', c.rider]];
  if (c.riderPhone) rows.push(['Rider\'s phone', c.riderPhone]);
  rows.push(['Fare', fare + ' (standard fare, already agreed with your rider)']);
  rows.push(['Request ID', c.id]);
  const intro = 'Your ride is confirmed.';
  const next = 'Your rider knows where you\'re going and the fare is already agreed, so there\'s nothing to negotiate. ' +
    'Please be ready at your pickup point a few minutes early.';
  const outro = 'Need to change something? Reply to this email.';
  MailApp.sendEmail({
    to: c.email,
    subject: 'Your Biken ride is confirmed: ' + c.when,
    name: 'Biken',
    replyTo: TEAM_EMAILS.join(','),
    body: textEmail_(c.name, [intro, '', textRows_(rows), '', next, '', outro]),
    htmlBody: htmlEmail_('Your ride is confirmed', c.name, intro, rows, next, outro)
  });
}

function notifyTeam_(r, id) {
  const to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL') || TEAM_EMAILS.join(',');
  if (!to) return;
  const when = whenLabel_(r.dateLabel, r.time);
  const url = SpreadsheetApp.openById(SHEET_ID).getUrl();
  const lines = [
    'New ride request ' + id, '',
    'Name: ' + r.name, 'Email: ' + r.email, 'Phone: ' + r.phone,
    'Pickup: ' + r.pickup, 'Destination: ' + r.destination, 'When: ' + when, 'Language: ' + r.language, '',
    'Open the sheet: ' + url
  ];
  MailApp.sendEmail({
    to: to,
    subject: 'New ride request: ' + r.name + ', ' + when,
    name: 'Biken website',
    replyTo: r.email,
    body: lines.join('\n')
  });
}

function textRows_(rows) {
  return rows.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n');
}

function textEmail_(name, lines) {
  return ['Hi ' + name + ','].concat([''], lines, ['', 'Biken', 'Move Kigali with confidence.']).join('\n');
}

function htmlEmail_(title, name, intro, rows, next, outro) {
  const tr = rows.map(function (x) {
    return '<tr><td style="padding:10px 0;color:#5D5866;font-size:14px;width:130px;vertical-align:top;border-bottom:1px solid #E7DEFA">' + esc_(x[0]) +
      '</td><td style="padding:10px 0;color:#25232B;font-size:15px;font-weight:600;border-bottom:1px solid #E7DEFA">' + esc_(x[1]) + '</td></tr>';
  }).join('');
  return '<div style="background:#F7F3FF;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #E7DEFA">' +
    '<div style="background:#4B238F;padding:22px 28px;color:#FFFFFF;font-size:22px;font-weight:bold">Biken</div>' +
    '<div style="padding:28px">' +
    '<h1 style="margin:0 0 12px;font-size:22px;color:#25232B">' + esc_(title) + '</h1>' +
    '<p style="margin:0 0 6px;font-size:15px;color:#25232B">Hi ' + esc_(name) + ',</p>' +
    '<p style="margin:0 0 18px;font-size:15px;color:#4F4A58;line-height:1.55">' + esc_(intro) + '</p>' +
    '<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px">' + tr + '</table>' +
    '<p style="margin:0 0 14px;font-size:15px;color:#4F4A58;line-height:1.55;background:#F1EBFF;padding:14px 16px;border-radius:12px">' + esc_(next) + '</p>' +
    '<p style="margin:0;font-size:14px;color:#5D5866;line-height:1.55">' + esc_(outro) + '</p>' +
    '</div>' +
    '<div style="padding:16px 28px;background:#25232B;color:#C6AEFF;font-size:13px">Biken · Move Kigali with confidence.</div>' +
    '</div></div>';
}

/* ---------- Helpers ---------- */

function sheet_() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  if (!sh) throw new Error('Tab "' + TAB + '" not found');
  return sh;
}

function clean_(b) {
  const s = function (v) { return String(v == null ? '' : v).replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 200); };
  const r = {
    name: s(b.name), email: s(b.email).toLowerCase(), phone: s(b.phone), pickup: s(b.pickup),
    destination: s(b.destination), date: s(b.date), time: s(b.time), language: s(b.language)
  };
  if (LANGUAGES.indexOf(r.language) < 0) r.language = 'English';
  r.dateLabel = r.date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
    try {
      r.dateLabel = Utilities.formatDate(Utilities.parseDate(r.date, TIMEZONE, 'yyyy-MM-dd'), TIMEZONE, 'EEE d MMM yyyy');
    } catch (err) { r.dateLabel = r.date; }
  }
  return r;
}

function validate_(r) {
  const bad = [];
  ['name', 'email', 'phone', 'pickup', 'destination', 'date', 'time'].forEach(function (k) { if (!r[k]) bad.push(k); });
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) bad.push('email');
  if (r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) bad.push('date');
  if (r.time && !/^\d{2}:\d{2}$/.test(r.time)) bad.push('time');
  return bad;
}

function whenLabel_(dateLabel, time) {
  return dateLabel + (time ? ' at ' + time : '');
}

function makeId_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 3; i++) tail += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'BK-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyMMdd') + '-' + tail;
}

function formatFare_(fare) {
  const n = Number(String(fare).replace(/[^0-9.]/g, ''));
  return isNaN(n) || !String(fare).trim() ? String(fare) : n.toLocaleString('en-US') + ' RWF';
}

// Text that starts with = + - or @ could be read as a formula by Sheets.
function safe_(v) {
  return /^[=+\-@]/.test(v) ? '’' + v : v;
}

function esc_(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
