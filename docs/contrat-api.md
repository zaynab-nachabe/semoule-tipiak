# Contrat d'API (API ↔ Frontends)

Ce document définit le **contrat de données** entre l'API (NestJS) et l'application web (une application, trois vues : senior, famille, médical — `apps/web`, [ADR 0009](adr/0009-application-web-react-nginx.md)). Il joue, côté affichage, le rôle que le *Format commun des événements* joue côté capteurs : un contrat partagé sur lequel le frontend s'appuie pour développer sans attendre l'implémentation de l'API.

Il réutilise les types du package `shared-types` (`AlertReason`, `Severity`, `EscalationCause`, `CancellationCause`, `IsoUtcTimestamp`…) et ne les redéfinit pas.

> **Source de vérité.** En cas de divergence entre ce document et `shared-types`, c'est `shared-types` qui fait foi : le contrat s'y aligne. Les vues, énumérations et messages décrits ici sont définis dans `packages/shared-types/src/api.ts`.
>
> **Implémentation** : `apps/api-gateway` ([README](../apps/api-gateway/README.md), [ADR 0006](adr/0006-api-nestjs-prisma-journal.md)). La colonne « Statut » des tableaux indique ce qui est disponible.

Documents liés : [format-evenements.md](format-evenements.md) · [DDD_specifications.md](DDD_specifications.md)

---

## 1. Principes

- **Point d'entrée unique.** L'application web ne parle qu'à l'API. Ils n'accèdent jamais directement à la base ni aux autres services.
- **Authentification par jeton.** Chaque requête porte un jeton (obtenu à la connexion). Sans jeton valide, l'API répond `401`. La connexion se fait par simple choix du compte dans une liste, sans mot de passe : l'authentification est hors du périmètre du sujet.
- **Filtrage côté serveur.** L'API ne renvoie à chaque rôle que ce à quoi il a droit, selon la règle **(rôle × relation active consentie)** — voir §5. Le filtrage se fait dans l'API, jamais dans le frontend : une donnée non autorisée n'est pas « cachée », elle n'est pas envoyée.
- **Deux canaux.** REST pour la consultation et les actions ; WebSocket pour les alertes poussées en temps réel (§4).
- **Format.** Corps des requêtes et réponses en JSON. Dates en ISO 8601 UTC (`IsoUtcTimestamp`).
- **Adresse.** Les chemins ci-dessous sont ceux de l'API (`http://localhost:3000/...`). L'application web les appelle sous `/api/...` sur sa propre origine (`http://localhost:8080/api/...`) : nginx retire le préfixe et relaie, ainsi que `/socket.io/` pour le temps réel.

---

## 2. Formes de données exposées (Views)

L'API expose des *vues* (projections) adaptées à l'affichage, distinctes des objets internes du domaine. Une même entité (ex. une alerte) est projetée différemment selon le rôle.

> Les vues et énumérations ci-dessous (`AlertStatus`, `SeniorOverallStatus`, `AlertView`…) sont définies dans `shared-types` (`src/api.ts`), partagées API ↔ application web. Elles réutilisent les types existants (`AlertReason`, `Severity`…).

### `AlertStatus` (enum)

`PENDING | PRE_CONFIRMING | ESCALATED | RESOLVED`

### `AlertView`

L'alerte telle que vue par un frontend. Les champs servis dépendent du rôle (§5).

```jsonc
{
  "alertId": "alert-123",
  "seniorId": "senior-001",
  "status": "ESCALATED",                 // AlertStatus
  "reason": "FALL_DETECTED",              // AlertReason (shared-types)
  "severity": "CRITICAL",                // Severity | null — null tant que status ≠ ESCALATED
  "escalationCause": "NO_RESPONSE",       // EscalationCause | null — null tant que non escaladée ; rôle médical
  "cancellationCause": null,              // CancellationCause | null — renseigné si résolue par annulation/reprise
  "createdAt": "2026-01-15T14:32:08.000Z",
  "acknowledgedAt": null,                 // IsoUtcTimestamp | null — renseigné quand le médical prend en charge
  "resolvedAt": null,                     // IsoUtcTimestamp | null
  "closedAt": null                        // IsoUtcTimestamp | null — clôture par le médical après intervention
}
```

