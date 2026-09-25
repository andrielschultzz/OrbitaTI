# 1.5 — Mapeamento LGPD preliminar

**Unidade:** Andriel Schultz e Cristofer
**Etapa 1 — Proposta de arquitetura**
**Status:** preliminar — aprofundado na Etapa 3

> Documento de arquitetura, não parecer jurídico. As bases legais indicadas são a leitura técnica da equipe e devem ser validadas por profissional da área antes de o produto entrar em produção com clientes reais.

---

## O ponto que define tudo

O OrbitaTI tem uma característica que o separa da maioria dos SaaS de gestão: **o dado mais importante do sistema pertence a alguém que não é usuário do sistema**.

O Contato Comercial — a entidade central definida em [`01-visao-produto.md`](01-visao-produto.md) — é uma pessoa real, com nome, telefone e e-mail, que nunca criou conta no OrbitaTI, nunca aceitou termo de uso e, na maioria dos casos, não sabe que está cadastrada. Ela foi inserida pelo profissional de TI depois de uma conversa, uma indicação ou um orçamento.

Isso produz uma divisão de papéis que precisa estar clara antes de a primeira linha de código ser escrita:

| Papel LGPD | Quem é | Responsável por |
|---|---|---|
| **Controlador** | **O tenant** — o profissional de TI ou a consultoria | Decidir quais contatos cadastrar, para quê, e por quanto tempo. Responder ao titular que exercer direitos |
| **Operador** | **O OrbitaTI** | Tratar os dados **exclusivamente** conforme instrução do tenant. Garantir segurança. Não usar os dados para finalidade própria |

A consequência prática é direta: **o OrbitaTI não decide nada sobre os dados dos contatos**. Não os usa para treinar modelo, não os cruza entre tenants, não os enriquece com fonte externa, não os usa para prospectar. Qualquer uma dessas coisas transformaria o OrbitaTI em controlador de dados de milhares de pessoas que nunca ouviram falar dele.

Há uma exceção: para os dados dos **usuários** do tenant — quem faz login, com e-mail, senha e logs de acesso — o OrbitaTI é controlador, porque é ele quem decide coletá-los para operar a conta.

---

## Inventário de dados

### Dados de usuário do tenant — OrbitaTI é controlador

| Dado | Titular | Finalidade | Base legal | Retenção |
|---|---|---|---|---|
| Nome e e-mail | Usuário | Identificação e autenticação | Execução de contrato — art. 7º, V | Vida da conta + 30 dias |
| Senha (hash Argon2id) | Usuário | Autenticação | Execução de contrato — art. 7º, V | Vida da conta |
| Logs de acesso — IP, data/hora, ação | Usuário | Segurança, auditoria e investigação de incidente | Obrigação legal — art. 7º, II, c/c Marco Civil art. 15 | **6 meses** |
| Dados de cobrança | Tenant (PJ ou MEI) | Faturamento e obrigação fiscal | Obrigação legal — art. 7º, II | **5 anos** (prazo fiscal) |

### Dados de contato comercial — OrbitaTI é operador

| Dado | Titular | Finalidade (definida pelo tenant) | Base legal do tenant | Retenção |
|---|---|---|---|---|
| Nome | Contato — terceiro | Gestão do relacionamento comercial | Legítimo interesse — art. 7º, IX | Definida pelo tenant; padrão: vida da conta |
| E-mail e telefone | Contato | Contato comercial e envio de proposta | Legítimo interesse — art. 7º, IX | Idem |
| Empresa e cargo | Contato | Qualificação comercial | Legítimo interesse — art. 7º, IX | Idem |
| Histórico de interações — notas livres | Contato | Registro do relacionamento | Legítimo interesse — art. 7º, IX | Idem |
| Oportunidades — valor, estágio, prazo | Contato e tenant | Acompanhamento comercial | Legítimo interesse — art. 7º, IX | Idem |
| Propostas em PDF | Contato | Formalização de orçamento | Execução de contrato — art. 7º, V | Idem |

