// Contatos (contrato, seção 5). Todas autenticadas; todo acesso ao banco via withTenant (regra 2).
//
// Isolamento: o tenant vem de req.user.tenant_id (token assinado). As queries NÃO filtram por
// tenant_id: quem filtra é o RLS. Contato de outro tenant simplesmente não existe para esta transação,
// então GET dá 0 linhas e UPDATE/DELETE afetam 0 linhas (sem erro). Conferimos rowCount e devolvemos
// 404, o mesmo de um id inexistente (regra 5): quem chama não descobre que o id existe em outro lugar.
import { withTenant } from '../db.js';
import { ErroContrato, naoEncontrado, violouUnico } from '../erros.js';

const LIMITE = 100;
export const NAO_ENCONTRADO = 'Contato não encontrado.';
export const ESTAGIOS = ['lead', 'proposta', 'cliente', 'perdido'];

// Colunas devolvidas. tenant_id fica de fora de propósito (contrato: nenhuma resposta o devolve).
// Exportadas para rotas/interacoes.js, que devolve o contato atualizado junto com a interação.
export const COLUNAS =
  'id, nome, email, telefone, empresa, observacao, estagio, ultima_interacao_em, criado_em, atualizado_em';
const EDITAVEIS = ['nome', 'email', 'telefone', 'empresa', 'observacao', 'estagio']; // lista fechada: só estes viram SQL

// ---------- schemas ----------
const opcional = (max, extra = {}) => ({ type: ['string', 'null'], maxLength: max, ...extra });
const camposEntrada = {
  nome: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' }, // nunca null nem só espaços
  email: opcional(254, { format: 'email' }),
  telefone: opcional(30),
  empresa: opcional(120),
  observacao: opcional(500),
  estagio: { type: 'string', enum: ESTAGIOS }, // nunca null: a coluna é NOT NULL (padrão 'lead')
};
const texto = { type: 'string' };
const textoOuNulo = { type: ['string', 'null'] };
// O response schema é uma segunda barreira: só estes campos são serializados, mesmo que um SELECT
// futuro traga tenant_id por engano.
export const contatoSchema = {
  type: 'object',
  properties: {
    id: texto,
    nome: texto,
    email: textoOuNulo,
    telefone: textoOuNulo,
    empresa: textoOuNulo,
    observacao: textoOuNulo,
    estagio: texto,
    ultima_interacao_em: textoOuNulo,
    criado_em: texto,
    atualizado_em: texto,
  },
};
export const paramsId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }, // não-UUID -> 404 no setErrorHandler
};
export const comId = { config: { naoEncontrado: NAO_ENCONTRADO } };

// ---------- normalização ----------
/** Datas em ISO 8601 UTC; o resto como veio do banco. */
export const publico = (linha) => ({
  ...linha,
  ultima_interacao_em: linha.ultima_interacao_em?.toISOString() ?? null,
  criado_em: linha.criado_em.toISOString(),
  atualizado_em: linha.atualizado_em.toISOString(),
});

/** Prepara o valor para gravar: e-mail em minúsculas; texto opcional vazio vira null; nome sem espaços nas pontas. */
function normalizar(campo, valor) {
  if (valor === null) return null;
  if (campo === 'email') return valor.toLowerCase();
  if (campo === 'estagio') return valor; // já validado pelo enum do schema
  const limpo = valor.trim();
  return campo === 'nome' || limpo !== '' ? limpo : null;
}

