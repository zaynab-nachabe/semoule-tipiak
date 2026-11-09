# 0007. Les actions de l'application passent par l'ingestion, comme des signaux

- Statut : acceptée (implémentée avec l'application web, ADR 0009)
- Date : 2026-11-10

## Contexte

La vue senior propose « Tout va bien » (annuler une levée de doute) et « J'ai besoin d'aide ». La montre propose les mêmes actions, qui arrivent déjà dans le système comme signaux `CANCEL_ALERT` et `HELP_BUTTON` (via Node-RED). Il faut décider comment les boutons de l'application atteignent la détection. C'est aussi l'« entrée manuelle d'un utilisateur » demandée par le sujet.

## Décision

**Application → API → Node-RED → `signals/{seniorId}/{type}` → détection.**

- L'API vérifie que l'appelant est bien ce senior (rôle et relation, comme pour toute requête), puis transmet l'action à Node-RED par HTTP.
  Mise en œuvre : `POST /seniors/{seniorId}/alerts/{alertId}/cancel` et `POST /seniors/{seniorId}/help` (réponse `202`), puis l'API appelle `POST /ingest/app` de Node-RED avec la source `app-{seniorId}`. Node-RED injoignable → `503`.
- Node-RED la normalise en signal `CANCEL_ALERT` ou `HELP_BUTTON`, exactement comme un appui sur le bouton de la montre. L'application est une **source d'entrée de plus**, enregistrée dans le registre des capteurs. Une route HTTP dédiée (`/ingest/app`) la distingue de la montre dans l'historique ; le registre impose à chaque source sa route.
- La détection ne fait aucune différence entre la montre et l'application.

## Conséquences

- Un seul chemin d'entrée pour la détection, qui n'écoute que `signals/…` ; aucun nouveau type de message ni topic dans le contrat.
- Node-RED reste la seule couche anti-corruption (DDD §3.4) : tout ce qui vient de l'extérieur y est traduit.
- L'action apparaît dans l'historique des signaux comme celles des capteurs (traçabilité).
- Limites, à reporter dans la matrice des risques :
  - **Node-RED devient nécessaire aux boutons de l'application** : s'il est arrêté, « J'ai besoin d'aide » dans l'application échoue (comme les capteurs) ;
  - un saut de plus (API puis Node-RED) avant la détection ;
  - l'entrée HTTP de Node-RED n'est pas authentifiée : elle doit rester interne au réseau Docker, seule l'API y accède.

## Alternatives envisagées

- **L'API publie une commande destinée à la détection** (proposition initiale du contrat d'API) : nouveau topic et nouveau format, et la détection traiterait la même intention par deux chemins.
- **L'API publie directement le signal normalisé** sur `signals/…` : un saut de moins, mais l'API fabriquerait des signaux et Node-RED ne serait plus le seul point de normalisation.
- **L'application appelle Node-RED directement** : pas de contrôle d'accès, n'importe qui pourrait déclencher une aide au nom d'un senior.
