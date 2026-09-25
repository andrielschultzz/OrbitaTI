# 1.2 — Arquitetura C4: OrbitaTI

**Unidade:** Andriel Schultz e Cristofer
**Etapa 1 — Proposta de arquitetura**

Este documento apresenta os níveis 1 e 2 completos e um esboço do nível 3. O modelo de tenancy que fundamenta os limites desenhados aqui está em [`adr/adr-001-tenancy.md`](adr/adr-001-tenancy.md).

---

## Onde está o limite de tenant

Antes dos diagramas, a regra que eles materializam.

O OrbitaTI adota **pool**: todos os tenants compartilham as mesmas tabelas, separados pela coluna `tenant_id`. Isso significa que o limite de tenant **não é físico** — não há um banco por cliente, nem um container por cliente. O limite é lógico e é aplicado em três camadas sobrepostas, de fora para dentro:

| Camada | Onde vive | O que faz | O que acontece se falhar |
|---|---|---|---|
| **1. Token** | API REST — middleware de autenticação | Extrai o `tenant_id` do JWT assinado e o injeta no contexto da requisição. O cliente nunca envia `tenant_id` como parâmetro | Requisição rejeitada com 401 antes de tocar em qualquer dado |
| **2. Sessão de banco** | API REST — camada de acesso a dados | Executa `SET LOCAL app.tenant_id` na transação, a partir do contexto | A query roda sem tenant definido e a política de RLS não devolve nenhuma linha |
| **3. Row-Level Security** | PostgreSQL | Política `USING (tenant_id = current_setting('app.tenant_id')::uuid)` em toda tabela com dado de tenant | Nada passa. É a rede de segurança: mesmo um `SELECT * FROM contatos` sem `WHERE` só enxerga o tenant da sessão |

A camada 3 existe porque as camadas 1 e 2 dependem de o desenvolvedor não errar. O RLS é a única que não depende — e por isso é ela, e não a disciplina do time, que sustenta a promessa de isolamento no cenário CQ-02 de [`atributos.md`](atributos.md).

Nos diagramas abaixo, o limite de tenant aparece anotado em cada travessia relevante.

---

## Nível 1 — Contexto

Quem usa o OrbitaTI e com que sistemas ele conversa.

```mermaid
flowchart TB
    subgraph tenant["TENANT — ex.: TechConsult Solutions"]
        admin["<b>Administrador do tenant</b><br/>Sócio ou gestor<br/>Gerencia usuários, plano<br/>e configurações"]
        user["<b>Usuário do tenant</b><br/>Profissional de TI<br/>Cadastra contatos, registra<br/>interações, gera propostas"]
    end

    orbita["<b>OrbitaTI</b><br/><i>[Sistema SaaS multi-tenant]</i><br/>CRM enxuto para profissionais<br/>de TI autônomos e pequenas<br/>consultorias"]

    contato["<b>Contato comercial</b><br/>Cliente ou lead do tenant<br/><i>Não é usuário do sistema</i><br/>Recebe propostas por e-mail"]

    email["<b>Provedor de e-mail transacional</b><br/><i>[Sistema externo]</i><br/>Entrega confirmações de cadastro,<br/>alertas e propostas"]

    externo["<b>Sistema do tenant</b><br/><i>[Sistema externo]</i><br/>ERP ou faturamento próprio<br/>do tenant, integrado via webhook"]

    admin -->|"Configura o tenant<br/>HTTPS"| orbita
    user -->|"Usa o CRM<br/>HTTPS"| orbita
    orbita -->|"Envia mensagens<br/>SMTP/API"| email
    email -->|"Entrega e-mail"| contato
    orbita -->|"Notifica eventos<br/>HTTPS POST, plano Equipe"| externo

    classDef pessoa fill:#0b4f6c,stroke:#08313f,color:#fff
    classDef sistema fill:#1c7c54,stroke:#0f4a31,color:#fff
    classDef externo fill:#6b7280,stroke:#374151,color:#fff
    classDef fora fill:#9ca3af,stroke:#4b5563,color:#fff,stroke-dasharray: 5 3

    class admin,user pessoa
    class orbita sistema
    class email,externo externo
    class contato fora
```

**Leitura do diagrama.** O ator cinza tracejado — o Contato comercial — é o detalhe que define o produto: ele é o titular do dado mais importante do sistema e **não tem conta**. Nunca aceitou termo de uso, não faz login, muitas vezes não sabe que está cadastrado. É essa assimetria que coloca o OrbitaTI como operador e o tenant como controlador no mapeamento de [`lgpd.md`](lgpd.md).

O webhook para o sistema do tenant é o degrau 3 da escada de customização: o tenant integra o que quiser sem que o OrbitaTI ganhe código específico para ele.

---

## Nível 2 — Containers

O que roda dentro do OrbitaTI.

