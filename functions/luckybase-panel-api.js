'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const corsLib = require('cors');
const { onRequest } = require('firebase-functions/v2/https');

function getFirebaseProjectId() {
  const direct = String(
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    ''
  ).trim();
  if (direct) return direct;
  const firebaseConfigRaw = String(process.env.FIREBASE_CONFIG || '').trim();
  if (firebaseConfigRaw) {
    try {
      const parsed = JSON.parse(firebaseConfigRaw);
      const projectId = String(parsed && parsed.projectId ? parsed.projectId : '').trim();
      if (projectId) return projectId;
    } catch (_error) {}
  }
  return '';
}

if (!admin.apps.length) {
  const projectId = getFirebaseProjectId();
  if (projectId) {
    admin.initializeApp({ projectId });
  }
}
const db = () => admin.firestore();

const DEFAULT_EMAIL_BRIDGE_URL = 'https://script.google.com/macros/s/AKfycbyTfF_FCNBwdiMt5zLQJUoXh99KU6XHeTA-T2imouD5Nxr5ouf51RWDdZvQAGP9RO1_/exec';

const CFG = {
  appName: 'LuckyBase',
  supportEmail: String(process.env.LUCKYBASE_ADMIN_EMAIL || 'contacto@luckybase.es').trim().toLowerCase(),
  fallbackAdminEmail: String(process.env.LUCKYBASE_ADMIN_FALLBACK_EMAIL || 'luckybaseprin@gmail.com').trim().toLowerCase(),
  panelLoginUrl: String(process.env.LUCKYBASE_PANEL_LOGIN_URL || 'https://luckybase.es/login').trim(),
  logoUrl: String(process.env.LUCKYBASE_LOGO_URL || 'https://luckybase.es/LUCKYBASE%20logo%20letras.png').trim(),
  sessionSecret: String(process.env.LUCKYBASE_SESSION_SECRET || '').trim() || 'luckybase_session_secret_fallback',
  adminTokenSecret: String(process.env.LUCKYBASE_ADMIN_TOKEN_SECRET || '').trim() || 'luckybase_admin_token_secret_fallback',
  adminUser: String(process.env.LUCKYBASE_ADMIN_USER || '').trim(),
  adminPasswordHash: String(process.env.LUCKYBASE_ADMIN_PASSWORD_HASH || '').trim(),
  adminPasswordHashIterations: Math.max(1, Number.parseInt(process.env.LUCKYBASE_ADMIN_PASSWORD_HASH_ITERATIONS || '25000', 10) || 25000),
  sessionDurationMs: 8 * 60 * 60 * 1000,
  adminTokenDurationMs: 45 * 60 * 1000,
  clientLoginMaxAttempts: 3,
  clientLoginLockDurationMs: 15 * 60 * 1000,
  adminLoginMaxAttempts: 5,
  adminLoginLockDurationMs: 30 * 60 * 1000,
  emailBridgeUrl: String(process.env.APPS_SCRIPT_EMAIL_URL || DEFAULT_EMAIL_BRIDGE_URL).trim(),
  emailBridgeSecret: String(process.env.APPS_SCRIPT_EMAIL_SECRET || '').trim(),
  cloudflareToken: String(process.env.LUCKYBASE_CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '').trim(),
  cloudflareZoneName: String(process.env.LUCKYBASE_CLOUDFLARE_ZONE_NAME || process.env.CLOUDFLARE_ZONE_NAME || 'luckybase.es').trim(),
  cloudflareApiBaseUrl: String(process.env.LUCKYBASE_CLOUDFLARE_API_BASE_URL || 'https://api.cloudflare.com/client/v4').trim().replace(/\/+$/, ''),
};

const DEFAULT_ADMIN_USER = 'adminlucky12_?';
const DEFAULT_ADMIN_PASSWORD_HASH = 'sha256i$25000$8f6c1c9e4b2a7d5f0e1c3b9a6d4f2a10$kD7GcdTnuT0PEYc3EqiZrnTBX-8EGQJQCqsgZjzPR2s';

const cors = corsLib({
  origin(_origin, callback) {
    callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Lucky-Admin-Secret'],
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function safeText(value, max = 600, fallback = '') {
  const text = String(value == null ? fallback : value);
  return max > 0 ? text.slice(0, max) : text;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(res, status, payload) {
  res.status(status).set('Content-Type', 'application/json; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  return res.status(status).send(JSON.stringify(payload));
}

function randomId(prefix = '') {
  return String(prefix || '') + crypto.randomBytes(16).toString('hex');
}

function hmacBase64Url(secret, text) {
  return crypto.createHmac('sha256', String(secret || '')).update(String(text || '')).digest('base64url');
}

function iterativeSha256Base64Url(value, salt, iterations) {
  const rounds = Math.max(1, Number(iterations) || 1);
  let buffer = `${String(salt || '')}|${String(value || '')}`;
  for (let i = 0; i < rounds; i += 1) {
    buffer = crypto.createHash('sha256').update(buffer, 'utf8').digest('base64url');
  }
  return buffer;
}

function createPasswordHash(plainPassword) {
  const salt = `${crypto.randomBytes(16).toString('hex')}${crypto.randomBytes(16).toString('hex')}`;
  const hash = iterativeSha256Base64Url(plainPassword, salt, CFG.adminPasswordHashIterations);
  return `sha256i$${CFG.adminPasswordHashIterations}$${salt}$${hash}`;
}

function verifyPasswordHash(plainPassword, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'sha256i') return false;
  const iterations = Number(parts[1]);
  const salt = String(parts[2] || '');
  const expected = String(parts[3] || '');
  if (!Number.isFinite(iterations) || iterations <= 0 || !salt || !expected) return false;
  const computed = iterativeSha256Base64Url(plainPassword, salt, iterations);
  return safeTimingEqual(computed, expected);
}

function safeTimingEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createSessionToken(usuario, sessionId, expiresAtMs) {
  const payload = `${usuario}|${sessionId}|${expiresAtMs}`;
  const sig = hmacBase64Url(CFG.sessionSecret, payload);
  return `lb1.${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

function verifySessionToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'lb1') return { valid: false, error: 'INVALID_TOKEN' };
  let payload = '';
  try {
    payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch (_err) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }
  const expected = hmacBase64Url(CFG.sessionSecret, payload);
  if (!safeTimingEqual(expected, parts[2])) return { valid: false, error: 'INVALID_TOKEN' };
  const [usuario, sessionId, expiresAtRaw] = payload.split('|');
  const expiresAtMs = Number(expiresAtRaw);
  if (!usuario || !sessionId || !Number.isFinite(expiresAtMs)) return { valid: false, error: 'INVALID_TOKEN' };
  return { valid: true, usuario, sessionId, expiresAtMs };
}

function createAdminToken(username, expiresAtMs) {
  const payload = `${username}|${expiresAtMs}|${randomId('adm_')}`;
  const sig = hmacBase64Url(CFG.adminTokenSecret, payload);
  return `adm1.${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

function verifyAdminToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  const decodePayload = (payloadPart) => {
    try {
      return Buffer.from(payloadPart, 'base64url').toString('utf8');
    } catch (_err) {
      return '';
    }
  };
  const verifySignature = (payloadPart, signaturePart) => {
    const expected = hmacBase64Url(CFG.adminTokenSecret, payloadPart);
    return safeTimingEqual(expected, signaturePart);
  };

  if (parts.length === 3 && parts[0] === 'adm1') {
    const payload = decodePayload(parts[1]);
    if (!payload || !verifySignature(payload, parts[2])) return { valid: false, error: 'INVALID_TOKEN' };
    const [username, expiresAtRaw] = payload.split('|');
    const expiresAtMs = Number(expiresAtRaw);
    if (!username || !Number.isFinite(expiresAtMs)) return { valid: false, error: 'INVALID_TOKEN' };
    if (Date.now() >= expiresAtMs) return { valid: false, error: 'TOKEN_EXPIRED' };
    return { valid: true, username, expiresAtMs };
  }

  if (parts.length === 2) {
    const payload = decodePayload(parts[0]);
    if (!payload || !verifySignature(parts[0], parts[1])) return { valid: false, error: 'INVALID_TOKEN' };

    try {
      const parsed = JSON.parse(payload);
      const username = String(parsed.u || parsed.username || '').trim();
      const expiresAtMs = Number(parsed.e || parsed.expiresAt || 0);
      const role = String(parsed.r || parsed.role || '').trim();
      if (!username || role !== 'admin' || !Number.isFinite(expiresAtMs)) return { valid: false, error: 'INVALID_TOKEN' };
      if (Date.now() >= expiresAtMs) return { valid: false, error: 'TOKEN_EXPIRED' };
      return { valid: true, username, expiresAtMs };
    } catch (_err) {
      return { valid: false, error: 'INVALID_TOKEN' };
    }
  }

  return { valid: false, error: 'INVALID_TOKEN' };
}

function normalizeBillingPeriodicity(value, fallback = 'mensual') {
  const key = normalizeKey(value);
  if (key === 'anual' || key === 'annual' || key === 'yearly' || key === 'year' || key === '12m') return 'anual';
  if (key === 'mensual' || key === 'monthly' || key === 'month' || key === '1m') return 'mensual';
  return fallback === 'anual' ? 'anual' : 'mensual';
}

function parseEuroAmount(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const compact = raw.replace(/\s/g, '').replace(/€/g, '');
  const normalized = compact.includes(',') ? compact.replace(/\./g, '').replace(/,/g, '.') : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatEuroAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toFixed(2).replace('.', ',') + '€';
}

function getPlanDefaults(plan, tipoplan) {
  const tipo = normalizeKey(tipoplan || 'LuckyWeb');
  const planKey = normalizeKey(plan);
  if (tipo === 'luckyauto') {
    if (planKey === 'pro') return { cuota: '30,00€', consultas: 'Ilimitadas', precioInicial: '350,00€' };
    if (planKey === 'lucky') return { cuota: '60,00€', consultas: 'Ilimitadas', precioInicial: '650,00€' };
    return { cuota: '15,00€', consultas: 'Ilimitadas', precioInicial: '120,00€' };
  }
  if (planKey === 'corporativa') return { cuota: '5,50€', consultas: 'Ilimitadas', precioInicial: '0,00€' };
  if (planKey === 'ecommerce') return { cuota: '20,00€', consultas: 'Ilimitadas', precioInicial: '0,00€' };
  return { cuota: '3,50€', consultas: '5', precioInicial: '0,00€' };
}

function resolveBillingFromMonthlyCuota(cuotaInput, periodicidadInput) {
  const amount = parseEuroAmount(cuotaInput);
  const periodicidad = normalizeBillingPeriodicity(periodicidadInput, 'mensual');
  if (!Number.isFinite(amount) || amount <= 0) {
    return { cuota: '3,50€', periodicidad, monthsInterval: periodicidad === 'anual' ? 12 : 1 };
  }
  return { cuota: formatEuroAmount(amount), periodicidad, monthsInterval: periodicidad === 'anual' ? 12 : 1 };
}

function addMonthsPreservingDay(dateValue, months) {
  const base = new Date(dateValue);
  const result = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()));
  if (result.getUTCDate() !== base.getUTCDate()) result.setUTCDate(0);
  return result;
}

function startOfDay(dateValue) {
  const d = new Date(dateValue);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDateISO(dateValue) {
  const d = new Date(dateValue);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseDateFlexible(value) {
  const ts = Date.parse(String(value || ''));
  if (Number.isFinite(ts)) return new Date(ts);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    const [y, m, d] = String(value).split('-').map((n) => Number(n));
    return new Date(Date.UTC(y, m - 1, d));
  }
  return null;
}

function parseBoolean(value) {
  const key = normalizeKey(value);
  return key === 'true' || key === '1' || key === 'si' || key === 'yes' || key === 'on';
}

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 0) return 'correo no disponible';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const maskedLocal = local.length <= 2 ? `${local.charAt(0)}*` : `${local.charAt(0)}***${local.charAt(local.length - 1)}`;
  return `${maskedLocal}@${domain}`;
}

function createRandomClientPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%*+-_?';
  const all = upper + lower + digits + symbols;
  const pick = (pool) => pool.charAt(Math.floor(Math.random() * pool.length));
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function buildClientNotificationKey(type, data) {
  const base = [type, data.usuario || '', data.email || '', data.npedido || '', data.rowIndex || ''].join('|');
  return hmacBase64Url(CFG.adminTokenSecret, base).slice(0, 24);
}

function getReplyTemplates(scope) {
  if (String(scope || '').trim().toLowerCase() === 'auto') {
    return [
      { id: '', label: 'Sin plantilla', text: '' },
      { id: 'ack', label: 'Recepción automatización', text: 'Hemos recibido tu solicitud de automatización y la vamos a revisar.' },
      { id: 'need_steps', label: 'Pedir trigger/datos', text: 'Necesitamos el trigger, el origen de datos y el resultado esperado para continuar.' },
      { id: 'done', label: 'Flujo actualizado', text: 'El ajuste en la automatización está aplicado. Por favor revisa el resultado.' },
    ];
  }
  return [
    { id: '', label: 'Sin plantilla', text: '' },
    { id: 'ack', label: 'Acuse de recibo', text: 'Hemos recibido tu solicitud y ya estamos trabajando en ello.' },
    { id: 'need_info', label: 'Solicitar más datos', text: 'Necesitamos más información para avanzar: capturas, URL exacta y pasos de reproducción.' },
    { id: 'done', label: 'Confirmación de resolución', text: 'Hemos aplicado los cambios solicitados. Revisa y confirma si todo está correcto.' },
  ];
}

async function getConfigDoc() {
  const ref = db().collection('lbConfig').doc('runtime');
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : {};
  const next = {
    appName: CFG.appName,
    adminUser: String(existing.adminUser || CFG.adminUser || '').trim(),
    adminPasswordHash: String(existing.adminPasswordHash || CFG.adminPasswordHash || '').trim(),
    adminEmail: String(existing.adminEmail || CFG.supportEmail || '').trim().toLowerCase(),
    fallbackAdminEmail: String(existing.fallbackAdminEmail || CFG.fallbackAdminEmail || '').trim().toLowerCase(),
    cloudflareToken: String(existing.cloudflareToken || CFG.cloudflareToken || '').trim(),
    cloudflareZoneName: String(existing.cloudflareZoneName || CFG.cloudflareZoneName || 'luckybase.es').trim(),
    cloudflareApiBaseUrl: String(existing.cloudflareApiBaseUrl || CFG.cloudflareApiBaseUrl || 'https://api.cloudflare.com/client/v4').trim(),
    updatedAt: nowIso(),
  };
  if (!snap.exists || !existing.adminUser || !existing.adminPasswordHash) {
    await ref.set(next, { merge: true });
  }
  return next;
}

async function sendEmail(payload) {
  const to = String(payload && payload.to || '').trim();
  if (!to || !CFG.emailBridgeUrl) return { sent: false, error: 'NO_EMAIL_BRIDGE' };
  try {
    const response = await fetch(CFG.emailBridgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(CFG.emailBridgeSecret ? { 'X-LuckyBase-Email-Secret': CFG.emailBridgeSecret } : {}),
      },
      body: JSON.stringify({
        to,
        subject: String(payload.subject || '').trim(),
        name: String(payload.name || CFG.appName).trim(),
        replyTo: String(payload.replyTo || CFG.supportEmail).trim(),
        htmlBody: String(payload.htmlBody || ''),
        body: String(payload.body || ''),
      }),
    });
    if (!response.ok) return { sent: false, error: `HTTP_${response.status}` };
    const jsonBody = await response.json().catch(() => ({}));
    return { sent: jsonBody && jsonBody.success !== false, error: jsonBody && jsonBody.error ? String(jsonBody.error) : '' };
  } catch (error) {
    return { sent: false, error: String(error && error.message ? error.message : error || 'SEND_FAILED') };
  }
}

