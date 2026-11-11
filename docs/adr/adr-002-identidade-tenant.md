# ADR-002 — Identidade do tenant no token, nunca no parâmetro

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-09-24 |
| **Decisores** | Andriel Schultz, Cristofer Mateus Rutzen |
| **Depende de** | [ADR-001 — Pool com RLS](adr-001-tenancy.md) |
| **Revisão** | 08/11/2026 (Bloco 7): sem refresh token e sem denylist (decisão 9); exceção única do login; segredo próprio para o token de serviço. A decisão central não mudou |
| **Revisão** | 10/11/2026 (Bloco 15): claim `papel` no exemplo do JWT; as exceções ao RLS são duas funções, não uma (nota abaixo). A decisão central não mudou |

---

## Contexto

O ADR-001 decidiu pool com RLS. A política de RLS depende de uma variável de sessão, `app.tenant_id`, estar corretamente preenchida antes de qualquer query. Falta decidir **de onde vem esse valor**.

A pergunta parece administrativa, mas é a decisão de segurança mais importante do produto. Em pool, o `tenant_id` é a única coisa que separa os dados de 45 clientes. Se o cliente conseguir influenciar esse valor, o isolamento inteiro cai — o RLS estará funcionando perfeitamente, isolando o tenant errado.

Há três origens possíveis, e a diferença entre elas é quem controla o valor.

## Opções consideradas

### A — Parâmetro da requisição

O cliente envia o tenant na URL ou no corpo: `GET /api/tenants/{tenant_id}/contatos`.

É o modelo mais comum em tutoriais e o mais fácil de implementar. Também é indefensável: o valor vem de quem faz a requisição. A proteção teria de ser uma verificação explícita, em toda rota, de que o `tenant_id` enviado bate com o do usuário autenticado. Uma rota nova que esqueça essa verificação é um vazamento — e a verificação é invisível quando ausente, porque o código funciona normalmente para o uso legítimo. O bug só aparece quando alguém troca o número na URL.

### B — Consulta ao banco a cada requisição

O `user_id` vem do token; a API consulta a tabela de usuários para descobrir o tenant.

O valor passa a ser do servidor, o que resolve o problema de confiança. O custo é uma query adicional em toda requisição, antes de qualquer trabalho útil — e essa query precisa rodar **fora** do RLS, já que ainda não sabemos o tenant para fixá-lo. Criar um caminho privilegiado que ignora a política de linha, executado em toda requisição, enfraquece exatamente a barreira que o ADR-001 elegeu como última linha de defesa.

### C — Claim no JWT assinado

O `tenant_id` é gravado como claim no token no momento do login e lido da assinatura a cada requisição.

O valor é do servidor: foi o próprio login que o colocou lá, e a assinatura impede alteração. Não custa query. O cliente pode ler o token — ele não é secreto — mas não pode alterá-lo sem invalidar a assinatura.

O custo é que o claim fica congelado pela vida do token: se o vínculo do usuário mudar, o token antigo continua válido até expirar.

## Decisão

**O `tenant_id` é um claim do JWT assinado, gravado no login e lido pelo Resolvedor de Tenant a cada requisição. A API nunca aceita `tenant_id` como parâmetro de rota, query string ou corpo.**

Adotamos a opção C. O ponto decisivo é que ela é a única em que o caminho errado **não compila** em vez de apenas não ser testado. Não existe parâmetro de tenant para esquecer de validar: o valor não está disponível na entrada da requisição, ponto. Em vez de exigir que toda rota nova lembre de fazer uma verificação, tiramos a possibilidade do vocabulário.

Contra a opção B, o argumento é o do ADR-001: não abrimos um caminho que ignora o RLS, muito menos um que roda em toda requisição.

