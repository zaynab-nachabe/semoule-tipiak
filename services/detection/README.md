# Détection (Correlation & Detection Context)

Cœur de métier du système (DDD §3.1). Ce service reçoit les signaux normalisés sur MQTT, applique les règles de corrélation et publie une pré-confirmation ou une alerte, avec une gravité sur l'échelle à 4 niveaux.

**Périmètre actuel : la chute (scénario A du DDD).** L'inactivité anormale (scénario B, `ActivityProfile`, `InactivityWindow`) viendra dans une branche suivante.

Décisions : [ADR 0001](../../docs/adr/0001-detection-typescript-mqttjs.md) (TypeScript simple + mqtt.js), [0002](../../docs/adr/0002-mqtt-seul-bus-de-messages.md) (MQTT seul), [0003](../../docs/adr/0003-detection-chute-deux-niveaux.md) (détection en deux niveaux, 3,0 g), [0004](../../docs/adr/0004-sequence-de-relevement.md) (séquence de relèvement), [0005](../../docs/adr/0005-echelle-de-gravite.md) (gravité).

## Organisation

```
src/
├── domain/                     aucun import de MQTT, de Node.js ou d'un framework
│   ├── entities/alert.ts       Alert (DDD §4.2) : PENDING → PRE_CONFIRMING → ESCALATED (WARNING → CRITICAL) | RESOLVED
│   ├── value-objects/          PreConfirmation, RecoveryProgress (séquence de relèvement), FallDetectionPolicy
│   ├── events/                 FallSuspected (événement interne)
│   ├── repositories/           AlertRepository (interface)
│   └── services/               CorrelationService (DDD §4.5) et ports (horloge, minuteur, identifiants, publication)
├── infrastructure/             adaptateurs MQTT, dépôt en mémoire, horloge système, configuration, journal
├── app.ts                      assemblage domaine + adaptateurs
└── main.ts                     point d'entrée du conteneur
```

## Enchaînements

```
FALL_IMPACT (≥ 3,0 g) ─► PreConfirmationRequested (niveau 1, 60 s)
  ├─► CANCEL_ALERT, ou séquence de relèvement ────► PreConfirmationCanceled
  ├─► HELP_BUTTON ────────────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
  └─► 60 s sans réponse ni relèvement ─────────────► PreConfirmationTimeoutExpired + CriticalAlertGenerated (WARNING, NO_RESPONSE)
        ├─► HELP_BUTTON ──────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
        ├─► 5 min sans relèvement ────────────────► CriticalAlertGenerated (CRITICAL, NO_RECOVERY)
        └─► séquence de relèvement ───────────────► alerte close, pas de niveau 3
HELP_BUTTON hors de toute alerte en cours ────────► CriticalAlertGenerated (CRITICAL, IMMEDIATE)
```

**Séquence de relèvement** : une **activité** (`PIR_MOTION` ou `PRESSURE_PLATE`) après l'impact, puis dans les 90 s une **stabilité** (`PRESSURE_PLATE` à `PRESSED`, ou `PIR_MOTION` dans une autre pièce). Si la levée de doute expire au milieu de la séquence, la décision est reportée une seule fois jusqu'à la fin des 90 s.

## Paramètres

Lus dans les variables d'environnement (voir `docker-compose.yml`). Laisser une variable vide garde la valeur par défaut.

| Variable | Défaut | Rôle | Justification |
|---|---|---|---|
| `MQTT_URL` | `mqtt://localhost:1883` | Adresse du broker | — |
| `MQTT_CLIENT_ID` | `detection` | Identifiant fixe de la session persistante | ADR 0002 |
| `FALL_MIN_IMPACT_G` | `3.0` | Pic d'impact minimal (SVtot, g) | ADR 0003 |
| `PRE_CONFIRMATION_DELAY_S` | `60` | Durée de la levée de doute | DDD, scénario A |
| `RECOVERY_WINDOW_S` | `90` | Délai entre activité et stabilité | ADR 0004 |
| `CRITICAL_ESCALATION_DELAY_S` | `300` | Délai du niveau 2 au niveau 3 sans relèvement | ADR 0005 |

Pour une démonstration, raccourcir les délais dans `.env` (par exemple `PRE_CONFIRMATION_DELAY_S=15` et `CRITICAL_ESCALATION_DELAY_S=30`).

## Lancer

```bash
docker compose up --build -d mosquitto detection
docker compose logs -f detection     # une ligne JSON par événement publié
```

Publier une chute et écouter les alertes :

```bash
docker exec mosquitto mosquitto_sub -v -t 'alerts/#'
docker exec mosquitto mosquitto_pub -q 1 -t signals/senior-001/FALL_IMPACT -m '{"eventId":"a1b2c3d4-0000-4000-8000-000000000001","seniorId":"senior-001","sensorId":"watch-001","type":"FALL_IMPACT","timestamp":"2026-01-15T14:32:08.000Z","payload":{"value":9.8,"unit":"g"}}'
```

Avec toute la chaîne (`docker compose up --build`), le bouton « chute » de l'onglet **Simulateur** de Node-RED produit le même résultat.

## Robustesse de l'entrée

Chaque message reçu sur `signals/+/+` est :

1. lu comme JSON, puis **validé** contre `raw-signal.schema.json` ;
2. comparé à son **topic** (`signals/{seniorId}/{type}` doit correspondre au contenu) ;
3. **dédoublonné** par `eventId` (QoS 1 peut livrer deux fois) ;
4. transmis au domaine ; une erreur du domaine est journalisée sans arrêter le service.

Un message refusé est journalisé (`docker compose logs detection`) et ignoré.

## Tests

```bash
npm test --workspace @project/detection        # domaine + intégration MQTT (vitest)
npm run typecheck --workspace @project/detection
npm run build --workspace @project/detection   # bundle dist/main.js (esbuild)
```

- **Domaine** : chaque règle (niveaux, séquence de relèvement, report, cas limites) avec un temps simulé, sans attendre 60 s.
- **Intégration** : le service complet contre un vrai broker MQTT (aedes, dans le processus de test) : enchaînement des 3 niveaux, doublons, messages invalides, et **session persistante** (un signal publié pendant que le service est arrêté est traité au redémarrage).
- **CI** : construit l'image Docker, démarre Mosquitto et la détection, publie une chute et vérifie l'alerte de niveau 1.

## Limites connues

Elles sont volontairement conservées et alimentent la matrice des risques.

| Limite | Conséquence |
|---|---|
| État en mémoire (alertes en cours, minuteurs) | Un redémarrage du service perd les levées de doute et escalades en cours ; la session persistante ne redonne que les messages non encore reçus, pas l'état |
| Un seul exemplaire du service (identifiant MQTT fixe) | Pas de redondance ; deux exemplaires se déconnecteraient mutuellement |
| Relèvement après le niveau 2 non annoncé | La vue famille garde l'alerte de niveau 2 affichée |
| Autre personne présente dans le logement | Un mouvement dans une autre pièce peut faire croire à un relèvement : chute manquée |
| Chute dans une pièce sans capteur | Relèvement non observable : fausse alerte de niveau 2 |
| Ordre fondé sur les horodatages | Un décalage d'horloge entre la montre et la passerelle peut fausser la séquence |
| `ActivityHistory` (DDD §4.5) pas encore utilisé | Utile pour le scénario B ; la `Map<Date, RawSignal>` du DDD ne fonctionne pas en JavaScript (une clé `Date` est comparée par référence), il faudra indexer par horodatage numérique |
| Seuils par senior pas encore lus en base | Viendra avec le schéma PostgreSQL (`ActivityProfileRepository`) |
