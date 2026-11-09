# 0001. Service de détection en TypeScript simple avec mqtt.js, sans framework

- Statut : acceptée
- Date : 2026-11-07

## Contexte

Le service de détection (cœur de métier, DDD §3.1) reçoit les signaux normalisés par MQTT, applique les règles de corrélation et publie des événements de domaine. Il n'expose aucune API HTTP et n'a pas de base de données. L'API, elle, est en NestJS.

## Décision

- **TypeScript simple + `mqtt.js`**, sans framework. Le domaine (`src/domain`) ne dépend ni de MQTT, ni de Node.js : l'horloge, le minuteur, les identifiants et la publication sont des interfaces, implémentées dans `src/infrastructure`.
- **Image Docker minimale** : le service et ses dépendances (y compris `@project/shared-types`) sont regroupés en un seul fichier par `esbuild` ; l'image d'exécution ne contient que Node.js et ce fichier.
- **Validation à l'entrée** : chaque signal reçu est vérifié contre le JSON Schema du contrat, comparé à son topic et dédoublonné par `eventId`.

## Conséquences

- Le service reste petit et lisible ; le domaine est testé sans broker ni attente réelle (temps simulé), et un test d'intégration le vérifie contre un vrai broker MQTT.
- Changer de framework plus tard ne toucherait que `src/app.ts` et `src/infrastructure`.
- Limite : pas d'injection de dépendances ni de structure imposée ; l'assemblage est fait à la main dans `src/app.ts`. Acceptable pour un service de cette taille.
- Limite : un seul exemplaire du service peut tourner (identifiant MQTT fixe, état en mémoire) : voir la matrice des risques.

## Alternatives envisagées

- **NestJS** (comme l'API) : homogénéité du code, mais ajoute modules, injection et cycle de vie pour un service sans HTTP ; NestJS sait consommer MQTT, mais avec un modèle requête/réponse peu adapté à des minuteurs et à un état en mémoire.
- **Exécuter TypeScript directement dans le conteneur** (`tsx`, type stripping de Node) : image plus lourde (dépendances de développement) et résolution des imports du package partagé moins fiable qu'un bundle.
