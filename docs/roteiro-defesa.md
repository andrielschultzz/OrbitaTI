# Roteiro da defesa — demo de 10 minutos

**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen · **Atualizado em:** 10/11/2026 (Bloco 15)

**Onde roda:** tudo no notebook, sem internet. A decisão está em
[D-15.1](pendencias-bloco-7.md) (publicar numa VM ficou fora do escopo).

- **Docker Compose**: o Portal e as duas demos (isolamento e degradação).
- **kind**: só para mostrar o deploy, com `kubectl get pods`, 2 réplicas e `rollout restart` sem queda.

**Regra para os comandos:** use sempre `127.0.0.1`, nunca `localhost`. No Windows, `localhost` pode tentar
primeiro o IPv6 (`::1`) e somar atraso ou falhar. Foi o achado O1 do bloco 11, e por isso os scripts usam
`127.0.0.1`. Todos os comandos rodam no **PowerShell**, na pasta do repositório.

---

## 0. Checklist da véspera

Faça tudo isto **na véspera**, e de novo 30 minutos antes da banca. Cada item tem o resultado esperado.

### Máquina

- [ ] Notebook **na tomada** e plano de energia em "Melhor desempenho". Na bateria, o Windows reduz a CPU e
      os tempos da demo mudam.
- [ ] **Suspensão e desligamento de tela desligados.** Em Configurações → Sistema → Energia, ponha "Nunca"
      na tomada. Se o notebook dormir, o Docker Desktop pode perder a rede do kind.
- [ ] **Aplicativos pesados fechados:** navegador com muitas abas, IDE com indexação, Teams, OneDrive
      sincronizando e atualização do Windows (pause por 1 semana).
- [ ] Notificações do Windows em "Não incomodar".
- [ ] Fonte do terminal em 18 pt ou mais, porque a banca lê do projetor. Abra **três terminais** já na
      pasta do repositório: o T1 para as demos, o T2 para o kind e o T3 para a sonda.

### Docker e stack

- [ ] **Docker Desktop aberto** e com a baleia "running". O cluster kind só volta depois que o Docker
      Desktop termina de subir.
- [ ] Compose no ar, **sem `--build`**. O build baixa a imagem base `node:22-alpine` e pacotes do npm, e
      isso precisa de internet.

      ```
      docker compose up -d --wait
      docker compose ps
      ```

      Esperado: `postgres`, `redis`, `api-contatos`, `importacao`, `notificacoes`, `mailpit` e `web` todos
      `Up (healthy)`. O `migrate` aparece como `Exited (0)`, que é normal: ele roda e termina.
- [ ] Saúde pelo Portal: `curl.exe -s http://127.0.0.1:8080/api/saude` → `{"db":"ok","fila":"ok"}`.
- [ ] Contas de demonstração: `npm run seed`. Ele é idempotente e pode rodar quantas vezes quiser.
      Contas: `marcelo@devsolo.dev` (DevSolo, Individual) e `gestor@techconsult.com.br` (TechConsult, Equipe),
      as duas com a senha `Demo@2026`.
- [ ] kind no ar:

      ```
      kubectl config current-context
      kubectl get nodes
      kubectl get pods -n orbitati
      ```

      Esperado: o contexto `kind-saas`, o nó `Ready` e, no namespace `orbitati`, 2 pods `api-contatos-*`,
      2 pods `web-*` e 1 de cada um de `importacao`, `notificacoes`, `mailpit`, `postgres` e `redis`, todos
      `Running` e `READY 1/1`. Também pode aparecer o Job `migrate` como `Completed`.
- [ ] **A imagem do kind está atualizada.** A correção do login (B12, em 10/11) mexeu no Portal, então a
      imagem `web` do kind precisa ser reconstruída uma vez, **com internet**, antes do ensaio sem Wi-Fi:

      ```
      powershell -ExecutionPolicy Bypass -File .\scripts\deploy-kind.ps1
      ```

      Depois disso, **espere os pods antigos sumirem** com `kubectl get pods -n orbitati -w`, até não
      sobrar nenhum `Terminating`. Motivo: o `rollout status` retorna antes de o último pod antigo sair.
      Veja o achado 7 abaixo.
- [ ] Saúde pelo kind: `curl.exe -s http://127.0.0.1:30080/api/saude` → `{"db":"ok","fila":"ok"}`.
- [ ] O seed também no kind. O `deploy-kind.ps1` já roda; se tiver usado `-SemSeed`, rode:
      `$env:SEED_URL='http://127.0.0.1:30080/api'; npm run seed; Remove-Item Env:SEED_URL`.

