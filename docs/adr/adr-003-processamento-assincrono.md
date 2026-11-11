# ADR-003 — Trabalho pesado em fila, com lote e quota por tenant

| Campo | Valor |
|---|---|
| **Status** | Aceito — revisado em 08/11/2026 (nota abaixo e [ADR-004](adr-004-comunicacao-entre-servicos.md)) e em 10/11/2026 (nota do Bloco 15: exceção da exportação LGPD) |
| **Data** | 2026-09-24 |
| **Decisores** | Andriel Schultz, Cristofer Mateus Rutzen |
| **Depende de** | [ADR-001 — Pool com RLS](adr-001-tenancy.md) |
| **Revisado por** | [ADR-004 — Comunicação entre a API e o Serviço de Importação](adr-004-comunicacao-entre-servicos.md) |

---

> **Nota de revisão — 08/11/2026 (Bloco 7).** A decisão central continua: trabalho pesado em fila, lotes de
> 100, pausa de 500 ms e limite por tenant. Mudou o seguinte, e o texto abaixo já foi ajustado:
>
> 1. **O intervalo de 5 min entre jobs de importação foi retirado.** No lugar dele valem dois limites: o de
>    **importações simultâneas por plano** (Individual 2, Equipe 5, contadas no banco) e a **`concurrency: 2`
>    do worker** (no máximo 2 importações tocam o banco ao mesmo tempo, somando todos os tenants).
>    **Por quê:**
>    - o intervalo protegia o banco **entre** jobs, mas o que pesa no banco é o que acontece **durante** um
>      job. Quem limita isso é o lote de 100 com a pausa de 500 ms, que continua;
>    - com o intervalo, 5.000 contatos em jobs de 100 levariam 50 jobs × 5 min ≈ 4 h. Sem ele, levam 49
>      pausas × 500 ms = 24,5 s, mais o tempo de gravação;
>    - a `concurrency: 2` limita o total que chega ao banco, de qualquer tenant: no máximo 2 × 100 = 200
>      linhas em gravação simultânea vindas de importação. Um intervalo por tenant não impedia 45 tenants de
>      importarem ao mesmo tempo.
> 2. **O limite por importação depende do plano:** Individual 100 linhas, Equipe 5.000 linhas (≈ 1 MB ÷
>    200 bytes por linha), e no máximo 1 MB nos dois.
> 3. **O worker não grava no banco:** chama a API (`POST /interno/importacoes/:id/lotes`). O CSV vai no
>    payload do job, sem S3. Ver [ADR-004](adr-004-comunicacao-entre-servicos.md).
> 4. **Rate limit por tenant**, que não existia na versão original: seção "Rate limit por tenant" abaixo.
> 5. **Correções de fato:** o Redis roda sem persistência em disco; o 429 de importação não traz tempo de
>    espera; não há fila morta monitorada; o Gerador de Documentos ~~e o Serviço de Notificações ainda não
>    existem~~ não existe (o Serviço de Notificações existe desde o bloco 10: ver nota de 10/11).

