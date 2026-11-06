// Momentum server: static files + WebSocket multiplayer. Deploys on Render as-is.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_ROOM = 32;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
};

// ---- leaderboards (persisted to DATA_DIR/lb.json; ephemeral on Render free tier unless a disk is attached) ----
let LB = {};
try { LB = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'lb.json'), 'utf8')); } catch (e) {}
let lbTimer = null;
function saveLB() {
  if (lbTimer) return;
  lbTimer = setTimeout(() => {
    lbTimer = null;
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, 'lb.json'), JSON.stringify(LB)); } catch (e) {}
  }, 2000);
}
function submit(key, kind, name, val) {
  const low = kind === 'time';
  const rows = LB[key] || (LB[key] = []);
  const cur = rows.find(r => r.n === name);
  if (cur) { if (low ? val >= cur.v : val <= cur.v) return false; cur.v = val; cur.d = Date.now(); }
  else rows.push({ n: name, v: val, k: kind, d: Date.now() });
  rows.sort((a, b) => low ? a.v - b.v : b.v - a.v);
  if (rows.length > 20) rows.length = 20;
  saveLB();
  return true;
}

// ---- http ----
const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (urlPath === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (urlPath === '/api/online') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ online: wss.clients.size, rooms: [...rooms.entries()].map(([k, s]) => [k, s.size]) }));
  }
  // Find the game even if the repo layout is off (public/ missing, files in root, etc.)
  const dirs = [ROOT, __dirname];
  const findHtml = () => {
    for (const d of dirs) { const f = path.join(d, 'index.html'); if (fs.existsSync(f)) return f; }
    for (const d of dirs) { try { const h = fs.readdirSync(d).find(n => /\.html?$/i.test(n)); if (h) return path.join(d, h); } catch (e) {} }
    return null;
  };
  let file = null;
  if (urlPath === '/' || urlPath === '/index.html') file = findHtml();
  else {
    for (const d of dirs) {
      const f = path.normalize(path.join(d, urlPath));
      if (!f.startsWith(d)) continue;
      if (d !== ROOT && !TYPES[path.extname(f).toLowerCase()]) continue; // don't expose server files from root
      if (d !== ROOT && /package|server/i.test(path.basename(f))) continue;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) { file = f; break; }
    }
  }
  if (!file) {
    let listing = ''; try { listing = fs.readdirSync(__dirname).join(', '); } catch (e) {}
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Game file not found on server.\nServer folder contains: ' + listing + '\nExpected public/index.html next to server.js.');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});


// ---- parties ----
const parties = new Map(); let nextParty = 1;
const MODES = ['time', 'flow', 'speed', 'routes', 'tag', 'col', 'mc', 'hs', 'race'];
const partyInfo = p => ({ id: p.id, name: p.name, host: p.host.id, mode: p.mode, map: p.map, started: p.started, max: p.max, members: [...p.members].map(c => ({ id: c.id, n: c.name })) });
const partyList = () => [...parties.values()].map(partyInfo);
function pushParty(p) { const m = JSON.stringify({ t: 'party', p: partyInfo(p) }); for (const c of p.members) if (c.readyState === 1) c.send(m); }
function leaveParty(ws) {
  const p = ws.party && parties.get(ws.party); ws.party = null;
  if (!p) return;
  p.members.delete(ws); send(ws, { t: 'party', p: null });
  if (!p.members.size) { parties.delete(p.id); return; }
  if (p.host === ws) p.host = [...p.members][0];
  pushParty(p);
}
function partyMsg(ws, m) {
  if (m.t === 'plist') return send(ws, { t: 'parties', list: partyList() });
  if (m.t === 'pcreate') {
    leaveParty(ws);
    const p = { id: nextParty++, name: cleanName(m.name) || ws.name, host: ws, mode: MODES.includes(m.mode) ? m.mode : 'time', map: Math.max(0, Math.min(8, m.map | 0)), started: false, max: 8, members: new Set([ws]) };
    p.name = (String(m.name || '').trim() ? cleanName(m.name) : ws.name + "'s party").slice(0, 24);
    parties.set(p.id, p); ws.party = p.id; return pushParty(p);
  }
  if (m.t === 'pjoin') {
    const p = parties.get(m.id | 0); if (!p) return send(ws, { t: 'perr', s: 'Party no longer exists' });
    if (p.members.size >= p.max && !p.members.has(ws)) return send(ws, { t: 'perr', s: 'Party is full' });
    if (ws.party !== p.id) leaveParty(ws);
    p.members.add(ws); ws.party = p.id; pushParty(p);
    if (p.started) send(ws, { t: 'pgo', mode: p.mode, map: p.map });
    return;
  }
  const p = ws.party && parties.get(ws.party); if (!p) return;
  if (m.t === 'pleave') return leaveParty(ws);
  if (p.host !== ws) return;
  if (m.t === 'pset') { if (MODES.includes(m.mode)) p.mode = m.mode; p.map = Math.max(0, Math.min(8, m.map | 0)); p.started = false; pushParty(p); }
  else if (m.t === 'pgo') { p.started = true; const o = JSON.stringify({ t: 'pgo', mode: p.mode, map: p.map }); for (const c of p.members) if (c.readyState === 1) c.send(o); pushParty(p); }
}

// ---- websocket ----
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
const rooms = new Map(); // key -> Set<ws>
let nextId = 1;
const num = (x, lim = 1e5) => (typeof x === 'number' && isFinite(x) ? Math.max(-lim, Math.min(lim, x)) : 0);
const cleanName = s => String(s || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || 'Player';
const cleanKey = s => String(s || 'lobby').replace(/[^\w:@\-.]/g, '').slice(0, 48) || 'lobby';
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = (room, o, except) => { const m = JSON.stringify(o); for (const c of room) if (c !== except && c.readyState === 1) c.send(m); };
const roster = room => [...room].map(c => ({ id: c.id, n: c.name }));
const lbFor = key => ({ t: 'lb', key, rows: (LB[key] || []).slice(0, 10).map(r => ({ n: r.n, v: r.v })) });

function leave(ws) {
  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  room.delete(ws);
  if (!room.size) rooms.delete(ws.room); else { bcast(room, { t: 'leave', id: ws.id }); bcast(room, { t: 'roster', players: roster(room) }); }
  ws.room = null;
}
function join(ws, key) {
  leave(ws);
  let room = rooms.get(key);
  if (!room) rooms.set(key, room = new Set());
  if (room.size >= MAX_ROOM) return send(ws, { t: 'full', key });
  room.add(ws); ws.room = key;
  send(ws, { t: 'joined', key, id: ws.id, players: roster(room) });
  send(ws, lbFor(key.split('@')[0]));
  bcast(room, { t: 'roster', players: roster(room) }, ws);
}

wss.on('connection', ws => {
  ws.id = nextId++; ws.name = 'Player'; ws.room = null; ws.last = 0; ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  send(ws, { t: 'hello', id: ws.id, online: wss.clients.size });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t[0] === 'p' && m.t !== 'ping') partyMsg(ws, m);
    else if (m.t === 'join') { ws.name = cleanName(m.name); join(ws, cleanKey(m.key)); }
    else if (m.t === 'name') { ws.name = cleanName(m.name); const r = ws.room && rooms.get(ws.room); if (r) bcast(r, { t: 'roster', players: roster(r) }); }
    else if (m.t === 's' && ws.room) {
      const now = Date.now(); if (now - ws.last < 40) return; ws.last = now;
      const room = rooms.get(ws.room); if (!room) return;
      bcast(room, { t: 's', id: ws.id, x: num(m.x), y: num(m.y), z: num(m.z), r: num(m.r, 10), p: num(m.p, 3), a: num(m.a, 99) | 0, sp: num(m.sp, 500) }, ws);
    }
    else if (m.t === 'fin' && ws.room) {
      const kind = ['time', 'flow', 'speed'].includes(m.kind) ? m.kind : null; const val = num(m.val, 1e7);
      const key = cleanKey(m.key).split('@')[0];
      if (!kind || val <= 0 || (kind === 'time' && val < 2)) return;
      const room = rooms.get(ws.room);
      if (room) bcast(room, { t: 'fin', n: ws.name, v: val, kind }, ws);
      if (submit(key, kind, ws.name, val) && room) bcast(room, lbFor(key));
    }
    else if (m.t === 'ev' && ws.room) { // generic broadcast event (e.g. "finished race")
      const room = rooms.get(ws.room); if (room) bcast(room, { t: 'ev', n: ws.name, s: String(m.s || '').slice(0, 60) }, ws);
    }
  });
  ws.on('close', () => { leaveParty(ws); leave(ws); });
  ws.on('error', () => {});
});
// keep Render's proxy from dropping idle sockets, and reap dead ones
setInterval(() => { for (const c of wss.clients) { if (!c.alive) { c.terminate(); continue; } c.alive = false; try { c.ping(); } catch (e) {} } }, 25000);

server.listen(PORT, '0.0.0.0', () => console.log('Momentum running on port ' + PORT + ', public/index.html exists: ' + fs.existsSync(path.join(ROOT, 'index.html'))));