### Dado sensível

**O OrbitaTI não coleta nem solicita dado sensível** na acepção do art. 5º, II — origem racial, convicção religiosa, opinião política, filiação sindical, saúde, vida sexual, dado genético ou biométrico. Não há campo para isso no produto.

O risco real está no **campo livre de notas de interação**, onde um usuário pode digitar qualquer coisa — inclusive informação sensível sobre um contato. É o ponto mais frágil do mapeamento.

*Medidas:* aviso no rótulo do campo orientando a registrar apenas informação de negócio; cláusula no contrato de operador atribuindo ao tenant a responsabilidade pelo que seus usuários escrevem; e, a partir da Etapa 3, verificação automática que alerta — sem bloquear — quando o texto contém padrão de CPF ou de dado de saúde.

---

## Ciclo de vida e a fase que quase ninguém projeta

O tenant passa por cinco fases — assinar, configurar, usar, crescer e sair. A última é a que gera obrigação de LGPD e a que costuma ficar de fora do desenho.

| Fase | O que acontece com os dados |
|---|---|
| **Assinar** | Criação do tenant e do usuário admin. Dados mínimos: nome, e-mail, senha |
| **Configurar / usar** | Tenant insere contatos. A partir daqui o OrbitaTI trata dado de terceiro como operador |
| **Crescer** | Volume aumenta; papéis e permissões se diferenciam |
| **Cancelar** | Conta entra em modo somente leitura. **Exportação completa em CSV e JSON disponível por 30 dias** |
| **Excluir** | Após 30 dias, exclusão definitiva: `DELETE` em cascata por `tenant_id` + remoção do prefixo no armazenamento de objetos. Logs de acesso sobrevivem os 6 meses do Marco Civil, desvinculados do conteúdo |

O prazo de 30 dias é declarado no contrato e implementado como job agendado, não como tarefa manual. **Exclusão que depende de alguém lembrar não é medida de segurança.**

---

## Medidas de segurança

### Já decididas nesta Etapa