> **Nota de revisão — 10/11/2026 (Bloco 15).** A decisão central não mudou. Três correções:
>
> 1. **Exceção declarada à regra "mais de 50 registros ou mais de 2 s vai para a fila": a exportação LGPD.**
>    O `GET /conta/exportacao` (e o mesmo JSON pelo link, `GET /conta/exportacao/arquivo`) lê o tenant inteiro
>    **dentro da requisição** (`montarExportacao` em `services/api-contatos/src/rotas/conta.js`): tenant,
>    usuários, contatos, interações e importações. Passa de 50 registros em qualquer tenant real. Aceitamos
>    porque:
>    - **lê um tenant só**, sob RLS (`withTenant`), e só lê: não há rajada de escrita disputando o banco com os
>      outros tenants, que é o problema que a fila resolve;
>    - **o tamanho é pequeno, mas o limite não vem do plano.** O `planos.js` limita usuários (1 ou 10) e linhas
>      **por importação** (100 ou 5.000), não o total de contatos do tenant. O que dá a ordem de grandeza é a
>      premissa do produto: o maior tenant tem ~1.200 contatos e ~6.000 interações em 12 meses (5 por contato,
>      [ADR-001](adr-001-tenancy.md)), e a base inteira dos 45 tenants cabe em ~111 MB;
>    - **é rara:** o admin pede uma vez, ao sair (ou pelo link, nos 30 dias depois do cancelamento, com rate
>      limit de 10/min por IP);
>    - **pela fila, precisaria de armazenamento de arquivo:** o worker geraria o JSON e alguém teria de
>      guardá-lo até o download. O projeto não tem S3 ([ADR-004](adr-004-comunicacao-entre-servicos.md), opção
>      3B), e guardar um arquivo com todos os dados pessoais do tenant no Redis contraria o cuidado que a fila
>      `emails` já tem (`removeOnComplete`).
>
>    **Gatilho de revisão:** a exportação passar de **2 s** (a meta da própria regra). **Tempo ainda não
>    medido — TODO: medir com o tenant do seed (TechConsult) e registrar aqui.** Também revisar se surgir um
>    limite de contatos por plano maior que a premissa, ou se a exportação passar a ser pedida com frequência.
> 2. **O Serviço de Notificações existe desde o bloco 10** (`services/notificacoes/`, fila `emails`). Ele envia
>    dois e-mails: a confirmação de cadastro (bloco 10) e o link de exportação depois do cancelamento
>    (`exportacao-disponivel`, bloco 14). **O aviso de importação concluída não foi feito**, nem o alerta de
>    contato frio: o Portal continua mostrando o progresso por `GET /importacoes/:id`.
> 3. **Dois limites por IP que faltavam na tabela "Rate limit por tenant"**, acrescentados lá: confirmação de
>    e-mail (bloco 10) e link de exportação (bloco 14), 10/min por IP cada (`services/api-contatos/src/limite.js`).

## Contexto

O ADR-001 escolheu pool, e assumiu explicitamente uma consequência negativa: **o vizinho barulhento é real**. Os 45 tenants dividem o mesmo PostgreSQL, a mesma CPU e o mesmo conjunto de conexões. Este ADR decide como essa consequência é contida.

A operação concreta que gera o problema é conhecida e vem das personas de [`../01-visao-produto.md`](../01-visao-produto.md): a TechConsult Solutions, ao migrar sua planilha de 640 linhas, importa centenas de contatos de uma vez. Cada linha do CSV vira um INSERT (ou um UPDATE, se o e-mail já existir) em `contatos`, e o lote inteiro chega ao banco em rajada.

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

*(Exceção declarada em 10/11/2026: a exportação LGPD roda na requisição. Ver nota do Bloco 15, no topo.)*

Adotamos a opção C. As três operações que se qualificam hoje:

| Operação | Container | Por quê |
|---|---|---|
| Importação de contatos via CSV | Worker de Importação | Centenas de INSERTs em rajada. **Implementado na Etapa 2** |
| Geração de proposta em PDF | Gerador de Documentos | Renderização leva 2 a 5 s por documento. **Fora do escopo do semestre** (contrato, seção 10) |
| Disparo de alertas de contato frio | Serviço de Notificações | Varre a base do tenant e envia e-mails em lote. **Não implementado.** O serviço existe desde o bloco 10, mas só com o e-mail de confirmação de cadastro (fila `emails`, ver ADR-004) e, desde o bloco 14, o do link de exportação (nota de 10/11) |

### Os números e de onde saíram

