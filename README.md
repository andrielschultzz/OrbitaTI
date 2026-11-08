# OrbitaTI

CRM enxuto e multi-tenant para profissionais de TI autônomos e consultorias de até dez pessoas.

**Disciplina:** Arquitetura de Software SaaS (8512) — EC6, SETREM 2026-2
**Unidade:** Andriel Schultz e Cristofer

---

## O problema

Profissional de TI que pega trabalho por fora vive de indicação, mas o relacionamento que gera o próximo contrato não mora em lugar nenhum — está espalhado entre WhatsApp, e-mail e uma planilha desatualizada. O OrbitaTI existe para mostrar que é possível se organizar.

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
├── contrato-api.md              # contrato HTTP entre Portal e API
├── portal-pendencias.md         # o que falta no Portal (Fase 6) e para a VM
├── ensaios/                     # relatórios de ensaios (ex.: Lighthouse do Portal)
└── atividades/
    └── enc06-andriel.md         # atividade dirigida do Encontro 06
web/                             # Portal Web (SPA React + nginx), pacote independente
├── src/                         # telas, cliente HTTP, sessão, design system em código
├── simulador/                   # simulador do contrato (o Portal roda sem a API)
├── e2e/                         # E2E e capturas (Playwright)
├── nginx/                       # configuração do nginx (proxy /api, CSP, cache)
├── design-system/orbitati/      # MASTER.md: decisões visuais
└── Dockerfile                   # build Node 22 -> nginx não-root na porta 8080
```

## Portal Web

> **Estado em 07/11/2026:** o Portal está pronto e testado, mas roda contra o **simulador** do contrato
> (`web/simulador/`), não contra a API real, que ainda não existe. A integração com a API real (bloco 13,
> Fase 6) está pendente; ver [`docs/portal-pendencias.md`](docs/portal-pendencias.md).

Requisitos: Node.js 22 ou mais novo e Docker Desktop. Todos os comandos rodam dentro de `web/`:

```
cd web
npm install
npx playwright install chromium     # só na primeira vez, para os E2E
```

**1. Desenvolvimento, com o simulador** (recarrega ao salvar):

```
npm run dev:sim
```

Abra http://localhost:5173 e entre com `marcelo@devsolo.dev` (plano Individual) ou
`gestor@techconsult.com.br` (plano Equipe). Senha `Demo@2026` nas duas. Os dados vivem em memória e
voltam ao início quando o simulador reinicia. Para ver os erros: `SIM_FILA=fora` (importação com a fila
fora) ou `SIM_LIMITE_RPM=5` (rate limit estoura rápido).

**2. A imagem de produção (nginx), com o simulador.** Em dois terminais:

```
npm run simulador
```
```
docker build -t orbitati/web:0.1.0 .
docker run --rm -p 8080:8080 -e API_UPSTREAM=host.docker.internal:3001 orbitati/web:0.1.0
```

Abra http://localhost:8080. Conferências rápidas:

```
curl.exe -s http://localhost:8080/api/saude                                # passa pelo nginx
curl.exe -s -o NUL -w "%{http_code}" http://localhost:8080/api/interno/x   # 404: rota interna bloqueada
curl.exe -sI http://localhost:8080                                         # CSP e cabeçalhos de segurança
```

**3. Pelo Docker Compose:** ainda não. O serviço `web` entra no compose na Fase 6, junto com a API real.

**Testes do Portal** (com a imagem e o simulador do item 2 no ar):

```
npm test            # unitários (Vitest): cliente HTTP, sessão, mapa de órbita, tokens de tema, simulador
npm run test:e2e    # E2E (Playwright): fluxo, T-WEB-01 (nenhum "tenant"), sessão, isolamento, erros, nginx, acessibilidade
npm run capturas    # 8 telas x 4 larguras x 2 temas em web/e2e/capturas/
npm run lighthouse  # Lighthouse mobile em /entrar e /contatos, claro e escuro
```

A URL testada vem de `E2E_URL` (padrão `http://localhost:8080`). A mesma suíte roda contra a stack real
na Fase 6 (`$env:E2E_URL="http://localhost:8080"` no PowerShell). Último Lighthouse:
[`docs/ensaios/portal-lighthouse-2026-11-07.md`](docs/ensaios/portal-lighthouse-2026-11-07.md).

## Calendário do Projeto Integrador

| Etapa | Entrega | Prazo | Peso |
|---|---|---|---|
| **1** | Proposta de arquitetura | 27/09/2026, 23h59 | 20% |
| 2 | Núcleo multi-tenant — 2+ serviços, isolamento ao vivo | 15/10/2026 | 25% |
| 3 | Qualidade e testes | 12/11/2026 | 25% |
| 4 | Produto integrado + defesa | 03/12/2026 (defesa em 17/12) | 30% |
