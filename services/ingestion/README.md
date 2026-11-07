# Ingestion (Node-RED)

Passerelle d'entrée du système. Elle reçoit les messages bruts des capteurs, les **normalise** vers le format commun ([docs/format-evenements.md](../../docs/format-evenements.md)) et les publie sur le broker MQTT. Aucune logique de détection n'est placée ici.

```
capteurs fixes ─ MQTT sensors/{sensorId} ─┐
                                              ├─► Adapter ─► Normaliser ─┬─► signals/{seniorId}/{type}
montre ─ HTTP POST /ingest/watch ─────────────┘                          └─► ingestion/rejected
```

Fichiers :

| Fichier | Rôle |
|---|---|
| `flows.json` | Les flows : onglet **Ingestion** (le vrai pipeline) et onglet **Simulateur** (capteurs simulés pour tester) |
| `settings.js` | Configuration de Node-RED (monté dans le conteneur sur `/data`) |

## Lancer et tester

```bash
docker compose up -d
```

Ouvrir http://localhost:1880, onglet **Simulateur**, ouvrir le panneau *debug* (icône scarabée), puis cliquer sur les boutons de gauche d'un nœud *inject*. Chaque bouton envoie un message comme le ferait le vrai capteur ; le résultat apparaît dans *Signal normalisé* ou *Message rejeté*. Les boutons « ERREUR » vérifient le chemin de rejet.

On peut aussi publier à la main :

```bash
# capteur fixe, via le broker
docker exec mosquitto mosquitto_pub -t sensors/pir-cuisine -m '{"occupancy":true}'
# écouter le résultat
docker exec mosquitto mosquitto_sub -v -t 'signals/#' -t 'ingestion/rejected'
# montre, via HTTP
curl -X POST http://localhost:1880/ingest/watch -H 'Content-Type: application/json' \
     -d '{"sensorId":"watch-001","event":"HEART_RATE","value":72}'
```

## Formats bruts acceptés

### Capteurs fixes (MQTT, topic `sensors/{sensorId}`)

Format attendu : un objet JSON par message.

| Capteur | Message | Signal produit |
|---|---|---|
| PIR | `{"occupancy": true}` | `PIR_MOTION` (la pièce vient du registre) |
| PIR | `{"occupancy": false}` | *rien* : une fin de détection n'est pas un événement métier |
| Plaque de pression | `{"contact": false}` | `PRESSURE_PLATE`, `state: PRESSED` |
| Plaque de pression | `{"contact": true}` | `PRESSURE_PLATE`, `state: RELEASED` |
| PIR ou plaque | `{"battery": 84}` (sans `occupancy` ni `contact`) | `SENSOR_HEARTBEAT` |

Une plaque de pression est câblée comme un contact sec : contact fermé = personne dessus. Un champ `timestamp` (ISO 8601 UTC) est utilisé s'il est présent, sinon l'heure de réception.

### Montre (HTTP, `POST /ingest/watch`)

Corps JSON envoyé par l'appli compagnon. `event` doit être un type de signal que la montre peut produire.

| `event` | Champs | Signal produit |
|---|---|---|
| `HEART_RATE` | `value` (0 à 300) | `HEART_RATE`, `unit: bpm` |
| `FALL_IMPACT` | `value` (≥ 0) | `FALL_IMPACT`, `unit: g` |
| `HELP_BUTTON` | — | `HELP_BUTTON` |
| `CANCEL_ALERT` | `alertId` (optionnel) | `CANCEL_ALERT` |
| `SENSOR_HEARTBEAT` | `battery` (0 à 100) | `SENSOR_HEARTBEAT`, `unit: %` |

Tous les messages portent `sensorId` (ex. `watch-001`) et peuvent porter `timestamp`.

Réponse HTTP : **202** `{"accepted": true, "eventId": "…"}` si le signal est publié, **422** `{"accepted": false, "reason": "…", "details": "…"}` si le message est rejeté.

## Rejets

Un message qui ne peut pas être normalisé n'est jamais perdu en silence : il part sur `ingestion/rejected` avec le motif (format §7 du document). 
Motifs produits :

| Motif | Cas |
|---|---|
| `INVALID_JSON` | Le message MQTT n'est pas du JSON |
| `INVALID_PAYLOAD` | Pas un objet, valeur hors limites, mauvais type de champ, horodatage invalide |
| `MISSING_FIELD` | `sensorId`, `event`, ou le champ attendu du capteur est absent |
| `UNKNOWN_TYPE` | `event` inconnu pour une montre |
| `UNKNOWN_SENSOR` | `sensorId` absent du registre, ou capteur qui écrit sur le mauvais canal (une montre en MQTT, un PIR en HTTP) |

## Registre des capteurs

Le lien `sensorId` → personne (`seniorId`), pièce et type de capteur est défini au démarrage du nœud **Normaliser** (onglet *On Start* du nœud, ou *Au démarrage* en français). Pour ajouter un capteur, ajouter une ligne dans ce registre. Dans une version ultérieure, ce registre viendra de PostgreSQL (profils et capteurs de chaque senior) plutôt que d'être écrit dans le flow.