| Parâmetro | Valor | Derivação |
|---|---|---|
| **Tamanho do lote** | 100 registros | A DevSolo acumula ~150 contatos em 12 meses e nunca importa em massa: um lote de 100 não a afeta. A TechConsult, com 1.200 contatos, precisa de 12 lotes |
| **Pausa entre lotes** | 500 ms | Devolve o banco às requisições interativas entre rajadas |
| ~~Intervalo entre jobs de importação~~ | ~~5 min~~ | **Retirado em 08/11/2026** (nota de revisão). Substituído pelas duas linhas seguintes |
| **Importações simultâneas por tenant** | 2 (Individual) / 5 (Equipe) | Impede que um tenant ocupe a fila inteira. Contadas no banco (`orbita.importacoes` com status `na_fila` ou `processando`); acima disso, 429 `IMPORTACOES_SIMULTANEAS` |
| **Concorrência do worker** | 2 importações ao mesmo tempo, somando todos os tenants | No máximo 2 × 100 = 200 linhas em gravação simultânea vindas de importação, venha de quantos tenants vier |
| **Linhas por importação** | 100 (Individual) / 5.000 (Equipe), e no máximo 1 MB | 100: a DevSolo nunca importa em massa. 5.000: 1.048.576 bytes ÷ ~200 bytes por linha ≈ 5.242, arredondado para baixo. Acima disso, 422 `LINHAS_ACIMA_DO_PLANO`, e o cliente divide o arquivo |

O número de 100 por lote não é arredondamento: ele vem da comparação entre as duas personas. É grande o bastante para a TechConsult migrar sua base sem supervisão (1.200 contatos = 12 lotes, 11 pausas × 500 ms = 5,5 s de pausa, mais o tempo de gravação; na versão original, com o intervalo de 5 min, era cerca de uma hora), e pequeno o bastante para que nenhum lote individual represente carga perceptível para a DevSolo. A verificação disso é o cenário **CQ-01** de [`../atributos.md`](../atributos.md).

### Como o tenant atravessa a fila

O `tenant_id` viaja no payload do job e volta para a API no token de serviço de cada chamada do worker
(trechos simplificados de `services/api-contatos/src/fila.js` e `services/importacao/src/processar.js`):

```js
// API — enfileira. O tenant vem do JWT (request.user), nunca do cliente; o CSV vai junto (até 1 MB)
await fila.add('importar',
  { importacao_id, tenant_id: req.user.tenant_id, request_id: req.id, csv: req.body },
  { jobId: importacao_id }                // idempotência: o mesmo job não entra duas vezes
);

// Worker — consome. Não toca o schema orbita: manda cada lote para a API
async function processarImportacao(job) {
  const { importacao_id, tenant_id, csv } = job.data;
  const { validos, erros } = validarCsv(csv);
  const lotes = fatiar(validos, 100);
  await api.inicio(ctx, lotes.length, erros.length);
  for (let i = 0; i < lotes.length; i++) {
    // token de serviço novo a cada chamada, com o claim tenant_id e 60 s de vida
    const { aplicado } = await api.lote(ctx, i + 1, lotes[i]);
    if (aplicado && i < lotes.length - 1) await esperar(500);
  }
}
```

Quem grava os contatos é a API, dentro de `withTenant` (`set_config('app.tenant_id', $1, true)`), sujeita ao
RLS como qualquer outra rota. O worker não tem caminho privilegiado: o papel `importacao_svc` não tem nenhum
GRANT no schema `orbita` (T-RLS-07). Um worker que gravasse por fora seria uma porta dos fundos no isolamento
decidido no ADR-001. Por que a gravação passa pela API, e não pelo banco com RLS, está no
[ADR-004](adr-004-comunicacao-entre-servicos.md).

**Ao estourar um limite**, a resposta é explícita e chega na hora, antes da fila:

- 429 `IMPORTACOES_SIMULTANEAS`, com o `limite` do plano no corpo;
- 422 `LINHAS_ACIMA_DO_PLANO`, com `limite` e `linhas`.

Não há tempo de espera no corpo: a vaga abre quando uma importação termina, e o Portal mostra o progresso das
que estão em andamento. Recusar explicitamente é melhor do que aceitar e degradar: o tenant sabe o que
aconteceu e o produto continua previsível para os outros 44.

