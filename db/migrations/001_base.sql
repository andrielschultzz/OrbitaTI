-- 001_base: schemas, tabelas, RLS, permissões e a função de login.
-- Roda como `migrador` (dono), nunca como superusuário. O migrate.js abre a transação.
--
-- Regras do CLAUDE.md aplicadas aqui:
--   3. toda tabela com tenant_id: RLS ENABLE + FORCE e a política isolamento_tenant com NULLIF
--   4. tenant_id com DEFAULT vindo de app.tenant_id: o código nunca informa o tenant
--   6. papéis: api_contatos só em orbita, importacao_svc só em importacao, orbita_auth só na função
--
-- Por que NULLIF: numa conexão reaproveitada depois de um COMMIT, current_setting('app.tenant_id', true)
-- devolve '' (string vazia), e ''::uuid dá erro. NULLIF transforma '' em NULL, a comparação vira NULL e
-- a linha simplesmente não aparece. Sessão sem tenant vê 0 linhas, sem erro.

-- ============================================================================
-- Schemas
-- ============================================================================
CREATE SCHEMA orbita;      -- dados do produto (API)
CREATE SCHEMA importacao;  -- controle interno do worker; a API nunca lê este schema (regra 10)

-- ============================================================================
-- orbita
-- ============================================================================
CREATE TABLE orbita.tenants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  plano        text NOT NULL CHECK (plano IN ('individual', 'equipe')),
  criado_em    timestamptz NOT NULL DEFAULT now(),
  cancelado_em timestamptz
);

CREATE TABLE orbita.usuarios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid
             REFERENCES orbita.tenants (id) ON DELETE CASCADE,
  nome       text NOT NULL,
  email      text NOT NULL CHECK (email = lower(email)),
  senha_hash text NOT NULL,
  papel      text NOT NULL CHECK (papel IN ('admin', 'consultor', 'visualizador')),
  criado_em  timestamptz NOT NULL DEFAULT now()
);
-- Único na base INTEIRA, não por tenant: o login (buscar_credencial) acha o usuário só pelo e-mail,
-- antes de saber o tenant. Com dois iguais, não daria para saber de qual empresa ele é.
CREATE UNIQUE INDEX usuarios_email_unico ON orbita.usuarios (email);
CREATE INDEX usuarios_tenant ON orbita.usuarios (tenant_id);

CREATE TABLE orbita.contatos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid
                      REFERENCES orbita.tenants (id) ON DELETE CASCADE,
  nome                text NOT NULL,
  -- Opcional no cadastro manual (regra 9). NULL passa no CHECK e não conflita no UNIQUE (no PostgreSQL
  -- dois NULL são diferentes), então vários contatos sem e-mail convivem no mesmo tenant.
  email               text CHECK (email = lower(email)),
  telefone            text,
  empresa             text,
  observacao          text,
  ultima_interacao_em timestamptz,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  -- Chave do upsert da importação (regra 8): o mesmo e-mail pode existir em tenants diferentes.
  CONSTRAINT contatos_tenant_email_unico UNIQUE (tenant_id, email)
);

CREATE TABLE orbita.importacoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid
                   REFERENCES orbita.tenants (id) ON DELETE CASCADE,
  -- SET NULL: excluir um usuário não apaga o histórico de importações da empresa.
  usuario_id       uuid REFERENCES orbita.usuarios (id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'na_fila'
                   CHECK (status IN ('na_fila', 'processando', 'concluida', 'falhou')),
  total_linhas     integer NOT NULL CHECK (total_linhas >= 0),
  -- Nulos até o worker informar: a API só conta as linhas; quem valida e fatia em lotes é o worker
  -- (docs/contrato-api.md, seção 8).
  total_lotes      integer CHECK (total_lotes >= 0),
  linhas_invalidas integer CHECK (linhas_invalidas >= 0),
  lotes_aplicados  integer NOT NULL DEFAULT 0 CHECK (lotes_aplicados >= 0),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  concluida_em     timestamptz
);
-- O POST /importacoes conta as importações em andamento do tenant (limite do plano, contado no banco).
CREATE INDEX importacoes_em_andamento ON orbita.importacoes (tenant_id)
  WHERE status IN ('na_fila', 'processando');

CREATE TABLE orbita.lotes_aplicados (
  importacao_id uuid NOT NULL REFERENCES orbita.importacoes (id) ON DELETE CASCADE,
  numero        integer NOT NULL CHECK (numero >= 1),
  tenant_id     uuid NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid
                REFERENCES orbita.tenants (id) ON DELETE CASCADE,
  aplicado_em   timestamptz NOT NULL DEFAULT now(),
  -- Idempotência (regra 8): o mesmo lote reenviado pelo worker bate nesta chave e não é aplicado de novo.
  PRIMARY KEY (importacao_id, numero)
);

-- ============================================================================
-- importacao (worker)
-- Sem chave estrangeira para orbita: é a fronteira entre os dois serviços, e o importacao_svc não
-- enxerga orbita. Consequência: o ON DELETE CASCADE de orbita.tenants NÃO chega aqui; a exclusão de
-- tenant (bloco 14) precisa apagar estas tabelas também (docs/pendencias-bloco-7.md).
-- ============================================================================
CREATE TABLE importacao.execucoes (
  job_id        text NOT NULL,
  tenant_id     uuid NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid,
  importacao_id uuid NOT NULL,
  tentativa     integer NOT NULL CHECK (tentativa >= 1),
  status        text NOT NULL,
  iniciado_em   timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  PRIMARY KEY (job_id, tentativa)
);

