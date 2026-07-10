// 1° Pub Golf — Bologna · Luglio 2026 · server della classifica condivisa
// Zero dipendenze: solo Node (>=18). Avvio:  node server.js
// Punteggio, totali e permessi di cancellazione sono gestiti qui (lato server).

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'entries.json');

// --- Game master: solo chi ha questo PIN può cancellare. CAMBIALO! ---
const GM_PIN = process.env.GM_PIN || 'bologna2026';
// nickname mostrati come "game master" nel client (la serratura vera resta il PIN)
const ADMINS = (process.env.ADMINS || 'larry').split(',').map(s => s.trim().toLowerCase());

const MAX_ITEMS = 30;    // tetto extra/penitenze per sicurezza
const BODY_LIMIT = 40000;

// ---------- storage (file JSON) ----------
let entries = [];
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || [];
} catch (e) { console.error('Lettura dati fallita, riparto vuoto:', e.message); entries = []; }

function persist() {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('Salvataggio fallito:', e.message); }
}

// ---------- regole del gioco ----------
function scoreOf(gameSips, extras) {
  const q = extras.filter(e => e.sips <= gameSips).length; // extra valido = bevuto in <= sorsi del drink del gioco
  return { qualifying: q, eff: gameSips / Math.pow(2, q) };
}
function clampInt(v, min, max) {
  let n = parseInt(v, 10);
  if (isNaN(n)) n = min;
  if (n < min) n = min;
  if (max != null && n > max) n = max;
  return n;
}
function sanitizeItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_ITEMS).map(x => ({
    drink: String((x && x.drink) || '').trim().slice(0, 40),
    sips: clampInt(x && x.sips, 1, 999)
  }));
}
function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 24);
  if (!name) return null;
  const gameSips = clampInt(raw.gameSips, 1, 999);
  const extras = sanitizeItems(raw.extras);
  const penalties = sanitizeItems(raw.penalties);
  const { qualifying, eff } = scoreOf(gameSips, extras);
  return {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    name,
    venue: String(raw.venue || '').slice(0, 40),
    venueName: String(raw.venueName || '').slice(0, 40),
    drink: String(raw.drink || 'Drink').trim().slice(0, 40),
    gameSips, extras, penalties, qualifying, eff,
    ts: Date.now()
  };
}

// ---------- HTTP helpers ----------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-gm-pin'
  });
  res.end(body);
}
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css',
  '.ico':'image/x-icon','.png':'image/png','.svg':'image/svg+xml','.json':'application/json' };
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

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'OPTIONS') return sendJSON(res, 204, {});

  // config pubblica (quali nickname sono "game master" nel client)
  if (url === '/api/config' && req.method === 'GET') return sendJSON(res, 200, { admins: ADMINS });

  // verifica PIN game master
  if (url === '/api/verify' && req.method === 'POST') {
    try { const b = await readBody(req); return sendJSON(res, 200, { ok: String(b.pin||'') === GM_PIN }); }
    catch (e) { return sendJSON(res, 400, { ok: false }); }
  }

  if (url === '/api/entries') {
    if (req.method === 'GET') return sendJSON(res, 200, entries);
    if (req.method === 'POST') {
      try {
        const entry = sanitizeEntry(await readBody(req));
        if (!entry) return sendJSON(res, 400, { error: 'Dati non validi (serve un nickname).' });
        entries.unshift(entry); persist();
        return sendJSON(res, 201, entries);
      } catch (e) { return sendJSON(res, 400, { error: 'Body non valido.' }); }
    }
    if (req.method === 'DELETE') { // svuota tutto — solo game master
      if (!isGM(req)) return sendJSON(res, 403, { error: 'Solo il game master può azzerare.' });
      entries = []; persist(); return sendJSON(res, 200, entries);
    }
    return sendJSON(res, 405, { error: 'Metodo non ammesso.' });
  }

  if (url.startsWith('/api/entries/') && req.method === 'DELETE') { // cancella una — solo game master
    if (!isGM(req)) return sendJSON(res, 403, { error: 'Solo il game master può cancellare.' });
    const id = decodeURIComponent(url.slice('/api/entries/'.length));
    const before = entries.length;
    entries = entries.filter(e => e.id !== id);
    if (entries.length !== before) persist();
    return sendJSON(res, 200, entries);
  }

  if (url.startsWith('/api/')) return sendJSON(res, 404, { error: 'Endpoint sconosciuto.' });
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('\n🏌️  1° Pub Golf — Bologna · Luglio 2026');
  console.log('   Server su http://localhost:' + PORT);
  console.log('   PIN game master attuale: ' + GM_PIN + '  (cambialo con la variabile GM_PIN)');
  console.log('   Dati in ' + DATA_FILE + '\n');
});