> `severity` et `escalationCause` n'existent dans le domaine qu'au moment de l'escalade (`CriticalAlertGeneratedPayload`). Ils sont donc **nullable** : une alerte `PENDING` ou `PRE_CONFIRMING` les a à `null`.
> La prise en charge par le médical (`acknowledge`, §3) se matérialise par `acknowledgedAt`, pas par un statut distinct : le cycle de vie reste à quatre statuts.

### `SeniorOverallStatus` (enum)

`OK | ALERT_IN_PROGRESS` — statut synthétique d'affichage (concept de vue, pas de signal métier).

### `SeniorStatusView`

Le statut courant d'un senior, pour la vue de tête de chaque frontend.

```jsonc
{
  "seniorId": "senior-001",
  "overallStatus": "OK",                 // SeniorOverallStatus
  "lastActivityAt": "2026-01-15T14:05:00.000Z",
  "currentRoom": "salon",                 // reconstruit depuis les événements de présence
  "activeAlert": null,                    // AlertView | null
  "latestHeartRate": null,                // MeasurementPointView | null — rôles senior/médical ; absent pour la famille
  "absence": {                            // AbsenceView | null — absence déclarée par le senior (ADR 0011), visible de tous
    "since": "2026-01-15T09:00:00.000Z",
    "until": "2026-01-15T17:00:00.000Z"   // retour prévu
  }
}
```

### `MeasurementPointView`

Un point de série temporelle, pour les graphiques. `unit` reprend celle du payload du type mesuré (`bpm` pour `HEART_RATE`…).

```jsonc
{ "timestamp": "2026-01-15T14:00:00.000Z", "value": 72, "unit": "bpm" }
```

### `SensorHealthView`

Un capteur attendu et son état ([ADR 0012](adr/0012-surveillance-capteurs.md)) : dernier état publié par la détection (`SensorStatusChanged`), dernier signal reçu et dernière batterie (historique des signaux). Famille et senior : version simplifiée (`model` et `expectedIntervalMinutes` à `null`).

```jsonc
{
  "sensorId": "pir-chambre",
  "kind": "PIR",                          // SensorKind : PIR | PRESSURE_PLATE | WATCH
  "room": "chambre",
  "location": null,
  "status": "LOW_BATTERY",                // SensorStatus : ONLINE | OFFLINE | LOW_BATTERY
  "statusChangedAt": "2026-01-15T14:35:10.000Z",
  "lastSeenAt": "2026-01-15T14:35:00.000Z",
  "battery": { "value": 12, "unit": "%" },
  "model": "Aqara RTCGQ11LM",             // médical uniquement
  "expectedIntervalMinutes": 120          // médical uniquement : au-delà sans signal, le capteur est muet
}
```

### `NotificationView`

Une notification remise à **une personne** (boîte de réception de la famille et du médical). Le service de notification choisit les rôles, la priorité et le texte ; l'API la remet aux personnes de ce rôle qui ont une relation consentie avec le senior ([ADR 0008](adr/0008-service-de-notification.md)). `priority` : `INFO | NORMAL | URGENT`. Le texte est rédigé pour être lu par la famille : il décrit la situation, sans donnée médicale.

```jsonc
{
  "notificationId": "5b0c…",
  "seniorId": "senior-001",
  "alertId": "a1b2…",                 // null pour une notification de capteur (sensorId renseigné, severity SYSTEM)
  "sensorId": null,
  "priority": "URGENT",
  "severity": "CRITICAL",
  "reason": "FALL_DETECTED",
  "title": "Chute : aucun signe de relèvement",
  "message": "Plusieurs minutes après une chute, la personne ne s'est toujours pas relevée. Une intervention est nécessaire.",
  "createdAt": "2026-01-15T14:41:00.000Z",
  "readAt": null
}
```

