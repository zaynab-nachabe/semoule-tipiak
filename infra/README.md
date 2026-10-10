# Infrastructure

Socle technique du projet, lancé avec Docker Compose. Contient pour l'instant l'infrastructure de base : broker MQTT, base de données, passerelle d'ingestion.

## Prérequis

- [Docker](https://www.docker.com/) et Docker Compose installés
- Les ports suivants libres sur la machine : `1883` (MQTT), `5432` (PostgreSQL), `1880` (Node-RED)

## Premier lancement

Depuis la **racine du projet** :

```bash
# Lancer l'infrastructure
docker compose up
```

Au premier lancement, Docker télécharge les images (quelques minutes), puis démarre les trois services.

## Ce qui démarre

| Service | Rôle | Accès |
|---|---|---|
| **mosquitto** | Broker MQTT, point d'entrée des capteurs | `localhost:1883` |
| **postgres** | Base de données relationnelle | `localhost:5432` (base/identifiants définis dans `.env`) |
| **node-red** | Passerelle d'ingestion | Interface web : http://localhost:1880 |

Les services communiquent entre eux par leur **nom** sur le réseau Docker commun (ex. depuis Node-RED, le broker est joignable à `mosquitto:1883`).

## Vérifier que tout tourne

```bash
docker compose ps        # les trois services doivent être "Up"
```

Puis ouvrir http://localhost:1880 : l'éditeur Node-RED doit s'afficher.

## Arrêter

```bash
docker compose down      # arrête et supprime proprement les conteneurs
```

> Toujours arrêter avec `docker compose down` plutôt que de fermer la fenêtre. Sinon un conteneur peut rester actif et provoquer une erreur « container name already in use » au prochain lancement.

Pour lancer en arrière-plan (sans bloquer le terminal) : `docker compose up -d`.

## Dépannage

**Les données PostgreSQL** sont conservées entre les redémarrages (volume `pgdata`). Pour repartir d'une base vierge :
```bash
docker compose down -v    # le -v supprime aussi les volumes
```

## Notes

- Version **minimaliste** : seuls les services d'infrastructure réels sont lancés. Les services métier (api-gateway, detection, notification) seront ajoutés au `docker-compose.yml` au fur et à mesure qu'ils auront du code.