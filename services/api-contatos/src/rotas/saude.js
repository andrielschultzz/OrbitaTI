// GET /saude: pública, usada pelo healthcheck do compose e pelas probes do kind.
// Bloco 2: só o banco. A parte da fila ({fila: "ok"|"fora"}) entra no bloco 4 (contrato, seção 4).
//
// Banco fora -> 503: o healthcheck marca o contêiner como unhealthy e o kind tira a réplica do Service.
// SELECT 1 não toca tabela de tenant, por isso pode usar pool.query direto (a regra 2 é sobre dado de tenant).
export default async function rotasSaude(app, { pool }) {
  app.get(
    '/saude',
    {
      config: { publica: true },
      schema: {
        response: {
          200: { type: 'object', properties: { db: { type: 'string' } } },
          503: { type: 'object', properties: { db: { type: 'string' } } },
        },
      },
    },
    async (req, rep) => {
      try {
        await pool.query('SELECT 1');
        return { db: 'ok' };
      } catch (erro) {
        req.log.warn({ err: erro }, 'saude: banco fora');
        return rep.status(503).send({ db: 'fora' });
      }
    },
  );
}
