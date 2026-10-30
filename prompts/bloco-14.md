# Bloco 14 — LGPD: exportação, cancelamento e exclusão em 30 dias

Objetivo: implementar as medidas de LGPD planejadas em docs/lgpd.md (ciclo de vida do
tenant: cancelar -> 30 dias de exportação -> exclusão).

Faça:
1. GET /conta/exportacao (somente papel admin): JSON com tenant, usuários (sem senha_hash),
   contatos, interações e importações do próprio tenant. Header Content-Disposition para
   download.
2. POST /conta/cancelamento (somente admin): grava tenants.cancelado_em. A partir daí o
   login é recusado (a função buscar_credencial já filtra cancelados) — mas durante 30 dias
   a exportação continua disponível por um link assinado enviado por e-mail.
3. Exclusão: migração com a função orbita.tenants_para_excluir() SECURITY DEFINER, dona
   orbita_auth, que devolve SÓ os ids cancelados há mais de 30 dias. Um job agendado no
   BullMQ (diário) pega esses ids e, para cada um, usa withTenant(id) para apagar as linhas
   do próprio tenant em todas as tabelas, inclusive o tenant. Sem BYPASSRLS em lugar
   nenhum além da função.
4. Testes: a exportação de A não contém nada de B; após cancelar, login -> 401;
   o job de exclusão apaga só tenants cancelados há mais de 30 dias (simule a data) e
   não toca nos ativos.
5. Atualize a tabela "A implementar" de docs/lgpd.md marcando o que foi feito e onde.
6. A exportação é uma rota nova com dado de tenant: entra na suíte de isolamento.

Pronto quando: npm test passa e docs/lgpd.md reflete o estado real.
