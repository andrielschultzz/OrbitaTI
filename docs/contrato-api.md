# Contrato HTTP da API de Contatos

**Versão:** 1.4 — 08/11/2026, derivada do `CLAUDE.md` e dos blocos 2, 4, 5, 10, 12 e 14.
Mudanças da 1.1 (Fase 0 do bloco 13): `GET /planos/atual` virou `GET /planos` pública; dados extras de erro no nível de cima; lacuna dos papéis declarada.
Mudanças da 1.2 (bloco 4): e-mail repetido no CSV vira erro de linha (o simulador mudou junto); separador decidido pelo cabeçalho; reimportação não apaga dado com célula vazia; respostas, limites e erros das rotas `/interno` definidos (seção 8). Nenhuma rota usada pelo Portal mudou de formato.
Mudanças da 1.3 (bloco 7): headers `x-ratelimit-*` documentados na seção 1 (já eram enviados desde o bloco 5); decisões da seção 11 registradas no ADR-004. Nenhum formato mudou.
Mudanças da 1.4 (bloco 10): `GET /auth/confirmar` implementada, com rate limit de 10/min por IP; todo token ruim (ausente, vencido, adulterado, de sessão) é `LINK_INVALIDO`, nunca `VALIDACAO`; o cadastro passa a enfileirar o e-mail de confirmação. Nenhum formato mudou.

## Para que serve

É o acordo entre o Portal Web e a API, escrito **antes** do código.

- O backend (blocos 2, 4, 5, 10, 12 e 14) implementa exatamente isto.
- O Portal (bloco 13) consome exatamente isto. Enquanto a API não existir, ele usa um simulador que segue este arquivo.
- Os testes (Vitest e Playwright) conferem status e formatos contra isto.

**Por que contrato primeiro:** o Portal e a API podem ser construídos em paralelo, por pessoas diferentes, sem que um espere o outro. E existe uma só resposta para a pergunta "o que essa rota devolve?".

**Precedência:** o `CLAUDE.md` vale mais que este contrato, que vale mais que o texto dos blocos. Se o código precisar divergir, atualize este arquivo **no mesmo passo** e avise. Nunca diverja em silêncio.

---

## 1. Convenções

- **Base.** Testes e scripts chamam a API direto, em `http://localhost:3000`. O Portal chama a mesma API por `/api/...`, na própria origem; o Nginx remove o prefixo. Os caminhos abaixo são os da API, sem `/api`.
- **Formato.** JSON UTF-8 em tudo, menos o corpo de `POST /importacoes` (text/csv).
- **Datas.** ISO 8601 em UTC (`2026-11-07T19:30:00.000Z`). O Portal converte para o fuso do navegador.
- **Identificadores.** Todos são UUID. Um `:id` que não é UUID responde **404** (não 400 nem 500): para quem chama, é só um recurso que não existe, e o Postgres nunca recebe um texto que não é UUID.
- **E-mails.** Sempre devolvidos em minúsculas.
- **Campos opcionais vazios.** Vêm como `null`, nunca omitidos.
- **Autenticação.** `Authorization: Bearer <token>` em todas as rotas, menos as públicas (marcadas abaixo).
- **`x-request-id`.** Aceito na requisição ou gerado; sempre devolvido na resposta.
- **Nenhuma requisição leva `tenant_id`** (regra 1). Propriedades extras no corpo são descartadas pelo Fastify, então um `tenant_id` no corpo é ignorado (T-ISO-06).
- **Nenhuma resposta devolve `tenant_id`.** O Portal não precisa dele, e esconder reduz o que um atacante aprende. As exceções são o próprio token (assinado) e a exportação LGPD (dados do próprio tenant).
- **Rate limit.** Vale para todas as rotas, menos `/saude`, `/planos` e `/interno/*` (bloco 5). Quando estoura, a resposta é 429 com header `Retry-After` (segundos até poder tentar de novo).
  - **Toda resposta de rota limitada** (não só o 429) traz também três headers, que o Portal pode usar para avisar antes de estourar:

    | Header | Significado |
    |---|---|
    | `x-ratelimit-limit` | Limite da janela de 1 min que vale para esta requisição: 60 ou 600 por tenant (plano), 10 no login, `LIMITE_CADASTRO_POR_MIN` no cadastro, 10 na confirmação de e-mail |
    | `x-ratelimit-remaining` | Quantas requisições ainda cabem nesta janela |
    | `x-ratelimit-reset` | Segundos até a janela recomeçar |

  - Com o Redis fora, o limite é ignorado (`skipOnError`) e esses headers podem não vir: o Portal não pode depender deles para funcionar.
  - `/saude` e `/planos` ficam fora porque só leem memória (o `planos.js`) ou fazem um `SELECT 1`: checar o limite, que é uma ida ao Redis, custaria mais que a própria resposta.

