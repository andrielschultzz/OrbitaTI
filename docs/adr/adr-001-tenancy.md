# ADR-001 — Modelo de tenancy: pool com Row-Level Security

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-09-24 |
| **Decisores** | Andriel Schultz, Cristofer |
| **Rascunho original** | 27/08/2026, revisado com números em 24/09/2026 |
| **Substitui** | — |

---

## Contexto

O OrbitaTI é um CRM multi-tenant para profissionais de TI autônomos e consultorias de até dez pessoas. Precisamos decidir como os dados de cada tenant ficam separados: **pool** (todos nas mesmas tabelas, com coluna `tenant_id`), **schema-per-tenant** (um schema por cliente no mesmo banco) ou **silo** (um banco por cliente).

A decisão é estrutural. Ela define o custo por tenant, o tempo de onboarding, o esforço de cada deploy e o que significa, na prática, "os dados do cliente A não vazam para o cliente B". Trocar de modelo depois de ter clientes em produção é uma migração de dados com janela de indisponibilidade — por isso ela é decidida agora, na Etapa 1, e não descoberta na Etapa 2.

### Os números do OrbitaTI

Todas as premissas abaixo estão declaradas e vêm de [`../01-visao-produto.md`](../01-visao-produto.md). São elas, e não preferência técnica, que decidem a comparação.

| Premissa | Valor | De onde vem |
|---|---|---|
| Tenants em 12 meses | **45** | Faixa projetada de 30 a 50; 45 é o ponto de trabalho |
| Mix de planos | 36 Individual + 9 Equipe | Premissa comercial: 80% autônomos, 20% consultorias |
| Preço | R$ 49 e R$ 249/mês | Modelo comercial da visão do produto |
| **Receita recorrente mensal** | **R$ 4.005** | 36 × 49 + 9 × 249 |
| **Ticket médio por tenant** | **R$ 89/mês** | 4.005 ÷ 45 |
| Contatos acumulados em 12 meses | 16.200 | 36 × 150 + 9 × 1.200 |
| Interações | 81.000 | 5 por contato |
| **Volume de dados estruturados** | **~111 MB** | 16.200 × 2 KB + 81.000 × 1 KB |
| Anexos e PDFs | ~3 GB estimados | Fora do banco, em armazenamento de objetos |
| Maior tenant | 1.200 contatos = **7,4% da base** | Nenhum tenant domina o volume |
| Tenant que exige isolamento físico por contrato | **Nenhum** | Nenhuma persona atua em setor regulado que exija banco dedicado |
| Custo de instância PostgreSQL gerenciada | R$ 120/mês | 1 vCPU, 2 GB RAM, 20 GB — mercado brasileiro, 2026 |

O número que decide tudo está na penúltima linha combinada com a última: **a base inteira dos 45 tenants cabe em 111 MB**, e a menor instância gerenciada útil do mercado custa R$ 120/mês.

## Opções consideradas

### Comparação por custo de infraestrutura

| Modelo | Instâncias | Custo/mês | % da receita de R$ 4.005 | Margem bruta |
|---|---|---|---|---|
| **Pool** | 1 | **R$ 120** | **3,0%** | **97,0%** |
| **Schema-per-tenant** | 1 | R$ 120 | 3,0% | 97,0% |
| **Silo** (instância de R$ 120) | 45 | R$ 5.400 | **134,8%** | **−34,8%** |
| **Silo** (menor tier concebível, R$ 40) | 45 | R$ 1.800 | 44,9% | 55,1% |

O silo não perde por pouco: **ele custa mais do que o produto fatura**. A R$ 120 por instância, a infraestrutura consome 135% da receita — o produto dá prejuízo antes de pagar qualquer outra coisa. Mesmo no cenário mais otimista imaginável, com instâncias compartilhadas de R$ 40, o custo por tenant fica em R$ 40 contra um ticket médio de R$ 89: **45% da receita indo só para o banco**, num produto cujo plano de entrada custa R$ 49/mês. O tenant Individual sozinho geraria prejuízo de R$ 9 por mês.

