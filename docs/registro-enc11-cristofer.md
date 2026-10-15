# Folha de Registro — Encontro de 15/10
**Arquitetura de Software SAAS · o CampoConta rodando**

- **Nome:** _Cristofer Mateus Rutzen_  
- **Unidade de PI:** ___OrbitaTI__

---

## Frente da Folha

### Abertura (2 min, sem consulta)

* **O que é um microsserviço?**  
  É um componente autônomo, desacoplado e focado em um único domínio de negócio (*Bounded Context*), com ciclo de deploy independente e banco de dados próprio.

* **E o que muda nele quando o produto é multi-tenant?**  
  Todo o ciclo de vida da requisição e a persistência precisam de isolamento por cliente (*tenant*). As requisições exigem contexto de identificação (ex.: `tenant_id` via token/header) e o banco precisa garantir segregação lógica ou física para impedir vazamento de dados entre empresas.

---

### Os Seis Experimentos

| Experimento | Minha previsão (antes) | O que saiu (depois) | O nome disso |
| :--- | :--- | :--- | :--- |
| **1 — Seguir uma requisição** | A requisição recebe um ID único na entrada que é repassado a todos os serviços para podermos rastreá-la nos logs. | Logs correlacionados em diferentes serviços com o mesmo identificador de ponta a ponta. | **Rastreamento Distribuído (*Correlation ID* / Tracing)** |
| **2 — A Buricá tenta ver o dado da Alvorada** | A tentativa é bloqueada com erro 403 Forbidden ou lista vazia, impedindo acesso a dados alheios. | A consulta retornou lista vazia (`[]`) ou acesso não autorizado, isolando os dados de cada tenant. | **Isolamento de Tenant / Segregação de Dados (*Data Isolation* / RLS)** |
| **3 — O relatório da diretoria** | A consulta analítica pesada vai consumir recursos da base de dados e degradar as operações diárias dos usuários. | Queda de desempenho nas operações transacionais devido ao consumo excessivo de CPU/memória no banco compartilhado. | **Separação OLTP vs. OLAP (Réplica de Leitura / CQRS)** |
| **4 — A cobrança sai do ar** | O serviço que gera a venda/pedido falha ou fica travado aguardando resposta da cobrança. | Falha em cascata (se chamada síncrona direta) ou enfileiramento assíncrono mantendo o fluxo estável. | **Falha em Cascata (*Cascading Failure*) / Resiliência (*Circuit Breaker*)** |
| **5 — O mesmo evento chega duas vezes** | O sistema pode cobrar ou duplicar registros se não conferir se a mensagem já foi processada. | O segundo evento foi reconhecido como duplicado e descartado com segurança, sem duplicar o registro. | **Idempotência (*Idempotent Consumer*)** |
| **6 — O vizinho barulhento** | Uma empresa consumindo requisições em massa vai esgotar o pool de conexões e deixar o sistema lento para as demais. | A carga alta do tenant agressivo aumentou a latência e afetou os tempos de resposta dos outros clientes. | **Efeito do Vizinho Barulhento (*Noisy Neighbor*) / Rate Limiting** |

---

### No fim do encontro (2 min)

* **Releia a sua resposta de abertura e reescreva:**  
  Microsserviço é uma unidade independente de negócio e infraestrutura. No modelo multi-tenant, ele não opera de forma agnóstica: todo fluxo exige a identidade do inquilino (`tenant_id`), com isolamento rigoroso de dados (RLS, schema ou base dedicada), observabilidade contextualizada e proteção de recursos (rate limit por tenant) para evitar contaminação de segurança ou lentidão mútua entre clientes.

---

## Verso — O Seu Produto (Rascunho de Arquitetura)

> **Foto do desenho:** `docs/desenho-servicos.jpg` *(salve a foto do verso da folha na pasta docs/ com este nome)*

### 1. As Caixas (Diagrama de Serviços)

```text
  [ Cliente / Front-end ]
            │ (HTTP com JWT + tenant_id)
            ▼
    ┌───────────────┐
    │  API Gateway  │
    └───────┬───────┘
            │
            ├─────────────────────────────────────────┐
            │                                         │
            ▼                                         ▼
   ┌─────────────────┐                       ┌─────────────────┐
   │   Serviço 1     │   Assíncrono (Fila)   │   Serviço 2     │
   │  (ex: Pedidos)  ├──────────────────────►│ (ex: Cobrança)  │
   └────────┬────────┘  (Mensagem com        └────────┬────────┘
            │           tenant_id + payload)          │
            ▼                                         ▼
   ┌─────────────────┐                       ┌─────────────────┐
   │    Banco S1     │                       │    Banco S2     │
   │  (com RLS ou    │                       │  (com RLS ou    │
   │  tenant_id)     │                       │  tenant_id)     │
   └─────────────────┘                       └─────────────────┘
```

---

### 2. Quatro Respostas

* **a) Qual é o segundo serviço, e o que ele recebe do primeiro?**  
  É o Serviço de Cobrança/Processamento, e ele recebe do primeiro um evento contendo identificador da transação, valor e o `tenant_id`.

* **b) Onde o tenant é descoberto, e como chega ao segundo serviço?**  
  É descoberto no API Gateway a partir da validação do token JWT e repassado ao segundo serviço encapsulado nos metadados da mensagem na fila.

* **c) Se alguém esquecer o filtro no código, o que segura o vazamento?**  
  Políticas de *Row-Level Security* (RLS) configuradas diretamente no banco de dados (ou esquemas/bancos isolados por tenant).

* **d) Se o segundo serviço cair, o que o usuário ainda consegue fazer?**  
  O usuário continua navegando e emitindo solicitações normalmente no Serviço 1, pois as tarefas pendentes ficam armazenadas na fila até a recuperação do segundo serviço.
