// 1° Pub Golf — Luglio 2026 · server della classifica condivisa
// Zero dipendenze: solo Node (>=18). Avvio:  node server.js
// La classifica vive in data/entries.json e viene vista/aggiornata da tutti.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'entries.json');
const MAX_EXTRAS = 20;   // per sicurezza
const BODY_LIMIT = 20000; // byte

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
    fs.renameSync(tmp, DATA_FILE); // scrittura atomica
  } catch (e) { console.error('Salvataggio fallito:', e.message); }
}

// ---------- regole del gioco (autorevoli lato server) ----------
function score(gameSips, extras) {
  const q = extras.filter(s => s <= gameSips).length; // extra validi = bevuti in <= sorsi del drink del gioco
  return { qualifying: q, eff: gameSips / Math.pow(2, q) };
}

function clampInt(v, min, max) {
  let n = parseInt(v, 10);
  if (isNaN(n)) n = min;
  if (n < min) n = min;
  if (max != null && n > max) n = max;
  return n;
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 40);
  if (!name) return null;
  const gameSips = clampInt(raw.gameSips, 1, 999);
  const extras = Array.isArray(raw.extras)
    ? raw.extras.slice(0, MAX_EXTRAS).map(s => clampInt(s, 1, 999))
    : [];
  const { qualifying, eff } = score(gameSips, extras);
  return {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    name,
    venue: String(raw.venue || '').slice(0, 40),
    venueName: String(raw.venueName || '').slice(0, 40),
    drink: String(raw.drink || 'Drink').trim().slice(0, 40),
    gameSips,
    extras,
    qualifying,
    eff,
    total: clampInt(raw.total, 0, 9999),
    penalty: clampInt(raw.penalty, 0, 9999),
    ts: Date.now()
  };
}

// entries in memoria sono già ordinate per inserimento (più recente in testa)
function currentList() { return entries; }

// ---------- helpers HTTP ----------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); } // no path traversal
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

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') return sendJSON(res, 204, {});

  // API
  if (url === '/api/entries') {
    if (req.method === 'GET') return sendJSON(res, 200, currentList());
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const entry = sanitizeEntry(body);
        if (!entry) return sendJSON(res, 400, { error: 'Dati non validi (serve almeno un nome).' });
        entries.unshift(entry);
        persist();
        return sendJSON(res, 201, currentList());
      } catch (e) { return sendJSON(res, 400, { error: 'Body non valido.' }); }
    }
    if (req.method === 'DELETE') { // svuota tutto
      entries = [];
      persist();
      return sendJSON(res, 200, currentList());
    }
    return sendJSON(res, 405, { error: 'Metodo non ammesso.' });
  }

  if (url.startsWith('/api/entries/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/entries/'.length));
    const before = entries.length;
    entries = entries.filter(e => e.id !== id);
    if (entries.length !== before) persist();
    return sendJSON(res, 200, currentList());
  }

  if (url.startsWith('/api/')) return sendJSON(res, 404, { error: 'Endpoint sconosciuto.' });

  // file statici (frontend)
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('\n🏌️  1° Pub Golf — Luglio 2026');
  console.log('   Server acceso su http://localhost:' + PORT);
  console.log('   Classifica salvata in ' + DATA_FILE);
  console.log('   Ferma con Ctrl+C\n');
});
