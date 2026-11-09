# Service de notification. Contexte de build : racine du dépôt (le service dépend de packages/shared-types).
#   docker compose build notification

# --- Étape 1 : installation du monorepo et regroupement du service en un seul fichier JavaScript ---
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN npm ci --workspace @project/notification --no-audit --no-fund \
 && npm run build --workspace @project/notification

# --- Étape 2 : image d'exécution, sans node_modules (tout est dans dist/main.js) ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/services/notification/dist/main.js ./main.js
USER node
CMD ["node", "main.js"]
