// Rotas internas (contrato, seção 8): SÓ o worker de importação chama, com token de SERVIÇO
// (config.servico: autenticacao.js aceita só JWT_SERVICO_SEGREDO aqui; JWT de usuário -> 401).
//
//   POST /interno/importacoes/:id/inicio  {total_lotes, linhas_invalidas}  worker validou o CSV
//   POST /interno/importacoes/:id/lotes   {numero, contatos}               grava um lote (idempotente)
//   POST /interno/importacoes/:id/falha   {motivo}                         job esgotou as tentativas
//
// Regras comuns:
//   - tenant vem do token de serviço (req.user.tenant_id) e entra no withTenant: importação de outro
//     tenant é invisível (RLS) -> 404 (T-ISO-09).
//   - SELECT ... FOR UPDATE na importação: lotes da mesma importação chegando juntos (retry, duas réplicas)
//     são aplicados um de cada vez, e a contagem lotes_aplicados nunca se perde.
//   - concluida e falhou nunca voltam atrás.
//   - por que existem inicio e falha: sem elas a importação poderia nunca concluir (contrato, seção 8).
import { withTenant } from '../db.js';
import { ErroContrato, naoEncontrado } from '../erros.js';

const NAO_ENCONTRADA = 'Importação não encontrada.';
const FINAIS = new Set(['concluida', 'falhou']);

// Lote máximo: o maior CSV possível (5.000 linhas do Equipe) num lote só. Normalmente são 100
// (IMPORT_LOTE); o teto maior deixa o teste de carga rodar "sem a mitigação" (lote único) para comparar.
const MAX_CONTATOS_POR_LOTE = 5000;
// 5.000 contatos em JSON passam de 1 MB (nomes das chaves + aspas + escapes); 4 MB dá folga.
const BODY_LIMIT_LOTE = 4 * 1024 * 1024;

const paramsId = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };
const opcional = (max) => ({ type: ['string', 'null'], maxLength: max });
// Mesmos limites do POST /contatos (rotas/contatos.js): um contato importado não pode ser "maior" que um manual.
const contato = {
  type: 'object',
  additionalProperties: false,
  required: ['nome', 'email'],
  properties: {
    nome: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
    email: { type: 'string', format: 'email', maxLength: 254 }, // obrigatório na importação (regra 9)
    telefone: opcional(30),
    empresa: opcional(120),
    observacao: opcional(500),
  },
};
const respostaStatus = { 200: { type: 'object', properties: { status: { type: 'string' } } } };