---

## 2. Formato de erro (um só para a API inteira)

```json
{ "erro": "Mensagem em português, pronta para mostrar ao usuário.", "codigo": "NAO_ENCONTRADO" }
```

- **`erro`** é texto para gente. O Portal pode mostrar direto, ou trocar por um texto mais específico numa tela.
- **`codigo`** é um identificador estável para programa. O Portal e os testes decidem pelo `codigo`, nunca comparando texto.
- **Validação (400)** traz também os campos: `"campos": [{ "campo": "email", "erro": "E-mail inválido." }]`.
- **Dados extras de um erro** ficam no nível de cima, ao lado de `erro` e `codigo`, nunca dentro de outro objeto:
  - 422 `LINHAS_ACIMA_DO_PLANO`: `{"erro": "...", "codigo": "LINHAS_ACIMA_DO_PLANO", "limite": 100, "linhas": 253}`;
  - 429 `IMPORTACOES_SIMULTANEAS`: `{"erro": "...", "codigo": "IMPORTACOES_SIMULTANEAS", "limite": 2}`.
- **Implementação.** Um `setErrorHandler` e um `setNotFoundHandler` no `buildApp()` traduzem para este formato tudo o que o Fastify gera sozinho: validação, 413 do `bodyLimit`, 415, JWT inválido e o 429 do `@fastify/rate-limit` (via `errorResponseBuilder`).
- **Erro inesperado (500)** nunca devolve stack trace.

| Status | `codigo` | Quando | `erro` |
|---|---|---|---|
| 400 | `VALIDACAO` | Corpo ou query fora do schema | Confira os campos destacados. |
| 400 | `LINK_INVALIDO` | Token de confirmação ou de exportação inválido ou vencido | Este link é inválido ou venceu. |
| 401 | `NAO_AUTENTICADO` | Sem token, ou token inválido, adulterado ou expirado | Sua sessão expirou. Entre de novo. |
| 401 | `CREDENCIAIS_INVALIDAS` | Login com e-mail inexistente, senha errada ou tenant cancelado. **Mesmo corpo nos três casos** (T-AUTH-05) | E-mail ou senha incorretos. |
| 403 | `SEM_PERMISSAO` | Papel sem permissão **dentro do próprio tenant** (ex.: consultor em `/conta/*`, T-LGPD-01) | Seu perfil não tem permissão para isso. |
| 404 | `NAO_ENCONTRADO` | Recurso inexistente **ou de outro tenant**: mesmo status e mesmo corpo (regra 5, T-ISO-05). Em rota com `:id`, a API registra no log o evento `recurso_nao_encontrado` (`tenant_id`, `metodo`, `rota`, `id`); a resposta não muda (T-ISO-19) | Contato não encontrado. / Importação não encontrada. |
| 409 | `EMAIL_JA_CADASTRADO` | Cadastro com e-mail de usuário que já existe | Esse e-mail já tem conta. |
| 409 | `EMAIL_DUPLICADO` | Contato com e-mail já usado no mesmo tenant | Já existe um contato com esse e-mail. |
| 413 | `ARQUIVO_GRANDE` | Corpo acima de 1 MB (1.048.576 bytes) | O arquivo passa de 1 MB. Divida a planilha em partes menores. |
| 415 | `TIPO_NAO_SUPORTADO` | `Content-Type` errado | Formato não suportado. Envie um arquivo CSV. |
| 422 | `CSV_VAZIO` | CSV sem nenhuma linha de dados | O arquivo não tem nenhum contato. |
| 422 | `CSV_SEM_COLUNAS` | Cabeçalho sem a coluna `nome` ou sem a coluna `email` | A primeira linha precisa ter as colunas nome e email. |
| 422 | `LINHAS_ACIMA_DO_PLANO` | Mais linhas do que o plano permite. Traz `limite` e `linhas` | Seu plano permite até {limite} linhas por importação. |
| 429 | `LIMITE_REQUISICOES` | Rate limit por tenant, de login (IP + e-mail), de cadastro (IP) ou de confirmação de e-mail (IP). Com `Retry-After` | Muitas ações seguidas. Tente de novo em instantes. |
| 429 | `IMPORTACOES_SIMULTANEAS` | Já existem 2 (Individual) ou 5 (Equipe) importações `na_fila` ou `processando`. Traz `limite` | Você já tem importações em andamento. Aguarde uma terminar. |
| 503 | `FILA_INDISPONIVEL` | Redis fora no `POST /importacoes` | Importação indisponível no momento. O restante do sistema segue funcionando. |
| 500 | `ERRO_INTERNO` | Qualquer erro não previsto | Erro interno. Se continuar, informe o código {x-request-id}. |

