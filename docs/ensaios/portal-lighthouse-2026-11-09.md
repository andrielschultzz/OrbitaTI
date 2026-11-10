# Ensaio: Lighthouse mobile do Portal Web contra a API real (09/11/2026)

**Bloco 13, Fase 6, item 9 de `docs/portal-pendencias.md`.** Repete o
[ensaio de 07/11](portal-lighthouse-2026-11-07.md), que foi feito contra o simulador do contrato, agora
com o Portal ligado na API real pelo compose. Metas iguais: Acessibilidade ≥ 95, Boas práticas ≥ 95,
Desempenho ≥ 90 e JS inicial ≤ 170 KB gzip, em `/entrar` e `/contatos`.

## O que mudou em relação a 07/11

| Item | 07/11 (simulador) | 09/11 (stack real) |
|---|---|---|
| Atrás do nginx | Simulador em memória (`docker run` + `API_UPSTREAM=host.docker.internal:3001`) | `api-contatos` + PostgreSQL 16 + Redis, pelo serviço `web` do `docker compose` |
| nginx | `proxy_pass` com o nome resolvido uma vez | `resolver` + upstream em variável (resolve a cada 10 s) e `rewrite` do `/api` |
| Dados | DevSolo do simulador (4 contatos no "Saindo de órbita") | DevSolo do `npm run seed` (3 no "Saindo de órbita": a API real não tem o "nunca contatado" frio, ver `docs/portal-pendencias.md`, item 4) |

Máquina, navegador, Lighthouse e perfil (mobile, 4G lenta simulada, cache HTTP limpo) são os mesmos
de 07/11.

**Para repetir:** com a stack no ar (`docker compose up -d --build --wait` e `npm run seed`):

```
cd web
npm run lighthouse
```

> **Rode pelo PowerShell (ou cmd), não pelo Git Bash.** Pelo Git Bash o puppeteer falha ao abrir o
> Chromium (`Error: spawn UNKNOWN`, errno -4094). No PowerShell, se a política de execução bloquear o
> `npm.ps1`, use `npm.cmd run lighthouse`.

## Resultado

| Medição | Tema | Desempenho | Acessibilidade | Boas práticas | SEO | FCP | LCP | TBT | CLS | JS (gzip) |
|---|---|---|---|---|---|---|---|---|---|---|
| `/entrar`, aba nova (pior caso) | sistema | **92** | 100 | 100 | 100 | 2,5 s | 2,8 s | 10 ms | 0,012 | 103,3 KB |
| `/entrar` | claro | 98 | 100 | 100 | 100 | 1,9 s | 2,0 s | 0 ms | 0,011 | 103,3 KB |
| `/entrar` | escuro | 98 | 100 | 100 | 100 | 1,9 s | 2,0 s | 0 ms | 0,012 | 103,3 KB |
| `/contatos` | claro | 97 | 100 | 100 | 100 | 1,8 s | 2,4 s | 20 ms | 0 | 112,4 KB |
| `/contatos` | escuro | 97 | 100 | 100 | 100 | 1,9 s | 2,4 s | 30 ms | 0,015 | 112,4 KB |

**Todas as metas batidas, inclusive no pior caso (92 ≥ 90).**

**Comparação com 07/11:** praticamente igual. O pior caso foi de 93 para 92, dentro do ruído do
Lighthouse (±2 a 3 pontos entre execuções, ver o histórico de 07/11). O JS é o mesmo build (103,3 e
112,4 KB). Era o esperado: `/contatos` faz só 2 chamadas pequenas à API, e o banco local responde em
poucos milissegundos, então trocar o simulador pela API real quase não mexe nas notas.

**O que esta medição NÃO mostra:** a latência da API sob carga. Quem mede isso é o CQ-01
([ensaio de 08/11](cq01-2026-11-08.md)).
