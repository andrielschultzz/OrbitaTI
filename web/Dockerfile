# Portal Web do OrbitaTI. Duas etapas:
#   1. build: Node 22 gera os arquivos estáticos (dist/) com o Vite.
#   2. execução: só o nginx não-root com o dist/. Node, node_modules e o simulador ficam de fora.
# Uso: docker build -t orbitati/web:0.1.0 web
#      docker run --rm -p 8080:8080 -e API_UPSTREAM=host.docker.internal:3001 orbitati/web:0.1.0

FROM node:22-alpine AS build
WORKDIR /app
# Dependências primeiro: enquanto package*.json não mudar, o Docker reaproveita esta camada.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine
# Padrão do compose; no kind e na VM muda pela variável. Só API_* passa pelo envsubst.
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1: a imagem lê o DNS do /etc/resolv.conf; o 16-api-resolver.envsh o
# expõe como API_RESOLVER (que pode ser sobrescrita). Ver o comentário daquele arquivo.
ENV API_UPSTREAM=api-contatos:3000 \
    NGINX_ENVSUBST_FILTER=^API_ \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY --chmod=755 nginx/16-api-resolver.envsh /docker-entrypoint.d/16-api-resolver.envsh
COPY nginx/seguranca.conf /etc/nginx/seguranca.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
