// Scénario de bout en bout sur la pile lancée par docker compose (API, détection, notification, Node-RED, broker, base, web).
// Une chute est envoyée par la « montre » (HTTP vers Node-RED) ; on vérifie ce que voit chaque rôle,
// en temps réel (WebSocket) et en consultation (REST), ainsi que les règles d'accès.
//
//   docker compose up -d --build        (délais raccourcis : PRE_CONFIRMATION_DELAY_S, CRITICAL_ESCALATION_DELAY_S)
//   node apps/api-gateway/test/e2e/fall-scenario.e2e.mjs

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const mqtt = require('mqtt');

const API = process.env.API_URL ?? 'http://localhost:3000';
const NODE_RED = process.env.NODE_RED_URL ?? 'http://localhost:1880';
const WEB = process.env.WEB_URL ?? 'http://localhost:8080';
const SENIOR = 'senior-001';
const PRE_S = Number(process.env.PRE_CONFIRMATION_DELAY_S || 60);
const CRIT_S = Number(process.env.CRITICAL_ESCALATION_DELAY_S || 300);
const INACTIVITY_CHECK_S = Number(process.env.INACTIVITY_CHECK_INTERVAL_S || 60);
const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'dev-service-token-change-me';
let originalThresholds = [];
let inactivityId;
let broker;

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (error) {
    results.push(['FAIL', `${name} -> ${error.message.split('\n')[0]}`]);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(predicate, ms, label) {
  for (let t = 0; t < ms; t += 200) {
    if (predicate()) return;
    await sleep(200);
  }
  throw new Error(`délai dépassé : ${label}`);
}
async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// 0. L'API répond
for (let i = 0; i < 90; i++) {
  try {
    if ((await api('/health')).status === 200) break;
  } catch {}
  await sleep(1000);
}

const tokens = {};
const inbox = { SENIOR: [], FAMILY: [], MEDICAL: [] };
const sockets = [];

await step('liste des comptes et connexion des trois rôles', async () => {
  const users = (await api('/auth/users')).body;
  const byRole = Object.fromEntries(users.map((u) => [u.role, u.email]));
  assert.deepEqual(Object.keys(byRole).sort(), ['FAMILY', 'MEDICAL', 'SENIOR']);
  for (const [role, email] of Object.entries(byRole)) {
    const { status, body } = await api('/auth/login', { method: 'POST', body: { email } });
    assert.equal(status, 200);
    tokens[role] = body.token;
  }
});

await step('/me : le médical suit senior-001', async () => {
  const { body } = await api('/me', { token: tokens.MEDICAL });
  assert.equal(body.role, 'MEDICAL');
  assert.deepEqual(body.seniors.map((s) => s.seniorId), [SENIOR]);
});

await step('règles d\'accès : sans jeton 401, autre senior 403, mesures interdites à la famille', async () => {
  const noToken = await api(`/seniors/${SENIOR}/status`);
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.error.code, 'UNAUTHORIZED');
  assert.equal((await api('/seniors/senior-999/status', { token: tokens.FAMILY })).status, 403);
  assert.equal((await api(`/seniors/${SENIOR}/measurements?type=HEART_RATE`, { token: tokens.FAMILY })).status, 403);
});

await step('temps réel : les trois rôles se connectent', async () => {
  for (const role of Object.keys(inbox)) {
    const socket = io(API, { auth: { token: tokens[role] }, transports: ['websocket'] });
    sockets.push(socket);
    for (const type of ['preconfirmation.requested', 'alert.created', 'alert.updated', 'notification.created']) {
      socket.on(type, (message) => inbox[role].push({ type, message }));
    }
    await new Promise((resolve, reject) => {
      socket.once('ready', resolve);
      socket.once('connect_error', reject);
      setTimeout(() => reject(new Error(`socket ${role} : pas de « ready »`)), 10_000);
    });
  }
});

