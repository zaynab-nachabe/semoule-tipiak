# Analyse des risques (AMDEC / FMEA)

Cette analyse porte sur les risques de **l'architecture telle qu'elle est construite** : ce qui peut faire manquer une chute ou une inactivité, prévenir trop tard ou la mauvaise personne, ou exposer des données de santé. Elle ne cherche pas l'exhaustivité : les risques faibles sont regroupés à la fin, en quelques lignes.

## 1. Méthode

Méthode **AMDEC** (Analyse des Modes de Défaillance, de leurs Effets et de leur Criticité, *FMEA* en anglais). Chaque défaillance est notée de 1 à 4 sur trois critères :

- **Gravité (G)** : conséquence si elle survient (1 = mineure, 4 = vitale) ;
- **Fréquence (F)** : probabilité qu'elle survienne (1 = rare, 4 = fréquente) ;
- **Détectabilité (D)** : difficulté à la repérer avant qu'elle ne produise son effet (1 = visible tout de suite, 4 = invisible).

**Criticité C = G × F × D** (de 1 à 64). La détectabilité est notée « à l'envers » : un défaut invisible est plus dangereux qu'un défaut qui se signale de lui-même.

Les notes tiennent compte des mesures **déjà en place** dans le code ; la dernière colonne donne la prochaine mesure, non réalisée. Quand une mesure réalisée a fait baisser un risque, la criticité d'origine est indiquée.

## 2. Données en jeu

