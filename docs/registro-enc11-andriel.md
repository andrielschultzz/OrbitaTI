# Folha de registro — Encontro de 15/10
**Arquitetura de Software SAAS · o CampoConta rodando**

- **Nome:** Andriel Schultz
- **Unidade de PI:** OrbitaTI

---

## Frente

### Abertura (2 min, sem consulta)

**O que é um microsserviço? E o que muda nele quando o produto é multi-tenant?**

Microsserviço é uma parte do sistema que roda, é publicada e guarda os próprios dados de forma independente. Em multi-tenant, todo serviço precisa saber de qual cliente é cada operação, e o banco precisa impedir que um cliente veja o dado do outro.

### Os seis experimentos

| Experimento | Minha previsão | O que saiu | O nome disso |
|---|---|---|---|
| 1 — Seguir uma requisição | Ela ganha um identificador na entrada que aparece no log de cada serviço | O mesmo identificador apareceu nos logs de todos os serviços | Rastreamento distribuído (Correlation ID) |
| 2 — A Buricá tenta ver o dado da Alvorada | Volta vazio, porque o banco bloqueia | A consulta voltou vazia | Isolamento de tenant (RLS) |
| 3 — O relatório da diretoria | Uma consulta pesada deixa o banco lento para todos | As operações normais ficaram mais lentas durante o relatório | Separação OLTP × OLAP (réplica de leitura / CQRS) |
| 4 — A cobrança sai do ar | Quem chama a cobrança trava junto | O erro se espalhou para quem dependia da cobrança | Falha em cascata / Circuit Breaker |
| 5 — O mesmo evento chega duas vezes | O registro é duplicado se ninguém conferir | O segundo evento foi reconhecido e descartado | Idempotência |
| 6 — O vizinho barulhento | Um cliente com carga alta deixa os outros lentos | O tempo de resposta dos outros tenants aumentou | Vizinho barulhento / Rate limiting |

### No fim do encontro (2 min)

**Releia a sua resposta de abertura e reescreva:**

Microsserviço é uma unidade independente de negócio e de dados. Em multi-tenant, o `tenant_id` acompanha cada requisição e cada mensagem entre serviços, o banco isola os dados por conta própria e cada tenant precisa de limite de uso. E um serviço precisa continuar de pé quando o outro cai.

---

## Verso — OrbitaTI

### 1. As caixas

**Foto do desenho:** `docs/desenho-servicos.jpg`

```text
        [ Navegador ]
              │  HTTPS + JWT
              ▼
   ┌──────────────────────┐         Fila (Redis)         ┌──────────────────────┐
   │   API de Contatos    │ ───────────────────────────► │ Serviço de Importação│
   │  (porta de entrada)  │   tenant_id + arquivo_id     │                      │
   │                      │ ◄─────────────────────────── │                      │
   └──────────┬───────────┘   grava contatos em lote     └──────────┬───────────┘
              │                                                     │
              ▼                                                     ▼
   ┌──────────────────────┐                              ┌──────────────────────┐
   │  PostgreSQL          │                              │  PostgreSQL          │
   │  schema orbita (RLS) │                              │  schema importacao   │
   │  contatos, usuários  │                              │  jobs, progresso     │
   └──────────────────────┘                              └──────────────────────┘
```

### 2. Quatro respostas

**a) Qual é o segundo serviço, e o que ele recebe do primeiro?**
O Serviço de Importação; recebe da API de Contatos um evento na fila com `tenant_id` e o arquivo CSV a importar.

**b) Onde o tenant é descoberto, e como chega ao segundo serviço?**
Na API de Contatos, a partir do JWT; chega ao segundo serviço dentro da mensagem na fila.

**c) Se alguém esquecer o filtro no código, o que segura o vazamento?**
O Row-Level Security (RLS) do PostgreSQL.

**d) Se o segundo serviço cair, o que o usuário ainda consegue fazer?**
Tudo menos importar contatos em massa; as importações ficam na fila até ele voltar.
