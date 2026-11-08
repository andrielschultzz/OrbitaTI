// T-RES-07, apoio unitário (docs/plano-de-testes.md; achado K7 em docs/pendencias-bloco-7.md).
// Mesmo teste da API (services/api-contatos/test/pool-erro.test.js), para o pool do worker: o db.js
// é uma cópia por serviço, então cada cópia precisa da sua prova.
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarPool } from '../src/db.js';

const URL_FALSA = 'postgres://ninguem:x@127.0.0.1:1/nada';
const erroDoBanco = () => new Error('terminating connection due to administrator command');

describe('T-RES-07 (unitário): banco derruba conexão ociosa do worker', () => {
  const pools = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((p) => p.end()));
  });

  it('controle: pg.Pool sem ouvinte lança o erro (é o que derrubava o worker)', () => {
    const cru = new pg.Pool({ connectionString: URL_FALSA });
    pools.push(cru);
    expect(() => cru.emit('error', erroDoBanco())).toThrow(/terminating connection/);
  });

  it('criarPool: o erro vira log warn e não lança', () => {
    const log = { warn: vi.fn() };
    const pool = criarPool(URL_FALSA, log);
    pools.push(pool);

    expect(() => pool.emit('error', erroDoBanco())).not.toThrow();
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0][0]).toMatchObject({
      evento: 'banco_conexao_perdida',
      err: 'terminating connection due to administrator command',
    });
  });
});
