# Bloco 11 — Ensaio de restauração (CQ-05) e sonda de disponibilidade (CQ-04)

Objetivo: executar e registrar o ensaio do CQ-05 e preparar a medição do CQ-04
(docs/atributos.md).

Faça:
1. scripts/backup.ps1: pg_dump em formato custom do banco orbitati (via docker compose
   exec), salvo em backups/ (pasta no .gitignore) com data e hora no nome.
2. scripts/ensaio-restauracao.ps1, cronometrando cada etapa:
   sobe um container postgres:16-alpine separado (postgres-ensaio), restaura o último
   backup, verifica integridade (contagem de linhas por tabela igual à origem; políticas
   presentes em pg_policies; FORCE ativo em todas as tabelas; papéis sem BYPASSRLS),
   e no fim remove o container.
3. scripts/restaurar-um-tenant.ps1 -Email <admin do tenant>: a partir da cópia restaurada,
   extrai só as linhas daquele tenant (contatos e importações) para CSV em backups/.
   É o procedimento que o ADR-001 prometeu documentar.
4. scripts/sonda.ps1 -Minutos 30: chama /saude a cada 60 s e grava data, status e
   latência num CSV; no fim imprime disponibilidade (%) e a pior latência.
5. docs/ensaios/cq05-<data>.md: tempos medidos por etapa, comparados ao RTO de 4 h, e a
   ressalva de que o RPO de 15 min depende de arquivamento contínuo de WAL, que é recurso do
   banco gerenciado em produção — o ensaio local prova o procedimento e o RTO, não o RPO.
6. docs/ensaios/cq04-<data>.md: como a disponibilidade é medida e o resultado de uma
   rodada de 30 min da sonda.

Pronto quando: os dois relatórios existem com números reais.
