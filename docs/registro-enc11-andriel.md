# Folha de Registro — Encontro de 15/10
**Arquitetura de Software SAAS · o CampoConta rodando**

- **Nome:** Andriel Schultz
- **Unidade de PI:** OrbitaTI

---

## Frente

### Abertura (2 min, sem consulta)

Microsserviço é uma parte do sistema que roda, é publicada e guarda os próprios dados de forma independente. Em multi-tenant, todo serviço passa a precisar saber de qual cliente é cada operação, e o banco precisa ter uma barreira própria para um cliente não ver o dado do outro.

### Os seis experimentos

| Experimento | Minha previsão | O que saiu | O nome disso |
|---|---|---|---|
| **1 — Seguir uma requisição** | Ela ganha um identificador na entrada que aparece no log de cada serviço | O mesmo identificador apareceu nos logs de todos os serviços, do início ao fim | Rastreamento distribuído (Correlation ID) |
| **2 — A Buricá tenta ver o dado da Alvorada** | Volta vazio, e quem bloqueia é o banco, não o código | A consulta voltou vazia, sem nenhum dado da Alvorada | Isolamento de tenant (RLS) |
| **3 — O relatório da diretoria** | Uma consulta pesada no mesmo banco deixa todo mundo lento | O relatório consumiu o banco e as operações normais ficaram mais lentas | Separação OLTP × OLAP (réplica de leitura / CQRS) |
| **4 — A cobrança sai do ar** | Quem depende da cobrança trava junto, se a chamada for direta | Com chamada direta o erro se espalhou; com fila o resto continuou funcionando | Falha em cascata / Circuit Breaker |
| **5 — O mesmo evento chega duas vezes** | Se ninguém conferir, o registro é duplicado | O segundo evento foi reconhecido como repetido e descartado | Idempotência (consumidor idempotente) |
| **6 — O vizinho barulhento** | Um cliente com carga alta deixa os outros lentos | A carga de um tenant aumentou o tempo de resposta dos outros | Vizinho barulhento / Rate limiting |

### No fim do encontro (2 min)

Microsserviço é uma unidade independente de negócio e de dados. Em multi-tenant, o `tenant_id` precisa acompanhar cada requisição e cada evento entre os serviços, o banco precisa isolar por conta própria (RLS), e cada tenant precisa de limite de uso — senão um cliente atrasa ou enxerga os outros. Também aprendi que serviço que depende de outro precisa continuar de pé quando o outro cai, e que evento repetido não pode gerar efeito repetido.

---

## Verso — OrbitaTI

O verso combinado da dupla está em [`servicos-rascunho.md`](servicos-rascunho.md).
