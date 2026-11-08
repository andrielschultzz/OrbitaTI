# Ensaio: Lighthouse mobile do Portal Web (07/11/2026)

**Bloco 13, Fase 5, item 4.** Metas: Acessibilidade ≥ 95, Boas práticas ≥ 95, Desempenho ≥ 90 e JS
inicial ≤ 170 KB gzip, medidos em `/entrar` e `/contatos`.

> **Contra o simulador, não contra a API real.** Nesta data a API (blocos 2, 4 e 12) ainda não existe.
> O Portal foi medido servido pela imagem de produção do nginx, com o `/api` apontando para o simulador
> do contrato (`web/simulador/`). As telas, o JS e o CSS são os de produção; o que muda na stack real é
> o tempo de resposta da API, que entra pouco nestas notas (`/contatos` faz 2 chamadas pequenas).
> Repetir na Fase 6.

## Máquina e software

| Item | Valor |
|---|---|
| Máquina | Notebook, Intel Core i5-13420H (12 núcleos lógicos), 23,7 GB de RAM |
| Sistema | Windows 11 Home Single Language 10.0.26200 |
| Docker | Docker Desktop, engine 29.7.2 |
| Imagem medida | `orbitati/web:0.1.0` (build `node:22-alpine` → `nginxinc/nginx-unprivileged:1.28-alpine`) |
| API por trás do nginx | Simulador do contrato (Fastify, em memória), porta 3001, via `API_UPSTREAM=host.docker.internal:3001` |
| Navegador | Chromium 158.0.8127.18 (o do Playwright 1.65.0), headless, `--lang=pt-BR` |
| Lighthouse | 12.8.2, rodado via puppeteer-core 24.43.1 (os dois por `npx`, fora do `package.json`) |
| Node.js | v24.20.0 (só para rodar o script; a imagem usa Node 22) |

## Configuração da medição

- **Perfil:** o padrão "mobile" do Lighthouse: Moto G Power emulado (412 × 823), CPU 4× mais lenta e
  rede 4G lenta **simulada** (150 ms de RTT, 1,6 Mbit/s). Simulada quer dizer que o Lighthouse carrega
  em velocidade local e calcula o tempo que levaria na rede lenta. Por isso o resultado depende pouco da
  máquina.
- **Primeira visita:** o cache HTTP é limpo antes de cada medição.
- **Sessão:** `/contatos` exige login. O token fica no `sessionStorage`, que é por aba, então o login e
  a medição acontecem na mesma aba (Lighthouse "user flow"). O `npx lighthouse <url>` puro abriria uma aba
  nova sem sessão e mediria a tela de login.
- **Tema:** forçado pela preferência do próprio Portal (`localStorage`). O script confere e registra o
  tema aplicado em cada medição.
- **Dados:** conta de demonstração do simulador (Marcelo, DevSolo: 5 contatos, 4 deles no "Saindo de órbita").

**Para repetir:** com o Portal no ar em `http://localhost:8080` (simulador + `docker run`, ver `README.md`):

```
cd web
npm run lighthouse
```

O script é `web/scripts/medir-lighthouse.mjs`. Relatórios HTML completos ficam em `web/lighthouse/` (fora do git).

## Resultado final (imagem com todas as correções da Fase 5 e o mapa estático)

| Medição | Tema | Desempenho | Acessibilidade | Boas práticas | SEO | FCP | LCP | TBT | CLS | JS (gzip) |
|---|---|---|---|---|---|---|---|---|---|---|
| `/entrar`, aba nova (pior caso) | sistema (claro) | **93** | 100 | 100 | 100 | 2,6 s | 2,7 s | 20 ms | 0,012 | 103,3 KB |
| `/entrar` | claro | 98 | 100 | 100 | 100 | 1,9 s | 2,0 s | 0 ms | 0,011 | 103,3 KB |
| `/entrar` | escuro | 98 | 100 | 100 | 100 | 1,9 s | 2,0 s | 20 ms | 0,012 | 103,3 KB |
| `/contatos` | claro | 96 | 100 | 100 | 100 | 1,9 s | 2,4 s | 50 ms | 0 | 112,4 KB |
| `/contatos` | escuro | 97 | 100 | 100 | 100 | 1,9 s | 2,4 s | 20 ms | 0,002 | 112,4 KB |

**Todas as metas batidas, inclusive no pior caso.**

**Orçamento de JS.** O JS inicial (gzip, medido pelo Lighthouse na rede) é de 103,3 KB em `/entrar` e
112,4 KB em `/contatos`. O limite é 170 KB. Saída do `vite build`:

```
dist/assets/index-*.js      230.65 kB │ gzip: 73.04 kB   (React, React Router, casca)
dist/assets/cliente-*.js     43.97 kB │ gzip: 16.30 kB   (cliente HTTP, sessão, ícones compartilhados)
dist/assets/Entrar-*.js       2.90 kB │ gzip:  1.46 kB
dist/assets/Contatos-*.js    15.68 kB │ gzip:  5.45 kB
dist/assets/index-*.css      34.75 kB │ gzip:  7.88 kB
```

Cada tela é carregada sob demanda (`React.lazy`): quem abre `/entrar` não baixa o código de Contatos.

**Por que a aba nova dá 93 e não 98.** Na aba nova, tudo acontece na primeira navegação. Nas medições
por tema houve uma navegação antes para gravar o tema. O cache HTTP foi limpo, mas o navegador já estava
"aquecido" (processo e conexão abertos). O número que vale para a meta é o pior, 93.

**O que segura o desempenho abaixo de 100:**

1. **Recursos que bloqueiam a primeira pintura** (até ~150 ms estimados): o CSS e o `tema-inicial.js`.
   O script de tema **precisa** rodar antes de pintar. Sem ele, quem escolheu o tema claro veria a tela
   escura piscar. Não vale mexer.
2. **JS não usado na primeira tela** (~33 KB): o React DOM e o React Router vêm inteiros no bundle
   principal. Dividir mais custaria complexidade para ganhar décimos de segundo. Não vale agora.

## Histórico desta rodada (mesmo dia, mesma máquina)

| Momento | `/entrar` | `/contatos` | O que mudou |
|---|---|---|---|
| 1ª medição | 93 (aba nova) | 100 | **Descartada para `/contatos`**: para manter a sessão o Lighthouse não limpou o armazenamento, e com isso o cache HTTP também ficou cheio (JS = 0 KB). SEO 91: o `/robots.txt` caía no fallback da SPA e devolvia HTML |
| 2ª medição | 92 (aba nova) | 97 | Cache HTTP limpo antes de medir `/contatos`; `public/robots.txt` criado (SEO 100) |
| 3ª medição | 98 / 98 | 96 / 96 | Claro / escuro, depois das correções de foco e alvos de toque; contraste aprovado nos dois temas |
| **Final** (tabela acima) | 93 a 98 | 96 a 97 | Mapa de órbita estático; medido pelo `npm run lighthouse` |

A variação de 92 a 93 na aba nova, entre a 1ª, a 2ª e a final, é ruído normal do Lighthouse
(±2 a 3 pontos entre execuções).