let alertId;
await step('chute envoyée par la montre (HTTP -> Node-RED) : seul le senior reçoit « tout va bien ? »', async () => {
  const res = await fetch(`${NODE_RED}/ingest/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensorId: 'watch-001', event: 'FALL_IMPACT', value: 9.8 }),
  });
  assert.equal(res.status, 202);
  await waitUntil(() => inbox.SENIOR.some((m) => m.type === 'preconfirmation.requested'), 10_000, 'pré-confirmation');
  alertId = inbox.SENIOR.find((m) => m.type === 'preconfirmation.requested').message.alertId;
  await sleep(500);
  assert.equal(inbox.FAMILY.length, 0, 'la famille ne doit pas être sollicitée au niveau 1');
  assert.equal(inbox.MEDICAL.length, 0, 'le médical ne doit pas être sollicité au niveau 1');
});

await step('niveau 2 : famille et médical reçoivent l\'alerte WARNING, projetée selon le rôle', async () => {
  await waitUntil(() => inbox.FAMILY.some((m) => m.type === 'alert.created'), (PRE_S + 10) * 1000, 'alerte WARNING');
  const family = inbox.FAMILY.find((m) => m.type === 'alert.created').message;
  await waitUntil(() => inbox.MEDICAL.some((m) => m.type === 'alert.created'), 5_000, 'alerte médical');
  const medical = inbox.MEDICAL.find((m) => m.type === 'alert.created').message;
  assert.equal(family.alertId, alertId);
  assert.equal(family.severity, 'WARNING');
  assert.equal(family.escalationCause, null, 'la cause clinique n\'est pas envoyée à la famille');
  assert.equal(medical.escalationCause, 'NO_RESPONSE');
});

await step('niveau 3 : l\'alerte passe CRITICAL (NO_RECOVERY)', async () => {
  await waitUntil(
    () => inbox.MEDICAL.some((m) => m.type === 'alert.updated' && m.message.severity === 'CRITICAL'),
    (CRIT_S + 10) * 1000,
    'alerte CRITICAL',
  );
  const medical = inbox.MEDICAL.filter((m) => m.type === 'alert.updated').at(-1).message;
  assert.equal(medical.escalationCause, 'NO_RECOVERY');
});

const notificationsFor = (role) =>
  inbox[role].filter((m) => m.type === 'notification.created' && m.message.alertId === alertId).map((m) => m.message);

await step('notifications (service de notification -> API) : routage selon la gravité, à chaque destinataire', async () => {
  await waitUntil(() => notificationsFor('FAMILY').length >= 2 && notificationsFor('MEDICAL').length >= 2, 10_000, 'notifications');
  const family = notificationsFor('FAMILY').map((n) => `${n.severity}/${n.priority}`);
  const medical = notificationsFor('MEDICAL').map((n) => `${n.severity}/${n.priority}`);
  assert.deepEqual(family, ['WARNING/NORMAL', 'CRITICAL/URGENT']);
  assert.deepEqual(medical, ['WARNING/INFO', 'CRITICAL/URGENT']);
  assert.ok(notificationsFor('MEDICAL')[0].title.startsWith('Pour information'));
  assert.equal(notificationsFor('SENIOR').length, 0, 'le senior ne reçoit pas de notification');
});

await step('boîte de réception : la famille retrouve ses notifications et les marque comme lues', async () => {
  const unread = (await api('/me/notifications?unreadOnly=true', { token: tokens.FAMILY })).body;
  const mine = unread.items.filter((n) => n.alertId === alertId);
  assert.equal(mine.length, 2);
  const { status, body } = await api(`/me/notifications/${mine[0].notificationId}/read`, { method: 'POST', token: tokens.FAMILY });
  assert.equal(status, 200);
  assert.ok(body.readAt);
  const after = (await api('/me/notifications?unreadOnly=true', { token: tokens.FAMILY })).body;
  assert.equal(after.items.filter((n) => n.alertId === alertId).length, 1);
  // La notification d'une autre personne est introuvable pour elle.
  const otherRead = await api(`/me/notifications/${mine[1].notificationId}/read`, { method: 'POST', token: tokens.MEDICAL });
  assert.equal(otherRead.status, 404);
});

await step('REST : historique, statut et mesures cohérents avec le temps réel', async () => {
  const list = (await api(`/seniors/${SENIOR}/alerts`, { token: tokens.MEDICAL })).body;
  assert.equal(list.items[0].alertId, alertId);
  assert.equal(list.items[0].severity, 'CRITICAL');
  const status = (await api(`/seniors/${SENIOR}/status`, { token: tokens.FAMILY })).body;
  assert.equal(status.overallStatus, 'ALERT_IN_PROGRESS');
  assert.equal(status.latestHeartRate, null);
  const seniorView = (await api(`/seniors/${SENIOR}/alerts/${alertId}`, { token: tokens.SENIOR })).body;
  assert.equal(seniorView.severity, null, 'le senior ne reçoit pas la gravité');
  const impacts = (await api(`/seniors/${SENIOR}/measurements?type=FALL_IMPACT`, { token: tokens.MEDICAL })).body;
  assert.ok(impacts.items.some((p) => p.value === 9.8 && p.unit === 'g'), 'l\'impact est dans l\'historique des signaux');
});

await step('prise en charge par le médical : 200, et la famille la voit en temps réel', async () => {
  assert.equal((await api(`/seniors/${SENIOR}/alerts/${alertId}/acknowledge`, { method: 'POST', token: tokens.FAMILY })).status, 403);
  const { status, body } = await api(`/seniors/${SENIOR}/alerts/${alertId}/acknowledge`, { method: 'POST', token: tokens.MEDICAL });
  assert.equal(status, 200);
  assert.ok(body.acknowledgedAt);
  await waitUntil(() => inbox.FAMILY.some((m) => m.type === 'alert.updated' && m.message.acknowledgedAt), 5_000, 'prise en charge visible');
});

await step('clôture après intervention : médical uniquement, la famille la voit, l\'alerte n\'est plus en cours', async () => {
  assert.equal((await api(`/seniors/${SENIOR}/alerts/${alertId}/close`, { method: 'POST', token: tokens.FAMILY })).status, 403);
  const { status, body } = await api(`/seniors/${SENIOR}/alerts/${alertId}/close`, { method: 'POST', token: tokens.MEDICAL });
  assert.equal(status, 200);
  assert.equal(body.status, 'RESOLVED');
  assert.ok(body.closedAt);
  await waitUntil(() => inbox.FAMILY.some((m) => m.type === 'alert.updated' && m.message.closedAt), 5_000, 'clôture visible');
  // D'autres alertes peuvent rester ouvertes si la base n'est pas neuve : on vérifie celle du scénario.
  const { activeAlert } = (await api(`/seniors/${SENIOR}/status`, { token: tokens.FAMILY })).body;
  assert.notEqual(activeAlert?.alertId, alertId, 'l\'alerte clôturée ne doit plus être l\'alerte en cours');
  const again = await api(`/seniors/${SENIOR}/alerts/${alertId}/close`, { method: 'POST', token: tokens.MEDICAL });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'CONFLICT');
});

// --- Actions du senior dans l'application : application -> API -> Node-RED -> signal (ADR 0007) ---

let canceledId;
await step('« tout va bien » dans l\'application : l\'API transmet, la levée de doute est annulée, la famille n\'est pas sollicitée', async () => {
  const before = inbox.SENIOR.filter((m) => m.type === 'preconfirmation.requested').length;
  const res = await fetch(`${NODE_RED}/ingest/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensorId: 'watch-001', event: 'FALL_IMPACT', value: 7.5 }),
  });
  assert.equal(res.status, 202);
  await waitUntil(() => inbox.SENIOR.filter((m) => m.type === 'preconfirmation.requested').length > before, 10_000, 'nouvelle pré-confirmation');
  canceledId = inbox.SENIOR.filter((m) => m.type === 'preconfirmation.requested').at(-1).message.alertId;
  await waitUntil(() => inbox.SENIOR.some((m) => m.type === 'alert.created' && m.message.alertId === canceledId), 5_000, 'alerte au journal');

  const path = `/seniors/${SENIOR}/alerts/${canceledId}/cancel`;
  assert.equal((await api(path, { method: 'POST', token: tokens.FAMILY })).status, 403, 'seul le senior annule');
  const { status, body } = await api(path, { method: 'POST', token: tokens.SENIOR });
  assert.equal(status, 202);
  assert.ok(body.eventId, 'eventId du signal CANCEL_ALERT produit par Node-RED');
  await waitUntil(
    () => inbox.SENIOR.some((m) => m.type === 'alert.updated' && m.message.alertId === canceledId && m.message.status === 'RESOLVED'),
    5_000,
    'annulation visible',
  );
  const done = (await api(`/seniors/${SENIOR}/alerts/${canceledId}`, { token: tokens.MEDICAL })).body;
  assert.equal(done.cancellationCause, 'SENIOR_CANCELED');
  assert.ok(!inbox.FAMILY.some((m) => m.message.alertId === canceledId), 'la famille ne reçoit rien d\'une levée de doute annulée');
  const again = await api(path, { method: 'POST', token: tokens.SENIOR });
  assert.equal(again.status, 409, 'une alerte terminée ne s\'annule plus');
});

