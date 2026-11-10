# Application web (React + Vite), servie par nginx. Contexte de build : racine du dépôt (dépend de packages/shared-types).
#   docker compose build web

# --- Étape 1 : installation et construction des fichiers statiques ---
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN npm ci --workspace @project/web --workspace @project/shared-types --no-audit --no-fund \
 && npm run build --workspace @project/web

# --- Étape 2 : nginx sert les fichiers et relaie /api et /socket.io vers l'API ---
FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
