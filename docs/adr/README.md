# Décisions d'architecture (ADR)

Chaque ADR justifie une décision structurante : contexte, décision, conséquences (avantages et limites), alternatives écartées. Les décisions évidentes ne sont pas documentées ici.

| N° | Décision | Statut |
|---|---|---|
| [0001](0001-detection-typescript-mqttjs.md) | Service de détection en TypeScript simple avec mqtt.js, sans framework | Acceptée |
| [0002](0002-mqtt-seul-bus-de-messages.md) | MQTT comme seul bus de messages (pas de Kafka) | Acceptée |
| [0003](0003-detection-chute-deux-niveaux.md) | Détection de chute répartie entre la montre et le système, seuil d'impact à 3,0 g | Acceptée |
| [0004](0004-sequence-de-relevement.md) | Séquence de relèvement en deux signaux plutôt qu'un déclencheur unique | Acceptée |
| [0005](0005-echelle-de-gravite.md) | Échelle de gravité à 4 niveaux et passage automatique au niveau 3 | Acceptée |
| [0006](0006-api-nestjs-prisma-journal.md) | API NestJS 11 + Prisma 5, journal des alertes et historique alimentés par les événements | Acceptée |
| [0007](0007-actions-application-via-ingestion.md) | Les actions de l'application passent par l'ingestion, comme des signaux | Acceptée |
| [0008](0008-service-de-notification.md) | Service de notification séparé, qui décide par rôle ; l'API remet aux personnes | Acceptée |
| [0009](0009-application-web-react-nginx.md) | Une application web React + Vite, servie par nginx sur la même origine que l'API | Acceptée |

## Modèle

```markdown
# NNNN. Titre

- Statut : proposée | acceptée | remplacée par NNNN
- Date : AAAA-MM-JJ

## Contexte
Le problème, les contraintes.

## Décision
Ce qui est retenu.

## Conséquences
Avantages, limites, risques introduits (à reporter dans la matrice des risques si significatifs).

## Alternatives envisagées
Ce qui a été écarté et pourquoi.
```
