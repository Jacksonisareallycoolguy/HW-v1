// Zero-dependency server: serves the app and relays your Canvas calendar feed.
// Run: node server.js   (Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.PASSCODE || ''; // optional: set to keep strangers off your relay
const MAX_BYTES = 5 * 1024 * 1024;
const INDEX = path.join(__dirname, 'public', 'index.html');

const hits = new Map(); // ip -> [timestamps]
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 30;
}

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:');
}

async function fetchFeed(raw) {
  let u;
  try { u = new URL(raw.replace(/^webcal:/i, 'https:')); } catch { throw [400, 'That does not look like a link.']; }
  if (u.protocol !== 'https:') throw [400, 'The link must use https.'];
  if (!/\/feeds\/calendars\/[^/]+\.ics$/i.test(u.pathname)) throw [400, 'That is not a Canvas calendar feed link (it should end in .ics).'];
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => { throw [502, 'Could not find that website.']; });
  if (!addrs.length || addrs.some(a => isPrivate(a.address))) throw [400, 'That address is not allowed.'];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(u, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'canvas-due/1.0', accept: 'text/calendar,*/*' } });
    if (r.status >= 300 && r.status < 400) throw [502, 'Canvas redirected the request. Re-copy the feed link from Canvas.'];
    if (!r.ok) throw [502, 'Canvas returned an error (' + r.status + '). The link may have been reset.'];
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw [502, 'The calendar is too large.'];
    const text = buf.toString('utf8');
    if (!text.includes('BEGIN:VCALENDAR')) throw [502, 'That link did not return a calendar.'];
    return text;
  } catch (e) {
    if (Array.isArray(e)) throw e;
    throw [502, e.name === 'AbortError' ? 'Canvas took too long to respond.' : 'Could not reach Canvas.'];
  } finally { clearTimeout(timer); }
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, {
    'content-type': type + '; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
  });
  res.end(body);
}

http.createServer(async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    return send(res, 200, fs.readFileSync(INDEX), 'text/html');
  }
  if (req.method === 'GET' && req.url === '/api/config') {
    return send(res, 200, JSON.stringify({ needsPasscode: !!PASSCODE }));
  }
  if (req.method === 'POST' && req.url === '/api/feed') {
    if (limited(ip)) return send(res, 429, JSON.stringify({ error: 'Too many requests. Wait a minute.' }));
    if (PASSCODE && req.headers['x-passcode'] !== PASSCODE) return send(res, 401, JSON.stringify({ error: 'Wrong passcode.' }));
    let body = '';
    for await (const c of req) { body += c; if (body.length > 4096) return send(res, 413, JSON.stringify({ error: 'Request too large.' })); }
    try {
      const { url } = JSON.parse(body || '{}');
      const text = await fetchFeed(String(url || ''));
      return send(res, 200, text, 'text/calendar');
    } catch (e) {
      const [code, msg] = Array.isArray(e) ? e : [400, 'Bad request.'];
      return send(res, code, JSON.stringify({ error: msg }));
    }
  }
  send(res, 404, JSON.stringify({ error: 'Not found' }));
}).listen(PORT, () => console.log('Canvas due running on port ' + PORT));