Em pool, o custo de banco por tenant é de **R$ 2,67/mês** — 3% do ticket.

### Comparação por esforço de operação

| Critério | Pool | Schema-per-tenant | Silo |
|---|---|---|---|
| **Migrações por deploy** | 1 execução, ~8 s | 45 execuções, ~6 min | 45 execuções + 45 janelas coordenadas |
| A 200 tenants | 8 s | ~27 min | inviável sem automação dedicada |
| A 500 tenants | 8 s | ~67 min | inviável |
| **Onboarding** | INSERT, ~2 min ponta a ponta | CREATE SCHEMA + migrações, 5 a 8 min, exige ferramenta | provisionar instância, 20 a 40 min, custo imediato |
| **Self-service puro** | Sim | Sim, com ferramenta de provisionamento | Não — cada tenant novo custa dinheiro no ato |
| **Backup e restore** | 1 rotina | 1 rotina, restore seletivo mais trabalhoso | 45 rotinas |
| **Consulta agregada entre tenants** (métricas de produto) | query direta | UNION entre 45 schemas | 45 conexões e consolidação externa |

O item das migrações é o que envelhece pior. Com schema-per-tenant, a janela de deploy cresce linearmente com o número de clientes: a cada novo tenant vendido, o time paga 8 segundos a mais em toda publicação. Aos 200 tenants — dentro do horizonte de crescimento do produto — são 27 minutos de janela por deploy, o que na prática desestimula publicar com frequência. É um custo que pune exatamente o sucesso comercial.

### Comparação por isolamento

| Critério | Pool | Schema-per-tenant | Silo |
|---|---|---|---|
| Barreira contra vazamento | Política de RLS no banco | Separação de schema + `search_path` | Separação física |
| Depende do código da aplicação? | Não, se o RLS estiver ativo | Parcialmente — um `search_path` errado cruza schemas | Não |
| Testável automaticamente | Sim, suíte por rota | Sim | Sim, trivialmente |
| Vizinho barulhento | Real — mitigado por fila e quota | Real — mesmo banco, mesmos recursos | Inexistente |
| Atende cliente que exige banco dedicado | Não | Não | Sim |

O silo é, de fato, superior em isolamento. A pergunta não é se ele isola melhor — é **se alguém está pagando por isso**. Nenhuma das personas atua em setor que exija banco dedicado por contrato ou norma. O isolamento extra do silo seria um custo de R$ 5.400/mês para atender uma exigência que nenhum cliente fez.

Quanto ao vizinho barulhento: ele é real no pool, e nós o tratamos por desenho de produto — fila, lote e quota, registrados em [`adr-003-processamento-assincrono.md`](adr-003-processamento-assincrono.md) e medidos no cenário CQ-01 de [`../atributos.md`](../atributos.md). Resolver vizinho barulhento comprando 45 bancos é usar arquitetura de infraestrutura para um problema de desenho.

## Decisão

**Adotamos pool: todos os tenants nas mesmas tabelas, separados pela coluna `tenant_id`, com Row-Level Security ativo em toda tabela que contenha dado de tenant.**

A decisão se apoia em três números:

1. **A base inteira cabe em 111 MB.** Provisionar 45 instâncias para um volume que cabe folgado na menor instância do mercado é pagar 45 vezes por capacidade ociosa.
2. **O silo custa R$ 120/mês por tenant contra um ticket médio de R$ 89/mês.** Não é uma decisão cara — é uma decisão que torna o produto inviável. Nenhum ajuste de preço salva um plano de entrada de R$ 49/mês pagando R$ 40 de banco.
3. **Nenhum cliente exige isolamento físico.** O isolamento extra não tem comprador.

Entre pool e schema-per-tenant, que empatam em custo, decidimos por pool porque o schema cobra um pedágio crescente em toda publicação — 6 minutos aos 45 tenants, 27 aos 200 — sem entregar isolamento que o RLS já não entregue. O schema-per-tenant seria a escolha se tivéssemos poucos tenants muito grandes; temos o oposto: muitos tenants pequenos, sendo o maior 7,4% da base.

