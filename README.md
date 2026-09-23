# Fiche de spec

## 1. Sujet

**Détection de chute et d'inactivité anormale chez la personne âgée, avec alerte à la famille et à l'équipe médicale.**

Le projet vise à permettre à une personne âgée de rester à son domicile en toute sécurité, en détectant automatiquement les situations à risque (chute, inactivité prolongée anormale) à partir de plusieurs flux de données de capteurs, et en déclenchant une alerte adaptée au bon destinataire (famille, équipe médicale) selon la gravité de la situation.

### Problématique

Un capteur isolé (mouvement seul, ou fréquence cardiaque seule) génère trop de faux positifs/négatifs pour être fiable : une personne immobile peut simplement dormir ou regarder la télévision ; un pic cardiaque peut être un effort normal. **Croiser plusieurs signaux** permet de distinguer une situation normale d'une situation à risque avant de déclencher une alerte.

### Personas

| Persona | Besoin principal |
|---|---|
| **Personne âgée** | Être protégée et avoir un minimum d'indépendance chez soi; interface simple |
| **Équipe médicale** | Données fiables et historisées, seuils d'alerte configurables, vue synthétique |
| **Famille** | Être rassurée, alertée seulement en cas d'événement significatif |

---

## 2. Entrées (types de données)

| Donnée | Source | Nature | Fréquence |
|---|---|---|---|
| Mouvement / activité | Capteur de mouvement (PIR) ou accéléromètre porté | Flux continu, unbounded | Temps réel (événementiel) |
| Fréquence cardiaque | Montre / bracelet connecté | Flux continu, unbounded | Toutes les X secondes |
| Détection de chute (impact) | Accéléromètre / gyroscope de la montre | Événement ponctuel | Événementiel |
| Position dans le logement *(optionnel)* | Capteurs de présence par pièce | Flux continu | Temps réel |
| Profil / contacts d'urgence | Base de données de configuration | Statique | À la création du profil |
| Historique d'activité | Calculé à partir des flux ci-dessus | Batch (agrégation) | Quotidien |

---

## 3. Sorties

| Sortie | Destinataire | Canal |
|---|---|---|
| Alerte critique (chute détectée, inactivité prolongée anormale) | Famille + équipe médicale | Notification push / SMS |
| Tableau de bord temps réel (état actuel, dernière activité) | Équipe médicale | Dashboard web |
| Rapport de tendances (activité, fréquence cardiaque sur la semaine) | Équipe médicale | Dashboard web (vue historique) |
| Statut simplifié du jour ("tout va bien") | Personne âgée *(optionnel)* | Écran/appli simplifiée |

---

## 4. Flux de données et pipeline

### Vocabulaire

- **Source** : capteurs (mouvement, fréquence cardiaque, accéléromètre)
- **Filtres** : nettoyage, normalisation, détection de seuils, corrélation d'événements
- **Canal** : bus de messages (Kafka)
- **Pipeline** : orchestration complète, du capteur à l'alerte

### Schéma du pipeline (proposition initiale)

```
[Capteur mouvement] ─┐
                      ├─► [Node-RED : collecte & normalisation] ─► [Kafka topic: raw-events]
[Capteur cardiaque]  ─┘
[Capteur chute]      ─┘

[Kafka: raw-events] ─► [Module de corrélation (Storm/Kafka Streams)]
                              │
                    ┌─────────┴─────────┐
              événement normal     événement à risque
                    │                     │
              [stockage historique]  [Kafka topic: alerts]
                                            │
                                  [Service de notification]
                                    ┌───────┴───────┐
                              Famille          Équipe médicale
```

### Justification de l'architecture (à développer)

- **Node-RED** en entrée de pipeline : rapide à prototyper pour la collecte multi-capteurs et la normalisation.
- **Kafka** comme canal central : découple les sources des traitements, permet d'ajouter facilement de nouveaux capteurs (mobilité, diabète…) sans casser l'existant, et de rejouer les événements (utile pour affiner les règles de détection).
- **Traitement de flux (Storm / Kafka Streams)** pour la corrélation multi-signaux : nécessaire car la détection repose sur du **stateful processing** (comparer l'activité actuelle à une fenêtre glissante de référence), pas juste du filtrage simple.
- Architecture globale de type **Lambda** : *Speed Layer* pour les alertes temps réel, *Batch Layer* pour les rapports de tendance envoyés à l'équipe médicale.

> À trancher : Kafka pur ou Apache Storm en complément pour le traitement (topology Spout/Bolt) — dépend de la complexité des règles de corrélation retenues.

---

## 5. Fonctionnalités

### Collecte
- Ingestion multi-capteurs (mouvement, fréquence cardiaque, chute) en continu
- Normalisation des formats hétérogènes vers un format commun

### Traitement et détection
- Détection de chute (pic d'accélération)
- Détection d'inactivité anormale (fenêtre glissante vs. profil habituel de la personne)
- Corrélation multi-signaux pour réduire les faux positifs (ex. chute + pas de mouvement suivant vs. chute + reprise immédiate d'activité)

### Alerte
- Notification différenciée selon la gravité (famille ou équipe médicale)
- Historique de toutes les alertes déclenchées

### Visualisation
- Dashboard équipe médicale (statut temps réel + historique/tendances)
- Vue simplifiée pour la personne âgée *(optionnel si le temps le permet)*

---

## 6. Stack technique (proposition)

| Couche | Technologie envisagée | Rôle |
|---|---|---|
| Collecte / prototypage pipeline | **Node-RED** | Ingestion des capteurs, normalisation initiale |
| Bus de messages | **Apache Kafka** | Canal découplant sources et traitements, rejouabilité |
| Traitement de flux | **Apache Storm** (ou Kafka Streams) | Corrélation multi-signaux, détection stateful |
| Stockage temps réel / historique | À définir (ex. base temporelle type InfluxDB, ou base relationnelle) | Historisation des événements et de l'activité |
| Notification | À définir (ex. webhook, service mail/SMS) | Envoi des alertes |
| Dashboard | À définir (ex. Node-RED Dashboard, ou frontend dédié) | Visualisation par rôle |

---

## 7. Points restant à approfondir

- [ ] **Stratégie de stockage** : choix définitif de la base de données
- [ ] **Stratégie d'échange client-serveur** : REST vs WebSocket/MQTT pour le dashboard et les notifications (probablement MQTT pour suivre le cours)
- [ ] **Matrice d'analyse des risques** (FMEA ou Bowtie) : capteur déconnecté, fausse alerte répétée, latence d'alerte critique, perte de données de santé (RGPD)
- [ ] **CI/CD** : pipeline de build/test/déploiement à définir
- [ ] **Structure du code** : découpage en modules/repos (collecte, traitement, dashboard, notification)
