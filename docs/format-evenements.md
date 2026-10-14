# Format commun des événements

Ce document définit le **contrat de données** entre la passerelle d'ingestion (Node-RED) et le reste du système (détection, stockage). Tout signal entrant, quel que soit le capteur et son protocole d'origine (MQTT ou HTTP), est normalisé par Node-RED vers ce format unique avant d'être transmis.

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
  "payload": { "impactForce": 9.8 }
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
|---|---|---
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
| `value` | number | Intensité de l'impact détecté. |
| `unit` | string | Unité de mesure (ici `g` pour grammes). Permet de filtrer les chocs mineurs. |

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
- **Champs obligatoires** : tout événement sans un des champs communs est rejeté par l'ingestion (voir la file de rejet / DLQ si elle est mise en place).
- **Pas de type inconnu** : un `type` hors de la liste §2 est rejeté.
- **Cohérence avec le DDD** : l'enum `SignalType` de ce document et celle du document DDD doivent rester identiques. Ajouter un type se répercute dans les deux.
- **Le `payload` suit son type** : la détection se fie au `type` pour savoir comment lire le `payload`.
- **Évolutivité** : ajouter un capteur ou un type de signal se fait en complétant ce document, puis en adaptant la normalisation Node-RED. Les autres services n'ont à changer que s'ils traitent le nouveau type.