```
Login  →  valida credenciais  →  emite JWT
                                 { sub: "u-abc", tenant_id: "t-xyz",
                                   plano: "equipe", papel: "admin", exp: ... }

Requisição  →  Middleware de Autenticação   valida assinatura
            →  Resolvedor de Tenant         lê o claim, fixa no contexto
            →  Acesso a Dados               set_config('app.tenant_id', $1, true)
            →  PostgreSQL                   RLS filtra
```

> **Nota de 10/11/2026 (Bloco 15): o claim `papel` faltava no exemplo.** O token de sessão leva quatro claims
> próprios: `sub`, `tenant_id`, `plano` e `papel` (`admin`, `consultor` ou `visualizador`). O `papel` é
> **obrigatório**: `services/api-contatos/src/autenticacao.js` recusa (401) token sem um papel válido, e é por
> ele que as rotas de `/conta` respondem 403 a quem não é admin. O `plano` decide o rate limit
> (`planos.js`). Os dois são gravados pela API no login e no cadastro (`rotas/auth.js`), nunca pelo cliente,
> pelo mesmo motivo do `tenant_id`.

Rotas ficam assim:

```
GET /api/contatos            ← certo: o tenant vem do token
GET /api/tenants/{id}/contatos  ← proibido: não existe no produto
```

**Regra de convivência:** nenhuma rota da API recebe `tenant_id`. Um teste automatizado varre a definição das rotas e falha a build se algum parâmetro com esse nome aparecer — a regra é verificada por máquina, não por revisão humana.

**Prazo do token:** 15 minutos para o token de acesso (`exp − iat = 900` s, T-AUTH-07), **sem refresh token**. Ao expirar, o usuário faz login de novo.

> **Revisão de 08/11/2026 — refresh token e denylist fora do escopo do semestre (decisão 9).** A versão original deste ADR previa refresh token de 7 dias e uma denylist em Redis para cortar na hora o acesso de um usuário removido. As duas coisas foram **decididas fora do escopo**, não esquecidas:
>
> - **O que foi decidido:** token de acesso de 15 min, sem refresh e sem denylist.
> - **Consequências aceitas:** (1) quem usa o sistema por mais de 15 min seguidos precisa entrar de novo; (2) usuário removido ou tenant cancelado mantém acesso por **até 15 min** com o token já emitido. O contrato da API já declara isso no `POST /conta/cancelamento` ([`../contrato-api.md`](../contrato-api.md), seção 9), e o Portal sai da conta logo depois de cancelar.
> - **Por que é aceitável agora:** o Portal é usado em sessões curtas (a DevSolo abre o app entre dois atendimentos), e hoje não existe convite nem remoção de usuário (contrato, seção 10). A janela de 15 min só aparece no cancelamento da conta, feito pelo próprio admin.
> - **Gatilhos de revisão:** reclamação de usuário sobre login frequente; primeiro cliente com rotatividade de equipe que exija corte imediato de acesso; o Portal passar a ter sessões longas de trabalho contínuo.

**A exceção ~~única~~: o login** (desde 10/11 são duas, ver nota abaixo). No login, a API ainda não sabe o tenant, e o RLS esconde a tabela `usuarios` de uma sessão sem tenant. A busca da credencial passa pela função `orbita.buscar_credencial(email)`, cujo dono é o papel `orbita_auth`: `BYPASSRLS`, sem login (`NOLOGIN`), ~~dono só dessa função~~ (ver nota de 10/11). Ela é ~~a **única** exceção controlada~~ uma das duas exceções controladas, e é diferente da opção B rejeitada acima:

- roda **só no login**, não em toda requisição;
- devolve só o necessário para conferir a senha e montar o token (T-RLS-09);
- o papel da API não lê `usuarios` fora dela (T-RLS-10), e nenhum papel de aplicação tem `BYPASSRLS` (T-RLS-14);
- a função não fica executável por `PUBLIC` (T-RLS-19).

O e-mail do usuário é único na base inteira (T-RLS-12), porque o login acha o usuário só pelo e-mail.

