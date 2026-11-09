# 0009. Une application web React + Vite, servie par nginx sur la même origine que l'API

- Statut : acceptée
- Date : 2026-11-09

## Contexte

Le sujet demande trois vues (senior, famille, équipe médicale). L'architecture prévoit **une seule application web** dont la vue dépend du rôle du compte connecté (l'API filtre déjà les données par rôle). Il faut choisir le framework, l'emplacement du code et la façon de la servir avec Docker seulement. Contraintes : TypeScript strict partout, types partagés avec l'API (`@project/shared-types`), temps réel par WebSocket (socket.io), et un projet qui démarre par `docker compose up --build`.

## Décision

- **React 19 + Vite + TypeScript**, dans `apps/web`. Les types du contrat (`AlertView`, `NotificationView`, messages temps réel…) sont importés de `@project/shared-types`, jamais réécrits.
- **Trois vues dans la même application**, choisies par le rôle renvoyé par `/me` :
  - **senior** : gros boutons « Tout va bien » (pendant une levée de doute, avec compte à rebours) et « J'ai besoin d'aide », fréquence cardiaque du jour, dernières alertes ;
  - **famille** : statut de la personne, alerte en cours (gravité, prise en charge), historique, boîte de réception des notifications ;
  - **médical** : idem, plus la cause de l'escalade, la courbe cardiaque sur 24 h et les actions « Prendre en charge » et « Clôturer l'alerte ».
- **nginx sert les fichiers construits** (image en deux étapes : construction avec Node, puis `nginx:1.27-alpine`) et **relaie `/api/` et `/socket.io/` vers l'API**. Le navigateur ne parle qu'à une origine (`http://localhost:8080`) ; en développement, Vite fait le même relais.
- Pas de routeur ni de bibliothèque d'état : une vue par rôle, des hooks qui chargent par REST puis se mettent à jour par le temps réel. La courbe cardiaque est un SVG simple.

## Conséquences

- Un seul point d'entrée pour l'utilisateur, une seule origine : pas de CORS à régler dans le navigateur, et l'API n'a pas besoin d'être exposée pour l'application (elle l'est encore sur `:3000` pour les tests et le débogage).
- Les règles d'affichage pures (actions permises au médical, compte à rebours, fusion des messages temps réel) sont testées sans navigateur (vitest) ; le parcours complet est vérifié par le scénario de bout en bout, qui passe aussi par nginx.
- Limites, à reporter dans la matrice des risques :
  - **pas de mot de passe** (choix du sujet) : n'importe qui ayant accès à la page peut ouvrir n'importe quel compte ;
  - le jeton est gardé dans le `sessionStorage` de l'onglet : lisible par un script injecté dans la page ;
  - l'application ne fonctionne qu'**en ligne** : si l'API ou le relais nginx s'arrête, l'indicateur passe à « Hors ligne » mais rien ne prévient l'utilisateur autrement ;
  - le port 8080 peut être déjà pris sur la machine : il se change par `WEB_PORT` dans `.env`.

## Alternatives envisagées

- **Trois applications séparées** (`apps/senior`, `apps/famille`, `apps/medical`) : trois builds et trois conteneurs pour du code en grande partie commun (connexion, temps réel, composants), contraire à la décision « une application, trois vues ».
- **Vue 3 + Vite** : aussi adapté ; React a été retenu pour son usage plus répandu.
- **Angular** : proche de NestJS dans le style, mais trop lourd pour trois vues.
- **Serveur de développement Vite dans le conteneur** : plus simple, mais ne ressemble pas à un déploiement réel (pas de construction optimisée, rechargement à chaud inutile).
