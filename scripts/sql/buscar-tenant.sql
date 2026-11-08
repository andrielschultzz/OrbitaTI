-- restaurar-um-tenant.ps1: acha o tenant pelo e-mail do usuário (único na base inteira, 001_base.sql).
-- Roda como postgres na CÓPIA restaurada (nunca na produção). Variável: email.
-- Saída: tenant_id|plano|papel (vazio se o e-mail não existe).
\set ON_ERROR_STOP on
SELECT u.tenant_id || '|' || t.plano || '|' || u.papel
FROM orbita.usuarios u
JOIN orbita.tenants t ON t.id = u.tenant_id
WHERE u.email = lower(:'email');
