# Bloco 1 — Infraestrutura local e o banco com RLS

Objetivo: montar a infraestrutura local e o banco do OrbitaTI com isolamento por RLS,
provado por testes. Ainda não há código de serviço.

Contexto: CLAUDE.md (regras de multi-tenancy 2 a 6) e docs/adr/adr-001-tenancy.md.

Faça:
1. package.json na raiz com npm workspaces ("services/*"), "type": "module", Node >= 22,
   Vitest como devDependency e o script "test": "vitest run".
2. .env.example com: POSTGRES_PASSWORD, DB_SENHA_MIGRADOR, DB_SENHA_API, DB_SENHA_IMPORTACAO,
   DATABASE_URL_MIGRADOR, DATABASE_URL_API, DATABASE_URL_IMPORTACAO, REDIS_URL, JWT_SEGREDO,
   JWT_SERVICO_SEGREDO, API_URL_INTERNA. Banco "orbitati", host "postgres".
   Crie também o .env local a partir dele (ele é ignorado pelo git).
3. docker-compose.yml com postgres:16-alpine (POSTGRES_DB=orbitati, healthcheck com
   pg_isready, volume nomeado) e redis:7-alpine (healthcheck redis-cli ping).
   Publique a porta 5432 só em 127.0.0.1 para os testes.
4. db/init/01-papeis.sh, executado pelo entrypoint do Postgres no primeiro boot, criando:
   - migrador (LOGIN, senha DB_SENHA_MIGRADOR, CREATE no database orbitati)
   - orbita_auth (NOLOGIN, BYPASSRLS); GRANT orbita_auth TO migrador
   - api_contatos (LOGIN, NOBYPASSRLS) e importacao_svc (LOGIN, NOBYPASSRLS)
   O arquivo precisa ter fim de linha LF (há .gitattributes para isso).
5. db/migrations/001_base.sql, rodando como migrador (não superusuário), com:
   schemas orbita e importacao; as tabelas da seção abaixo; RLS ENABLE + FORCE em todas;
   política isolamento_tenant com NULLIF(current_setting('app.tenant_id', true), '')::uuid
   em USING e WITH CHECK (em orbita.tenants a coluna comparada é id);
   tenant_id com DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
   e-mails com CHECK (email = lower(email)); índice único global em usuarios(email);
   UNIQUE (tenant_id, email) em contatos;
   GRANT USAGE, CREATE ON SCHEMA orbita TO orbita_auth; SELECT em usuarios e tenants para orbita_auth;
   função orbita.buscar_credencial(p_email text) SECURITY DEFINER, STABLE,
   SET search_path = orbita, pg_temp, devolvendo usuario_id, tenant_id, senha_hash, papel, plano
   de usuários de tenants não cancelados; OWNER TO orbita_auth; REVOKE de PUBLIC; EXECUTE só para api_contatos;
   api_contatos: USAGE em orbita e CRUD nas tabelas de orbita, nada em importacao;
   importacao_svc: USAGE e CRUD em importacao, NENHUM privilégio em orbita.
   Tabelas:
   orbita.tenants(id uuid pk, nome, plano check individual|equipe, criado_em, cancelado_em)
   orbita.usuarios(id, tenant_id fk, nome, email, senha_hash, papel check admin|consultor|visualizador, criado_em)
   orbita.contatos(id, tenant_id fk, nome not null, email, telefone, empresa, observacao,
                   ultima_interacao_em, criado_em, atualizado_em)
   orbita.importacoes(id, tenant_id, usuario_id, status check na_fila|processando|concluida|falhou,
                      total_linhas, total_lotes (nulo até o worker informar), linhas_invalidas,
                      lotes_aplicados default 0, criado_em, concluida_em)
   (por que total_lotes nasce nulo e existe linhas_invalidas: docs/contrato-api.md, seção 8)
   orbita.lotes_aplicados(importacao_id fk, numero, tenant_id, aplicado_em; pk (importacao_id, numero))
   importacao.execucoes(job_id text, tenant_id, importacao_id, tentativa, status, iniciado_em, finalizado_em)
   importacao.erros_linha(id bigserial, tenant_id, importacao_id, linha, motivo)
6. db/migrate.js: aplica em ordem os .sql ainda não aplicados, registrando em
   public.schema_migrations, cada arquivo numa transação. Idempotente.
7. Serviço "migrate" no compose (one-shot, depende do postgres saudável) rodando db/migrate.js.
8. tests/rls.test.js conectando direto no Postgres com cada papel e provando:
   tenant A sem WHERE só vê A; sessão sem tenant vê 0; conexão reaproveitada após COMMIT vê 0
   (sem erro de uuid); inserir com tenant_id de outro falha por RLS; UPDATE no registro de
   outro afeta 0 linhas; importacao_svc recebe permission denied em orbita; o dono
   (migrador) sem tenant vê 0; buscar_credencial acha o usuário sem tenant fixado;
   api_contatos lendo usuarios sem tenant vê 0; upsert do mesmo lote não duplica;
   e-mail repetido entre tenants falha por unicidade.
   Os testes rodam no host (Windows), então conectam em 127.0.0.1:5432 — não reutilize as
   URLs do .env que usam o host "postgres"; monte a conexão com as senhas do .env.

Não faça: código de serviço, rotas, Dockerfile de serviços. Não use BYPASSRLS em papel de
aplicação. Não rode docker compose down -v sem me perguntar.

Pronto quando (mostre a saída real):
- docker compose up -d --wait  (postgres e redis healthy)
- docker compose run --rm migrate  duas vezes seguidas, a segunda sem aplicar nada
- npm test  com todos os testes de tests/rls.test.js passando
