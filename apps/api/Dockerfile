# API — build a partir da raiz do monorepo:
#   docker build -f apps/api/Dockerfile -t blujay-api .
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Manifests primeiro (cache de dependências)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev

COPY packages/shared packages/shared
COPY apps/api apps/api

EXPOSE 3001
# Migrações e seed de planos correm automaticamente no arranque
CMD ["npm", "run", "start", "-w", "@blujay/api"]
