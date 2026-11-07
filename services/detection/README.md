# Détection (Correlation & Detection Context)

Cœur de métier du système (DDD §3.1). Ce service reçoit les signaux normalisés, applique les règles de corrélation et décide d'une pré-confirmation ou d'une alerte critique.

**Périmètre actuel : la chute (scénario A du DDD).** L'inactivité anormale (scénario B, `ActivityProfile`, `InactivityWindow`) viendra dans une branche suivante.

## Ce qui est implémenté

Couche **domaine** uniquement, sans framework ni MQTT ni base de données, testée en isolation.

| Élément DDD | Fichier |
|---|---|
| Entité `Alert` (§4.2) : `PENDING → PRE_CONFIRMING → ESCALATED / RESOLVED` | `src/domain/entities/alert.ts` |
| Value object `PreConfirmation` (§4.3) | `src/domain/value-objects/pre-confirmation.ts` |
| Événement interne `FallSuspected` (§4.4) | `src/domain/events/fall-suspected.ts` |
| Dépôt `AlertRepository` (§4.6) | `src/domain/repositories/alert-repository.ts` |
| Service `CorrelationService` (§4.5), partie chute | `src/domain/services/correlation-service.ts` |
| Horloge, minuteur, générateur d'identifiants, publication (interfaces) | `src/domain/services/ports.ts` |
| Implémentations : dépôt en mémoire, horloge système, `setTimeout`, UUID | `src/infrastructure/` |

Les événements publiés sont ceux du contrat (`docs/format-evenements.md` §6), typés via `@project/shared-types` et vérifiés contre `domain-event.schema.json` dans les tests.

## Enchaînements

```
FALL_IMPACT (≥ seuil) ─► PreConfirmationRequested (60 s) ─┬─► CANCEL_ALERT ─────────► PreConfirmationCanceled (SENIOR_CANCELED)
                                                          ├─► mouvement après impact ► PreConfirmationCanceled (ACTIVITY_RESUMED)
                                                          ├─► HELP_BUTTON ──────────► CriticalAlertGenerated (SENIOR_CONFIRMED)
                                                          └─► 60 s sans réponse ────► PreConfirmationTimeoutExpired + CriticalAlertGenerated (NO_RESPONSE)
HELP_BUTTON sans pré-confirmation en cours ─────────────────────────────────────────► CriticalAlertGenerated (HELP_REQUESTED, IMMEDIATE)
```

## Paramètres

`FallDetectionPolicy` regroupe les valeurs de la détection. Les tests utilisent des valeurs de test, pas des valeurs validées.

| Paramètre | Statut | Source / question |
|---|---|---|
| `preConfirmationDelayMs` | **Documenté** : 60 000 ms | DDD, scénario A, étape 3 |
| `minFallImpact` | **À décider** | Quel impact (en g) suffit à suspecter une chute ? `format-evenements.md` dit seulement « permet de filtrer les chocs mineurs ». |
| `fallAlertSeverity` | **À décider** | Gravité d'une alerte de chute (`MEDIUM` / `HIGH` / `CRITICAL`). Le DDD ne donne une gravité (`HIGH`) que pour l'inactivité. |
| `helpRequestSeverity` | **À décider** | Gravité d'une demande d'aide spontanée. |
| `activityResumedSignalTypes` | **À décider** | Quels signaux prouvent que la personne s'est relevée ? Le DDD dit « un mouvement » sans préciser. Un PIR peut aussi voir une personne au sol qui bouge. |

## Comportements

| Situation | Comportement implémenté | Pourquoi |
|---|---|---|
| Deuxième impact pendant une levée de doute | Même incident : pas de seconde pré-confirmation, l'impact est ajouté aux `triggeringEventIds` | Éviter deux alertes pour une seule chute |
| Annulation (`CANCEL_ALERT`) après l'escalade | Ignorée, l'alerte reste critique | La notification est déjà partie ; le DDD ne prévoit pas de désescalade |
| Mouvement horodaté avant l'impact mais reçu après | N'annule pas | Seule une activité postérieure à l'impact prouve que la personne s'est relevée |
| Règle DDD §4.5 « Chute + Inactivité > Seuil » | Aucune réponse ni reprise d'activité pendant les 60 s de pré-confirmation | Le seuil d'inactivité après une chute n'est pas défini ailleurs |
| Passage de `PENDING` à `PRE_CONFIRMING` | Méthode `startPreConfirmation()` ajoutée à `Alert` | Le DDD liste le statut mais seulement `escalate()` et `resolve()` |

## Ce qui reste à faire

- **Adaptateur MQTT** (abonnement `signals/+/+`, publication sur `alerts/{seniorId}/{eventType}`) et point d'entrée exécutable : dépend du choix **NestJS ou TypeScript simple** pour ce service. Le domaine est indépendant de ce choix.
- **Seuils par senior** (`ActivityProfileRepository`, lus dans le `Profile Management Context`) : dépend du schéma PostgreSQL (`feat/schema-bdd`).
- **`ActivityHistory`** (DDD §4.5) : utile pour l'inactivité. Le DDD décrit une `Map<Date, RawSignal>`, mais en JavaScript une clé `Date` est comparée par référence : deux dates identiques sont deux clés différentes. Il faudra indexer par horodatage numérique.
- **Perte des minuteurs au redémarrage** : l'état est en mémoire (règle du projet) ; une levée de doute en cours au moment d'un redémarrage est perdue.

## Commandes

```bash
npm test --workspace @project/detection        # tests (vitest)
npm run typecheck --workspace @project/detection
```

Les tests tournent aussi en CI via `npm test` à la racine.
