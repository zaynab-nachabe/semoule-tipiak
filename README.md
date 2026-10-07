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
| Mouvement / présence par pièce | Détecteurs PIR (détecteurs de mouvement), plaques de pression, contacts de porte | Événementiel |
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

## 5. Matrice des risques

**Matrice d'analyse des risques** : capteur déconnecté, fausse alerte, latence d'alerte, perte de données de santé (RGPD)

Voir le fichier dédié : [Présentation de la matrice des risques](docs/Matrice_risques.md)

## 6. Domain-Driven Design (DDD)

Voir le fichier dédié : [Domain-Driven Design](chemin/vers/le/fichier)

## Points à approfondir

- [ ] **Séparation des données par rôle** : modèle de droits (rôle × relation consentie) au niveau de l'API
- [ ] **Règles de corrélation** : seuils, durée des fenêtres, délai de pré-confirmation avant escalade
- [ ] **RGPD** : durée de conservation des données de santé, gestion du consentement
- [ ] **CI/CD** : pipeline build / test / déploiement
- [ ] **Structure du code** : découpage en services (ingestion, détection, API, notification, frontends)
