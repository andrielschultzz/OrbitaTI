# ADR-002 — Identidade do tenant no token, nunca no parâmetro

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-09-24 |
| **Decisores** | Andriel Schultz, Cristofer |
| **Depende de** | [ADR-001 — Pool com RLS](adr-001-tenancy.md) |

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
                                   plano: "equipe", exp: ... }

Requisição  →  Middleware de Autenticação   valida assinatura
            →  Resolvedor de Tenant         lê o claim, fixa no contexto
            →  Acesso a Dados               SET LOCAL app.tenant_id
            →  PostgreSQL                   RLS filtra
```

Rotas ficam assim:

```
GET /api/contatos            ← certo: o tenant vem do token
GET /api/tenants/{id}/contatos  ← proibido: não existe no produto
```

**Regra de convivência:** nenhuma rota da API recebe `tenant_id`. Um teste automatizado varre a definição das rotas e falha a build se algum parâmetro com esse nome aparecer — a regra é verificada por máquina, não por revisão humana.

**Prazo do token:** 15 minutos para o token de acesso, com refresh token de 7 dias. O refresh relê o vínculo do usuário no banco e emite um token novo, o que limita a 15 minutos a janela em que uma mudança de vínculo fica desatualizada.

## Consequências

### Positivas

O isolamento não depende de disciplina de código: a informação perigosa não chega à camada de rota. Não há query extra por requisição, e não existe caminho privilegiado que contorne o RLS. Testar isolamento fica simples — basta autenticar como tenant A e tentar acessar um recurso conhecido do tenant B por ID direto, que é exatamente o que o cenário CQ-02 faz.

### Negativas

**O claim fica congelado até o token expirar.** Se um usuário for removido do tenant, ele mantém acesso por no máximo 15 minutos. *Mitigação:* para remoção de usuário, a sessão vai para uma denylist em Redis consultada pelo middleware, o que corta o acesso na hora. A denylist é pequena — só sessões revogadas ainda não expiradas.

**Um usuário não pode pertencer a dois tenants com o mesmo token.** Um consultor que atenda duas empresas precisa de duas contas. *Avaliação:* aceitável para o mercado-alvo, onde o profissional tem um vínculo. Se virar demanda recorrente, o caminho é um seletor de tenant que emite token novo — não um token com múltiplos tenants.

**A chave de assinatura vira ponto crítico.** Vazamento da chave permite forjar token de qualquer tenant. *Mitigação:* chave em gerenciador de segredos, fora do repositório, com rotação semestral.

## Referências

- [ADR-001 — Pool com RLS](adr-001-tenancy.md)
- Cenário CQ-02 — isolamento entre tenants: [`../atributos.md`](../atributos.md)
- Nível 3 do C4, componentes Resolvedor de Tenant e Acesso a Dados: [`../02-arquitetura-c4.md`](../02-arquitetura-c4.md)