### Ensaio completo com o Wi-Fi desligado

- [ ] **Desligue o Wi-Fi** (e o cabo de rede) e rode a demo inteira, da seção 1 à 6, cronometrando cada
      passo. Ela só pode ser feita assim se **nenhuma imagem precisar ser baixada na hora**. O que esse
      ensaio pega:
  - um `docker compose up` que tentaria fazer build ou pull: no dia, use só `up -d --wait`;
  - um pod do kind em `ImagePullBackOff` ou `ErrImagePull`. Todos os manifests usam
    `imagePullPolicy: IfNotPresent`, mas Postgres, Redis e Mailpit o nó do kind baixa sozinho do Docker
    Hub (`deploy-kind.ps1`). Se o nó for recriado, eles somem e precisam de internet de novo;
  - as fontes do Portal. Se alguma tela depender de recurso externo, aparece aqui.
- [ ] Anote os tempos do ensaio aqui:
  - demo de isolamento: TODO
  - demo de degradação: TODO
  - rollout restart: TODO
- [ ] Religue o Wi-Fi só depois do ensaio. No dia, **apresente com o Wi-Fi desligado**: assim nenhuma
      atualização ou sincronização entra no meio.

### Plano B geral, preparado na véspera

- [ ] Capturas do Portal: `cd web; npm run capturas`. Elas ficam em `web/e2e/capturas/`, fora do git.
      Copie 4 delas para uma pasta na área de trabalho: entrar, contatos, contato e conta.
- [ ] Uma saída completa de cada demo salva em arquivo de texto, para mostrar se o comando falhar ao vivo:

      ```
      powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1 -SemPausa -BaseUrl http://127.0.0.1:8080/api > $HOME\Desktop\demo-isolamento.txt
      powershell -ExecutionPolicy Bypass -File .\scripts\demo-degradacao.ps1 -SemPausa > $HOME\Desktop\demo-degradacao.txt
      ```

- [ ] Abas abertas no editor de Markdown (o VS Code com preview já serve; não depende de internet):
      [`02-arquitetura-c4.md`](02-arquitetura-c4.md), os relatórios de [`ensaios/`](ensaios/) e esta página.
- [ ] Se o PR do Bloco 15 já estiver no GitHub, uma captura de tela do CI verde (jobs `api` e `web`). Na
      banca não haverá internet.

---

## 1. Abertura: o problema e a arquitetura (1 min)

**Mostrar:** o diagrama "o que existe hoje" do [C4](02-arquitetura-c4.md) (seção "Estado final").

**Dizer:**
- "O OrbitaTI é um CRM para profissional de TI autônomo e consultoria de até 10 pessoas. Muitas empresas
  dividem o mesmo banco."
- "O risco número 1 é um cliente ver o dado do outro. Por isso o isolamento tem 3 camadas:
  1. o tenant vem só do token assinado, nunca de um parâmetro (ADR-002);
  2. toda consulta passa pelo `withTenant`;
  3. o próprio banco filtra, com RLS em `ENABLE` + `FORCE` (ADR-001)."
- "São 3 serviços: a API, o worker de importação e o de notificações. Eles conversam por fila e por rotas
  internas com token de serviço (ADR-004)."

**Plano B:** se o editor não abrir, desenhe no quadro as 3 caixas (Portal → API → banco), mais a fila e o
worker, e fale por cima. O diagrama é o mesmo.

## 2. O produto no Portal (1,5 min)

**Comando:** nenhum. Abra no navegador **http://127.0.0.1:8080**.

**Mostrar:**
1. Entre com `marcelo@devsolo.dev` / `Demo@2026`.
2. A lista de contatos e o mapa de órbita.
3. Abra um contato e registre uma interação. O estágio muda e a lista "Saindo de órbita" se atualiza.

**Dizer:**
- "Cadastrar um contato leva 30 segundos: só o nome é obrigatório."
- "Os contatos esfriam quando não há interação. É a lista 'Saindo de órbita'."
- "O Portal foi feito contra um contrato escrito antes da API. No dia em que ligamos na API real, os 33 E2E
  passaram sem nenhuma mudança." (achado 6)

**Cuidado:** digite o e-mail com calma. Se errar o formato (por exemplo, `a@b`), o Portal mostra "E-mail
inválido." no campo. Isso também é comportamento testado (B12), não um erro.