/** ILIKE trata % e _ como curinga. Escapamos para que buscar "50%" procure o texto "50%". */
const padraoBusca = (termo) => `%${termo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const emailDuplicado = (erro) => {
  if (violouUnico(erro, 'contatos_tenant_email_unico')) return new ErroContrato(409, 'EMAIL_DUPLICADO');
  return erro;
};

export default async function rotasContatos(app, { pool }) {
  app.get(
    '/contatos',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false, // ?tenant_id=... é descartado (T-ISO-07)
          properties: { busca: { type: 'string', maxLength: 100 } },
        },
        response: {
          200: {
            type: 'object',
            properties: { itens: { type: 'array', items: contatoSchema }, limite: { type: 'integer' } },
          },
        },
      },
    },
    async (req) => {
      const termo = req.query.busca?.trim();
      const { rows } = await withTenant(pool, req.user.tenant_id, (c) =>
        termo
          ? c.query(
              `SELECT ${COLUNAS} FROM orbita.contatos
               WHERE nome ILIKE $1 ESCAPE '\\' OR email ILIKE $1 ESCAPE '\\' OR empresa ILIKE $1 ESCAPE '\\'
               ORDER BY nome, id LIMIT $2`,
              [padraoBusca(termo), LIMITE],
            )
          : c.query(`SELECT ${COLUNAS} FROM orbita.contatos ORDER BY nome, id LIMIT $1`, [LIMITE]),
      );
      return { itens: rows.map(publico), limite: LIMITE };
    },
  );

  app.post(
    '/contatos',
    {
      schema: {
        body: { type: 'object', additionalProperties: false, required: ['nome'], properties: camposEntrada },
        response: { 201: contatoSchema },
      },
    },
    async (req, rep) => {
      // estagio só entra no INSERT se veio: sem ele, vale o DEFAULT 'lead' da coluna (null violaria o NOT NULL).
      const campos = EDITAVEIS.filter((campo) => campo !== 'estagio' || 'estagio' in req.body);
      const valores = campos.map((campo) => normalizar(campo, req.body[campo] ?? null));
      const marcadores = campos.map((_, i) => `$${i + 1}`).join(', ');
      // tenant_id não aparece: o DEFAULT da coluna pega o app.tenant_id da transação (regra 4).
      const linha = await withTenant(pool, req.user.tenant_id, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO orbita.contatos (${campos.join(', ')}) VALUES (${marcadores}) RETURNING ${COLUNAS}`,
          valores,
        );
        return rows[0];
      }).catch((erro) => {
        throw emailDuplicado(erro);
      });
      return rep.status(201).send(publico(linha));
    },
  );

  // "Saindo de órbita" (contrato, seção 5). Caminho fixo: o Fastify o prefere a /contatos/:id, e o :id é
  // validado como UUID, então "esfriando" nunca cairia lá.
  //
  // Referência = COALESCE(ultima_interacao_em, criado_em): um contato só esfria depois de `dias` dias parado,
  // desde a última conversa ou, se nunca houve uma, desde o cadastro. Sem o criado_em, 500 contatos recém-
  // importados ("nunca contatados") lotariam a lista no primeiro dia. O ", id" no ORDER BY deixa a ordem
  // estável quando duas referências são iguais (importação em lote grava o mesmo criado_em em vários).
  const REFERENCIA = 'COALESCE(ultima_interacao_em, criado_em)';
  app.get(
    '/contatos/esfriando',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false, // ?tenant_id=... é descartado (T-ISO-13)
          properties: {
            dias: { type: 'integer', minimum: 1, maximum: 365, default: 90 },
            limite: { type: 'integer', minimum: 1, maximum: LIMITE, default: LIMITE },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              itens: {
                type: 'array',
                items: {
                  ...contatoSchema,
                  properties: {
                    ...contatoSchema.properties,
                    dias_sem_interacao: { type: 'integer' },
                    nunca_contatado: { type: 'boolean' },
                  },
                },
              },
              dias: { type: 'integer' },
              limite: { type: 'integer' },
            },
          },
        },
      },
    },
    async (req) => {
      const { dias, limite } = req.query;
      // Os dias contam do now() do banco (o mesmo relógio que gravou criado_em), arredondados para baixo.
      const { rows } = await withTenant(pool, req.user.tenant_id, (c) =>
        c.query(
          `SELECT ${COLUNAS},
                  floor(extract(epoch FROM now() - ${REFERENCIA}) / 86400)::int AS dias_sem_interacao,
                  ultima_interacao_em IS NULL AS nunca_contatado
           FROM orbita.contatos
           WHERE estagio <> 'perdido' AND ${REFERENCIA} < now() - make_interval(days => $1)
           ORDER BY ${REFERENCIA}, id
           LIMIT $2`,
          [dias, limite],
        ),
      );
      return { itens: rows.map(publico), dias, limite };
    },
  );

  app.get(
    '/contatos/:id',
    { ...comId, schema: { params: paramsId, response: { 200: contatoSchema } } },
    async (req) => {
      const { rows } = await withTenant(pool, req.user.tenant_id, (c) =>
        c.query(`SELECT ${COLUNAS} FROM orbita.contatos WHERE id = $1`, [req.params.id]),
      );
      if (rows.length === 0) throw naoEncontrado(NAO_ENCONTRADO);
      return publico(rows[0]);
    },
  );

  app.patch(
    '/contatos/:id',
    {
      ...comId,
      schema: {
        params: paramsId,
        // Parcial: só os campos enviados mudam; null limpa um opcional. Corpo vazio -> 400.
        body: { type: 'object', additionalProperties: false, minProperties: 1, properties: camposEntrada },
        response: { 200: contatoSchema },
      },
    },
    async (req) => {
      // As colunas vêm da lista fechada EDITAVEIS (nunca do texto da requisição); os valores vão como parâmetro.
      const campos = EDITAVEIS.filter((campo) => campo in req.body);
      // O minProperties do schema conta ANTES de o Ajv descartar as propriedades extras: um corpo só com
      // {"tenant_id": ...} passaria por ele vazio. Esta conferência é a que vale.
      if (campos.length === 0) {
        throw new ErroContrato(400, 'VALIDACAO', { extras: { campos: [{ campo: '', erro: 'Envie ao menos um campo.' }] } });
      }
      const sets = campos.map((campo, i) => `${campo} = $${i + 2}`);
      const valores = campos.map((campo) => normalizar(campo, req.body[campo]));
      const resultado = await withTenant(pool, req.user.tenant_id, (c) =>
        c.query(
          `UPDATE orbita.contatos SET ${[...sets, 'atualizado_em = now()'].join(', ')}
           WHERE id = $1 RETURNING ${COLUNAS}`,
          [req.params.id, ...valores],
        ),
      ).catch((erro) => {
        throw emailDuplicado(erro);
      });
      if (resultado.rowCount === 0) throw naoEncontrado(NAO_ENCONTRADO); // outro tenant ou inexistente
      return publico(resultado.rows[0]);
    },
  );

  app.delete('/contatos/:id', { ...comId, schema: { params: paramsId } }, async (req, rep) => {
    const { rowCount } = await withTenant(pool, req.user.tenant_id, (c) =>
      c.query('DELETE FROM orbita.contatos WHERE id = $1', [req.params.id]),
    );
    if (rowCount === 0) throw naoEncontrado(NAO_ENCONTRADO); // outro tenant ou inexistente
    return rep.status(204).send();
  });
}
