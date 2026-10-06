# Modélisation DDD (Domain-Driven Design)
## Projet : Maintien à domicile des seniors et coordination des soins

Ce document définit l'architecture métier du système en appliquant les concepts du Domain-Driven Design (DDD). L'objectif est d'aligner la conception logicielle avec les exigences du métier (santé, sécurité...). 

Pour garantir une transition fluide vers le code, les concepts métiers ( en français) sont associés à la version anglaise pour correspondre à notre implémentation technique.

---

## 1. Langage Ubiquitaire (Ubiquitous Language)

Afin d'éviter toute ambiguïté entre les développeurs et les experts métiers (corps médical, famille), nous définissons le vocabulaire strict qui sera utilisé dans la documentation et son équivalent dans le code.

### 1.1. Les Acteurs et Rôles
*   **Personne Accompagnée / `Senior`** : L'acteur principal du système. Il s'agit d'une personne autonome vivant seule, qui génère des données et interagit avec le système pour confirmer ou infirmer son état de santé.
*   **Aidant / `Caregiver`** : Le corps médical. Il peut s'agir d'un médecin, d'une infirmière... Il reçoit les alertes critiques et peut consulter l'historique des événements.
*  ** Proche / `Relative`** : Membre de la famille ou proche du `Senior`. Il reçoit les notifications d'alerte et peut interagir avec le système pour confirmer l'état du `Senior`.

