# SLO — OrbitaTI

Arquitetura de Software SaaS (8512), SETREM 2026-2. Entregável 3.4 da Etapa 3. Primeira versão, a partir da ficha do Encontro 16 (19/11/2026).

**Fluxo crítico:** `GET /contatos?busca=...`, a busca de contatos do Portal. É a operação que o usuário repete o dia todo: o profissional de TI abre o OrbitaTI para achar um cliente antes de responder uma mensagem ou ligar. Se ela ficar lenta ou falhar, a reclamação vem primeiro daqui. O health check e a página estática não entram.

| Métrica | Fórmula | Meta | Justificativa de negócio |
| --- | --- | --- | --- |
| Latência de `GET /contatos?busca=...` | p95 do tempo de resposta, medido no servidor | < 800 ms | O limiar do fluxo para o usuário é 1.000 ms. Descontados 200 ms de rede em 4G, sobram 800 ms para o servidor. A busca é o que o cliente faz com o contato do WhatsApp aberto ao lado; acima de 1 s, ele volta para a planilha, que é justamente o que o produto quer substituir. |
| Erro de `GET /contatos?busca=...` | requisições com falha / total de requisições (código 400 ou mais, incluindo 429, ou sem resposta) | < 1% | Uma busca que falha é um contato que o usuário não encontra na hora em que precisa, e esse contato pode ser o próximo contrato. O 429 conta como falha porque, para o cliente, é um pedido perdido. Meta arbitrada: 1% de falhas, ou 1 busca em cada 100. |

## Pico

Meta arbitrada, com a premissa abaixo.

- **Quando:** horário comercial de dia útil, com vários tenants ativos ao mesmo tempo e um deles rodando uma importação em massa de contatos. É o cenário do CQ-01 (`docs/atributos.md`).
- **Quantos:** 10 usuários buscando ao mesmo tempo, cada um com uma busca a cada 3 s, durante uma importação de 500 contatos ou mais.
- **Premissa:** em 12 meses, o OrbitaTI tem 45 tenants (36 no plano Individual, com 1 usuário, e 9 no plano Equipe, com até 10), o que dá no máximo cerca de 126 usuários cadastrados. Assumimos que uma fração pequena deles busca ao mesmo tempo; 10 simultâneos é o mesmo valor que o CQ-01 já usa, o que mantém os dois documentos consistentes. Se o k6 mostrar folga grande, o pico pode ser aumentado na versão final.
- **Ritmo:** uma busca a cada 3 s dá 20 requisições por minuto por usuário, abaixo do rate limit de 60 por minuto por usuário. Assim o 429 não aparece por causa do próprio script de carga.

## Limiar no k6

```js
export const options = {
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};
```

Em thresholds, 1% se escreve `0.01`. Se uma das duas medições violar o limiar, a execução do k6 falha.

## O que muda em relação à ficha e referências

- A ficha preenchida em aula tem a mesma operação, os mesmos números de latência e de erro e o mesmo pico. Este arquivo apenas escreve as justificativas por extenso.
- A latência parte do CQ-01 (`docs/atributos.md`): p95 < 800 ms, medido em 08/11/2026 em 5,1 ms com a mitigação de importação, no Postgres de produção (1 vCPU, 2 GB). A meta está muito acima do valor medido de propósito: ela vem do orçamento do fluxo (1.000 ms menos a rede), e não do desempenho atual.
- Os números do pico e do erro são premissas arbitradas. A versão final, junto com a Etapa 3 em 26/11, usa os mesmos números que o k6 rodar, e o resultado vai para `docs/carga-enc14.md`.