```mermaid
flowchart TB
    user["<b>Usuário do tenant</b><br/>Profissional de TI"]

    subgraph sistema["OrbitaTI — fronteira do sistema"]
        portal["<b>Portal Web</b><br/><i>[SPA — React]</i><br/>Interface única do produto.<br/>Guarda o JWT, nunca envia<br/>tenant_id como parâmetro"]

        api["<b>API REST</b><br/><i>[Node.js + Fastify]</i><br/>Regras de negócio, autenticação,<br/>quotas e feature flags.<br/><b>Resolve o tenant_id do JWT</b>"]

        fila["<b>Fila de Trabalhos</b><br/><i>[Redis + BullMQ]</i><br/>Enfileira trabalho pesado<br/>com prioridade e limite<br/>por tenant"]

        wimport["<b>Worker de Importação</b><br/><i>[Node.js]</i><br/>Processa CSV em lotes de 100.<br/>Aplica a quota do CQ-01"]

        wdoc["<b>Gerador de Documentos</b><br/><i>[Node.js + Puppeteer]</i><br/>Renderiza propostas em PDF<br/>a partir do template do tenant"]

        notif["<b>Serviço de Notificações</b><br/><i>[Node.js]</i><br/>Monta e despacha e-mails:<br/>confirmação, alerta de contato<br/>frio, entrega de proposta"]

        db[("<b>Banco de Dados</b><br/><i>[PostgreSQL 16]</i><br/><b>POOL</b> — tabelas compartilhadas<br/>com coluna tenant_id<br/><b>RLS ativo em toda tabela</b>")]

        blob[("<b>Armazenamento de Arquivos</b><br/><i>[S3 compatível]</i><br/>PDFs e anexos, em prefixo<br/>por tenant: /{tenant_id}/...")]
    end

    email["<b>Provedor de e-mail</b><br/><i>[Sistema externo]</i>"]
    externo["<b>Sistema do tenant</b><br/><i>[Sistema externo]</i>"]

    user -->|"HTTPS"| portal
    portal -->|"JSON/HTTPS<br/><b>Bearer JWT com tenant_id</b>"| api

    api -->|"SQL<br/><b>SET LOCAL app.tenant_id</b><br/>antes de cada transação"| db
    api -->|"Enfileira job<br/>com tenant_id no payload"| fila
    api -->|"Lê e grava<br/>prefixo do tenant"| blob

    fila -->|"Consome"| wimport
    fila -->|"Consome"| wdoc
    fila -->|"Consome"| notif

    wimport -->|"SQL em lotes<br/><b>SET LOCAL app.tenant_id</b>"| db
    wdoc -->|"SQL leitura<br/><b>SET LOCAL app.tenant_id</b>"| db
    wdoc -->|"Grava PDF"| blob
    notif -->|"SQL leitura<br/><b>SET LOCAL app.tenant_id</b>"| db
    notif -->|"SMTP/API"| email
    api -->|"HTTPS POST<br/>plano Equipe"| externo

    classDef pessoa fill:#0b4f6c,stroke:#08313f,color:#fff
    classDef container fill:#1c7c54,stroke:#0f4a31,color:#fff
    classDef dados fill:#7c5295,stroke:#4a2f59,color:#fff
    classDef externo fill:#6b7280,stroke:#374151,color:#fff

    class user pessoa
    class portal,api,fila,wimport,wdoc,notif container
    class db,blob dados
    class email,externo externo
```

### Containers em detalhe

| Container | Tecnologia | Responsabilidade | Como respeita o limite de tenant |
|---|---|---|---|
| **Portal Web** | React, SPA | Única interface do produto; responsiva, pensada para uso em celular | Guarda o JWT; **nunca** envia `tenant_id` como parâmetro — se enviasse, bastaria trocar o valor para ler outro tenant |
| **API REST** | Node.js + Fastify | Regras de negócio, autenticação, autorização, quotas e avaliação de feature flags | Middleware extrai o `tenant_id` do JWT assinado e o fixa no contexto; a camada de dados abre toda transação com `SET LOCAL app.tenant_id` |
| **Fila de Trabalhos** | Redis + BullMQ | Tira trabalho pesado do caminho da requisição; aplica prioridade e limite de jobs simultâneos por tenant | O `tenant_id` viaja no payload do job e é reaplicado pelo worker antes de qualquer query |
| **Worker de Importação** | Node.js | Processa CSV em lotes de 100 linhas com pausa entre lotes | Executa a quota do cenário CQ-01: é o container que impede o vizinho barulhento |
| **Gerador de Documentos** | Node.js + Puppeteer | Renderiza proposta em PDF a partir do template configurado pelo tenant | Lê o template do próprio tenant; grava no prefixo `/{tenant_id}/` do armazenamento |
| **Serviço de Notificações** | Node.js | Monta e despacha e-mails transacionais | Só enxerga destinatários do tenant do job |
| **Banco de Dados** | PostgreSQL 16 | Guarda contatos, oportunidades, interações, usuários e configuração | **Pool com RLS** — a política de linha é a última barreira e não depende do código da aplicação |
| **Armazenamento** | S3 compatível | PDFs gerados e anexos | Chaves prefixadas por `tenant_id`; política de acesso nega leitura fora do prefixo |

