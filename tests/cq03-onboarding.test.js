// T-CQ03-01 (CQ-03, docs/atributos.md): do envio do formulário de cadastro até o e-mail de confirmação
// entregue, p90 < 45 s em 20 cadastros.
//
// O que é medido: do instante ANTES do POST /auth/cadastro até a mensagem aparecer na API do Mailpit.
// Passa por tudo o que a arquitetura controla: Argon2, INSERT do tenant e do usuário (banco), enfileirar
// (Redis), o worker de notificações pegar o job e o SMTP entregar ao Mailpit.
// O que NÃO é medido: o provedor real de e-mail, que é 96% do orçamento de 45 s (30 s + margem). Ele não
// existe localmente. Ressalva registrada em docs/ensaios/cq03-2026-11-08.md.
//
// Resolução: o Mailpit é consultado a cada 100 ms, então cada amostra pode vir até 100 ms "atrasada".
// Os cadastros são em SEQUÊNCIA, para cada medida ser de um cadastro sozinho, como no uso real.
// p90 de 20 = 18º valor ordenado (⌈0,9 × 20⌉; docs/plano-de-testes.md, seção 4).
//
// Pré-requisito: docker compose up -d --build --wait
import { afterAll, describe, expect, it } from 'vitest';
import { SENHA, chamar, emailUnico, limparTenants, payload, registrarTenant } from './apoio/api.js';
import { apagar, esperarMensagem } from './apoio/mailpit.js';

const CADASTROS = 20;
const ALVO_P90_MS = 45_000;
// Uma mensagem que não chega em 60 s já estoura o p90 se acontecer 3 vezes; esperar mais não muda o veredito.
const ESPERA_MAXIMA_MS = 60_000;

/** Percentil pelo método "nearest rank": o ⌈p × n⌉-ésimo valor ordenado. */
const percentil = (ordenados, p) => ordenados[Math.ceil(p * ordenados.length) - 1];

const emails = [];
afterAll(async () => {
  await Promise.all(emails.map(apagar));
  await limparTenants();
});

describe('T-CQ03-01: onboarding self-service, do POST ao e-mail entregue', () => {
  it(`p90 de ${CADASTROS} cadastros < 45 s`, async () => {
    const tempos = [];
    for (let i = 0; i < CADASTROS; i++) {
      const email = emailUnico('cq03');
      emails.push(email);
      const inicio = performance.now();
      const r = await chamar('POST', '/auth/cadastro', {
        corpo: { empresa: `CQ-03 ${i + 1}`, plano: 'individual', nome: 'Pessoa CQ-03', email, senha: SENHA },
        // 20 pessoas diferentes, cada uma do seu IP (192.0.2.1 a 20, RFC 5737), como no uso real. Num IP
        // só, os 20 cadastros + os do resto da suíte esbarrariam no limite de 60/min ao rodar duas vezes.
        headers: { 'x-forwarded-for': `192.0.2.${i + 1}` },
      });
      expect(r.status).toBe(201);
      registrarTenant(payload(r.corpo.token).tenant_id);
      const { ms } = await esperarMensagem(email, { inicio, limiteMs: ESPERA_MAXIMA_MS });
      tempos.push(ms);
    }

    const ordenados = [...tempos].sort((a, b) => a - b);
    const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
    const p50 = percentil(ordenados, 0.5);
    const p90 = percentil(ordenados, 0.9);
    const maximo = ordenados.at(-1);
    console.log(
      `CQ-03 (${CADASTROS} cadastros): p50 ${s(p50)} · p90 ${s(p90)} · máximo ${s(maximo)} · alvo p90 < ${s(ALVO_P90_MS)}\n` +
        `  amostras (ms, em ordem de execução): ${tempos.map((t) => Math.round(t)).join(', ')}`,
    );
    expect(p90).toBeLessThan(ALVO_P90_MS);
  }, CADASTROS * ESPERA_MAXIMA_MS + 30_000);
});