await step('« j\'ai besoin d\'aide » dans l\'application : alerte de niveau 3 et notifications urgentes', async () => {
  assert.equal((await api(`/seniors/${SENIOR}/help`, { method: 'POST', token: tokens.MEDICAL })).status, 403, 'seul le senior demande de l\'aide');
  const { status, body } = await api(`/seniors/${SENIOR}/help`, { method: 'POST', token: tokens.SENIOR });
  assert.equal(status, 202);
  assert.ok(body.eventId);
  await waitUntil(
    () => inbox.FAMILY.some((m) => m.type === 'notification.created' && m.message.reason === 'HELP_REQUESTED' && m.message.priority === 'URGENT'),
    10_000,
    'notification d\'aide',
  );
  const helpAlertId = inbox.FAMILY.find((m) => m.type === 'notification.created' && m.message.reason === 'HELP_REQUESTED').message.alertId;
  const signals = (await api(`/seniors/${SENIOR}/alerts/${helpAlertId}`, { token: tokens.MEDICAL })).body;
  assert.equal(signals.severity, 'CRITICAL');
  assert.equal(signals.escalationCause, 'IMMEDIATE');
  // Remise à zéro pour la suite : le médical clôture la demande d'aide.
  assert.equal((await api(`/seniors/${SENIOR}/alerts/${helpAlertId}/close`, { method: 'POST', token: tokens.MEDICAL })).status, 200);
});

