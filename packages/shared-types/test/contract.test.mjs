// Vérifie que les trois représentations du contrat de données restent d'accord :
// le document (docs/format-evenements.md), les JSON Schemas et les types TypeScript.
// Vérifie aussi que le flow Node-RED produit bien des messages conformes aux schémas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const repo = join(pkg, '..', '..');
const read = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n');

const ajv = new Ajv({ strict: true, allErrors: true });
const load = (name) => JSON.parse(read(join(pkg, 'schemas', name)));
const schemas = {
  signal: load('raw-signal.schema.json'),
  event: load('domain-event.schema.json'),
  rejected: load('rejected-message.schema.json'),
  notification: load('notification.schema.json'),
  profile: load('activity-profile.schema.json'),
};
const validate = {
  signal: ajv.compile(schemas.signal),
  event: ajv.compile(schemas.event),
  rejected: ajv.compile(schemas.rejected),
  notification: ajv.compile(schemas.notification),
  profile: ajv.compile(schemas.profile),
};
const errorsOf = (kind) => JSON.stringify(validate[kind].errors);

const sorted = (list) => [...list].sort();

// ---------------------------------------------------------------------------
// 1. Exemples du document
// ---------------------------------------------------------------------------

const doc = read(join(repo, 'docs', 'format-evenements.md'));
const NOW = '2026-01-15T08:12:45.000Z';
const UUID = 'a1b2c3d4-0001-4000-8000-000000000001';

test('les exemples complets du document respectent les schémas', () => {
  let checked = 0;
  for (const [, body] of doc.matchAll(/```json\n([\s\S]*?)```/g)) {
    const o = JSON.parse(body);
    let kind = null;
    if ('sensorId' in o && 'eventId' in o) kind = 'signal'; // un payload SensorStatusChanged porte aussi sensorId
    else if ('originalMessage' in o) kind = 'rejected';
    else if (o.type === 'NotificationRequested') kind = 'notification';
    else if (o.type === 'ActivityProfileUpdated') kind = 'profile';
    else if ('seniorId' in o && o.payload && Object.keys(o.payload).length > 0) kind = 'event';
    if (!kind) continue; // fragment de payload ou enveloppe d'illustration
    checked++;
    assert.ok(validate[kind](o), `${kind} ${o.type ?? o.reason} : ${errorsOf(kind)}`);
  }
  assert.ok(checked >= 7, `trop peu d'exemples trouvés (${checked}) : le document a-t-il changé de format ?`);
});