/** Lê e TRAVA a importação. 0 linhas = outro tenant ou inexistente -> 404. */
async function travarImportacao(c, id) {
  const { rows } = await c.query(
    'SELECT status, total_lotes, lotes_aplicados FROM orbita.importacoes WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (rows.length === 0) throw naoEncontrado(NAO_ENCONTRADA);
  return rows[0];
}

export default async function rotasInterno(app, { pool }) {
  const config = { servico: true, naoEncontrado: NAO_ENCONTRADA };

  app.post(
    '/interno/importacoes/:id/inicio',
    {
      config,
      schema: {
        params: paramsId,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['total_lotes', 'linhas_invalidas'],
          properties: { total_lotes: { type: 'integer', minimum: 0 }, linhas_invalidas: { type: 'integer', minimum: 0 } },
        },
        response: respostaStatus,
      },
    },
    async (req) => {
      const { total_lotes: totalLotes, linhas_invalidas: invalidas } = req.body;
      return withTenant(pool, req.user.tenant_id, async (c) => {
        const imp = await travarImportacao(c, req.params.id);
        // Repetir (retry do BullMQ) não muda nada: vale o primeiro inicio. Status final também não muda.
        if (FINAIS.has(imp.status) || imp.total_lotes !== null) return { status: imp.status };
        // total_lotes 0 = todas as linhas inválidas: nenhum lote virá, então já está concluída.
        const { rows } = await c.query(
          `UPDATE orbita.importacoes
              SET total_lotes = $2, linhas_invalidas = $3,
                  status = CASE WHEN $2 = 0 THEN 'concluida' ELSE 'processando' END,
                  concluida_em = CASE WHEN $2 = 0 THEN now() END
            WHERE id = $1
        RETURNING status`,
          [req.params.id, totalLotes, invalidas],
        );
        req.log.info({ importacao_id: req.params.id, total_lotes: totalLotes, linhas_invalidas: invalidas }, 'importacao: inicio');
        return { status: rows[0].status };
      });
    },
  );

  app.post(
    '/interno/importacoes/:id/lotes',
    {
      config,
      bodyLimit: BODY_LIMIT_LOTE,
      schema: {
        params: paramsId,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['numero', 'contatos'],
          properties: {
            numero: { type: 'integer', minimum: 1 },
            contatos: { type: 'array', minItems: 1, maxItems: MAX_CONTATOS_POR_LOTE, items: contato },
          },
        },
        response: { 200: { type: 'object', properties: { aplicado: { type: 'boolean' } } } },
      },
    },
    async (req) => {
      const { numero, contatos } = req.body;
      return withTenant(pool, req.user.tenant_id, async (c) => {
        const imp = await travarImportacao(c, req.params.id);
        // Importação encerrada (ex.: lote atrasado depois de falhou): não aplica, não volta atrás.
        if (FINAIS.has(imp.status)) return { aplicado: false };
        if (imp.total_lotes !== null && numero > imp.total_lotes) {
          throw new ErroContrato(400, 'VALIDACAO', { extras: { campos: [{ campo: 'numero', erro: 'Lote além do total informado.' }] } });
        }

        // Idempotência (regra 8): o lote já registrado não é aplicado de novo. A PK (importacao_id, numero)
        // decide; com a linha travada acima, não há corrida entre a checagem e o registro.
        const registro = await c.query(
          'INSERT INTO orbita.lotes_aplicados (importacao_id, numero) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.params.id, numero],
        );
        if (registro.rowCount === 0) return { aplicado: false };

        // Upsert do lote inteiro num comando só (unnest = um array por coluna). tenant_id vem do DEFAULT
        // (app.tenant_id), nunca do código (regra 4). E-mail em minúsculas (regra 8).
        // DISTINCT ON: defesa contra e-mail repetido no MESMO lote (o worker já recusa, mas sem isto o
        // Postgres daria "ON CONFLICT DO UPDATE command cannot affect row a second time" -> 500).
        // Fica a última ocorrência (ord DESC), como se as linhas fossem aplicadas em ordem.
        // COALESCE: célula vazia no CSV não apaga o telefone/empresa/observação que já existia.
        const coluna = (campo) => contatos.map((ct) => ct[campo] ?? null);
        await c.query(
          `INSERT INTO orbita.contatos (nome, email, telefone, empresa, observacao)
           SELECT DISTINCT ON (email) nome, email, telefone, empresa, observacao
             FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
                  WITH ORDINALITY AS x(nome, email, telefone, empresa, observacao, ord)
            ORDER BY email, ord DESC
           ON CONFLICT (tenant_id, email) DO UPDATE
              SET nome          = EXCLUDED.nome,
                  telefone      = COALESCE(EXCLUDED.telefone, contatos.telefone),
                  empresa       = COALESCE(EXCLUDED.empresa, contatos.empresa),
                  observacao    = COALESCE(EXCLUDED.observacao, contatos.observacao),
                  atualizado_em = now()`,
          [
            coluna('nome').map((n) => n.trim()),
            coluna('email').map((e) => e.toLowerCase()),
            coluna('telefone'),
            coluna('empresa'),
            coluna('observacao'),
          ],
        );

        // Progresso. Conclui quando o último lote chega (total_lotes já informado pelo inicio).
        await c.query(
          `UPDATE orbita.importacoes
              SET lotes_aplicados = lotes_aplicados + 1,
                  status = CASE WHEN total_lotes IS NOT NULL AND lotes_aplicados + 1 >= total_lotes
                                THEN 'concluida' ELSE 'processando' END,
                  concluida_em = CASE WHEN total_lotes IS NOT NULL AND lotes_aplicados + 1 >= total_lotes
                                      THEN now() END
            WHERE id = $1`,
          [req.params.id],
        );
        return { aplicado: true };
      });
    },
  );

  app.post(
    '/interno/importacoes/:id/falha',
    {
      config,
      schema: {
        params: paramsId,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['motivo'],
          properties: { motivo: { type: 'string', minLength: 1, maxLength: 500 } },
        },
        response: respostaStatus,
      },
    },
    async (req) => {
      return withTenant(pool, req.user.tenant_id, async (c) => {
        const imp = await travarImportacao(c, req.params.id);
        if (FINAIS.has(imp.status)) return { status: imp.status }; // concluida não vira falhou
        await c.query(`UPDATE orbita.importacoes SET status = 'falhou' WHERE id = $1`, [req.params.id]);
        // O motivo não tem coluna (a API não guarda detalhe técnico do worker): vai para o log, com reqId.
        req.log.warn({ importacao_id: req.params.id, motivo: req.body.motivo }, 'importacao: falhou');
        return { status: 'falhou' };
      });
    },
  );
}
