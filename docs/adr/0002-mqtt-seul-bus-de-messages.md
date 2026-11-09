# 0002. MQTT comme seul bus de messages (pas de Kafka)

- Statut : acceptée
- Date : 2026-11-07 (décision prise en octobre, documentée ici)

## Contexte

Les capteurs fixes imposent MQTT (Zigbee2MQTT). Entre les services (ingestion, détection, notification, API), il faut un canal asynchrone qui découple producteurs et consommateurs. La première version de la spécification prévoyait Kafka.

## Décision

Réutiliser le **même broker Mosquitto** pour les échanges internes, avec des règles qui compensent ce que Kafka aurait apporté :

- **QoS 1** sur `signals/…`, `alerts/…` et `ingestion/rejected` : pas de perte sur une coupure réseau brève ;
- **sessions persistantes** (`clean: false`, identifiant client fixe) pour la détection et la notification : les messages arrivés pendant leur redémarrage leur sont remis ensuite ;
- **persistance du broker** (`persistence true`) : sessions et messages en attente survivent à un redémarrage propre de Mosquitto ;
- **dédoublonnage par `eventId`** côté consommateur, puisque QoS 1 peut livrer un message deux fois.

## Conséquences

- Un seul composant de messagerie à faire tourner et à comprendre ; volume (un logement, quelques capteurs) très loin des limites de Mosquitto.
- Le test d'intégration de la détection vérifie qu'un signal publié pendant que le service est arrêté est traité à son redémarrage.
- Limites, à reporter dans la matrice des risques :
  - **pas de rejeu** de l'historique des événements (impossible de rejouer une journée pour régler les seuils) ;
  - **broker unique** : s'il tombe, plus rien ne circule ;
  - Mosquitto écrit sur disque **périodiquement**, pas à chaque message : un arrêt brutal perd les messages en attente non sauvegardés.

## Alternatives envisagées

- **Kafka** : journal persistant et rejouable, consommateurs indépendants. Écarté : un second système de messagerie (et sa coordination) pour un volume de quelques messages par minute, alors que MQTT reste obligatoire pour les capteurs.
- **RabbitMQ** : files durables, accusés de réception ; même objection qu'avec Kafka (deuxième broker).
