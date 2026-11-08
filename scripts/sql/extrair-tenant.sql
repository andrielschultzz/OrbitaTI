-- restaurar-um-tenant.ps1: extrai as linhas de UM tenant da cópia restaurada para CSV.
-- Variável: tenant (uuid). Os arquivos saem em /tmp/extracao/ dentro do contêiner do ensaio.
--
-- Duas barreiras, de propósito:
--   1. SET LOCAL ROLE api_contatos + app.tenant_id: o RLS só deixa ver o tenant pedido (a mesma política
--      da produção). Um erro no WHERE não vaza outro tenant.
--   2. WHERE tenant_id = :'tenant': deixa a intenção explícita e não depende só do RLS.
-- A última consulta prova a barreira 1: sem WHERE, a sessão enxerga 0 contatos de outros tenants.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE api_contatos;
SELECT set_config('app.tenant_id', :'tenant', true) \g /dev/null

-- Formato do modelo de importação (web/public/modelo-contatos.csv): separador ";", estas 5 colunas.
-- Célula vazia = NULL (o COPY grava NULL como vazio sem aspas), e na reimportação célula vazia não apaga
-- dado que já exista (contrato, seção 7).
COPY (SELECT nome, email, telefone, empresa, observacao
      FROM orbita.contatos WHERE tenant_id = :'tenant' AND email IS NOT NULL ORDER BY email)
  TO STDOUT WITH (FORMAT csv, HEADER, DELIMITER ';') \g /tmp/extracao/contatos-reimportar.csv

-- Sem e-mail: a importação recusa (o e-mail é a chave do upsert, regra 9). Ficam à parte, para recadastro manual.
COPY (SELECT nome, email, telefone, empresa, observacao
      FROM orbita.contatos WHERE tenant_id = :'tenant' AND email IS NULL ORDER BY nome)
  TO STDOUT WITH (FORMAT csv, HEADER, DELIMITER ';') \g /tmp/extracao/contatos-sem-email.csv

COPY (SELECT id, status, total_linhas, total_lotes, linhas_invalidas, lotes_aplicados, criado_em, concluida_em
      FROM orbita.importacoes WHERE tenant_id = :'tenant' ORDER BY criado_em)
  TO STDOUT WITH (FORMAT csv, HEADER, DELIMITER ';') \g /tmp/extracao/importacoes.csv

SELECT 'contatos_com_email|' || count(*) FROM orbita.contatos WHERE tenant_id = :'tenant' AND email IS NOT NULL;
SELECT 'contatos_sem_email|' || count(*) FROM orbita.contatos WHERE tenant_id = :'tenant' AND email IS NULL;
SELECT 'importacoes|' || count(*) FROM orbita.importacoes WHERE tenant_id = :'tenant';
SELECT 'visiveis_de_outros_tenants|' || count(*) FROM orbita.contatos WHERE tenant_id <> :'tenant';
COMMIT;
