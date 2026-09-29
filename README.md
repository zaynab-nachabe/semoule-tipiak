# Fiche de spec

## 1. Sujet

**Détection de chute et d'inactivité anormale chez la personne âgée, avec alerte à la famille et à l'équipe médicale.**

Le projet vise à permettre à une personne âgée de rester à son domicile en toute sécurité, en détectant automatiquement les situations à risque (chute, inactivité prolongée anormale) à partir de plusieurs flux de données de capteurs, et en déclenchant une alerte adaptée au bon destinataire (famille, équipe médicale) selon la gravité de la situation.

### Problématique

Un capteur isolé (mouvement seul, ou fréquence cardiaque seule) génère trop de faux positifs/négatifs pour être fiable : une personne immobile peut simplement dormir ou regarder la télévision ; un pic cardiaque peut être un effort normal. **Croiser plusieurs signaux** permet de distinguer une situation normale d'une situation à risque avant de déclencher une alerte.

### Personas

| Persona | Besoin principal |
|---|---|
| **Personne âgée** | Rester autonome chez soi en étant protégée ; garder la main sur ses propres données (voir son activité, annuler une fausse alerte, demander de l'aide) via une interface lisible |
| **Équipe médicale** | Données fiables et historisées, seuils d'alerte configurables, vue synthétique |
| **Famille** | Être rassurée, alertée seulement en cas d'événement significatif |

> Cible : personnes âgées **autonomes** vivant seules à domicile, et non des personnes dépendantes. L'utilisateur principal reste donc acteur du système, pas seulement « surveillé ».

---

## 2. Entrées (types de données)

Seules les données **produites par une source externe** au système sont des entrées. Les données calculées (historique, tendances, profil habituel d'activité) sont des états intermédiaires ou des sorties (voir §3).

| Donnée | Source (capteur) | Nature | Fréquence |
|---|---|---|---|
| Mouvement / présence dans une pièce | Détecteur de mouvement PIR (un par pièce) | Événementiel | À chaque détection (avec délai de réarmement du capteur) |
| Position dans le logement *(optionnel)* | Plaques de pression (lit, fauteuil, entrée de pièce) + contacts de porte | Événementiel | À chaque appui / relâchement, ouverture / fermeture |
| Fréquence cardiaque | Montre / bracelet connecté | Flux continu, non borné | Échantillon toutes les X secondes |
| Détection de chute (impact) | Accéléromètre / gyroscope de la montre | Événement ponctuel | Événementiel |
| Demande d'aide / annulation d'alerte | Bouton de la montre ou appli de la personne âgée | Événement ponctuel | Événementiel |
| Profil, seuils et contacts d'urgence | Saisie par l'équipe médicale / la famille (base de configuration) | Statique, modifiable | À la création puis à chaque mise à jour |

> Correction par rapport à la version précédente : la **position dans le logement** n'est pas un flux continu. Sans système de localisation intérieure coûteux, elle est déduite d'événements discrets (appui sur une plaque de pression, déclenchement d'un PIR, ouverture d'une porte). Le système reconstruit l'état « pièce actuelle » à partir de ces événements.

---

## 3. Sorties

### Sorties vers les utilisateurs

| Sortie | Destinataire | Canal |
|---|---|---|
| Alerte critique (chute confirmée, inactivité prolongée anormale, demande d'aide) | Famille + équipe médicale | Notification push / SMS |
| Alerte de pré-confirmation (« Une chute a été détectée, tout va bien ? ») avec possibilité d'annuler | Personne âgée | Montre (vibration + bouton) / appli |
| Tableau de bord temps réel (état actuel, pièce actuelle, dernière activité, FC) | Équipe médicale | Dashboard web |
| Rapport de tendances (activité, fréquence cardiaque, sommeil sur la semaine / le mois) | Équipe médicale | Dashboard web (vue historique) |
| Vue personnelle : résumé de la journée (activité vs. habitude, FC, nombre de pas), historique de ses propres alertes, contacts prévenus | Personne âgée | Appli / tablette à affichage adapté (gros caractères, contraste) |
| Statut synthétique (« tout va bien » / dernière activité / alerte en cours) | Famille | Appli / notification |

### États intermédiaires (calculés, réutilisés par le système)

| Donnée | Calculée à partir de | Usage |
|---|---|---|
| Historique d'activité agrégé | Mouvement, position, FC | Rapports de tendances, vue personnelle |
| Profil d'activité habituel (routine par tranche horaire) | Historique d'activité | Référence pour la détection d'inactivité anormale |
| Historique des alertes | Alertes émises + annulations | Traçabilité, réglage des seuils par l'équipe médicale |

---

## 4. Flux de données et pipeline

### Vocabulaire

- **Source** : capteurs (mouvement, plaques de pression, fréquence cardiaque, accéléromètre)
- **Filtres** : nettoyage, normalisation, détection de seuils, corrélation d'événements
- **Canal** : bus de messages (Kafka)
- **Pipeline** : orchestration complète, du capteur à l'alerte

### Communication capteurs → système

Le choix du protocole côté capteurs n'est pas libre : il est imposé par le matériel. Node-RED sert de **passerelle d'ingestion** qui accepte chacun de ces protocoles et les convertit vers un format commun.

| Capteur | Liaison physique | Protocole vers Node-RED | Mode |
|---|---|---|---|
| Détecteurs PIR, plaques de pression, contacts de porte | Zigbee (bas débit, sur pile) | **MQTT** via une passerelle Zigbee2MQTT → broker MQTT (Mosquitto) | Push |
| Montre : détection de chute, bouton d'aide | Bluetooth LE → smartphone / hub | **HTTP POST** (webhook) depuis l'appli compagnon vers Node-RED | Push, temps réel |
| Montre : fréquence cardiaque | Bluetooth LE → smartphone / hub | **HTTP POST** par lots depuis l'appli compagnon (ou **API REST** cloud du fabricant interrogée périodiquement si l'appli ne permet pas le push) | Push par lots / Pull |
| Profil, seuils, contacts | — | **REST** (API gateway → PostgreSQL) | Requête |

Dans le prototype, les capteurs sont **simulés dans Node-RED** en respectant ces protocoles (publication MQTT, appels HTTP), afin que le remplacement par de vrais capteurs ne change pas la suite du pipeline.

Après normalisation, **MQTT n'est plus utilisé** : la communication entre services repose sur Kafka (événements) et REST / WebSocket (clients), choisis selon le besoin de chaque échange (voir §6).

### Schéma du pipeline
![alt text](<My First Board.jpg>)

### Architecture des services (partie affichage et exposition des données)

| Service | Responsabilité | Entrées | Sorties |
|---|---|---|---|
| **ingestion** (Node-RED) | Réception MQTT / HTTP, normalisation vers le schéma commun, rejet vers la DLQ | Capteurs | `raw-events`, `raw-events-dlq` |
| **correlation** | Règles de détection stateful (fenêtres glissantes en mémoire, pas de requête BDD dans le chemin critique) | `raw-events` | `alerts` |
| **stockage** (consommateur) | Écriture des événements bruts dans InfluxDB, agrégation quotidienne (historique, profil habituel) | `raw-events` | InfluxDB |
| **notification** | Choix des destinataires selon la gravité, envoi push / SMS, gestion de la pré-confirmation et des annulations | `alerts`, contacts (PostgreSQL) | Push / SMS, journal des alertes |
| **api-gateway** (NestJS) | Point d'entrée unique du frontend : authentification et droits par rôle, agrégation des données PostgreSQL + InfluxDB, diffusion temps réel | REST / WebSocket client, Kafka | JSON (REST), événements WebSocket |
| **frontend** | Trois vues selon le rôle : équipe médicale, famille, personne âgée | API gateway | — |

**Récupération / agrégation des données** : le frontend ne parle qu'à l'API gateway. Pour une vue (ex. fiche patient), la gateway combine le profil (PostgreSQL), les séries et agrégats (InfluxDB) et le statut courant (dernier événement reçu via Kafka, conservé en mémoire) en une seule réponse. Les agrégats lourds (tendances hebdomadaires) sont pré-calculés par le service de stockage plutôt que calculés à la demande.

**Orchestration** : tous les services et l'infrastructure (Kafka, Kafdrop, Node-RED, Mosquitto, InfluxDB, PostgreSQL) sont conteneurisés et lancés avec Docker Compose en développement.

### Justification de l'architecture

- **Node-RED** en entrée de pipeline : il gère nativement MQTT et HTTP, ce qui en fait une passerelle adaptée à des capteurs hétérogènes, et il est rapide à prototyper. Son rôle se limite à l'ingestion et à la normalisation : aucune logique métier de détection n'y est placée.
- **Kafka** comme canal central : découple les sources des traitements, permet d'ajouter facilement de nouveaux capteurs (mobilité, diabète…) sans casser l'existant, et de rejouer les événements (utile pour affiner les règles de détection).
- **Traitement de flux (Kafka Streams / Storm)** pour la corrélation multi-signaux : nécessaire car la détection repose sur du **stateful processing** (comparer l'activité actuelle à une fenêtre glissante de référence), pas juste du filtrage simple.
- **API gateway** : un seul point d'entrée pour le frontend, qui centralise l'authentification, les droits par rôle (une famille ne voit que son proche, pas les données médicales détaillées) et l'agrégation des différentes bases.
- **WebSocket** pour le temps réel (alertes, statut) et **REST** pour la consultation et la configuration : le push évite au dashboard d'interroger l'API en boucle pour une alerte critique.
- Architecture globale de type **Lambda** : *Speed Layer* (corrélation → alertes) pour le temps réel, *Batch Layer* (agrégation quotidienne → historique, profil habituel, tendances) pour l'équipe médicale.

> À trancher : Kafka Streams seul ou Apache Storm en complément pour le traitement (topology Spout/Bolt) — dépend de la complexité des règles de corrélation retenues.

---

## 5. Fonctionnalités

### Collecte
- Ingestion multi-capteurs (mouvement, plaques de pression, fréquence cardiaque, chute) via MQTT et HTTP
- Normalisation des formats hétérogènes vers un format commun, avec rejet des messages invalides dans une file dédiée (DLQ)

### Traitement et détection
- Détection de chute (pic d'accélération)
- Détection d'inactivité anormale (fenêtre glissante vs. profil habituel de la personne)
- Corrélation multi-signaux pour réduire les faux positifs (ex. chute + pas de mouvement suivant vs. chute + reprise immédiate d'activité)
- Reconstitution de la pièce actuelle à partir des événements de présence

### Alerte
- Pré-confirmation auprès de la personne âgée avant escalade (sauf si aucune réponse dans un délai donné)
- Notification différenciée selon la gravité (famille ou équipe médicale)
- Demande d'aide manuelle depuis la montre / l'appli
- Historique de toutes les alertes déclenchées et annulées

### Visualisation
- Dashboard équipe médicale : statut temps réel, historique / tendances, configuration des seuils
- Vue famille : statut synthétique et alertes
- Vue personne âgée : résumé de sa journée, ses tendances, ses alertes, bouton d'aide et d'annulation

---

## 6. Stack technique

| Couche | Technologie | Rôle |
|---|---|---|
| Liaison capteurs | **Zigbee2MQTT** + broker **Mosquitto** ; HTTP pour la montre | Imposé par le matériel des capteurs |
| Collecte / normalisation | **Node-RED** | Passerelle d'ingestion MQTT / HTTP → Kafka |
| Bus de messages | **Apache Kafka** (+ Kafdrop pour l'inspection) | Canal découplant sources et traitements, rejouabilité |
| Traitement de flux | **Kafka Streams** (ou Apache Storm) | Corrélation multi-signaux, détection stateful |
| Stockage séries temporelles | **InfluxDB** | Événements bruts, métriques, agrégats d'activité |
| Stockage relationnel | **PostgreSQL** | Profils, contacts, seuils, journal des alertes |
| Notification | Service dédié (push / SMS via un fournisseur externe, à choisir) | Envoi des alertes |
| API / backend | **NestJS** (API gateway) | REST + WebSocket vers le frontend, agrégation des données |
| Frontend | Application web dédiée (framework à choisir) | Vues par rôle |
| Conteneurisation | **Docker Compose** | Environnement de développement local |

**Choix du dashboard** : nous écartons Node-RED Dashboard au profit d'un frontend dédié. Nous avons besoin de trois vues avec des droits différents, d'une interface adaptée à la personne âgée et d'une authentification par rôle ; un frontend dédié derrière l'API gateway nous laisse maîtriser ces points au lieu d'être limitées par l'outil.

**Protocoles entre services** : MQTT est utilisé uniquement là où les capteurs l'imposent. Entre nos services, nous utilisons Kafka pour les flux d'événements (découplage, rejouabilité), REST pour les requêtes / configuration, et WebSocket pour le push temps réel vers le frontend.

---

## 7. Points restant à approfondir

- [ ] **Politique de rétention** des données de santé (durée de conservation des événements bruts vs. agrégats) et conformité RGPD
- [ ] **Matrice d'analyse des risques** (FMEA ou Bowtie) : capteur déconnecté, fausse alerte répétée, latence d'alerte critique, perte de données de santé (RGPD), indisponibilité du smartphone relais de la montre
- [ ] **Règles de corrélation** : seuils et durées des fenêtres, délai de pré-confirmation avant escalade
- [ ] **Authentification et droits** par rôle au niveau de l'API gateway
- [ ] **Fournisseur de notification** push / SMS
- [ ] **CI/CD** : pipeline de build/test/déploiement à définir