test('les payloads documentés par type respectent les schémas', () => {
  let checked = 0;
  for (const [, type, body] of doc.matchAll(/### `(\w+)`\n```json\n([\s\S]*?)```/g)) {
    if (type === 'NotificationRequested' || type === 'ActivityProfileUpdated') continue; // exemples complets (§9, §10), validés par le test précédent
    const payload = JSON.parse(body);
    const isSignal = /^[A-Z_]+$/.test(type);
    const message = isSignal
      ? { eventId: UUID, seniorId: 'senior-001', sensorId: 'sensor-1', type, timestamp: NOW, payload }
      : { eventId: UUID, seniorId: 'senior-001', type, timestamp: NOW, payload };
    const kind = isSignal ? 'signal' : 'event';
    checked++;
    assert.ok(validate[kind](message), `${type} : ${errorsOf(kind)}`);
  }
  assert.ok(checked >= 10, `trop peu de payloads trouvés (${checked})`);
});

// ---------------------------------------------------------------------------
// 2. Messages invalides : les schémas doivent les refuser
// ---------------------------------------------------------------------------

const signal = {
  eventId: UUID,
  seniorId: 'senior-001',
  sensorId: 'pir-1',
  type: 'PIR_MOTION',
  timestamp: NOW,
  payload: { room: 'salon' },
};
const without = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

const invalidSignals = {
  'type inconnu': { ...signal, type: 'TEMPERATURE' },
  'sensorId manquant': without(signal, 'sensorId'),
  'seniorId avec un slash': { ...signal, seniorId: 'a/b' },
  'timestamp non UTC': { ...signal, timestamp: '2026-01-15T08:12:45+02:00' },
  'payload d\'un autre type': { ...signal, type: 'HEART_RATE', payload: { room: 'salon' } },
  'champ en trop dans le payload': { ...signal, payload: { room: 'salon', extra: 1 } },
  'état de plaque inconnu': {
    ...signal,
    type: 'PRESSURE_PLATE',
    payload: { room: 'chambre', location: 'lit', state: 'AJAR' },
  },
  'fréquence cardiaque sans unité': { ...signal, type: 'HEART_RATE', payload: { value: 72 } },
  'fréquence cardiaque avec une mauvaise unité': { ...signal, type: 'HEART_RATE', payload: { value: 72, unit: 'g' } },
  'fréquence cardiaque au-delà de 300': { ...signal, type: 'HEART_RATE', payload: { value: 301, unit: 'bpm' } },
  'impact négatif': { ...signal, type: 'FALL_IMPACT', payload: { value: -1, unit: 'g' } },
  'batterie au-delà de 100': { ...signal, type: 'SENSOR_HEARTBEAT', payload: { value: 120, unit: '%' } },
  'bouton d\'aide avec des données': { ...signal, type: 'HELP_BUTTON', payload: { x: 1 } },
};

for (const [name, message] of Object.entries(invalidSignals)) {
  test(`signal refusé : ${name}`, () => assert.equal(validate.signal(message), false));
}

test('notification refusée : le senior n\'est pas un rôle destinataire, et le texte est obligatoire', () => {
  const notification = {
    eventId: UUID,
    seniorId: 'senior-001',
    type: 'NotificationRequested',
    timestamp: NOW,
    payload: { alertId: 'a', sensorId: null, recipientRole: 'FAMILY', priority: 'URGENT', severity: 'CRITICAL', reason: 'FALL_DETECTED', escalationCause: 'NO_RECOVERY', title: 'T', message: 'M' },
  };
  assert.equal(validate.notification(notification), true, errorsOf('notification'));
  assert.equal(validate.notification({ ...notification, payload: { ...notification.payload, recipientRole: 'SENIOR' } }), false);
  assert.equal(validate.notification({ ...notification, payload: { ...notification.payload, message: '' } }), false);
  // Une notification concerne une alerte OU un capteur, jamais les deux, jamais aucun.
  const sensor = { ...notification.payload, alertId: null, sensorId: 'watch-001', severity: 'SYSTEM', reason: null, escalationCause: null };
  assert.equal(validate.notification({ ...notification, payload: sensor }), true, errorsOf('notification'));
  assert.equal(validate.notification({ ...notification, payload: { ...sensor, severity: 'WARNING' } }), false, 'un capteur est toujours SYSTEM');
  assert.equal(validate.notification({ ...notification, payload: { ...notification.payload, sensorId: 'watch-001' } }), false, 'pas les deux');
  assert.equal(validate.notification({ ...notification, payload: { ...sensor, sensorId: null } }), false, 'pas aucun');
});

test("profil d'activité refusé : heure hors format, durée nulle, condition inconnue", () => {
  const message = {
    eventId: UUID,
    seniorId: 'senior-001',
    type: 'ActivityProfileUpdated',
    timestamp: NOW,
    payload: {
      seniorId: 'senior-001',
      timeZone: 'Europe/Paris',
      thresholds: [{ condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, timeRange: { startTime: '22:00', endTime: '07:00' } }],
      absence: null,
      sensors: [{ sensorId: 'watch-001', kind: 'WATCH', room: null, location: null, expectedIntervalMinutes: 15 }],
    },
  };
  assert.equal(validate.profile(message), true, errorsOf('profile'));
  const withThreshold = (patch) => ({ ...message, payload: { ...message.payload, thresholds: [{ ...message.payload.thresholds[0], ...patch }] } });
  assert.equal(validate.profile(withThreshold({ timeRange: { startTime: '24:00', endTime: '07:00' } })), false);
  assert.equal(validate.profile(withThreshold({ durationInMinutes: 0 })), false);
  assert.equal(validate.profile(withThreshold({ condition: 'MAX_HEART_RATE' })), false);
  assert.equal(validate.profile(withThreshold({ timeRange: undefined })), false, 'timeRange est obligatoire (null pour « sans plage »)');
  const withAbsence = (absence) => ({ ...message, payload: { ...message.payload, absence } });
  assert.equal(validate.profile(withAbsence({ since: NOW, until: '2026-01-15T17:00:00.000Z' })), true, errorsOf('profile'));
  assert.equal(validate.profile(withAbsence({ since: NOW, until: '17:00' })), false, 'retour prévu en ISO 8601 UTC');
  assert.equal(validate.profile(withAbsence({ since: NOW })), false, 'retour prévu obligatoire');
  const { absence: _omitted, ...withoutAbsence } = message.payload;
  assert.equal(validate.profile({ ...message, payload: withoutAbsence }), false, 'absence est obligatoire (null si la personne est chez elle)');
  const withSensor = (patch) => ({ ...message, payload: { ...message.payload, sensors: [{ ...message.payload.sensors[0], ...patch }] } });
  assert.equal(validate.profile(withSensor({ kind: 'CAMERA' })), false, 'type de capteur inconnu');
  assert.equal(validate.profile(withSensor({ expectedIntervalMinutes: 0 })), false, 'intervalle attendu de 1 à 1440 min');
});

test("alerte d'inactivité sans signal déclencheur : acceptée (aucun signal depuis le démarrage)", () => {
  const inactivity = {
    eventId: UUID,
    seniorId: 'senior-001',
    type: 'CriticalAlertGenerated',
    timestamp: NOW,
    payload: { alertId: 'a', reason: 'PROLONGED_INACTIVITY', severity: 'CRITICAL', escalationCause: 'NO_HEART_SIGNAL', triggeringEventIds: [] },
  };
  assert.equal(validate.event(inactivity), true, errorsOf('event'));
});

test('événement de domaine refusé : alerte critique sans signal déclencheur', () => {
  assert.equal(
    validate.event({
      eventId: UUID,
      seniorId: 'senior-001',
      type: 'CriticalAlertGenerated',
      timestamp: NOW,
      payload: {
        alertId: 'a',
        reason: 'FALL_DETECTED',
        severity: 'CRITICAL',
        escalationCause: 'NO_RESPONSE',
        triggeringEventIds: [],
      },
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// 3. Types TypeScript, schémas et document utilisent les mêmes valeurs
// ---------------------------------------------------------------------------

const tsValues = (file, name) => {
  const src = read(join(pkg, 'src', file));
  const m = src.match(new RegExp(`export const ${name} = \\{([^}]*)\\} as const`));
  assert.ok(m, `${name} introuvable dans src/${file}`);
  return [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]);
};

test('les enums TypeScript correspondent aux enums des schémas', () => {
  const pairs = [
    ['signals.ts', 'SignalType', schemas.signal.properties.type.enum],
    ['signals.ts', 'PressureState', schemas.signal.definitions.PressurePlatePayload.properties.state.enum],
    ['domain-events.ts', 'DomainEventType', schemas.event.properties.type.enum],
    ['domain-events.ts', 'AlertReason', schemas.event.definitions.AlertReason.enum],
    ['domain-events.ts', 'Severity', schemas.event.definitions.Severity.enum],
    ['domain-events.ts', 'EscalationCause', schemas.event.definitions.EscalationCause.enum],
    ['domain-events.ts', 'CancellationCause', schemas.event.definitions.CancellationCause.enum],
    ['rejected-message.ts', 'RejectionReason', schemas.rejected.properties.reason.enum],
    ['rejected-message.ts', 'IngestionProtocol', schemas.rejected.properties.source.properties.protocol.enum],
    ['notifications.ts', 'NotificationType', schemas.notification.properties.type.enum],
    ['notifications.ts', 'RecipientRole', schemas.notification.properties.payload.properties.recipientRole.enum],
    ['notifications.ts', 'NotificationPriority', schemas.notification.properties.payload.properties.priority.enum],
    ['domain-events.ts', 'Severity', schemas.notification.properties.payload.properties.severity.enum],
    ['domain-events.ts', 'EscalationCause', schemas.notification.properties.payload.properties.escalationCause.enum],
    ['profiles.ts', 'ProfileMessageType', schemas.profile.properties.type.enum],
    ['profiles.ts', 'ThresholdCondition', schemas.profile.definitions.ToleranceThreshold.properties.condition.enum],
    ['profiles.ts', 'SensorKind', schemas.profile.definitions.ExpectedSensor.properties.kind.enum],
    ['profiles.ts', 'SensorKind', schemas.event.definitions.SensorStatusChangedPayload.properties.kind.enum],
    ['domain-events.ts', 'SensorStatus', schemas.event.definitions.SensorStatusChangedPayload.properties.status.enum],
  ];
  for (const [file, name, schemaEnum] of pairs) {
    const values = schemaEnum.filter((v) => v !== null); // champ facultatif : null en plus des valeurs
    assert.deepEqual(sorted(tsValues(file, name)), sorted(values), `${name} : TypeScript et schéma divergent`);
  }
});

test('la liste des types de signaux du document correspond au schéma', () => {
  const section = doc.split('## 2. ')[1]?.split('## 3. ')[0] ?? '';
  const documented = [...section.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(sorted(documented), sorted(schemas.signal.properties.type.enum));
});

test('la liste des événements de domaine du document correspond au schéma', () => {
  const section = doc.split('### Types d\'événements de domaine')[1]?.split('### Énumérations partagées')[0] ?? '';
  const documented = [...section.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(sorted(documented), sorted(schemas.event.properties.type.enum));
});

// ---------------------------------------------------------------------------
// 4. Le flow Node-RED produit des messages conformes
// ---------------------------------------------------------------------------

const flows = JSON.parse(read(join(repo, 'services', 'ingestion', 'flows.json')));
const nodeByName = (name) => {
  const found = flows.filter((n) => n.type === 'function' && n.name === name);
  assert.equal(found.length, 1, `nœud function « ${name} » introuvable ou en double dans flows.json`);
  return found[0];
};

// Exécute le code d'un nœud function comme le ferait Node-RED.
function makeRunner(node, store) {
  const context = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  const run = (code, msg) => new Function('msg', 'node', 'context', 'flow', 'global', 'env', code)(msg, {}, context, context, context, {});
  if (node.initialize) run(node.initialize, {});
  return (msg) => run(node.func, msg);
}

const store = new Map();
const adaptMqtt = makeRunner(nodeByName('Adapter MQTT'), store);
const adaptHttp = makeRunner(nodeByName('Adapter HTTP'), store);
const normalise = makeRunner(nodeByName('Normaliser'), store);
const httpReply = makeRunner(nodeByName('Réponse HTTP'), store);

// Comme le nœud « mqtt in » en mode auto-détection : objet JSON si possible, texte sinon.
function viaMqtt(topic, text) {
  let payload = text;
  try { payload = JSON.parse(text); } catch { /* texte brut */ }
  const msg = adaptMqtt({ topic, payload });
  return msg ? normalise(msg) : null;
}
// Comme le nœud « http in » : msg.req.path porte la route appelée.
function viaHttp(body, route = '/ingest/watch') {
  return normalise(adaptHttp({ payload: body, req: { path: route }, res: {} }));
}
const viaApp = (body) => viaHttp(body, '/ingest/app');
const outcome = (result) => {
  if (!result) return { kind: 'dropped' };
  const [ok, ko] = result;
  if (ok) return { kind: 'signal', msg: ok };
  return { kind: 'rejected', msg: ko };
};

// Messages tels que les publie Zigbee2MQTT (cache_state par défaut : état complet à chaque message).
// Champs repris des pages d'appareils zigbee2mqtt.io.
const AQARA_MOTION = (occupancy) =>
  JSON.stringify({ battery: 100, device_temperature: 23, illuminance: 112, linkquality: 87, occupancy, power_outage_count: 0, voltage: 3025 });
const TUYA_BED = (occupancy, battery = 95) =>
  JSON.stringify({ battery, illuminance: 3, interval_time: 5, linkquality: 102, occupancy, presence_delay: 30, presence_time: 3, sensitivity: 'middle', work_state: occupancy ? 'presence' : 'none' });

const cases = [
  // [libellé, résultat, type produit | motif de rejet | 'dropped']
  ['PIR : mouvement', () => viaMqtt('zigbee2mqtt/pir-cuisine', '{"occupancy":true}'), 'signal', 'PIR_MOTION'],
  ['PIR : fin de détection', () => viaMqtt('zigbee2mqtt/pir-cuisine', '{"occupancy":false}'), 'dropped'],
  ['PIR : heartbeat', () => viaMqtt('zigbee2mqtt/pir-chambre', '{"battery":12}'), 'signal', 'SENSOR_HEARTBEAT'],
  ['PIR : message réel de détection (Aqara RTCGQ11LM)', () => viaMqtt('zigbee2mqtt/pir-cuisine', AQARA_MOTION(true)), 'signal', 'PIR_MOTION'],
  ['PIR : message réel de fin de détection, batterie connue', () => viaMqtt('zigbee2mqtt/pir-cuisine', AQARA_MOTION(false)), 'signal', 'SENSOR_HEARTBEAT'],
  ['message du pont Zigbee2MQTT', () => viaMqtt('zigbee2mqtt/bridge', '{"state":"online"}'), 'dropped'],
  ['plaque : appui (Tuya TS0601)', () => viaMqtt('zigbee2mqtt/plate-lit', TUYA_BED(true)), 'signal', 'PRESSURE_PLATE'],
  ['plaque : relâchée (Tuya TS0601)', () => viaMqtt('zigbee2mqtt/plate-lit', TUYA_BED(false)), 'signal', 'PRESSURE_PLATE'],
  ['montre : fréquence cardiaque', () => viaHttp({ sensorId: 'watch-001', event: 'HEART_RATE', value: 72 }), 'signal', 'HEART_RATE'],
  ['montre : fréquence cardiaque nulle', () => viaHttp({ sensorId: 'watch-001', event: 'HEART_RATE', value: 0 }), 'signal', 'HEART_RATE'],
  ['montre : chute', () => viaHttp({ sensorId: 'watch-001', event: 'FALL_IMPACT', value: 9.8 }), 'signal', 'FALL_IMPACT'],
  ['montre : bouton d\'aide', () => viaHttp({ sensorId: 'watch-001', event: 'HELP_BUTTON' }), 'signal', 'HELP_BUTTON'],
  ['montre : annulation avec identifiant', () => viaHttp({ sensorId: 'watch-001', event: 'CANCEL_ALERT', alertId: 'alert-123' }), 'signal', 'CANCEL_ALERT'],
  ['montre : annulation globale', () => viaHttp({ sensorId: 'watch-001', event: 'CANCEL_ALERT' }), 'signal', 'CANCEL_ALERT'],
  ['montre : heartbeat', () => viaHttp({ sensorId: 'watch-001', event: 'SENSOR_HEARTBEAT', battery: 84 }), 'signal', 'SENSOR_HEARTBEAT'],
  ["application : « j'ai besoin d'aide »", () => viaApp({ sensorId: 'app-senior-001', event: 'HELP_BUTTON' }), 'signal', 'HELP_BUTTON'],
  ['application : « tout va bien »', () => viaApp({ sensorId: 'app-senior-001', event: 'CANCEL_ALERT', alertId: 'alert-123' }), 'signal', 'CANCEL_ALERT'],
  ['montre : horodatage fourni', () => viaHttp({ sensorId: 'watch-001', event: 'HELP_BUTTON', timestamp: '2026-01-15T14:32:08.000Z' }), 'signal', 'HELP_BUTTON'],

  ['capteur inconnu', () => viaMqtt('zigbee2mqtt/pir-garage', '{"occupancy":true}'), 'rejected', 'UNKNOWN_SENSOR'],
  ['montre écrivant en MQTT', () => viaMqtt('zigbee2mqtt/watch-001', '{"occupancy":true}'), 'rejected', 'UNKNOWN_SENSOR'],
  ['PIR écrivant en HTTP', () => viaHttp({ sensorId: 'pir-cuisine', event: 'HELP_BUTTON' }), 'rejected', 'UNKNOWN_SENSOR'],
  ["montre écrivant sur la route de l'application", () => viaApp({ sensorId: 'watch-001', event: 'HELP_BUTTON' }), 'rejected', 'UNKNOWN_SENSOR'],
  ['application écrivant sur la route de la montre', () => viaHttp({ sensorId: 'app-senior-001', event: 'HELP_BUTTON' }), 'rejected', 'UNKNOWN_SENSOR'],
  ['application : mesure refusée', () => viaApp({ sensorId: 'app-senior-001', event: 'HEART_RATE', value: 72 }), 'rejected', 'UNKNOWN_TYPE'],
  ['application : annulation sans identifiant valide', () => viaApp({ sensorId: 'app-senior-001', event: 'CANCEL_ALERT', alertId: '' }), 'rejected', 'INVALID_PAYLOAD'],
  ['JSON invalide', () => viaMqtt('zigbee2mqtt/pir-cuisine', 'ceci n\'est pas du json'), 'rejected', 'INVALID_JSON'],
  ['message qui n\'est pas un objet', () => viaMqtt('zigbee2mqtt/pir-cuisine', '42'), 'rejected', 'INVALID_PAYLOAD'],
  ['PIR sans champ exploitable', () => viaMqtt('zigbee2mqtt/pir-cuisine', '{"linkquality":120}'), 'rejected', 'MISSING_FIELD'],
  ['occupancy non booléen', () => viaMqtt('zigbee2mqtt/pir-cuisine', '{"occupancy":"oui"}'), 'rejected', 'INVALID_PAYLOAD'],
  ['batterie hors limites', () => viaMqtt('zigbee2mqtt/pir-cuisine', '{"battery":150}'), 'rejected', 'INVALID_PAYLOAD'],
  ['HTTP sans sensorId', () => viaHttp({ event: 'HELP_BUTTON' }), 'rejected', 'MISSING_FIELD'],
  ['HTTP sans event', () => viaHttp({ sensorId: 'watch-001' }), 'rejected', 'MISSING_FIELD'],
  ['HTTP type inconnu', () => viaHttp({ sensorId: 'watch-001', event: 'TEMPERATURE', value: 37 }), 'rejected', 'UNKNOWN_TYPE'],
  ['HTTP fréquence cardiaque 999', () => viaHttp({ sensorId: 'watch-001', event: 'HEART_RATE', value: 999 }), 'rejected', 'INVALID_PAYLOAD'],
  ['HTTP horodatage non UTC', () => viaHttp({ sensorId: 'watch-001', event: 'HELP_BUTTON', timestamp: '2026-01-15T14:32:08+02:00' }), 'rejected', 'INVALID_PAYLOAD'],
  ['HTTP corps vide', () => viaHttp({}), 'rejected', 'MISSING_FIELD'],
];

for (const [name, run, kind, expected] of cases) {
  test(`flow d'ingestion : ${name}`, () => {
    const result = outcome(run());
    assert.equal(result.kind, kind);
    if (kind === 'dropped') return;
    const { msg } = result;

    if (kind === 'signal') {
      assert.ok(validate.signal(msg.payload), errorsOf('signal'));
      assert.equal(msg.payload.type, expected);
      assert.equal(msg.topic, `signals/${msg.payload.seniorId}/${msg.payload.type}`);
    } else {
      assert.ok(validate.rejected(msg.payload), errorsOf('rejected'));
      assert.equal(msg.payload.reason, expected);
      assert.equal(msg.topic, 'ingestion/rejected');
    }
    assert.equal(msg.qos, 1);
    assert.equal(msg.retain, false);
    assert.equal(msg.raw, undefined, 'l\'enveloppe interne ne doit pas partir sur le broker');
  });
}

test('flow d\'ingestion : chaque type de signal du contrat peut être produit', () => {
  const produced = new Set();
  for (const [, run, kind, expected] of cases) {
    if (kind === 'signal') produced.add(expected);
  }
  assert.deepEqual(sorted(produced), sorted(schemas.signal.properties.type.enum));
});

test('flow d\'ingestion : chaque motif de rejet du contrat est exercé', () => {
  const used = new Set(cases.filter((c) => c[2] === 'rejected').map((c) => c[3]));
  assert.deepEqual(sorted(used), sorted(schemas.rejected.properties.reason.enum));
});

test('flow d\'ingestion : la bande de pression ne publie que les changements d\'état', () => {
  // plate-fauteuil n'est utilisé par aucun autre test : son état en mémoire part de zéro.
  const topic = 'zigbee2mqtt/plate-fauteuil';
  const states = [];
  const kinds = [];
  for (const text of [TUYA_BED(true), TUYA_BED(true, 94), TUYA_BED(false), TUYA_BED(false, 93), TUYA_BED(true)]) {
    const result = outcome(viaMqtt(topic, text));
    kinds.push(result.kind === 'signal' ? result.msg.payload.type : result.kind);
    if (result.kind === 'signal' && result.msg.payload.type === 'PRESSURE_PLATE') states.push(result.msg.payload.payload.state);
  }
  // Un rapport périodique avec le même état ne répète pas PRESSED/RELEASED : il devient un heartbeat.
  assert.deepEqual(kinds, ['PRESSURE_PLATE', 'SENSOR_HEARTBEAT', 'PRESSURE_PLATE', 'SENSOR_HEARTBEAT', 'PRESSURE_PLATE']);
  assert.deepEqual(states, ['PRESSED', 'RELEASED', 'PRESSED']);
});

test('flow d\'ingestion : chaque bouton du simulateur produit le résultat annoncé', () => {
  const sims = flows.filter((n) => n.type === 'inject' && n.z === 'tab_sim' && typeof n.topic === 'string' && n.topic.startsWith('zigbee2mqtt/'));
  assert.ok(sims.length >= 6, 'simulateur MQTT introuvable');
  for (const sim of sims) {
    const text = sim.payloadType === 'json' ? sim.payload : String(sim.payload);
    const result = outcome(viaMqtt(sim.topic, text));
    const expectsError = sim.name.startsWith('ERREUR');
    assert.equal(result.kind === 'rejected', expectsError, `« ${sim.name} » : résultat ${result.kind}`);
    if (result.kind === 'signal') assert.ok(validate.signal(result.msg.payload), `« ${sim.name} » : ${errorsOf('signal')}`);
  }
});

test('flow d\'ingestion : réponse HTTP 202 / 422, rien pour MQTT', () => {
  const accepted = httpReply(viaHttp({ sensorId: 'watch-001', event: 'HELP_BUTTON' })[0]);
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.payload.accepted, true);

  const refused = httpReply(viaHttp({ event: 'HELP_BUTTON' })[1]);
  assert.equal(refused.statusCode, 422);
  assert.equal(refused.payload.reason, 'MISSING_FIELD');

  const mqttMsg = normalise(adaptMqtt({ topic: 'zigbee2mqtt/pir-cuisine', payload: { occupancy: true } }))[0];
  assert.equal(httpReply(mqttMsg), null);
});

test('flows.json : câblage cohérent', () => {
  const ids = new Set(flows.map((n) => n.id));
  assert.equal(ids.size, flows.length, 'identifiants de nœuds en double');
  for (const n of flows) {
    if (n.z) assert.ok(ids.has(n.z), `${n.id} : onglet ${n.z} introuvable`);
    // Sur un nœud mqtt-broker, « broker » est le nom d'hôte ; ailleurs c'est une référence au nœud de configuration.
    if (n.broker && n.type !== 'mqtt-broker') assert.ok(ids.has(n.broker), `${n.id} : broker ${n.broker} introuvable`);
    for (const out of n.wires ?? []) {
      for (const target of out) assert.ok(ids.has(target), `${n.id} : cible ${target} introuvable`);
    }
  }
  const broker = flows.find((n) => n.type === 'mqtt-broker');
  assert.equal(broker.broker, 'mosquitto', 'le broker doit être joint par son nom de service Docker');
});
