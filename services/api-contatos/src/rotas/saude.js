// GET /saude: pública, usada pelo healthcheck do compose e pelas probes do kind (contrato, seção 4).
//
// Só o BANCO decide o status (decisão 2 de prompts/decisoes-plano-de-testes.md):
//   db ok,   fila ok   -> 200 {db:"ok",   fila:"ok"}
//   db ok,   fila fora -> 200 {db:"ok",   fila:"fora"}   a API continua útil: só não importa
//   db fora, qualquer  -> 503 {db:"fora", fila:...}
// Por quê: no kind a readinessProbe usa /saude. Se Redis fora desse 503, TODAS as réplicas sairiam do
// Service e o CRM inteiro cairia por causa de uma peça que só a importação usa.
//
// SELECT 1 não toca tabela de tenant, por isso pode usar pool.query direto (a regra 2 é sobre dado de tenant).
// Banco e fila são verificados em paralelo: a resposta leva o tempo do mais lento, não a soma.
const estado = { type: 'object', properties: { db: { type: 'string' }, fila: { type: 'string' } } };

export default async function rotasSaude(app, { pool, fila }) {
  app.get(
    '/saude',
    { config: { publica: true }, schema: { response: { 200: estado, 503: estado } } },
    async (req, rep) => {
      const [db, filaOk] = await Promise.all([
        pool.query('SELECT 1').then(
          () => 'ok',
          (erro) => {
            req.log.warn({ err: erro }, 'saude: banco fora');
            return 'fora';
          },
        ),
        fila.verificar().catch(() => false),
      ]);
      const corpo = { db, fila: filaOk ? 'ok' : 'fora' };
      if (corpo.fila === 'fora') req.log.warn('saude: fila fora');
      return rep.status(db === 'ok' ? 200 : 503).send(corpo);
    },
  );
}
