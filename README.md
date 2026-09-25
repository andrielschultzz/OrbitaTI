# OrbitaTI

CRM enxuto e multi-tenant para profissionais de TI autônomos e consultorias de até dez pessoas.

**Disciplina:** Arquitetura de Software SaaS (8512) — EC7, SETREM 2026-2
**Unidade:** Andriel Schultz e Cristofer

---

## O problema

Profissional de TI que pega trabalho por fora vive de indicação, mas o relacionamento que gera o próximo contrato não mora em lugar nenhum — está espalhado entre WhatsApp, e-mail e uma planilha desatualizada. O OrbitaTI existe para mostrar quem está esfriando antes que se perca.

## Decisões de arquitetura em uma linha

| Decisão | Escolha | Número que a sustenta |
|---|---|---|
| Modelo de tenancy | **Pool** com Row-Level Security | Silo custaria R$ 120/mês por tenant contra ticket médio de R$ 89/mês |
| Identidade do tenant | Claim no **JWT assinado** | Zero parâmetros de tenant nas rotas — verificado por teste |
| Trabalho pesado | **Fila** com lote de 100 e quota | Protege busca de outros tenants em p95 < 800 ms |

## Etapa 1 — os cinco artefatos

| # | Artefato | Arquivo |
|---|---|---|
| 1.1 | Visão do produto, cliente fictício e personas | [`docs/01-visao-produto.md`](docs/01-visao-produto.md) |
| 1.2 | Diagramas C4 — níveis 1, 2 e esboço do 3 | [`docs/02-arquitetura-c4.md`](docs/02-arquitetura-c4.md) |
| 1.3 | ADRs | [`docs/adr/`](docs/adr/) — [001 tenancy](docs/adr/adr-001-tenancy.md) · [002 identidade](docs/adr/adr-002-identidade-tenant.md) · [003 assíncrono](docs/adr/adr-003-processamento-assincrono.md) |
| 1.4 | Atributos de qualidade — 5 cenários mensuráveis | [`docs/atributos.md`](docs/atributos.md) |
| 1.5 | Mapeamento LGPD preliminar | [`docs/lgpd.md`](docs/lgpd.md) |

## Números de referência do produto

Premissas declaradas em 12 meses, usadas em todos os artefatos:

| Premissa | Valor |
|---|---|
| Tenants | 45 (faixa de 30 a 50) |
| Mix | 36 Individual a R$ 49 + 9 Equipe a R$ 249 |
| Receita recorrente mensal | R$ 4.005 |
| Ticket médio | R$ 89/tenant/mês |
| Contatos acumulados | 16.200 |
| Volume de dados estruturados | ~111 MB |
| Custo de banco em pool | R$ 120/mês — 3% da receita |

## Estrutura do repositório

```
docs/
├── 01-visao-produto.md          # 1.1 — problema, cliente fictício, personas
├── 02-arquitetura-c4.md         # 1.2 — C4 níveis 1, 2 e esboço do 3
├── atributos.md                 # 1.4 — cenários CQ-01 a CQ-05
├── lgpd.md                      # 1.5 — inventário, papéis, medidas e riscos
├── adr/
│   ├── adr-001-tenancy.md       # pool x schema x silo, com a conta
│   ├── adr-002-identidade-tenant.md
│   └── adr-003-processamento-assincrono.md
└── atividades/
    └── enc06-andriel.md         # atividade dirigida do Encontro 06
```

## Calendário do Projeto Integrador

| Etapa | Entrega | Prazo | Peso |
|---|---|---|---|
| **1** | Proposta de arquitetura | 27/09/2026, 23h59 | 20% |
| 2 | Núcleo multi-tenant — 2+ serviços, isolamento ao vivo | 15/10/2026 | 25% |
| 3 | Qualidade e testes | 12/11/2026 | 25% |
| 4 | Produto integrado + defesa | 03/12/2026 (defesa em 17/12) | 30% |