| Donnée | Source | Nature | Sensibilité | Usage |
|---|---|---|---|---|
| Impact de chute | Montre (accéléromètre) | Événement rare, imprévisible | Vitale | Temps réel (levée de doute) |
| Fréquence cardiaque | Montre | Mesure périodique | Santé | Temps réel (croisement avec l'inactivité) et historique (médical) |
| Mouvement par pièce | Détecteurs Aqara (Zigbee) | Événement | Vie privée (habitudes) | Temps réel (inactivité, relèvement) |
| Lit / fauteuil occupé | Bandes de pression Tuya (Zigbee) | État, au changement | Vie privée | Temps réel (repos, relèvement) |
| Batterie, signe de vie | Tous les capteurs | Rapport périodique | Faible | Surveillance des capteurs |
| « Tout va bien », aide, absence | Senior (montre ou application) | Saisie manuelle | Vitale (aide) | Temps réel |
| Seuils d'inactivité | Équipe médicale | Configuration | Moyenne | Détection |
| Alertes, notifications | Système | Événements | Santé | Temps réel et historique (journal) |

## 3. Matrice

Triée par criticité décroissante.

| # | Défaillance | Effet | G | F | D | C | En place | Prochaine mesure (non réalisée) |
|---|---|---|---|---|---|---|---|---|
| R19 | **Chute à l'extérieur pendant une absence déclarée**, sans la montre ou hors de portée du smartphone | Personne au sol dehors : ni chute détectée, ni inactivité surveillée jusqu'au retour prévu plus un seuil (jusqu'à 24 h + 2 h) | 4 | 2 | 4 | **32** | Chute et bouton d'aide surveillés pendant l'absence si la montre est portée ; absence limitée à 24 h ; inactivité comptée depuis le retour prévu ([ADR 0011](adr/0011-absence-declaree.md)) | Prévenir la famille quand l'heure de retour est dépassée sans mouvement au domicile ; rappel « êtes-vous rentré(e) ? » |
| R1 | **Capteur muet** (pile vide, réseau Zigbee perdu, montre retirée) | Angle mort : l'absence de mesure passe pour une absence d'événement ; une chute ou une inactivité peut être manquée | 4 | 3 | 2 | **24** *(48 avant)* | La détection déclare un capteur muet au-delà de son intervalle attendu (2 h Zigbee, 15 min montre) et signale les batteries sous 20 % ; notification au médical (montre muette : aussi la famille) ; état des capteurs dans les trois vues ([ADR 0012](adr/0012-surveillance-capteurs.md)) | Croiser le silence d'un détecteur avec l'inactivité de sa pièce |
| R3 | **Vraie chute non détectée** (faux négatif) | Personne au sol sans secours | 4 | 2 | 3 | **24** | Seuil d'impact bas (3,0 g, [ADR 0003](adr/0003-detection-chute-deux-niveaux.md)) ; une chute n'est annulée que par une **séquence** de deux signaux (activité puis stabilité, [ADR 0004](adr/0004-sequence-de-relevement.md)) ; escalade automatique sans réponse ; l'inactivité prolongée rattrape une chute sans choc ; bouton d'aide | Tenir compte d'une autre personne présente (un mouvement ailleurs peut passer pour un relèvement) |
| R5 | **Fuite de données de santé** | Atteinte à la vie privée, non-conformité RGPD | 4 | 2 | 3 | **24** | Filtrage côté serveur (rôle × relation consentie) ; minimisation : la famille ne reçoit ni la cause clinique ni la fréquence cardiaque ; la notification ne voit pas les personnes ([ADR 0008](adr/0008-service-de-notification.md)) | HTTPS et chiffrement au repos (absents de la démonstration) ; durée de conservation de l'historique des signaux |
| R10 | **Notification urgente non lue** (application fermée, téléphone loin) | Alerte de niveau 3 bien détectée, mais personne n'intervient | 4 | 2 | 3 | **24** | Alerte affichée « en cours » dans les vues famille et médicale ; prise en charge visible de la famille ; lecture datée (`readAt`) | Relancer, ou prévenir un autre destinataire, si une alerte `URGENT` n'est ni lue ni prise en charge ; canal hors application (SMS, push) |
| R14 | **Connexion sans mot de passe** (choix d'un compte dans une liste, permis par le sujet) | Toute personne qui ouvre la page peut ouvrir n'importe quel compte | 3 | 2 | 4 | **24** | Droits vérifiés à chaque requête ; jeton à durée limitée (12 h) | Authentification réelle, révocation des jetons |
| R7 | **Relais de la montre indisponible** (smartphone éteint ou loin) | Plus de chute ni de fréquence cardiaque | 3 | 3 | 2 | **18** *(27 avant)* | Montre déclarée muette après 15 min, famille et médical prévenus, message dans la vue senior ; les capteurs fixes restent une source indépendante (inactivité) | Indicateur de connexion du smartphone dans la vue senior |
| R4 | **Alerte acheminée trop tard** | Secours retardés | 4 | 2 | 2 | **16** | Chemin temps réel dédié (MQTT puis WebSocket) séparé de la consultation ; notification et journal en parallèle | Mesurer le délai bout en bout ; canal de secours |
| R11 | **Aucun destinataire pour un senior** (pas de relation consentie, ou consentement révoqué) | Alerte détectée mais remise à personne | 4 | 1 | 4 | **16** | Avertissement « aucun destinataire » dans le journal de l'API | Exiger au moins un destinataire médical par senior |
| R13 | **Entrée `/ingest/app` de Node-RED sans authentification**, joignable depuis la machine (port 1880 publié pour l'éditeur) | Quelqu'un sur la machine peut annuler la levée de doute d'une vraie chute | 4 | 1 | 4 | **16** | L'application passe par l'API, qui vérifie les droits ([ADR 0007](adr/0007-actions-application-via-ingestion.md)) ; chaque source n'est acceptée que sur sa route ; l'action est tracée dans l'historique des signaux | Ne pas publier le port 1880 hors démonstration, ou authentifier la route |
| R17 | **Redémarrage de la détection** pendant une inactivité | Le temps sans activité repart de zéro : alerte retardée d'un seuil complet (jusqu'à 10 h la nuit) | 4 | 1 | 4 | **16** | Redémarrage automatique ; la session MQTT persistante redonne les signaux arrivés pendant l'arrêt ([ADR 0010](adr/0010-detection-inactivite.md)) | Reprendre la dernière activité dans l'historique de l'API au démarrage |
| R6 | **Accès malgré un consentement révoqué** | Une personne voit des données qu'elle ne devrait plus voir | 4 | 1 | 3 | **12** *(24 avant)* | Règle rôle × relation **active** vérifiée à chaque requête REST ; testée (403) | Une connexion temps réel déjà ouverte reçoit encore les messages jusqu'à sa reconnexion, et les notifications reçues avant la révocation restent lisibles : les couper aussi |
| R9 | **Messages perdus entre services** (coupure, redémarrage) | Un signal ou une alerte n'est jamais traité | 2 | 2 | 3 | **12** | QoS 1, sessions persistantes, persistance du broker, dédoublonnage par `eventId` ([ADR 0002](adr/0002-mqtt-seul-bus-de-messages.md)) | Journal rejouable si le volume augmentait (Kafka) |
| R18 | **Mise à jour des seuils ou de l'absence perdue** (longue coupure du broker) | La détection garde l'ancien profil : le médical croit son réglage appliqué | 3 | 1 | 4 | **12** | QoS 1 et session persistante pour les coupures courtes ; la vue médicale relit les seuils depuis l'API | Comparer périodiquement la version du profil entre l'API et la détection |
| R20 | **Registre des capteurs en double** (Node-RED et table `sensors` de l'API) | Un capteur ajouté à un seul registre est rejeté, ou jamais surveillé | 3 | 1 | 4 | **12** | Mêmes données de démonstration dans les deux, documentées ensemble ; l'API journalise un état reçu pour un capteur inconnu ([ADR 0012](adr/0012-surveillance-capteurs.md)) | Node-RED charge son registre depuis l'API |

### Risques faibles, pris en compte

- **R2, fausse alerte répétée** (3 × 3 × 1 = 9) : fréquente mais visible tout de suite. Son danger est cumulatif (on finit par ignorer le système) ; d'où la levée de doute avant toute alerte, la séquence de relèvement, les seuils jour/nuit et l'absence déclarée.
- **R16, seuils pas encore chargés au démarrage** (8), **R12, arrêt de la notification ou de l'API** (6), **R8, panne du serveur** (4), **R15, Node-RED arrêté pendant une action du senior** (3) : rares et visibles (journal « inactivité non surveillée », erreur `503` affichée dans l'application, contrôles de santé, redémarrage automatique des conteneurs).

## 4. Lecture

**Priorités si le projet continuait** : relance des alertes urgentes non lues (R10), alerte « pas rentré(e) » (R19), reprise de l'état de la détection au démarrage (R17), HTTPS et authentification réelle (R5, R14).
