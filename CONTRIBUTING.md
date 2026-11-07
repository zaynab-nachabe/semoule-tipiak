# Contribution


## Branches

Une branche par fonctionnalité / domaine de fonctionnalité, préfixée par son type :

- `feat/` — nouvelle fonctionnalité (ex. `feat/detection-chute`)
- `fix/` — correction de bug (ex. `fix/mqtt-reconnexion`)
- `docs/` — documentation (ex. `docs/ddd`)
- `chore/` — mise en place, outillage, config (ex. `chore/setup-projet`)

On part toujours de `main` à jour :

```bash
git checkout main
git pull
git checkout -b feat/ma-tache
```

## Commits

Format simple, préfixé par le type, à l'impératif :

```
feat: ajoute la détection de chute
fix: corrige la reconnexion MQTT
docs: complète la matrice des risques
```

## Pull requests

- On ne pousse pas directement sur `main` : on passe par une PR, même en travaillant seule. La PR garde une trace de ce qui a changé et pourquoi.
- Pas de relecture obligatoire (projet mené en solo) : relire soi-même le diff de la PR avant de fusionner.
- La PR doit passer la CI (build + tests) au vert.


---

C'est tout. Si une règle devient plus gênante qu'utile, on la change.