> **Nota de revisão — 10/11/2026 (Bloco 15): a segunda exceção.** Desde `db/migrations/004_exclusao.sql`
> (bloco 14, LGPD), o `orbita_auth` também é dono de `orbita.tenants_para_excluir()`. São, portanto, **duas
> funções `SECURITY DEFINER`, as duas do `orbita_auth`, cada uma devolvendo só o mínimo**: a credencial de um
> e-mail (login) e os ids dos tenants cancelados há mais de 30 dias (exclusão). A segunda existe porque o job
> diário de exclusão precisa saber **quais** tenants apagar antes de ter um tenant no contexto, e sem tenant o
> RLS esconde todo `orbita.tenants`. Ela segue as mesmas quatro regras da lista acima: roda uma vez por dia (não
> em toda requisição), devolve só ids, `EXECUTE` só para `api_contatos` e nada para `PUBLIC`. A apagação em si
> roda sob RLS, com `withTenant(id)`. Detalhes e o porquê de os comentários antigos do banco não serem editados:
> [ADR-001](adr-001-tenancy.md), nota de 10/11.

**Token de serviço.** O Serviço de Importação chama a API com um token próprio, assinado com outro segredo (`JWT_SERVICO_SEGREDO`), que só abre as rotas `/interno` e vale 60 s. O tenant vai no claim `tenant_id` desse token, nunca em parâmetro. O porquê dos dois segredos está no [`adr-004-comunicacao-entre-servicos.md`](adr-004-comunicacao-entre-servicos.md).

## Consequências

### Positivas

O isolamento não depende de disciplina de código: a informação perigosa não chega à camada de rota. Não há query extra por requisição, e ~~o único caminho que contorna o RLS é a função de login, que roda uma vez por sessão~~ os dois caminhos que contornam o RLS são a função de login, que roda uma vez por sessão, e a lista de tenants a excluir, que roda uma vez por dia (nota de 10/11) — nenhum deles roda em toda requisição. Testar isolamento fica simples — basta autenticar como tenant A e tentar acessar um recurso conhecido do tenant B por ID direto, que é exatamente o que o cenário CQ-02 faz.

### Negativas

**O claim fica congelado até o token expirar.** Se um usuário for removido do tenant, ou o tenant for cancelado, ele mantém acesso por no máximo 15 minutos. *Avaliação:* risco aceito (revisão de 08/11, acima). A denylist em Redis da versão original fica para quando um dos gatilhos de revisão acontecer.

**Um usuário não pode pertencer a dois tenants com o mesmo token.** Um consultor que atenda duas empresas precisa de duas contas. *Avaliação:* aceitável para o mercado-alvo, onde o profissional tem um vínculo. Se virar demanda recorrente, o caminho é um seletor de tenant que emite token novo — não um token com múltiplos tenants.

**A chave de assinatura vira ponto crítico.** Vazamento da chave permite forjar token de qualquer tenant. *Mitigação:* chave fora do repositório, com no mínimo 32 caracteres (a API recusa subir com menos). Hoje fica no `.env` (gerado por `npm run env`) e, no kind, num Secret do Kubernetes entregue só aos pods que a usam. Em produção: gerenciador de segredos, com rotação semestral. O token de serviço tem segredo próprio, então vazar o segredo do worker não permite forjar token de usuário.

## Referências

- [ADR-001 — Pool com RLS](adr-001-tenancy.md)
- [ADR-004 — Comunicação entre serviços](adr-004-comunicacao-entre-servicos.md) (token de serviço)
- Contrato da API, seção 3 (token de sessão): [`../contrato-api.md`](../contrato-api.md)
- Cenário CQ-02 — isolamento entre tenants: [`../atributos.md`](../atributos.md)
- Nível 3 do C4, componentes Resolvedor de Tenant e Acesso a Dados: [`../02-arquitetura-c4.md`](../02-arquitetura-c4.md)
