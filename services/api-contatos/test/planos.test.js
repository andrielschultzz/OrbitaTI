// GET /planos (contrato, seção 7). Unitário: buildApp() com pool falso, sem stack.
// A resposta esperada é a do contrato, escrita à mão de propósito: se alguém mudar um número no
// planos.js, este teste obriga a mudar o contrato (e o simulador do Portal) junto.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

// Base fictícia dos links de e-mail (PORTAL_URL). Só precisa ser uma URL válida.
const PORTAL_URL_TESTE = 'http://portal.teste';

const POOL_FALSO = { query: async () => ({ rows: [] }) };
const FILA_FALSA = { verificar: async () => true, enfileirar: async () => {}, enfileirarEmail: async () => {} };

let app;
beforeAll(async () => {
  app = buildApp({ jwtSegredo: 'x'.repeat(32), jwtServicoSegredo: 'y'.repeat(32), pool: POOL_FALSO, fila: FILA_FALSA, limiteEmMemoria: true, portalUrl: PORTAL_URL_TESTE, logger: false });
  await app.ready();
});
afterAll(() => app.close());

describe('GET /planos', () => {
  it('sem token -> 200 com os números do contrato', async () => {
    const r = await app.inject({ method: 'GET', url: '/planos' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      itens: [
        {
          plano: 'individual',
          nome: 'Individual',
          preco_mensal_centavos: 4900,
          limites: {
            usuarios: 1,
            linhas_por_importacao: 100,
            importacoes_simultaneas: 2,
            requisicoes_por_minuto: 60,
            tamanho_maximo_csv_bytes: 1048576,
          },
        },
        {
          plano: 'equipe',
          nome: 'Equipe',
          preco_mensal_centavos: 24900,
          limites: {
            usuarios: 10,
            linhas_por_importacao: 5000,
            importacoes_simultaneas: 5,
            requisicoes_por_minuto: 600,
            tamanho_maximo_csv_bytes: 1048576,
          },
        },
      ],
    });
  });

  it('não devolve tenant_id nem nada de conta (é igual para qualquer pessoa)', async () => {
    const r = await app.inject({ method: 'GET', url: '/planos' });
    expect(r.body).not.toMatch(/tenant/i);
  });
});
