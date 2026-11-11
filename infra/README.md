# Infrastructure

Socle du projet, lancé avec Docker Compose : broker MQTT, base de données, passerelle d'ingestion, détection, notification, API et application web.

## Prérequis

- [Docker](https://www.docker.com/) et Docker Compose installés (rien d'autre : Node.js n'est pas nécessaire sur la machine)
- Les ports suivants libres sur la machine : `8080` (application web), `1883` (MQTT), `1880` (Node-RED), `3000` (API). PostgreSQL n'est pas exposé. `8080` se change avec `WEB_PORT` dans un fichier `.env` s'il est déjà pris.

## Premier lancement

Depuis la **racine du projet**, sans fichier de configuration (chaque variable a une valeur par défaut, voir `.env.example` pour les changer) :

```bash
docker compose up --build -d --wait
```

Au premier lancement, Docker télécharge les images et construit les services (quelques minutes). La commande rend la main quand tout est prêt.

## Ce qui démarre

| Service | Rôle | Accès |
|---|---|---|
| **mosquitto** | Broker MQTT : capteurs (via Zigbee2MQTT) et messagerie interne | `localhost:1883` |
| **postgres** | Base de données relationnelle | Réseau Docker seulement (`postgres:5432`) ; pour l'inspecter : `docker compose exec postgres psql -U app maintien_domicile` |
| **node-red** | Passerelle d'ingestion (et simulateur de capteurs) | Interface web : http://localhost:1880 |
| **detection** | Corrélation des signaux, levée de doute, alertes | Journal : `docker compose logs -f detection` |
| **notification** | Qui prévenir (famille, médical) selon la gravité d'une alerte | Journal : `docker compose logs -f notification` |
| **api-gateway** | API REST + WebSocket, journal des alertes, historique des signaux, boîtes de réception | http://localhost:3000 (`/health`, `/auth/users`) |
| **web** | Application web (vues senior, famille, médical), servie par nginx qui relaie `/api` et `/socket.io` vers l'API | **http://localhost:8080** |

Les services communiquent entre eux par leur **nom** sur le réseau Docker commun (ex. depuis Node-RED, le broker est joignable à `mosquitto:1883`).

**Ordre de démarrage** : Mosquitto et PostgreSQL ont un contrôle de santé (*healthcheck*) ; Node-RED, la détection, la notification et l'API attendent que le broker réponde avant de démarrer (l'API attend aussi PostgreSQL) ; l'application web attend que l'API soit prête. Tous les services redémarrent automatiquement en cas d'arrêt inattendu (`restart: unless-stopped`).

## Vérifier que tout tourne

```bash
docker compose ps        # les services doivent être "Up" (mosquitto et postgres : "healthy")
```

Puis ouvrir **http://localhost:8080** : l'écran de connexion propose trois comptes (René le senior, Marie sa fille, Dr Martin). Pour provoquer une chute, utiliser le simulateur de Node-RED.

http://localhost:1880 : l'éditeur Node-RED doit s'afficher, avec les onglets **Ingestion** et **Simulateur**. Pour tester le pipeline avec des capteurs simulés, voir [services/ingestion/README.md](../services/ingestion/README.md) ; pour suivre les alertes, [services/detection/README.md](../services/detection/README.md) et [services/notification/README.md](../services/notification/README.md).

## Arrêter

```bash
docker compose down      # arrête et supprime proprement les conteneurs
```

> Toujours arrêter avec `docker compose down` plutôt que de fermer la fenêtre. Sinon un conteneur peut rester actif et provoquer une erreur « container name already in use » au prochain lancement.

## Dépannage

**Les données** (PostgreSQL dans `pgdata`, sessions MQTT dans `mosquitto-data`, état de Node-RED dans `node-red-data`) sont conservées entre les redémarrages. Les flows, eux, restent dans le dépôt (`services/ingestion/flows.json`). Pour repartir de zéro :
```bash
docker compose down -v    # le -v supprime aussi les volumes
```

## Notes

- Versions d'images fixées (`eclipse-mosquitto:2`, `postgres:16`, `nodered/node-red:4.1.12`, `nginx:1.27-alpine`, `node:22-alpine`) pour que le projet se construise de la même façon sur toutes les machines.
