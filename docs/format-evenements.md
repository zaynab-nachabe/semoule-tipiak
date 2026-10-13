# Format commun des événements

Ce document définit le **contrat de données** entre la passerelle d'ingestion (Node-RED) et le reste du système (détection, stockage). Tout signal entrant, quel que soit le capteur et son protocole d'origine (MQTT ou HTTP), est normalisé par Node-RED vers ce format unique avant d'être transmis.

Il couvre trois familles de messages :

| Famille | Produit par | Consommé par | Section |
|---|---|---|---|
| **Signaux normalisés** (`RawSignal`) | Ingestion (Node-RED) | Détection, historisation | §1 à §5 |
| **Événements de domaine** (pré-confirmation, alerte critique) | Détection | Notification, API, appli senior | §6 |
| **Messages rejetés** (file de rejet / DLQ) | Ingestion | Supervision, débogage | §7 |

Les topics MQTT sur lesquels circulent ces messages sont définis dans [topics-mqtt.md](topics-mqtt.md). Les versions lisibles par machine (JSON Schema + types TypeScript) sont décrites au §8.

---

## 1. Structure générale (enveloppe + payload)

Chaque événement est un objet JSON composé de **champs communs** (l'enveloppe, identiques pour tous les événements) et d'un **`payload`** dont le contenu varie selon le type de signal.

```json
{
  "eventId": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
  "seniorId": "senior-001",
  "sensorId": "watch-001",
  "type": "FALL_IMPACT",
  "timestamp": "2026-01-15T14:32:08.000Z",
  "payload": { "value": 9.8, "unit": "g" }
}
```

### Champs communs

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `eventId` | string (UUID) | oui | Identifiant unique de l'événement. Permet la traçabilité et d'éviter qu'un même événement soit traité deux fois. |
| `seniorId` | string | oui | Identifiant de la personne à laquelle l'événement se rattache. Ajouté par Node-RED lors de la normalisation. |
| `sensorId` | string | oui | Identifiant du capteur émetteur. |
| `type` | string (enum) | oui | Type de signal. Voir la liste des valeurs autorisées (§2). |
| `timestamp` | string (ISO 8601, UTC) | oui | Date et heure de production du signal, au format `YYYY-MM-DDTHH:mm:ss.sssZ`. |
| `payload` | objet | oui | Contenu propre au type. Peut être vide (`{}`) si le type n'a pas de donnée associée. |

---

## 2. Types de signaux (`SignalType`)

Valeurs autorisées pour le champ `type` :

| Valeur | Signification | Source |
|---|---|---|
| `PIR_MOTION` | Mouvement détecté dans une pièce | Détecteur PIR |
| `PRESSURE_PLATE` | Appui ou relâchement sur une plaque de pression (lit, fauteuil, seuil de pièce) | Plaque de pression |
| `HEART_RATE` | Mesure de fréquence cardiaque | Montre / bracelet |
| `FALL_IMPACT` | Impact détecté (chute possible) | Accéléromètre de la montre |
| `HELP_BUTTON` | Demande d'aide manuelle | Bouton de la montre / appli |
| `CANCEL_ALERT` | Annulation d'une alerte par la personne | Bouton de la montre / appli |
| `SENSOR_HEARTBEAT` | Signal de vie du capteur (état, batterie) | Auto-diagnostic du capteur |

> Les valeurs sont des constantes strictes (enum). On n'invente pas de type à la volée : ajouter un type passe par une mise à jour de ce document.

---

## 3. Contenu du `payload` par type

### `PIR_MOTION`
```json
{ "room": "salon" }
```
| Champ | Type | Description |
|---|---|---|
| `room` | string | Pièce où le mouvement a été détecté. Sert à reconstruire la position dans le logement. |

### `PRESSURE_PLATE`
```json
{ "room": "chambre", "location": "lit", "state": "PRESSED" }
```
| Champ | Type | Description |
|---|---|---|
| `room` | string | Pièce où se trouve la plaque. Sert, comme pour `PIR_MOTION`, à reconstruire la position dans le logement. |
| `location` | string | Emplacement précis de la plaque dans la pièce (`lit`, `fauteuil`, `seuil`…). |
| `state` | string (enum) | `PRESSED` (quelqu'un monte dessus) ou `RELEASED` (la personne en descend). |

Une plaque de pression émet un événement à chaque **changement d'état**, pas en continu. La durée passée sur la plaque (ex. temps passé au lit) se déduit de l'écart entre le `PRESSED` et le `RELEASED` qui suit.

### `HEART_RATE`
```json
{ "value": 72, "unit": "bpm" }
```
| Champ | Type | Description |
|---|---|---|
| `value` | number | Fréquence cardiaque mesurée. `0` est accepté : un signal plat est une information pour la détection, pas une erreur. |
| `unit` | string | Unité de mesure : toujours `bpm` (battements par minute). |

### `FALL_IMPACT`
```json
{ "value": 9.8, "unit": "g" }
```
| Champ | Type | Description |
|---|---|---|
| `value` | number | Intensité de l'impact détecté. Permet de filtrer les chocs mineurs. |
| `unit` | string | Unité de mesure : toujours `g` (accélération de la pesanteur, ≈ 9,81 m/s²), et non des grammes. |

### `HELP_BUTTON`
```json
{}
```
Aucune donnée : l'événement lui-même suffit (le bouton a été pressé).

### `CANCEL_ALERT`
```json
{ "alertId": "alert-123" }
```
| Champ | Type | Description |
|---|---|---|
| `alertId` | string | Identifiant de l'alerte annulée, si connu. Peut être omis si l'annulation est globale. |

### `SENSOR_HEARTBEAT`
```json
{
  "batteryLevel": 84,
  "unit": "%"
}
```
| Champ | Type | Description |
|---|---|---|
| `batteryLevel` | number | Niveau de batterie, de 0 à 100. |
| `unit` | string | Unité de mesure : toujours `%`. |

Le payload ne contient pas d'état (`OK`, `LOW_BATTERY`…) : c'est la détection qui déduit « batterie faible » à partir de `batteryLevel` et d'un seuil, et « capteur muet » de l'absence de heartbeat (risque R1 de la matrice des risques).

---

## 4. Exemples complets

**Mouvement dans la cuisine**
```json
{
  "eventId": "a1b2c3d4-0001-4000-8000-000000000001",
  "seniorId": "senior-001",
  "sensorId": "pir-cuisine",
  "type": "PIR_MOTION",
  "timestamp": "2026-01-15T08:12:45.000Z",
  "payload": { "room": "cuisine" }
}
```

**Personne qui se couche (plaque de pression du lit)**
```json
{
  "eventId": "a1b2c3d4-0005-4000-8000-000000000005",
  "seniorId": "senior-001",
  "sensorId": "plate-lit",
  "type": "PRESSURE_PLATE",
  "timestamp": "2026-01-15T22:10:00.000Z",
  "payload": { "room": "chambre", "location": "lit", "state": "PRESSED" }
}
```

**Mesure de fréquence cardiaque**
```json
{
  "eventId": "a1b2c3d4-0002-4000-8000-000000000002",
  "seniorId": "senior-001",
  "sensorId": "watch-001",
  "type": "HEART_RATE",
  "timestamp": "2026-01-15T08:13:00.000Z",
  "payload": { "value": 68, "unit": "bpm" }
}
```

**Chute détectée**
```json
{
  "eventId": "a1b2c3d4-0003-4000-8000-000000000003",
  "seniorId": "senior-001",
  "sensorId": "watch-001",
  "type": "FALL_IMPACT",
  "timestamp": "2026-01-15T14:32:08.000Z",
  "payload": { "value": 9.8, "unit": "g" }
}
```

**Capteur en batterie faible**
```json
{
  "eventId": "a1b2c3d4-0004-4000-8000-000000000004",
  "seniorId": "senior-001",
  "sensorId": "pir-chambre",
  "type": "SENSOR_HEARTBEAT",
  "timestamp": "2026-01-15T14:35:00.000Z",
  "payload": { "batteryLevel": 12, "unit": "%" }
}
```

---

## 5. Règles

- **Format des dates** : toujours ISO 8601 en UTC (suffixe `Z`). Les conversions d'affichage (heure locale) sont faites côté frontend, jamais dans l'événement.
- **Champs obligatoires** : tout événement sans un des champs communs est rejeté par l'ingestion et publié dans la file de rejet (voir §7).
- **Identifiants** : `seniorId` et `sensorId` ne contiennent que des lettres, chiffres, `-` et `_`. Ils servent dans les noms de topics MQTT, où `/`, `+` et `#` sont des caractères réservés.
- **Pas de type inconnu** : un `type` hors de la liste §2 est rejeté.
- **Le `payload` suit son type** : la détection se fie au `type` pour savoir comment lire le `payload`.
- **Évolutivité** : ajouter un capteur ou un type de signal se fait en complétant ce document, puis en adaptant la normalisation Node-RED. Les autres services n'ont à changer que s'ils traitent le nouveau type.

---

## 6. Événements de domaine (émis par la détection)

Ces événements correspondent aux *Domain Events* de sortie du `Correlation & Detection Context` (voir `DDD_specifications.md`). Ils sont publiés par le service de détection et écoutés par la notification et l'API (qui les pousse en temps réel aux frontends par WebSocket).

### Enveloppe

Même principe que les signaux, sans `sensorId` (l'émetteur est toujours le service de détection) :

```json
{
  "eventId": "b7e4c1a2-0001-4000-8000-000000000101",
  "seniorId": "senior-001",
  "type": "PreConfirmationRequested",
  "timestamp": "2026-01-15T14:32:09.000Z",
  "payload": { }
}
```

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `eventId` | string (UUID) | oui | Identifiant unique de l'événement de domaine. |
| `seniorId` | string | oui | Personne concernée. |
| `type` | string (enum) | oui | Nom de l'événement de domaine (voir tableau ci-dessous). Les noms reprennent le langage ubiquitaire du DDD. |
| `timestamp` | string (ISO 8601, UTC) | oui | Moment où l'événement s'est produit. |
| `payload` | objet | oui | Contenu propre au type. |

### Types d'événements de domaine (`DomainEventType`)

| Valeur | Signification |
|---|---|
| `PreConfirmationRequested` | Une situation suspecte a été détectée : on demande à la personne si tout va bien (levée de doute). |
| `PreConfirmationCanceled` | La pré-confirmation est annulée : la personne a répondu « tout va bien » ou son activité a repris. Aucune alerte critique. |
| `PreConfirmationTimeoutExpired` | La personne n'a pas répondu dans le délai imparti. Suivi d'un `CriticalAlertGenerated`. |
| `CriticalAlertGenerated` | Incident avéré : déclenche l'envoi des notifications à la famille et à l'équipe médicale. |

### Énumérations partagées

**`AlertReason`** — motif de l'alerte :

| Valeur | Signification |
|---|---|
| `FALL_DETECTED` | Chute détectée (impact + absence de reprise d'activité). |
| `PROLONGED_INACTIVITY` | Inactivité dépassant le seuil toléré par rapport au profil habituel. |
| `HELP_REQUESTED` | Demande d'aide manuelle (`HELP_BUTTON`). Passe directement en alerte critique, sans pré-confirmation. |

> `HELP_REQUESTED` n'existe pas encore dans l'enum `reason` de l'entité `Alert` du document DDD : à y ajouter.

**`Severity`** — gravité de l'alerte : `MEDIUM`, `HIGH`, `CRITICAL`.

**`EscalationCause`** — pourquoi l'alerte est devenue critique :

| Valeur | Signification |
|---|---|
| `NO_RESPONSE` | La pré-confirmation a expiré sans réponse. |
| `SENIOR_CONFIRMED` | La personne a confirmé avoir besoin d'aide (`HELP_BUTTON` pendant une pré-confirmation). |
| `IMMEDIATE` | Escalade directe, sans pré-confirmation (ex. demande d'aide spontanée). |

**`CancellationCause`** — pourquoi la pré-confirmation a été annulée : `SENIOR_CANCELED` (bouton « tout va bien », signal `CANCEL_ALERT`) ou `ACTIVITY_RESUMED` (un mouvement a été détecté après l'impact).

### `PreConfirmationRequested`
```json
{
  "alertId": "alert-123",
  "reason": "FALL_DETECTED",
  "requestedAt": "2026-01-15T14:32:09.000Z",
  "expiresAt": "2026-01-15T14:33:09.000Z",
  "triggeringEventIds": ["a1b2c3d4-0003-4000-8000-000000000003"]
}
```
| Champ | Type | Description |
|---|---|---|
| `alertId` | string | Identifiant de l'alerte en cours de levée de doute. Repris par tous les événements suivants. |
| `reason` | `AlertReason` | Motif de la suspicion. |
| `requestedAt` | string (ISO 8601, UTC) | Début de la pré-confirmation. |
| `expiresAt` | string (ISO 8601, UTC) | Fin du délai de réponse (ex. 60 s après, voir scénario A du DDD). |
| `triggeringEventIds` | string[] (UUID) | `eventId` des signaux qui ont déclenché la suspicion (traçabilité). |

### `PreConfirmationCanceled`
```json
{
  "alertId": "alert-123",
  "cause": "SENIOR_CANCELED",
  "triggeringEventId": "a1b2c3d4-0005-4000-8000-000000000005"
}
```
| Champ | Type | Description |
|---|---|---|
| `alertId` | string | Alerte annulée. |
| `cause` | `CancellationCause` | Raison de l'annulation. |
| `triggeringEventId` | string (UUID) | `eventId` du signal à l'origine de l'annulation (`CANCEL_ALERT` ou mouvement). |

### `PreConfirmationTimeoutExpired`
```json
{
  "alertId": "alert-123",
  "requestedAt": "2026-01-15T14:32:09.000Z",
  "expiresAt": "2026-01-15T14:33:09.000Z"
}
```
| Champ | Type | Description |
|---|---|---|
| `alertId` | string | Alerte restée sans réponse. |
| `requestedAt` | string (ISO 8601, UTC) | Début de la pré-confirmation. |
| `expiresAt` | string (ISO 8601, UTC) | Échéance dépassée. |

### `CriticalAlertGenerated`
```json
{
  "alertId": "alert-123",
  "reason": "FALL_DETECTED",
  "severity": "CRITICAL",
  "escalationCause": "NO_RESPONSE",
  "triggeringEventIds": ["a1b2c3d4-0003-4000-8000-000000000003"]
}
```
| Champ | Type | Description |
|---|---|---|
| `alertId` | string | Identifiant de l'alerte (le même que pendant la pré-confirmation, s'il y en a eu une). |
| `reason` | `AlertReason` | Motif de l'alerte. |
| `severity` | `Severity` | Gravité. |
| `escalationCause` | `EscalationCause` | Pourquoi l'alerte est devenue critique. |
| `triggeringEventIds` | string[] (UUID) | Signaux à l'origine de l'alerte. |

> **Les destinataires ne sont pas dans l'événement.** Conformément au DDD, c'est le service de notification qui les choisit à partir de `reason`, `severity` et des contacts du senior (PostgreSQL). La détection n'a pas à connaître la famille ni l'équipe médicale.

### Enchaînements possibles

```
FALL_IMPACT ─► PreConfirmationRequested ─┬─► PreConfirmationCanceled                              (fin, pas d'alerte)
                                         ├─► PreConfirmationTimeoutExpired ─► CriticalAlertGenerated (NO_RESPONSE)
                                         └─► HELP_BUTTON ──────────────────► CriticalAlertGenerated (SENIOR_CONFIRMED)

HELP_BUTTON (hors pré-confirmation) ───────────────────────► CriticalAlertGenerated (IMMEDIATE)
```

---

## 7. Messages rejetés (file de rejet / DLQ)

Tout message que l'ingestion ne peut pas normaliser (JSON invalide, champ manquant, type inconnu…) n'est **pas perdu silencieusement** : il est republié tel quel, enveloppé avec la raison du rejet, sur le topic de rejet (voir [topics-mqtt.md](topics-mqtt.md)). Cela permet de repérer un capteur mal configuré.

```json
{
  "eventId": "c9d8e7f6-0001-4000-8000-000000000201",
  "timestamp": "2026-01-15T14:40:00.000Z",
  "source": { "protocol": "MQTT", "origin": "zigbee2mqtt/pir-cuisine" },
  "reason": "UNKNOWN_TYPE",
  "details": "type 'TEMPERATURE' absent de SignalType",
  "originalMessage": "{\"type\":\"TEMPERATURE\",\"value\":21.5}"
}
```

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `eventId` | string (UUID) | oui | Identifiant du rejet. |
| `timestamp` | string (ISO 8601, UTC) | oui | Moment du rejet. |
| `source.protocol` | `MQTT` \| `HTTP` | oui | Protocole par lequel le message est arrivé. |
| `source.origin` | string | oui | Topic MQTT ou route HTTP d'origine. |
| `reason` | string (enum) | oui | `INVALID_JSON`, `MISSING_FIELD`, `UNKNOWN_TYPE`, `INVALID_PAYLOAD`, `UNKNOWN_SENSOR`. |
| `details` | string | oui | Explication lisible (ex. message d'erreur du validateur). |
| `originalMessage` | string | oui | Message d'origine **brut, sous forme de texte** (il peut ne pas être du JSON valide). |

---

## 8. Schémas lisibles par machine

Ce document est la référence lisible. Ses équivalents exécutables sont dans le package partagé `packages/shared-types` :

| Fichier | Contenu | Utilisé par |
|---|---|---|
| `schemas/raw-signal.schema.json` | JSON Schema (draft-07) d'un signal normalisé (§1 à §3) | Node-RED, validation avant publication |
| `schemas/domain-event.schema.json` | JSON Schema des événements de domaine (§6) | Tests, débogage |
| `schemas/rejected-message.schema.json` | JSON Schema d'un message rejeté (§7) | Tests, débogage |
| `src/*.ts` | Types TypeScript et constantes (enums, noms de topics) | Services TypeScript (détection, notification, API) |

Les schémas n'utilisent pas le mot-clé `format` (remplacé par des `pattern`) pour fonctionner avec n'importe quel validateur sans extension.

> Toute modification du contrat se fait **aux trois endroits** : ce document, les JSON Schemas et les types TypeScript.
