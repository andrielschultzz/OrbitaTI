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
4. scripts/sonda.ps1 -Minutos 60 -IntervaloSegundos 15 (esses são os padrões): chama /saude
   a cada 15 s por 60 min e grava data, status e latência num CSV; no fim imprime o número de
   amostras, as falhas, a disponibilidade (%) e a pior latência.
   Conta (decisão 7 de prompts/decisoes-plano-de-testes.md):
   - 60 min × 60 s ÷ 15 s = 240 amostras, e cada amostra pesa 1 ÷ 240 = 0,42%.
   - Para 1 falha pesar no máximo 0,5%, são precisas 1 ÷ 0,005 = 200 amostras; 240 passa disso.
   - 0 falhas = 100%; 1 falha = 99,58% (aprova); 2 falhas = 99,17% (reprova). Critério: ≥ 99,5%.
   - A versão anterior (30 min a cada 60 s = 30 amostras) não servia: 1 falha já dava 96,7%.
   - "Falha" = status diferente de 200 ou sem resposta em 2 s.
5. docs/ensaios/cq05-<data>.md: tempos medidos por etapa, comparados ao RTO de 4 h, e a
   ressalva de que o RPO de 15 min depende de arquivamento contínuo de WAL, que é recurso do
   banco gerenciado em produção — o ensaio local prova o procedimento e o RTO, não o RPO
   (decisão 8: limitação declarada).
6. docs/ensaios/cq04-<data>.md: como a disponibilidade é medida, a conta do item 4 e o
   resultado de uma rodada de 60 min da sonda (240 amostras). O relatório declara que o ensaio
   prova o MÉTODO, e não os 99,5% do mês:
   - 60 min não representam o mês comercial (12 h × 22 dias = 264 h; 0,5% disso = 79 min).
   - 0 falhas em 240 não provam 99,5%: pela "regra de três", o limite superior da taxa de falha
     com 95% de confiança é 3 ÷ 240 = 1,25%. Provar 99,5% com 0 falhas exigiria 600 amostras.
   - A medida real é a sonda rodando o mês em produção (docs/plano-de-testes.md, L2).

Pronto quando: os dois relatórios existem com números reais.
