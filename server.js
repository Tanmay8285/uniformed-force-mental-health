import http from 'node:http';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCb);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(ROOT, 'data', 'sahaara.enc');
// Parse .env with the built-in filesystem API before starting the server.
try {
  const env = await readFile(path.join(ROOT, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const PORT = Number(process.env.PORT || 3010);
const COOKIE = 'sahaara.sid';
const sessions = new Map();
const encryptionKey = createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY || 'LOCAL-DEMO-ONLY-change-this-before-use').digest();
const demoConfig = !process.env.DATA_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY.includes('replace-with');
const sessionSecret = process.env.SESSION_SECRET || 'LOCAL-DEMO-ONLY-change-this-before-use';
const sessionHash = value => createHash('sha256').update(`${sessionSecret}:${value}`).digest('hex');
let store = { users: [], checkins: [], consents: [], audit: [] };
let pgPool = null;
if (process.env.DATABASE_URL) {
  if (demoConfig || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('replace-with')) throw new Error('Set unique SESSION_SECRET and DATA_ENCRYPTION_KEY values before enabling PostgreSQL.');
  if (!process.env.DATABASE_CA_CERT_PATH) throw new Error('Set DATABASE_CA_CERT_PATH to the Aiven CA certificate path. TLS certificate verification is required.');
  const ca = await readFile(process.env.DATABASE_CA_CERT_PATH, 'utf8');
  const { Pool } = await import('pg');
  const databaseUrl = new URL(process.env.DATABASE_URL);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) databaseUrl.searchParams.delete(key);
  pgPool = new Pool({ connectionString: databaseUrl.toString(), ssl: { ca, rejectUnauthorized: true }, max: 5, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30000 });
  await pgPool.query('CREATE TABLE IF NOT EXISTS sahaara_encrypted_store (store_id text PRIMARY KEY, payload bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
}

async function persist() {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(store), 'utf8'), cipher.final()]);
  const payload = Buffer.concat([Buffer.from('SHR1'), iv, cipher.getAuthTag(), encrypted]);
  if (pgPool) {
    await pgPool.query('INSERT INTO sahaara_encrypted_store (store_id, payload, updated_at) VALUES ($1, $2, now()) ON CONFLICT (store_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()', ['primary', payload]);
    return;
  }
  await mkdir(path.dirname(STORE), { recursive: true });
  const temp = `${STORE}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, payload, { mode: 0o600 });
  const { rename } = await import('node:fs/promises');
  await rename(temp, STORE);
}
async function loadStore() {
  try {
    const row = pgPool ? (await pgPool.query('SELECT payload FROM sahaara_encrypted_store WHERE store_id = $1', ['primary'])).rows[0] : null;
    if (pgPool && !row) return;
    const buf = row ? Buffer.from(row.payload) : await readFile(STORE);
    if (buf.subarray(0, 4).toString() !== 'SHR1') throw new Error('Unknown data format.');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, buf.subarray(4, 16));
    decipher.setAuthTag(buf.subarray(16, 32));
    store = JSON.parse(Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()]).toString('utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('Could not read or decrypt stored data. Check the database connection and keep the same DATA_ENCRYPTION_KEY used when the data was created.');
  }
}
const cleanUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt });
const now = () => new Date().toISOString();
const safeEmail = value => String(value || '').trim().toLowerCase().slice(0, 160);
function audit(action, actor, subject = '') { store.audit.unshift({ id: randomBytes(8).toString('hex'), action, actor, subject, at: now() }); store.audit = store.audit.slice(0, 5000); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf('='); return [s.slice(0, i), decodeURIComponent(s.slice(i + 1) || '')]; })); }
function currentUser(req) { const token = cookies(req)[COOKIE]; const entry = token && sessions.get(sessionHash(token)); if (!entry || entry.expiresAt <= Date.now()) { if (token) sessions.delete(sessionHash(token)); return null; } return store.users.find(u => u.id === entry.id && u.status === 'active') || null; }
function send(res, status, value, headers = {}) { const data = Buffer.from(JSON.stringify(value)); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': data.length, ...headers }); res.end(data); }
function page(res) { return readFile(path.join(ROOT, 'index.html')).then(data => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }); res.end(data); }); }
async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 32768) throw Object.assign(new Error('Request too large.'), { status: 413 }); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
const authFail = res => send(res, 401, { error: 'Please sign in to continue.' });
function stressResult(c) {
  const pct = v => (Number(v) - 1) * 25;
  const sleep = Number(c.sleepHours);
  const sleepLoad = sleep <= 4 ? 100 : sleep <= 5 ? 80 : sleep <= 6 ? 60 : sleep <= 7 ? 40 : sleep <= 8 ? 20 : 15;
  const shiftLoad = { day: 20, evening: 40, night: 75, rotating: 85 }[c.shiftPattern] ?? 50;
  const parts = [
    { key: 'feltStress', label: 'Perceived stress', value: pct(c.feltStress), weight: .20 },
    { key: 'fatigue', label: 'Fatigue', value: pct(c.fatigue), weight: .12 },
    { key: 'sleepHours', label: 'Sleep duration', value: sleepLoad, weight: .10 },
    { key: 'sleepQuality', label: 'Sleep quality', value: 100 - pct(c.sleepQuality), weight: .08 },
    { key: 'workload', label: 'Workload strain', value: pct(c.workload), weight: .12 },
    { key: 'mood', label: 'Low mood', value: 100 - pct(c.mood), weight: .10 },
    { key: 'support', label: 'Low support', value: 100 - pct(c.support), weight: .08 },
    { key: 'shiftPattern', label: 'Shift disruption', value: shiftLoad, weight: .06 },
    { key: 'recovery', label: 'Limited recovery', value: 100 - pct(c.recovery), weight: .06 },
    { key: 'eventImpact', label: 'Difficult experiences weighing on you', value: pct(c.eventImpact), weight: .04 },
    { key: 'physicalStrain', label: 'Physical strain', value: pct(c.physicalStrain), weight: .04 }
  ];
  const score = Math.round(parts.reduce((s, p) => s + p.value * p.weight, 0));
  const band = score < 34 ? 'Steady' : score < 60 ? 'Elevated' : 'High strain';
  const tips = [];
  if (sleep <= 5 || c.sleepQuality <= 2 || c.shiftPattern === 'night' || c.shiftPattern === 'rotating') tips.push('If your schedule allows, protect a recovery window after disrupted sleep or night shifts.');
  if (c.workload >= 4) tips.push('Consider discussing workload pacing or a short recovery break with someone you trust.');
  if (c.support <= 2) tips.push('You marked limited support; consider contacting a trusted peer or confidential support professional.');
  if (c.eventImpact >= 4) tips.push('If difficult experiences keep weighing on you, a confidential conversation with a qualified professional may help.');
  if (c.fatigue >= 4 || c.physicalStrain >= 4) tips.push('Make space for physical recovery; seek qualified care if fatigue or discomfort persists.');
  const next = tips.length ? tips.slice(0, 2).join(' ') : score < 34 ? 'Keep protecting recovery time and check in again when useful.' : score < 60 ? 'Consider a recovery break and choose someone you trust to talk with.' : 'Consider contacting a confidential wellbeing professional or trusted support person soon.';
  return { score, band, next, parts: parts.map(({ key, label, value, weight }) => ({ key, label, value: Math.round(value), weight })) };
}
function normalizeCheckin(x) {
  const n = (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null;
  const result = { feltStress: n(x.feltStress, 1, 5), fatigue: n(x.fatigue, 1, 5), sleepHours: Number(x.sleepHours), sleepQuality: n(x.sleepQuality, 1, 5), workload: n(x.workload, 1, 5), mood: n(x.mood, 1, 5), support: n(x.support, 1, 5), shiftPattern: ['day', 'evening', 'night', 'rotating'].includes(x.shiftPattern) ? x.shiftPattern : null, recovery: n(x.recovery, 1, 5), eventImpact: n(x.eventImpact, 1, 5), physicalStrain: n(x.physicalStrain, 1, 5), note: String(x.note || '').trim().slice(0, 500) };
  if (Object.entries(result).some(([k, v]) => !['note'].includes(k) && (!Number.isFinite(v) || v === null)) || result.sleepHours < 0 || result.sleepHours > 16) throw Object.assign(new Error('Please review each rating, shift-pattern and sleep-hours field.'), { status: 400 });
  return result;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/') return await page(res);
    if (req.method === 'GET' && url.pathname === '/app.js') {
      const js = await readFile(path.join(ROOT, 'app.js'));
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(js); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { aiAvailable: Boolean(process.env.MISTRAL_API_KEY), demoConfig, aiModel: process.env.MISTRAL_MODEL || 'mistral-small-2603' });
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const b = await body(req); const name = String(b.name || '').trim().slice(0, 80); const email = safeEmail(b.email); const password = String(b.password || ''); const role = b.role;
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || !['personnel', 'clinician', 'admin'].includes(role)) return send(res, 400, { error: 'Enter a name, valid email, password of at least 12 characters, and account type.' });
      if (role === 'admin' && (!process.env.ADMIN_INVITE_CODE || b.adminInviteCode !== process.env.ADMIN_INVITE_CODE)) return send(res, 403, { error: 'Admin account creation requires the configured invitation code.' });
      if (store.users.some(u => u.email === email)) return send(res, 409, { error: 'An account already exists for this email.' });
      const salt = randomBytes(16); const hash = await scrypt(password, salt, 64); const user = { id: randomBytes(16).toString('hex'), name, email, role, salt: salt.toString('hex'), passwordHash: hash.toString('hex'), createdAt: now(), status: 'active' };
      store.users.push(user); audit('Account created', user.id, role); await persist();
      const token = randomBytes(32).toString('base64url'); sessions.set(sessionHash(token), { id: user.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      return send(res, 201, { user: cleanUser(user), demoConfig }, { 'Set-Cookie': `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const b = await body(req); const email = safeEmail(b.email); const user = store.users.find(u => u.email === email && u.status === 'active');
      if (!user || !['personnel', 'clinician', 'admin'].includes(user.role)) return send(res, 401, { error: 'Email or password was not recognized.' });
      const hash = await scrypt(String(b.password || ''), Buffer.from(user.salt, 'hex'), 64);
      if (!timingSafeEqual(hash, Buffer.from(user.passwordHash, 'hex'))) return send(res, 401, { error: 'Email or password was not recognized.' });
      const token = randomBytes(32).toString('base64url'); sessions.set(sessionHash(token), { id: user.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 }); audit('Signed in', user.id); await persist();
      return send(res, 200, { user: cleanUser(user), demoConfig }, { 'Set-Cookie': `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = cookies(req)[COOKIE]; if (token) sessions.delete(sessionHash(token));
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }
    const user = currentUser(req); if (!user) return authFail(res);
    if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { user: cleanUser(user), demoConfig });
    if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
      if (user.role !== 'admin') return send(res, 403, { error: 'Admin account required.' });
      const cutoff = Date.now() - 30 * 86400000;
      const recent = store.checkins.filter(c => Date.parse(c.createdAt) >= cutoff);
      const latest = new Map();
      for (const c of recent.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set(c.userId, c);
      if (latest.size < 10) return send(res, 200, { available: false, message: 'Anonymous trends are hidden until at least 10 people have contributed in this period.' });
      const rows = [...latest.values()];
      const average = Math.round(rows.reduce((sum, c) => sum + c.result.score, 0) / rows.length);
      const bands = { steady: rows.filter(c => c.result.score < 34).length, elevated: rows.filter(c => c.result.score >= 34 && c.result.score < 60).length, highStrain: rows.filter(c => c.result.score >= 60).length };
      const factors = {};
      for (const c of rows) for (const f of c.result.parts) factors[f.label] = (factors[f.label] || 0) + f.value;
      for (const k of Object.keys(factors)) factors[k] = Math.round(factors[k] / rows.length);
      audit('Admin viewed de-identified aggregate wellbeing trends', user.id); await persist();
      return send(res, 200, { available: true, contributingMembers: rows.length, averageSignal: average, bands, factors });
    }
    if (req.method === 'GET' && url.pathname === '/api/checkins') {
      if (user.role !== 'personnel') return send(res, 403, { error: 'Personal check-ins are visible only to the member and clinicians they explicitly authorize.' });
      return send(res, 200, { checkins: store.checkins.filter(c => c.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
    }
    if (req.method === 'POST' && url.pathname === '/api/checkins') {
      if (user.role !== 'personnel') return send(res, 403, { error: 'Only personnel can create personal check-ins.' });
      const c = normalizeCheckin(await body(req)); const result = stressResult(c);
      const saved = { id: randomBytes(12).toString('hex'), userId: user.id, ...c, result, createdAt: now() };
      store.checkins.push(saved); audit('Personal check-in saved', user.id, saved.id); await persist();
      return send(res, 201, { checkin: saved });
    }
    if (req.method === 'GET' && url.pathname === '/api/consents') {
      if (user.role !== 'personnel') return send(res, 403, { error: 'Only personnel can manage personal sharing.' });
      const list = store.consents.filter(c => c.personId === user.id && !c.revokedAt).map(c => ({ id: c.id, clinicianEmail: store.users.find(u => u.id === c.clinicianId)?.email, clinicianName: store.users.find(u => u.id === c.clinicianId)?.name, grantedAt: c.grantedAt, aiAllowed: c.aiAllowed === true }));
      return send(res, 200, { consents: list });
    }
    if (req.method === 'POST' && url.pathname === '/api/consents') {
      if (user.role !== 'personnel') return send(res, 403, { error: 'Only personnel can authorize a clinician.' });
      const b = await body(req); const email = safeEmail(b.clinicianEmail); const clinician = store.users.find(u => u.email === email && u.role === 'clinician' && u.status === 'active');
      if (!clinician || clinician.id === user.id) return send(res, 404, { error: 'No active clinician account was found for that email.' });
      let consent = store.consents.find(c => c.personId === user.id && c.clinicianId === clinician.id);
      if (!consent) { consent = { id: randomBytes(12).toString('hex'), personId: user.id, clinicianId: clinician.id, grantedAt: now(), revokedAt: null, aiAllowed: b.aiAllowed === true }; store.consents.push(consent); }
      else { consent.grantedAt = now(); consent.revokedAt = null; consent.aiAllowed = b.aiAllowed === true; }
      audit('Member granted clinician access', user.id, clinician.id); await persist(); return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/consents/')) {
      if (user.role !== 'personnel') return send(res, 403, { error: 'Only personnel can revoke personal sharing.' });
      const consent = store.consents.find(c => c.id === url.pathname.split('/').pop() && c.personId === user.id && !c.revokedAt);
      if (!consent) return send(res, 404, { error: 'Active consent not found.' });
      consent.revokedAt = now(); audit('Member revoked clinician access', user.id, consent.clinicianId); await persist(); return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/doctor/people') {
      if (user.role !== 'clinician') return send(res, 403, { error: 'Clinician account required.' });
      const ids = new Set(store.consents.filter(c => c.clinicianId === user.id && !c.revokedAt).map(c => c.personId));
      const people = store.users.filter(u => ids.has(u.id)).map(p => ({ id: p.id, name: p.name, email: p.email, count: store.checkins.filter(c => c.userId === p.id).length }));
      return send(res, 200, { people });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/doctor/person/')) {
      if (user.role !== 'clinician') return send(res, 403, { error: 'Clinician account required.' });
      const id = url.pathname.split('/').pop(); const consent = store.consents.find(c => c.personId === id && c.clinicianId === user.id && !c.revokedAt);
      if (!consent) return send(res, 403, { error: 'The member has not shared their history with you.' });
      const person = store.users.find(u => u.id === id && u.role === 'personnel');
      if (!person) return send(res, 404, { error: 'Member not found.' });
      audit('Clinician viewed shared check-ins', user.id, id); await persist();
      return send(res, 200, { person: { name: person.name, email: person.email }, aiSummaryAllowed: consent.aiAllowed === true, checkins: store.checkins.filter(c => c.userId === id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/doctor/person/') && url.pathname.endsWith('/ai-summary')) {
      if (user.role !== 'clinician') return send(res, 403, { error: 'Clinician account required.' });
      if (!process.env.MISTRAL_API_KEY) return send(res, 503, { error: 'Mistral suggestions are not configured on this local server.' });
      const id = url.pathname.split('/')[4];
      const consent = store.consents.find(c => c.personId === id && c.clinicianId === user.id && !c.revokedAt && c.aiAllowed === true);
      if (!consent) return send(res, 403, { error: 'The member has not separately consented to an external Mistral summary.' });
      const data = store.checkins.filter(c => c.userId === id).slice(-7).map(c => ({ stress: c.feltStress, fatigue: c.fatigue, sleepHours: c.sleepHours, sleepQuality: c.sleepQuality, workload: c.workload, mood: c.mood, support: c.support, shiftPattern: c.shiftPattern, recovery: c.recovery, eventImpact: c.eventImpact, physicalStrain: c.physicalStrain, signal: c.result.band }));
      if (!data.length) return send(res, 400, { error: 'The member has no saved check-ins.' });
      const prompt = `Summarize these de-identified, self-reported wellbeing factors from up to seven check-ins for a qualified clinician who is already supporting the member: ${JSON.stringify(data)}. Use neutral, non-diagnostic wording. Describe only observed changes and possible discussion topics. Do not infer diagnosis, duty fitness, operational risk, or cause. Avoid treatment recommendations; invite clinical judgment and member discussion. No name, email, notes, rank, assignment or operational details are included. Keep under 120 words.`;
      try {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.MISTRAL_MODEL || 'mistral-small-2603', messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 180 }), signal: AbortSignal.timeout(25000) });
        const answer = await response.json();
        if (!response.ok) return send(res, 502, { error: 'Mistral could not complete this summary.' });
        audit('Clinician requested a consented de-identified AI summary', user.id, id); await persist();
        return send(res, 200, { summary: answer.choices?.[0]?.message?.content || 'No summary was returned.' });
      } catch { return send(res, 502, { error: 'Could not reach Mistral.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/ai-advice') {
      if (user.role !== 'personnel') return send(res, 403, { error: 'AI suggestions are available in the personal wellbeing view.' });
      if (!process.env.MISTRAL_API_KEY) return send(res, 503, { error: 'AI suggestions are not configured yet. Add a MISTRAL_API_KEY to the local .env file.' });
      const b = await body(req); if (b.aiConsent !== true) return send(res, 400, { error: 'Please confirm that you want to send de-identified check-in factors to Mistral for this suggestion.' });
      const data = store.checkins.filter(c => c.userId === user.id).slice(-7).map(c => ({ stress: c.feltStress, fatigue: c.fatigue, sleepHours: c.sleepHours, sleepQuality: c.sleepQuality, workload: c.workload, mood: c.mood, support: c.support, shiftPattern: c.shiftPattern, recovery: c.recovery, eventImpact: c.eventImpact, physicalStrain: c.physicalStrain, signal: c.result.band }));
      if (!data.length) return send(res, 400, { error: 'Complete a check-in first.' });
      const prompt = `Offer a short, compassionate, non-clinical wellbeing reflection for a uniformed service member using only these de-identified self-reported numeric check-in factors from up to seven entries: ${JSON.stringify(data)}. Do not infer diagnosis, operational fitness, duty eligibility, or risk to others. Do not claim validated prediction. Give 2-3 practical, low-risk recovery ideas and invite the person to speak with a qualified professional if distress persists. If a response suggests immediate danger, advise contacting local emergency services or a trusted crisis professional. Do not mention military intelligence, deployments, unit, rank, names, or request sensitive operational details. Keep under 130 words.`;
      try {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.MISTRAL_MODEL || 'mistral-small-2603', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 220 }), signal: AbortSignal.timeout(25000) });
        const answer = await response.json();
        if (!response.ok) return send(res, 502, { error: 'Mistral could not complete the request. Check the server key and model configuration.' });
        audit('Member requested AI reflection (de-identified factors sent to Mistral)', user.id); await persist();
        return send(res, 200, { advice: answer.choices?.[0]?.message?.content || 'No suggestion was returned.', model: process.env.MISTRAL_MODEL || 'mistral-small-2603' });
      } catch { return send(res, 502, { error: 'Could not reach the AI service. You can still use the local check-in suggestions.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/export') {
      if (user.role !== 'personnel') return send(res, 403, { error: 'Only personnel can export their own history.' });
      const checkins = store.checkins.filter(c => c.userId === user.id); audit('Member exported own history', user.id); await persist();
      return send(res, 200, { exportedAt: now(), member: { name: user.name, email: user.email }, checkins });
    }
    return send(res, 404, { error: 'Not found.' });
  } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : 'A server error occurred.' }); }
});

await loadStore();
server.listen(PORT, '127.0.0.1', () => console.log(`SAHAARA demo listening at http://127.0.0.1:${PORT}${demoConfig ? ' (demo-only keys; configure .env before real data)' : ''}`));
