# Modélisation DDD (Domain-Driven Design)
## Projet : Maintien à domicile des seniors et coordination des soins

Ce document définit l'architecture métier du système en appliquant les concepts du Domain-Driven Design (DDD). L'objectif est d'aligner la conception logicielle avec les exigences du métier (santé, sécurité...). 

Pour garantir une transition fluide vers le code, les concepts métiers (en français) sont associés à la version anglaise pour correspondre à notre implémentation technique.

---

## 1. Langage Ubiquitaire (Ubiquitous Language)

Afin d'éviter toute ambiguïté entre les développeurs et les experts métiers (corps médical, famille), nous définissons le vocabulaire strict qui sera utilisé dans la documentation et son équivalent dans le code.

### 1.1. Les Acteurs et Rôles
*   **Personne Accompagnée / `Senior`** : L'acteur principal du système. Il s'agit d'une personne autonome vivant seule, qui génère des données et interagit avec le système pour confirmer ou infirmer son état de santé.
*   **Aidant / `MedicalStaff`** : Le corps médical. Il peut s'agir d'un médecin, d'une infirmière... Il reçoit les alertes critiques et peut consulter l'historique des événements.
*   **Proche / `FamilyMember`** : Membre de la famille ou proche du `Senior`. Il reçoit les notifications d'alerte et peut interagir avec le système pour confirmer l'état du `Senior`.