---

## 3. Endpoints REST

> `{seniorId}` identifie la personne suivie. L'accès est vérifié à chaque appel selon §5 : un appelant sans relation consentie sur ce senior reçoit `403`.

### Authentification
| Méthode | Chemin | Rôles | Description | Statut |
|---|---|---|---|---|
| `GET` | `/auth/users` | public | Comptes proposés sur l'écran de connexion : `UserSummary[]` (`email`, `fullName`, `role`). | ✅ |
| `POST` | `/auth/login` | public | Requête `LoginRequest` (`{ email }`), réponse `LoginResponse` (`{ token, user }`). Compte inconnu → `401`. | ✅ |
| `POST` | `/auth/logout` | tous | `204`. Le jeton (JWT) est sans état : l'application l'oublie ; il expire au bout de 12 h. | ✅ |
| `GET` | `/me` | tous | `MeView` : profil, rôle et seniors accessibles (`{ seniorId, fullName }[]`). | ✅ |

### Notifications (boîte de réception de l'appelant)
| Méthode | Chemin | Rôles | Description | Statut |
|---|---|---|---|---|
| `GET` | `/me/notifications?unreadOnly=true` | tous (en pratique famille et médical) | `Paginated<NotificationView>` : uniquement les notifications de l'appelant, de la plus récente à la plus ancienne. | ✅ |
| `POST` | `/me/notifications/{notificationId}/read` | tous | Marque comme lue → `NotificationView` avec `readAt` (idempotent). La notification d'une autre personne → `404`. | ✅ |

