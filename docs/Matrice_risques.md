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
| R6 | **Accès malgré un consentement révoqué** | Une personne consulte des données qu'elle ne devrait plus voir | 4 | 2 | 3 | **24** | Vérification systématique (rôle × relation active) à chaque requête ; test automatisé de la révocation ; journal d'accès — *limite connue* : les notifications reçues avant une révocation restent lisibles dans la boîte de réception de la personne (seules les nouvelles sont filtrées) |
| R7 | **Indisponibilité du relais** (smartphone / hub de la montre éteint) | Les données de la montre (fréquence cardiaque, chute) n'arrivent plus | 3 | 3 | 3 | **27** | Détection de l'absence de *heartbeat* de la montre ; information de la personne et de la famille ; les capteurs fixes (PIR) restent une source indépendante |
| R8 | **Panne du serveur central** | Système entier hors service | 4 | 1 | 1 | **4** | Conteneurisation et redémarrage automatique ; supervision (*health checks*) ; alerte d'exploitation |
| R9 | **Perte de données non encore traitées** | Événements perdus en cas de coupure entre l'ingestion et le traitement | 2 | 2 | 3 | **12** | Traitement au fil de l'eau ; à volume supérieur, un tampon persistant (file de messages) serait introduit |
| R10 | **Notification urgente non lue** (application fermée, téléphone hors de portée) | La famille et le médical ne voient pas l'alerte de niveau 3 ; personne n'intervient et rien ne relance | 4 | 2 | 3 | **24** | En place : l'alerte reste affichée en cours dans les vues famille et médicale, la prise en charge par le médical est visible de la famille, la lecture est datée (`readAt`). Non implémenté : relance d'une notification `URGENT` non lue ou non prise en charge, escalade vers un autre destinataire, canal hors application (SMS, push) |
| R11 | **Aucun destinataire pour un senior** (pas de proche ni de soignant avec une relation consentie, ou consentement révoqué) | L'alerte est détectée mais remise à personne : seule une ligne de journal en garde la trace | 4 | 1 | 4 | **16** | En place : avertissement « aucun destinataire » dans le journal de l'API. Non implémenté : imposer au moins un destinataire médical à la création d'un senior ; signaler à l'exploitation un senior sans destinataire |
| R12 | **Arrêt du service de notification ou de l'API** | Les notifications ne sont plus produites ou plus remises ; elles attendent dans la session MQTT persistante, et peuvent être perdues si le broker s'arrête brutalement entre deux sauvegardes | 3 | 1 | 2 | **6** | Sessions persistantes (QoS 1) et redémarrage automatique des conteneurs ; contrôle de santé de l'API ; l'état de l'alerte reste visible dans l'application tant que l'API tourne. Limites : une seule instance de chaque service, pas de contrôle de santé pour la notification |
| R13 | **Entrée `/ingest/app` de Node-RED sans authentification**, joignable depuis la machine hôte (port 1880 publié pour l'éditeur) | Quelqu'un sur la machine peut envoyer « tout va bien » au nom du senior et annuler la levée de doute d'une vraie chute, ou déclencher une fausse demande d'aide | 4 | 1 | 4 | **16** | En place : l'application passe par l'API, qui vérifie le rôle et la relation ([ADR 0007](adr/0007-actions-application-via-ingestion.md)) ; chaque source n'est acceptée que sur sa route ; l'action apparaît dans l'historique des signaux (`app-{seniorId}`). Non implémenté : ne pas publier le port 1880 hors de la démonstration, ou authentifier la route (clé partagée avec l'API) |
| R14 | **Connexion sans mot de passe** (choix d'un compte dans une liste, permis par le sujet) | Toute personne qui ouvre la page peut ouvrir n'importe quel compte : lire les données de santé, annuler une alerte au nom du senior | 3 | 2 | 4 | **24** | En place : les droits (rôle × relation consentie) sont vérifiés à chaque requête, la famille ne reçoit pas les données médicales détaillées. Non implémenté : authentification réelle (mot de passe ou fournisseur d'identité), révocation des jetons |
| R15 | **Node-RED arrêté** : les boutons « Tout va bien » et « J'ai besoin d'aide » de l'application échouent | La personne ne peut ni annuler ni demander de l'aide depuis l'application (la montre non plus, elle passe aussi par Node-RED) | 3 | 1 | 1 | **3** | En place : l'API répond `503` et l'application affiche l'erreur ; redémarrage automatique du conteneur. Non implémenté : chemin de secours direct de l'API vers la détection |
| R16 | **Seuils d'inactivité pas encore chargés** (API arrêtée au démarrage de la détection) | L'inactivité n'est pas surveillée tant que l'API ne répond pas : une personne immobile n'est pas signalée | 4 | 1 | 2 | **8** | En place : nouvel essai toutes les 5 s, journal « inactivité non surveillée » à chaque essai ; la chute et le bouton d'aide restent surveillés. Non implémenté : alerte d'exploitation si les profils ne sont pas chargés après quelques minutes ([ADR 0010](adr/0010-detection-inactivite.md)) |
| R17 | **Redémarrage de la détection** pendant une inactivité | Le temps sans activité repart de zéro : une personne déjà immobile depuis longtemps n'est signalée qu'après un seuil complet (jusqu'à 10 h la nuit) | 4 | 1 | 4 | **16** | En place : redémarrage automatique (rarement nécessaire) ; la session MQTT persistante redonne les signaux reçus pendant l'arrêt. Non implémenté : reprendre la dernière activité de chaque senior dans l'historique des signaux de l'API au démarrage |
| R18 | **Mise à jour des seuils perdue** (publiée pendant une longue coupure du broker) | La détection garde les anciens seuils jusqu'à son prochain redémarrage : l'équipe médicale croit avoir changé un réglage qui ne s'applique pas | 3 | 1 | 4 | **12** | En place : QoS 1 et session persistante pour les coupures courtes ; la vue médicale relit les seuils depuis l'API. Non implémenté : version du profil comparée périodiquement entre l'API et la détection |

---

## Lecture de la matrice

Les risques sont indexés de la manière suivante : **Rn**, avec **R** l'abbréviation de *Risque*, et **n** l'index de celui-ci dans cette matrice.

Les risques les plus critiques sont **R1 (capteur muet, C = 48)**, puis **R7 (relais indisponible, C = 27)** et le groupe **R3 / R5 / R6 / R10 / R14 (C = 24)**.

**R1 domine** parce qu'il combine gravité vitale, occurrence réaliste (une pile se décharge, un capteur se déconnecte) et surtout une **détectabilité mauvaise** : sans mécanisme dédié, un capteur muet est silencieux par nature — rien ne distingue « pas d'événement » de « plus de mesure ». D'où la priorité donnée au signal de vie (*heartbeat*), qui transforme un angle mort invisible en information exploitable. C'est le risque le plus important à traiter en premier.

**R7** suit la même logique pour la montre : si le smartphone relais est éteint, toute une famille de capteurs devient muette. La mitigation repose sur la détection de l'absence de signal et sur le fait que les capteurs fixes offrent une source indépendante.

**R3, R5 et R6** ont une conséquence forte mais sont mieux maîtrisés par conception : la détection croisée pour la non-détection de chute (R3), le filtrage côté serveur pour la fuite de données (R5), la vérification rôle × relation pour l'accès après révocation (R6).

**R13, R14 et R15** viennent de l'application web et des actions du senior ([ADR 0007](adr/0007-actions-application-via-ingestion.md), [ADR 0009](adr/0009-application-web-react-nginx.md)). **R14** (C = 24) découle d'un choix permis par le sujet : l'authentification est hors périmètre, mais ses conséquences méritent d'être écrites. **R13** est rare et ne concerne que la machine hôte, mais il est invisible et peut faire manquer une vraie chute : c'est la mesure la plus simple à prendre avant tout déploiement (ne pas exposer Node-RED). **R15** est visible tout de suite (D = 1).

**R10, R11 et R12** viennent de l'acheminement des notifications ([ADR 0008](adr/0008-service-de-notification.md)). Ce sont des points faibles connus, gardés volontairement dans cette version. **R10** est le plus important : une alerte bien détectée ne sert à rien si personne ne la lit. Le système sait qu'une notification n'est pas lue (`readAt`), mais il ne relance pas encore ; une relance après quelques minutes sans prise en charge serait la prochaine mesure à ajouter. **R11** est rare mais invisible (D = 4) : il relève d'une règle de configuration (au moins un destinataire médical par senior). **R12** est peu critique, car il est visible et les sessions persistantes gardent les messages pendant un redémarrage.

**R16, R17 et R18** viennent de la détection de l'inactivité ([ADR 0010](adr/0010-detection-inactivite.md)) : la détection garde son état et ses seuils en mémoire, sans lire la base. **R17** est le plus sérieux (C = 16) : rare, mais invisible, et il retarde l'alerte au pire moment ; la mesure la plus simple serait de reprendre la dernière activité connue dans l'historique des signaux de l'API au démarrage. **R18** est invisible pour l'équipe médicale, qui croit son réglage appliqué.

**R2 (fausse alerte)** a une criticité faible malgré sa fréquence, parce qu'elle est **immédiatement détectable** (D = 1) : une fausse alerte se voit tout de suite et se corrige. Son vrai danger n'est pas ponctuel mais cumulatif (désensibilisation), d'où l'importance de la pré-confirmation.

Cette hiérarchisation guide les priorités de développement : les mécanismes de *heartbeat*, de pré-confirmation / escalade et de contrôle d'accès sont à traiter avant les optimisations de confort.