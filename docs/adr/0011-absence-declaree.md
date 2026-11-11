# 0011. « Je m'absente » : absence enregistrée par l'API et portée par le profil d'activité

- Statut : acceptée
- Date : 2026-11-10

## Contexte

Une personne autonome sort de chez elle : courses, visite, rendez-vous. Pendant ce temps, aucun capteur du logement ne voit de mouvement, et la détection d'inactivité ([ADR 0010](0010-detection-inactivite.md)) lèverait le doute puis alerterait la famille à tort. Le sujet demande aussi une **saisie manuelle d'un utilisateur** : la déclaration d'absence par le senior en est une.

Il faut décider par où passe l'absence, ce qu'elle suspend, et comment elle se termine si la personne oublie de le dire.

## Décision

- **Le senior déclare son absence dans l'application** (« Je m'absente »), avec une **heure de retour prévue** (au plus 24 h). Lui seul peut la déclarer ou la terminer (« Je suis rentré(e) »).
- **L'API l'enregistre** (table `absences`) et l'ajoute au **profil d'activité** déjà publié sur `profiles/{seniorId}` (`absence: { since, until }`, §10 de `format-evenements.md`). La détection la reçoit comme les seuils : au démarrage par l'API, puis par message. La famille et le médical la voient dans le statut, en temps réel (`absence.changed`).
- **Elle ne passe pas par Node-RED**, contrairement à « tout va bien » et « aide » ([ADR 0007](0007-actions-application-via-ingestion.md)) : ces deux boutons sont des **événements** ponctuels, équivalents à ceux de la montre ; une absence est un **état déclaré** qui dure et doit survivre à un redémarrage de la détection.
- **Ce qui est suspendu** : seulement la surveillance de l'inactivité. La chute (la montre se porte dehors) et le bouton d'aide restent actifs.
- **Fin de l'absence** :
  - à l'heure de retour prévue, d'elle-même ; ensuite, le temps sans activité se compte **à partir de l'heure prévue** : si la personne ne rentre pas, une levée de doute arrive après le seuil habituel ;
  - sur « Je suis rentré(e) » ;
  - sur le **premier mouvement au domicile plus de 15 minutes après la déclaration** (`ABSENCE_GRACE_S`) : la personne est rentrée plus tôt et a oublié de le dire. Les 15 minutes laissent le temps de partir. L'API applique cette règle (elle reçoit déjà tous les signaux), puis republie le profil.

## Conséquences

- Aucun nouveau topic ni message : l'absence réutilise le profil d'activité et son chemin de livraison. Le contrat change à un endroit (`absence` dans `ActivityProfile`).
- La détection reste simple : elle suit le profil, sans règle de fin d'absence à elle.
- Limites, à reporter dans la matrice des risques :
  - **une chute à l'extérieur sans la montre** (ou montre hors de portée du smartphone) n'est pas détectée pendant l'absence ; le retard maximal est l'heure de retour prévue plus un seuil d'inactivité ;
  - **un mouvement au domicile pendant l'absence** (autre personne, animal, intrus) la termine : la surveillance reprend, avec un risque de fausse alerte d'inactivité si la personne est toujours dehors ;
  - **déclarer une absence ne répond pas** à une levée de doute en cours : la personne doit répondre « tout va bien » ;
  - comme pour les seuils, une mise à jour perdue pendant une longue coupure du broker laisse la détection sur l'ancien état (R18).

## Alternatives envisagées

- **Signaux par Node-RED** (comme les boutons d'ADR 0007) : chemin d'entrée unique, mais l'absence ne vivrait que dans la mémoire de la détection (perdue au redémarrage) et l'API devrait la reconstruire depuis l'historique pour l'afficher.
- **Fin seulement à l'heure prévue ou sur le bouton** : un retour anticipé laisserait le logement sans surveillance jusqu'à l'heure prévue.
- **Absence sans heure de retour** : la plus simple, mais un oubli de « je suis rentré(e) » désactiverait la surveillance indéfiniment.
