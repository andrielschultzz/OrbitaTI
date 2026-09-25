# ADR-003 — Trabalho pesado em fila, com lote e quota por tenant

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-09-24 |
| **Decisores** | Andriel Schultz, Cristofer |
| **Depende de** | [ADR-001 — Pool com RLS](adr-001-tenancy.md) |

---

## Contexto

O ADR-001 escolheu pool, e assumiu explicitamente uma consequência negativa: **o vizinho barulhento é real**. Os 45 tenants dividem o mesmo PostgreSQL, a mesma CPU e o mesmo conjunto de conexões. Este ADR decide como essa consequência é contida.

A operação concreta que gera o problema é conhecida e vem das personas de [`../01-visao-produto.md`](../01-visao-produto.md): a TechConsult Solutions, ao migrar sua planilha de 640 linhas, importa centenas de contatos de uma vez. Cada linha do CSV vira um INSERT em `contatos` mais um registro de auditoria, e o lote inteiro chega ao banco em rajada.

Enquanto isso, o Marcelo da DevSolo Sistemas — 80 contatos, um usuário, R$ 49/mês — abre o app no celular entre dois atendimentos para procurar um telefone. Ele não tem relação nenhuma com a TechConsult, não se beneficia da importação dela, e não deveria nem perceber que ela está acontecendo.

O princípio da disciplina é direto: **o pico de um tenant não pode degradar todos**. Falta decidir como.

## Opções consideradas

### A — Processar na requisição

O endpoint de importação recebe o arquivo e insere tudo antes de responder.

É o caminho mais curto e o pior resultado. Uma importação de 500 linhas segura uma conexão do pool por dezenas de segundos e despeja as escritas de uma vez. Com poucas conexões disponíveis e uma rajada de escritas competindo com as leituras de todos os outros tenants, o efeito é exatamente a degradação que queremos evitar. Some-se o timeout de HTTP: importações grandes falham no meio, deixando o tenant sem saber quantas linhas entraram.

### B — Instância de banco maior

Comprar mais CPU e memória até o problema sumir.

Resolve por um tempo e custa dinheiro recorrente por um problema de desenho. Também não resolve de verdade: o limite muda de lugar, o tenant grande continua consumindo a fatia que quiser, e nada impede que dois tenants importem ao mesmo tempo. Fundamentalmente, é responder a uma pergunta de arquitetura com uma fatura de infraestrutura — e no OrbitaTI, onde o banco custa 3% da receita justamente porque é um só, dobrar a instância dobra a única linha de custo que estava sob controle.

### C — Fila, lote e quota

Trabalho pesado sai do caminho da requisição e vira job. O worker processa em lotes pequenos com pausa entre eles. Uma quota limita quanto cada tenant pode enfileirar.

A requisição responde em milissegundos com "recebido". A carga vira uma sequência de rajadas curtas em vez de um bloqueio longo, e o limite por tenant é explícito em vez de ser o que sobrar.

## Decisão

**Toda operação que toca mais de 50 registros ou leva mais de 2 segundos sai do caminho da requisição e vira job na Fila de Trabalhos. Workers processam em lotes de 100 com pausa de 500 ms entre lotes, respeitando uma quota de jobs simultâneos por tenant.**

Adotamos a opção C. As três operações que se qualificam hoje:

| Operação | Container | Por quê |
|---|---|---|
| Importação de contatos via CSV | Worker de Importação | Centenas de INSERTs em rajada |
| Geração de proposta em PDF | Gerador de Documentos | Renderização leva 2 a 5 s por documento |
| Disparo de alertas de contato frio | Serviço de Notificações | Varre a base do tenant e envia e-mails em lote |

### Os números e de onde saíram

| Parâmetro | Valor | Derivação |
|---|---|---|
| **Tamanho do lote** | 100 registros | A DevSolo acumula ~150 contatos em 12 meses e nunca importa em massa: um lote de 100 não a afeta. A TechConsult, com 1.200 contatos, precisa de 12 lotes |
| **Pausa entre lotes** | 500 ms | Devolve o banco às requisições interativas entre rajadas |
| **Intervalo entre jobs de importação** | 5 min | 12 lotes distribuídos em ~1 hora em vez de uma rajada de 1.200 INSERTs |
| **Jobs simultâneos por tenant** | 2 (Individual) / 5 (Equipe) | Impede que um tenant ocupe todos os workers |
| **Limite de enfileiramento** | 100 contatos por job de importação | Quota do plano; acima disso o cliente divide o arquivo ou usa a API |