### 1.2. Les Concepts Métiers Fondamentaux
*   **Profil d'Activité / `ActivityProfile`** : Le modèle de référence définissant la routine habituelle de la personne accompagnée (calculé historiquement) (ex: temps passé habituellement dans la salle de bain le matin).
*   **Seuil de Tolérance / `ToleranceThreshold`** : Limite de temps ou de variation (configurée par l'équipe médicale) au-delà de laquelle une inactivité devient anormale.
*   **Signal Brut / `RawSignal`** : Une donnée entrante, issue d'un capteur matériel (montre, détecteur PIR). Un signal seul ne déclenche jamais d'alerte.
*   **Fenêtre d'Inactivité / `InactivityWindow`** : Période calculée par le système représentant une absence de `RawSignal` dans une zone donnée.
*   **Pré-confirmation (Levée de doute) / `PreConfirmation`** : Mécanisme d'interaction directe avec le `Senior`. Le système lui demande de confirmer son état (via un écran ou une montre) avant de qualifier l'incident.
*   **Alerte Critique / `CriticalAlert`** : Un incident avéré (soit confirmé par le `Senior`, soit non infirmé après expiration de la `PreConfirmation`). Elle déclenche le protocole d'assistance.

---

## 2. Domain Storytelling (Scénarios Métiers)

Pour valider notre compréhension du flux de données et des règles de décision, voici les scénarios métiers de référence (Domain Stories).

### Scénario A : Chute suspectée résolue par le Senior (Fausse Alerte)
1.  L'accéléromètre de la montre génère un `RawSignal` de type *Impact*.
2.  Le système de détection reçoit le signal et initie immédiatement un processus de `PreConfirmation`.
3.  La montre du `Senior` vibre et affiche la question : "Avez-vous chuté ?". Un minuteur de 60 secondes démarre.
4.  Le `Senior` appuie sur "Non, tout va bien".
5.  Le système annule la procédure. Aucune `CriticalAlert` n'est générée, évitant ainsi de déranger inutilement les `Caregivers`. L'événement est toutefois journalisé pour l'historique médical.

### Scénario B : Inactivité anormale avec escalade (Alerte Réelle)
1.  Le système détecte une `InactivityWindow` de 2 heures dans le salon.
2.  Le système consulte le `ActivityProfile` du `Senior` et constate que cette durée dépasse le `ToleranceThreshold` configuré pour cette plage horaire.
3.  Le système déclenche une `PreConfirmation` sur la tablette du salon.
4.  Le délai de la `PreConfirmation` expire sans réponse de la part du `Senior`.
5.  Le système croise cette information avec l'absence de `RawSignal` cardiaque (montre déconnectée ou signal plat).
6.  Le système génère une `CriticalAlert` avec le motif *Inactivité prolongée et absence de réponse*.
7.  Le module de notification distribue la `CriticalAlert` aux `Caregivers` selon leurs préférences (SMS à la famille, notification web à l'équipe médicale).

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

*   **`Notification Context`** : Responsable de la distribution finale des messages (envoi effectif des Push, SMS ou Emails) selon les préférences des utilisateurs.
*   **`Authentication Context`** : Gestion des sessions sécurisées (JWT, Login).

### 3.4. Context Map (Cartographie des relations)

Pour que ces *Bounded Contexts* collaborent sans partager le même modèle de base de données, nous définissons leurs relations et contrats de communication :

1.  **Relation Ingestion -> Détection (Anti-Corruption Layer)**
    *   L'`Ingestion Gateway Context` se place en amont (Upstream). Il agit comme une **Anti-Corruption Layer (ACL)**. Il protège notre cœur de métier en traduisant les signaux physiques en événements propres (`RawSignalReceived`). Ainsi, si on change de marque de capteur demain, seul Node-RED est impacté, le `Correlation Context` ne change pas.
2.  **Relation Profils -> Détection (Conformist / Shared Kernel restreint)**
    *   Le `Correlation Context` a besoin de lire les `ToleranceThresholds` stockés dans le `Profile Management Context` pour prendre ses décisions.
3.  **Relation Détection -> Notification (Publisher / Subscriber)**
    *   Le `Correlation Context` (Upstream) émet un événement asynchrone `CriticalAlertGenerated`. Le `Notification Context` (Downstream) l'écoute et se charge de prévenir les `FamilyMembers` et `MedicalStaffs`.

## 4. DDD Tactique (Tactical Design)

Cette section se concentre sur l'intérieur de notre *Bounded Context* principal : le **Correlation & Detection Context**. C'est ici que l'on définit les objets exacts qui seront codés dans le service de Détection dédié.

### 4.1. Agrégats et Racines d'Agrégat (Aggregate & Aggregate Root)

* **Aggregate Root : `ActivityProfile`**
  C'est l'objet principal qui garantit la cohérence des règles pour un senior donné. Il centralise les paramètres pour éviter que la logique de détection ne lise des données incohérentes.
  * *Attributs :*
    * `seniorId` (UUID)
    * `expectedRoutines` : Liste de `TimeRange` (habitudes de vie).
    * `thresholds` : Liste de `ToleranceThreshold`.

  * *Comportements (Méthodes) :*
    * `updateRoutine(newRoutine)`
    * `evaluateInactivity(lastMovementTimestamp) -> boolean` : Vérifie si le délai sans mouvement dépasse le seuil configuré.

### 4.2. Entités (Entities)

Objets possédant une identité unique qui évolue dans le temps (cycle de vie).

* **`Alert`**
  * *Attributs :* `alertId`, `seniorId`, `createdAt`, `status` (Enum: PENDING, PRE_CONFIRMING, ESCALATED, RESOLVED), `reason` (Enum: FALL_DETECTED, PROLONGED_INACTIVITY).
  * *Comportements :*
    * `escalate()` : Passe le statut à ESCALATED (Alerte critique).
    * `resolve(resolutionReason)` : Clôture l'alerte (ex: fausse alerte confirmée par un mouvement).

### 4.3. Objets de Valeur (Value Objects) & Enums

Objets immuables définis uniquement par leurs propriétés. S'ils changent, on crée un nouvel objet. Nous utilisons des `Enums` stricts pour éviter les erreurs de frappe dans le code.

* **`SignalType` (Enum)** : `PIR_MOTION`, `HEART_RATE_ANOMALY`, `FALL_IMPACT`, `HELP_BUTTON`.

* **`RawSignal`** : `{ sensorId: string, type: SignalType, value: number, timestamp: Date }`

* **`ToleranceThreshold`** : `{ condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, severity: 'HIGH' }`
* **`TimeRange`** : `{ startTime: '22:00', endTime: '07:00' }`
* **`PreConfirmation`** : `{ seniorId: string, alertId: string, requestedAt: Date, expiresAt: Date }`
* **HeartRateMeasurement** : `{ value: number, unit: 'BPM', timestamp: Date }`

### 4.4. Événements de Domaine (Domain Events)

Ils permettent aux différentes parties du système de réagir de manière asynchrone, ce qui est la base de notre Event-Driven Architecture.

* *Événements d'entrée :*
  * `RawSignalReceived` : Émis par Node-RED, déclenche l'analyse.
  * `FallSuspected` : Déclenche la demande de pré-confirmation.
  * `PreConfirmationTimeoutExpired` : Déclenché par un minuteur interne si le senior ne répond pas.
* *Événements de sortie :*
  * `PreConfirmationRequested` : Demande d'afficher l'alerte sur la montre ou la tablette.
  * `CriticalAlertGenerated` : Déclenche l'envoi du SMS/Push par le module de notification.

### 4.5. Services de Domaine (Domain Services)

*   **`CorrelationService`** : Reçoit les `RawSignalReceived`, interroge le `ActivityProfileRepository` pour connaître les seuils, et applique les règles métiers complexes ("si Chute + Inactivité > Seuil -> `CriticalAlertGenerated`).
    * **`ActivityHistory` (Map)** : Une structure de données clé-valeur (Map) gardant en mémoire les derniers événements d'un Senior pour l'algorithme.
      * *Structure :* `Map<Date, RawSignal>` (Clé : Timestamp, Valeur : Objet Signal).  * `PreConfirmationCanceled` : Le senior a indiqué que tout va bien.

### 4.6. Dépôts (Repositories)

Interfaces permettant de sauvegarder et récupérer nos agrégats sans lier le code métier à la base de données PostgreSQL.

* **`ActivityProfileRepository`** : `findBySeniorId(seniorId)`, `save(profile)`.
* **`AlertRepository`** : `findActiveAlertsBySeniorId(seniorId)`, `save(alert)`.