---

## 3. Token de sessão

- **Formato:** JWT HS256 assinado com `JWT_SEGREDO`.
- **Validade:** 15 min (`exp − iat = 900`, T-AUTH-07), sem refresh. Ao expirar, o usuário entra de novo (decisão 9 de `prompts/decisoes-plano-de-testes.md`).
- **Claims:** `sub` (id do usuário), `tenant_id`, `plano` (`individual` | `equipe`), `papel` (`admin` | `consultor` | `visualizador`), `iat` e `exp`.
- **O que o Portal faz com ele:** decodifica, sem verificar, só para ler `plano`, `papel` e `exp`, e decidir o que mostrar. Quem decide permissão é sempre a API.

---

## 4. Rotas públicas

### `GET /saude` — bloco 2 (a parte da fila entra no bloco 4)

| Situação | Status | Corpo |
|---|---|---|
| Tudo no ar | 200 | `{"db":"ok","fila":"ok"}` |
| Só a fila fora | 200 | `{"db":"ok","fila":"fora"}` (T-RES-04) |
| Banco fora | 503 | `{"db":"fora","fila":"ok"}` ou `"fora"` |

### `POST /auth/cadastro` — bloco 2

```json
{ "empresa": "DevSolo Sistemas", "plano": "individual", "nome": "Marcelo", "email": "marcelo@devsolo.dev", "senha": "Demo@2026" }
```

| Campo | Regra |
|---|---|
| `empresa`, `nome` | 1 a 120 caracteres |
| `plano` | `individual` ou `equipe` |
| `email` | válido, até 254 caracteres (limite do RFC 5321), gravado em minúsculas |
| `senha` | 8 a 128 caracteres. O mínimo de 8 segue o NIST SP 800-63B; o máximo de 128 impede que uma senha gigante gaste CPU no Argon2 |

- **Sucesso:** `201 {"token": "..."}`. O usuário criado é `admin`.
- **E-mail de confirmação (bloco 10):** depois do COMMIT, a API enfileira um e-mail com o link de confirmação (fila `emails`, Serviço de Notificações). Se a fila estiver fora, o cadastro responde 201 do mesmo jeito e só registra aviso no log: o e-mail nunca impede o onboarding.
- **Erros:** 400 `VALIDACAO`; 409 `EMAIL_JA_CADASTRADO`, também com o e-mail em maiúsculas (T-AUTH-02); 429.

### `POST /auth/login` — bloco 2

- **Corpo:** `{"email": "...", "senha": "..."}`
- **Sucesso:** `200 {"token": "..."}`
- **Erros:** 401 `CREDENCIAIS_INVALIDAS`; 429 (10 por minuto por IP + e-mail).

### `GET /auth/confirmar?token=` — bloco 10

