# 0008. Service de notification séparé, qui décide par rôle ; l'API remet aux personnes

- Statut : acceptée
- Date : 2026-11-09

## Contexte

Le DDD distingue le `Notification Context` (générique) du cœur de métier : la détection émet `CriticalAlertGenerated`, la notification décide qui prévenir. Le sujet n'impose pas de canal externe : les alertes sont remises **dans l'application** (vues famille et médicale) et **journalisées**. L'API pousse déjà en temps réel l'**état** des alertes ; il ne faut pas que deux composants fassent le même travail.

## Décision

- **Un petit service séparé** (`services/notification`), sur le modèle de la détection : TypeScript simple, `mqtt.js`, image Docker minimale, session MQTT persistante.
- **Partage des responsabilités** :

  | Composant | Responsabilité |
  |---|---|
  | API | **État** des alertes : en cours, historique, tableaux de bord |
  | Notification | **Qui prévenir**, avec quelle priorité et quel texte, et **journal** des notifications |

- **Décision par rôle** : une alerte `WARNING` notifie la famille (`NORMAL`) et le médical pour information (`INFO`) ; une alerte `CRITICAL` notifie médical et famille (`URGENT`). Le service publie **une notification par rôle** sur `notifications/{seniorId}` (`NotificationRequested`, `docs/format-evenements.md` §9) et écrit une ligne de journal par notification.
- **L'API résout les personnes** : elle s'abonne à `notifications/+`, trouve les personnes de ce rôle qui ont une **relation consentie** avec le senior, enregistre une notification par personne (table `notifications`, boîte de réception) et la pousse en temps réel à ce seul destinataire.

## Conséquences

- La détection ignore l'existence de la notification : elle publie, la notification écoute (découplage par événements, visible dans l'architecture).
- La notification n'a **pas accès aux données personnelles** : pas de base partagée entre contextes. La règle de consentement reste à un seul endroit (l'API).
- Un canal externe (SMS, push) s'ajouterait dans ce seul service, sans toucher la détection ni l'API.
- Limites, reportées dans la matrice des risques (R10 à R12, et une limite de R6 : les notifications reçues avant une révocation restent lisibles) :
  - **remise dépendante de l'API** : si l'API est arrêtée, les notifications attendent dans sa session MQTT persistante ; si Mosquitto redémarre brutalement, elles peuvent être perdues (sauvegarde périodique, ADR 0002) ;
  - **pas d'accusé de lecture côté notification** : rien ne relance une notification `URGENT` restée non lue (pas d'escalade vers un autre destinataire) ;
  - **une personne sans relation consentie n'est pas prévenue** : un senior sans proche ni soignant consenti ne déclenche qu'une ligne de journal.

## Alternatives envisagées

- **Module de notification dans l'API** : un conteneur de moins, mais le `Notification Context` disparaîtrait de l'architecture et l'API cumulerait état, accès et routage.
- **La notification lit elle-même les contacts en base** : elle choisirait directement les personnes, mais deux contextes partageraient la même base et la règle de consentement serait dupliquée.
- **Pousser directement aux navigateurs depuis la notification** : obligerait la notification à gérer l'authentification et les connexions WebSocket, déjà prises en charge par l'API.
