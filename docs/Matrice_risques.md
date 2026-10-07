# Matrice des risques


## Caractérisation des données

| Donnée | Source | Type | Fréquence | Volume | Sensibilité | Temps réel / Historique |
|---|---|---|---|---|---|---|
| Chute | Accéléromètre | Événement ponctuel | Rare mais imprévisible | Faible | Critique (vital) | **Temps réel** (alerte immédiate) |
| Rythme cardiaque | Cardio | Série temporelle | ~1/s à 1/min | **Élevé** | Élevée (santé) | Les deux (live + tendance) |
| Température corporelle | Capteur temp. | Série temporelle | ~1/min à 1/10min | Moyen | Élevée (santé) | Les deux |
| Mouvement (présence) | PIR | Événement | Sporadique | Moyen | Moyenne | Historique (analyse d'habitudes) |
| Prise de médicament | Humain (senior/aidant) | Événement + statut | Ponctuel (planifié) | Faible | Moyenne | Historique + rappel |
| Note soignant | Humain (soignant) | Texte structuré | Rare | Faible | Élevée (médical) | Historique |
| Seuils d'alerte | Humain (soignant) | Configuration | Rare | Faible | Moyenne | Persistant (paramètre) |
| Alerte générée | Système | Événement | Selon incidents | Faible | Élevée | Temps réel + historique (audit) |
| État capteur (batterie, connectivité) | Capteur (auto-diagnostic) | Télémétrie / heartbeat | Périodique (~1/min à 1/5min) | Faible | Faible | Temps réel (détection panne) + historique |


# Matrice d'analyse des risques (AMDEC)

## Méthode

On applique une analyse **AMDEC** (Analyse des Modes de Défaillance, de leurs Effets et de leur Criticité — *FMEA* en anglais). Pour chaque défaillance possible du système, on évalue trois facteurs, chacun noté de 1 à 4 :

- **Gravité** : sévérité de la conséquence si la défaillance survient (1 = mineure, 4 = critique / vitale)
- **Fréquence** : probabilité que la défaillance se produise (1 = rare, 4 = fréquente)
- **Détectabilité** : difficulté à repérer la défaillance avant qu'elle ne produise son effet (1 = détectée immédiatement, 4 = invisible)

La **criticité** est le produit **Criticité = Gravité × Fréquence × Détectabilité** (de 1 à 64). Plus C est élevé, plus le risque est prioritaire à traiter.

> La détectabilité est notée à l'envers de l'intuition : **plus une défaillance est difficile à détecter, plus la note est haute**, car un défaut invisible est plus dangereux qu'un défaut qui se signale de lui-même.

---

## Matrice

| # | Défaillance | Effet | Gravité | Fréquence | Détectabilité | Criticité | Mesures de mitigation |
|---|---|---|---|---|---|---|---|
| R1 | **Capteur déconnecté ou déchargé** (capteur muet) | Angle mort : le système prend l'absence de mesure pour une absence d'événement ; une chute peut ne pas être détectée | 4 | 3 | 4 | **48** | Signal périodique de vie (*heartbeat*) par capteur ; alerte à l'équipe médicale si un capteur ne répond plus ; affichage de l'état des capteurs |
| R2 | **Fausse alerte répétée** | Perte de confiance, désensibilisation : la personne et la famille finissent par ignorer le système | 3 | 3 | 1 | **9** | Corrélation multi-signaux ; étape de pré-confirmation avant escalade ; seuils réglables par l'équipe médicale |
| R3 | **Non-détection d'une vraie chute** (faux négatif) | Personne au sol sans secours : conséquence potentiellement vitale | 4 | 2 | 3 | **24** | Croisement de signaux (impact + silence prolongé) ; escalade automatique si pas de réponse à la pré-confirmation ; bouton d'aide manuel en secours |
| R4 | **Latence d'acheminement de l'alerte** | Secours retardés sur un événement critique | 4 | 2 | 2 | **16** | Chemin temps réel dédié (WebSocket / push) séparé de la consultation ; accusé de réception ; canal de secours (SMS) |
| R5 | **Fuite de données de santé** | Violation de la vie privée ; non-conformité RGPD | 4 | 2 | 3 | **24** | Chiffrement en transit et au repos ; accès filtré côté serveur par rôle ; minimisation (la famille ne reçoit pas les données médicales détaillées) |
| R6 | **Accès malgré un consentement révoqué** | Une personne consulte des données qu'elle ne devrait plus voir | 4 | 2 | 3 | **24** | Vérification systématique (rôle × relation active) à chaque requête ; test automatisé de la révocation ; journal d'accès |
| R7 | **Indisponibilité du relais** (smartphone / hub de la montre éteint) | Les données de la montre (fréquence cardiaque, chute) n'arrivent plus | 3 | 3 | 3 | **27** | Détection de l'absence de *heartbeat* de la montre ; information de la personne et de la famille ; les capteurs fixes (PIR) restent une source indépendante |
| R8 | **Panne du serveur central** | Système entier hors service | 4 | 1 | 1 | **4** | Conteneurisation et redémarrage automatique ; supervision (*health checks*) ; alerte d'exploitation |
| R9 | **Perte de données non encore traitées** | Événements perdus en cas de coupure entre l'ingestion et le traitement | 2 | 2 | 3 | **12** | Traitement au fil de l'eau ; à volume supérieur, un tampon persistant (file de messages) serait introduit |

---

## Lecture de la matrice

Les risques sont indexés de la manière suivante : **Rn**, avec **R** l'abbréviation de *Risque*, et **n** l'index de celui-ci dans cette matrice.

Les risques les plus critiques sont **R1 (capteur muet, C = 48)**, puis **R7 (relais indisponible, C = 27)** et le trio **R3 / R5 / R6 (C = 24)**.

**R1 domine** parce qu'il combine gravité vitale, occurrence réaliste (une pile se décharge, un capteur se déconnecte) et surtout une **détectabilité mauvaise** : sans mécanisme dédié, un capteur muet est silencieux par nature — rien ne distingue « pas d'événement » de « plus de mesure ». D'où la priorité donnée au signal de vie (*heartbeat*), qui transforme un angle mort invisible en information exploitable. C'est le risque le plus important à traiter en premier.

**R7** suit la même logique pour la montre : si le smartphone relais est éteint, toute une famille de capteurs devient muette. La mitigation repose sur la détection de l'absence de signal et sur le fait que les capteurs fixes offrent une source indépendante.

**R3, R5 et R6** ont une conséquence forte mais sont mieux maîtrisés par conception : la détection croisée pour la non-détection de chute (R3), le filtrage côté serveur pour la fuite de données (R5), la vérification rôle × relation pour l'accès après révocation (R6).

**R2 (fausse alerte)** a une criticité faible malgré sa fréquence, parce qu'elle est **immédiatement détectable** (D = 1) : une fausse alerte se voit tout de suite et se corrige. Son vrai danger n'est pas ponctuel mais cumulatif (désensibilisation), d'où l'importance de la pré-confirmation.

Cette hiérarchisation guide les priorités de développement : les mécanismes de *heartbeat*, de pré-confirmation / escalade et de contrôle d'accès sont à traiter avant les optimisations de confort.