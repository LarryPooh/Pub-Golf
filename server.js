// 1° Pub Golf — Bologna · Luglio 2026 · server della classifica condivisa
// Zero dipendenze: solo Node (>=18). Avvio:  node server.js
// Ogni "bevuta" è una riga: tipo (gioco|extra|penitenza), locale, drink, sorsi.
// Il punteggio per persona lo calcola la pagina; qui si conservano i dati e si
// protegge la cancellazione col PIN del game master.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'entries.json');

// --- Game master: solo chi ha questo PIN può cancellare. CAMBIALO! ---
const GM_PIN = process.env.GM_PIN || 'bologna2026';
const ADMINS = (process.env.ADMINS || 'larry').split(',').map(s => s.trim().toLowerCase());

const BODY_LIMIT = 20000;
const TYPES = ['gioco', 'extra', 'penitenza'];

// ---------- storage ----------
let entries = [];
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || [];
} catch (e) { console.error('Lettura dati fallita, riparto vuoto:', e.message); entries = []; }
function persist() {
  try { const tmp = DATA_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(entries, null, 2)); fs.renameSync(tmp, DATA_FILE); }
  catch (e) { console.error('Salvataggio fallito:', e.message); }
}

function clampInt(v, min, max) { let n = parseInt(v, 10); if (isNaN(n)) n = min; if (n < min) n = min; if (max != null && n > max) n = max; return n; }
function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 24);
  if (!name) return null;
  const type = TYPES.includes(raw.type) ? raw.type : 'gioco';
  return {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    name, type,
    venue: String(raw.venue || '').slice(0, 40),
    venueName: String(raw.venueName || '').slice(0, 40),
    drink: String(raw.drink || 'Drink').trim().slice(0, 40),
    sips: clampInt(raw.sips, 1, 999),
    ts: Date.now()
  };
}

// ---------- HTTP helpers ----------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-gm-pin' });
  res.end(JSON.stringify(obj));
}
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.ico':'image/x-icon','.png':'image/png','.svg':'image/svg+xml','.json':'application/json' };
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', c => { size += c.length; if (size > BODY_LIMIT) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function isGM(req) { return (req.headers['x-gm-pin'] || '') === GM_PIN; }

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'OPTIONS') return sendJSON(res, 204, {});
  if (url === '/api/config' && req.method === 'GET') return sendJSON(res, 200, { admins: ADMINS });
  if (url === '/api/verify' && req.method === 'POST') {
    try { const b = await readBody(req); return sendJSON(res, 200, { ok: String(b.pin || '') === GM_PIN }); }
    catch (e) { return sendJSON(res, 400, { ok: false }); }
  }
  if (url === '/api/entries') {
    if (req.method === 'GET') return sendJSON(res, 200, entries);
    if (req.method === 'POST') {
      try { const e = sanitizeEntry(await readBody(req)); if (!e) return sendJSON(res, 400, { error: 'Serve un nickname.' });
        entries.unshift(e); persist(); return sendJSON(res, 201, entries); }
      catch (er) { return sendJSON(res, 400, { error: 'Body non valido.' }); }
    }
    if (req.method === 'DELETE') { if (!isGM(req)) return sendJSON(res, 403, { error: 'Solo il game master.' }); entries = []; persist(); return sendJSON(res, 200, entries); }
    return sendJSON(res, 405, { error: 'Metodo non ammesso.' });
  }
  if (url.startsWith('/api/entries/') && req.method === 'DELETE') {
    if (!isGM(req)) return sendJSON(res, 403, { error: 'Solo il game master.' });
    const id = decodeURIComponent(url.slice('/api/entries/'.length));
    const before = entries.length; entries = entries.filter(e => e.id !== id);
    if (entries.length !== before) persist();
    return sendJSON(res, 200, entries);
  }
  if (url.startsWith('/api/')) return sendJSON(res, 404, { error: 'Endpoint sconosciuto.' });
  return serveStatic(req, res);
});
server.listen(PORT, () => {
  console.log('\n🏌️  1° Pub Golf — Bologna · Luglio 2026');
  console.log('   Server su http://localhost:' + PORT);
  console.log('   PIN game master: ' + GM_PIN + '  (cambialo con GM_PIN)');
  console.log('   Dati in ' + DATA_FILE + '\n');
});