- **Sucesso:** `200 {"confirmado_em": "..."}`. Clicar de novo no link devolve a **mesma** data (a da primeira confirmação).
- **Erro:** 400 `LINK_INVALIDO` para **qualquer** token que não sirva: ausente, vazio, maior que 2 KB, vencido, adulterado, de usuário que não existe mais ou **de sessão**. Nunca `VALIDACAO`: a tela só precisa conhecer um código. 429 `LIMITE_REQUISICOES` acima de 10 por minuto por IP.
- **Token:** JWT assinado pela API, válido por 24 h, com `finalidade: "confirmar-email"`. Não serve como token de sessão (nas rotas autenticadas dá 401), e o token de sessão não serve aqui.
- **O login não exige confirmação.**
- **Link do e-mail:** aponta para o **Portal**, em `${PORTAL_URL}/confirmar-email?token=...`, e a tela chama esta rota. `PORTAL_URL` vem do ambiente: `http://localhost:8080` local e a URL da VM depois. Nunca escreva "localhost" no código.

### `GET /conta/exportacao/arquivo?token=` — bloco 14

- Link assinado que vai no e-mail de cancelamento, válido por 30 dias. O endereço é `${PORTAL_URL}/api/conta/exportacao/arquivo?token=...`.
- **Sucesso:** devolve o mesmo JSON de `GET /conta/exportacao`, com `Content-Disposition: attachment`. O navegador baixa o arquivo direto.
- **Erro:** 400 `LINK_INVALIDO`.

---

## 5. Contatos (autenticadas)

### Objeto Contato

```json
{
  "id": "0b8f…",
  "nome": "João Servidor",
  "email": "joao@exemplo.com.br",
  "telefone": "(54) 99999-0000",
  "empresa": "Mercado Bom Preço",
  "observacao": "Quer orçamento de rede para a filial",
  "estagio": "lead",
  "ultima_interacao_em": "2026-08-01T13:00:00.000Z",
  "criado_em": "2026-07-10T12:00:00.000Z",
  "atualizado_em": "2026-08-01T13:00:00.000Z"
}
```

| Campo | Regra |
|---|---|
| `nome` | obrigatório, 1 a 120 caracteres |
| `email` | opcional (regra 9), até 254 caracteres, único por tenant |
| `telefone` | opcional, até 30 caracteres, texto livre como a pessoa digitar |
| `empresa` | opcional, até 120 caracteres |
| `observacao` | opcional, até 500 caracteres. É "uma linha de contexto" (visão do produto); 500 cabem com folga |
| `estagio` | `lead` \| `proposta` \| `cliente` \| `perdido`, padrão `lead`. Só existe a partir do bloco 12 |
| `ultima_interacao_em` | `null` até a primeira interação |

### `GET /contatos?busca=` — bloco 2

- **`busca`:** opcional, até 100 caracteres. Procura por `ILIKE` em nome, e-mail e empresa.
- **Sucesso:** `200 {"itens": [Contato, ...], "limite": 100}`, ordenado por nome.
- **Lista cheia:** se vierem `limite` itens, pode haver mais; o Portal pede para refinar a busca. O `limite` vem na resposta para o Portal não ter esse número fixo no código.

### `POST /contatos` — bloco 2

- **Corpo:** só `nome` é obrigatório. `estagio` é aceito a partir do bloco 12.
- **Sucesso:** `201 Contato`.
- **Erros:** 400 `VALIDACAO`; 409 `EMAIL_DUPLICADO`.

### `GET /contatos/:id` — bloco 2

- **Sucesso:** `200 Contato`.
- **Erro:** 404 `NAO_ENCONTRADO`.

### `PATCH /contatos/:id` — bloco 2 (`estagio` a partir do bloco 12)

- **Corpo:** parcial; só os campos enviados mudam. `null` limpa um campo opcional. `nome` não pode ser `null` nem vazio.
- **Sucesso:** `200 Contato`.
- **Erros:** 400; 404; 409 `EMAIL_DUPLICADO`.

### `DELETE /contatos/:id` — bloco 2

- **Sucesso:** `204`, sem corpo.
- **Erro:** 404.
- **Efeito:** apaga junto as interações do contato (`interacoes.contato_id` com `ON DELETE CASCADE`, bloco 12). Sem isso, excluir um contato com histórico daria erro de chave estrangeira, que viraria 500.

### `GET /contatos/esfriando?dias=90&limite=100` — bloco 12