**Plano B:**
- Se o Portal não abrir, teste `curl.exe -s http://127.0.0.1:8080/api/saude`.
- Se a saúde responder, recarregue a página com Ctrl+F5.
- Se não responder, rode `docker compose restart web` e espere uns 10 s.
- Se ainda assim falhar, mostre as capturas da área de trabalho e siga.

## 3. Isolamento ao vivo (2 min)

**Comando (T1), pelo Portal, que é o caminho do usuário com o nginx no meio:**

```
powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1 -BaseUrl http://127.0.0.1:8080/api
```

O script pausa entre os passos. Use Enter para avançar enquanto explica.

**Mostrar:**
1. As duas empresas entram, e cada uma vê só os seus contatos.
2. A DevSolo tenta **ler, alterar e excluir** um contato da TechConsult pelo id: **404 nas três**.
3. A TechConsult relê o contato, e ele está intacto.

**Dizer:**
- "É 404 e não 403 de propósito. O 403 confirmaria que o id existe em outra empresa; o 404 não revela nada."
- "Quem barra é o banco: o RLS filtra pelo tenant da sessão. Mesmo com um bug no código da rota, o
  `SELECT` volta vazio."
- "Esse é o CQ-02: 100% das tentativas cruzadas dão 404. A suíte `tests/isolamento.test.js` prova isso no CI
  a cada push. O T-ISO-15 confere que **toda** rota com dado de tenant tem caso de teste, então uma rota nova
  sem teste quebra o build."

**Rastro no log (T1):**

```
docker compose logs api-contatos | Select-String recurso_nao_encontrado | Select-Object -Last 3
```

"Todo 404 em rota com `:id` gera o evento `recurso_nao_encontrado` com tenant, rota e id. É assim que se
investiga uma tentativa cruzada."

**Plano B:**
- Se o script falhar no login com 401, rode `npm run seed` e repita.
- Se falhar com 429 (muitas tentativas de login em 1 minuto), espere 60 s ou use a API direta, que tem
  contador separado:
  `powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1 -BaseUrl http://127.0.0.1:3000`.
- Se nada funcionar, mostre o `demo-isolamento.txt` da área de trabalho e rode só a suíte:
  `npx vitest run tests/isolamento.test.js`.

## 4. Degradação: um serviço cai e o resto segue (2,5 min)

**Comando (T1):**

```
powershell -ExecutionPolicy Bypass -File .\scripts\demo-degradacao.ps1
```

São 10 passos e o script derruba e religa tudo sozinho. Se o tempo estiver curto, use `-SemPausa`, deixe
rodar e comente a saída.

**Mostrar e dizer, passo a passo:**

| Passo | Evento | O que acontece |
|---|---|---|
| 2 a 5 | **O worker cai** | O CRM continua funcionando (T-RES-01). A importação enviada fica na fila e conclui sozinha quando o worker volta (T-RES-02). "É por isso que a importação é assíncrona: o worker pode cair sem levar o produto junto." |
| 6 a 8 | **O Redis cai** | Só o `POST /importacoes` responde 503, e responde rápido (T-RES-03). Login, contatos e busca seguem (T-RES-04). Quando o Redis volta, a importação funciona sem reiniciar a API (T-RES-05). |
| 9 e 10 | **O banco cai** | `/saude` responde 503, mas a API e o worker **não reiniciam** (T-RES-07). "Isso foi um bug real que achamos no kind." (achado 4) |

**Plano B:**
- Se um passo travar, pare com Ctrl+C e religue tudo com `docker compose up -d --wait`. Esse comando não
  baixa nada, porque as imagens já estão locais.
- Depois mostre o `demo-degradacao.txt` da área de trabalho.
- Os testes unitários do achado 4 rodam sem a stack: `npx vitest run services/api-contatos/test/pool-erro.test.js`.

## 5. Deploy no kind: 2 réplicas e restart sem queda (2 min)

**Comando (T2):**

```
kubectl get pods -n orbitati -o wide
```

**Dizer:** "No kind, a API e o Portal têm 2 réplicas cada um. O Portal fica na NodePort 30080, e a API só é
acessível por dentro, como ClusterIP, atrás do nginx."

**Liga a sonda (T3)** antes do restart. É o mesmo comando do ensaio T-CQ04-02:

```
powershell -ExecutionPolicy Bypass -File .\scripts\sonda.ps1 -Url http://127.0.0.1:30080/api/saude -Minutos 2 -IntervaloSegundos 1
```

**Restart (T2)**, uns 15 s depois:

```
kubectl -n orbitati rollout restart deployment/web
kubectl -n orbitati rollout status deployment/web
kubectl get pods -n orbitati -w
```

