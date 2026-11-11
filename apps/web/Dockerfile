# Web — build a partir da raiz do monorepo:
#   docker build -f apps/web/Dockerfile -t transitum-web .
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY packages/shared packages/shared
COPY apps/web apps/web
# VITE_DEMO=1 mostra a caixa de credenciais demo na página de login
ARG VITE_DEMO=0
ARG VITE_DEMO_EMAIL=demo@transitum.local
ARG VITE_DEMO_PASSWORD=Demo12345!
ENV VITE_DEMO=$VITE_DEMO VITE_DEMO_EMAIL=$VITE_DEMO_EMAIL VITE_DEMO_PASSWORD=$VITE_DEMO_PASSWORD
RUN npm run build -w @transitum/web

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