- **Parâmetros:** `dias` de 1 a 365, padrão 90; `limite` de 1 a 100, padrão 100. O Portal pede `limite=5`.
- **Regra:** a data de referência é `COALESCE(ultima_interacao_em, criado_em)`. Entra na lista o contato cuja referência é mais antiga que `dias` dias, menos os de estágio `perdido`. A ordem é da referência mais antiga para a mais nova.
  - **Por que `criado_em` e não "nunca contatado = mais frio":** depois de importar 500 contatos, todos estariam "nunca contatados" e lotariam o "Saindo de órbita" no primeiro dia. Com a referência, um contato só esfria depois de `dias` dias parado, desde o cadastro ou desde a última conversa.
- **Sucesso:** `200 {"itens": [Contato + campos extras], "dias": 90, "limite": 5}`. Os campos extras são:
  - `dias_sem_interacao`: inteiro, contado a partir da referência;
  - `nunca_contatado`: booleano, `true` quando `ultima_interacao_em` é `null`.
- **Ordem de registro das rotas:** o caminho fixo `/contatos/esfriando` tem prioridade sobre `/contatos/:id` no Fastify. Como o `:id` é validado como UUID, "esfriando" nunca cai nele.

---

## 6. Interações (autenticadas) — bloco 12

### Objeto Interação

```json
{ "id": "…", "contato_id": "…", "usuario_id": "…", "tipo": "whatsapp", "nota": "Pediu orçamento até sexta", "ocorrida_em": "…", "criado_em": "…" }
```

- **`tipo`:** `ligacao` | `whatsapp` | `email` | `reuniao` | `outro`.
- **`nota`:** opcional, até 2.000 caracteres.

### `GET /contatos/:id/interacoes`

- **Sucesso:** `200 {"itens": [Interação, ...]}`, da mais recente para a mais antiga (`ocorrida_em`).
- **Erro:** 404 se o contato não existe ou é de outro tenant (T-ISO-16).

### `POST /contatos/:id/interacoes`

- **Corpo:** `{"tipo": "...", "nota": "...", "ocorrida_em": "..."}`.
  - `ocorrida_em` é opcional; o padrão é agora.
  - Não pode estar no futuro, com 5 min de tolerância para o relógio do celular adiantado.
- **Sucesso:** `201 {"interacao": Interação, "contato": Contato}`. O contato já vem atualizado, para o Portal não reimplementar a regra abaixo.
- **Regra:** na mesma transação, `ultima_interacao_em = GREATEST(ultima_interacao_em, ocorrida_em)`. Registrar hoje uma ligação da semana passada não pode fazer o contato parecer mais frio.
- **Erros:** 400; 404.

---

## 7. Importações (autenticadas) — bloco 4

### Formato do CSV

- **Cabeçalho obrigatório** na primeira linha. As colunas reconhecidas são `nome`, `email`, `telefone`, `empresa` e `observacao`.
  - Antes de comparar, os nomes são normalizados: minúsculas, sem acento, sem espaço e sem hífen. Assim "E-mail" vira `email` e "Observação" vira `observacao`.
  - `nome` e `email` são obrigatórias (regra 9). Colunas extras são ignoradas.
- **Separador:** `,` ou `;` (o Excel em português usa `;`). Aceita BOM UTF-8 (PowerShell 5).
  - O separador é decidido **uma vez**, pela linha do cabeçalho (o que aparecer mais vezes), e vale para o arquivo inteiro. Assim `"Silva, João"` num arquivo com `;` continua sendo uma coluna só.
- **Contagem:** linhas de dados = linhas não vazias depois do cabeçalho.
- **Linha inválida** (vira erro de linha e conta em `linhas_invalidas`; as outras linhas seguem):
  - `nome` vazio ou com mais de 120 caracteres;
  - `email` vazio ou inválido (a mesma regra de e-mail do `POST /contatos`);
  - **`email` repetido no mesmo arquivo** (sem diferença entre maiúsculas e minúsculas): a primeira ocorrência entra, as seguintes viram erro "e-mail repetido (já aparece na linha N)". Sem isso, "X contatos importados" contaria duas vezes o mesmo contato.