Saia do `-w` com Ctrl+C quando não houver mais `Terminating`.

**Mostrar:** os pods novos nascendo, os antigos saindo um de cada vez e a sonda sem falhas.

**Dizer, contando o que foi medido** ([ensaio T-CQ04-02](ensaios/cq04-02-web-2026-11-09.md)):
- "Quando um pod sai, o Kubernetes ainda manda tráfego a ele por uma fração de segundo. O `preStop: sleep 5`
  segura o pod de pé nesse intervalo."
- "Medimos com um laço de `curl` de 7 a 8 requisições por segundo. **Sem** o `preStop`, as 4 rodadas tiveram
  falhas, de 7 a 12 cada uma. **Com** ele, 818 de 818 respostas 200. A rodada que falhou com `preStop`
  tinha outra causa (achado 7). Depois disso, 1.195 de 1.195."
- "A sonda a 1 por segundo que vocês estão vendo **não distingue** os dois casos. A janela é de frações de
  segundo, e no ensaio ela deu 120 de 120 com e sem `preStop`. Ela mostra que o serviço ficou de pé; quem
  prova o `preStop` é o laço denso."

**Opcional (se sobrar tempo, no T3, no lugar da sonda):** o laço denso, por 30 s.

```
$fim=(Get-Date).AddSeconds(30); $ok=0; $falha=0; while((Get-Date) -lt $fim){ $c=curl.exe -s -o NUL -w "%{http_code}" -m 2 http://127.0.0.1:30080/api/saude; if($c -eq '200'){$ok++}else{$falha++} }; "200: $ok   falhas: $falha"
```

**Plano B:**
- Se o `kubectl` não responder ("Unable to connect to the server"), o Docker Desktop provavelmente reiniciou
  o kind. Rode `kubectl get nodes` e espere `Ready`, de 1 a 2 min. Enquanto isso, mostre o relatório do
  T-CQ04-02 e os CSVs em [`ensaios/`](ensaios/).
- Se um pod ficar em `ImagePullBackOff`, a imagem não está no nó (o ensaio sem Wi-Fi deveria ter pegado).
  Não tente consertar ao vivo: mostre o relatório.

## 6. Fechamento: os testes pegam erro de verdade (1 min)

Escolha 2 ou 3 achados da seção abaixo e feche assim: "a suíte não é decorativa. Cada um destes erros foi
pego por um teste ou por uma medição, e cada um tem o arquivo de evidência no repositório."

**Plano B:** nenhum. É fala.

---

## Achados: os testes pegaram erro de verdade

