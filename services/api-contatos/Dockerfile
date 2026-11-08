# Imagem da API de Contatos (orbitati/api-contatos).
#
# Contexto do build: a RAIZ do repositório (docker-compose.yml: context ".", dockerfile este arquivo).
# Motivo: com npm workspaces, o package-lock.json fica só na raiz, e sem lockfile não dá para usar
# `npm ci` (instalação reproduzível, exatamente as versões testadas). O .dockerignore da raiz impede que
# .env, .git, node_modules e web/ entrem no contexto.
#
# @node-rs/argon2 usa binário nativo: o lockfile traz o pacote linux-x64-musl, que é o do Alpine.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Primeiro só os manifestos: enquanto as dependências não mudam, o Docker reaproveita esta camada e o
# rebuild depois de mexer no código leva segundos.
COPY package.json package-lock.json ./
COPY services/api-contatos/package.json services/api-contatos/
# --workspace: instala só as dependências da API (não as do worker); --omit=dev: sem Vitest na imagem.
RUN npm ci --omit=dev --workspace @orbitati/api-contatos --no-audit --no-fund && npm cache clean --force

COPY services/api-contatos/src services/api-contatos/src

# Usuário sem privilégio (já existe na imagem node). Os arquivos são do root: o processo não consegue
# alterar o próprio código, mesmo se comprometido.
USER node
WORKDIR /app/services/api-contatos
EXPOSE 3000
# node direto (não `npm start`): o SIGTERM chega ao processo da API, que fecha conexões com calma.
CMD ["node", "src/server.js"]
