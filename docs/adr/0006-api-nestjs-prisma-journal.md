# 0006. API : NestJS 11 + Prisma 5, journal des alertes et historique alimentés par les événements

- Statut : acceptée
- Date : 2026-11-09

## Contexte

L'application web (trois vues) a besoin d'un point d'entrée unique qui authentifie, applique la règle d'accès (rôle × relation consentie), sert l'historique et pousse les alertes en temps réel. Les alertes naissent dans la détection, qui garde son état en mémoire (ADR 0001) : il faut un historique durable ailleurs. Le schéma de base initial (lot B1, Prisma) existait déjà.

## Décision

- **NestJS 11** pour l'API (modules, injection, gardes, WebSocket intégrés). La version 12 est publiée uniquement en ESM ; la 11 reste en CommonJS, comme Prisma 5 et l'outillage de test (Jest, ts-jest).
- **Prisma 5.22** (version du schéma initial). Prisma 7 change sa configuration (fichier de config, adaptateurs) sans rien apporter ici.
- **Journal des alertes et historique des signaux tenus par l'API**, à partir des événements MQTT :
  - `alerts/#` → table `alerts` : chaque événement de domaine met à jour l'alerte (même `alertId` que la détection) ;
  - `signals/#` → table `signals` (décision D3) : l'`eventId` est la clé, un doublon QoS 1 n'est enregistré qu'une fois.
  Les transitions du journal sont **monotones** (une alerte ne repasse jamais en levée de doute, une gravité ne redescend jamais), car l'ordre entre topics n'est pas garanti.
- **Authentification simple** (hors périmètre du sujet) : choix du compte dans une liste, sans mot de passe ; un **jeton JWT** signé identifie ensuite l'appelant. Les droits sont **relus en base à chaque requête**, pour qu'une révocation de consentement prenne effet immédiatement.
- **Temps réel avec socket.io** : le jeton est vérifié à la connexion, le client rejoint une salle par senior accessible, et chaque message est projeté selon le rôle du destinataire.
- **Le senior de démonstration a l'identifiant `senior-001`**, celui des événements, pour relier les données des capteurs à la base.

## Conséquences

- L'API reste disponible pour la consultation même si la détection redémarre ; l'historique ne dépend pas de l'état en mémoire de la détection.
- Session MQTT persistante (identifiant `api-gateway`) : les événements publiés pendant un redémarrage de l'API sont rattrapés.
- Limites, à reporter dans la matrice des risques :
  - **jeton sans état** : la déconnexion ne l'invalide pas côté serveur (il expire au bout de 12 h) ;
  - **pas de mot de passe** : n'importe qui ayant accès à l'application peut se connecter sous n'importe quel compte (acceptable pour le sujet, pas en production) ;
  - **une alerte escaladée ne se clôt pas** : seule la prise en charge (`acknowledgedAt`) est enregistrée, l'alerte reste « en cours » ;
  - **historique sans durée de conservation** : la table `signals` grossit sans limite (point RGPD ouvert) ;
  - une annulation reçue **avant** la création de la levée de doute (motif inconnu) n'est pas journalisée.

## Alternatives envisagées

- **NestJS 12 (ESM)** : plus récent, mais imposerait l'ESM à Prisma et aux tests pour aucun bénéfice fonctionnel.
- **Journal tenu par la détection en base** : contraire à la règle « pas de base dans le chemin temps réel » (ADR 0001) et couplerait le cœur de métier au stockage.
- **Sessions côté serveur** au lieu d'un JWT : permettrait la révocation immédiate, au prix d'un état à stocker et à partager avec le WebSocket.