| Medida | Onde está | Protege contra |
|---|---|---|
| **Row-Level Security no PostgreSQL** | [ADR-001](adr/adr-001-tenancy.md) | Vazamento entre tenants — o risco número um do modelo pool |
| **`tenant_id` no JWT assinado, nunca em parâmetro** | [ADR-002](adr/adr-002-identidade-tenant.md) | Acesso cruzado por manipulação de URL |
| **Suíte de isolamento a cada deploy** | [CQ-02](atributos.md#cq-02) | Regressão silenciosa de isolamento |
| **TLS 1.3 em todo tráfego** | Infraestrutura | Interceptação em trânsito |
| **Criptografia em repouso** | Banco e armazenamento de objetos | Acesso físico ao meio |
| **Senha com Argon2id** | API REST | Vazamento de credenciais em caso de dump |
| **Prefixo por tenant no armazenamento** | [C4 nível 2](02-arquitetura-c4.md) | Acesso cruzado a PDFs e anexos |
| **Logs de acesso por 6 meses** | Infraestrutura | Investigação de incidente |
| **Backup com RPO de 15 min** | [CQ-05](atributos.md#cq-05) | Perda de dados — art. 46 exige integridade |

### A implementar até a Etapa 3

| Medida | Prazo |
|---|---|
| Contrato de operador (DPA) no termo de uso, com instruções de tratamento | Etapa 2 |
| Exportação self-service em CSV e JSON pelo Portal Web | Etapa 2 |
| Job de exclusão automática 30 dias após cancelamento | Etapa 2 |
| Registro de operações de tratamento — art. 37 | Etapa 3 |
| Procedimento de resposta a incidente com prazo de comunicação à ANPD | Etapa 3 |
| Alerta de dado sensível em campo livre | Etapa 3 |
| Relatório de impacto (RIPD) | Etapa 4 |

---

## Direitos do titular

O art. 18 dá ao titular direito de confirmação, acesso, correção, anonimização, portabilidade e eliminação. Para o OrbitaTI, **a resposta depende de quem é o titular**:

| Titular | Quem responde | Como o OrbitaTI atende |
|---|---|---|
| **Usuário do tenant** | OrbitaTI, como controlador | Tela de conta: ver, corrigir, exportar e excluir os próprios dados |
| **Contato comercial** | **O tenant**, como controlador | O OrbitaTI encaminha o pedido ao tenant em até 2 dias úteis e fornece as ferramentas — busca, edição, exclusão e exportação — para o tenant cumprir o prazo legal |

Se um contato comercial escrever para o OrbitaTI pedindo exclusão, a resposta não é apagar. É identificar em quais tenants aquele dado existe, comunicar esses tenants e dar a eles a ferramenta. **Apagar por conta própria seria o operador decidindo sobre dado que não é dele** — e ainda destruiria informação do controlador sem autorização.

Esse fluxo precisa estar no termo de uso antes do primeiro cliente real.

---

## Riscos identificados

| # | Risco | Impacto | Probabilidade | Tratamento |
|---|---|---|---|---|
| R1 | Vazamento entre tenants por falha de isolamento | **Crítico** — dado de terceiro exposto, incidente comunicável à ANPD | Baixa | RLS com `FORCE`, suíte CQ-02 a cada deploy, ponto único de acesso ao banco |
| R2 | Dado sensível digitado em campo livre | Alto — tratamento sem base legal adequada | **Média** | Aviso no campo, cláusula contratual, detecção na Etapa 3 |
| R3 | Tenant cadastra contatos sem base legal válida | Alto — mas a responsabilidade é do controlador | Média | Contrato de operador explicitando a obrigação do tenant |
| R4 | Retenção indefinida após cancelamento | Médio — art. 16 exige eliminação após a finalidade | Baixa | Job automático de exclusão em 30 dias |
| R5 | Vazamento da chave de assinatura do JWT | **Crítico** — permite forjar acesso a qualquer tenant | Baixa | Chave em gerenciador de segredos fora do repositório, rotação semestral |
| R6 | PDF de proposta acessível por URL adivinhável | Alto — expõe dado de contato e valores | Baixa | URL assinada com validade curta; prefixo por tenant; sem listagem pública |

---

## O que muda se o produto crescer

| Cenário | Consequência LGPD |
|---|---|
| Tenant fora do Brasil | Transferência internacional — arts. 33 a 36. Hoje fora de escopo; a infraestrutura fica em região brasileira |
| Integração que envia contato para sistema externo | O tenant passa a compartilhar dado com terceiro; o webhook precisa de registro e o DPA de cláusula específica |
| Enriquecimento automático de contatos | **Mudaria o papel do OrbitaTI para controlador.** Não está no roteiro, e o motivo é este |
| Uso de dados para treinar modelo | Idem — vedado pelo contrato de operador. Não está no roteiro |

---

## Rastreabilidade

| Item | Onde |
|---|---|
| Entidade central e por que o dado é de terceiro | [`01-visao-produto.md`](01-visao-produto.md) |
| Camadas de isolamento | [`02-arquitetura-c4.md`](02-arquitetura-c4.md) |
| Decisão de pool e o risco que ela cria | [`adr/adr-001-tenancy.md`](adr/adr-001-tenancy.md) |
| Isolamento como cenário verificável | [`atributos.md#cq-02`](atributos.md#cq-02) |
| Integridade e recuperação | [`atributos.md#cq-05`](atributos.md#cq-05) |

**Referência:** BRASIL. Lei nº 13.709, de 14 de agosto de 2018 — Lei Geral de Proteção de Dados Pessoais.

---

*Documento versionado em `docs/lgpd.md`. Preliminar — aprofundado na Etapa 3.*
