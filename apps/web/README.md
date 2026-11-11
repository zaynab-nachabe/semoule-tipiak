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
| **Senior** (René) | « Tout va bien » ou « Avez-vous chuté ? » avec compte à rebours pendant la levée de doute, fréquence cardiaque du jour, dernières alertes, absence en cours, « Votre montre ne transmet plus » | **Tout va bien** (annule la levée de doute), **J'ai besoin d'aide** (niveau 3) : par l'API puis Node-RED, comme les boutons de la montre ([ADR 0007](../../docs/adr/0007-actions-application-via-ingestion.md)). **Je m'absente** (heure de retour) et **Je suis rentré(e)** : l'inactivité n'est pas surveillée pendant la sortie ([ADR 0011](../../docs/adr/0011-absence-declaree.md)) |
| **Famille** (Marie) | Statut de la personne (dont « sorti(e) jusqu'à 17:00 »), alerte en cours (gravité, prise en charge), équipement (seulement ce qui ne va pas), historique, boîte de réception | Marquer une notification comme lue |
| **Médical** (Dr Martin) | Idem, plus la cause de l'escalade, la fréquence cardiaque, la courbe sur 24 h, les **capteurs** (dernier signal, batterie, modèle), les **seuils d'inactivité** (jour, nuit…) | **Prendre en charge**, **Clôturer l'alerte**, marquer comme lue, **modifier les seuils** (appliqués aussitôt par la détection, [ADR 0010](../../docs/adr/0010-detection-inactivite.md)) |

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

Avec toute la pile (recommandé) : `docker compose up --build -d --wait`, puis http://localhost:8080. Si le port 8080 est déjà pris, mettre par exemple `WEB_PORT=8081` dans un fichier `.env`.

Les délais de la détection sont raccourcis par défaut pour la démonstration : provoquer une chute depuis le simulateur de Node-RED (http://localhost:1880, onglet **Simulateur**, « Montre : chute ») : la vue senior affiche la question, la famille et le médical reçoivent l'alerte si personne ne répond.

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

- Tendances d'activité : non prévues.
- Pas de mot de passe, pas de mode hors ligne, pas de notification du navigateur quand l'onglet est en arrière-plan.
