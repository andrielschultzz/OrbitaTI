// T-OBS-03 (docs/plano-de-testes.md, seção 2.8; decisão 2): status HTTP do /saude nas 4 combinações.
// Unitário: buildApp() com banco e fila SIMULADOS, sem stack. O caso real (Redis parado de verdade)
// é o ensaio T-RES-04.
//
// O que se prova: só o banco decide o 503. Com a fila fora a API segue 200, e a readinessProbe do kind
// não tira as réplicas do ar por causa do Redis.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

// Base fictícia dos links de e-mail (PORTAL_URL). Só precisa ser uma URL válida.
const PORTAL_URL_TESTE = 'http://portal.teste';

const pool = (ok) => ({
  query: async () => {
    if (!ok) throw new Error('connect ECONNREFUSED (simulado)');
    return { rows: [{ '?column?': 1 }] };
  },
});
const fila = (ok) => ({ verificar: async () => ok, enfileirar: async () => {}, enfileirarEmail: async () => {} });

const casos = [
  { db: true, filaOk: true, status: 200, corpo: { db: 'ok', fila: 'ok' } },
  { db: true, filaOk: false, status: 200, corpo: { db: 'ok', fila: 'fora' } },
  { db: false, filaOk: true, status: 503, corpo: { db: 'fora', fila: 'ok' } },
  { db: false, filaOk: false, status: 503, corpo: { db: 'fora', fila: 'fora' } },
];

describe('T-OBS-03: GET /saude', () => {
  it.each(casos)('db $corpo.db + fila $corpo.fila -> $status', async ({ db, filaOk, status, corpo }) => {
    const app = buildApp({ jwtSegredo: 'x'.repeat(32), jwtServicoSegredo: 'y'.repeat(32), pool: pool(db), fila: fila(filaOk), limiteEmMemoria: true, portalUrl: PORTAL_URL_TESTE, logger: false });
    try {
      const r = await app.inject({ method: 'GET', url: '/saude' });
      expect(r.statusCode).toBe(status);
      expect(r.json()).toEqual(corpo);
    } finally {
      await app.close();
    }
  });

  it('verificar() da fila que lança erro conta como fora, não como 500', async () => {
    const quebrada = { verificar: async () => { throw new Error('boom'); }, enfileirar: async () => {}, enfileirarEmail: async () => {} };
    const app = buildApp({ jwtSegredo: 'x'.repeat(32), jwtServicoSegredo: 'y'.repeat(32), pool: pool(true), fila: quebrada, limiteEmMemoria: true, portalUrl: PORTAL_URL_TESTE, logger: false });
    try {
      const r = await app.inject({ method: 'GET', url: '/saude' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ db: 'ok', fila: 'fora' });
    } finally {
      await app.close();
    }
  });
});