### Rate limit por tenant

Não estava na versão original. A fila protege o banco do trabalho **pesado**. O rate limit protege a API de
uma **rajada de requisições leves**: um script com o token de um tenant, ou um Portal com defeito chamando a
busca sem parar.

| Limite | Valor | Conta |
|---|---|---|
| Por tenant, somando todas as rotas | 60 req/min **por usuário permitido no plano** | Individual: 1 usuário × 60 = **60/min**. Equipe: 10 usuários × 60 = **600/min**. 60/min é um clique por segundo em rajada, mais do que uma pessoa faz usando o Portal |
| Login | 10 req/min por IP + e-mail (em minúsculas) | Dificulta força bruta numa conta sem travar quem errou a senha 2 ou 3 vezes |
| Cadastro de tenant | 60 req/min por IP (`LIMITE_CADASTRO_POR_MIN`) | Barra criação de contas em massa a partir de um mesmo endereço |
| Confirmação de e-mail (`GET /auth/confirmar`) **(bloco 10)** | 10 req/min por IP | Rota pública, sem tenant. Uma pessoa clica no link 1 ou 2 vezes; o limite protege banco e CPU de quem martela a rota com lixo |
| Link de exportação (`GET /conta/exportacao/arquivo`) **(bloco 14)** | 10 req/min por IP | Pública como a confirmação, mas pesa mais: cada chamada válida monta o JSON inteiro do tenant |
| Fora do limite | `/saude`, `/planos` e `/interno/*` | `/saude` e `/planos` só leem memória ou fazem um `SELECT 1`: checar o limite (uma ida ao Redis) custaria mais que a resposta. `/interno` é o worker, que já se limita (lote + pausa + `concurrency: 2`) |

- **Os números vêm do `planos.js`:** os limites ficam em `services/api-contatos/src/planos.js`, que é a única
  fonte desses números.
- **Ao estourar:** 429 `LIMITE_REQUISICOES` com `Retry-After`. As respostas limitadas trazem também
  `x-ratelimit-limit`, `x-ratelimit-remaining` e `x-ratelimit-reset` ([`../contrato-api.md`](../contrato-api.md),
  seção 1).
- **Requisição sem token não conta:** o limite roda depois da autenticação, e o 401 sai antes.
- **Provas:** T-RL-01 a T-RL-07.

**Onde fica o contador: no Redis, com `skipOnError: true`.**

- **Por que não em memória:** no kind, a API roda com 2 réplicas. Em memória, cada réplica contaria separado, e
  o limite dobraria sem ninguém perceber (2 × 60 = 120 req/min no Individual).
- **Com o Redis fora,** o limite é ignorado e a API continua respondendo (T-RES-04).
- **Risco aceito:** enquanto o Redis estiver fora, não há rate limit, nem o de login.
- **Alternativa rejeitada:** derrubar a API inteira porque o contador está indisponível. Seria trocar um risco
  de abuso por uma indisponibilidade certa.

## Consequências

### Positivas

O pico de um tenant vira rajadas curtas em vez de um bloqueio longo, o que torna o cenário CQ-01 cumprível e transforma a consequência negativa do ADR-001 em risco controlado. Importações grandes deixam de falhar por timeout de HTTP, já que a requisição só enfileira. A infraestrutura de fila serve às três operações pesadas com uma peça só, e os limites por tenant ficam explícitos — viram dimensão de plano, conversando com o modelo comercial em vez de serem um acidente de capacidade.

### Negativas