- **Opcionais** (`telefone`, `empresa`, `observacao`): célula vazia vira `null`; acima do limite do `POST /contatos` (30, 120 e 500 caracteres), o texto é cortado.
- **E-mail que já existe no tenant:** o contato é **atualizado**, não duplicado (regra 8). O `nome` sempre atualiza; uma célula vazia **não apaga** o telefone, a empresa ou a observação que já existiam.
- **Modelo:** `web/public/modelo-contatos.csv`, com o cabeçalho `nome;email;telefone;empresa;observacao`.

### `POST /importacoes`

- **Requisição:** `Content-Type: text/csv` (com ou sem `; charset=utf-8`), corpo de até 1 MB.
- **O que a API faz, nesta ordem:**
  1. lê **só o cabeçalho** e conta as linhas;
  2. confere o limite do plano e as importações simultâneas (contadas no banco);
  3. grava em `orbita.importacoes` com status `na_fila`, `total_linhas` preenchido e `total_lotes` nulo;
  4. enfileira o job (`jobId = importacao_id`). Se enfileirar falhar, desfaz o registro e responde 503.
- **Sucesso:** `202 {"importacao_id": "…"}`.
- **Erros:** 413 `ARQUIVO_GRANDE`; 415 `TIPO_NAO_SUPORTADO`; 422 `CSV_VAZIO`, `CSV_SEM_COLUNAS` ou `LINHAS_ACIMA_DO_PLANO` (com `limite` e `linhas`); 429 `IMPORTACOES_SIMULTANEAS` (com `limite`) ou `LIMITE_REQUISICOES`; 503 `FILA_INDISPONIVEL`.

### `GET /importacoes/:id`

```json
{
  "id": "…", "status": "processando",
  "total_linhas": 253, "linhas_invalidas": 3,
  "total_lotes": 3, "lotes_aplicados": 1,
  "criado_em": "…", "concluida_em": null
}
```

- **Status:** `na_fila` → `processando` → `concluida`, ou `falhou`. Enquanto está `na_fila`, `total_lotes` e `linhas_invalidas` vêm `null`, porque quem os calcula é o worker.
- **Erro:** 404 (T-ISO-08).
- **O que o Portal mostra:**
  - progresso: `lotes_aplicados / total_lotes`;
  - ao concluir: "{total_linhas − linhas_invalidas} contatos importados, {linhas_invalidas} linhas com erro".
  - O detalhe de cada linha com erro fica no schema `importacao`, que a API não lê (regra 10), e por isso não aparece no Portal.

### `GET /planos` — bloco 4 (**pública**, sem token e sem rate limit)

```json
{
  "itens": [
    { "plano": "individual", "nome": "Individual", "preco_mensal_centavos": 4900,
      "limites": { "usuarios": 1, "linhas_por_importacao": 100, "importacoes_simultaneas": 2, "requisicoes_por_minuto": 60, "tamanho_maximo_csv_bytes": 1048576 } },
    { "plano": "equipe", "nome": "Equipe", "preco_mensal_centavos": 24900,
      "limites": { "usuarios": 10, "linhas_por_importacao": 5000, "importacoes_simultaneas": 5, "requisicoes_por_minuto": 600, "tamanho_maximo_csv_bytes": 1048576 } }
  ]
}
```

- Tudo vem do `planos.js`, que passa a guardar também o preço. O tamanho máximo vem da configuração do `bodyLimit`.
- **Preço em centavos (inteiro):** dinheiro em ponto flutuante acumula erro de arredondamento; o Portal formata com `Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'})`.
- **Pública** porque a tela de cadastro precisa mostrar os planos antes de existir um token. Não tem dado de tenant: é a mesma resposta para qualquer pessoa. Por isso fica fora da tabela de rotas de tenant do T-ISO-15 e entra na lista fixa de rotas públicas do mesmo teste, como `/auth/*` e `/saude`.
- **Sem rate limit** (seção 1): só lê memória.
- **Como o Portal usa:**
  - no cadastro, mostra os cartões dos planos com preço, usuários, linhas por importação e importações simultâneas. Nada de recurso que ainda não existe (propostas, webhooks, histórico);
  - depois do login, escolhe o plano atual pelo claim `plano` do token e mostra os limites dele na Conta e na Importação.