// --- Inactivité (ADR 0010) : seuils lus par la détection à l'API, puis mis à jour par message ---

await step('seuils d\'inactivité : médical uniquement ; la détection les lit avec sa clé de service', async () => {
  assert.equal((await api(`/seniors/${SENIOR}/thresholds`, { token: tokens.FAMILY })).status, 403);
  const { status, body } = await api(`/seniors/${SENIOR}/thresholds`, { token: tokens.MEDICAL });
  assert.equal(status, 200);
  assert.equal(body.timeZone, 'Europe/Paris');
  originalThresholds = body.thresholds;
  assert.equal((await api('/internal/activity-profiles')).status, 401, 'clé de service obligatoire');
  const internal = await fetch(`${API}/internal/activity-profiles`, { headers: { 'x-service-token': SERVICE_TOKEN } });
  assert.equal(internal.status, 200);
  assert.ok((await internal.json()).some((p) => p.seniorId === SENIOR));
});

await step('inactivité : seuil d\'une minute fixé par le médical, levée de doute puis niveau 2 (fréquence cardiaque normale)', async () => {
  broker = await mqtt.connectAsync(MQTT_URL, { clientId: `e2e-${Date.now()}` });
  const motion = () => broker.publishAsync('zigbee2mqtt/pir-salon', JSON.stringify({ occupancy: true }), { qos: 1 });
  await motion(); // une activité : le compte repart de maintenant
  const heart = await fetch(`${NODE_RED}/ingest/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensorId: 'watch-001', event: 'HEART_RATE', value: 68 }),
  });
  assert.equal(heart.status, 202);

  const oneMinute = { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 1, timeRange: null };
  assert.equal((await api(`/seniors/${SENIOR}/thresholds`, { method: 'PUT', token: tokens.FAMILY, body: { thresholds: [oneMinute] } })).status, 403);
  const invalid = await api(`/seniors/${SENIOR}/thresholds`, { method: 'PUT', token: tokens.MEDICAL, body: { thresholds: [{ ...oneMinute, durationInMinutes: 0 }] } });
  assert.equal(invalid.status, 400);
  const put = await api(`/seniors/${SENIOR}/thresholds`, { method: 'PUT', token: tokens.MEDICAL, body: { thresholds: [oneMinute] } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.thresholds, [oneMinute]);

  const isInactivity = (m) => m.type === 'preconfirmation.requested' && m.message.reason === 'PROLONGED_INACTIVITY';
  await waitUntil(() => inbox.SENIOR.some(isInactivity), (60 + INACTIVITY_CHECK_S + 20) * 1000, 'levée de doute d\'inactivité');
  inactivityId = inbox.SENIOR.find(isInactivity).message.alertId;
  await waitUntil(
    () => inbox.MEDICAL.some((m) => m.type === 'alert.created' && m.message.alertId === inactivityId),
    (PRE_S + 10) * 1000,
    'alerte d\'inactivité de niveau 2',
  );
  const medical = inbox.MEDICAL.find((m) => m.type === 'alert.created' && m.message.alertId === inactivityId).message;
  assert.deepEqual([medical.reason, medical.severity, medical.escalationCause], ['PROLONGED_INACTIVITY', 'WARNING', 'NO_RESPONSE']);
  await waitUntil(
    () => inbox.FAMILY.some((m) => m.type === 'notification.created' && m.message.alertId === inactivityId && m.message.priority === 'NORMAL'),
    5_000,
    'notification de la famille',
  );

  await motion(); // la personne bouge : pas de passage au niveau 3
  await sleep((CRIT_S + 3) * 1000);
  assert.ok(
    !inbox.MEDICAL.some((m) => m.type === 'alert.updated' && m.message.alertId === inactivityId && m.message.severity === 'CRITICAL'),
    'une activité après le niveau 2 évite le niveau 3',
  );
});

await step('remise en état : seuils d\'origine, alerte d\'inactivité clôturée par le médical', async () => {
  const restored = await api(`/seniors/${SENIOR}/thresholds`, { method: 'PUT', token: tokens.MEDICAL, body: { thresholds: originalThresholds } });
  assert.equal(restored.status, 200);
  if (inactivityId) {
    assert.equal((await api(`/seniors/${SENIOR}/alerts/${inactivityId}/close`, { method: 'POST', token: tokens.MEDICAL })).status, 200);
  }
  await broker?.endAsync();
});

await step('application web : servie par nginx, qui relaie /api et /socket.io vers l\'API', async () => {
  const page = await fetch(`${WEB}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root">/);
  const health = await fetch(`${WEB}/api/health`);
  assert.equal(health.status, 200);
  const socket = io(WEB, { auth: { token: tokens.FAMILY }, transports: ['websocket'] });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('ready', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('pas de « ready » via nginx')), 10_000);
  });
});

for (const socket of sockets) socket.close();
for (const [status, name] of results) console.log(status, name);
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`${results.length - failed}/${results.length} étapes réussies`);
process.exit(failed ? 1 : 0);
