# 0010. Inactivité prolongée : seuils jour/nuit lus à l'API puis mis à jour par message, niveau décidé par la fréquence cardiaque

- Statut : acceptée
- Date : 2026-11-10

## Contexte

Scénario B du DDD : une personne qui ne bouge plus depuis longtemps (malaise, chute sans choc détecté) doit déclencher une levée de doute puis une alerte. Il faut décider :

1. **ce qu'est un seuil** : le DDD prévoit des `ToleranceThreshold` et des plages horaires (`TimeRange`) ; rester 10 h sans bouger est normal la nuit, pas l'après-midi ;
2. **comment la détection reçoit les seuils** : elle ne lit jamais la base dans le chemin temps réel (règle du projet), mais l'équipe médicale doit pouvoir les modifier à tout moment ;
3. **quel niveau d'alerte** si la personne ne répond pas : le DDD (étape 5) croise l'absence de réponse avec le signal cardiaque.

## Décision

**Seuils.** Un seuil = une durée maximale sans activité (1 à 1440 min) et une plage horaire facultative en heure locale du logement (fuseau du senior, `Europe/Paris` par défaut), qui peut passer minuit. Données de démonstration : 2 h de 07:00 à 22:00, 10 h de 22:00 à 07:00. À un instant donné :
- **au lit** (bande de pression du lit appuyée) : repos normal, le seuil **le plus long** s'applique ;
- sinon, le plus court des seuils dont la plage contient l'heure ; sinon, le seuil sans plage ; sinon, pas de surveillance.

**Activité** = un mouvement (`PIR_MOTION`) ou un changement d'une bande de pression, dans n'importe quelle pièce ; « tout va bien » compte aussi. La fréquence cardiaque n'est pas une activité : on peut avoir un pouls en restant au sol.

**Livraison des seuils** (décision D7) : au démarrage, la détection lit **tous les profils à l'API** (`GET /internal/activity-profiles`, protégé par une clé partagée `SERVICE_TOKEN` dans l'en-tête `x-service-token`) et réessaie toutes les 5 s tant que l'API ne répond pas. Ensuite, chaque modification par le médical (`PUT /seniors/{id}/thresholds`) est publiée par l'API sur **`profiles/{seniorId}`** (`ActivityProfileUpdated`, profil complet). La détection garde les profils en mémoire.

**Déroulé.** La détection vérifie les seuils chaque minute. Seuil dépassé → `PreConfirmationRequested` (`PROLONGED_INACTIVITY`) dans la vue senior. Une activité ou « tout va bien » annule ; le bouton d'aide passe au niveau 3. Sans réponse à la fin du délai :
- **fréquence cardiaque récente (moins de 10 min) et normale (40 à 150 bpm)** : la personne est vivante, peut-être endormie → niveau 2 (`WARNING`, `NO_RESPONSE`), puis niveau 3 (`NO_RECOVERY`) si toujours aucune activité après le délai habituel (ADR 0005) ;
- **pas de fréquence cardiaque récente, ou valeur anormale** (montre muette, signal plat) → **niveau 3 directement** (`CRITICAL`, nouvelle cause `NO_HEART_SIGNAL`).

Une seule alerte à la fois par senior, et pas de nouvelle alerte d'inactivité tant qu'aucune activité n'a suivi la précédente (ni après une chute ou une demande d'aide restée sans mouvement).

## Conséquences

- La détection reste sans base de données ; la règle de consentement et le stockage restent dans l'API. Le chemin de mise à jour est le même que pour les autres événements (MQTT, QoS 1, session persistante).
- Le niveau de l'alerte ne dépend plus du seuil : la colonne `severity` des seuils a été retirée. Le DDD décrivait `ToleranceThreshold { condition, durationInMinutes, severity }` : c'est désormais `{ condition, durationInMinutes, timeRange }`.
- Contrat : nouveau topic `profiles/{seniorId}`, nouveau message `ActivityProfileUpdated` (§10 de `format-evenements.md`), nouvelle cause `NO_HEART_SIGNAL`. Une alerte d'inactivité peut n'avoir **aucun** signal déclencheur (aucun signal depuis le démarrage) : seule exception à la règle « au moins un ».
- Limites, à reporter dans la matrice des risques :
  - **pas de surveillance tant que les seuils ne sont pas chargés** (API arrêtée au démarrage de la détection) ; le journal l'indique ;
  - **état perdu au redémarrage de la détection** : le temps sans activité repart de zéro, une inactivité en cours est détectée en retard ;
  - **mise à jour perdue** si l'API publie pendant une coupure longue du broker : la détection garde l'ancien profil jusqu'à son prochain redémarrage ;
  - une activité après le niveau 2 clôt l'alerte dans la détection sans prévenir la famille (même limite que la chute) ;
  - la clé de service est partagée et fixe (valeur de développement si `.env` ne la définit pas) ;
  - une personne qui dort hors de son lit (fauteuil) reçoit le seuil de jour en journée.

## Alternatives envisagées

- **Un seul seuil par senior** : le plus simple, mais une fausse alerte chaque nuit.
- **Seuils par pièce** (ex. 45 min dans la salle de bain) : plus fidèle à l'exemple du DDD, mais plus à configurer et à tester ; gardé pour plus tard.
- **La détection lit la base** : contraire à la règle « pas de base dans le chemin temps réel » et au découpage en contextes.
- **Seulement des messages, sans lecture au démarrage** : un profil publié pendant que la détection était arrêtée, ou avant sa première connexion, serait perdu (pas de `retain`).
- **Même escalade que la chute, sans fréquence cardiaque** : ignorerait l'étape 5 du scénario B ; une montre muette ne serait pas un signal d'urgence.
