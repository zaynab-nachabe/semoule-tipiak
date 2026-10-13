# Fiche de spécification — Maintien à domicile des personnes âgées


## 1. Sujet et problématique

**Détecter les chutes et les périodes d'inactivité anormale d'une personne âgée autonome vivant seule, et alerter le bon destinataire (famille ou équipe médicale) selon la gravité.**

Un capteur isolé n'est pas fiable : une personne immobile peut simplement dormir ou regarder la télévision, un pic cardiaque peut être un effort normal. La clé du projet est donc de **croiser plusieurs signaux** pour distinguer une situation normale d'une situation à risque avant de déclencher une alerte.

La cible est une personne **autonome** : elle n'est pas seulement surveillée, elle est **actrice** du système (elle consulte son activité, confirme ou annule une fausse alerte, demande de l'aide).

---

## 2. Personas

| Persona | Besoin principal | Interface |
|---|---|---|
| **Personne âgée** | Rester autonome et protégée ; garder la main sur ses données ; annuler une fausse alerte, demander de l'aide | Appli/tablette lisible (gros caractères, contraste) |
| **Famille** | Être rassurée ; être alertée uniquement en cas d'événement significatif | Vue simple + notifications |
| **Équipe médicale** | Données fiables et historisées ; seuils configurables ; vue synthétique et détaillée | Dashboard web complet |

Les trois personas ont des besoins réellement différents, ce qui justifie **trois interfaces distinctes** sur un même backend.

---

## 3. Entrées, sorties et données calculées

### Entrées (produites par une source externe)

| Donnée | Source | Nature |
|---|---|---|
| Mouvement / présence par pièce | Détecteurs PIR (détecteurs de mouvement), plaques de pression (lit, fauteuil, seuil de pièce) | Événementiel |
| Fréquence cardiaque | Montre / bracelet connecté | Mesure périodique (~1/min) |
| Détection de chute (impact) | Accéléromètre de la montre | Événement ponctuel |
| Demande d'aide / annulation d'alerte | Bouton de la montre ou appli | Événement ponctuel |
| Profil, seuils, contacts d'urgence | Saisie par l'équipe médicale / la famille | Configuration (statique, modifiable) |

> La position dans le logement n'est pas mesurée directement : elle est **reconstruite** à partir des événements de présence (quelle pièce, quand).

### Sorties (vers les utilisateurs)

| Sortie | Destinataire | Canal |
|---|---|---|
| Alerte critique (chute, inactivité anormale, demande d'aide) | Famille + équipe médicale | Notification push / SMS |
| Pré-confirmation (« Une chute a été détectée, tout va bien ? ») | Personne âgée | Montre / appli (avec annulation) |
| Tableau de bord temps réel + historique / tendances | Équipe médicale | Dashboard web |
| Résumé personnel (activité du jour, fréquence cardiaque, alertes) | Personne âgée | Appli / tablette |
| Statut synthétique (« tout va bien » / dernière activité) | Famille | Appli / notification |

### Donnée calculée (état interne)

Le système maintient un **profil d'activité habituel** par personne (routine par tranche horaire, recalculé périodiquement à partir de l'historique). Ce profil est la **référence** contre laquelle l'activité courante est comparée pour détecter une inactivité *anormale*. Ce n'est ni une entrée (il est calculé) ni une sortie (il n'est pas affiché) : c'est un état interne consommé par la détection.

---

## 4. Architecture

Voir le fichier dédié : [Présentation de l'architecture](docs/Architecture.md)

### Stack technique

| Couche | Technologie | Rôle |
|---|---|---|
| Capteurs → système | **MQTT** (broker Mosquitto) pour les capteurs fixes, **HTTP** pour la montre | Protocoles imposés par le matériel |
| Ingestion | **Node-RED** | Réception MQTT / HTTP, normalisation, rejet des messages invalides |
| Messagerie interne | **MQTT** (le même broker Mosquitto) | Signaux normalisés, événements de domaine, alertes |
| Stockage | **PostgreSQL** | Profils, relations et consentements, seuils, mesures, journal des alertes |
| API | **NestJS** | REST + WebSocket vers les frontends, droits par rôle |
| Conteneurisation | **Docker Compose** | Environnement de développement |

**Choix assumés**
- **Pas de Kafka.** Un seul senior et une poignée de capteurs : le volume ne justifie pas un bus de messages dédié, et Mosquitto est déjà nécessaire pour les capteurs. Contrepartie : pas de rejeu de l'historique des événements. Le risque de perte de messages (R9 de la matrice des risques) est limité par les sessions persistantes MQTT (voir [topics-mqtt.md](docs/topics-mqtt.md)).
- **Pas d'InfluxDB.** PostgreSQL suffit pour les mesures à ce volume (voir [Architecture](docs/Architecture.md)).

### Contrat de données et topics

- [Format des événements](docs/format-evenements.md) : enveloppe, types de signaux, événements de domaine, messages rejetés.
- [Topics MQTT](docs/topics-mqtt.md) : qui publie quoi, qui s'abonne à quoi.
- Schémas lisibles par machine (JSON Schema + types TypeScript) : [`packages/shared-types`](packages/shared-types). Vérifiés à chaque push par la CI.
- Lancer l'infrastructure en local : [infra/README.md](infra/README.md).

## 5. Matrice des risques

**Matrice d'analyse des risques** : capteur déconnecté, fausse alerte, latence d'alerte, perte de données de santé (RGPD)

Voir le fichier dédié : [Présentation de la matrice des risques](docs/Matrice_risques.md)

## 6. Domain-Driven Design (DDD)

Voir le fichier dédié : [Domain-Driven Design](docs/DDD_specifications.md)

## Points à approfondir

- [ ] **Séparation des données par rôle** : modèle de droits (rôle × relation consentie) au niveau de l'API
- [ ] **Règles de corrélation** : seuils, durée des fenêtres, délai de pré-confirmation avant escalade
- [ ] **RGPD** : durée de conservation des données de santé, gestion du consentement
- [ ] **CI/CD** : la CI valide déjà `docker-compose.yml` et le format des événements ; reste les tests des services et le déploiement
- [ ] **Structure du code** : découpage en services (ingestion, détection, API, notification, frontends)