CREATE TABLE importacao.erros_linha (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid,
  importacao_id uuid NOT NULL,
  linha         integer NOT NULL CHECK (linha >= 1),
  motivo        text NOT NULL
);
CREATE INDEX erros_linha_importacao ON importacao.erros_linha (tenant_id, importacao_id);

-- ============================================================================
-- RLS: ENABLE + FORCE em todas. FORCE vale até para o dono (migrador): sem tenant, ele também vê 0.
-- ============================================================================
ALTER TABLE orbita.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orbita.tenants FORCE ROW LEVEL SECURITY;
-- Em tenants a coluna comparada é o próprio id. No cadastro, a API gera o UUID, fixa app.tenant_id com
-- ele e só então insere o tenant e o primeiro usuário (o WITH CHECK exige isso).
CREATE POLICY isolamento_tenant ON orbita.tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE orbita.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE orbita.usuarios FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON orbita.usuarios
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE orbita.contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE orbita.contatos FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON orbita.contatos
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE orbita.importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE orbita.importacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON orbita.importacoes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE orbita.lotes_aplicados ENABLE ROW LEVEL SECURITY;
ALTER TABLE orbita.lotes_aplicados FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON orbita.lotes_aplicados
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE importacao.execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE importacao.execucoes FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON importacao.execucoes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE importacao.erros_linha ENABLE ROW LEVEL SECURITY;
ALTER TABLE importacao.erros_linha FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON importacao.erros_linha
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ============================================================================
-- Função de login: a ÚNICA exceção controlada ao RLS (regra 6)
-- ============================================================================
-- O login acontece antes de saber o tenant, e sem tenant o RLS esconde todos os usuários. A função roda
-- com os direitos do dono (SECURITY DEFINER), que é o orbita_auth (BYPASSRLS), e devolve só o necessário
-- para conferir a senha e montar o token. search_path fixo: ninguém consegue "trocar" a tabela usuarios
-- por outra criando objetos num schema que vem antes no caminho.
CREATE FUNCTION orbita.buscar_credencial(p_email text)
RETURNS TABLE (usuario_id uuid, tenant_id uuid, senha_hash text, papel text, plano text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = orbita, pg_temp
AS $$
  SELECT u.id, u.tenant_id, u.senha_hash, u.papel, t.plano
  FROM orbita.usuarios u
  JOIN orbita.tenants t ON t.id = u.tenant_id
  WHERE u.email = lower(p_email)
    AND t.cancelado_em IS NULL   -- empresa cancelada não entra (T-LGPD-02)
$$;

-- Toda função nova nasce com EXECUTE para PUBLIC. Esta, que ignora o RLS, só a API executa.
-- A ORDEM IMPORTA: REVOKE e GRANT enquanto o migrador ainda é o dono; só depois passar a posse (o ACL
-- vai junto para o novo dono). Feitos depois do OWNER TO, o migrador já não é dono e, com INHERIT FALSE,
-- não age como orbita_auth: o PostgreSQL só avisa ("no privileges could be revoked") e a função fica
-- aberta para todos. Foi o que o T-RLS-19 pegou na primeira execução.
REVOKE ALL ON FUNCTION orbita.buscar_credencial(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION orbita.buscar_credencial(text) TO api_contatos;
-- O orbita_auth precisa de CREATE no schema para poder ser dono de uma função nele.
GRANT USAGE, CREATE ON SCHEMA orbita TO orbita_auth;
GRANT SELECT ON orbita.usuarios, orbita.tenants TO orbita_auth;
ALTER FUNCTION orbita.buscar_credencial(text) OWNER TO orbita_auth;

-- ============================================================================
-- Permissões dos papéis de aplicação
-- ============================================================================
-- api_contatos: CRUD em orbita, nada em importacao (a API nunca lê o schema do worker, regra 10).
GRANT USAGE ON SCHEMA orbita TO api_contatos;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA orbita TO api_contatos;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA orbita TO api_contatos;

-- importacao_svc: CRUD em importacao e NENHUM privilégio em orbita (o worker grava contatos chamando a
-- API, regra 7). Sem USAGE no schema, qualquer acesso a orbita dá "permission denied for schema orbita".
GRANT USAGE ON SCHEMA importacao TO importacao_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA importacao TO importacao_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA importacao TO importacao_svc;

-- ============================================================================
-- Privilégios padrão para objetos FUTUROS criados pelo migrador (ex.: interacoes, bloco 12).
-- Sem isto, uma tabela nova nasceria sem acesso para a API, e uma função nova nasceria executável por todos.
-- ============================================================================
ALTER DEFAULT PRIVILEGES IN SCHEMA orbita
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_contatos;
ALTER DEFAULT PRIVILEGES IN SCHEMA orbita
  GRANT USAGE, SELECT ON SEQUENCES TO api_contatos;
ALTER DEFAULT PRIVILEGES IN SCHEMA importacao
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO importacao_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA importacao
  GRANT USAGE, SELECT ON SEQUENCES TO importacao_svc;
-- O EXECUTE de PUBLIC em funções é um padrão GLOBAL do PostgreSQL; só dá para tirá-lo sem IN SCHEMA.
-- Vale para toda função que o migrador criar daqui em diante, em qualquer schema (T-RLS-19).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
