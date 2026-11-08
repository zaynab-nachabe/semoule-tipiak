# 0004. Séquence de relèvement en deux signaux plutôt qu'un déclencheur unique

- Statut : acceptée
- Date : 2026-11-07

## Contexte

Après un impact, le système doit savoir si la personne s'est relevée (fausse alerte, DDD §4.2 : « fausse alerte confirmée par un mouvement ») ou si elle est restée au sol. La première version annulait la levée de doute au **premier** mouvement détecté. Or une personne au sol peut bouger un bras et déclencher un détecteur de mouvement : un déclencheur unique annule à tort.

Une vraie machine à états de relèvement enchaîne : état « au sol » → changement d'orientation → pic d'activité → station debout stable / pas. L'orientation et le nombre de pas ne sont pas disponibles côté système (ADR 0003) ; les capteurs du logement le sont.

Contrainte matérielle : le détecteur Aqara RTCGQ11LM **ignore tout mouvement pendant 60 s** après une détection. Deux détections du même capteur ne peuvent donc pas tenir dans la levée de doute de 60 s.

## Décision

Le relèvement est une **séquence** de deux signaux du logement, postérieurs à l'impact (`RecoveryProgress` : `FALLEN` → `ACTIVE` → `RECOVERED`) :

1. **activité** : un `PIR_MOTION` ou un `PRESSURE_PLATE` ;
2. **stabilité**, au plus **90 s** après l'activité (`RECOVERY_WINDOW_S`) : un `PRESSURE_PLATE` à `PRESSED` (la personne est sur le lit ou le fauteuil, pas au sol) ou un `PIR_MOTION` dans une **autre pièce** (elle s'est déplacée).

Si la levée de doute expire alors que l'activité est vue mais pas encore la stabilité, la décision est **reportée une seule fois**, jusqu'à la fin des 90 s : la personne en train de se relever n'est pas signalée à tort, et une personne qui bouge au sol ne repousse pas l'alerte indéfiniment.

## Conséquences

- Un mouvement isolé n'annule plus rien ; il faut une preuve que la personne a quitté le sol.
- Le délai de 90 s, un peu plus long que la levée de doute, tient compte de la latence des capteurs et du temps réel pour se relever.
- Limites, à reporter dans la matrice des risques :
  - une **autre personne** présente (visite, aide à domicile) peut déclencher un détecteur dans une autre pièce et faire croire à un relèvement : chute manquée ;
  - une chute dans une pièce **sans capteur**, ou une personne qui se relève sans passer par un capteur, n'est pas reconnue comme relevée : fausse alerte de niveau 2 ;
  - l'ordre des signaux repose sur les **horodatages** : un décalage d'horloge entre la montre et la passerelle peut fausser la séquence.

## Alternatives envisagées

- **Premier mouvement = relevé** (version précédente) : trop de chutes manquées.
- **Ajouter un signal de pas (`STEP_COUNT`) depuis la montre** : réaliste (les montres exposent le nombre de pas) et proche de l'étape « station stable / pas » ; écarté pour l'instant, extension possible du contrat.
- **Exiger deux détections du même capteur** : impossible dans le délai à cause de la mise en veille de 60 s du détecteur.
