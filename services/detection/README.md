# Détection (Correlation & Detection Context)

Cœur de métier du système (DDD §3.1). Ce service reçoit les signaux normalisés sur MQTT, applique les règles de corrélation et publie une pré-confirmation ou une alerte, avec une gravité sur l'échelle à 4 niveaux.

**Périmètre : la chute (scénario A du DDD), l'inactivité prolongée (scénario B) et la surveillance des capteurs (risque R1).**

Décisions : [ADR 0001](../../docs/adr/0001-detection-typescript-mqttjs.md) (TypeScript simple + mqtt.js), [0002](../../docs/adr/0002-mqtt-seul-bus-de-messages.md) (MQTT seul), [0003](../../docs/adr/0003-detection-chute-deux-niveaux.md) (détection en deux niveaux, 3,0 g), [0004](../../docs/adr/0004-sequence-de-relevement.md) (séquence de relèvement), [0005](../../docs/adr/0005-echelle-de-gravite.md) (gravité), [0010](../../docs/adr/0010-detection-inactivite.md) (inactivité, seuils lus à l'API puis mis à jour par message), [0011](../../docs/adr/0011-absence-declaree.md) (absence déclarée), [0012](../../docs/adr/0012-surveillance-capteurs.md) (surveillance des capteurs).

## Organisation

```
src/
├── domain/                     aucun import de MQTT, de Node.js ou d'un framework
│   ├── aggregates/             ActivityProfile (DDD §4.1) : quel seuil d'inactivité à quelle heure
│   ├── entities/alert.ts       Alert (DDD §4.2) : PENDING → PRE_CONFIRMING → ESCALATED (WARNING → CRITICAL) | RESOLVED
│   ├── value-objects/          PreConfirmation, RecoveryProgress (séquence de relèvement), FallDetectionPolicy, InactivityPolicy
│   ├── events/                 FallSuspected (événement interne)
│   ├── repositories/           AlertRepository, ActivityProfileRepository (interfaces)
│   └── services/               CorrelationService (DDD §4.5) et ports (horloge, minuteur, identifiants, publication)
├── infrastructure/             adaptateurs MQTT (signaux, profils), lecture des profils à l'API, dépôts en mémoire, horloge, configuration, journal
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

**Inactivité prolongée** (vérifiée chaque minute) :

```
plus d'activité depuis le seuil du profil ─► PreConfirmationRequested (PROLONGED_INACTIVITY, niveau 1, 60 s)
  ├─► CANCEL_ALERT, ou une activité ────────────► PreConfirmationCanceled
  ├─► HELP_BUTTON ──────────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
  └─► 60 s sans réponse ─► PreConfirmationTimeoutExpired, puis selon la fréquence cardiaque :
        ├─ récente (< 10 min) et normale (40–150) ─► CriticalAlertGenerated (WARNING, NO_RESPONSE), puis NO_RECOVERY après 5 min sans activité
        └─ absente ou anormale ─────────────────────► CriticalAlertGenerated (CRITICAL, NO_HEART_SIGNAL)
```

**Activité** : `PIR_MOTION` ou changement d'une bande de pression, dans n'importe quelle pièce (« tout va bien » compte aussi). **Seuil applicable** : au lit (bande du lit appuyée), le plus long du profil ; sinon le plus court des seuils dont la plage contient l'heure locale ; sinon le seuil sans plage. **Profils** : lus à l'API au démarrage (`GET /internal/activity-profiles`, clé `SERVICE_TOKEN`, nouvel essai toutes les 5 s), puis mis à jour par les messages `profiles/{seniorId}`. Une seule alerte à la fois par senior.

**Absence déclarée** (« je m'absente », reçue dans le profil) : pas de surveillance de l'inactivité jusqu'au retour prévu ; ensuite, le temps sans activité se compte depuis l'heure de retour prévue (ou depuis la fin anticipée de l'absence). La chute et le bouton d'aide restent surveillés.

**Surveillance des capteurs** (`SensorSupervisionService`, vérification chaque minute) : pour chaque capteur attendu du profil, `OFFLINE` si aucun signal depuis plus que son intervalle attendu (2 h pour les capteurs Zigbee, 15 min pour la montre), `LOW_BATTERY` si la dernière batterie est sous 20 %, `ONLINE` sinon. Publie `SensorStatusChanged` (niveau 0, `SYSTEM`) à chaque changement d'état seulement.

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
| `INACTIVITY_CHECK_INTERVAL_S` | `60` | Fréquence de vérification des seuils d'inactivité | ADR 0010 |
| `HEART_RATE_FRESHNESS_S` | `600` | Âge maximal d'une fréquence cardiaque « rassurante » | ADR 0010 |
| `SENSOR_CHECK_INTERVAL_S` | `60` | Fréquence de vérification des capteurs muets | ADR 0012 |
| `LOW_BATTERY_PERCENT` | `20` | Seuil de batterie faible | ADR 0012 |
| `API_URL` | `http://localhost:3000` | API qui fournit les profils au démarrage (`http://api-gateway:3000` sous Docker) | ADR 0010 |
| `SERVICE_TOKEN` | `dev-service-token-change-me` | Clé partagée avec l'API pour `/internal/activity-profiles` | ADR 0010 |

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

Chaque message reçu sur `signals/+/+` (et de même sur `profiles/+`, contre `activity-profile.schema.json`) est :

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

- **Domaine** : chaque règle (niveaux, séquence de relèvement, report, cas limites ; seuils jour/nuit, au lit, fréquence cardiaque, une alerte à la fois) avec un temps simulé, sans attendre 60 s ni 2 h.
- **Profils** : validation des messages `profiles/{seniorId}`, chargement initial avec nouvel essai et clé de service (faux `fetch`).
- **Intégration** : le service complet contre un vrai broker MQTT (aedes, dans le processus de test) : enchaînement des 3 niveaux, doublons, messages invalides, et **session persistante** (un signal publié pendant que le service est arrêté est traité au redémarrage).
- **CI** : scénario de bout en bout sur toute la pile (`apps/api-gateway/test/e2e`), dont une inactivité avec un seuil d'une minute fixé par le médical.

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
| Seuils pas encore chargés (API arrêtée au démarrage) | Inactivité non surveillée tant que l'API ne répond pas ; le journal l'indique à chaque essai |
| Redémarrage de la détection | Le temps sans activité repart de zéro : une inactivité en cours est détectée en retard |
| Mise à jour de profil publiée pendant une longue coupure du broker | Ancien profil gardé jusqu'au prochain redémarrage de la détection |
| Surveillance des capteurs repartie de zéro au redémarrage | Chaque capteur est supposé en ligne ; un capteur déjà muet est signalé avec un retard d'au plus un intervalle |
| Registre des capteurs en double (Node-RED et API) | Un capteur ajouté à un seul registre est rejeté ou jamais surveillé |
| Sommeil hors du lit (fauteuil) | Le seuil de jour s'applique en journée : levée de doute possible pendant une sieste |
| `ActivityHistory` (DDD §4.5) réduit à l'essentiel | Dernière activité, état du lit et dernière fréquence cardiaque par senior, pas l'historique complet ; la `Map<Date, RawSignal>` du DDD ne fonctionnerait pas en JavaScript (clé `Date` comparée par référence) |
