# API (api-gateway)

Point d'entrée unique de l'application web (trois vues : senior, famille, médical). REST pour la consultation et les actions, WebSocket pour le temps réel. Elle tient aussi le **journal des alertes** et l'**historique des signaux**, à partir des événements MQTT. Contrat : [docs/contrat-api.md](../../docs/contrat-api.md). Décisions : [ADR 0006](../../docs/adr/0006-api-nestjs-prisma-journal.md).

```
application web ──REST / WebSocket──► API ──► PostgreSQL (Prisma)
                                       ▲  │
           MQTT  alerts/#  ────────────┤  │  journal des alertes + temps réel
           MQTT  signals/# ────────────┤  │  historique des signaux
           MQTT  notifications/+ ──────┘  │  boîte de réception de chaque destinataire (ADR 0008)
                                          └──► Node-RED POST /ingest/app : actions du senior (ADR 0007)
```

## Organisation

```
src/
├── access/        règle d'accès : rôle × relation consentie (fonctions pures + service)
├── alerts/        journal des alertes : mise à jour par événement (pure), projection par rôle, service
├── auth/          connexion par choix du compte, jeton JWT, garde, /me
├── seniors/       endpoints /seniors/:seniorId/…, statut reconstruit
├── signals/       historique des signaux (décision D3)
├── notifications/ boîte de réception de l'appelant, remise aux destinataires (ADR 0008)
├── actions/       transmission des actions du senior à Node-RED (ADR 0007)
├── events/        abonnements MQTT (alerts/#, signals/#, notifications/+), validation contre les JSON Schemas
├── realtime/      WebSocket (socket.io)
├── health/        /health (healthcheck Docker)
├── common/        format d'erreur, pagination, dédoublonnage
├── seed.ts        données de démonstration (idempotent)
└── main.ts
prisma/            schéma et migrations (première version : lot B1, Anaïs Lacouture)
```

## Endpoints disponibles

| Méthode | Chemin | Rôles | Rôle de l'endpoint |
|---|---|---|---|
| `GET` | `/auth/users` | public | Comptes proposés sur l'écran de connexion |
| `POST` | `/auth/login` | public | `{ "email": "…" }` → `{ token, user }` |
| `POST` | `/auth/logout` | tous | Jeton sans état : l'application l'oublie |
| `GET` | `/me` | tous | Profil, rôle, seniors accessibles |
| `GET` | `/seniors/{seniorId}/status` | tous | Statut courant, projeté selon le rôle |
| `GET` | `/seniors/{seniorId}/alerts` | tous | Historique paginé (`?page=&pageSize=`) |
| `GET` | `/seniors/{seniorId}/alerts/{alertId}` | tous | Une alerte |
| `POST` | `/seniors/{seniorId}/alerts/{alertId}/acknowledge` | médical | Prise en charge |
| `POST` | `/seniors/{seniorId}/alerts/{alertId}/close` | médical | Clôture après intervention (alerte escaladée uniquement, sinon `409`) |
| `POST` | `/seniors/{seniorId}/alerts/{alertId}/cancel` | senior | « Tout va bien » pendant la levée de doute → `202` (sinon `409`) ; transmis à Node-RED |
| `POST` | `/seniors/{seniorId}/help` | senior | « J'ai besoin d'aide » → `202` ; transmis à Node-RED |
| `GET` | `/me/notifications?unreadOnly=true` | tous | Boîte de réception de l'appelant |
| `POST` | `/me/notifications/{notificationId}/read` | tous | Marquer comme lue (celle d'un autre → `404`) |
| `GET` | `/seniors/{seniorId}/measurements?type=HEART_RATE&from=&to=` | médical | Mesures brutes (`HEART_RATE`, `FALL_IMPACT`, `SENSOR_HEARTBEAT`) |
| `GET` | `/health` | public | État de la base et du lien MQTT |

Toutes les routes `/seniors/…` exigent `Authorization: Bearer <jeton>` (sinon `401`) et une relation consentie avec le senior (sinon `403`). Erreurs au format `{ "error": { "code", "message" } }`.

**Temps réel** (socket.io, même port) : se connecter avec `auth: { token }`. Messages : `ready`, `preconfirmation.requested` (senior uniquement), `alert.created` / `alert.updated` (senior pour ses alertes ; famille et médical à partir de l'escalade, niveau 2 et plus), `notification.created` (au seul destinataire). Les actions du senior répondent `202` : leur effet arrive par ce canal. Si Node-RED ne répond pas, `503`.

## Lancer

Avec toute la pile (recommandé) :

```bash
docker compose up --build -d
curl http://localhost:3000/auth/users
```

Au démarrage, le conteneur applique les migrations, insère les données de démonstration (René le senior `senior-001`, Marie sa fille, Dr Martin), puis lance l'API.

## Tests

```bash
npm test --workspace @project/api-gateway        # tests unitaires (Jest, sans base ni broker)
npm run typecheck --workspace @project/api-gateway
```

Scénario de bout en bout sur la pile Docker (aussi exécuté par la CI, délais raccourcis) :

```bash
PRE_CONFIRMATION_DELAY_S=6 CRITICAL_ESCALATION_DELAY_S=6 docker compose up -d --build --wait
PRE_CONFIRMATION_DELAY_S=6 CRITICAL_ESCALATION_DELAY_S=6 node apps/api-gateway/test/e2e/fall-scenario.e2e.mjs
```

Il envoie une chute par la « montre » et vérifie, pour chaque rôle, le temps réel (niveaux 1, 2, 3), les notifications, la consultation REST, les règles d'accès (401, 403), la prise en charge et la clôture ; puis « tout va bien » et « j'ai besoin d'aide » envoyés depuis l'API, et l'application web servie par nginx (`WEB_URL`, défaut `http://localhost:8080`).

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | — | Connexion PostgreSQL (construite par `docker-compose.yml` à partir de `.env`) |
| `MQTT_URL` | `mqtt://localhost:1883` | Broker |
| `MQTT_CLIENT_ID` | `api-gateway` | Identifiant fixe de la session persistante |
| `JWT_SECRET` | `dev-secret-change-me` | Secret de signature des jetons |
| `JWT_EXPIRES_IN` | `12h` | Durée de validité d'un jeton |
| `NODE_RED_URL` | `http://localhost:1880` | Node-RED, qui reçoit les actions du senior (`http://node-red:1880` sous Docker) |
| `PORT` | `3000` | Port HTTP et WebSocket |

## Pas encore fait

| Élément du contrat | Étape prévue |
|---|---|
| `GET …/activity`, `GET …/sensors` | Inactivité (scénario B) et surveillance des capteurs |
| `GET`/`PUT …/thresholds`, `…/routines`, `…/contacts` | Inactivité (scénario B) |

## Limites connues

Voir [ADR 0006](../../docs/adr/0006-api-nestjs-prisma-journal.md) : jeton sans révocation, pas de mot de passe, détection non informée de la clôture d'une alerte, historique sans durée de conservation, une seule instance (identifiant MQTT fixe). [ADR 0007](../../docs/adr/0007-actions-application-via-ingestion.md) : les boutons du senior dépendent de Node-RED.