- **Para que serve:** o Portal mostra preços e limites sem copiar números. O `planos.js` continua sendo a única fonte.

---

## 8. Rotas internas — só entre serviços (bloco 4)

**Quem pode chamar:** só o worker de importação, com token de serviço. O token é assinado com `JWT_SERVICO_SEGREDO`, tem `iss: importacao`, `aud: api-contatos`, expira em 60 s e leva o claim `tenant_id` (regra 7). Um JWT de usuário recebe 401.

**O Portal nunca chama estas rotas.** O Nginx do Portal responde 404 para `/api/interno/`; a proteção de verdade é o token, e o bloqueio no Nginx é uma camada a mais.

| Rota | Corpo | Resposta 200 | O que faz |
|---|---|---|---|
| `POST /interno/importacoes/:id/inicio` | `{"total_lotes": 3, "linhas_invalidas": 3}` | `{"status": "processando"}` (o status depois da chamada) | O worker chama depois de validar o CSV. Muda o status para `processando` e grava os dois números. Se `total_lotes = 0` (todas as linhas inválidas), marca `concluida` na hora. Repetir não muda nada (**vale o primeiro `inicio`**, mesmo com números diferentes), para o retry do BullMQ ser seguro |
| `POST /interno/importacoes/:id/lotes` | `{"numero": 1, "contatos": [...]}` | `{"aplicado": true}` ou `{"aplicado": false}` | Upsert dos contatos e registro em `lotes_aplicados`. Lote já registrado → `{aplicado: false}`, sem aplicar de novo. Marca `concluida` quando `lotes_aplicados = total_lotes`. Lote que chega depois de `concluida` ou `falhou` → `{aplicado: false}`, sem aplicar |
| `POST /interno/importacoes/:id/falha` | `{"motivo": "..."}` (até 500 caracteres) | `{"status": "falhou"}` | O worker chama quando o job esgota as 3 tentativas, ou na hora quando o erro não tem conserto (CSV ilegível, 4xx da API). Marca `falhou`. O `motivo` vai para o log da API, não para o banco |

- **Contato no lote:** `nome` (1 a 120) e `email` (válido, até 254) obrigatórios; `telefone` (30), `empresa` (120) e `observacao` (500) opcionais, podendo ser `null`. Os mesmos limites do `POST /contatos`.
- **Tamanho do lote:** de 1 a 5.000 contatos (corpo até 4 MB). O normal são 100 (`IMPORT_LOTE`); o teto de 5.000 deixa o teste de carga rodar "sem a mitigação", com um lote só.
- **Erros:** 400 `VALIDACAO` (corpo fora do schema, ou `numero` maior que `total_lotes`); 401 `NAO_AUTENTICADO` (sem token de serviço válido, inclusive JWT de usuário e token de serviço com mais de 60 s de vida); 404 `NAO_ENCONTRADO` ("Importação não encontrada.").
- **Regras comuns às três:** importação de outro tenant responde 404 (T-ISO-09). Status `concluida` ou `falhou` nunca volta atrás: nesses casos `inicio` e `falha` só devolvem o status atual.
- **Por que `inicio` e `falha` existem.** Sem elas a importação poderia ficar presa para sempre:
  - **Total de lotes errado.** Se a API calculasse `total_lotes` contando também as linhas inválidas, 100 válidas + 3 inválidas dariam 2 lotes esperados contra 1 enviado, e a importação nunca chegaria a `concluida`.
  - **CSV todo inválido.** Nenhum lote seria enviado, e a importação nunca sairia de `na_fila`.
  - **Job que esgota as tentativas.** Ficaria `processando` para sempre.

  Em todos esses casos o Portal consultaria o progresso sem fim. Com as duas rotas, quem conhece os números certos (o worker) informa a API, e a API continua sem ler o schema `importacao` (regra 10).

---

## 9. Conta (autenticadas, só `admin`) — bloco 14

- **`GET /conta/exportacao`**
  - **Sucesso:** `200`, JSON com `Content-Disposition: attachment; filename="orbitati-exportacao-AAAA-MM-DD.json"`.
  - **Conteúdo:** `{"tenant": {...}, "usuarios": [...sem senha_hash], "contatos": [...], "interacoes": [...], "importacoes": [...]}`.
  - **Erro:** 403 `SEM_PERMISSAO` para quem não é admin.
