# API (NestJS + Prisma). Contexte de build : racine du dépôt (dépend de packages/shared-types).
#   docker compose build api-gateway

# --- Étape 1 : installation, compilation, client Prisma, puis retrait des dépendances de développement ---
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /repo
COPY . .
RUN npm ci --workspace @project/api-gateway --workspace @project/shared-types --no-audit --no-fund \
 && npm run build --workspace @project/shared-types \
 && cd apps/api-gateway && npx prisma generate && npx nest build \
 && cd /repo && npm prune --omit=dev --workspace @project/api-gateway --workspace @project/shared-types --no-audit --no-fund

# --- Étape 2 : image d'exécution ---
FROM node:22-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/packages/shared-types/schemas packages/shared-types/schemas
COPY --from=build /repo/apps/api-gateway/package.json apps/api-gateway/
COPY --from=build /repo/apps/api-gateway/prisma apps/api-gateway/prisma
COPY --from=build /repo/apps/api-gateway/dist apps/api-gateway/dist
WORKDIR /repo/apps/api-gateway
USER node
EXPOSE 3000
# Au démarrage : migrations, données de démonstration (idempotent), puis l'API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/main.js"]
