# Topics MQTT

Tous les échanges asynchrones passent par le broker **Mosquitto** (`mosquitto:1883` depuis les conteneurs, `localhost:1883` depuis la machine hôte). Le format des messages est défini dans [format-evenements.md](format-evenements.md).

---

## 1. Vue d'ensemble

```
[capteurs Zigbee] ─► Zigbee2MQTT ─► zigbee2mqtt/{sensorId} ─┐
                                                            ├─► [Node-RED] ─┬─► signals/{seniorId}/{type} ─► [détection] ─► alerts/{seniorId}/{eventType} ─┬─► [notification] ─► notifications/{seniorId} ─┐
[montre] ─► appli compagnon ─► HTTP POST /ingest/watch ─────┘               │                                                                        │                                                ▼
                                                                            └─► ingestion/rejected                                                   └──────────────────────────────────────► [api-gateway] ─► WebSocket
```

En retour, l'api-gateway publie les seuils d'inactivité modifiés par l'équipe médicale : `[api-gateway] ─► profiles/{seniorId} ─► [détection]`.

---

## 2. Liste des topics

| Topic | Contenu | Format | Publié par | Abonnés |
|---|---|---|---|---|
| `zigbee2mqtt/{sensorId}` | Message brut d'un capteur fixe (PIR, bande de pression) | Format Zigbee2MQTT du modèle de capteur (non normalisé) | Zigbee2MQTT ; en démonstration, le simulateur Node-RED | Node-RED |
| `signals/{seniorId}/{type}` | Signal normalisé (`RawSignal`) | §1 à §3 de `format-evenements.md` | Node-RED | Détection, historisation |
| `ingestion/rejected` | Message que Node-RED n'a pas pu normaliser | §7 de `format-evenements.md` | Node-RED | Supervision / débogage |
| `alerts/{seniorId}/{eventType}` | Événement de domaine (pré-confirmation, alerte critique) | §6 de `format-evenements.md` | Détection | Notification (alertes critiques), api-gateway |
| `notifications/{seniorId}` | Notification à remettre à un rôle (`NotificationRequested`) | §9 de `format-evenements.md` | Notification | api-gateway |
| `profiles/{seniorId}` | Profil d'activité modifié par le médical (`ActivityProfileUpdated` : seuils d'inactivité) | §10 de `format-evenements.md` | api-gateway | Détection |

Exemples :
- `zigbee2mqtt/pir-cuisine`
- `signals/senior-001/FALL_IMPACT`
- `alerts/senior-001/CriticalAlertGenerated`
- `notifications/senior-001`
- `profiles/senior-001`

### Pourquoi `zigbee2mqtt/{sensorId}` en entrée ?

Les capteurs fixes retenus sont des capteurs **Zigbee** du commerce (modèles et formats dans [services/ingestion/README.md](../services/ingestion/README.md#capteurs-réels)). Un capteur Zigbee ne parle pas MQTT : il est appairé à une passerelle **Zigbee2MQTT**, qui publie l'état de chaque appareil sur `zigbee2mqtt/{friendly_name}`. Nous donnons à chaque capteur son `sensorId` comme `friendly_name`.

Garder cette convention a deux avantages :
- **réalisme** : le simulateur publie exactement ce que publierait une vraie passerelle Zigbee2MQTT (même topic, même contenu) ;
- **remplaçabilité** : brancher de vrais capteurs ne demande aucun changement dans Node-RED ni dans le reste du système.

Zigbee2MQTT publie aussi ses propres messages sous `zigbee2mqtt/bridge/...` et, si l'option *availability* est activée, l'état de connexion de chaque capteur sous `zigbee2mqtt/{sensorId}/availability`. Ces topics ont un niveau de plus et ne sont donc pas reçus par l'abonnement `zigbee2mqtt/+`.

### Entrées HTTP (montre, application web)

La montre ne passe pas par MQTT : l'appli compagnon envoie ses données en `POST http://<node-red>:1880/ingest/watch`. Node-RED les normalise et les publie sur `signals/...` comme les autres. Les boutons de la vue senior de l'application web suivent le même chemin : l'API les transmet en `POST http://node-red:1880/ingest/app` (source `app-{seniorId}`, [ADR 0007](adr/0007-actions-application-via-ingestion.md)). Les formats bruts acceptés (capteurs fixes et montre) sont décrits dans [services/ingestion/README.md](../services/ingestion/README.md).

---

## 3. Abonnements par service

Les jokers MQTT permettent à chaque service de ne recevoir que ce qui le concerne :

| Service | Abonnement | Reçoit |
|---|---|---|
| Node-RED | `zigbee2mqtt/+` | Tous les capteurs fixes |
| Détection | `signals/+/+` | Tous les signaux de tous les seniors |
| Détection (seuils) | `profiles/+` | Les profils d'activité modifiés : seuils d'inactivité appliqués sans relire la base ([ADR 0010](adr/0010-detection-inactivite.md)). Au démarrage, la détection lit tous les profils à l'API (HTTP) |
| Notification | `alerts/+/CriticalAlertGenerated` | Les alertes avérées (niveaux 2 et 3) : choix des rôles à prévenir (ADR 0008). La levée de doute est poussée au senior par l'api-gateway |
| api-gateway | `alerts/#` | Tous les événements de domaine : journal des alertes en base, relayés en WebSocket à l'application web |
| api-gateway (historique) | `signals/#` | Tous les signaux, enregistrés dans l'historique en base (table `signals`) |
| api-gateway (notifications) | `notifications/+` | Les notifications par rôle : remises aux personnes ayant une relation consentie (table `notifications`), poussées en WebSocket au seul destinataire |

Un frontend ne s'abonne jamais directement au broker : il passe par l'api-gateway, qui filtre selon les droits de l'utilisateur.

---

## 4. Règles

- **QoS 1** (« au moins une fois ») pour `signals/...`, `alerts/...`, `notifications/...`, `profiles/...` et `ingestion/rejected` : un message n'est pas perdu si le réseau coupe brièvement. Contrepartie : un message peut arriver **en double**, d'où le `eventId` unique qui permet aux abonnés d'ignorer un doublon.
- **Sessions persistantes** (`clean session = false`, identifiant client fixe) pour la détection et la notification : si le service redémarre, le broker garde les messages QoS 1 arrivés entre-temps. Cela limite le risque R9 (perte de données non traitées) sans ajouter de file de messages dédiée (ADR 0002). Mosquitto est configuré avec `persistence true` : les sessions et messages en attente survivent aussi à un redémarrage propre du broker. La détection (identifiant `detection`), la notification (`notification`) et l'api-gateway (`api-gateway`) l'utilisent ; des tests d'intégration le vérifient pour la détection et la notification.
- **Pas de `retain`** : les messages sont des événements, pas des états. Un nouvel abonné ne doit pas recevoir une vieille alerte comme si elle venait d'arriver.
- **Identifiants dans les topics** : `seniorId`, `sensorId` et `type` ne contiennent jamais `/`, `+` ni `#` (caractères réservés de MQTT). Notre typage strict l'impose.
- **Constantes partagées** : les services TypeScript n'écrivent pas les noms de topics à la main, ils utilisent `packages/shared-types/src/topics.ts`.