async function appendAuditEvent(event) {
  const ref = db().collection('lbAuditLog').doc();
  await ref.set({
    event_id: ref.id,
    event_type: String(event.eventType || ''),
    entity_type: String(event.entityType || ''),
    entity_id: String(event.entityId || ''),
    actor_role: String(event.actorRole || ''),
    actor_user: String(event.actorUser || ''),
    details_json: JSON.stringify(event.details || {}),
    created_at: String(event.createdAt || nowIso()),
  }, { merge: true });
}

async function appendOnboardingLog(payload) {
  const key = String(payload.key || '');
  if (!key) return;
  await db().collection('lbOnboardingLog').doc(key).set({
    key,
    notification_type: String(payload.notificationType || ''),
    panel_state: String(payload.panelState || ''),
    usuario: String(payload.usuario || ''),
    email: String(payload.email || ''),
    sent_at: String(payload.sentAt || nowIso()),
    row_index: Number(payload.rowIndex || 0),
    source: String(payload.source || ''),
    client_send_ok: !!payload.clientSendOk,
    admin_send_ok: !!payload.adminSendOk,
    error: String(payload.error || ''),
  }, { merge: true });
}

async function createSession(usuario, sessionIp = '') {
  const now = Date.now();
  const expiresAtMs = now + CFG.sessionDurationMs;
  const sessionId = randomId('sess_');
  const token = createSessionToken(usuario, sessionId, expiresAtMs);
  await db().collection('lbSessions').doc(sessionId).set({
    session_id: sessionId,
    usuario,
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
    status: 'active',
    last_seen_at: new Date(now).toISOString(),
    last_seen_ip: String(sessionIp || ''),
  }, { merge: true });
  return { sessionId, token, expiresAtMs };
}

async function touchSession(sessionId, sessionIp = '') {
  await db().collection('lbSessions').doc(sessionId).set({
    last_seen_at: nowIso(),
    last_seen_ip: String(sessionIp || ''),
  }, { merge: true });
}

