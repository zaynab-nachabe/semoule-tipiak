# Topics MQTT

Tous les échanges asynchrones passent par le broker **Mosquitto** (`mosquitto:1883` depuis les conteneurs, `localhost:1883` depuis la machine hôte). Le format des messages est défini dans [format-evenements.md](format-evenements.md).

---

## 1. Vue d'ensemble

```
[capteurs Zigbee] ─► Zigbee2MQTT ─► zigbee2mqtt/{sensorId} ─┐
                                                            ├─► [Node-RED] ─┬─► signals/{seniorId}/{type} ─► [détection] ─► alerts/{seniorId}/{eventType} ─┬─► [notification]
[montre] ─► appli compagnon ─► HTTP POST /ingest/watch ─────┘               │                                                                        └─► [api-gateway] ─► WebSocket
                                                                            └─► ingestion/rejected
```

---

## 2. Liste des topics

| Topic | Contenu | Format | Publié par | Abonnés |
|---|---|---|---|---|
| `zigbee2mqtt/{sensorId}` | Message brut d'un capteur fixe (PIR, bande de pression) | Format Zigbee2MQTT du modèle de capteur (non normalisé) | Zigbee2MQTT ; en démonstration, le simulateur Node-RED | Node-RED |
| `signals/{seniorId}/{type}` | Signal normalisé (`RawSignal`) | §1 à §3 de `format-evenements.md` | Node-RED | Détection, historisation |
| `ingestion/rejected` | Message que Node-RED n'a pas pu normaliser | §7 de `format-evenements.md` | Node-RED | Supervision / débogage |
| `alerts/{seniorId}/{eventType}` | Événement de domaine (pré-confirmation, alerte critique) | §6 de `format-evenements.md` | Détection | Notification, api-gateway |

Exemples :
- `zigbee2mqtt/pir-cuisine`
- `signals/senior-001/FALL_IMPACT`
- `alerts/senior-001/CriticalAlertGenerated`

### Pourquoi `zigbee2mqtt/{sensorId}` en entrée ?

Les capteurs fixes retenus sont des capteurs **Zigbee** du commerce (modèles et formats dans [services/ingestion/README.md](../services/ingestion/README.md#capteurs-réels)). Un capteur Zigbee ne parle pas MQTT : il est appairé à une passerelle **Zigbee2MQTT**, qui publie l'état de chaque appareil sur `zigbee2mqtt/{friendly_name}`. Nous donnons à chaque capteur son `sensorId` comme `friendly_name`.

Garder cette convention a deux avantages :
- **réalisme** : le simulateur publie exactement ce que publierait une vraie passerelle Zigbee2MQTT (même topic, même contenu) ;
- **remplaçabilité** : brancher de vrais capteurs ne demande aucun changement dans Node-RED ni dans le reste du système.

Zigbee2MQTT publie aussi ses propres messages sous `zigbee2mqtt/bridge/...` et, si l'option *availability* est activée, l'état de connexion de chaque capteur sous `zigbee2mqtt/{sensorId}/availability`. Ces topics ont un niveau de plus et ne sont donc pas reçus par l'abonnement `zigbee2mqtt/+`.

### Entrée HTTP (montre)

La montre ne passe pas par MQTT : l'appli compagnon envoie ses données en `POST http://<node-red>:1880/ingest/watch`. Node-RED les normalise et les publie sur `signals/...` comme les autres. Les formats bruts acceptés (capteurs fixes et montre) sont décrits dans [services/ingestion/README.md](../services/ingestion/README.md).

---

## 3. Abonnements par service

Les jokers MQTT permettent à chaque service de ne recevoir que ce qui le concerne :

| Service | Abonnement | Reçoit |
|---|---|---|
| Node-RED | `zigbee2mqtt/+` | Tous les capteurs fixes |
| Détection | `signals/+/+` | Tous les signaux de tous les seniors |
| Notification | `alerts/+/CriticalAlertGenerated` et `alerts/+/PreConfirmationRequested` | Les alertes à envoyer et les demandes de levée de doute à pousser sur la montre |
| api-gateway | `alerts/#` | Tous les événements de domaine, relayés en WebSocket aux frontends |
| Historisation | `signals/#` | Tous les signaux, pour l'historique en base |

Un frontend ne s'abonne jamais directement au broker : il passe par l'api-gateway, qui filtre selon les droits de l'utilisateur.

---

## 4. Règles

- **QoS 1** (« au moins une fois ») pour `signals/...`, `alerts/...` et `ingestion/rejected` : un message n'est pas perdu si le réseau coupe brièvement. Contrepartie : un message peut arriver **en double**, d'où le `eventId` unique qui permet aux abonnés d'ignorer un doublon.
- **Sessions persistantes** (`clean session = false`, identifiant client fixe) pour la détection et la notification : si le service redémarre, le broker garde les messages QoS 1 arrivés entre-temps. Cela limite le risque R9 (perte de données non traitées) sans ajouter de file de messages dédiée (ADR 0002). Mosquitto est configuré avec `persistence true` : les sessions et messages en attente survivent aussi à un redémarrage propre du broker. La détection l'utilise (identifiant `detection`) ; un test d'intégration le vérifie.
- **Pas de `retain`** : les messages sont des événements, pas des états. Un nouvel abonné ne doit pas recevoir une vieille alerte comme si elle venait d'arriver.
- **Identifiants dans les topics** : `seniorId`, `sensorId` et `type` ne contiennent jamais `/`, `+` ni `#` (caractères réservés de MQTT). Notre typage strict l'impose.
- **Constantes partagées** : les services TypeScript n'écrivent pas les noms de topics à la main, ils utilisent `packages/shared-types/src/topics.ts`.
