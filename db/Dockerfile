# Imagem do job de migrações (orbitati/migrate). Não é serviço: roda, aplica as migrações e sai.
# Reaproveitada pelo compose, pelo CI (bloco 8) e pelo kind (bloco 6).
# Contexto do build: a pasta db/ (só ela). O package.json daqui não tem workspaces, então o npm ci
# não tropeça em services/, que nem existe dentro da imagem.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY migrate.js ./
COPY migrations ./migrations
USER node
CMD ["node", "migrate.js"]
