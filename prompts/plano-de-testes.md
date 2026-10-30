# Plano de testes do OrbitaTI (pedido do professor)

Objetivo: escrever docs/plano-de-testes.md, o plano de testes do OrbitaTI, antes de existir
código. Ele vira a especificação dos testes que os blocos 1 a 11 vão automatizar.
Não crie código nem altere outros arquivos.

Contexto: CLAUDE.md, docs/atributos.md (CQ-01 a CQ-05), os ADRs em docs/adr/,
docs/lgpd.md e docs/pendencias-bloco-7.md.

Faça:
1. Uma introdução curta: o que é testado, em que níveis (unitário, integração, carga,
   ensaio operacional) e com quais ferramentas (Vitest, k6, scripts PowerShell, CI).
2. Uma tabela de casos de teste com as colunas:
   ID | O que verifica | Origem (CQ, ADR ou regra do CLAUDE.md) | Pré-condição |
   Passos | Resultado esperado (com número quando houver) | Tipo | Ferramenta |
   Bloco em que é automatizado | Status (planejado)
   Cubra no mínimo:
   - isolamento no banco (RLS): as 12 situações da seção 5.2 do guia, incluindo conexão
     reaproveitada sem tenant, UPDATE em registro de outro tenant e o papel importacao_svc
     sem acesso ao schema orbita;
   - isolamento pela API (CQ-02): leitura, alteração e exclusão cruzadas -> 404; JWT
     adulterado -> 401; nenhuma rota com tenant_id;
   - autenticação: cadastro, login, e-mail repetido, senha errada sem revelar qual campo;
   - importação: CSV válido, linhas inválidas, limite por plano (100 / 5.000 e 1 MB),
     importações simultâneas, idempotência do lote, token de serviço;
   - resiliência: Importação fora, Redis fora (503 rápido, resto funcionando);
   - rate limit por tenant: um tenant estoura, o outro segue normal;
   - os cenários de qualidade CQ-01, CQ-03, CQ-04 e CQ-05 com a medida e o critério de
     aprovação de docs/atributos.md.
3. Uma matriz de rastreabilidade: cada CQ e cada ADR -> IDs dos testes que o cobrem.
   Aponte qualquer CQ ou regra sem teste.
4. Critério de pronto: quais testes precisam passar para cada etapa (2, 3 e 4).

Use IDs estáveis (T-RLS-01, T-ISO-01, T-AUTH-01, T-IMP-01, T-RES-01, T-RL-01, T-CQ01-01...),
porque os arquivos de teste vão citar esses IDs.

Pronto quando: docs/plano-de-testes.md existe, todos os CQs aparecem na matriz e nenhum
número foi inventado sem a conta que o justifica.