### Como o isolamento é implementado

Três camadas, detalhadas em [`../02-arquitetura-c4.md`](../02-arquitetura-c4.md):

```sql
-- 1. Toda tabela com dado de tenant carrega a coluna e a política
ALTER TABLE contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contatos FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolamento ON contatos
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- 2. A camada de acesso a dados abre toda transação fixando o tenant
BEGIN;
SET LOCAL app.tenant_id = '...';  -- vem do JWT, nunca do cliente
SELECT * FROM contatos;            -- devolve só o tenant da sessão
COMMIT;
```

O `FORCE ROW LEVEL SECURITY` é deliberado: sem ele, o dono da tabela ignora a política. Com ele, nem a conta da aplicação escapa.

O `SET LOCAL` — e não `SET` — também é deliberado: o valor morre no fim da transação e não vaza para a próxima requisição que reutilizar a mesma conexão do pool.

## Consequências

### Positivas

O custo de banco por tenant cai para R$ 2,67/mês e a margem bruta fica em 97%, o que sustenta um plano de entrada de R$ 49/mês. O onboarding vira um INSERT e roda em self-service puro, sem humano no caminho — condição necessária para o cenário CQ-03. A janela de deploy fica constante em 8 segundos independentemente de quantos clientes existam, e métricas de produto que cruzam tenants saem de uma query só.

### Negativas

**Toda query depende do `tenant_id` estar fixado na sessão.** Um endpoint novo que abra conexão por fora da camada de acesso a dados roda sem tenant definido. O RLS faz a coisa certa nesse caso — não devolve nenhuma linha — mas o sintoma é uma tela vazia, não um erro claro, o que torna o bug chato de diagnosticar. *Mitigação:* ponto único de acesso ao banco, teste automatizado de isolamento em toda rota (CQ-02), e revisão obrigatória de qualquer PR que abra conexão.

**O vizinho barulhento é real.** Tenants disputam CPU, memória e conexões do mesmo PostgreSQL. *Mitigação:* fila com lote e quota ([`adr-003`](adr-003-processamento-assincrono.md)), medida pelo cenário CQ-01.

**Não conseguimos atender cliente que exija banco dedicado por contrato.** Se aparecer no funil, a resposta é "não" — e a alternativa é o mesmo modelo com criptografia e retenção diferenciadas, não um silo. Abrir exceção para um cliente cria um segundo produto para manter. *Revisão:* se a demanda por isolamento físico aparecer em 3 ou mais oportunidades qualificadas, este ADR volta à mesa.

**Restaurar o backup de um tenant só é mais trabalhoso** do que em silo: exige restaurar uma cópia e extrair as linhas daquele `tenant_id`, em vez de simplesmente devolver um banco. *Mitigação:* procedimento documentado e ensaiado antes da Etapa 3.

## Gatilhos de revisão

Este ADR é revisto se qualquer um ocorrer:

| Gatilho | Por quê |
|---|---|
| Um tenant passar de 25% do volume total | O pool deixa de ser homogêneo e o vizinho barulhento vira crônico |
| 3+ oportunidades qualificadas exigirem isolamento físico | O isolamento passa a ter comprador e entra na conta |
| A base passar de 50 GB ou 500 tenants | Reavaliar particionamento por `tenant_id` ou schema para os maiores |
| Um incidente de vazamento entre tenants | Falha na premissa central; reabre a comparação inteira |

## Referências

- Visão do produto e personas: [`../01-visao-produto.md`](../01-visao-produto.md)
- Diagramas e camadas de isolamento: [`../02-arquitetura-c4.md`](../02-arquitetura-c4.md)
- Cenários CQ-01, CQ-02 e CQ-03: [`../atributos.md`](../atributos.md)
- ERL, Thomas; MAHMOOD, Zaigham; PUTTINI, Ricardo. *Cloud Computing: concepts, technology & architecture*. Upper Saddle River: Prentice Hall, 2013.
- PostgreSQL Global Development Group. *Row Security Policies*. Documentação oficial do PostgreSQL 16.
