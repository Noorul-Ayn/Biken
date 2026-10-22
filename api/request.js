// POST /api/request
// Receives a ride request from the website form, checks it, and passes it to the
// Google Apps Script that saves it to the Biken Ride Requests sheet and sends
// the confirmation emails.
//
// Environment variables (set them in Vercel > Project > Settings > Environment Variables):
//   APPS_SCRIPT_URL  the Web app URL from the Apps Script deployment
//   SHARED_SECRET    the value printed by setup() in the Apps Script editor

const FIELDS = ['name', 'email', 'phone', 'pickup', 'destination', 'date', 'time', 'language'];
const REQUIRED = ['name', 'email', 'phone', 'pickup', 'destination', 'date', 'time'];
const LANGUAGES = ['English', 'French', 'Kiswahili', 'Kinyarwanda'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return {};
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = readBody(req);

  // Hidden "website" field: people never fill it in, spam bots usually do.
  if (body.website) return res.status(200).json({ ok: true });

  const data = {};
  for (const k of FIELDS) data[k] = String(body[k] == null ? '' : body[k]).trim().slice(0, 200);
  if (!LANGUAGES.includes(data.language)) data.language = 'English';

  const bad = REQUIRED.filter((k) => !data[k]);
  if (data.email && !EMAIL_RE.test(data.email)) bad.push('email');
  if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) bad.push('date');
  if (data.time && !/^\d{2}:\d{2}$/.test(data.time)) bad.push('time');
  if (bad.length) return res.status(400).json({ ok: false, error: 'invalid', fields: bad });

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.SHARED_SECRET;
  if (!url || !secret) {
    console.error('APPS_SCRIPT_URL or SHARED_SECRET is not set in Vercel.');
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, secret }),
      redirect: 'follow',
      signal: controller.signal
    });
    const text = await upstream.text();
    let out = null;
    try { out = JSON.parse(text); } catch (e) { out = null; }
    if (!out || !out.ok) {
      console.error('Apps Script did not accept the request', upstream.status, text.slice(0, 300));
      if (out && out.error === 'invalid') return res.status(400).json({ ok: false, error: 'invalid', fields: out.fields || [] });
      return res.status(502).json({ ok: false, error: 'upstream' });
    }
    return res.status(200).json({ ok: true, id: out.id });
  } catch (err) {
    console.error('Could not reach Apps Script', err);
    return res.status(502).json({ ok: false, error: 'upstream' });
  } finally {
    clearTimeout(timer);
  }
};