| # | Achado | Como foi pego | Evidência |
|---|---|---|---|
| 1 | **A função de login nasceu aberta a todos os papéis** (B6). Na 1ª versão da migração, o `REVOKE ... FROM PUBLIC` vinha depois do `ALTER FUNCTION ... OWNER TO orbita_auth`. Sem ser mais o dono, o migrador não podia mudar as permissões. O PostgreSQL só emitiu um WARNING, e a função que contorna o RLS ficou executável por qualquer papel. | O **T-RLS-19** confere quem pode executar cada função `SECURITY DEFINER`. Correção: as permissões vêm antes da troca de dono, e o `migrate.js` agora **falha** se o PostgreSQL emitir qualquer WARNING numa migração. | [`pendencias-bloco-7.md`](pendencias-bloco-7.md), linha B6; [`tests/rls.test.js`](../tests/rls.test.js) (T-RLS-19); [`db/migrate.js`](../db/migrate.js) |
| 2 | **Chave estrangeira ignora o RLS.** A verificação de FK do PostgreSQL não passa pelo RLS. Com uma FK só em `contato_id`, um erro de código poderia pendurar uma interação de A num contato de B. | A FK das interações é **composta**, `(contato_id, tenant_id)`. O **T-RLS-20** tenta o INSERT cruzado e o banco recusa com 23503. | [`db/migrations/003_interacoes.sql`](../db/migrations/003_interacoes.sql); [`tests/rls.test.js`](../tests/rls.test.js) (T-RLS-20); [`contrato-api.md`](contrato-api.md), seção de isolamento |
| 3 | **CVE do `trustProxy` no Fastify** (J4). Desde a 5.12.1 (advisory GHSA-3m5p-2c4r-xxw2, CVE-2026-16732), `trustProxy: <número>` deixou de confiar em qualquer proxy. Com isso, o rate limit de login por IP passaria a contar todo mundo como o mesmo IP do proxy. | Achado no bloco 5 e provado com um teste mínimo contra o `request.js` das versões 5.10.0 a 5.12.8, além da documentação do Fastify. Correção: `TRUST_PROXY_SALTOS` **e** conexão vinda de rede interna (`confiarNoProxy`). O **T-RL-06** (integração e unitário) trava a correção: cada IP do `X-Forwarded-For` tem o próprio contador, e o cabeçalho só vale quando vem de proxy da rede interna. | [`pendencias-bloco-7.md`](pendencias-bloco-7.md), J4 a J6; [`tests/rate-limit.test.js`](../tests/rate-limit.test.js); [`services/api-contatos/test/limite.test.js`](../services/api-contatos/test/limite.test.js) |
| 4 | **A API caía junto com o banco** (K7). Com o Postgres desligado no kind, as 2 réplicas da API e o worker reiniciaram no mesmo instante. O `pg.Pool` emitia `'error'` sem ouvinte, e o Node derrubava o processo. No compose, o `restart: unless-stopped` escondia o problema. | Achado no ensaio do kind (bloco 6). Correção: `pool.on('error')` com log `banco_conexao_perdida`. Os unitários `pool-erro.test.js`, um em cada serviço, falham sem a correção. A prova no kind (**T-RES-07**) foi repetida com **RESTARTS 0**, e a queda do banco entrou na demo de degradação. | [`pendencias-bloco-7.md`](pendencias-bloco-7.md), seção 9.2 (K7); [`services/api-contatos/test/pool-erro.test.js`](../services/api-contatos/test/pool-erro.test.js); [`services/importacao/test/pool-erro.test.js`](../services/importacao/test/pool-erro.test.js) |
| 5 | **CQ-01 sem diferença com e sem a mitigação.** Com o Postgres do tamanho de produção (1 vCPU, 2 GB), o p95 das buscas durante a importação foi de 5,1 ms. Sem o lote de 100 com pausa, o máximo foi de 5,6 ms; com ele, 7,7 ms, dentro do ruído. A pausa custa ~25 s por importação de 5.000 linhas. | A medição com k6 (bloco 9), com veredito calculado só na janela da importação. A decisão **não mudou**, porque o ensaio rodou em NVMe local. Virou **gatilho de revisão** no ADR-003. | [`ensaios/cq01-2026-11-08.md`](ensaios/cq01-2026-11-08.md); [ADR-003, "Gatilhos de revisão"](adr/adr-003-processamento-assincrono.md#gatilhos-de-revisão) |
| 6 | **Contrato primeiro, sem divergência.** O Portal foi construído inteiro contra um simulador do contrato, antes de a API existir. | Na Fase 6 do bloco 13, os mesmos **33 E2E passaram 33/33 contra a API real** (compose e kind), sem mudar nada no contrato nem no Portal. O bloco 14 levou a suíte a 35, e o B12 do Bloco 15 a 36. Em 10/11 foram 36/36 nos dois. A única divergência achada depois (B12, login com e-mail malformado) foi corrigida com um E2E novo. | [`portal-pendencias.md`](portal-pendencias.md); [`contrato-api.md`](contrato-api.md); [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (E2E contra a API real no job `api`) |
| 7 | **O `rollout status` retorna antes de o pod sair.** Ele termina quando o ReplicaSet antigo chega a 0 réplicas, ou seja, quando o último pod antigo é **marcado** para sair, e não quando termina. As 10 falhas de uma rodada "com `preStop`" vinham de um pod antigo **sem** `preStop` que ainda recebia tráfego. | A linha do tempo do ensaio (pods e requisições com horário). Lição: depois de trocar uma configuração, espere os pods antigos sumirem antes de medir. | [`ensaios/cq04-02-web-2026-11-09.md`](ensaios/cq04-02-web-2026-11-09.md), seção da anomalia; [`cq04-02-web-2026-11-10-prestop-pods.txt`](ensaios/cq04-02-web-2026-11-10-prestop-pods.txt) |

---

## Se a banca pedir para rodar a suíte

```
npm test
```

A stack do compose precisa estar no ar. Leva TODO (cronometrar no ensaio). O `TESTES_LENTOS=1` acrescenta
~25 s (T-IMP-13, a pausa de 500 ms); só use se pedirem. No PowerShell: `$env:TESTES_LENTOS='1'; npm test`.

Os E2E do Portal contra a API real: `cd web; $env:E2E_URL='http://127.0.0.1:8080'; npm run test:e2e`.
Resultado esperado: 36 passed.
