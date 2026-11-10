# Format commun des événements

Ce document définit le **contrat de données** entre la passerelle d'ingestion (Node-RED) et le reste du système (détection, stockage). Tout signal entrant, quel que soit le capteur et son protocole d'origine (MQTT ou HTTP), est normalisé par Node-RED vers ce format unique avant d'être transmis.

Il couvre cinq familles de messages :

| Famille | Produit par | Consommé par | Section |
|---|---|---|---|
| **Signaux normalisés** (`RawSignal`) | Ingestion (Node-RED) | Détection, historisation | §1 à §5 |
| **Événements de domaine** (pré-confirmation, alerte critique) | Détection | Notification, API, appli senior | §6 |
| **Messages rejetés** (file de rejet / DLQ) | Ingestion | Supervision, débogage | §7 |
| **Notifications** (`NotificationRequested`) | Notification | API (remise aux personnes) | §9 |
| **Profils d'activité** (`ActivityProfileUpdated`) | API (seuils modifiés par le médical) | Détection | §10 |

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
{ 
  "value": 72,
  "unit": "bpm"
}
```
| Champ | Type | Description |
|---|---|---|
| `value` | number | Valeur de la fréquence cardiaque. |
| `unit` | string | Unité de mesure (ici `bpm` pour battements par minute). |

### `FALL_IMPACT`
```json
{ 
  "value": 9.8, 
  "unit": "g" 
}
```
| Champ | Type | Description |
|---|---|---|
| `value` | number | Pic de magnitude du vecteur d'accélération (SVtot) mesuré par la montre lors de l'impact. Permet de filtrer les chocs mineurs. |
| `unit` | string | Unité de mesure : toujours `g` (accélération de la pesanteur, ≈ 9,81 m/s²), et non des grammes. |

La détection de chute elle-même (pic d'impact, changement d'orientation, immobilité qui suit) est faite **par la montre**, comme sur les montres du commerce : elle n'envoie pas son flux brut d'accéléromètre, seulement l'événement `FALL_IMPACT` une fois la chute reconnue.

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
  "value": 84,
  "unit": "%"
}
```
| Champ | Type | Description |
|---|---|---|
| `value` | number | Niveau de batterie en pourcentage. |
| `unit` | string | Unité de mesure (ici `%` pour pourcentage). |

Le `SENSOR_HEARTBEAT` ne signale jamais lui-même une déconnexion : un capteur hors service ne peut pas émettre. C'est la détection qui conclut à une panne lorsqu'un capteur cesse d'envoyer son signal de vie pendant un délai donné (voir la matrice des risques, R1 « capteur muet »).

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
  "payload": { "value": 12, "unit": "%"}
}
```

---

## 5. Règles

- **Format des dates** : toujours ISO 8601 en UTC (suffixe `Z`). Les conversions d'affichage (heure locale) sont faites côté frontend, jamais dans l'événement.
- **Champs obligatoires** : tout événement sans un des champs communs est rejeté par l'ingestion et publié dans la file de rejet / DLQ (voir la file de rejet / DLQ si elle est mise en place).
- **Identifiants** : `seniorId` et `sensorId` ne contiennent que des lettres, chiffres, `-` et `_`. Ils servent dans les noms de topics MQTT, où `/`, `+` et `#` sont des caractères réservés.
- **Pas de type inconnu** : un `type` hors de la liste §2 est rejeté.
- **Cohérence avec le DDD** : l'enum `SignalType` de ce document et celle du document DDD doivent rester identiques. Ajouter un type se répercute dans les deux.
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


**`Severity`** — échelle de gravité à 4 niveaux :

| Niveau | Valeur | Signification | Où on la trouve | Effet dans l'application |
|---|---|---|---|---|
| 0 | `SYSTEM` | Événement technique (batterie faible, capteur muet) | Événements de supervision des capteurs (à venir) | Indicateur dans la vue médicale, journal |
| 1 | `PRE_ALERT` | Levée de doute en cours | Implicite pour `PreConfirmationRequested` | Vibration de la montre, bandeau « Tout va bien ? » avec compte à rebours dans la vue senior |
| 2 | `WARNING` | Incident non infirmé : la personne n'a pas répondu | `CriticalAlertGenerated` (`NO_RESPONSE`) | Alerte dans la vue famille, trace pour l'équipe médicale |
| 3 | `CRITICAL` | Urgence confirmée | `CriticalAlertGenerated` (`SENIOR_CONFIRMED`, `IMMEDIATE`, `NO_RECOVERY`, `NO_HEART_SIGNAL`) | Alerte urgente dans les vues médicale et famille. Dans un déploiement réel, ce niveau déclencherait un appel ou l'envoi de secours (hors périmètre du projet). |

