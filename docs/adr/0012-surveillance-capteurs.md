# 0012. Surveillance des capteurs par la détection, registre dans l'API, notifications de niveau 0

- Statut : acceptée
- Date : 2026-11-11

## Contexte

R1 est le risque le plus critique de la matrice (C = 48) : un capteur muet (pile vide, réseau Zigbee perdu, montre retirée ou loin du téléphone) est un angle mort. Sans mécanisme dédié, rien ne distingue « pas d'événement » de « plus de mesure ». Les capteurs envoient déjà des signaux de vie : rapports périodiques de Zigbee2MQTT (avec la batterie) et `SENSOR_HEARTBEAT` de la montre. Le niveau `SYSTEM` (0) de l'échelle de gravité ([ADR 0005](0005-echelle-de-gravite.md)) leur était réservé, sans être produit.

Il faut décider qui surveille, où vit la liste des capteurs attendus, et qui est prévenu.

## Décision

- **La détection surveille** (`SensorSupervisionService`). Elle voit déjà chaque signal en temps réel. Pour chaque capteur attendu, elle retient le dernier signal reçu (quel qu'il soit) et la dernière batterie connue, et vérifie chaque minute :
  - **muet** (`OFFLINE`) : aucun signal depuis plus que l'**intervalle attendu** du capteur ;
  - **batterie faible** (`LOW_BATTERY`) : dernière batterie sous **20 %** ;
  - **en ligne** (`ONLINE`) sinon. `OFFLINE` l'emporte.
  À chaque **changement** d'état, elle publie l'événement de domaine **`SensorStatusChanged`** (niveau 0, `SYSTEM`) sur `alerts/{seniorId}/SensorStatusChanged`. Ce n'est pas une alerte : il n'a pas d'`alertId` et ne passe pas dans le journal des alertes.
- **Le registre des capteurs attendus est une table de l'API** (`sensors` : type, pièce, emplacement, modèle, intervalle attendu), alimentée par les données de démonstration. Il est envoyé à la détection dans le **profil d'activité** (`sensors`), par le même chemin que les seuils ([ADR 0010](0010-detection-inactivite.md)). Intervalles retenus : **2 h** pour les capteurs Zigbee (ils envoient un rapport au moins toutes les heures), **15 min** pour la montre.
- **L'API** enregistre le dernier état de chaque capteur, le montre (`GET /seniors/{id}/sensors`, `SensorHealthView` avec le dernier signal et la batterie lus dans l'historique) et le pousse en temps réel (`sensor.changed`).
- **La notification route les états de capteur** :
  - capteur muet : équipe médicale (`INFO`) ; **montre muette : aussi la famille** (`NORMAL`), car les chutes ne sont plus détectées (risque R7) ;
  - batterie faible : équipe médicale (`INFO`) ;
  - retour en ligne : personne (visible dans les vues).
  Une notification peut donc concerner **soit une alerte, soit un capteur** (`sensorId`, `severity` `SYSTEM`, sans `alertId`) : changement du contrat des notifications (§9 de `format-evenements.md`).
- **Les vues** : panneau détaillé pour le médical (dernier signal, batterie, modèle, intervalle), résumé pour la famille (seulement ce qui ne va pas), et dans la vue senior « Votre montre ne transmet plus ».

## Conséquences

- R1 passe d'un angle mort à une information : l'équipe médicale sait qu'un capteur est muet au plus une vérification après son intervalle attendu.
- Le niveau `SYSTEM` est enfin produit ; l'échelle de gravité est complète.
- Limites, reportées dans la matrice des risques :
  - **deux registres à tenir à jour** : celui de Node-RED (normalisation) et la table `sensors` de l'API (surveillance). Un capteur ajouté à un seul des deux est soit rejeté, soit jamais surveillé ;
  - **état perdu au redémarrage de la détection** : chaque capteur est supposé en ligne, son silence se compte depuis le redémarrage ; un capteur déjà muet est signalé avec un retard d'au plus un intervalle ;
  - un capteur qui envoie des messages incorrects (rejetés par Node-RED) est considéré muet, sans distinction ;
  - le silence d'un détecteur n'est pas croisé avec l'inactivité : si tous les détecteurs se taisent, une levée de doute d'inactivité peut arriver en plus de la notification de capteur.

## Alternatives envisagées

- **Surveillance par l'API** (tâche périodique sur l'historique en base) : elle survivrait aux redémarrages, mais l'API produirait elle-même des événements de supervision, en dehors du contexte de détection qui porte l'échelle de gravité.
- **Un service de supervision séparé** : séparation nette, mais un conteneur de plus qui a besoin des mêmes signaux et du même registre.
- **Node-RED charge son registre depuis l'API** : une seule source de vérité, mais plus de travail dans Node-RED et une dépendance de l'ingestion à l'API au démarrage.
- **Panneaux seulement, sans notification** : pas de changement du contrat, mais personne n'est activement prévenu, alors que la mesure de R1 est d'« alerter l'équipe médicale ».
