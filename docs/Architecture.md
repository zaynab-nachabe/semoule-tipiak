# Architecture

Organisation en monorepo. Tous les services sont dans un même dépôt. Un système dont les services partagent des contrats de données (format d'événements) et se lancent ensemble via un unique docker-compose, c'est plus simple qu'un dépôt par service et ça rend l'architecture lisible d'un coup d'œil. Le multi-repo n'aurait de sens que pour des équipes déployant indépendamment, ce qui n'est pas notre cas.


package json à la racine et Workspace -> à nettoyer ou à argumenter selon les besoins futurs.

Ainsi le monorepo est dans ce cas assumé et documenté, workspaces non pour l'instant, on verra si le besoin apparaît.


## Schéma d'architecture
```
   CAPTEURS (simulés)
   PIR · plaques · montre (chute, FC, bouton)
        │  MQTT (capteurs) · HTTP (montre)
        ▼
   ┌───────────────┐
   │   Node-RED    │  Passerelle d'ingestion : reçoit MQTT/HTTP,
   │  (ingestion)  │  normalise vers un format commun. Aucune logique métier.
   └───────┬───────┘
           │  format commun
           ▼
   ┌───────────────┐        ┌────────────────┐
   │   Détection   │───────>│  Notification  │  Choisit le destinataire
   │ (corrélation) │ alerte │ (in-app + log) │  selon la gravité.
   └───────┬───────┘        └────────────────┘
           │  événements + résultats
           ▼
   ┌───────────────┐
   │  API (NestJS) │  Point d'entrée unique du frontend.
   │  + PostgreSQL │  Auth, droits par rôle, agrégation des données.
   └───────┬───────┘
           │  REST (consultation) · WebSocket (temps réel)
           ▼
   ┌───────────────────────────────────────┐
   │   1 APPLICATION WEB, 3 VUES           │
   │   Personne âgée · Famille · Médical   │
   │   (vue choisie selon le rôle connecté)│
   └───────────────────────────────────────┘

   Le tout est conteneurisé et lancé avec Docker Compose.
```

---

## Technologies et rôle de chacune

**MQTT (broker Mosquitto)** — Protocole de messagerie léger utilisé par la plupart des capteurs IoT. On l'utilise en entrée parce qu'il est *imposé par le matériel* des capteurs. Les capteurs simulés publient leurs données dessus.

**HTTP** — Utilisé pour la montre connectée, qui expose ses données (fréquence cardiaque, chute, bouton d'aide) via des appels HTTP plutôt que MQTT. Le système doit donc accepter les deux protocoles en entrée.

**Node-RED** — Passerelle d'ingestion. Il reçoit les formats hétérogènes (MQTT et HTTP), les **normalise** en un format commun, et transmet. Son rôle s'arrête là : aucune détection n'y est faite, ce qui garde la logique métier dans du code testable.

**Module de détection (corrélation)** — Le cerveau du système. Il croise les signaux dans le temps pour éviter les fausses alertes (ex. chute suivie d'une reprise de mouvement = pas d'alerte ; chute suivie d'un silence = alerte) et compare l'activité courante au profil habituel. Séparé de l'API pour isoler clairement cette responsabilité.

**API (NestJS)** — Point d'entrée unique de l'application web et de ses trois vues. Elle gère l'**authentification**, les **droits par rôle** (une famille ne voit que son proche et pas les données médicales détaillées) et l'**agrégation** des données avant de les servir.

**PostgreSQL** — Base de données unique. Elle stocke les profils, les relations personne/famille/médecin avec leur consentement, les seuils, les mesures et le journal des alertes. Un seul système de stockage à maîtriser, suffisant pour le volume du projet.

**Notification** — Service qui choisit le ou les destinataires d'une alerte selon sa gravité et la leur transmet **dans l'application** (vues famille et médicale, en temps réel), tout en gardant une **trace dans un journal**. Pas d'envoi SMS ni push : le sujet n'impose pas de canal externe, et un fournisseur (SMS, push) pourrait être branché plus tard derrière ce même service sans changer le reste.

**REST + WebSocket** — Deux modes d'échange entre frontends et API. **REST** pour la consultation et la configuration (le client demande, le serveur répond). **WebSocket** pour le temps réel (le serveur pousse une alerte de chute immédiatement, sans que le client interroge en boucle).

**Docker Compose** — Emballe chaque service dans un conteneur et les lance tous ensemble d'une commande. Garantit que le projet tourne à l'identique sur chaque machine et prépare le déploiement (CI/CD).

---

## Choix assumés

**Une seule base de données.** Le volume ne justifie pas d'ajouter une base de séries temporelles dédiée (type InfluxDB) à côté du relationnel. PostgreSQL couvre l'ensemble des besoins : profils, relations et consentements, seuils, mesures et journal des alertes. Une base spécialisée serait l'évolution naturelle si le volume de mesures augmentait fortement.

**Une seule application web, trois vues.** Le besoin est de trois *vues*, une par persona, pas de trois applications. Une seule application avec une vue par rôle (choisie après connexion) partage le code commun (connexion, appels à l'API, réception des alertes en temps réel) et ne demande qu'un conteneur. Chaque vue reste adaptée à son persona : interface simplifiée et lisible pour la personne âgée, statut synthétique pour la famille, tableau de bord détaillé pour l'équipe médicale. Limite : les trois vues sont livrées ensemble ; des applications séparées n'auraient de sens que si elles devaient évoluer ou être déployées indépendamment.

**Frontend dédié plutôt que Node-RED Dashboard.** Les trois vues ont des droits et des besoins d'affichage différents, et la personne âgée requiert une interface spécifiquement adaptée (lisibilité, actions simples). Un frontend dédié derrière l'API laisse maîtriser l'authentification par rôle et l'ergonomie de chaque vue, ce que l'outil de dashboard intégré ne permettrait pas. Ce choix est assumé : la limite éventuelle de l'interface ne pourrait pas être imputée à l'outil, puisque c'est nous qui le construisons.

**Node-RED limité à l'ingestion.** Node-RED gère nativement MQTT et HTTP, ce qui en fait une passerelle idéale pour des capteurs hétérogènes, et il est rapide à mettre en place. Mais aucune logique métier de détection n'y est placée : cette logique vit dans un service dédié, en code testable et versionnable. Node-RED normalise et transmet, rien de plus.