O número de 100 por lote não é arredondamento: ele vem da comparação entre as duas personas. É grande o bastante para a TechConsult migrar sua base em cerca de uma hora sem supervisão, e pequeno o bastante para que nenhum lote individual represente carga perceptível para a DevSolo. A verificação disso é o cenário **CQ-01** de [`../atributos.md`](../atributos.md).

### Como o tenant atravessa a fila

O `tenant_id` viaja no payload do job e é reaplicado pelo worker antes de qualquer query:

```js
// Enfileira — o tenant vem do contexto da requisição, nunca do cliente
await fila.add('importar-contatos',
  { tenantId: ctx.tenantId, arquivoId },
  { priority: ctx.plano === 'equipe' ? 1 : 2 }
);

// Consome — o worker refaz a fixação do tenant, lote a lote
async function processar(job) {
  const { tenantId, arquivoId } = job.data;
  for (const lote of lotesDe(arquivoId, 100)) {
    await db.transacao(tenantId, async (tx) => {   // SET LOCAL app.tenant_id
      await tx.inserirContatos(lote);
    });
    await esperar(500);
  }
}
```

O worker é tão sujeito ao RLS quanto a API: ele não tem caminho privilegiado. Isso é deliberado — um worker que ignorasse a política de linha seria uma porta dos fundos no isolamento decidido no ADR-001.

**Ao estourar a quota**, a resposta é `429 Too Many Requests` com o tempo de espera no corpo. Recusar explicitamente é melhor do que aceitar e degradar: o tenant sabe o que aconteceu e o produto continua previsível para os outros 44.

## Consequências

### Positivas

O pico de um tenant vira rajadas curtas em vez de um bloqueio longo, o que torna o cenário CQ-01 cumprível e transforma a consequência negativa do ADR-001 em risco controlado. Importações grandes deixam de falhar por timeout de HTTP, já que a requisição só enfileira. A infraestrutura de fila serve às três operações pesadas com uma peça só, e os limites por tenant ficam explícitos — viram dimensão de plano, conversando com o modelo comercial em vez de serem um acidente de capacidade.

### Negativas

**A importação deixa de ser instantânea.** O usuário envia o arquivo e recebe o resultado depois, não na hora. *Mitigação:* o Portal Web mostra progresso em tempo real ("340 de 500 contatos importados") e notifica ao concluir. Percepção de progresso resolve a maior parte do desconforto de espera.

**Mais uma peça para operar.** Redis é um componente novo, com seu próprio modo de falhar. Se a fila cair, importações e propostas param — ainda que o CRM continue funcionando para leitura e cadastro manual. *Mitigação:* jobs persistidos em disco pelo BullMQ, política de retry com backoff exponencial, e fila morta monitorada.

**Jobs podem rodar duas vezes** em caso de falha e retry. *Mitigação:* a importação é idempotente por chave `(tenant_id, e-mail)` — reprocessar um lote atualiza em vez de duplicar.

**A quota vai incomodar alguém.** Um tenant Equipe migrando uma base de 3.000 contatos vai levar várias horas. *Avaliação:* aceitável. Migração é evento único, e a alternativa — deixar esse tenant degradar os outros 44 — é pior. Para casos assim, oferecemos migração assistida fora do horário comercial.

## Gatilhos de revisão

| Gatilho | Por quê |
|---|---|
| CQ-01 falhar em produção por 2 meses seguidos | Os parâmetros de lote e pausa estão errados para a carga real |
| Mais de 20% dos tenants estourarem a quota mensalmente | A quota está apertada demais e virou atrito comercial |
| Fila acumular mais de 1.000 jobs pendentes | Faltam workers; reavaliar escala horizontal |

## Referências

- [ADR-001 — Pool com RLS](adr-001-tenancy.md), consequência "o vizinho barulhento é real"
- Cenário CQ-01: [`../atributos.md`](../atributos.md)
- Containers Fila de Trabalhos e Worker de Importação: [`../02-arquitetura-c4.md`](../02-arquitetura-c4.md)