**A importação deixa de ser instantânea.** O usuário envia o arquivo e recebe o resultado depois, não na hora. *Mitigação:* o Portal Web consulta `GET /importacoes/:id` e mostra o progresso (lotes aplicados ÷ total de lotes) e, ao concluir, "X contatos importados, Y linhas com erro". Percepção de progresso resolve a maior parte do desconforto de espera. ~~Aviso por e-mail ao concluir depende do Serviço de Notificações (planejado, bloco 10).~~ O Serviço de Notificações existe desde o bloco 10, mas o aviso por e-mail ao concluir a importação **não foi feito** (nota de 10/11).

**Mais uma peça para operar.** Redis é um componente novo, com seu próprio modo de falhar. Se a fila cair, importações e propostas param — ainda que o CRM continue funcionando para leitura e cadastro manual. *Mitigação:* com o Redis fora, só `POST /importacoes` responde 503 e o resto da API segue (T-RES-03 e 04). Retry com backoff exponencial (3 tentativas, espera de 2 s e 4 s). Jobs que falham ficam 24 h no Redis para investigação (`removeOnFail`). **Correção de 08/11:** o Redis roda **sem persistência em disco**; se ele reiniciar, os jobs pendentes podem se perder. O efeito e a mitigação estão no [ADR-004](adr-004-comunicacao-entre-servicos.md).

**Jobs podem rodar duas vezes** em caso de falha e retry. *Mitigação:* a importação é idempotente em três camadas — `jobId` igual ao id da importação, lote registrado em `orbita.lotes_aplicados` e upsert por `(tenant_id, email)`. Reprocessar um lote não grava de novo, e reimportar o arquivo atualiza em vez de duplicar (T-IMP-09, T-IMP-14).

**O limite vai incomodar alguém.** Um tenant Individual com mais de 100 contatos precisa dividir o arquivo; um tenant Equipe com mais de 5.000 também. *Avaliação:* aceitável. Na versão original, com o intervalo de 5 min, 3.000 contatos levavam "várias horas" (30 jobs × 5 min ≈ 2,5 h). Hoje são 30 lotes, 29 pausas × 500 ms = 14,5 s de pausa, num único arquivo do Equipe. A alternativa — deixar um tenant degradar os outros 44 — continua pior. Para bases acima de 5.000, oferecemos migração assistida fora do horário comercial.

## Gatilhos de revisão

| Gatilho | Por quê |
|---|---|
| CQ-01 falhar em produção por 2 meses seguidos | Os parâmetros de lote e pausa estão errados para a carga real |
| Mais de 20% dos tenants estourarem a quota mensalmente | A quota está apertada demais e virou atrito comercial |
| Fila acumular mais de 1.000 jobs pendentes | Faltam workers; reavaliar escala horizontal (e refazer a conta da `concurrency: 2`, ADR-004) |
| Mais de 20% dos tenants receberem 429 de rate limit num mês | 60 req/min por usuário está apertado para o uso real do Portal |
| A medição do CQ-01 no Postgres de produção real (disco de rede incluído) também não mostrar diferença entre com e sem a mitigação | **Registrado em 08/11/2026 (bloco 9).** O [ensaio do CQ-01](../ensaios/cq01-2026-11-08.md) não achou diferença medível, nem com o Postgres limitado a 1 vCPU e 2 GB: o máximo na janela foi de 7,7 ms com a mitigação e 5,6 ms sem ela. A pausa custa ~25 s por importação de 5.000 linhas, contra < 1 s sem ela. A decisão **não muda agora**, porque o ensaio rodou em disco NVMe local, num núcleo rápido. Se confirmar, reavaliar: pausa menor, pausa só acima de um tamanho, ou pausa adaptativa pela latência do banco |

## Referências

- [ADR-001 — Pool com RLS](adr-001-tenancy.md), consequência "o vizinho barulhento é real"
- Cenário CQ-01: [`../atributos.md`](../atributos.md)
- Containers Fila de Trabalhos e Worker de Importação: [`../02-arquitetura-c4.md`](../02-arquitetura-c4.md)
- Comunicação entre a API e a Importação, CSV no payload, quedas: [ADR-004](adr-004-comunicacao-entre-servicos.md)