- **`POST /conta/cancelamento`**
  - **Sucesso:** `200 {"cancelado_em": "...", "exportacao_disponivel_ate": "..."}`, sendo a segunda data o cancelamento + 30 dias.
  - **Efeitos:** a partir daí o login responde 401. O token já emitido vale até expirar (no máximo 15 min, sem denylist), por isso o Portal sai da conta logo depois de cancelar.
  - **Erro:** 403.

---

## 10. Fora deste contrato (lacunas conhecidas, decidir quando chegar)

- **Convidar usuários para a conta.** Não existe rota. Sem ela, o plano Equipe ("até 10 usuários") tem, na prática, um usuário só.
- **O que cada papel pode fazer.** O contrato só restringe `/conta/*` (só `admin`, 403 `SEM_PERMISSAO`). Não está definido se `visualizador` só lê nem o que `consultor` não pode. Até decidir, o Portal trata todos os papéis igual, menos `/conta/*`. Como hoje só existe o `admin` criado no cadastro (sem convite não há outros papéis), a lacuna não aparece na prática; ela é decidida junto com o convite.
- **Histórico de 6 meses no plano Individual** (visão do produto). Se for implementado, o limite vem do `planos.js`.
- **Propostas em PDF, webhooks, oportunidades e campos personalizados:** fora do escopo do semestre.

---

## 11. Decisões que este contrato introduz

Registradas no [ADR-004](adr/adr-004-comunicacao-entre-servicos.md) (bloco 7). Saber defender:

| Decisão | Por quê |
|---|---|
| Formato único de erro `{erro, codigo}` | O Portal e os testes decidem por código estável, não por texto; a mesma tela trata 429 de importação e 429 de rate limit de forma diferente |
| Respostas sem `tenant_id` | O cliente não precisa dele; menos informação exposta |
| `:id` que não é UUID → 404 | Evita 500 vindo do Postgres e não revela nada |
| "Esfriando" usa `COALESCE(ultima_interacao_em, criado_em)` | Uma importação não lota o "Saindo de órbita" no primeiro dia |
| Interação usa `GREATEST` | Lançar uma interação antiga não esfria o contato |
| `ON DELETE CASCADE` nas interações | Excluir um contato com histórico não pode dar 500 |
| Cabeçalho e colunas do CSV definidos; 422 para CSV vazio ou sem colunas | Fecha a lacuna "Formato do CSV" de `pendencias-bloco-7.md`; o erro chega na hora, não depois da fila |
| Rotas `/interno/.../inicio` e `/falha` | Sem elas a importação pode nunca concluir (seção 8) |
| E-mail repetido no mesmo CSV vira erro de linha (1.2) | O upsert de um lote com o mesmo e-mail duas vezes daria 500 no PostgreSQL; e "X contatos importados" contaria duas vezes o mesmo contato |
| Separador do CSV decidido pelo cabeçalho (1.2) | Aceitar `,` e `;` ao mesmo tempo quebraria `"Silva, João"` num arquivo do Excel em português |
| Reimportação não apaga dado com célula vazia (`COALESCE`) (1.2) | Uma planilha incompleta não pode destruir o telefone que alguém cadastrou à mão |
| `inicio`/`falha` respondem `{status}`; vale o primeiro `inicio`; lote depois de `falhou` não é aplicado (1.2) | Retry do BullMQ sempre seguro; o worker registra no log o status que a API ficou |
| `GET /planos` público, com preço em centavos, sem rate limit | O cadastro mostra os planos antes de existir token; o Portal mostra preços e limites sem duplicar o `planos.js`; a rota só lê memória, então o rate limit custaria mais que ela |
| Dados extras de erro (`limite`, `linhas`) no nível de cima | Um só formato para o Portal ler, sem objeto aninhado |
| Papéis tratados igual, menos `/conta/*` | Lacuna declarada (seção 10), decidida junto com o convite de usuários |
| `PORTAL_URL` nos links de e-mail | Os links funcionam local e na VM sem mudar código |