### Por que fila e worker já na Etapa 1

A fila não é sofisticação prematura — ela é a resposta arquitetural ao vizinho barulhento. Com pool, a importação de 500 contatos da TechConsult roda no mesmo banco que atende a busca do Marcelo. Se essa importação acontecesse dentro da requisição HTTP, ela seguraria uma conexão e um lote grande de escritas pelo tempo que levasse, degradando todo mundo.

Tirando o trabalho pesado do caminho da requisição e fatiando em lotes de 100 com pausa, o pico de um tenant vira uma sequência de rajadas curtas em vez de um bloqueio longo. É essa decisão que torna o cenário CQ-01 cumprível — e é por isso que ela está em [`adr/adr-003-processamento-assincrono.md`](adr/adr-003-processamento-assincrono.md), não enterrada no código.

---

## Nível 3 — Esboço: dentro da API REST

Detalhamento do container onde mora a decisão de tenancy. Os demais containers ficam para a Etapa 2.

```mermaid
flowchart TB
    portal["<b>Portal Web</b><br/><i>[SPA]</i>"]

    subgraph apirest["API REST — componentes"]
        authmw["<b>Middleware de Autenticação</b><br/><i>[componente]</i><br/>Valida assinatura do JWT,<br/>rejeita expirado ou inválido"]

        tenantmw["<b>Resolvedor de Tenant</b><br/><i>[componente]</i><br/><b>Extrai tenant_id do JWT</b><br/>e fixa no contexto da requisição.<br/>Ponto único de decisão"]

        quota["<b>Guarda de Quotas</b><br/><i>[componente]</i><br/>Consulta limites do plano.<br/>Recusa com 429 ao estourar"]

        flags["<b>Avaliador de Feature Flags</b><br/><i>[componente]</i><br/>Liga capacidade por plano<br/>ou por tenant"]

        ctrContato["<b>Controlador de Contatos</b><br/><i>[componente]</i><br/>CRUD, busca e importação<br/>da entidade central"]

        ctrOport["<b>Controlador de Oportunidades</b><br/><i>[componente]</i><br/>Funil, mudança de estágio,<br/>dispara evento de proposta"]

        ctrConfig["<b>Controlador de Configuração</b><br/><i>[componente]</i><br/>Campos personalizados, categorias,<br/>usuários, template de proposta"]

        repo["<b>Camada de Acesso a Dados</b><br/><i>[componente]</i><br/><b>Abre transação com</b><br/><b>SET LOCAL app.tenant_id</b><br/>Nenhuma query passa por fora"]
    end

    db[("<b>PostgreSQL</b><br/>Pool + RLS")]
    fila["<b>Fila de Trabalhos</b>"]

    portal -->|"HTTPS + Bearer"| authmw
    authmw -->|"Token válido"| tenantmw
    tenantmw -->|"Contexto com tenant_id"| quota
    quota -->|"Dentro do limite"| flags
    flags --> ctrContato
    flags --> ctrOport
    flags --> ctrConfig

    ctrContato --> repo
    ctrOport --> repo
    ctrConfig --> repo
    ctrContato -->|"Importação em massa"| fila
    ctrOport -->|"Evento de proposta"| fila

    repo -->|"SQL na sessão<br/>com tenant fixado"| db

    classDef comp fill:#1c7c54,stroke:#0f4a31,color:#fff
    classDef crit fill:#b45309,stroke:#78350f,color:#fff
    classDef dados fill:#7c5295,stroke:#4a2f59,color:#fff
    classDef ext fill:#6b7280,stroke:#374151,color:#fff

    class authmw,quota,flags,ctrContato,ctrOport,ctrConfig comp
    class tenantmw,repo crit
    class db dados
    class portal,fila ext
```

Os dois componentes em laranja são os que sustentam o isolamento. O **Resolvedor de Tenant** é o ponto único onde se decide de quem é a requisição; o **Camada de Acesso a Dados** é o ponto único por onde o banco é tocado. Concentrar essas duas responsabilidades em um lugar cada é o que torna o isolamento testável — a suíte do cenário CQ-02 mira exatamente esses dois pontos.

---

## Decisões registradas

| Decisão | ADR |
|---|---|
| Pool com RLS em vez de silo ou schema-per-tenant | [`adr/adr-001-tenancy.md`](adr/adr-001-tenancy.md) |
| `tenant_id` dentro do JWT, nunca em parâmetro | [`adr/adr-002-identidade-tenant.md`](adr/adr-002-identidade-tenant.md) |
| Trabalho pesado em fila com lote e quota | [`adr/adr-003-processamento-assincrono.md`](adr/adr-003-processamento-assincrono.md) |

---

*Documento versionado em `docs/02-arquitetura-c4.md`. Diagramas em Mermaid, renderizados nativamente pelo GitHub.*