async function getSessionRecord(sessionId) {
  const snap = await db().collection('lbSessions').doc(sessionId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function revokeSession(sessionId) {
  await db().collection('lbSessions').doc(sessionId).set({ status: 'revoked', last_seen_at: nowIso() }, { merge: true });
}

async function revokeUserSessions(usuario, keepSessionId = '') {
  const snap = await db().collection('lbSessions').where('usuario', '==', String(usuario || '')).get();
  let revokedCount = 0;
  for (const doc of snap.docs) {
    if (keepSessionId && doc.id === keepSessionId) continue;
    await doc.ref.set({ status: 'revoked', last_seen_at: nowIso() }, { merge: true });
    revokedCount += 1;
  }
  return revokedCount;
}


async function findTicketById(ticketId) {
  const snap = await db().collection('lbTickets').doc(ticketId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function getTicketMessages(ticketId, limit = 80) {
  const snap = await db().collection('lbTickets').doc(ticketId).collection('messages').orderBy('created_at', 'asc').limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function appendTicketMessage(ticketId, message) {
  const ref = db().collection('lbTickets').doc(ticketId).collection('messages').doc();
  await ref.set({
    message_id: ref.id,
    ticket_id: ticketId,
    sender_role: String(message.senderRole || ''),
    sender_user: String(message.senderUser || ''),
    sender_email: String(message.senderEmail || ''),
    message: String(message.message || ''),
    created_at: String(message.createdAt || nowIso()),
  }, { merge: true });
}

async function updateTicket(ticketId, patch) {
  await db().collection('lbTickets').doc(ticketId).set({ ...patch, updated_at: String(patch.updatedAt || nowIso()) }, { merge: true });
}

async function listClientPlanDocs(usuarioKey) {
  const key = normalizeKey(usuarioKey);
  if (!key) return [];
  const [subSnap, topSnap] = await Promise.all([
    db().collection('lbClients').doc(key).collection('plans').get().catch(() => ({ docs: [] })),
    db().collection('lbPlans').where('usuarioKey', '==', key).get().catch(() => ({ docs: [] })),
  ]);
  const byPlanId = new Map();
  const collect = (snap) => {
    for (const doc of snap.docs || []) {
      const data = doc.data() || {};
      const planId = String(data.planId || data.npedido || doc.id || '').trim();
      const dedupeKey = planId || doc.id;
      if (!dedupeKey || byPlanId.has(dedupeKey)) continue;
      byPlanId.set(dedupeKey, { id: doc.id, ...data });
    }
  };
  collect(subSnap);
  collect(topSnap);
  return Array.from(byPlanId.values()).sort((a, b) => {
    const aTime = Date.parse(String(a.createdAt || a.created_at || '')) || 0;
    const bTime = Date.parse(String(b.createdAt || b.created_at || '')) || 0;
    return bTime - aTime;
  });
}

function buildClientPayloadFromPlanDoc(planDoc) {
  const plan = planDoc || {};
  return {
    rowIndex: Number(plan.rowIndex || 0),
    usuario: String(plan.usuario || '').trim(),
    nombre: String(plan.nombre || '').trim(),
    email: String(plan.email || '').trim(),
    plan: String(plan.plan || '-').trim() || '-',
    tipoplan: String(plan.tipoplan || '').trim(),
    cuota: String(plan.cuota || '').trim(),
    periodicidad: normalizeBillingPeriodicity(plan.periodicidad, 'mensual'),
    consultasocambiosrestantes: String(plan.consultasocambiosrestantes || '').trim(),
    pagado: String(plan.pagado || '-').trim() || '-',
    fealta: String(plan.fealta || '-').trim() || '-',
    proxpago: String(plan.proxpago || '-').trim() || '-',
    dominio: String(plan.dominio || '-').trim() || '-',
    domprov: String(plan.domprov || '').trim(),
    npedido: String(plan.npedido || '').trim(),
    panel: String(plan.panel || '').trim(),
    flujosactivos: String(plan.flujosactivos || '').trim(),
    flujosinactivos: String(plan.flujosinactivos || '').trim(),
    planId: String(plan.planId || plan.npedido || plan.id || '').trim(),
    createdAt: String(plan.createdAt || ''),
    updatedAt: String(plan.updatedAt || ''),
  };
}

async function getAccountDoc(usuarioKey) {
  const snap = await db().collection('lbClients').doc(usuarioKey).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function getAccountByUserOrEmail(usuarioInput, emailInput = '') {
  const usuarioKey = normalizeKey(usuarioInput);
  if (usuarioKey) {
    const account = await getAccountDoc(usuarioKey);
    if (account) return { usuarioKey, account };
  }
  const email = String(emailInput || '').trim().toLowerCase();
  if (!email) return { usuarioKey: '', account: null };
  const snap = await db().collection('lbClients').where('emailLower', '==', email).limit(1).get();
  if (snap.empty) return { usuarioKey: '', account: null };
  const doc = snap.docs[0];
  return { usuarioKey: doc.id, account: { id: doc.id, ...doc.data() } };
}

async function loadClientPortfolio(usuarioKey) {
  const account = await getAccountDoc(usuarioKey);
  if (!account) return null;
  const plans = await listClientPlanDocs(usuarioKey);
  const normalizedPlans = plans.map((plan, index) => {
    const payload = buildClientPayloadFromPlanDoc(plan);
    payload.planId = String(plan.planId || plan.npedido || plan.id || `plan_${index + 1}`);
    return payload;
  });
  const primaryPlanId = String(account.activePlanId || normalizedPlans[0]?.planId || '').trim();
  const active = normalizedPlans.find((plan) => String(plan.planId) === primaryPlanId) || normalizedPlans[0] || {};
  return {
    ...active,
    activePlanId: String(active.planId || ''),
    planes: normalizedPlans,
    totalPlanes: normalizedPlans.length,
    nombre: String(account.nombre || active.nombre || '').trim(),
    usuario: String(account.usuario || active.usuario || '').trim(),
    email: String(account.email || active.email || '').trim(),
  };
}

async function persistAccountAndPlan({ usuario, email, nombre, password, planData, existingPlanId = '' }) {
  const usuarioKey = normalizeKey(usuario);
  if (!usuarioKey) throw new Error('INVALID_USER');
  const accountRef = db().collection('lbClients').doc(usuarioKey);
  const now = nowIso();
  const accountSnap = await accountRef.get();
  const account = accountSnap.exists ? (accountSnap.data() || {}) : {};
  const planId = String(existingPlanId || planData.npedido || planData.planId || randomId('plan_')).trim();
  const passwordHash = String(password || '').trim() ? createPasswordHash(password) : String(account.passwordHash || '').trim();
  const nextAccount = {
    usuario,
    usuarioKey,
    email: String(email || account.email || '').trim().toLowerCase(),
    emailLower: String(email || account.email || '').trim().toLowerCase(),
    nombre: String(nombre || account.nombre || '').trim(),
    passwordHash,
    activePlanId: String(planId || account.activePlanId || ''),
    createdAt: String(account.createdAt || now),
    updatedAt: now,
  };
  await accountRef.set(nextAccount, { merge: true });
  const planRef = accountRef.collection('plans').doc(planId);
  const planMirrorRef = db().collection('lbPlans').doc(planId);
  const nextPlan = {
    planId,
    usuario,
    usuarioKey,
    email: nextAccount.email,
    nombre: nextAccount.nombre,
    ...planData,
    rowIndex: Number(planData.rowIndex || Date.now()),
    createdAt: String(planData.createdAt || account.createdAt || now),
    updatedAt: now,
  };
  await planRef.set(nextPlan, { merge: true });
  await planMirrorRef.set(nextPlan, { merge: true });
  return { accountRef, planRef, planMirrorRef, account: nextAccount, plan: nextPlan };
}

async function getTicketsSummary() {
  const snap = await db().collection('lbTickets').get();
  const summary = { totalTickets: snap.size, ticketsOpen: 0, ticketsInProgress: 0, ticketsResolved: 0, newTickets24h: 0, newTickets7d: 0, unresolvedTickets: 0 };
  const now = Date.now();
  for (const doc of snap.docs) {
    const ticket = doc.data() || {};
    const state = normalizeKey(ticket.estado);
    if (state === 'resuelto') summary.ticketsResolved += 1;
    else if (state === 'enproceso' || state === 'en_proceso') summary.ticketsInProgress += 1;
    else summary.ticketsOpen += 1;
    if (state !== 'resuelto') summary.unresolvedTickets += 1;
    const createdMs = Date.parse(String(ticket.created_at || ''));
    if (Number.isFinite(createdMs) && now - createdMs <= 24 * 60 * 60 * 1000) summary.newTickets24h += 1;
    if (Number.isFinite(createdMs) && now - createdMs <= 7 * 24 * 60 * 60 * 1000) summary.newTickets7d += 1;
  }
  return summary;
}

async function listAdminTicketSummaries(limit = 8) {
  const snap = await db().collection('lbTickets').orderBy('created_at', 'desc').limit(limit).get().catch(() => db().collection('lbTickets').limit(limit).get());
  return snap.docs.map((doc) => {
    const row = doc.data() || {};
    return {
      ticket_id: String(row.ticket_id || doc.id),
      asunto: String(row.asunto || ''),
      usuario: String(row.usuario || ''),
      created_at: String(row.created_at || ''),
      estado: String(row.estado || 'abierto'),
    };
  });
}

function mapTicketForClient(ticketDoc, messages = []) {
  const doc = ticketDoc || {};
  return {
    ticketId: String(doc.ticket_id || doc.id || ''),
    asunto: String(doc.asunto || ''),
    mensaje: String(doc.mensaje || ''),
    prioridad: String(doc.prioridad || 'media'),
    estado: String(doc.estado || 'abierto'),
    adminResponse: String(doc.admin_response || ''),
    adminUser: String(doc.admin_user || ''),
    assignedAdmin: String(doc.assigned_admin || ''),
    internalStatus: String(doc.internal_status || ''),
    createdAt: String(doc.created_at || ''),
    updatedAt: String(doc.updated_at || ''),
    respondedAt: String(doc.responded_at || ''),
    closedAt: String(doc.closed_at || ''),
    source: String(doc.source || ''),
    ticketPlanId: String(doc.ticket_plan_id || ''),
    ticketPlan: String(doc.ticket_plan || ''),
    ticketPlanType: String(doc.ticket_plan_type || ''),
    ticketPlanDomain: String(doc.ticket_plan_domain || ''),
    ticketPlanOrder: String(doc.ticket_plan_order || ''),
    messages: (Array.isArray(messages) ? messages : []).map((msg) => ({
      messageId: String(msg.message_id || msg.id || ''),
      ticketId: String(msg.ticket_id || ''),
      senderRole: String(msg.sender_role || ''),
      senderUser: String(msg.sender_user || ''),
      senderEmail: String(msg.sender_email || ''),
      message: String(msg.message || ''),
      createdAt: String(msg.created_at || ''),
    })),
  };
}

function getAlertSeverityRank(severity) {
  const key = normalizeKey(severity);
  if (key === 'alta') return 3;
  if (key === 'media') return 2;
  if (key === 'baja') return 1;
  return 0;
}

async function getAdminAuthConfig() {
  const cfg = await getConfigDoc();
  const adminUser = String(cfg.adminUser || CFG.adminUser || DEFAULT_ADMIN_USER || '').trim();
  const adminPasswordHash = String(cfg.adminPasswordHash || CFG.adminPasswordHash || DEFAULT_ADMIN_PASSWORD_HASH || '').trim();
  if (!adminUser || !adminPasswordHash) throw new Error('ADMIN_NOT_CONFIGURED');
  return { ...cfg, adminUser, adminPasswordHash };
}

async function getAdminLoginLockStatus(identity) {
  const ref = db().collection('lbConfig').doc(`admin_login_${normalizeKey(identity) || 'admin'}`);
  const snap = await ref.get();
  const state = snap.exists ? (snap.data() || {}) : {};
  const lockUntilMs = Number(state.lockUntilMs || 0);
  if (Number.isFinite(lockUntilMs) && lockUntilMs > Date.now()) {
    const retryAfterMs = lockUntilMs - Date.now();
    return { locked: true, retryAfterMs, retryMinutes: Math.max(1, Math.ceil(retryAfterMs / 60000)) };
  }
  return { locked: false, retryAfterMs: 0, retryMinutes: 0 };
}

async function registerFailedAdminLogin(identity) {
  const ref = db().collection('lbConfig').doc(`admin_login_${normalizeKey(identity) || 'admin'}`);
  const snap = await ref.get();
  const state = snap.exists ? (snap.data() || {}) : {};
  const failures = Number(state.failures || 0) + 1;
  const lockedNow = failures >= CFG.adminLoginMaxAttempts;
  const lockUntilMs = lockedNow ? Date.now() + CFG.adminLoginLockDurationMs : Number(state.lockUntilMs || 0);
  await ref.set({ failures, lockUntilMs, lastFailedAtMs: Date.now() }, { merge: true });
  return { failures, lockedNow };
}

async function clearAdminLoginState(identity) {
  await db().collection('lbConfig').doc(`admin_login_${normalizeKey(identity) || 'admin'}`).delete().catch(() => {});
}

async function getClientLoginLockStatus(usuario) {
  const ref = db().collection('lbConfig').doc(`client_login_lock_${normalizeKey(usuario) || 'client'}`);
  const snap = await ref.get();
  const state = snap.exists ? (snap.data() || {}) : {};
  const lockUntilMs = Number(state.lockUntilMs || 0);
  if (Number.isFinite(lockUntilMs) && lockUntilMs > Date.now()) {
    const retryAfterMs = lockUntilMs - Date.now();
    return { locked: true, retryAfterMs, retryMinutes: Math.max(1, Math.ceil(retryAfterMs / 60000)) };
  }
  return { locked: false, retryAfterMs: 0, retryMinutes: 0 };
}

async function registerFailedClientLogin(usuario) {
  const ref = db().collection('lbConfig').doc(`client_login_lock_${normalizeKey(usuario) || 'client'}`);
  const snap = await ref.get();
  const state = snap.exists ? (snap.data() || {}) : {};
  const failures = Number(state.failures || 0) + 1;
  const lockedNow = failures >= CFG.clientLoginMaxAttempts;
  const lockUntilMs = lockedNow ? Date.now() + CFG.clientLoginLockDurationMs : Number(state.lockUntilMs || 0);
  await ref.set({ failures, lockUntilMs, lastFailedAtMs: Date.now() }, { merge: true });
  return { failures, lockedNow };
}

async function lockClient(usuario) {
  const lockUntilMs = Date.now() + CFG.clientLoginLockDurationMs;
  await db().collection('lbConfig').doc(`client_login_lock_${normalizeKey(usuario) || 'client'}`).set({ lockUntilMs, updatedAt: nowIso() }, { merge: true });
  return lockUntilMs;
}

async function clearClientLock(usuario) {
  await db().collection('lbConfig').doc(`client_login_lock_${normalizeKey(usuario) || 'client'}`).delete().catch(() => {});
}

async function findClientPlanForTicket(usuario, requestedPlanId) {
  const usuarioKey = normalizeKey(usuario);
  const plans = await listClientPlanDocs(usuarioKey);
  if (!plans.length) return {};
  const req = normalizeKey(requestedPlanId);
  if (req) {
    const found = plans.find((plan) => normalizeKey(plan.planId || plan.npedido || plan.id) === req);
    if (found) return buildClientPayloadFromPlanDoc(found);
  }
  return buildClientPayloadFromPlanDoc(plans[0]);
}

async function listClientsForAdmin(limit = 300) {
  const snap = await db().collectionGroup('plans').get();
  const plans = snap.docs.map((doc) => buildClientPayloadFromPlanDoc({ id: doc.id, ...doc.data() }));
  return plans.sort((a, b) => {
    const aTime = Date.parse(String(a.createdAt || a.updatedAt || '')) || 0;
    const bTime = Date.parse(String(b.createdAt || b.updatedAt || '')) || 0;
    return bTime - aTime;
  }).slice(0, limit);
}

async function upsertClientFromAdmin(input, authUser, existingPlanId = '') {
  const defaults = getPlanDefaults(input.plan, input.tipoplan);
  const periodicity = normalizeBillingPeriodicity(input.periodicidad || input.frecuencia || input.ciclo, 'mensual');
  const billing = resolveBillingFromMonthlyCuota(input.cuota || defaults.cuota, periodicity);
  const today = startOfDay(new Date());
  const fealta = parseDateFlexible(input.fealta) || today;
  const proxpago = addMonthsPreservingDay(fealta, billing.monthsInterval);
  const planData = {
    planId: String(existingPlanId || input.npedido || randomId('plan_')).trim(),
    plan: String(input.plan || '').trim(),
    tipoplan: String(input.tipoplan || 'LuckyWeb').trim(),
    dominio: String(input.dominio || '').trim(),
    domprov: String(input.domprov || '').trim(),
    cuota: billing.cuota,
    periodicidad: billing.periodicidad,
    consultasocambiosrestantes: String(input.consultasocambiosrestantes || defaults.consultas || '').trim(),
    pagado: String(input.pagado || 'No abonado').trim() === 'Abonado' ? 'Abonado' : 'No abonado',
    fealta: formatDateISO(fealta),
    proxpago: formatDateISO(proxpago),
    npedido: String(input.npedido || randomId('LB-')).trim(),
    panel: String(input.panel || 'no').trim() || 'no',
    flujosactivos: String(input.flujosactivos || '').trim() || '0',
    flujosinactivos: String(input.flujosinactivos || '').trim() || '0',
    rowIndex: Number(input.rowIndex || Date.now()),
  };
  const saved = await persistAccountAndPlan({
    usuario: input.usuario,
    email: input.email,
    nombre: input.nombre,
    password: input.password,
    planData,
    existingPlanId: existingPlanId || input.planId || '',
  });
  await appendAuditEvent({
    eventType: existingPlanId ? 'client_updated' : 'client_created',
    entityType: 'client',
    entityId: input.email || input.usuario,
    actorRole: 'admin',
    actorUser: authUser,
    details: { rowIndex: planData.rowIndex, usuario: input.usuario, email: input.email, plan: planData.plan, npedido: planData.npedido, panel: planData.panel, periodicidad: planData.periodicidad, domprov: planData.domprov },
  });
  return { ...saved, planData };
}

async function listAdminAudit(limit = 120, entityTypeFilter = '', eventTypeFilter = '') {
  const snap = await db().collection('lbAuditLog').orderBy('created_at', 'desc').limit(limit).get();
  return snap.docs.map((doc) => {
    const row = doc.data() || {};
    if (entityTypeFilter && normalizeKey(row.entity_type) !== normalizeKey(entityTypeFilter)) return null;
    if (eventTypeFilter && normalizeKey(row.event_type) !== normalizeKey(eventTypeFilter)) return null;
    return {
      eventId: String(row.event_id || doc.id),
      eventType: String(row.event_type || ''),
      entityType: String(row.entity_type || ''),
      entityId: String(row.entity_id || ''),
      actorRole: String(row.actor_role || ''),
      actorUser: String(row.actor_user || ''),
      detailsJson: String(row.details_json || '{}'),
      createdAt: String(row.created_at || ''),
    };
  }).filter(Boolean);
}

async function findClientSummaryByEmail(email) {
  const emailLower = String(email || '').trim().toLowerCase();
  const snap = await db().collection('lbClients').where('emailLower', '==', emailLower).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const plans = await listClientPlanDocs(doc.id);
  return {
    rowIndex: Number(plans[0]?.rowIndex || 0),
    usuario: String(doc.data().usuario || ''),
    nombre: String(doc.data().nombre || ''),
    email: String(doc.data().email || emailLower),
    totalPlans: plans.length,
  };
}

async function getClient360ByAccount(account) {
  const usuarioKey = account && account.usuarioKey ? account.usuarioKey : normalizeKey(account && account.usuario || '');
  if (!usuarioKey) throw new Error('CLIENT_NOT_FOUND');
  const portfolio = await loadClientPortfolio(usuarioKey);
  if (!portfolio) throw new Error('CLIENT_NOT_FOUND');
  const ticketSnap = await db().collection('lbTickets').where('usuario_key', '==', usuarioKey).orderBy('created_at', 'desc').limit(60).get();
  const tickets = [];
  for (const doc of ticketSnap.docs) tickets.push(mapTicketForClient(doc.data(), await getTicketMessages(doc.id, 20)));
  return {
    client: {
      usuario: portfolio.usuario || '',
      nombre: portfolio.nombre || '',
      email: portfolio.email || '',
      totalPlanes: portfolio.totalPlanes || 0,
      totalTickets: tickets.length,
      openTickets: tickets.filter((ticket) => normalizeKey(ticket.estado) !== 'resuelto').length,
    },
    planes: portfolio.planes || [],
    tickets,
  };
}

async function searchCollections(queryRaw, limit = 20) {
  const q = normalizeKey(queryRaw);
  const clients = [];
  const tickets = [];
  const clientSnap = await db().collectionGroup('plans').orderBy('createdAt', 'desc').limit(1000).get();
  for (const doc of clientSnap.docs) {
    const row = doc.data() || {};
    const haystack = normalizeKey([row.usuario, row.nombre, row.email, row.plan].join(' '));
    if (haystack.includes(q)) {
      clients.push({ rowIndex: Number(row.rowIndex || 0), usuario: String(row.usuario || ''), nombre: String(row.nombre || ''), email: String(row.email || ''), plan: String(row.plan || '') });
      if (clients.length >= limit) break;
    }
  }
  const ticketSnap = await db().collection('lbTickets').orderBy('createdAt', 'desc').limit(1000).get().catch(() => db().collection('lbTickets').get());
  for (const doc of ticketSnap.docs) {
    const row = doc.data() || {};
    const haystack = normalizeKey([row.ticket_id, row.usuario, row.client_email, row.asunto, row.estado, row.ticket_plan, row.ticket_plan_domain, row.ticket_plan_order].join(' '));
    if (haystack.includes(q)) {
      tickets.push({ rowIndex: Number(row.rowIndex || 0), ticketId: String(row.ticket_id || doc.id), usuario: String(row.usuario || ''), email: String(row.client_email || ''), asunto: String(row.asunto || ''), estado: String(row.estado || ''), plan: String(row.ticket_plan || ''), dominio: String(row.ticket_plan_domain || ''), pedido: String(row.ticket_plan_order || ''), createdAt: String(row.created_at || '') });
      if (tickets.length >= limit) break;
    }
  }
  return { clients, tickets };
}

async function handleLogin(params, req) {
  const usuario = safeText(params.usuario || '', 120, '').trim();
  const password = String(params.password || '');
  if (!usuario || !password) return { success: false, error: 'MISSING_CREDENTIALS', message: 'Faltan usuario o password.' };
  const { account } = await getAccountByUserOrEmail(usuario, usuario);
  if (!account || !verifyPasswordHash(password, account.passwordHash)) {
    const failed = await registerFailedClientLogin(usuario);
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: failed.lockedNow
        ? 'Demasiados intentos. Reintenta en ' + Math.max(1, Math.ceil(CFG.clientLoginLockDurationMs / 60000)) + ' minuto(s).'
        : 'Usuario o password incorrectos.'
    };
  }
  const lockStatus = await getClientLoginLockStatus(account.usuario || usuario);
  if (lockStatus.locked) return { success: false, error: 'TWO_FA_TEMP_LOCKED', message: 'Demasiados intentos. Reintenta en ' + lockStatus.retryMinutes + ' minuto(s).', retryAfterMs: lockStatus.retryAfterMs };
  const email = String(account.email || '').trim().toLowerCase();
  await clearClientLock(account.usuario || usuario);
  const session = await createSession(account.usuario, req.ip || '');
  const data = await loadClientPortfolio(normalizeKey(account.usuario));
  if (!data) return { success: false, error: 'USER_NOT_FOUND', message: 'Cliente no encontrado.' };
  return {
    success: true,
    valid: true,
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAtMs,
    data,
  };
}

async function handleValidate(params, req) {
  const token = String(params.sessionToken || '').trim();
  if (!token) return { success: false, valid: false, error: 'MISSING_TOKEN', message: 'Falta sessionToken.' };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: false, valid: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const session = await getSessionRecord(decoded.sessionId);
  if (!session || normalizeKey(session.status) !== 'active') return { success: false, valid: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no activa.' };
  const expiresAtMs = Math.min(Date.parse(String(session.expires_at || '')) || decoded.expiresAtMs, decoded.expiresAtMs);
  if (Date.now() >= expiresAtMs) {
    await revokeSession(decoded.sessionId);
    return { success: false, valid: false, error: 'SESSION_EXPIRED', message: 'Sesion expirada.' };
  }
  await touchSession(decoded.sessionId, req.ip || '');
  const data = await loadClientPortfolio(normalizeKey(decoded.usuario));
  if (!data) {
    await revokeSession(decoded.sessionId);
    return { success: false, valid: false, error: 'USER_NOT_FOUND', message: 'Cliente no encontrado.' };
  }
  return { success: true, valid: true, sessionExpiresAt: expiresAtMs, data };
}

async function handleLogout(params) {
  const token = String(params.sessionToken || '').trim();
  if (!token) return { success: true };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: true };
  await revokeSession(decoded.sessionId);
  return { success: true };
}

async function handleCreateTicket(params) {
  const token = String(params.sessionToken || '').trim();
  const subject = String(params.asunto || '').trim();
  const message = String(params.mensaje || '').trim();
  const requestedPlanId = String(params.ticketPlanId || params.planId || '').trim();
  const priorityMap = { baja: 'baja', media: 'media', alta: 'alta' };
  const prioridad = priorityMap[normalizeKey(params.prioridad)] || 'media';
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta sessionToken.' };
  if (subject.length < 4 || subject.length > 140) return { success: false, error: 'INVALID_SUBJECT', message: 'El asunto debe tener entre 4 y 140 caracteres.' };
  if (message.length < 10 || message.length > 4000) return { success: false, error: 'INVALID_MESSAGE', message: 'El mensaje debe tener entre 10 y 4000 caracteres.' };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: false, error: 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const session = await getSessionRecord(decoded.sessionId);
  if (!session || normalizeKey(session.status) !== 'active') return { success: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no activa.' };
  const account = await getAccountDoc(normalizeKey(decoded.usuario));
  if (!account) return { success: false, error: 'USER_NOT_FOUND', message: 'Cliente no encontrado.' };
  const plan = await findClientPlanForTicket(account.usuario, requestedPlanId);
  const ticketId = randomId('tkt_');
  const now = nowIso();
  const ticket = {
    ticket_id: ticketId,
    usuario: account.usuario,
    usuario_key: normalizeKey(account.usuario),
    client_email: String(account.email || '').trim().toLowerCase(),
    ticket_plan_id: String(plan.planId || plan.npedido || ''),
    ticket_plan: String(plan.plan || ''),
    ticket_plan_type: String(plan.tipoplan || ''),
    ticket_plan_domain: String(plan.dominio || ''),
    ticket_plan_order: String(plan.npedido || ''),
    asunto: subject,
    mensaje: message,
    prioridad,
    estado: 'abierto',
    admin_response: '',
    admin_user: '',
    assigned_admin: '',
    internal_status: 'sin_asignar',
    created_at: now,
    updated_at: now,
    responded_at: '',
    closed_at: '',
    source: String(params.source || 'panel_cliente').trim(),
  };
  await db().collection('lbTickets').doc(ticketId).set(ticket, { merge: true });
  await appendTicketMessage(ticketId, { senderRole: 'client', senderUser: account.usuario, senderEmail: account.email, message, createdAt: now });
  await sendEmail({ to: account.email, subject: 'Hemos recibido tu ticket | LuckyBase', name: 'Equipo LuckyBase', replyTo: CFG.supportEmail, htmlBody: '<p>Hemos recibido tu ticket correctamente.</p>', body: `Ticket recibido: ${subject}` });
  await appendAuditEvent({ eventType: 'ticket_created', entityType: 'ticket', entityId: ticketId, actorRole: 'client', actorUser: account.usuario, details: { prioridad, asunto: subject, ticketPlan: ticket.ticket_plan, ticketPlanOrder: ticket.ticket_plan_order } });
  return {
    success: true,
    message: 'Ticket creado correctamente.',
    ticket: {
      ticketId,
      asunto: ticket.asunto,
      prioridad: ticket.prioridad,
      estado: ticket.estado,
      createdAt: ticket.created_at,
      ticketPlanId: ticket.ticket_plan_id,
      ticketPlan: ticket.ticket_plan,
      ticketPlanType: ticket.ticket_plan_type,
      ticketPlanDomain: ticket.ticket_plan_domain,
      ticketPlanOrder: ticket.ticket_plan_order,
      assignedAdmin: ticket.assigned_admin,
      internalStatus: ticket.internal_status,
    },
  };
}

async function handleListTickets(params) {
  const token = String(params.sessionToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta sessionToken.' };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: false, error: 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const session = await getSessionRecord(decoded.sessionId);
  if (!session || normalizeKey(session.status) !== 'active') return { success: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no activa.' };
  const account = await getAccountDoc(normalizeKey(decoded.usuario));
  if (!account) return { success: false, error: 'USER_NOT_FOUND', message: 'Cliente no encontrado.' };
  const snap = await db().collection('lbTickets').where('usuario_key', '==', normalizeKey(account.usuario)).orderBy('created_at', 'desc').limit(50).get();
  const tickets = [];
  for (const doc of snap.docs) tickets.push(mapTicketForClient(doc.data(), await getTicketMessages(doc.id, 80)));
  return { success: true, tickets };
}

async function handleClientReplyTicket(params) {
  const token = String(params.sessionToken || '').trim();
  const ticketId = String(params.ticketId || '').trim();
  const message = String(params.message || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta sessionToken.' };
  if (!ticketId) return { success: false, error: 'MISSING_TICKET_ID', message: 'Falta ticketId.' };
  if (message.length < 2 || message.length > 4000) return { success: false, error: 'INVALID_MESSAGE', message: 'El mensaje debe tener entre 2 y 4000 caracteres.' };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: false, error: 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const session = await getSessionRecord(decoded.sessionId);
  if (!session || normalizeKey(session.status) !== 'active') return { success: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no activa.' };
  const ticket = await findTicketById(ticketId);
  if (!ticket) return { success: false, error: 'TICKET_NOT_FOUND', message: 'Ticket no encontrado.' };
  if (normalizeKey(ticket.usuario) !== normalizeKey(decoded.usuario)) return { success: false, error: 'FORBIDDEN', message: 'No autorizado.' };
  if (normalizeKey(ticket.estado) === 'resuelto') return { success: false, error: 'TICKET_CLOSED', message: 'Este ticket ya esta resuelto y no admite nuevas respuestas.' };
  const account = await getAccountDoc(normalizeKey(decoded.usuario));
  const now = nowIso();
  await appendTicketMessage(ticketId, { senderRole: 'client', senderUser: account?.usuario || decoded.usuario, senderEmail: account?.email || '', message, createdAt: now });
  await updateTicket(ticketId, { estado: 'abierto', updatedAt: now, closed_at: '' });
  await sendEmail({ to: CFG.supportEmail, subject: `Nuevo mensaje en ticket ${ticketId}`, name: 'LuckyBase', replyTo: account?.email || CFG.supportEmail, htmlBody: '<p>Nuevo mensaje del cliente en un ticket.</p>', body: message });
  return { success: true, message: 'Mensaje enviado correctamente.', ticketId };
}

async function handleClientAlerts(params) {
  const token = String(params.sessionToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta sessionToken.' };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: false, error: 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const session = await getSessionRecord(decoded.sessionId);
  if (!session || normalizeKey(session.status) !== 'active') return { success: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no activa.' };
  const portfolio = await loadClientPortfolio(normalizeKey(decoded.usuario));
  if (!portfolio) return { success: false, error: 'USER_NOT_FOUND', message: 'Cliente no encontrado.' };
  const alerts = [];
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < (portfolio.planes || []).length; i += 1) {
    const plan = portfolio.planes[i] || {};
    const planRef = `${plan.plan || '-'} · ${plan.npedido || plan.planId || '-'}`;
    const planId = String(plan.planId || plan.npedido || `plan_${i + 1}`).trim();
    if (normalizeKey(plan.pagado) === 'noabonado') {
      alerts.push({ id: `payment_pending_${planId}`, type: 'billing', severity: 'alta', title: 'Pago pendiente', message: `Tu plan ${planRef} está en estado "No abonado".`, createdAt: nowIso(), planId });
    }
    const dueMs = Date.parse(String(plan.proxpago || ''));
    if (Number.isFinite(dueMs) && dueMs > 0) {
      const diff = dueMs - now;
      if (diff <= sevenDaysMs) {
        alerts.push({ id: `payment_due_${planId}`, type: 'billing', severity: diff <= 0 ? 'alta' : 'media', title: diff <= 0 ? 'Pago vencido' : 'Próximo pago', message: `Plan ${planRef}: fecha de pago ${formatDateISO(new Date(dueMs))}.`, createdAt: new Date(dueMs).toISOString(), planId });
      }
    }
    const consultas = Number(String(plan.consultasocambiosrestantes || '').trim());
    if (normalizeKey(plan.plan) === 'basic' && normalizeKey(plan.tipoplan) === 'luckyweb' && Number.isFinite(consultas) && consultas <= 2) {
      alerts.push({ id: `quota_low_${planId}`, type: 'quota', severity: consultas === 0 ? 'alta' : 'media', title: 'Consultas/cambios bajos', message: `Plan ${planRef}: quedan ${String(Math.max(0, consultas))} cambios este mes.`, createdAt: nowIso(), planId });
    }
  }
  let unreadSupportReplies = 0;
  let openTickets = 0;
  const ticketSnap = await db().collection('lbTickets').where('usuario_key', '==', normalizeKey(decoded.usuario)).get();
  const clientTickets = [];
  for (const doc of ticketSnap.docs) {
    clientTickets.push(mapTicketForClient(doc.data(), await getTicketMessages(doc.id, 20)));
  }
  for (const ticket of clientTickets) {
    if (normalizeKey(ticket.estado) !== 'resuelto') openTickets += 1;
    const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
    const last = messages[messages.length - 1] || {};
    if (normalizeKey(last.senderRole) === 'admin' && normalizeKey(ticket.estado) !== 'resuelto') {
      unreadSupportReplies += 1;
      alerts.push({ id: `ticket_reply_${ticket.ticketId}`, type: 'ticket', severity: 'media', title: 'Nueva respuesta del soporte', message: `Ticket ${ticket.ticketId}: ${String(ticket.asunto || '-')}`, createdAt: String(last.createdAt || ticket.updatedAt || ticket.createdAt || nowIso()), ticketId: ticket.ticketId });
    }
  }
  if (openTickets > 0) alerts.push({ id: 'open_tickets', type: 'ticket', severity: 'baja', title: 'Tickets abiertos', message: `Actualmente tienes ${String(openTickets)} ticket(s) sin resolver.`, createdAt: nowIso() });
  alerts.sort((a, b) => {
    const rankA = getAlertSeverityRank(a && a.severity);
    const rankB = getAlertSeverityRank(b && b.severity);
    if (rankA !== rankB) return rankB - rankA;
    const aMs = Date.parse(String(a && a.createdAt || '')) || 0;
    const bMs = Date.parse(String(b && b.createdAt || '')) || 0;
    return bMs - aMs;
  });
  return { success: true, generatedAt: nowIso(), unreadSupportReplies, openTickets, alerts: alerts.slice(0, 40) };
}

async function handleClientBillingHistory(params) {
  const token = String(params.sessionToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta sessionToken.' };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: false, error: 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const session = await getSessionRecord(decoded.sessionId);
  if (!session || normalizeKey(session.status) !== 'active') return { success: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no activa.' };
  const portfolio = await loadClientPortfolio(normalizeKey(decoded.usuario));
  if (!portfolio) return { success: false, error: 'USER_NOT_FOUND', message: 'Cliente no encontrado.' };
  const limit = Math.min(120, Math.max(6, Math.floor(Number(params.limit) || 40)));
  const now = Date.now();
  const events = [];
  let pendingCount = 0;
  let overdueCount = 0;
  let monthlyEstimate = 0;
  for (let i = 0; i < (portfolio.planes || []).length; i += 1) {
    const plan = portfolio.planes[i] || {};
    const planId = String(plan.planId || plan.npedido || `plan_${i + 1}`);
    const amountValue = parseEuroAmount(plan.cuota);
    if (Number.isFinite(amountValue) && amountValue > 0) monthlyEstimate += amountValue;
    const feAltaMs = Date.parse(String(plan.fealta || ''));
    const proxPagoMs = Date.parse(String(plan.proxpago || ''));
    const isPending = normalizeKey(plan.pagado) === 'noabonado';
    if (isPending) pendingCount += 1;
    if (isPending && Number.isFinite(proxPagoMs) && proxPagoMs > 0 && proxPagoMs <= now) overdueCount += 1;
    if (Number.isFinite(feAltaMs) && feAltaMs > 0) {
      events.push({ eventId: `alta_${planId}`, type: 'alta_plan', status: 'completado', date: new Date(feAltaMs).toISOString(), title: 'Alta de plan', description: `${plan.plan || '-'}${plan.tipoplan ? ' · ' + plan.tipoplan : ''} · Pedido ${String(plan.npedido || '-')}`, amount: plan.cuota || '-', planId, plan: plan.plan || '-', domain: plan.dominio || '-', order: plan.npedido || '-' });
    }
    if (Number.isFinite(proxPagoMs) && proxPagoMs > 0) {
      events.push({ eventId: `cobro_${planId}`, type: 'pago_programado', status: isPending ? (proxPagoMs <= now ? 'vencido' : 'pendiente') : 'ok', date: new Date(proxPagoMs).toISOString(), title: proxPagoMs <= now ? 'Pago vencido o en curso' : 'Próximo pago programado', description: `${plan.plan || '-'} · Dominio ${String(plan.dominio || '-')}`, amount: plan.cuota || '-', planId, plan: plan.plan || '-', domain: plan.dominio || '-', order: plan.npedido || '-' });
    }
  }
  events.sort((a, b) => (Date.parse(String(b.date || '')) || 0) - (Date.parse(String(a.date || '')) || 0));
  return { success: true, summary: { totalPlanes: (portfolio.planes || []).length, pendingCount, overdueCount, monthlyEstimate: Number.isFinite(monthlyEstimate) ? monthlyEstimate : 0 }, events: events.slice(0, limit) };
}

async function handleClientSecurityOverview(params) {
  const token = String(params.sessionToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta sessionToken.' };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: false, error: 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const session = await getSessionRecord(decoded.sessionId);
  if (!session || normalizeKey(session.status) !== 'active') return { success: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no activa.' };
  const snaps = await db().collection('lbSessions').where('usuario', '==', String(decoded.usuario || '')).get();
  const sessions = snaps.docs.map((doc) => {
    const row = doc.data() || {};
    return {
      sessionId: doc.id,
      status: String(row.status || 'unknown'),
      issuedAt: String(row.issued_at || ''),
      expiresAt: String(row.expires_at || ''),
      lastSeenAt: String(row.last_seen_at || ''),
      isCurrent: doc.id === decoded.sessionId,
    };
  }).sort((a, b) => (Date.parse(String(b.lastSeenAt || b.issuedAt || '')) || 0) - (Date.parse(String(a.lastSeenAt || a.issuedAt || '')) || 0));
  return { success: true, sessions, currentSessionId: decoded.sessionId };
}

async function handleClientRevokeSession(params) {
  const token = String(params.sessionToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta sessionToken.' };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: false, error: 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const session = await getSessionRecord(decoded.sessionId);
  if (!session || normalizeKey(session.status) !== 'active') return { success: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no activa.' };
  const revokeAllOthers = parseBoolean(params.revokeAllOthers) || normalizeKey(params.mode) === 'allothers';
  const targetSessionId = String(params.targetSessionId || params.sessionId || '').trim();
  const snap = await db().collection('lbSessions').where('usuario', '==', String(decoded.usuario || '')).get();
  let revokedCount = 0;
  let revokedCurrentSession = false;
  for (const doc of snap.docs) {
    if (revokeAllOthers && doc.id === decoded.sessionId) continue;
    if (!revokeAllOthers && doc.id !== targetSessionId) continue;
    await doc.ref.set({ status: 'revoked', last_seen_at: nowIso() }, { merge: true });
    revokedCount += 1;
    if (doc.id === decoded.sessionId) revokedCurrentSession = true;
  }
  await appendAuditEvent({ eventType: 'client_sessions_revoked', entityType: 'session', entityId: decoded.usuario, actorRole: 'client', actorUser: decoded.usuario, details: { mode: revokeAllOthers ? 'all_others' : 'single', targetSessionId, revokedCount, revokedCurrentSession } });
  return { success: true, message: revokedCount ? 'Sesión(es) cerrada(s) correctamente.' : 'No había sesiones activas para cerrar.', revokedCount, shouldLogout: revokedCurrentSession };
}

async function handleClientChangePassword(params) {
  const token = String(params.sessionToken || '').trim();
  const currentPassword = String(params.currentPassword || '').trim();
  const newPassword = String(params.newPassword || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta sessionToken.' };
  if (!currentPassword || !newPassword) return { success: false, error: 'MISSING_FIELDS', message: 'Debes indicar contraseña actual y nueva.' };
  if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) return { success: false, error: 'WEAK_PASSWORD', message: 'La nueva contraseña debe incluir mayúscula, minúscula, número y tener al menos 8 caracteres.' };
  if (currentPassword === newPassword) return { success: false, error: 'PASSWORD_UNCHANGED', message: 'La nueva contraseña debe ser distinta a la actual.' };
  const decoded = verifySessionToken(token);
  if (!decoded.valid) return { success: false, error: 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const session = await getSessionRecord(decoded.sessionId);
  if (!session || normalizeKey(session.status) !== 'active') return { success: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no activa.' };
  const accountRef = db().collection('lbClients').doc(normalizeKey(decoded.usuario));
  const snap = await accountRef.get();
  if (!snap.exists) return { success: false, error: 'USER_NOT_FOUND', message: 'No se encontraron datos del usuario.' };
  const account = snap.data() || {};
  if (!verifyPasswordHash(currentPassword, account.passwordHash)) return { success: false, error: 'INVALID_CURRENT_PASSWORD', message: 'La contraseña actual no es correcta.' };
  await accountRef.set({ passwordHash: createPasswordHash(newPassword), updatedAt: nowIso() }, { merge: true });
  const plansSnap = await accountRef.collection('plans').get();
  for (const doc of plansSnap.docs) {
    const planId = String(doc.id || (doc.data() || {}).planId || '').trim();
    await doc.ref.set({ updatedAt: nowIso() }, { merge: true });
    if (planId) {
      await db().collection('lbPlans').doc(planId).set({ updatedAt: nowIso() }, { merge: true });
    }
  }
  const revokedSessions = await revokeUserSessions(String(account.usuario || decoded.usuario), decoded.sessionId);
  await clearClientLock(decoded.usuario);
  await appendAuditEvent({ eventType: 'client_password_changed', entityType: 'client', entityId: decoded.usuario, actorRole: 'client', actorUser: decoded.usuario, details: { rowsUpdated: plansSnap.size, revokedSessions } });
  return { success: true, message: 'Contraseña actualizada. Debes iniciar sesión de nuevo.', shouldLogout: true, revokedSessions };
}

async function handleAdminLogin(params, req) {
  const usernameInput = String(params.username || '').trim();
  const passwordInput = String(params.password || '');
  if (!usernameInput || !passwordInput) {
    return { success: false, error: 'INVALID_CREDENTIALS', message: 'Credenciales no validas.' };
  }
  try {
    const cfg = await getAdminAuthConfig();
    const lockIdentity = cfg.adminUser || usernameInput;
    const lockStatus = await getAdminLoginLockStatus(lockIdentity);
    if (lockStatus.locked) {
      return {
        success: false,
        error: 'TOO_MANY_ATTEMPTS',
        message: 'Acceso bloqueado temporalmente. Reintenta en ' + lockStatus.retryMinutes + ' minuto(s).',
        retryAfterMs: lockStatus.retryAfterMs,
      };
    }

    const usernameOk = safeTimingEqual(normalizeKey(usernameInput), normalizeKey(cfg.adminUser));
    const passwordOk = verifyPasswordHash(passwordInput, cfg.adminPasswordHash);
    if (!usernameOk || !passwordOk) {
      const failedAttempt = await registerFailedAdminLogin(lockIdentity);
      return {
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: failedAttempt.lockedNow
          ? 'Acceso bloqueado temporalmente. Reintenta en ' + Math.max(1, Math.ceil(CFG.adminLoginLockDurationMs / 60000)) + ' minuto(s).'
          : 'Credenciales no validas.',
      };
    }

    await clearAdminLoginState(lockIdentity);
    const adminExpiresAt = Date.now() + CFG.adminTokenDurationMs;
    const adminToken = createAdminToken(cfg.adminUser, adminExpiresAt);
    return {
      success: true,
      valid: true,
      adminUser: cfg.adminUser,
      adminToken,
      adminExpiresAt,
    };
  } catch (error) {
    const errorText = String(error && error.message ? error.message : error || '');
    Logger.log('Error in admin login: ' + errorText);
    return {
      success: false,
      error: 'SERVER_ERROR',
      message: errorText === 'ADMIN_NOT_CONFIGURED'
        ? 'Admin no configurado.'
        : 'No se pudo iniciar sesión.',
    };
  }
}

async function handleAdminValidate(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  try {
    const decoded = verifyAdminToken(token);
    if (!decoded.valid) {
      return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
    }
    const cfg = await getAdminAuthConfig().catch(() => null);
    if (cfg && normalizeKey(cfg.adminUser) && normalizeKey(cfg.adminUser) !== normalizeKey(decoded.username)) {
      return { success: false, error: 'SESSION_NOT_ACTIVE', message: 'Sesion no valida.' };
    }
    return {
      success: true,
      valid: true,
      adminUser: decoded.username,
      adminExpiresAt: decoded.expiresAtMs,
    };
  } catch (error) {
    const errorText = String(error && error.message ? error.message : error || '');
    Logger.log('Error in admin validation: ' + errorText);
    return {
      success: false,
      error: 'SERVER_ERROR',
      message: 'No se pudo validar la sesión.',
    };
  }
}

async function handleAdminDashboard(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const [clientsSnap, sessionsSnap, ticketsSummary, auditSnap] = await Promise.all([
    db().collectionGroup('plans').get(),
    db().collection('lbSessions').get(),
    getTicketsSummary(),
    db().collection('lbAuditLog').orderBy('created_at', 'desc').limit(10).get().catch(() => db().collection('lbAuditLog').get()),
  ]);
  const clientsWithEmail = clientsSnap.docs.filter((doc) => String((doc.data() || {}).email || '').includes('@')).length;
  const activeSessions = sessionsSnap.docs.filter((doc) => normalizeKey((doc.data() || {}).status) === 'active').length;
  return {
    success: true,
    summary: { totalClients: clientsSnap.size, clientsWithEmail, activeSessions, ...ticketsSummary },
    latestTickets: (await listAdminTicketSummaries(8)).map((ticket) => ({
      ticketId: String(ticket.ticket_id || ''),
      asunto: String(ticket.asunto || ''),
      usuario: String(ticket.usuario || ''),
      createdAt: String(ticket.created_at || ''),
      estado: String(ticket.estado || 'abierto'),
    })),
    planCatalog: getAdminPlanCatalog(),
    recentAudit: auditSnap.docs.map((doc) => doc.data() || {}),
  };
}

function getAdminPlanCatalog() {
  return {
    LuckyWeb: [
      { value: 'basic', label: 'basic · 3,50€/mes o 6,50€/mes' },
      { value: 'corporativa', label: 'corporativa · 5,50€/mes' },
      { value: 'ecommerce', label: 'ecommerce · 20,00€/mes' },
    ],
    LuckyAuto: [
      { value: 'basic', label: 'basic · 120€ + 15€/mes' },
      { value: 'pro', label: 'pro · 350€ + 30€/mes' },
      { value: 'lucky', label: 'lucky · 650€ + 60€/mes' },
    ],
  };
}

async function handleAdminListClients(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const limit = Math.min(500, Math.max(1, Math.floor(Number(params.limit) || 300)));
  try {
    const clients = await listClientsForAdmin(limit);
    return { success: true, totalClients: clients.length, clients, planCatalog: getAdminPlanCatalog() };
  } catch (error) {
    const errorText = String(error && error.message ? error.message : error || 'ERROR');
    Logger.log('Error in admin list clients: ' + errorText);
    return {
      success: false,
      error: 'SERVER_ERROR',
      message: 'No se pudo cargar la lista de clientes.',
    };
  }
}

async function handleAdminCreateClient(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const email = String(params.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { success: false, error: 'INVALID_EMAIL', message: 'El email no es valido.' };
  let password = String(params.password || '').trim();
  let generatedPassword = '';
  if (!password) {
    password = createRandomClientPassword();
    generatedPassword = password;
  }

  const input = {
    usuario: String(params.usuario || '').trim(),
    nombre: String(params.nombre || '').trim(),
    email,
    password,
    plan: String(params.plan || '').trim(),
    tipoplan: String(params.tipoplan || '').trim() || 'LuckyWeb',
    dominio: String(params.dominio || '').trim(),
    domprov: String(params.domprov || '').trim(),
    cuota: String(params.cuota || '').trim(),
    periodicidad: String(params.periodicidad || params.frecuencia || params.ciclo || '').trim(),
    consultasocambiosrestantes: String(params.consultasocambiosrestantes || '').trim(),
    pagado: String(params.pagado || '').trim(),
    panel: String(params.panel || 'no').trim(),
    flujosactivos: String(params.flujosactivos || '').trim(),
    flujosinactivos: String(params.flujosinactivos || '').trim(),
    npedido: String(params.npedido || '').trim(),
    fealta: String(params.fealta || '').trim(),
  };
  const existing = await getAccountByUserOrEmail(input.usuario, email);
  const plan = await upsertClientFromAdmin(input, decoded.username, '');
  const welcomeSent = input.panel === 'si' && !!input.usuario && !!input.password ? (await sendEmail({
    to: email,
    subject: 'Bienvenido a LuckyBase: tus accesos',
    name: 'Equipo LuckyBase',
    replyTo: CFG.supportEmail,
    htmlBody: '<p>Bienvenido a LuckyBase.</p><p><strong>Usuario:</strong> ' + escapeHtml(input.usuario) + '</p><p><strong>Contraseña:</strong> ' + escapeHtml(input.password) + '</p>',
    body: 'Bienvenido a LuckyBase.\n\nUsuario: ' + String(input.usuario || '-') + '\nContraseña: ' + String(input.password || '-'),
  })).sent : false;
  const orderSent = input.panel !== 'si' && !!input.usuario && !!input.nombre ? (await sendEmail({ to: email, subject: 'Hemos recibido tu pedido | LuckyBase', name: 'Equipo LuckyBase', replyTo: CFG.supportEmail, htmlBody: '<p>Hemos recibido tu pedido correctamente.</p>', body: 'Hemos recibido tu pedido correctamente.' })).sent : false;
  return {
    success: true,
    message: 'Cliente creado correctamente.',
    client: {
      rowIndex: plan.plan.rowIndex,
      usuario: plan.plan.usuario,
      nombre: plan.plan.nombre,
      email: plan.plan.email,
      plan: plan.plan.plan,
      tipoplan: plan.plan.tipoplan,
      pagado: plan.plan.pagado,
      proxpago: plan.plan.proxpago,
      fealta: plan.plan.fealta,
      cuota: plan.plan.cuota,
      periodicidad: plan.plan.periodicidad,
      precioinicial: getPlanDefaults(plan.plan.plan, plan.plan.tipoplan).precioInicial || '',
      consultasocambiosrestantes: plan.plan.consultasocambiosrestantes,
      npedido: plan.plan.npedido,
      panel: plan.plan.panel,
      domprov: plan.plan.domprov,
      flujosactivos: plan.plan.flujosactivos,
      flujosinactivos: plan.plan.flujosinactivos,
    },
    generatedPassword,
    welcomeSent,
    orderSent,
    planAddedNoticeSent: !!existing.account,
    planCatalog: getAdminPlanCatalog(),
  };
}

async function handleAdminDeleteClient(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const rowIndex = Number(params.rowIndex);
  if (!Number.isFinite(rowIndex) || rowIndex <= 0) return { success: false, error: 'INVALID_ROW_INDEX', message: 'rowIndex no valido.' };
  const snap = await db().collectionGroup('plans').where('rowIndex', '==', rowIndex).limit(1).get();
  if (snap.empty) return { success: false, error: 'CLIENT_NOT_FOUND', message: 'Cliente no encontrado.' };
  const doc = snap.docs[0];
  const plan = doc.data() || {};
  const planId = String(plan.planId || doc.id || '').trim();
  await doc.ref.delete();
  if (planId) {
    await db().collection('lbPlans').doc(planId).delete().catch(() => {});
  }
  const parentRef = doc.ref.parent.parent;
  if (parentRef) {
    const remaining = await parentRef.collection('plans').get();
    if (remaining.empty) await parentRef.delete().catch(() => {});
  }
  await revokeUserSessions(String(plan.usuario || ''));
  await appendAuditEvent({ eventType: 'client_deleted', entityType: 'client', entityId: String(plan.email || plan.usuario || ''), actorRole: 'admin', actorUser: decoded.username, details: { rowIndex, usuario: plan.usuario || '', email: plan.email || '' } });
  return { success: true, message: 'Cliente eliminado correctamente.', deleted: { rowIndex, usuario: String(plan.usuario || ''), email: String(plan.email || '') }, revokedSessions: 0 };
}

async function handleAdminFindClientByEmail(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const email = String(params.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { success: false, error: 'INVALID_EMAIL', message: 'El email no es valido.' };
  const found = await findClientSummaryByEmail(email);
  if (!found) return { success: true, found: false };
  return { success: true, found: true, client: { rowIndex: found.rowIndex, usuario: found.usuario, nombre: found.nombre, email: found.email, totalPlanes: found.totalPlans } };
}

async function handleAdminGetClientDetail(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const rowIndex = Number(params.rowIndex);
  if (!Number.isFinite(rowIndex) || rowIndex <= 0) return { success: false, error: 'INVALID_ROW_INDEX', message: 'rowIndex no valido.' };
  const snap = await db().collectionGroup('plans').where('rowIndex', '==', rowIndex).limit(1).get();
  if (snap.empty) return { success: false, error: 'CLIENT_NOT_FOUND', message: 'Cliente no encontrado.' };
  const plan = buildClientPayloadFromPlanDoc(snap.docs[0].data() || {});
  const parent = snap.docs[0].ref.parent.parent;
  const account = parent ? (await parent.get()).data() || {} : {};
  return {
    success: true,
    client: {
      rowIndex,
      usuario: String(account.usuario || plan.usuario || ''),
      password: '',
      plan: String(plan.plan || ''),
      tipoplan: String(plan.tipoplan || ''),
      dominio: String(plan.dominio || ''),
      domprov: String(plan.domprov || ''),
      cuota: String(plan.cuota || ''),
      periodicidad: String(plan.periodicidad || ''),
      precioinicial: getPlanDefaults(plan.plan, plan.tipoplan).precioInicial || '',
      consultasocambiosrestantes: String(plan.consultasocambiosrestantes || ''),
      pagado: String(plan.pagado || ''),
      fealta: String(plan.fealta || ''),
      proxpago: String(plan.proxpago || ''),
      npedido: String(plan.npedido || ''),
      nombre: String(plan.nombre || ''),
      email: String(plan.email || ''),
      flujosactivos: String(plan.flujosactivos || ''),
      flujosinactivos: String(plan.flujosinactivos || ''),
      panel: String(plan.panel || ''),
    },
    planCatalog: getAdminPlanCatalog(),
  };
}

async function handleAdminUpdateClient(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const rowIndex = Number(params.rowIndex);
  if (!Number.isFinite(rowIndex) || rowIndex <= 0) return { success: false, error: 'INVALID_ROW_INDEX', message: 'rowIndex no valido.' };
  const snap = await db().collectionGroup('plans').where('rowIndex', '==', rowIndex).limit(1).get();
  if (snap.empty) return { success: false, error: 'CLIENT_NOT_FOUND', message: 'Cliente no encontrado.' };
  const oldPlanDoc = snap.docs[0];
  const oldPlan = oldPlanDoc.data() || {};
  const input = {
    usuario: String(params.usuario || oldPlan.usuario || '').trim(),
    nombre: String(params.nombre || oldPlan.nombre || '').trim(),
    email: String(params.email || oldPlan.email || '').trim().toLowerCase(),
    password: String(params.password || '').trim(),
    plan: String(params.plan || oldPlan.plan || '').trim(),
    tipoplan: String(params.tipoplan || oldPlan.tipoplan || 'LuckyWeb').trim(),
    dominio: String(params.dominio || oldPlan.dominio || '').trim(),
    domprov: Object.prototype.hasOwnProperty.call(params, 'domprov') ? String(params.domprov || '').trim() : String(oldPlan.domprov || '').trim(),
    cuota: String(params.cuota || oldPlan.cuota || '').trim(),
    periodicidad: Object.prototype.hasOwnProperty.call(params, 'periodicidad') ? String(params.periodicidad || params.frecuencia || params.ciclo || '').trim() : String(oldPlan.periodicidad || '').trim(),
    consultasocambiosrestantes: String(params.consultasocambiosrestantes || oldPlan.consultasocambiosrestantes || '').trim(),
    pagado: String(params.pagado || oldPlan.pagado || '').trim(),
    panel: Object.prototype.hasOwnProperty.call(params, 'panel') ? String(params.panel || '').trim() : String(oldPlan.panel || '').trim(),
    flujosactivos: Object.prototype.hasOwnProperty.call(params, 'flujosactivos') ? String(params.flujosactivos || '').trim() : String(oldPlan.flujosactivos || '').trim(),
    flujosinactivos: Object.prototype.hasOwnProperty.call(params, 'flujosinactivos') ? String(params.flujosinactivos || '').trim() : String(oldPlan.flujosinactivos || '').trim(),
    npedido: String(params.npedido || oldPlan.npedido || '').trim(),
    fealta: String(params.fealta || oldPlan.fealta || '').trim(),
    rowIndex,
  };
  const updated = await upsertClientFromAdmin(input, decoded.username, String(oldPlan.planId || oldPlan.npedido || oldPlan.id || ''));
  await appendAuditEvent({ eventType: 'client_updated', entityType: 'client', entityId: input.email || input.usuario, actorRole: 'admin', actorUser: decoded.username, details: { rowIndex, usuario: input.usuario, email: input.email, plan: input.plan, pagado: input.pagado, npedido: input.npedido, panel: input.panel, periodicidad: input.periodicidad, domprov: input.domprov, flujosactivos: input.flujosactivos, flujosinactivos: input.flujosinactivos } });
  return {
    success: true,
    message: 'Cliente actualizado correctamente.',
    client: {
      rowIndex,
      usuario: updated.plan.usuario,
      nombre: updated.plan.nombre,
      email: updated.plan.email,
      plan: updated.plan.plan,
      tipoplan: updated.plan.tipoplan,
      dominio: updated.plan.dominio,
      domprov: updated.plan.domprov,
      cuota: updated.plan.cuota,
      periodicidad: updated.plan.periodicidad,
      precioinicial: getPlanDefaults(updated.plan.plan, updated.plan.tipoplan).precioInicial || '',
      consultasocambiosrestantes: updated.plan.consultasocambiosrestantes,
      pagado: updated.plan.pagado,
      fealta: updated.plan.fealta,
      proxpago: updated.plan.proxpago,
      npedido: updated.plan.npedido,
      panel: updated.plan.panel,
      flujosactivos: updated.plan.flujosactivos,
      flujosinactivos: updated.plan.flujosinactivos,
    },
    welcomeSent: false,
    orderSent: false,
    periodicityNoticeSent: false,
    periodicityNoticeError: '',
    planCatalog: getAdminPlanCatalog(),
  };
}

async function handleAdminBulkClients(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const rowIndexes = String(params.rowIndexes || params.rows || params.rowIndexList || '').split(',').map((value) => Number(String(value || '').trim())).filter((value) => Number.isFinite(value) && value > 0);
  if (!rowIndexes.length) return { success: false, error: 'MISSING_ROW_INDEXES', message: 'Debes seleccionar al menos un cliente.' };
  const operation = normalizeKey(params.operation);
  const affected = [];
  let updated = 0;
  let remindersSent = 0;
  const errors = [];
  if (operation === 'markpaid') {
    const value = normalizeKey(params.value) === 'abonado' ? 'Abonado' : 'No abonado';
    for (const rowIndex of rowIndexes) {
      const snap = await db().collectionGroup('plans').where('rowIndex', '==', rowIndex).limit(1).get();
      if (snap.empty) continue;
      const doc = snap.docs[0];
      await doc.ref.set({ pagado: value, updatedAt: nowIso() }, { merge: true });
      const planId = String((doc.data() || {}).planId || doc.id || '').trim();
      if (planId) {
        await db().collection('lbPlans').doc(planId).set({ pagado: value, updatedAt: nowIso() }, { merge: true });
      }
      updated += 1;
      affected.push({ rowIndex, usuario: String(doc.data().usuario || ''), email: String(doc.data().email || '') });
    }
  } else if (operation === 'setplan') {
    const requestedPlan = String(params.value || params.plan || '').trim();
    const requestedTipoPlan = String(params.tipoplan || params.planType || params.tipo || '').trim() || 'LuckyWeb';
    for (const rowIndex of rowIndexes) {
      const snap = await db().collectionGroup('plans').where('rowIndex', '==', rowIndex).limit(1).get();
      if (snap.empty) continue;
      const doc = snap.docs[0];
      const current = doc.data() || {};
      const defaults = getPlanDefaults(requestedPlan, requestedTipoPlan);
      const periodicidad = normalizeBillingPeriodicity(current.periodicidad, 'mensual');
      const billing = resolveBillingFromMonthlyCuota(defaults.cuota, periodicidad);
      const patch = { plan: requestedPlan, tipoplan: requestedTipoPlan, cuota: billing.cuota, periodicidad: billing.periodicidad, consultasocambiosrestantes: defaults.consultas, updatedAt: nowIso() };
      await doc.ref.set(patch, { merge: true });
      const planId = String(current.planId || doc.id || '').trim();
      if (planId) {
        await db().collection('lbPlans').doc(planId).set(patch, { merge: true });
      }
      updated += 1;
      affected.push({ rowIndex, usuario: String(current.usuario || ''), email: String(current.email || '') });
    }
  } else if (operation === 'sendreminder') {
    for (const rowIndex of rowIndexes) {
      const snap = await db().collectionGroup('plans').where('rowIndex', '==', rowIndex).limit(1).get();
      if (snap.empty) continue;
      const doc = snap.docs[0];
      const plan = doc.data() || {};
      const result = await sendEmail({ to: String(plan.email || ''), subject: 'Recordatorio de pago pendiente | LuckyBase', name: 'Equipo LuckyBase', replyTo: CFG.supportEmail, htmlBody: '<p>Recordatorio de pago pendiente.</p>', body: `Plan: ${plan.plan || '-'}\nDominio: ${plan.dominio || '-'}\nPróximo pago: ${plan.proxpago || '-'}` });
      if (result.sent) remindersSent += 1; else errors.push('Fila ' + rowIndex + ': ' + String(result.error || 'ERROR'));
      affected.push({ rowIndex, usuario: String(plan.usuario || ''), email: String(plan.email || '') });
    }
  } else if (operation === 'exportcsv') {
    const rows = [['rowIndex', 'usuario', 'nombre', 'email', 'plan', 'pagado', 'proxpago', 'dominio', 'npedido']];
    for (const rowIndex of rowIndexes) {
      const snap = await db().collectionGroup('plans').where('rowIndex', '==', rowIndex).limit(1).get();
      if (snap.empty) continue;
      const plan = snap.docs[0].data() || {};
      rows.push([String(rowIndex), String(plan.usuario || ''), String(plan.nombre || ''), String(plan.email || ''), String(plan.plan || ''), String(plan.pagado || ''), String(plan.proxpago || ''), String(plan.dominio || ''), String(plan.npedido || '')]);
    }
    const csv = rows.map((line) => line.map((cell) => '"' + String(cell || '').replace(/"/g, '""') + '"').join(',')).join('\n');
    await appendAuditEvent({ eventType: 'clients_bulk_export_csv', entityType: 'client', entityId: String(rowIndexes.length), actorRole: 'admin', actorUser: decoded.username, details: { rows: rowIndexes.length } });
    return { success: true, message: 'CSV generado.', csv, filename: 'clientes_luckybase_' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv' };
  } else {
    return { success: false, error: 'INVALID_OPERATION', message: 'Operacion masiva no valida.' };
  }
  await appendAuditEvent({ eventType: 'clients_bulk_' + operation, entityType: 'client', entityId: String(rowIndexes.length), actorRole: 'admin', actorUser: decoded.username, details: { operation, value: String(params.value || ''), updated, remindersSent, errors } });
  return { success: true, message: 'Operacion masiva completada.', operation, selected: rowIndexes.length, updated, remindersSent, errors, affected, planCatalog: getAdminPlanCatalog() };
}

async function handleAdminGetClient360(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const rowIndex = Number(params.rowIndex);
  const usuarioInput = String(params.usuario || '').trim();
  const emailInput = String(params.email || '').trim().toLowerCase();
  let account = null;
  if (Number.isFinite(rowIndex) && rowIndex > 0) {
    const snap = await db().collectionGroup('plans').where('rowIndex', '==', rowIndex).limit(1).get();
    if (!snap.empty) {
      const parent = snap.docs[0].ref.parent.parent;
      if (parent) {
        const accSnap = await parent.get();
        account = accSnap.exists ? { usuarioKey: parent.id, ...accSnap.data() } : null;
      }
    }
  }
  if (!account && usuarioInput) {
    const acc = await getAccountByUserOrEmail(usuarioInput, emailInput);
    account = acc.account ? { usuarioKey: acc.usuarioKey, ...acc.account } : null;
  }
  if (!account) return { success: false, error: 'CLIENT_NOT_FOUND', message: 'Cliente no encontrado.' };
  const detail = await getClient360ByAccount(account);
  return { success: true, ...detail };
}

async function handleAdminGlobalSearch(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const queryRaw = String(params.q || params.query || '').trim();
  if (queryRaw.length < 2) return { success: false, error: 'QUERY_TOO_SHORT', message: 'Debes escribir al menos 2 caracteres.' };
  const limit = Math.min(50, Math.max(5, Math.floor(Number(params.limit) || 20)));
  const results = await searchCollections(queryRaw, limit);
  await appendAuditEvent({ eventType: 'global_search', entityType: 'system', entityId: queryRaw, actorRole: 'admin', actorUser: decoded.username, details: { query: queryRaw, clients: results.clients.length, tickets: results.tickets.length } });
  return { success: true, query: queryRaw, results };
}

async function handleAdminAudit(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const limit = Math.min(500, Math.max(1, Math.floor(Number(params.limit) || 120)));
  const entries = await listAdminAudit(limit, String(params.entityType || ''), String(params.eventType || ''));
  await appendAuditEvent({ eventType: 'audit_log_viewed', entityType: 'audit_log', entityId: String(entries.length), actorRole: 'admin', actorUser: decoded.username, details: { limit } });
  return { success: true, entries };
}

async function handleAdminCloudflareStatus(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const cfg = await getConfigDoc();
  const zoneName = String(params.zoneName || cfg.cloudflareZoneName || CFG.cloudflareZoneName || 'luckybase.es').trim();
  const tokenValue = String(cfg.cloudflareToken || CFG.cloudflareToken || '').trim();
  if (!tokenValue) return { success: false, error: 'CLOUDFLARE_NOT_CONFIGURED', message: 'Cloudflare no está configurado.' };
  const zoneResp = await fetch(`${String(cfg.cloudflareApiBaseUrl || CFG.cloudflareApiBaseUrl).replace(/\/+$/, '')}/zones?name=${encodeURIComponent(zoneName)}`, {
    headers: { Authorization: `Bearer ${tokenValue}`, 'Content-Type': 'application/json' },
  });
  if (!zoneResp.ok) throw new Error('CLOUDFLARE_HTTP_' + zoneResp.status);
  const zoneJson = await zoneResp.json();
  const zone = Array.isArray(zoneJson.result) ? zoneJson.result[0] : null;
  if (!zone) throw new Error('ZONE_NOT_FOUND');
  await appendAuditEvent({ eventType: 'cloudflare_status_checked', entityType: 'cloudflare_zone', entityId: zoneName, actorRole: 'admin', actorUser: decoded.username, details: { status: zone.status, plan: zone.plan && zone.plan.name ? zone.plan.name : '' } });
  return {
    success: true,
    status: {
      zoneName,
      zoneId: String(zone.id || ''),
      status: String(zone.status || ''),
      paused: !!zone.paused,
      plan: String(zone.plan && zone.plan.name || ''),
      securityLevel: String(zone.security_level || ''),
      alwaysUseHttps: String(zone.settings && zone.settings.always_use_https ? zone.settings.always_use_https : ''),
      activatedOn: String(zone.activated_on || ''),
      modifiedOn: String(zone.modified_on || ''),
      nameServers: Array.isArray(zone.name_servers) ? zone.name_servers : [],
      warnings: [],
    },
  };
}

async function handleAdminReplyTicket(params) {
  const token = String(params.adminToken || '').trim();
  const ticketId = String(params.ticketId || '').trim();
  const responseText = String(params.response || '').trim();
  const requestedStatus = normalizeKey(params.estado || '');
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  if (!ticketId) return { success: false, error: 'MISSING_TICKET_ID', message: 'Falta ticketId.' };
  if (responseText.length < 2 || responseText.length > 4000) return { success: false, error: 'INVALID_RESPONSE', message: 'La respuesta debe tener entre 2 y 4000 caracteres.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const ticket = await findTicketById(ticketId);
  if (!ticket) return { success: false, error: 'TICKET_NOT_FOUND', message: 'Ticket no encontrado.' };
  const nextStatus = requestedStatus === 'resuelto' ? 'resuelto' : (requestedStatus === 'abierto' ? 'abierto' : 'en_proceso');
  const now = nowIso();
  const account = await getAccountDoc(normalizeKey(ticket.usuario));
  await appendTicketMessage(ticketId, { senderRole: 'admin', senderUser: decoded.username, senderEmail: CFG.supportEmail, message: responseText, createdAt: now });
  await updateTicket(ticketId, { admin_response: responseText, admin_user: decoded.username, assigned_admin: String(ticket.assigned_admin || decoded.username), internal_status: 'esperando_cliente', estado: nextStatus, updatedAt: now, responded_at: now, closed_at: nextStatus === 'resuelto' ? now : '' });
  if (account && account.email) {
    await sendEmail({ to: account.email, subject: 'Respuesta a tu ticket | LuckyBase', name: 'Equipo LuckyBase', replyTo: CFG.supportEmail, htmlBody: '<p>El soporte ha respondido a tu ticket.</p>', body: responseText });
  }
  await appendAuditEvent({ eventType: 'ticket_admin_reply', entityType: 'ticket', entityId: ticketId, actorRole: 'admin', actorUser: decoded.username, details: { estado: nextStatus, assignedAdmin: String(ticket.assigned_admin || decoded.username) } });
  return { success: true, message: 'Respuesta enviada y ticket actualizado.', ticket: { ticketId, estado: nextStatus, respondedAt: now } };
}

async function handleAdminUpdateTicketMeta(params) {
  const token = String(params.adminToken || '').trim();
  const ticketId = String(params.ticketId || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  if (!ticketId) return { success: false, error: 'MISSING_TICKET_ID', message: 'Falta ticketId.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const ticket = await findTicketById(ticketId);
  if (!ticket) return { success: false, error: 'TICKET_NOT_FOUND', message: 'Ticket no encontrado.' };
  const assignedAdmin = String(params.assignedAdmin || '').trim();
  const internalStatusRaw = normalizeKey(params.internalStatus || 'sin_asignar');
  const allowed = { sinasignar: 'sin_asignar', enrevision: 'en_revision', bloqueado: 'bloqueado', esperandocliente: 'esperando_cliente', completado: 'completado' };
  const internalStatus = allowed[internalStatusRaw];
  if (!internalStatus) return { success: false, error: 'INVALID_INTERNAL_STATUS', message: 'internalStatus no valido.' };
  const now = nowIso();
  await updateTicket(ticketId, { assigned_admin: assignedAdmin, internal_status: internalStatus, updatedAt: now });
  await appendAuditEvent({ eventType: 'ticket_meta_updated', entityType: 'ticket', entityId: ticketId, actorRole: 'admin', actorUser: decoded.username, details: { assignedAdmin, internalStatus } });
  return { success: true, message: 'Metadatos de ticket actualizados.', ticket: { ticketId, assignedAdmin, internalStatus, updatedAt: now } };
}

async function handleAdminListTickets(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const statusFilter = String(params.estado || '').trim();
  const userFilter = String(params.usuario || '').trim();
  const assignedAdminFilter = String(params.assignedAdmin || '').trim();
  const internalStatusFilter = String(params.internalStatus || '').trim();
  const slaOnly = parseBoolean(params.slaOnly);
  const limit = Math.min(200, Math.max(1, Math.floor(Number(params.limit) || 120)));
  const snap = await db().collection('lbTickets').orderBy('created_at', 'desc').limit(Math.max(limit * 2, 200)).get();
  const tickets = [];
  for (const doc of snap.docs) {
    const row = doc.data() || {};
    if (statusFilter && normalizeKey(row.estado) !== normalizeKey(statusFilter)) continue;
    if (userFilter && normalizeKey(row.usuario) !== normalizeKey(userFilter)) continue;
    if (assignedAdminFilter && normalizeKey(row.assigned_admin) !== normalizeKey(assignedAdminFilter)) continue;
    if (internalStatusFilter && normalizeKey(row.internal_status) !== normalizeKey(internalStatusFilter)) continue;
    const createdMs = Date.parse(String(row.created_at || '')) || 0;
    const hasResponse = !!String(row.admin_response || '').trim() || !!String(row.responded_at || '').trim();
    const isHigh = normalizeKey(row.prioridad) === 'alta';
    const ageMs = Date.now() - createdMs;
    if (slaOnly && !( (!hasResponse && ageMs >= 24 * 60 * 60 * 1000) || (!hasResponse && isHigh) )) continue;
    const account = await getAccountDoc(normalizeKey(row.usuario));
    tickets.push({
      rowIndex: Number(row.rowIndex || 0),
      ticketId: String(row.ticket_id || doc.id),
      usuario: String(row.usuario || ''),
      clientEmail: String(row.client_email || ''),
      asunto: String(row.asunto || ''),
      mensaje: String(row.mensaje || ''),
      prioridad: String(row.prioridad || 'media'),
      estado: String(row.estado || 'abierto'),
      adminResponse: String(row.admin_response || ''),
      adminUser: String(row.admin_user || ''),
      assignedAdmin: String(row.assigned_admin || ''),
      internalStatus: String(row.internal_status || 'sin_asignar'),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      respondedAt: String(row.responded_at || ''),
      source: String(row.source || ''),
      ticketPlanId: String(row.ticket_plan_id || ''),
      ticketPlan: String(row.ticket_plan || ''),
      ticketPlanType: String(row.ticket_plan_type || ''),
      ticketPlanDomain: String(row.ticket_plan_domain || ''),
      ticketPlanOrder: String(row.ticket_plan_order || ''),
      slaPending24h: !hasResponse && ageMs >= 24 * 60 * 60 * 1000,
      slaHighNoResponse: !hasResponse && isHigh,
      ageHours: Math.floor(Math.max(0, ageMs) / (60 * 60 * 1000)),
      messages: await getTicketMessages(doc.id, 120),
      clientName: String(account && account.nombre ? account.nombre : ''),
      clientPlan: String(row.ticket_plan || account?.activePlanId || ''),
      clientPlanType: String(row.ticket_plan_type || ''),
    });
    if (tickets.length >= limit) break;
  }
  return { success: true, tickets };
}

async function handleContact(params) {
  const nombre = String(params.nombre || '').trim();
  const email = String(params.email || '').trim();
  const mensaje = String(params.mensaje || '').trim();
  const company = String(params.company || params.website || '').trim();
  const termsAccepted = parseBoolean(params.terms);
  if (company) return { success: true, message: 'Mensaje enviado correctamente.' };
  if (!nombre || !email || !mensaje) return { success: false, error: 'MISSING_FIELDS', message: 'Faltan campos obligatorios.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { success: false, error: 'INVALID_EMAIL', message: 'El email no es valido.' };
  if (!termsAccepted) return { success: false, error: 'TERMS_REQUIRED', message: 'Debes aceptar los terminos y condiciones.' };
  const recipients = [CFG.supportEmail, CFG.fallbackAdminEmail].filter(Boolean);
  const result = await sendEmail({ to: recipients.join(','), subject: 'Nuevo mensaje de contacto | LuckyBase', name: 'LuckyBase Web', replyTo: email, htmlBody: '<p>Nuevo mensaje de contacto.</p>', body: `Nombre: ${nombre}\nEmail: ${email}\nMensaje:\n${mensaje}` });
  if (!result.sent) return { success: false, error: 'SEND_FAILED', message: 'No se pudo enviar el mensaje. Intentalo de nuevo.' };
  await sendEmail({ to: email, subject: 'Hemos recibido tu mensaje | LuckyBase', name: 'Equipo LuckyBase', replyTo: CFG.supportEmail, htmlBody: '<p>Gracias por escribirnos. Te responderemos en menos de 24 horas.</p>', body: 'Gracias por escribirnos. Te responderemos en menos de 24 horas.' });
  return { success: true, message: 'Mensaje enviado correctamente. Te responderemos pronto.' };
}

async function handleCareerApplication(params) {
  const name = String(params.name || params.nombre || '').trim();
  const email = String(params.email || '').trim();
  const phone = String(params.phone || '').trim();
  const birthDate = String(params.birthDate || params.fechaNacimiento || '').trim();
  const city = String(params.city || params.localidad || '').trim();
  const availability = String(params.availability || '').trim();
  const experienceLevel = String(params.experienceLevel || '').trim();
  const salesExperience = String(params.salesExperience || '').trim();
  const message = String(params.message || '').trim();
  const consentAccepted = parseBoolean(params.consent);
  if (!name || !email || !phone || !birthDate || !city || !availability || !experienceLevel || !salesExperience || !message) return { success: false, error: 'MISSING_FIELDS', message: 'Faltan campos obligatorios.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { success: false, error: 'INVALID_EMAIL', message: 'El email no es valido.' };
  if (!consentAccepted) return { success: false, error: 'CONSENT_REQUIRED', message: 'Debes aceptar el uso de datos para revisar tu candidatura.' };
  const ref = db().collection('lbCareerApplications').doc();
  await ref.set({ id: ref.id, name, email, phone, birthDate, city, availability, experienceLevel, salesExperience, message, consentAccepted, createdAt: nowIso(), originUrl: String(params.originUrl || '').trim() }, { merge: true });
  await appendAuditEvent({ eventType: 'career_application_received', entityType: 'career_application', entityId: ref.id, actorRole: 'guest', actorUser: email, details: { city, availability } });
  await sendEmail({ to: [CFG.supportEmail, CFG.fallbackAdminEmail].filter(Boolean).join(','), subject: 'Nueva candidatura | LuckyBase', name: 'LuckyBase Web', replyTo: email, htmlBody: '<p>Nueva candidatura recibida.</p>', body: `Nueva candidatura: ${name} <${email}>` });
  await sendEmail({ to: email, subject: 'Hemos recibido tu candidatura | LuckyBase', name: 'Equipo LuckyBase', replyTo: CFG.supportEmail, htmlBody: '<p>Hemos recibido tu candidatura correctamente.</p>', body: 'Hemos recibido tu candidatura correctamente.' });
  return { success: true, message: 'Candidatura enviada correctamente.' };
}

async function handleAdminGetClientDetailByEmail(params) {
  const token = String(params.adminToken || '').trim();
  if (!token) return { success: false, error: 'MISSING_TOKEN', message: 'Falta adminToken.' };
  const decoded = verifyAdminToken(token);
  if (!decoded.valid) return { success: false, error: decoded.error || 'INVALID_TOKEN', message: 'Sesion no valida.' };
  const email = String(params.email || '').trim().toLowerCase();
  const found = await findClientSummaryByEmail(email);
  if (!found) return { success: true, found: false };
  return { success: true, found: true, client: { rowIndex: found.rowIndex, usuario: found.usuario, nombre: found.nombre, email: found.email, totalPlanes: found.totalPlans } };
}

async function handleRoute(params, req) {
  const action = normalizeKey(params.action || '');
  if (action === 'login') return handleLogin(params, req);
  if (action === 'validate') return handleValidate(params, req);
  if (action === 'logout') return handleLogout(params, req);
  if (action === 'contact') return handleContact(params, req);
  if (action === 'careerapplication') return handleCareerApplication(params, req);
  if (action === 'createticket') return handleCreateTicket(params, req);
  if (action === 'listtickets') return handleListTickets(params, req);
  if (action === 'clientreplyticket') return handleClientReplyTicket(params, req);
  if (action === 'clientalerts') return handleClientAlerts(params, req);
  if (action === 'clientbillinghistory') return handleClientBillingHistory(params, req);
  if (action === 'clientsecurityoverview') return handleClientSecurityOverview(params, req);
  if (action === 'clientrevokesession') return handleClientRevokeSession(params, req);
  if (action === 'clientchangepassword') return handleClientChangePassword(params, req);
  if (action === 'adminlogin') return handleAdminLogin(params, req);
  if (action === 'adminvalidate') return handleAdminValidate(params, req);
  if (action === 'admindashboard') return handleAdminDashboard(params, req);
  if (action === 'adminlistclients') return handleAdminListClients(params, req);
  if (action === 'admincreateclient') return handleAdminCreateClient(params, req);
  if (action === 'admindeleteclient') return handleAdminDeleteClient(params, req);
  if (action === 'admingetclientdetail') return handleAdminGetClientDetail(params, req);
  if (action === 'adminupdateclient') return handleAdminUpdateClient(params, req);
  if (action === 'adminfindclientbyemail') return handleAdminFindClientByEmail(params, req);
  if (action === 'adminlisttickets') return handleAdminListTickets(params, req);
  if (action === 'adminreplyticket') return handleAdminReplyTicket(params, req);
  if (action === 'adminupdateticketmeta') return handleAdminUpdateTicketMeta(params, req);
  if (action === 'adminbulkclients') return handleAdminBulkClients(params, req);
  if (action === 'admingetclient360') return handleAdminGetClient360(params, req);
  if (action === 'adminglobalsearch') return handleAdminGlobalSearch(params, req);
  if (action === 'adminlistauditlog') return handleAdminAudit(params, req);
  if (action === 'admincloudflarestatus') return handleAdminCloudflareStatus(params, req);
  if (!action && params.usuario && params.password) return handleLogin(params, req);
  if (!action && params.nombre && params.email && params.mensaje) return handleContact(params, req);
  return { success: false, error: 'INVALID_ACTION', message: 'Accion no valida.' };
}

function parseRequestBody(req) {
  if (req && req.body && typeof req.body === 'object') return req.body;
  if (req && req.body && typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (_err) {
      return {};
    }
  }
  if (req && req.query && Object.keys(req.query).length) return req.query;
  return {};
}

exports.luckybasePanelApi = onRequest({ region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' }, (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      const params = req.method === 'GET' ? { ...req.query } : parseRequestBody(req);
      const payload = await handleRoute(params || {}, req);
      return json(res, 200, payload);
    } catch (_error) {
      return json(res, 500, { success: false, error: 'SERVER_ERROR', message: 'Error interno del servidor.' });
    }
  });
});
