# Application web

Une application, trois vues : la vue s'adapte au rôle du compte connecté. React + Vite + TypeScript, servie par nginx ([ADR 0009](../../docs/adr/0009-application-web-react-nginx.md)). Elle ne parle qu'à l'API ([docs/contrat-api.md](../../docs/contrat-api.md)), sur sa propre origine : nginx relaie `/api/` et `/socket.io/` vers l'api-gateway.

```
navigateur ──► nginx :8080 ──┬─► fichiers de l'application
                             ├─► /api/...      ──► api-gateway:3000 (REST)
                             └─► /socket.io/   ──► api-gateway:3000 (temps réel)
```

## Les trois vues

| Vue | Ce qu'elle montre | Actions |
|---|---|---|
| **Senior** (René) | « Tout va bien » ou « Avez-vous chuté ? » avec compte à rebours pendant la levée de doute, fréquence cardiaque du jour, dernières alertes | **Tout va bien** (annule la levée de doute), **J'ai besoin d'aide** (niveau 3). Les deux passent par l'API puis Node-RED, comme les boutons de la montre ([ADR 0007](../../docs/adr/0007-actions-application-via-ingestion.md)) |
| **Famille** (Marie) | Statut de la personne, alerte en cours (gravité, prise en charge), historique, boîte de réception | Marquer une notification comme lue |
| **Médical** (Dr Martin) | Idem, plus la cause de l'escalade, la fréquence cardiaque, la courbe sur 24 h | **Prendre en charge**, **Clôturer l'alerte**, marquer comme lue |

La connexion se fait par choix du compte dans une liste, sans mot de passe (hors du périmètre du sujet). Chaque vue charge ses données par REST puis se met à jour en temps réel ; l'indicateur « En direct / Hors ligne » montre l'état de la connexion temps réel. La famille ne reçoit jamais la cause clinique ni la fréquence cardiaque : l'API ne les envoie pas à ce rôle.

## Organisation

```
src/
├── api/          client REST (/api, jeton, erreurs) et temps réel (une connexion socket.io partagée)
├── model/        règles d'affichage pures (libellés, actions permises, compte à rebours) : testées
├── hooks/        données d'une vue : REST + mises à jour en temps réel
├── components/   statut, historique, boîte de réception, courbe cardiaque (SVG)
├── views/        connexion, vues senior, famille, médical
└── App.tsx       choix de la vue selon le rôle
nginx.conf        fichiers + relais vers l'API
Dockerfile        construction (Node) puis nginx
```

## Lancer

Avec toute la pile (recommandé) : `docker compose up --build -d`, puis http://localhost:8080. Si le port 8080 est déjà pris, mettre par exemple `WEB_PORT=8081` dans `.env`.

Pour une démonstration, raccourcir les délais de la détection dans `.env` (`PRE_CONFIRMATION_DELAY_S=20`, `CRITICAL_ESCALATION_DELAY_S=30`…), puis provoquer une chute depuis le simulateur de Node-RED (http://localhost:1880, onglet **Simulateur**, « Montre : chute ») : la vue senior affiche la question, la famille et le médical reçoivent l'alerte si personne ne répond.

En développement (rechargement à chaud), avec l'API qui tourne sur `localhost:3000` :

```bash
npm run dev --workspace @project/web      # http://localhost:5173, relais /api et /socket.io par Vite
```

## Tests

```bash
npm test --workspace @project/web          # règles d'affichage (vitest)
npm run typecheck --workspace @project/web
```

Le parcours complet (pages servies par nginx, relais REST et WebSocket, actions du senior) est vérifié par le scénario de bout en bout de la CI (`apps/api-gateway/test/e2e/fall-scenario.e2e.mjs`).

## Pas encore fait

- Activité et habitudes (scénario B, inactivité), état des capteurs, seuils et routines (médical), « je m'absente » (senior) : étapes suivantes.
- Pas de mot de passe, pas de mode hors ligne, pas de notification du navigateur quand l'onglet est en arrière-plan.
