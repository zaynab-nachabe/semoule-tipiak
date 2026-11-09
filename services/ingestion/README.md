# Ingestion (Node-RED)

Passerelle d'entrée du système. Elle reçoit les messages bruts des capteurs, les **normalise** vers le format commun ([docs/format-evenements.md](../../docs/format-evenements.md)) et les publie sur le broker MQTT. Aucune logique de détection n'est placée ici.

```
capteurs Zigbee ─ Zigbee2MQTT ─ MQTT zigbee2mqtt/{sensorId} ─┐
                                                             ├─► Adapter ─► Normaliser ─┬─► signals/{seniorId}/{type}
montre ─ appli compagnon ─ HTTP POST /ingest/watch ──────────┘                          └─► ingestion/rejected
```

Fichiers :

| Fichier | Rôle |
|---|---|
| `flows.json` | Les flows : onglet **Ingestion** (le vrai pipeline) et onglet **Simulateur** (capteurs simulés pour tester) |
| `settings.js` | Configuration de Node-RED (montée en lecture seule dans le conteneur) |

**Sous Docker**, les flows sont lus et enregistrés directement dans ce dossier (monté sur `/flows`, variable `FLOWS` de l'image) : un « Deploy » dans l'éditeur modifie `flows.json` du dépôt. L'état d'exécution de Node-RED (modules, clé de chiffrement, contexte) est dans le volume Docker `node-red-data`, pour que le conteneur puisse y écrire quel que soit le propriétaire du dossier du dépôt sur la machine.

## Capteurs réels

Les capteurs sont simulés, mais **chaque capteur simulé correspond à un appareil du commerce** et produit exactement les messages que cet appareil produirait. Brancher le vrai matériel ne demanderait aucun changement dans le système : il suffirait d'ajouter une passerelle Zigbee2MQTT (un dongle Zigbee USB) publiant sur le même broker.

| Rôle | Appareil réel | Liaison | Ce que publie Zigbee2MQTT sur `zigbee2mqtt/{sensorId}` |
|---|---|---|---|
| Détecteur de mouvement (une pièce) | **Aqara RTCGQ11LM** ([fiche Zigbee2MQTT](https://www.zigbee2mqtt.io/devices/RTCGQ11LM.html)) | Zigbee, pile CR2450 | `occupancy` (booléen), `battery` (%), `voltage` (mV), `illuminance` (lx), `device_temperature` (°C), `power_outage_count`, `linkquality` |
| Bande de pression (lit, fauteuil) | **Tuya TS0601_bed_presence_sensor** ([fiche Zigbee2MQTT](https://www.zigbee2mqtt.io/devices/TS0601_bed_presence_sensor.html)) | Zigbee, piles | `occupancy` (booléen : quelqu'un est sur la bande), `battery` (%), `illuminance`, `work_state`, `sensitivity`, `interval_time`, `presence_delay`, `presence_time`, `linkquality` |
| Montre (fréquence cardiaque, chute, bouton) | Montre connectée avec détection de chute (ex. Apple Watch, Samsung Galaxy Watch) | Bluetooth vers le smartphone, puis **HTTP** par l'appli compagnon | Format de l'appli compagnon, décrit plus bas |

Trois comportements réels sont pris en compte par la normalisation :

1. **Zigbee2MQTT republie l'état complet à chaque message** (option `cache_state`, activée par défaut). Un rapport de batterie contient donc aussi la dernière valeur d'`occupancy`. La bande de pression étant un capteur d'**état**, Node-RED mémorise son dernier état et ne publie `PRESSURE_PLATE` que lorsqu'il **change** ; sinon chaque rapport répéterait « PRESSED » et fausserait le calcul du temps passé au lit.
2. **Le détecteur Aqara repasse à `occupancy: false` après 90 s** (option `occupancy_timeout` de Zigbee2MQTT), et ignore tout mouvement pendant 60 s après une détection. Un `occupancy: true` est donc une nouvelle détection, publiée comme `PIR_MOTION`.
3. **Les champs propres au matériel** (`voltage`, `illuminance`, `linkquality`…) ne font pas partie du contrat : ils sont ignorés.

Pour aller plus loin (non implémenté) : Zigbee2MQTT peut publier la connexion de chaque capteur sur `zigbee2mqtt/{sensorId}/availability` (`{"state":"online"}` / `{"state":"offline"}`), ce qui aiderait à détecter un capteur muet (risque R1).

## Lancer et tester

```bash
docker compose up -d
```

Ouvrir http://localhost:1880, onglet **Simulateur**, ouvrir le panneau *debug* (icône scarabée), puis cliquer sur le bouton à gauche d'un nœud *inject*. Chaque bouton envoie le message que publierait l'appareil réel ; le résultat apparaît dans *Signal normalisé* ou *Message rejeté*. Les boutons « ERREUR » vérifient le chemin de rejet.

On peut aussi publier à la main :

```bash
# détecteur de mouvement, message tel que publié par Zigbee2MQTT
docker exec mosquitto mosquitto_pub -t zigbee2mqtt/pir-cuisine -m '{"battery":100,"illuminance":112,"linkquality":87,"occupancy":true,"voltage":3025}'
# écouter le résultat
docker exec mosquitto mosquitto_sub -v -t 'signals/#' -t 'ingestion/rejected'
# montre, via HTTP
curl -X POST http://localhost:1880/ingest/watch -H 'Content-Type: application/json' \
     -d '{"sensorId":"watch-001","event":"HEART_RATE","value":72}'
```

## Formats bruts acceptés

### Capteurs fixes (MQTT, topic `zigbee2mqtt/{sensorId}`)

Un objet JSON par message, au format Zigbee2MQTT de l'appareil (voir tableau ci-dessus).

| Capteur | Message reçu | Signal produit |
|---|---|---|
| Détecteur de mouvement | `occupancy: true` | `PIR_MOTION` (la pièce vient du registre) |
| Détecteur de mouvement | `occupancy: false` avec `battery` | `SENSOR_HEARTBEAT` (le capteur est vivant, rien n'a bougé) |
| Détecteur de mouvement | `occupancy: false` sans `battery` | *rien* |
| Bande de pression | `occupancy` **différent** du dernier état connu | `PRESSURE_PLATE`, `state: PRESSED` (`true`) ou `RELEASED` (`false`) |
| Bande de pression | `occupancy` identique au dernier état, avec `battery` | `SENSOR_HEARTBEAT` |
| L'un ou l'autre | `battery` seul | `SENSOR_HEARTBEAT` |

Un champ `timestamp` (ISO 8601 UTC) est utilisé s'il est présent, sinon l'heure de réception. Les messages de Zigbee2MQTT lui-même (`zigbee2mqtt/bridge`) sont ignorés.

### Montre (HTTP, `POST /ingest/watch`)

Les montres grand public ne parlent pas MQTT : leurs données passent par l'appli compagnon du smartphone, qui les relaie en HTTP. Corps JSON envoyé par cette appli (simulée ici) ; `event` doit être un type de signal qu'une montre peut produire.

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

Un message qui ne peut pas être normalisé n'est jamais perdu en silence : il part sur `ingestion/rejected` avec le motif (format §7 de [format-evenements.md](../../docs/format-evenements.md)). Motifs produits :

| Motif | Cas |
|---|---|
| `INVALID_JSON` | Le message MQTT n'est pas du JSON |
| `INVALID_PAYLOAD` | Pas un objet, valeur hors limites, mauvais type de champ, horodatage invalide |
| `MISSING_FIELD` | `sensorId`, `event`, ou le champ attendu du capteur est absent |
| `UNKNOWN_TYPE` | `event` inconnu pour une montre |
| `UNKNOWN_SENSOR` | `sensorId` absent du registre, ou capteur qui écrit sur le mauvais canal (une montre en MQTT, un PIR en HTTP) |

## Registre des capteurs

Le lien `sensorId` → personne (`seniorId`), pièce, type et modèle de capteur est défini au démarrage du nœud **Normaliser** (onglet *On Start* du nœud, ou *Au démarrage* en français). Le `sensorId` est le `friendly_name` du capteur dans Zigbee2MQTT. Pour ajouter un capteur, ajouter une ligne dans ce registre. Dans une version ultérieure, ce registre viendra de PostgreSQL (profils et capteurs de chaque senior) plutôt que d'être écrit dans le flow.

## Tests automatiques

La CI exécute le code des nœuds du flow (sans Node-RED) sur des messages valides et invalides, dont des messages réels de Zigbee2MQTT, et vérifie que chaque sortie respecte les JSON Schemas de [`packages/shared-types`](../../packages/shared-types). Elle vérifie aussi que chaque bouton du simulateur produit le résultat annoncé. En local :

```bash
npm install && npm test
```

> Si vous modifiez le flow dans l'éditeur Node-RED, vérifiez que `flows.json` reste valide avec `npm test` avant de le commiter. Les noms des nœuds `Adapter MQTT`, `Adapter HTTP`, `Normaliser` et `Réponse HTTP` sont utilisés par les tests : ne pas les renommer sans adapter `packages/shared-types/test/contract.test.mjs`.
