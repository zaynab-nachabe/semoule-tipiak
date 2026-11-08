# 0005. Échelle de gravité à 4 niveaux et passage automatique au niveau 3

- Statut : acceptée
- Date : 2026-11-07

## Contexte

La première version du contrat avait une gravité `MEDIUM` / `HIGH` / `CRITICAL` sans règle d'attribution. Il faut une échelle qui distingue un problème technique, une levée de doute, un incident non infirmé et une urgence confirmée, et qui dise quoi faire à chaque niveau. Le sujet n'impose pas d'appel ni de SMS : les alertes sont affichées dans l'application (vues famille et médicale) et journalisées.

## Décision

| Niveau | Valeur | Déclencheur | Effet |
|---|---|---|---|
| 0 | `SYSTEM` | Batterie faible, capteur muet (à venir) | Indicateur dans la vue médicale, journal |
| 1 | `PRE_ALERT` | Impact ≥ 3,0 g → `PreConfirmationRequested` | Vibration de la montre, « Tout va bien ? » avec compte à rebours de 60 s |
| 2 | `WARNING` | Levée de doute expirée sans réponse ni relèvement (`NO_RESPONSE`) | Alerte dans la vue famille, trace pour l'équipe médicale |
| 3 | `CRITICAL` | Bouton d'aide pendant ou après l'incident (`SENIOR_CONFIRMED`), demande d'aide spontanée (`IMMEDIATE`), ou niveau 2 sans relèvement pendant **5 min** (`NO_RECOVERY`) | Alerte urgente dans les vues médicale et famille ; dans un déploiement réel : appel ou envoi de secours |

Une alerte peut passer du niveau 2 au niveau 3 : `CriticalAlertGenerated` est alors publié deux fois avec le même `alertId`. Un relèvement pendant les 5 min évite le niveau 3.

## Conséquences

- Chaque niveau a une règle d'entrée explicite et testée ; les destinataires restent choisis par la notification (DDD).
- Le délai de 5 min (`CRITICAL_ESCALATION_DELAY_S`) borne le temps passé au sol sans prise en charge médicale si la famille ne réagit pas.
- Limites, à reporter dans la matrice des risques :
  - un relèvement **après** le niveau 2 évite le niveau 3 mais n'est pas annoncé : la vue famille garde l'alerte de niveau 2 affichée (pas d'événement « alerte levée ») ;
  - une annulation (« tout va bien ») après le niveau 2 est ignorée : seul un relèvement observé par les capteurs arrête l'escalade.

## Alternatives envisagées

- **Unanswered = urgence immédiate (niveau 3)** : plus prudent, mais solliciterait l'équipe médicale pour chaque chute non confirmée, y compris celles où la famille aurait suffi.
- **Gravité choisie par la notification plutôt que par la détection** : la détection est la seule à connaître le déroulé (réponse, relèvement) ; la notification se contente de choisir les destinataires.
