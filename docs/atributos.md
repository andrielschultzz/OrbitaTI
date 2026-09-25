# 1.4 — Atributos de Qualidade: cenários mensuráveis

**Unidade:** Andriel Schultz e Cristofer
**Etapa 1 — Proposta de arquitetura**

Cinco cenários no formato estímulo → resposta. Cada número traz a conta que o produziu; nenhum foi arbitrado. As personas e volumes citados vêm de [`01-visao-produto.md`](01-visao-produto.md).

| ID | Atributo | Resumo | Medida |
|---|---|---|---|
| [CQ-01](#cq-01) | Desempenho | Importação de um tenant não degrada os outros | p95 < 800 ms |
| [CQ-02](#cq-02) | Segurança | Nenhum dado atravessa a fronteira de tenant | 100% das tentativas bloqueadas |
| [CQ-03](#cq-03) | Usabilidade | Onboarding self-service sem humano no caminho | p90 < 45 s |
| [CQ-04](#cq-04) | Disponibilidade | Portal no ar em horário comercial | 99,5% — 79 min/mês |
| [CQ-05](#cq-05) | Recuperabilidade | Perda e tempo de retomada após falha | RPO 15 min, RTO 4 h |

---

<a id="cq-01"></a>
## CQ-01 — Desempenho sob vizinho barulhento

> **Durante uma importação em massa de contatos por um tenant grande — 500 ou mais registros enfileirados no Worker de Importação —, as operações de busca e listagem de contatos dos demais tenants respondem em menos de 800 ms no percentil 95, medidas no servidor, sem nenhuma requisição acima de 2 s.**

| Elemento | Valor |
|---|---|
| Fonte do estímulo | Tenant grande — TechConsult Solutions, 6 usuários, 1.200 contatos |
| Estímulo | Job de importação de 500+ registros via CSV |
| Artefato | Worker de Importação e Banco de Dados PostgreSQL |
| Ambiente | Operação normal, horário comercial, demais tenants ativos |
| Resposta | Buscas e listagens dos outros tenants seguem respondendo |
| **Medida** | **p95 < 800 ms; p100 < 2 s; zero erros 5xx** |

### De onde vem o 800 ms

O alvo não é um número redondo escolhido por conforto — é o que sobra depois de descontar o que não controlamos.

| Componente | Valor | Origem |
|---|---|---|
| Limiar de fluxo de pensamento ininterrupto | 1.000 ms | Limite clássico de usabilidade acima do qual o usuário percebe espera |
| Ida e volta de rede em 4G | −200 ms | Perfil de uso da persona DevSolo: celular, entre atendimentos |
| **Orçamento de servidor** | **= 800 ms** | O que resta para a aplicação e o banco |

O p100 de 2 s existe porque p95 sozinho esconde cauda: 5% de 40 mil requisições mensais são 2 mil respostas lentas, e o usuário que cai nelas não se consola com a estatística.

### Como é atingido

Pela decisão registrada em [`adr/adr-003-processamento-assincrono.md`](adr/adr-003-processamento-assincrono.md): lotes de 100 registros com pausa de 500 ms entre eles, no máximo 2 jobs simultâneos por tenant no plano Individual e 5 no Equipe. A importação vira uma sequência de rajadas curtas com o banco livre no intervalo, em vez de um bloqueio contínuo.

### Como é verificado

Teste de carga antes de cada entrega de etapa: um tenant sintético importa 500 contatos enquanto 10 tenants virtuais executam busca a cada 3 segundos. Coleta-se o histograma de latência dos 10 tenants observadores. **Falha se o p95 passar de 800 ms.**

---

<a id="cq-02"></a>
## CQ-02 — Isolamento entre tenants

> **Quando uma requisição autenticada de um tenant tenta acessar um recurso de outro tenant pelo identificador direto, o sistema responde 404 em 100% das tentativas, sem devolver nenhum dado nem confirmar a existência do recurso — verificado por suíte automatizada que cobre 100% das rotas que leem dado de tenant, executada a cada deploy.**

| Elemento | Valor |
|---|---|
| Fonte do estímulo | Usuário autenticado de um tenant, ou desenvolvedor introduzindo rota nova |
| Estímulo | Requisição a um recurso cujo `tenant_id` é de outro tenant |
| Artefato | API REST, Resolvedor de Tenant e política de RLS no PostgreSQL |
| Ambiente | Operação normal e também durante deploy |
| Resposta | 404 Not Found, corpo vazio, evento registrado no log de auditoria |
| **Medida** | **100% das tentativas bloqueadas; 100% das rotas cobertas; build falha se a suíte falhar** |

### Por que 100% e não 99,9%

Isolamento é o único atributo deste documento que não admite percentil. Um vazamento em mil é um vazamento: expõe dado pessoal de terceiro — o contato comercial, que sequer é usuário do sistema — e aciona as obrigações de incidente da LGPD descritas em [`lgpd.md`](lgpd.md). Não existe fração aceitável.

### Por que 404 e não 403

`403 Forbidden` confirma que o recurso existe e que o usuário não tem acesso. Essa confirmação já é vazamento: permite enumerar identificadores e descobrir o tamanho da base de um concorrente. `404` é indistinguível de "nunca existiu".

### Dimensionamento da suíte

| Item | Cálculo |
|---|---|
| Rotas que leem dado de tenant (Etapa 1) | 12 previstas no nível 3 do C4 |
| Casos por rota | 2 — leitura cruzada e escrita cruzada |
| **Casos mínimos** | **24**, crescendo com cada rota nova |
| Gatilho de execução | Todo push; build vermelha bloqueia merge |

Um teste adicional varre a definição das rotas e falha se algum parâmetro chamado `tenant_id` aparecer em rota, query string ou corpo — a regra do [`adr/adr-002-identidade-tenant.md`](adr/adr-002-identidade-tenant.md) verificada por máquina, não por revisão humana.

### Como é atingido

Três camadas sobrepostas, detalhadas em [`02-arquitetura-c4.md`](02-arquitetura-c4.md): `tenant_id` no JWT assinado, `SET LOCAL app.tenant_id` em toda transação, e política de RLS com `FORCE ROW LEVEL SECURITY` em toda tabela. A terceira camada é a que não depende de o desenvolvedor lembrar de nada.

---

<a id="cq-03"></a>
## CQ-03 — Onboarding self-service

> **Do envio do formulário de cadastro até o e-mail de confirmação estar entregue na caixa do novo tenant, menos de 45 segundos em 90% dos cadastros, com zero intervenção humana da equipe do OrbitaTI.**

| Elemento | Valor |
|---|---|
| Fonte do estímulo | Novo tenant se cadastrando pelo site |
| Estímulo | Envio do formulário de cadastro |
| Artefato | API REST, PostgreSQL, Fila de Trabalhos, Serviço de Notificações |
| Ambiente | Operação normal, qualquer horário, inclusive fora do expediente |
| Resposta | Tenant criado, usuário admin criado, configuração inicial semeada, e-mail entregue |
| **Medida** | **p90 < 45 s; 0 ações manuais; 0 tickets abertos para concluir cadastro** |

### De onde vem o 45 s

Soma dos tempos de cada etapa, com margem declarada:

| Etapa | Tempo |
|---|---|
| `INSERT` do tenant + usuário admin | 0,20 s |
| Seed de configuração inicial | 0,10 s |
| Enfileirar o job de e-mail | 0,01 s |
| Worker retirar o job da fila | 1,00 s |
| Entrega pelo provedor de e-mail (p90 do mercado) | 30,00 s |
| **Subtotal** | **31,31 s** |
| Margem de 44% para variação do provedor | +13,69 s |
| **Alvo** | **45 s** |

Repare que 96% do orçamento é do provedor de e-mail, que não controlamos. O que a arquitetura controla — os passos no banco e na fila — soma 1,31 s. Esse é justamente o argumento do [`adr/adr-001-tenancy.md`](adr/adr-001-tenancy.md): em pool, criar um tenant é um INSERT. Em silo seria provisionar uma instância, e o gargalo mudaria de lado.

### Por que medir até o e-mail e não até o primeiro login

O tempo até o primeiro login inclui o usuário decidir abrir a caixa de entrada e clicar — variável humana que a arquitetura não governa. Medir o que não se controla produz número sem dono. A meta de produto "primeiro contato cadastrado em menos de 5 minutos" existe em [`01-visao-produto.md`](01-visao-produto.md) e é acompanhada como métrica de negócio, não como cenário de qualidade.

### Como é verificado

Teste de ponta a ponta contra caixa de e-mail de teste, executado a cada deploy, medindo do POST à chegada da mensagem. **Falha se o p90 de 20 execuções passar de 45 s.**

---

<a id="cq-04"></a>
## CQ-04 — Disponibilidade em horário comercial

> **O Portal Web e a API REST respondem com sucesso a 99,5% das requisições na janela de horário comercial — das 8h às 20h, de segunda a sexta —, o que admite no máximo 79 minutos de indisponibilidade por mês nessa janela.**

| Elemento | Valor |
|---|---|
| Fonte do estímulo | Qualquer usuário de qualquer tenant |
| Estímulo | Requisição HTTP em horário comercial |
| Artefato | Portal Web, API REST, PostgreSQL |
| Ambiente | Operação normal, incluindo janelas de deploy |
| Resposta | Resposta com sucesso — 2xx ou 4xx legítimo; 5xx e timeout contam como falha |
| **Medida** | **99,5% de requisições bem-sucedidas; ≤ 79 min/mês de parada** |

### De onde vem o 99,5%

A janela coberta é de 12 h × 22 dias úteis = **264 h/mês**. O que cada nível de SLA permitiria:

| SLA | Parada permitida | O que exige |
|---|---|---|
| 99,0% | 158 min/mês | Instância única, deploy sem cuidado |
| **99,5%** | **79 min/mês** | **Instância única, deploy sem downtime, backup testado** |
| 99,9% | 16 min/mês | Réplica em outra zona, failover automático |

Escolhemos 99,5% por uma razão econômica declarada. Chegar a 99,9% exige réplica de leitura em outra zona de disponibilidade e failover automático — no mínimo o dobro do custo de banco, saindo de R$ 120 para R$ 240 ou mais por mês. Contra uma receita de R$ 4.005/mês, isso levaria o custo de infraestrutura de 3% para 6% da receita para eliminar 63 minutos de parada por mês num CRM que ninguém usa de madrugada.

Prometer 99,9% sem financiar a redundância que o número exige seria promessa vazia. **99,5% é o que a arquitetura de instância única entrega honestamente**, e é o que declaramos.

### Escopo declarado

Fora do horário comercial não há compromisso de disponibilidade — é quando rodam janelas de manutenção e migrações mais pesadas. Isso é coerente com o perfil das personas: a DevSolo acessa entre atendimentos, a TechConsult em expediente.

### Como é verificado

Sonda externa a cada 60 s contra um endpoint de saúde que toca o banco, com apuração mensal só da janela comercial. Painel público de disponibilidade a partir da Etapa 3.

---

<a id="cq-05"></a>
## CQ-05 — Recuperação após falha de dados

> **Diante de perda ou corrupção do banco de dados, o sistema é restaurado com no máximo 15 minutos de dados perdidos (RPO) e volta a atender em no máximo 4 horas (RTO), com o procedimento ensaiado trimestralmente em ambiente separado.**

| Elemento | Valor |
|---|---|
| Fonte do estímulo | Falha de infraestrutura, corrupção ou erro operacional |
| Estímulo | Banco de dados indisponível ou com dados corrompidos |
| Artefato | PostgreSQL, rotina de backup, arquivamento de WAL |
| Ambiente | Modo de falha |
| Resposta | Base restaurada e sistema atendendo novamente |
| **Medida** | **RPO ≤ 15 min; RTO ≤ 4 h; ensaio trimestral com resultado registrado** |

### De onde vem o RPO de 15 minutos

Snapshot diário sozinho daria RPO de 24 h. Arquivamento contínuo de WAL a cada 15 minutos derruba esse número praticamente sem custo adicional, já que o volume de WAL de uma base de 111 MB é irrelevante. O que cada opção custaria ao tenant, em registros perdidos no pior caso:

| RPO | DevSolo (~7 contatos/mês) | TechConsult (~100 contatos/mês) |
|---|---|---|
| 24 h | 0,22 contato | 3,3 contatos |
| **15 min** | **0,00 contato** | **0,03 contato** |

Com RPO de 24 h, a TechConsult perderia até um dia de prospecção de seis pessoas. Com 15 min, a perda esperada é menor que um registro. Como o custo da diferença é próximo de zero, não há razão para aceitar o número pior.

### De onde vem o RTO de 4 horas

Restaurar 111 MB leva minutos; o tempo é dominado pelo que acontece em volta:

| Etapa | Tempo |
|---|---|
| Detecção pelo alerta | 15 min |
| Decisão e acionamento | 30 min |
| Restauração do snapshot + reaplicação de WAL | 30 min |
| Verificação de integridade e sanidade | 60 min |
| **Subtotal** | **2 h 15 min** |
| Margem para fora do horário comercial | +1 h 45 min |
| **Alvo** | **4 h** |

### Nota sobre o modelo pool

Restaurar um tenant específico é mais trabalhoso em pool do que em silo — exige restaurar uma cópia paralela e extrair as linhas daquele `tenant_id`, em vez de devolver um banco inteiro. Essa é uma consequência negativa assumida no [`adr/adr-001-tenancy.md`](adr/adr-001-tenancy.md). O procedimento é documentado e ensaiado antes da Etapa 3, e o RTO de 4 h já o comporta.

### Como é verificado

Ensaio trimestral de restauração completa em ambiente separado, cronometrado, com o resultado registrado em `docs/ensaios/`. **Falha se o RTO medido passar de 4 h ou se a verificação de integridade apontar divergência.**

---

## Rastreabilidade

| Cenário | Decisão que o sustenta | Container responsável |
|---|---|---|
| CQ-01 | [ADR-003](adr/adr-003-processamento-assincrono.md) — fila, lote e quota | Fila de Trabalhos, Worker de Importação |
| CQ-02 | [ADR-001](adr/adr-001-tenancy.md) + [ADR-002](adr/adr-002-identidade-tenant.md) | Resolvedor de Tenant, PostgreSQL com RLS |
| CQ-03 | [ADR-001](adr/adr-001-tenancy.md) — pool torna o onboarding um INSERT | API REST, Serviço de Notificações |
| CQ-04 | [ADR-001](adr/adr-001-tenancy.md) — instância única sustenta o custo | Portal Web, API REST, PostgreSQL |
| CQ-05 | [ADR-001](adr/adr-001-tenancy.md) — restore por tenant é consequência assumida | PostgreSQL |

---

*Documento versionado em `docs/atributos.md`.*
