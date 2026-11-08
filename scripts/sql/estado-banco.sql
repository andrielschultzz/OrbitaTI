-- Foto do banco para o ensaio de restauração (CQ-05, bloco 11). Roda IGUAL na origem (backup.ps1) e
-- na cópia restaurada (ensaio-restauracao.ps1); os scripts comparam as duas fotos linha a linha.
--
-- TEM DE RODAR COMO SUPERUSUÁRIO (postgres). Qualquer outro papel está sujeito ao RLS (o migrador também,
-- por causa do FORCE) e enxergaria 0 linhas em todas as tabelas de tenant: origem 0 = cópia 0, e a
-- comparação passaria por acaso. A primeira linha (superusuario) existe para o script conferir isso.
--
-- Saída (psql -At): uma linha por item, "secao|chave|valor". Tudo ordenado, para a comparação ser texto.
-- Só ASCII na SAÍDA (os comentários não saem): o PowerShell 5.1 lê a saída do docker na página de código do console.

-- Quem está rodando a foto. O script recusa a foto se não for superusuário.
SELECT 'superusuario|' || current_user || '|' || rolsuper::text
FROM pg_roles WHERE rolname = current_user;

-- Linhas por tabela (orbita, importacao e public.schema_migrations). query_to_xml roda um count(*) por
-- tabela sem precisar de função nem de bloco DO.
SELECT 'contagem|' || n.nspname || '.' || c.relname || '|' ||
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('orbita', 'importacao', 'public')
ORDER BY 1;

-- RLS de cada tabela: enable e force.
SELECT 'rls|' || n.nspname || '.' || c.relname || '|enable=' || c.relrowsecurity::text || ',force=' || c.relforcerowsecurity::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('orbita', 'importacao')
ORDER BY 1;

-- Tabelas com coluna tenant_id: cada uma precisa de RLS com ENABLE + FORCE e pelo menos 1 política
-- (regra 3). O script exige "ok" em todas, além de comparar com a origem.
SELECT 'tabela_tenant|' || n.nspname || '.' || c.relname || '|' ||
       CASE WHEN c.relrowsecurity AND c.relforcerowsecurity
             AND EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname)
            THEN 'ok' ELSE 'FALHA' END
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('orbita', 'importacao')
ORDER BY 1;

-- Políticas, com o texto das expressões (prova que o NULLIF voltou igual).
SELECT 'politica|' || schemaname || '.' || tablename || '.' || policyname || '|' ||
       cmd || ' ' || array_to_string(roles, ',') || ' USING ' || coalesce(qual, '-') || ' CHECK ' || coalesce(with_check, '-')
FROM pg_policies
WHERE schemaname IN ('orbita', 'importacao')
ORDER BY 1;

-- Papéis do OrbitaTI (regra 6). O script exige: nenhum de aplicação com BYPASSRLS ou SUPERUSER;
-- orbita_auth com BYPASSRLS e NOLOGIN.
SELECT 'papel|' || rolname || '|login=' || rolcanlogin::text || ',bypassrls=' || rolbypassrls::text || ',superuser=' || rolsuper::text
FROM pg_roles
WHERE rolname IN ('migrador', 'api_contatos', 'importacao_svc', 'orbita_auth')
ORDER BY 1;

-- Donos dos objetos: se o restore não achasse os papéis, os OWNER TO falhariam ou cairiam no postgres.
SELECT 'dono|' || n.nspname || '.' || c.relname || '|' || pg_get_userbyid(c.relowner)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('orbita', 'importacao')
ORDER BY 1;

-- Função de login: dono orbita_auth, SECURITY DEFINER e ACL sem PUBLIC (T-RLS-19).
SELECT 'funcao_login|orbita.buscar_credencial|dono=' || pg_get_userbyid(p.proowner) ||
       ',security_definer=' || p.prosecdef::text || ',acl=' || coalesce(p.proacl::text, '-')
FROM pg_proc p
WHERE p.oid = 'orbita.buscar_credencial(text)'::regprocedure;

-- GRANTs nas tabelas (prova que os GRANT voltaram e que o importacao_svc continua sem nada em orbita).
SELECT 'grant|' || table_schema || '.' || table_name || '.' || grantee || '|' ||
       string_agg(privilege_type, ',' ORDER BY privilege_type)
FROM information_schema.role_table_grants
WHERE table_schema IN ('orbita', 'importacao')
  AND grantee IN ('migrador', 'api_contatos', 'importacao_svc', 'orbita_auth', 'PUBLIC')
GROUP BY table_schema, table_name, grantee
ORDER BY 1;
