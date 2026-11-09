# Infrastructure

Socle du projet, lancé avec Docker Compose : broker MQTT, base de données, passerelle d'ingestion et service de détection.

## Prérequis

- [Docker](https://www.docker.com/) et Docker Compose installés (rien d'autre : Node.js n'est pas nécessaire sur la machine)
- Les ports suivants libres sur la machine : `1883` (MQTT), `5432` (PostgreSQL), `1880` (Node-RED), `3000` (API)

## Premier lancement

Depuis la **racine du projet** :

```bash
# Créer le fichier de variables d'environnement (une seule fois)
cp .env.example .env

# Construire les images des services et lancer le tout
docker compose up --build
```

Au premier lancement, Docker télécharge les images et construit celle de la détection (quelques minutes).

## Ce qui démarre

| Service | Rôle | Accès |
|---|---|---|
| **mosquitto** | Broker MQTT : capteurs (via Zigbee2MQTT) et messagerie interne | `localhost:1883` |
| **postgres** | Base de données relationnelle | `localhost:5432` (base/identifiants définis dans `.env`) |
| **node-red** | Passerelle d'ingestion (et simulateur de capteurs) | Interface web : http://localhost:1880 |
| **detection** | Corrélation des signaux, levée de doute, alertes | Journal : `docker compose logs -f detection` |
| **notification** | Qui prévenir (famille, médical) selon la gravité d'une alerte | Journal : `docker compose logs -f notification` |
| **api-gateway** | API REST + WebSocket, journal des alertes, historique des signaux | http://localhost:3000 (`/health`, `/auth/users`) |

Les services communiquent entre eux par leur **nom** sur le réseau Docker commun (ex. depuis Node-RED, le broker est joignable à `mosquitto:1883`).

**Ordre de démarrage** : Mosquitto et PostgreSQL ont un contrôle de santé (*healthcheck*) ; Node-RED, la détection, la notification et l'API attendent que le broker réponde avant de démarrer (l'API attend aussi PostgreSQL). Tous les services redémarrent automatiquement en cas d'arrêt inattendu (`restart: unless-stopped`).

## Vérifier que tout tourne

```bash
docker compose ps        # les services doivent être "Up" (mosquitto et postgres : "healthy")
```

Puis ouvrir http://localhost:1880 : l'éditeur Node-RED doit s'afficher, avec les onglets **Ingestion** et **Simulateur**. Pour tester le pipeline avec des capteurs simulés, voir [services/ingestion/README.md](../services/ingestion/README.md) ; pour suivre les alertes, [services/detection/README.md](../services/detection/README.md) et [services/notification/README.md](../services/notification/README.md).

## Arrêter

```bash
docker compose down      # arrête et supprime proprement les conteneurs
```

> Toujours arrêter avec `docker compose down` plutôt que de fermer la fenêtre. Sinon un conteneur peut rester actif et provoquer une erreur « container name already in use » au prochain lancement.

Pour lancer en arrière-plan (sans bloquer le terminal) : `docker compose up --build -d`.

## Dépannage

**Les données** (PostgreSQL dans `pgdata`, sessions MQTT dans `mosquitto-data`, état de Node-RED dans `node-red-data`) sont conservées entre les redémarrages. Les flows, eux, restent dans le dépôt (`services/ingestion/flows.json`). Pour repartir de zéro :
```bash
docker compose down -v    # le -v supprime aussi les volumes
```

## Notes

- L'application web (vues senior, famille, médical) sera ajoutée au `docker-compose.yml` avec son code.
- Versions d'images fixées (`eclipse-mosquitto:2`, `postgres:16`, `nodered/node-red:4.1.12`) pour que le projet se construise de la même façon sur toutes les machines.
