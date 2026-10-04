## 4. DDD Tactique (Tactical Design)

Cette section se concentre sur l'intérieur de notre *Bounded Context* principal : le **Correlation & Detection Context**. C'est ici que l'on définit les objets exacts qui seront codés dans l'API NestJS.

### 4.1. Agrégats et Racines d'Agrégat (Aggregate & Aggregate Root)

* **Aggregate Root : `ActivityProfile`**
  C'est l'objet principal qui garantit la cohérence des règles pour un `Senior` donné. Il centralise les paramètres pour éviter que la logique de détection ne lise des données incohérentes.

  * *Attributs :*
    * `seniorId` (UUID)
    * `expectedRoutines` : Liste de `TimeRange` (habitudes de vie configurées, ex: Nuit de 22h à 7h).
    * `thresholds` : Liste de `ToleranceThreshold`.

  * *Comportements (Méthodes) :*
    * `updateRoutine(newRoutine)`
    * `evaluateInactivity(lastActivityMap) -> boolean` : Vérifie si le délai sans mouvement dépasse le seuil configuré.

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

* **`ActivityHistory` (Map)** : Une structure de données clé-valeur (Map) gardant en mémoire les derniers événements d'un Senior pour l'algorithme.
  * *Structure :* `Map<Date, RawSignal>` (Clé : Timestamp, Valeur : Objet Signal).

* **`HeartRateMeasurement`** : `{ value: number, unit: 'bpm' }`

* **`ToleranceThreshold`** : `{ condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, severity: 'HIGH' }`

* **`TimeRange`** : `{ startTime: '22:00', endTime: '07:00' }`

### 4.4. Événements de Domaine (Domain Events)

Ils permettent aux différentes parties du système de réagir de manière asynchrone, ce qui est la base de notre Event-Driven Architecture.

* *Événements d'entrée :*
  * `RawSignalReceived` : Émis par Node-RED, déclenche l'analyse.
  * `FallSuspected` : Déclenche la demande de pré-confirmation.
  * `PreConfirmationTimeoutExpired` : Déclenché par un minuteur interne si le senior ne répond pas.
  * `PreConfirmationCanceled` : Le senior a indiqué que tout va bien.

* *Événements de sortie :*
  * `PreConfirmationRequested` : Demande d'afficher l'alerte sur la montre ou la tablette.
  * `CriticalAlertGenerated` : Déclenche l'envoi du SMS/Push par le module de notification.

### 4.5. Services de Domaine (Domain Services)

*   **`CorrelationService`** : Reçoit les `RawSignalReceived`, interroge le `ActivityProfileRepository` pour connaître les seuils, et applique les règles métiers complexes ("si Chute + Inactivité > Seuil -> `CriticalAlertGenerated`).

### 4.6. Dépôts (Repositories)

Interfaces permettant de sauvegarder et récupérer nos agrégats sans lier le code métier à la base de données PostgreSQL.

* **`ActivityProfileRepository`** : `findBySeniorId(seniorId)`, `save(profile)`.
* **`AlertRepository`** : `findActiveAlertsBySeniorId(seniorId)`, `save(alert)`.