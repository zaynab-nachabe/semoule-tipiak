# Notification (Notification Context)

Sous-domaine générique (DDD §3.3). Ce service écoute les alertes avérées et décide **qui prévenir, avec quelle priorité et quel texte**. Il ne connaît pas les personnes : il raisonne par **rôle**, et l'API remet chaque notification aux personnes de ce rôle qui ont une relation consentie avec le senior. Décision : [ADR 0008](../../docs/adr/0008-service-de-notification.md).

```
alerts/{seniorId}/CriticalAlertGenerated ──► notification ──► notifications/{seniorId} ──► API ──► boîte de réception + temps réel
                                                  │
                                                  └──► journal (une ligne JSON par notification)
```

## Règle de routage

| Gravité de l'alerte | Famille | Équipe médicale |
|---|---|---|
| `WARNING` (niveau 2) | `NORMAL` | `INFO` (« Pour information : … ») |
| `CRITICAL` (niveau 3) | `URGENT` | `URGENT` |
| `SYSTEM` (niveau 0) : capteur muet | `NORMAL`, pour la **montre** seulement | `INFO` |
| `SYSTEM` (niveau 0) : batterie faible | — | `INFO` |

Le texte dépend du motif et de la cause de l'escalade (`src/domain/routing.ts`), par exemple « Chute détectée, sans réponse » puis « Chute : aucun signe de relèvement ». Le senior ne reçoit pas de notification : il est sollicité par la levée de doute. Les états de capteurs (`alerts/+/SensorStatusChanged`, [ADR 0012](../../docs/adr/0012-surveillance-capteurs.md)) produisent des notifications **sans alerte** (`alertId` à `null`, `sensorId` renseigné) ; un capteur de nouveau en ligne n'en produit pas. Format du message publié : [`docs/format-evenements.md` §9](../../docs/format-evenements.md).

## Organisation

```
src/
├── domain/
│   ├── routing.ts               règle de routage et textes (fonctions pures)
│   ├── notification-service.ts  une alerte -> une notification par rôle
│   ├── sensor-routing.ts        état d'un capteur -> rôles, priorité, texte (ADR 0012)
│   └── sensor-notification-service.ts  un état de capteur -> une notification par rôle
├── infrastructure/              adaptateurs MQTT (validation, dédoublonnage, publication), configuration, journal
├── app.ts                       assemblage
└── main.ts                      point d'entrée du conteneur
```

## Lancer

```bash
docker compose up --build -d
docker compose logs -f notification     # journal : une ligne par notification envoyée
```

Une alerte de niveau 2 produit par exemple :

```
{"level":"info","service":"notification","message":"notification envoyée","recipientRole":"FAMILY","priority":"NORMAL","severity":"WARNING","title":"Chute détectée, sans réponse",…}
{"level":"info","service":"notification","message":"notification envoyée","recipientRole":"MEDICAL","priority":"INFO","severity":"WARNING","title":"Pour information : Chute détectée, sans réponse",…}
```

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `MQTT_URL` | `mqtt://localhost:1883` | Broker |
| `MQTT_CLIENT_ID` | `notification` | Identifiant fixe de la session persistante |

## Tests

```bash
npm test --workspace @project/notification        # règle de routage + intégration MQTT (vitest)
npm run typecheck --workspace @project/notification
```

- **Unitaires** : routage par gravité, textes par motif, conformité au JSON Schema `notification.schema.json`.
- **Intégration** (broker MQTT réel, aedes) : niveaux 2 puis 3, doublons QoS 1, messages invalides ignorés, session persistante.
- **Bout en bout** (CI) : le scénario de chute vérifie que famille et médical reçoivent leurs notifications avec la bonne priorité, et que la famille les retrouve dans sa boîte de réception.

## Limites connues

Voir [ADR 0008](../../docs/adr/0008-service-de-notification.md) : remise dépendante de l'API, aucune relance d'une notification urgente non lue, pas de notification sans relation consentie.
