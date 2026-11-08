#!/bin/sh
# Papéis do Postgres do OrbitaTI (regra 6 do CLAUDE.md).
#
# Roda UMA vez, pelo entrypoint da imagem postgres, quando o volume está vazio (primeiro boot).
# Por isso trocar uma senha no .env depois não muda nada aqui: o papel continua com a senha antiga até
# recriar o volume (ver README). Este arquivo precisa de fim de linha LF (.gitattributes: *.sh eol=lf).
#
# As senhas entram como variáveis do psql (:'senha'): o psql as cita com segurança, nunca são coladas
# no texto do SQL.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v senha_migrador="$DB_SENHA_MIGRADOR" \
  -v senha_api="$DB_SENHA_API" \
  -v senha_importacao="$DB_SENHA_IMPORTACAO" <<'SQL'

-- migrador: dono dos schemas e tabelas. Só roda migrações; nenhum serviço usa este papel.
CREATE ROLE migrador LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'senha_migrador';
GRANT CREATE ON DATABASE orbitati TO migrador;
-- Desde o PostgreSQL 15, só o dono cria objetos no schema public. O migrate.js grava o controle das
-- migrações em public.schema_migrations, então o migrador precisa desta permissão.
GRANT USAGE, CREATE ON SCHEMA public TO migrador;

-- orbita_auth: único papel com BYPASSRLS. NOLOGIN: ninguém se conecta com ele. Existe só para ser
-- dono da função orbita.buscar_credencial (login antes de saber o tenant).
CREATE ROLE orbita_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;

-- O migrador precisa poder passar a função para o orbita_auth (ALTER FUNCTION ... OWNER TO), e o
-- PostgreSQL 16 exige que ele consiga fazer SET ROLE orbita_auth para isso.
--   INHERIT FALSE: o migrador não herda os privilégios de OBJETO do orbita_auth (ex.: o SELECT em
--   usuarios). Já o BYPASSRLS é atributo de papel e NUNCA é herdado por pertencimento, com ou sem INHERIT.
--   Risco aceito: com SET ROLE orbita_auth, o migrador passa a agir como orbita_auth, e aí sim ignora o
--   RLS. Isso não dá para tirar sem tirar o grant. Mitigação: a senha do migrador só existe no job de
--   migração, nunca em serviço.
GRANT orbita_auth TO migrador WITH INHERIT FALSE;

-- Papéis de aplicação: sempre sujeitos ao RLS.
CREATE ROLE api_contatos LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'senha_api';
CREATE ROLE importacao_svc LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'senha_importacao';
SQL

echo "OrbitaTI: papéis migrador, orbita_auth, api_contatos e importacao_svc criados."
