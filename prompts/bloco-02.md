# Bloco 2 — API de Contatos

Objetivo: implementar o serviço services/api-contatos (porta de entrada do OrbitaTI).

Contexto: CLAUDE.md; docs/adr/adr-002-identidade-tenant.md; o banco do bloco anterior.

Faça:
1. services/api-contatos com package.json (fastify 5, @fastify/jwt, pg, @node-rs/argon2),
   src/app.js exportando buildApp(opcoes) (para os testes), src/server.js, Dockerfile
   (node:22-alpine, usuário não-root) e serviço "api-contatos" no compose (porta 3000,
   depende do migrate concluído, healthcheck em /saude).
2. src/db.js: Pool com DATABASE_URL_API e withTenant(pool, tenantId, fn) exatamente como no
   CLAUDE.md (BEGIN, set_config com is_local true, COMMIT/ROLLBACK, release).
3. Plugin de autenticação: valida JWT (JWT_SEGREDO, expira em 15 min) e expõe
   request.user = { sub, tenant_id, plano, papel }. Rotas públicas: /auth/*, /saude.
4. POST /auth/cadastro {empresa, plano, nome, email, senha}: gera o UUID do tenant, abre
   withTenant com ele, insere tenant e usuário admin (Argon2id), devolve 201 {token}.
   E-mail repetido -> 409. Valide o corpo com JSON Schema do Fastify.
5. POST /auth/login {email, senha}: usa orbita.buscar_credencial; senha errada ou e-mail
   inexistente -> 401 com a mesma mensagem (não revele qual dos dois errou).
6. Contatos: GET /contatos?busca= (nome, e-mail ou empresa, ILIKE, ordenado por nome,
   limite 100), POST /contatos, GET/PATCH/DELETE /contatos/:id. Tudo via withTenant.
   Registro de outro tenant ou inexistente -> 404. Em PATCH e DELETE confira rowCount.
   E-mail sempre em minúsculas; e-mail repetido no mesmo tenant -> 409.
7. GET /saude -> { db: "ok" | "fora" } (a parte da fila entra no bloco 4).
8. Testes em tests/: auth.test.js (cadastro, login, senha errada, e-mail repetido,
   rota protegida sem token -> 401) e contatos.test.js (CRUD completo de um tenant).
   Os testes usam a API rodando no compose (http://localhost:3000) e criam tenants
   com e-mails únicos por execução.

Não faça: nenhuma rota recebe tenant_id (nem em params, query ou corpo). Nada de
pool.query direto em tabela de tenant. Sem importação, sem rate limit (blocos seguintes).

Pronto quando (mostre a saída real):
- docker compose up -d --build --wait
- curl.exe -s http://localhost:3000/saude  ->  {"db":"ok"}
- npm test  com rls, auth e contatos passando