### Consultation
| Méthode | Chemin | Rôles | Renvoie | Statut |
|---|---|---|---|---|
| `GET` | `/seniors/{seniorId}/status` | senior, famille, médical | `SeniorStatusView` (projeté selon le rôle) | ✅ |
| `GET` | `/seniors/{seniorId}/alerts` | senior, famille, médical | `Paginated<AlertView>` (historique) | ✅ |
| `GET` | `/seniors/{seniorId}/alerts/{alertId}` | senior, famille, médical | `AlertView` | ✅ |
| `GET` | `/seniors/{seniorId}/measurements?type=HEART_RATE&from=…&to=…` | médical | `Paginated<MeasurementPointView>` (`type` : `HEART_RATE`, `FALL_IMPACT` ou `SENSOR_HEARTBEAT`) | ✅ |
| `GET` | `/seniors/{seniorId}/activity?from=…&to=…` | famille, médical | Activité agrégée (forme à définir) | non réalisé (tendances d'activité) |
| `GET` | `/seniors/{seniorId}/sensors` | senior, famille, médical | `SensorHealthView[]` : la montre, puis les capteurs fixes par pièce ; projetée selon le rôle ([ADR 0012](adr/0012-surveillance-capteurs.md)) | ✅ |

### Actions
| Méthode | Chemin | Rôles | Description | Statut |
|---|---|---|---|---|
| `POST` | `/seniors/{seniorId}/alerts/{alertId}/cancel` | senior | « Tout va bien » : annule une levée de doute en cours. `202` + `ActionAcceptedView` (`{ eventId }` du signal produit) ; l'annulation arrive ensuite en temps réel (`alert.updated`, `RESOLVED`). Levée de doute terminée → `409`. Ingestion indisponible → `503`. | ✅ |
| `POST` | `/seniors/{seniorId}/help` | senior | « J'ai besoin d'aide » : même effet que le bouton de la montre (niveau 3). `202` + `ActionAcceptedView`. Ingestion indisponible → `503`. | ✅ |
| `POST` | `/seniors/{seniorId}/alerts/{alertId}/acknowledge` | médical | Prise en charge → renseigne `acknowledgedAt` (idempotent ; alerte résolue → `409`). | ✅ |
| `POST` | `/seniors/{seniorId}/alerts/{alertId}/close` | médical | Clôture après intervention → `RESOLVED`, renseigne `closedAt` (et `acknowledgedAt` s'il manquait). Seule une alerte escaladée se clôture : levée de doute en cours ou alerte déjà résolue → `409`. | ✅ |
| `POST` | `/seniors/{seniorId}/absence` | senior | « Je m'absente » : corps `AbsenceRequest` (`{ until }`, retour prévu en ISO 8601 UTC, dans le futur, au plus 24 h ; sinon `400`) → `201` + `AbsenceView`. Remplace une absence en cours. L'inactivité n'est plus surveillée jusqu'au retour ([ADR 0011](adr/0011-absence-declaree.md)). | ✅ |
| `DELETE` | `/seniors/{seniorId}/absence` | senior | « Je suis rentré(e) » : fin de l'absence en cours → `204` (idempotent). L'API la termine aussi seule sur un mouvement au domicile plus de 15 min après le départ. | ✅ |

### Configuration (médical uniquement)
| Méthode | Chemin | Description | Statut |
|---|---|---|---|
| `GET` | `/seniors/{seniorId}/thresholds` | Profil d'activité : `ActivityProfile` (`{ seniorId, timeZone, thresholds: ToleranceThreshold[] }`, §10 de [format-evenements.md](format-evenements.md)). | ✅ |
| `PUT` | `/seniors/{seniorId}/thresholds` | Remplace tous les seuils : corps `ThresholdsUpdateRequest` (`{ thresholds }`, 0 à 10 seuils, au plus un sans plage horaire) → `ActivityProfile`. Seuil invalide → `400`. L'API publie aussitôt le profil sur `profiles/{seniorId}` : la détection l'applique sans relire la base ([ADR 0010](adr/0010-detection-inactivite.md)). | ✅ |
| `GET` / `POST` / `DELETE` | `/seniors/{seniorId}/contacts` | Gérer les contacts d'urgence (`EmergencyContact` — forme à définir). | à venir |

> Les plages de routine du DDD (`TimeRange`) sont portées par les seuils eux-mêmes (`timeRange`), il n'y a donc pas d'endpoint `/routines` séparé.
>
> **Point d'accès interne** (pas pour l'application) : `GET /internal/activity-profiles` renvoie tous les profils à la détection, au démarrage. Il exige l'en-tête `x-service-token` (clé partagée `SERVICE_TOKEN`), sinon `401`.

> Les actions côté senior (`cancel`, `help`) passent par l'ingestion, comme le bouton de la montre ([ADR 0007](adr/0007-actions-application-via-ingestion.md)) : l'API vérifie les droits, puis transmet l'action à Node-RED, qui la normalise en signal `CANCEL_ALERT` ou `HELP_BUTTON` (route `POST /ingest/app`, source `app-{seniorId}`). La détection ne fait pas de différence entre la montre et l'application. C'est pourquoi la réponse est `202` : l'effet (annulation, alerte de niveau 3) arrive par le temps réel.

---

## 4. Temps réel (WebSocket)

L'application ouvre une connexion **socket.io** sur le port de l'API, avec le jeton dans `auth: { token }`. L'API vérifie le jeton, puis abonne la connexion aux seniors auxquels elle a droit et à sa propre boîte de réception (message `ready` : `{ seniors: string[] }`) ; un jeton invalide ferme la connexion. L'API y pousse, sans que le client interroge en boucle :

| Message poussé | Contenu | Rôles concernés | Statut |
|---|---|---|---|
| `preconfirmation.requested` | `Pick<PreConfirmationRequestedPayload, 'alertId' \| 'reason' \| 'expiresAt'>` + `seniorId` | senior uniquement (affiche « tout va bien ? ») | ✅ |
| `alert.created` | `AlertView` | senior : dès la levée de doute ; famille et médical : **à partir de l'escalade** (niveau 2 et plus, ADR 0005) | ✅ |
| `alert.updated` | `AlertView` (statut, gravité ou prise en charge changés) | idem | ✅ |
| `notification.created` | `NotificationView` | **le seul destinataire** : famille (`NORMAL` au niveau 2, `URGENT` au niveau 3) et médical (`INFO` puis `URGENT`) | ✅ |
| `sensor.changed` | `{ seniorId, sensor: SensorHealthView }` | tous ceux ayant accès au senior, projeté selon le rôle (capteur muet, batterie faible, de nouveau en ligne) | ✅ |
| `absence.changed` | `{ seniorId, absence: AbsenceView \| null }` | tous ceux ayant accès au senior (absence déclarée, terminée ou remplacée) | ✅ |
| `status.changed` | `SeniorStatusView` | tous ceux ayant accès au senior | à venir |

Chaque message est **projeté selon le rôle** du destinataire (§5) : la famille reçoit la gravité mais pas la cause clinique, le senior ni l'une ni l'autre.

> Le temps réel sert surtout l'alerte de chute et la pré-confirmation, qui doivent apparaître immédiatement. La consultation ordinaire passe par REST. Les messages sont typés dans `shared-types` (`RealtimeMessageByType`).

---

## 5. Règle de filtrage (qui voit quoi)

L'autorisation combine **deux conditions** (voir le DDD, `Profile & Consent Management Context`) :

1. **Relation active** : il existe une relation consentie, non révoquée, entre l'appelant et le senior. Sinon → `403`.
2. **Rôle** : ce que le rôle autorise à voir ou faire.

Projection par rôle :

| Donnée | Senior | Famille | Médical |
|---|---|---|---|
| Statut global, alerte en cours | ✅ (simplifié) | ✅ | ✅ |
| Historique des alertes | ✅ (les siennes) | ✅ | ✅ (détaillé + `escalationCause`) |
| `severity` de l'alerte | — | ✅ | ✅ |
| Fréquence cardiaque (valeur/courbes) | ✅ (valeur du jour) | — | ✅ (brut + historique) |
| Activité / tendances | résumé personnel | résumé | détaillé |
| État des capteurs | ✅ (simplifié : « votre montre ne transmet plus ») | ✅ (simplifié) | ✅ |
| Seuils d'inactivité (lecture et écriture), contacts | — | — | ✅ |
| Annuler une alerte, demander de l'aide | ✅ | — | — |
| Déclarer une absence, « je suis rentré(e) » | ✅ | — (la voit dans le statut) | — (la voit dans le statut) |

> La famille ne reçoit jamais les données médicales détaillées (fréquence cardiaque brute, causes cliniques). C'est la minimisation des données (RGPD) appliquée au niveau de l'API.

---

## 6. Conventions

- **Codes de réponse** : `200` ok, `201` créé, `202` action transmise (effet asynchrone), `400` requête invalide, `401` non authentifié, `403` non autorisé (rôle ou relation), `404` introuvable, `409` conflit (ex. annuler une alerte déjà résolue), `503` service nécessaire indisponible (ex. ingestion pour les actions du senior).
- **Erreurs** : corps `{ "error": { "code": "...", "message": "..." } }` (type `ApiError`) ; `code` vaut `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `SERVICE_UNAVAILABLE` ou `INTERNAL_ERROR`.
- **Pagination** : `?page=…&pageSize=…` sur les listes (défaut 1 et 20, `pageSize` ≤ 100) ; réponse `Paginated<T>` = `{ items: T[], total, page, pageSize }`, du plus récent au plus ancien.
- **Cohérence des types** : les énumérations (`status`, `reason`, `severity`…) vivent dans `shared-types`. Toute évolution s'y fait, puis se répercute ici.