### 1.2. Les Concepts Métiers Fondamentaux
*   **Profil d'Activité / `ActivityProfile`** : Le modèle de référence définissant la routine habituelle de la personne accompagnée (calculé historiquement) (ex: temps passé habituellement dans la salle de bain le matin).
*   **Seuil de Tolérance / `ToleranceThreshold`** : Durée sans activité (configurée par l'équipe médicale), éventuellement limitée à une plage horaire (jour, nuit), au-delà de laquelle une inactivité devient anormale.
*   **Absence déclarée / `Absence`** : Sortie annoncée par le `Senior` (« je m'absente »), avec une heure de retour prévue (au plus 24 h). Pendant une absence, l'inactivité n'est pas surveillée ; la chute et le bouton d'aide le restent. Elle se termine à l'heure prévue, sur « je suis rentré(e) », ou au premier mouvement au domicile après le délai de départ. Voir [ADR 0011](adr/0011-absence-declaree.md).
*   **Signal Brut / `RawSignal`** : Une donnée entrante, issue d'un capteur matériel (montre, détecteur PIR). Un signal seul ne déclenche jamais d'alerte.
*   **Fenêtre d'Inactivité / `InactivityWindow`** : Période calculée par le système représentant une absence d'activité (mouvement ou changement d'une bande de pression), dans tout le logement.
*   **Pré-confirmation (Levée de doute) / `PreConfirmation`** : Mécanisme d'interaction directe avec le `Senior`. Le système lui demande de confirmer son état (via un écran ou une montre) avant de qualifier l'incident.
*   **Alerte Critique / `CriticalAlert`** : Un incident avéré (soit confirmé par le `Senior`, soit non infirmé après expiration de la `PreConfirmation`). Elle déclenche le protocole d'assistance. Elle porte un **niveau de gravité** : `WARNING` (non infirmée) ou `CRITICAL` (urgence confirmée).
*   **Niveau de gravité / `Severity`** : Échelle à 4 niveaux qui dit quoi faire : `SYSTEM` (0, événement technique : batterie faible, capteur muet), `PRE_ALERT` (1, levée de doute en cours), `WARNING` (2, incident non infirmé : la famille est prévenue), `CRITICAL` (3, urgence confirmée : l'équipe médicale et la famille sont prévenues). Voir [ADR 0005](adr/0005-echelle-de-gravite.md).
*   **Séquence de relèvement / `RecoveryProgress`** : Preuve que la personne s'est relevée après un impact. Un signal isolé ne suffit pas (une personne au sol peut bouger) : il faut une **activité** (mouvement ou bande de pression), puis une **stabilité** (personne sur le lit ou le fauteuil, ou déplacée dans une autre pièce). Voir [ADR 0004](adr/0004-sequence-de-relevement.md).

---

## 2. Domain Storytelling (Scénarios Métiers)

Pour valider notre compréhension du flux de données et des règles de décision, voici les scénarios métiers de référence (Domain Stories).

### Scénario A : Chute suspectée résolue par le Senior (Fausse Alerte)
1.  La montre reconnaît une chute (pic d'accélération puis changement d'orientation) et génère un `RawSignal` de type *Impact* (`FALL_IMPACT`, pic de 9,8 g).
2.  Le système de détection reçoit le signal : l'impact dépasse le seuil de 3,0 g, il initie immédiatement un processus de `PreConfirmation` (niveau 1, `PRE_ALERT`).
3.  La montre du `Senior` vibre et affiche la question : "Avez-vous chuté ?". Un minuteur de 60 secondes démarre.
4.  Le `Senior` appuie sur "Non, tout va bien".
5.  Le système annule la procédure. Aucune `CriticalAlert` n'est générée, évitant ainsi de déranger inutilement les `MedicalStaff`. L'événement est toutefois journalisé pour l'historique médical.

**Variantes du scénario A** (même début, étapes 1 à 3) :
*   **Le `Senior` se relève sans répondre** : un détecteur voit du mouvement dans la chambre, puis la bande de pression du lit passe à « appuyée » : la séquence de relèvement est complète, la procédure est annulée comme en 5.
*   **Le `Senior` reste au sol** : le minuteur expire sans réponse ni relèvement. Le système génère une `CriticalAlert` de niveau `WARNING` : la famille est prévenue dans l'application. Cinq minutes plus tard, toujours aucun signe de relèvement : l'alerte passe au niveau `CRITICAL` et l'équipe médicale est prévenue à son tour.
*   **Le `Senior` demande de l'aide** : il appuie sur le bouton d'aide pendant la question ou après l'alerte de niveau `WARNING` : l'alerte passe immédiatement au niveau `CRITICAL`.

### Scénario B : Inactivité anormale avec escalade (Alerte Réelle)
1.  Le système détecte une `InactivityWindow` de 2 heures en journée : aucun mouvement dans le logement, et la personne n'est pas au lit.
2.  Le système consulte le `ActivityProfile` du `Senior` et constate que cette durée dépasse le `ToleranceThreshold` configuré pour cette plage horaire (2 h le jour, 10 h la nuit ; au lit, le seuil le plus long s'applique).
3.  Le système déclenche une `PreConfirmation` dans la vue senior de l'application (« Tout va bien ? »). Un mouvement, « tout va bien » ou le bouton d'aide y répondent.
4.  Le délai de la `PreConfirmation` expire sans réponse de la part du `Senior`.
5.  Le système croise cette information avec le signal cardiaque de la montre : une fréquence récente et normale laisse penser que la personne dort (niveau 2, `WARNING`, puis niveau 3 sans activité après le délai) ; une montre muette ou un signal anormal fait passer **directement au niveau 3** (`CRITICAL`, cause `NO_HEART_SIGNAL`).
6.  Le système génère une `CriticalAlert` avec le motif *Inactivité prolongée* (`PROLONGED_INACTIVITY`). Règles détaillées : [ADR 0010](adr/0010-detection-inactivite.md).
7.  Le module de notification distribue la `CriticalAlert` selon sa gravité, dans l'application : vue famille et vue de l'équipe médicale.

### Scénario C : Sortie déclarée (« je m'absente »)
1.  Le `Senior` part faire ses courses. Dans la vue senior, il appuie sur « Je m'absente » et indique qu'il rentre vers 17 h.
2.  Le système enregistre l'`Absence` et la transmet à la détection dans l'`ActivityProfile`. La famille voit « Sorti(e), retour prévu à 17:00 ».
3.  Le logement reste calme tout l'après-midi : aucune `PreConfirmation` d'inactivité n'est déclenchée.
4.  Le `Senior` rentre à 16 h et oublie de le signaler : le détecteur du salon voit du mouvement, plus de 15 minutes après son départ. Le système termine l'absence ; la surveillance de l'inactivité reprend à partir de ce moment.

**Variantes du scénario C** :
*   **Le `Senior` signale son retour** : il appuie sur « Je suis rentré(e) » ; même effet qu'en 4.
*   **Le `Senior` ne rentre pas** : à 17 h, l'absence se termine d'elle-même. Le temps sans activité se compte à partir de 17 h : sans mouvement au domicile, une `PreConfirmation` d'inactivité arrive après le seuil habituel (2 h en journée), puis l'escalade du scénario B.
*   **Le `Senior` chute dehors avec sa montre** : la chute reste détectée pendant l'absence (scénario A), si la montre peut joindre son smartphone.

## 3. DDD Stratégique (Strategic Design) & Context Map

Afin de diviser la complexité du projet, le système est découpé en plusieurs sous-domaines (Subdomains) selon leur valeur métier.

### 3.1. Core Subdomain (Cœur de métier)

*   **`Correlation & Detection Context`** : Bounded Context chargé de recevoir le flux d'événements, d'appliquer les règles de corrélation temporelles (croisement des `RawSignals`), de les comparer au `ActivityProfile` et de statuer sur le déclenchement d'une `CriticalAlert` ou d'une `PreConfirmation`. 

### 3.2. Supporting Subdomains (Domaines de support)
Nécessaires au fonctionnement global, mais ne portant pas l'algorithmique de détection.

*   **`Ingestion Gateway Context` (Implémenté via Node-RED)** : Sa responsabilité est la normalisation. Il est chargé d'unifier les protocoles entrants (MQTT, HTTP...) et les traduit en un format compréhensible par notre système.
*   **`Profile & Consent Management Context` (Implémenté via NestJS)** : Gère le CRUD (Create, Read, Update, Delete) des `Seniors`, `FamilyMembers` et `MedicalStaffs`. Il gère les droits d'accès pour s'assurer qu'un membre de la famille ne voit pas les données médicales confidentielles.

### 3.3. Generic Subdomains (Domaines génériques)
Des problèmes standards déjà résolus par l'industrie, que nous intégrons sans y investir trop de logique métier.

*   **`Notification Context`** : Responsable de la distribution finale des alertes : choix des destinataires selon la gravité, affichage dans l'application (vues famille et médicale) et journalisation. Un canal externe (SMS, push) pourrait s'y ajouter sans changer les autres contextes.
*   **`Authentication Context`** : Gestion des sessions sécurisées (JWT, Login).

### 3.4. Context Map (Cartographie des relations)

Pour que ces *Bounded Contexts* collaborent sans partager le même modèle de base de données, nous définissons leurs relations et contrats de communication :

1.  **Relation Ingestion -> Détection (Anti-Corruption Layer)**
    *   L'`Ingestion Gateway Context` se place en amont (Upstream). Il agit comme une **Anti-Corruption Layer (ACL)**. Il protège notre cœur de métier en traduisant les signaux physiques en événements propres (`RawSignalReceived`). Ainsi, si on change de marque de capteur demain, seul Node-RED est impacté, le `Correlation Context` ne change pas.
2.  **Relation Profils -> Détection (Conformist / Shared Kernel restreint)**
    *   Le `Correlation Context` a besoin de lire les `ToleranceThresholds` stockés dans le `Profile Management Context` pour prendre ses décisions.
    *   **Mise en œuvre** ([ADR 0010](adr/0010-detection-inactivite.md)) : au démarrage, la détection lit tous les profils à l'API ; ensuite, l'API publie chaque profil modifié sur `profiles/{seniorId}`. La détection garde les profils en mémoire et ne lit jamais la base.
3.  **Relation Détection -> Notification**
    *   Le `Correlation Context` (Upstream) émet un événement asynchrone `CriticalAlertGenerated`. Le `Notification Context` (Downstream) l'écoute et se charge de prévenir les `FamilyMembers` et `MedicalStaffs`.
    *   **Note d'infrastructure** : Pour éviter la complexité d'un bus de messages lourd tout en respectant l'architecture événementielle, ce couplage est implémenté en réutilisant le broker MQTT (Mosquitto) déjà présent pour l'ingestion des capteurs ([ADR 0002](adr/0002-mqtt-seul-bus-de-messages.md)). Le service de détection publie ses événements sur `alerts/{seniorId}/{eventType}`, que le module de notification écoute (voir `topics-mqtt.md`).

## 4. DDD Tactique (Tactical Design)

Cette section se concentre sur l'intérieur de notre *Bounded Context* principal : le **Correlation & Detection Context**. C'est ici que l'on définit les objets exacts qui seront codés dans le service de Détection dédié.

### 4.1. Agrégats et Racines d'Agrégat (Aggregate & Aggregate Root)

* **Aggregate Root : `ActivityProfile`**
  C'est l'objet principal qui garantit la cohérence des règles pour un senior donné. Il centralise les paramètres pour éviter que la logique de détection ne lise des données incohérentes.
  * *Attributs :*
    * `seniorId` (UUID)
    * `timeZone` : fuseau horaire du logement (les plages horaires sont en heure locale).
    * `thresholds` : Liste de `ToleranceThreshold`, chacun avec sa plage horaire facultative (`TimeRange`). Les habitudes de vie (`expectedRoutines`) sont portées par ces plages : pas de liste séparée.
    * `absence` : `Absence` en cours (`{ since, until }`) ou `null` ([ADR 0011](adr/0011-absence-declaree.md)).

  * *Comportements (Méthodes) :*
    * `applicableThresholdMinutes(at, resting)` : seuil à appliquer à cet instant (au lit : le plus long ; sinon le plus court des seuils dont la plage contient l'heure ; sinon le seuil sans plage).
    * `evaluateInactivity(lastActivityAt, now, resting) -> boolean` : Vérifie si le délai sans activité dépasse le seuil applicable.
    * `isAbsentAt(at) -> boolean` : la personne est sortie (avant le retour prévu) : pas de surveillance de l'inactivité.
    * `inactiveSince(lastActivityAt) -> Date` : point de départ du temps sans activité : la dernière activité, ou le retour prévu s'il est plus récent.
    * Le profil est remplacé en entier quand l'équipe médicale le modifie (pas de `updateRoutine` séparé).

### 4.2. Entités (Entities)

Objets possédant une identité unique qui évolue dans le temps (cycle de vie).

* **`Alert`**
  * *Attributs :* `alertId`, `seniorId`, `createdAt`, `status` (Enum: PENDING, PRE_CONFIRMING, ESCALATED, RESOLVED), `reason` (Enum: FALL_DETECTED, PROLONGED_INACTIVITY, HELP_REQUESTED), `severity` (`WARNING` ou `CRITICAL`, renseignée à l'escalade).
  * *Comportements :*
    * `startPreConfirmation()` : Passe de PENDING à PRE_CONFIRMING (levée de doute en cours).
    * `escalate(severity)` : Passe le statut à ESCALATED (Alerte critique) au niveau `WARNING` ou `CRITICAL`.
    * `raiseToCritical()` : Fait passer une alerte escaladée de `WARNING` à `CRITICAL`.
    * `resolve(resolutionReason)` : Clôture l'alerte (ex: fausse alerte confirmée par un relèvement), pendant la levée de doute ou après une alerte `WARNING`.
  * *Invariants :* une alerte `CRITICAL` n'évolue plus ; une alerte est **active** tant qu'elle peut encore évoluer (PENDING, PRE_CONFIRMING, ou ESCALATED en `WARNING`).
  * *Cycle de vie :* `PENDING → PRE_CONFIRMING → ESCALATED (WARNING → CRITICAL) | RESOLVED`.

### 4.3. Objets de Valeur (Value Objects) & Enums

Objets immuables définis uniquement par leurs propriétés. S'ils changent, on crée un nouvel objet. Nous utilisons des `Enums` stricts pour éviter les erreurs de frappe dans le code.

> L'enum `SignalType` et les payloads ci-dessous doivent rester identiques à ceux du document *Format commun des événements*. Toute modification se répercute dans les deux.

* **`SignalType` (Enum)** : `PIR_MOTION`, `PRESSURE_PLATE`, `HEART_RATE`, `FALL_IMPACT`, `HELP_BUTTON`, `CANCEL_ALERT`, `SENSOR_HEARTBEAT`.

* **`RawSignal`** : `{ eventId: string, seniorId: string, sensorId: string, type: SignalType, timestamp: Date, payload: SignalPayload }`
  * **`SignalPayload`** (le contenu dépend du `type`) :
    * **PIRMotionPayload** : `{ room: string }`
    * **PressurePlatePayload** : `{ room: string, location: string, state: 'PRESSED' | 'RELEASED' }`
    * **HeartRatePayload** : `{ value: number, unit: 'bpm' }`
    * **FallImpactPayload** : `{ value: number, unit: 'g' }`
    * **HelpButtonPayload** : `{}`
    * **CancelAlertPayload** : `{ alertId?: string }` (sans `alertId`, l'annulation porte sur toutes les levées de doute en cours)
    * **SensorHeartbeatPayload** : `{ value: number, unit: '%' }`

  > Convention : toute donnée mesurée porte `{ value, unit }` ; les états et références (pièce, emplacement, identifiant) utilisent un champ nommé.

* **`ToleranceThreshold`** : `{ condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, timeRange: { startTime: '07:00', endTime: '22:00' } }` (`timeRange: null` : seuil par défaut). Le niveau de l'alerte n'est pas porté par le seuil : il dépend de la fréquence cardiaque ([ADR 0010](adr/0010-detection-inactivite.md)).
* **`TimeRange`** : `{ startTime: '22:00', endTime: '07:00' }` (heure locale ; une plage peut passer minuit).
* **`Absence`** : `{ since: Date, until: Date }` : sortie déclarée par le `Senior`, du départ au retour prévu (au plus 24 h).
* **`PreConfirmation`** : `{ seniorId: string, alertId: string, requestedAt: Date, expiresAt: Date }`
* **`Severity` (Enum)** : `SYSTEM`, `PRE_ALERT`, `WARNING`, `CRITICAL` (niveaux 0 à 3, voir §1.2).
* **`EscalationCause` (Enum)** : pourquoi une alerte est escaladée : `NO_RESPONSE` (levée de doute expirée, niveau 2), `SENIOR_CONFIRMED` (bouton d'aide pendant l'incident, niveau 3), `IMMEDIATE` (demande d'aide spontanée, niveau 3), `NO_RECOVERY` (niveau 2 resté sans relèvement ni activité, niveau 3), `NO_HEART_SIGNAL` (inactivité sans réponse ni fréquence cardiaque rassurante, niveau 3).
* **`CancellationCause` (Enum)** : `SENIOR_CANCELED` (« tout va bien »), `ACTIVITY_RESUMED` (séquence de relèvement observée).
* **`RecoveryProgress`** : état de la séquence de relèvement après un impact : `FALLEN` → `ACTIVE { activityAt, room }` → `RECOVERED { confirmedAt, confirmingEventId }`. Immuable : chaque signal d'activité produit un nouvel état.
* **`FallDetectionPolicy`** : paramètres de la détection de chute : `minFallImpact` (3,0 g), `preConfirmationDelayMs` (60 s), `recoveryConfirmationWindowMs` (90 s), `criticalEscalationDelayMs` (5 min). Voir ADR 0003 à 0005.
* **`InactivityPolicy`** : paramètres de l'inactivité : `checkIntervalMs` (vérification chaque minute), `heartRateFreshnessMs` (10 min), `normalHeartRate` (40 à 150 bpm). Voir ADR 0010.

### 4.4. Événements de Domaine (Domain Events)

Ils permettent aux différentes parties du système de réagir de manière asynchrone (conception événementielle interne au contexte, voir note d'infrastructure en 3.4).

* *Événement d'entrée :*
  * `RawSignalReceived` : Émis par Node-RED (signal normalisé sur `signals/{seniorId}/{type}`), déclenche l'analyse.
* *Événement interne au contexte :*
  * `FallSuspected` : Impact au-dessus du seuil ; déclenche la demande de pré-confirmation.
* *Événement d'entrée de configuration :*
  * `ActivityProfileUpdated` : publié par l'API sur `profiles/{seniorId}` quand l'équipe médicale modifie les seuils, ou quand le `Senior` déclare ou termine une absence (format dans `format-evenements.md` §10).
* *Événements de sortie* (publiés sur `alerts/{seniorId}/{eventType}`, format dans `format-evenements.md` §6) :
  * `PreConfirmationRequested` : Demande d'afficher la question sur la montre ou dans la vue senior de l'application (niveau 1).
  * `PreConfirmationCanceled` : Le senior a indiqué que tout va bien, ou s'est relevé ; la procédure est annulée et journalisée.
  * `PreConfirmationTimeoutExpired` : Déclenché par un minuteur interne si le senior ne répond pas ni ne se relève.
  * `CriticalAlertGenerated` : Incident avéré, avec sa gravité ; déclenche la distribution par le module de notification. Une même alerte peut être publiée deux fois : en `WARNING`, puis en `CRITICAL`.

### 4.5. Services de Domaine (Domain Services)

* **`CorrelationService`** : Reçoit les `RawSignalReceived`, interroge l'`ActivityProfileRepository` pour connaître les seuils, et applique les règles métiers complexes. Il s'appuie sur l'`ActivityHistory` pour raisonner sur les derniers signaux. Pour la chute (« si Chute + Inactivité > Seuil → `CriticalAlertGenerated` ») :
  * impact ≥ `minFallImpact` → `FallSuspected` → `PreConfirmationRequested` (niveau 1) ;
  * « tout va bien » ou séquence de relèvement complète → `PreConfirmationCanceled` ;
  * bouton d'aide → `CriticalAlertGenerated` (`CRITICAL`, `SENIOR_CONFIRMED`) ;
  * délai expiré sans réponse ni relèvement → `PreConfirmationTimeoutExpired` puis `CriticalAlertGenerated` (`WARNING`, `NO_RESPONSE`). Si la personne était en train de se relever (activité vue, stabilité pas encore), la décision est reportée une seule fois, jusqu'à la fin du délai de la séquence ;
  * après `WARNING` : bouton d'aide, ou 5 minutes sans relèvement → `CriticalAlertGenerated` (`CRITICAL`) ; relèvement → alerte close sans passage au niveau 3.

  Pour l'inactivité (scénario B, vérification chaque minute) :
  * temps sans activité ≥ seuil applicable → `PreConfirmationRequested` (`PROLONGED_INACTIVITY`) ;
  * « tout va bien » ou une seule activité → `PreConfirmationCanceled` ; bouton d'aide → `CRITICAL` (`SENIOR_CONFIRMED`) ;
  * délai expiré : fréquence cardiaque récente et normale → `WARNING` (`NO_RESPONSE`) puis `CRITICAL` (`NO_RECOVERY`) sans activité ; sinon `CRITICAL` (`NO_HEART_SIGNAL`) directement ;
  * une seule alerte à la fois par senior, et pas de nouvelle alerte d'inactivité tant qu'aucune activité n'a suivi le dernier incident ;
  * pendant une `Absence` : pas de surveillance de l'inactivité ; après le retour prévu (ou la fin anticipée de l'absence), le temps sans activité se compte à partir de ce moment.

* **`ActivityHistory` (structure de données)** : ce que la détection retient en mémoire des derniers signaux de chaque `Senior` pour l'inactivité (scénario B). Réduite à l'essentiel : dernière activité (horodatage et `eventId`), état de la bande du lit, dernière fréquence cardiaque, début du dernier incident. Un historique complet indexé par horodatage n'est pas nécessaire pour ces règles (et une clé `Date` ne conviendrait pas en JavaScript : deux `Date` identiques sont deux clés différentes).

### 4.6. Dépôts (Repositories)

Interfaces permettant de sauvegarder et récupérer nos agrégats sans lier le code métier à la base de données PostgreSQL.

* **`ActivityProfileRepository`** : `findBySeniorId(seniorId)`, `save(profile)`, `all()`. Implémentation en mémoire dans la détection, alimentée par l'API au démarrage puis par les messages `profiles/{seniorId}`.
* **`AlertRepository`** : `findActiveAlertsBySeniorId(seniorId)`, `save(alert)`. Dans le service de détection, son implémentation garde les alertes actives **en mémoire** (pas de requête en base dans le chemin temps réel) ; l'historique durable des alertes est tenu à partir des événements publiés.
