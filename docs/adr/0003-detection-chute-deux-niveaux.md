# 0003. Détection de chute répartie entre la montre et le système, seuil d'impact à 3,0 g

- Statut : acceptée
- Date : 2026-11-07

## Contexte

Un seuil unique sur l'accélération produit beaucoup de faux positifs. Les algorithmes robustes de détection de chute sont des **machines à états** construites autour de la magnitude du vecteur d'accélération (SVtot) : pic d'impact, changement d'orientation, phase d'immobilité ou de reprise d'activité. Ordres de grandeur du pic d'impact : 2,0 à 3,0 g pour un capteur porté à la taille ou au thorax, **3,0 à 5,0 g pour un capteur au poignet**.

Ces étapes demandent le flux brut de l'accéléromètre (plusieurs dizaines de mesures par seconde). Les montres du commerce avec détection de chute (Apple Watch, Galaxy Watch) ne l'envoient pas : l'algorithme tourne **sur la montre**, qui ne transmet qu'un événement « chute détectée ».

## Décision

Répartir la détection sur deux niveaux :

| Étape | Où | Dans le projet |
|---|---|---|
| Pic d'impact (SVtot), changement d'orientation | Sur la montre | Simulé ; la montre envoie `FALL_IMPACT` avec `value` = pic de SVtot en g |
| Filtrage des chocs mineurs | Service de détection | Seuil **3,0 g** (`FALL_MIN_IMPACT_G`) |
| Reprise d'activité ou non | Service de détection, avec les capteurs du logement | Séquence de relèvement (ADR 0004) |

Le seuil de 3,0 g est le **bas de la plage** des capteurs au poignet : une chute manquée (risque R3) est plus grave qu'une fausse alerte, que la levée de doute absorbe.

## Conséquences

- Le système fait ce qu'une montre seule ne peut pas faire : **croiser** l'événement de chute avec les capteurs du logement, ce qui est la problématique du projet.
- Le format reste celui que produirait une vraie appli compagnon (pas de flux brut à transporter).
- Limite : la qualité de la première étape dépend de l'algorithme de la montre, que le système ne contrôle pas.
- Limite : une montre non portée (charge, oubli) ne détecte rien ; seule l'inactivité anormale (scénario B) couvre ce cas.

## Alternatives envisagées

- **Recevoir le flux brut de l'accéléromètre et faire toute la machine à états côté serveur** : contrôle total de l'algorithme, mais irréaliste (débit, batterie, aucune montre du commerce ne l'expose) et hors de la problématique de corrélation multi-capteurs.
- **Seuil plus élevé (4 à 5 g)** : moins de fausses alertes, mais plus de chutes « molles » manquées (glissade, effondrement lent).
