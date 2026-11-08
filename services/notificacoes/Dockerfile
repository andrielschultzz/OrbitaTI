# Imagem do Serviço de Notificações (orbitati/notificacoes).
#
# Mesmo desenho da API (services/api-contatos/Dockerfile): contexto na RAIZ do repositório, porque o
# package-lock.json dos workspaces fica lá e `npm ci` precisa dele (versões exatamente as testadas).
# O .dockerignore da raiz impede que .env, .git, node_modules, tests e web/ entrem no contexto.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Manifestos primeiro: enquanto as dependências não mudam, o Docker reaproveita esta camada.
COPY package.json package-lock.json ./
COPY services/notificacoes/package.json services/notificacoes/
# --workspace: só as dependências do worker (não as da API); --omit=dev: sem Vitest na imagem.
RUN npm ci --omit=dev --workspace @orbitati/notificacoes --no-audit --no-fund && npm cache clean --force

COPY services/notificacoes/src services/notificacoes/src

# Sem privilégio; o código é do root, então o processo não consegue alterá-lo.
USER node
WORKDIR /app/services/notificacoes
# Só o /saude interno (healthcheck). Nenhuma porta publicada no compose: ninguém de fora fala com o worker.
EXPOSE 3001
# node direto: o SIGTERM chega ao worker, que termina o job em andamento antes de sair.
CMD ["node", "src/worker.js"]