**`EscalationCause`** — pourquoi l'alerte est devenue critique :

| Valeur | Niveau | Signification |
|---|---|---|
| `NO_RESPONSE` | 2 | La pré-confirmation a expiré sans réponse ni signe de relèvement (chute), ou sans réponse ni activité alors que la fréquence cardiaque récente est normale (inactivité). |
| `SENIOR_CONFIRMED` | 3 | La personne a confirmé avoir besoin d'aide (`HELP_BUTTON` pendant la pré-confirmation ou après une alerte de niveau 2). |
| `IMMEDIATE` | 3 | Escalade directe, sans pré-confirmation (demande d'aide spontanée). |
| `NO_RECOVERY` | 3 | Après une alerte de niveau 2, toujours aucun signe de relèvement (chute) ni aucune activité (inactivité) au bout d'un délai supplémentaire. |
| `NO_HEART_SIGNAL` | 3 | Inactivité : la pré-confirmation a expiré sans réponse, et la montre ne donne pas de fréquence cardiaque récente et normale (montre muette, valeur nulle ou anormale). Escalade directe au niveau 3 ([ADR 0010](adr/0010-detection-inactivite.md)). |

Une même alerte peut donc être publiée **deux fois** en `CriticalAlertGenerated` : d'abord en `WARNING`, puis en `CRITICAL` (même `alertId`, `eventId` différent). Les abonnés gardent la dernière gravité reçue pour un `alertId`.

**`CancellationCause`** — pourquoi la pré-confirmation a été annulée : `SENIOR_CANCELED` (bouton « tout va bien », signal `CANCEL_ALERT`) ou `ACTIVITY_RESUMED` (la personne s'est relevée : voir la séquence de relèvement ci-dessous).

**Séquence de relèvement.** Un seul signal de mouvement ne suffit pas à annuler (une personne au sol peut bouger et déclencher un détecteur). Il faut une **séquence** de deux signaux des capteurs du logement, postérieurs à l'impact :

1. **activité** : un `PIR_MOTION` ou un `PRESSURE_PLATE` ;
2. **stabilité**, arrivée après l'activité et dans un délai limité : un `PRESSURE_PLATE` à l'état `PRESSED` (la personne est sur le lit ou le fauteuil, pas au sol) ou un `PIR_MOTION` dans une **autre pièce** que celle de l'activité (elle s'est déplacée).

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
| `triggeringEventIds` | string[] (UUID) | `eventId` des signaux qui ont déclenché la suspicion (traçabilité). Pour une inactivité : le dernier signal d'activité reçu, ou une liste **vide** si aucun signal n'est arrivé depuis le démarrage de la détection (une absence de signal n'a pas toujours de signal à citer). Au moins un dans les autres cas. |

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
  "severity": "WARNING",
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
| `triggeringEventIds` | string[] (UUID) | Signaux à l'origine de l'alerte (même règle que ci-dessus : vide possible pour une inactivité seulement). |

> **Les destinataires ne sont pas dans l'événement.** Conformément au DDD, c'est le service de notification qui les choisit à partir de `reason`, `severity` et des contacts du senior (PostgreSQL). La détection n'a pas à connaître la famille ni l'équipe médicale.

### Enchaînements possibles

```
FALL_IMPACT ─► PreConfirmationRequested ─┬─► CANCEL_ALERT ou séquence de relèvement ─► PreConfirmationCanceled            (fin, pas d'alerte)
  (niveau 1)                             ├─► HELP_BUTTON ─────────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
                                         └─► délai expiré, pas de relèvement ─────────► PreConfirmationTimeoutExpired
                                                                                        + CriticalAlertGenerated (WARNING, NO_RESPONSE)
                                                                                              │
                         ┌────────────────────────────────────────────────────────────────────┤
                         ├─► HELP_BUTTON ─────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
                         ├─► délai supplémentaire sans relèvement ─► CriticalAlertGenerated (CRITICAL, NO_RECOVERY)
                         └─► séquence de relèvement ──────────────► pas de passage au niveau 3

HELP_BUTTON (hors de toute alerte en cours) ─────────────────────► CriticalAlertGenerated (CRITICAL, IMMEDIATE)
```

**Inactivité prolongée** ([ADR 0010](adr/0010-detection-inactivite.md)) : la détection compare le temps écoulé depuis la dernière activité (`PIR_MOTION` ou changement de `PRESSURE_PLATE`, dans n'importe quelle pièce) au seuil du profil (§10) qui s'applique à l'heure locale.

```
plus d'activité depuis le seuil ─► PreConfirmationRequested (PROLONGED_INACTIVITY) ─┬─► CANCEL_ALERT ou une activité ─► PreConfirmationCanceled
  (niveau 1)                                                                          ├─► HELP_BUTTON ─────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
                                                                                      └─► délai expiré ─► PreConfirmationTimeoutExpired, puis selon la fréquence cardiaque :
                                                                                            ├─ récente et normale ─► CriticalAlertGenerated (WARNING, NO_RESPONSE)
                                                                                            │                          puis (CRITICAL, NO_RECOVERY) sans activité après le délai
                                                                                            └─ absente ou anormale ─► CriticalAlertGenerated (CRITICAL, NO_HEART_SIGNAL)
```

Contrairement à la chute, **une seule activité suffit** à lever le doute : la personne bouge, elle n'est pas inactive. Une seule alerte à la fois par senior : pas d'alerte d'inactivité pendant une alerte de chute.

Si la personne a montré une **activité** sans encore la **stabilité** au moment où le délai de pré-confirmation expire, la décision est reportée jusqu'à la fin du délai de confirmation de la séquence de relèvement : elle peut encore se relever avant l'alerte.

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
| `schemas/notification.schema.json` | JSON Schema d'une notification (§9) | API, à la réception |
| `schemas/activity-profile.schema.json` | JSON Schema d'un profil d'activité et de son message de mise à jour (§10) | Détection, à la réception ; API, à l'écriture |
| `src/*.ts` | Types TypeScript et constantes (enums, noms de topics) | Services TypeScript (détection, notification, API) |

Les schémas n'utilisent pas le mot-clé `format` (remplacé par des `pattern`) pour fonctionner avec n'importe quel validateur sans extension.

> Toute modification du contrat se fait **aux trois endroits** : ce document, les JSON Schemas et les types TypeScript.

---

## 9. Notifications (émises par le service de notification)

Le service de notification écoute les alertes avérées (`CriticalAlertGenerated`) et décide **qui doit être prévenu, avec quelle priorité** ([ADR 0008](adr/0008-service-de-notification.md)). Il raisonne par **rôle** : il publie une notification par rôle destinataire sur `notifications/{seniorId}`, et l'API la remet aux personnes de ce rôle qui ont une relation consentie avec le senior. Le service de notification n'a donc pas accès aux données personnelles.

### Règle de routage

| Gravité de l'alerte | Famille | Équipe médicale |
|---|---|---|
| `WARNING` (niveau 2) | `NORMAL` : à traiter | `INFO` : pour trace |
| `CRITICAL` (niveau 3) | `URGENT` | `URGENT` |

Une alerte qui passe du niveau 2 au niveau 3 produit donc deux séries de notifications. Le senior ne reçoit pas de notification : il est sollicité par la levée de doute (bandeau « Tout va bien ? »).

### `NotificationRequested`

```json
{
  "eventId": "d4e5f6a7-0001-4000-8000-000000000301",
  "seniorId": "senior-001",
  "type": "NotificationRequested",
  "timestamp": "2026-01-15T14:33:09.000Z",
  "payload": {
    "alertId": "alert-123",
    "recipientRole": "FAMILY",
    "priority": "NORMAL",
    "severity": "WARNING",
    "reason": "FALL_DETECTED",
    "escalationCause": "NO_RESPONSE",
    "title": "Chute détectée, sans réponse",
    "message": "Une chute a été détectée et la personne n'a pas répondu à la demande de confirmation. Prenez de ses nouvelles."
  }
}
```

| Champ | Type | Description |
|---|---|---|
| `eventId` | string (UUID) | Identifiant de la notification ; l'API ignore un doublon (QoS 1). |
| `seniorId` | string | Personne concernée. |
| `type` | `NotificationRequested` | Seul type de notification pour l'instant. |
| `timestamp` | string (ISO 8601, UTC) | Moment où la notification a été décidée. |
| `payload.alertId` | string | Alerte à l'origine de la notification. |
| `payload.recipientRole` | `FAMILY` \| `MEDICAL` | Rôle destinataire. |
| `payload.priority` | `INFO` \| `NORMAL` \| `URGENT` | Priorité d'affichage. |
| `payload.severity`, `payload.reason`, `payload.escalationCause` | voir §6 | Repris de l'alerte. |
| `payload.title`, `payload.message` | string | Texte destiné aux personnes, en français. |

---

## 10. Profils d'activité (seuils d'inactivité)

Le profil d'activité d'un senior (DDD : `ActivityProfile`) contient les **seuils de tolérance** configurés par l'équipe médicale : au-delà de la durée indiquée sans activité, la détection lève le doute. Chaque seuil peut porter une **plage horaire** (heure locale du logement), pour distinguer le jour de la nuit ([ADR 0010](adr/0010-detection-inactivite.md)).

**Livraison à la détection** : au démarrage, la détection lit tous les profils à l'API (`GET /internal/activity-profiles`, en-tête `x-service-token`) ; ensuite, à chaque modification par le médical, l'API publie le profil complet sur `profiles/{seniorId}`. La détection garde les profils en mémoire et ne lit jamais la base.

### `ActivityProfileUpdated`

```json
{
  "eventId": "e5f6a7b8-0001-4000-8000-000000000401",
  "seniorId": "senior-001",
  "type": "ActivityProfileUpdated",
  "timestamp": "2026-01-15T09:00:00.000Z",
  "payload": {
    "seniorId": "senior-001",
    "timeZone": "Europe/Paris",
    "thresholds": [
      { "condition": "MAX_INACTIVITY_MINUTES", "durationInMinutes": 120, "timeRange": { "startTime": "07:00", "endTime": "22:00" } },
      { "condition": "MAX_INACTIVITY_MINUTES", "durationInMinutes": 600, "timeRange": { "startTime": "22:00", "endTime": "07:00" } }
    ]
  }
}
```

| Champ | Type | Description |
|---|---|---|
| `eventId` | string (UUID) | Identifiant du message ; la détection ignore un doublon. |
| `seniorId` | string | Personne concernée (identique à `payload.seniorId`). |
| `type` | `ActivityProfileUpdated` | Seul type de message de profil. |
| `timestamp` | string (ISO 8601, UTC) | Moment de la modification. |
| `payload.timeZone` | string | Fuseau horaire IANA du logement (ex. `Europe/Paris`), pour lire les plages horaires. |
| `payload.thresholds[]` | `ToleranceThreshold` | 0 à 10 seuils. Un profil sans seuil désactive la détection d'inactivité pour ce senior. |
| `…condition` | `MAX_INACTIVITY_MINUTES` | Seule condition gérée : durée maximale sans activité. |
| `…durationInMinutes` | entier, 1 à 1440 | Durée tolérée. |
| `…timeRange` | `{ startTime, endTime }` ou `null` | Plage `HH:MM` → `HH:MM` en heure locale ; elle peut passer minuit (`22:00` → `07:00`). `null` : seuil par défaut, pour les heures couvertes par aucune plage. |

**Choix du seuil** à un instant donné :

1. si la personne est **au lit** (dernière bande de pression du lit à l'état `PRESSED`), c'est un repos normal : le seuil **le plus long** du profil s'applique ;
2. sinon, parmi les seuils dont la plage contient l'heure locale, le **plus court** (le plus prudent) ;
3. sinon, le seuil sans plage, s'il existe ; sinon, pas de surveillance à cette heure.

