-- 003_interacoes: estágio do contato e histórico de interações (bloco 12, docs/contrato-api.md seções 5 e 6).
-- Roda como `migrador` (dono). O migrate.js abre a transação.
--
-- Não precisa de GRANT: os privilégios padrão da 001 (ALTER DEFAULT PRIVILEGES IN SCHEMA orbita) já dão
-- SELECT/INSERT/UPDATE/DELETE ao api_contatos em toda tabela nova que o migrador criar aqui.

-- ============================================================================
-- Estágio do contato (funil simples da visão do produto)
-- ============================================================================
-- NOT NULL com DEFAULT: as linhas que já existem recebem 'lead' na hora do ALTER.
ALTER TABLE orbita.contatos
  ADD COLUMN estagio text NOT NULL DEFAULT 'lead'
  CHECK (estagio IN ('lead', 'proposta', 'cliente', 'perdido'));

-- Alvo da chave estrangeira COMPOSTA de interacoes. O id já é único sozinho; o par (id, tenant_id) só existe
-- para o banco poder garantir que a interação está no MESMO tenant do contato (defesa em profundidade:
-- mesmo que um dia o código erre, o banco recusa uma interação de A apontando para um contato de B).
ALTER TABLE orbita.contatos ADD CONSTRAINT contatos_id_tenant_unico UNIQUE (id, tenant_id);

-- "Saindo de órbita" (GET /contatos/esfriando): filtra e ordena por esta expressão dentro do tenant.
-- O índice de expressão deixa a consulta ler só o começo do índice, em vez de ordenar todos os contatos.
CREATE INDEX contatos_referencia ON orbita.contatos (tenant_id, (COALESCE(ultima_interacao_em, criado_em)), id);

-- ============================================================================
-- Interações
-- ============================================================================
CREATE TABLE orbita.interacoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid
              REFERENCES orbita.tenants (id) ON DELETE CASCADE,
  contato_id  uuid NOT NULL,
  -- SET NULL: excluir um usuário não apaga o histórico de conversas da empresa (igual a importacoes).
  usuario_id  uuid REFERENCES orbita.usuarios (id) ON DELETE SET NULL,
  tipo        text NOT NULL CHECK (tipo IN ('ligacao', 'whatsapp', 'email', 'reuniao', 'outro')),
  nota        text CHECK (char_length(nota) <= 2000),
  ocorrida_em timestamptz NOT NULL DEFAULT now(),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  -- CASCADE: excluir o contato apaga o histórico dele (contrato, DELETE /contatos/:id). Sem isso, o DELETE
  -- daria erro de chave estrangeira, que viraria 500.
  CONSTRAINT interacoes_contato_fk FOREIGN KEY (contato_id, tenant_id)
    REFERENCES orbita.contatos (id, tenant_id) ON DELETE CASCADE
);
-- GET /contatos/:id/interacoes: as do contato, da mais recente para a mais antiga.
CREATE INDEX interacoes_contato ON orbita.interacoes (tenant_id, contato_id, ocorrida_em DESC);

ALTER TABLE orbita.interacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE orbita.interacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON orbita.interacoes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
