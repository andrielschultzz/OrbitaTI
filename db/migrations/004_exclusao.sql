-- 004_exclusao: função que lista os tenants a excluir (bloco 14, LGPD: exclusão 30 dias após o cancelamento).
-- Roda como `migrador` (dono). O migrate.js abre a transação.
--
-- Por que uma função SECURITY DEFINER: o job diário precisa saber QUAIS tenants apagar antes de saber o
-- tenant (é a mesma situação do login). Sem tenant fixado, o RLS esconde todas as linhas de orbita.tenants.
-- A função roda como orbita_auth (BYPASSRLS) e devolve SÓ os ids: nem nome, nem plano, nem datas.
-- Depois, o job apaga cada tenant com withTenant(id), sob RLS, como qualquer outra escrita da API.
--
-- 30 dias = prazo da exportação (docs/lgpd.md). O token do link de exportação vence no mesmo instante
-- (cancelado_em + 30 dias), então nada é apagado enquanto o link ainda vale.
CREATE FUNCTION orbita.tenants_para_excluir()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = orbita, pg_temp
AS $$
  SELECT id FROM orbita.tenants
  WHERE cancelado_em IS NOT NULL
    AND cancelado_em < now() - interval '30 days'
$$;

-- A ORDEM IMPORTA (achado B6, T-RLS-19): REVOKE e GRANT enquanto o migrador ainda é o dono; só depois
-- passar a posse. O REVOKE de PUBLIC é redundante com o ALTER DEFAULT PRIVILEGES da 001, mas fica explícito.
-- EXECUTE só para api_contatos: é o papel que roda o job (src/exclusao.js). orbita_auth já tem SELECT em
-- orbita.tenants (001).
REVOKE ALL ON FUNCTION orbita.tenants_para_excluir() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION orbita.tenants_para_excluir() TO api_contatos;
ALTER FUNCTION orbita.tenants_para_excluir() OWNER TO orbita_auth;
