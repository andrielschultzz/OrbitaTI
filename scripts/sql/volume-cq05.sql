-- Massa do ensaio do CQ-05 (bloco 11): o volume de 12 meses do ADR-001 (tabela "Volume"):
--   36 tenants Individual x 150 contatos + 9 Equipe x 1.200 = 16.200 contatos, 45 tenants.
-- Sem isso o ensaio restauraria ~50 linhas e o tempo medido não diria nada.
--
-- Roda como postgres (superusuário) direto no banco do compose, SÓ no ambiente local. Tudo leva o nome
-- "Ensaio CQ-05 NN" e o e-mail ensaio-cq05-NN@exemplo.test, e sai com limpar-volume-cq05.sql (cascade).
-- senha_hash inválido de propósito: ninguém entra nessas contas.
--
-- Casos de borda para o CSV do restaurar-um-tenant: 1 em cada 25 contatos sem e-mail (não volta pela
-- importação), e observações com ";", aspas, quebra de linha e acento.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO orbita.tenants (nome, plano)
SELECT format('Ensaio CQ-05 %s', lpad(i::text, 2, '0')), CASE WHEN i <= 36 THEN 'individual' ELSE 'equipe' END
FROM generate_series(1, 45) AS i;

INSERT INTO orbita.usuarios (tenant_id, nome, email, senha_hash, papel)
SELECT t.id, 'Admin ' || t.nome, format('ensaio-cq05-%s@exemplo.test', right(t.nome, 2)), 'sem-login', 'admin'
FROM orbita.tenants t WHERE t.nome LIKE 'Ensaio CQ-05 %';

INSERT INTO orbita.contatos (tenant_id, nome, email, telefone, empresa, observacao)
SELECT t.id,
       format('Contato %s de %s', n, right(t.nome, 2)),
       CASE WHEN n % 25 = 0 THEN NULL ELSE format('contato%s@cliente%s.exemplo.test', n, right(t.nome, 2)) END,
       format('(55) 9%s-%s', lpad((n % 10000)::text, 4, '0'), lpad(n::text, 4, '0')),
       format('Empresa %s Ltda.', n % 40),
       CASE WHEN n % 10 = 0 THEN E'Reunião; proposta "versão 2"\nretornar em março'
            ELSE repeat('Histórico de atendimento. ', 18) END
FROM orbita.tenants t
CROSS JOIN LATERAL generate_series(1, CASE WHEN t.plano = 'individual' THEN 150 ELSE 1200 END) AS n
WHERE t.nome LIKE 'Ensaio CQ-05 %';

INSERT INTO orbita.importacoes (tenant_id, status, total_linhas, total_lotes, linhas_invalidas, lotes_aplicados, concluida_em)
SELECT t.id, 'concluida', 100, 1, 0, 1, now()
FROM orbita.tenants t WHERE t.nome LIKE 'Ensaio CQ-05 %';

COMMIT;

SELECT count(*) AS tenants, sum(c) AS contatos
FROM (SELECT t.id, (SELECT count(*) FROM orbita.contatos c WHERE c.tenant_id = t.id) AS c
      FROM orbita.tenants t WHERE t.nome LIKE 'Ensaio CQ-05 %') x;
