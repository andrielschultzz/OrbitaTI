// Interações (contrato, seção 6). Todas autenticadas; todo acesso ao banco via withTenant (regra 2).
//
// Isolamento: igual a contatos.js. O RLS esconde o contato de outro tenant, então "contato de B" e
// "contato inexistente" dão o mesmo 404 (regra 5). Além do RLS, a chave estrangeira composta
// (contato_id, tenant_id) da migração 003 impede que uma interação de A aponte para um contato de B.
import { withTenant } from '../db.js';
import { ErroContrato, naoEncontrado } from '../erros.js';
import { COLUNAS, NAO_ENCONTRADO, comId, contatoSchema, paramsId, publico } from './contatos.js';

export const TIPOS = ['ligacao', 'whatsapp', 'email', 'reuniao', 'outro'];
// Tolerância para o relógio adiantado do celular: "agora" no aparelho pode estar alguns minutos à frente.
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;
const COLUNAS_INTERACAO = 'id, contato_id, usuario_id, tipo, nota, ocorrida_em, criado_em';

const texto = { type: 'string' };
const textoOuNulo = { type: ['string', 'null'] };
const interacaoSchema = {
  type: 'object',
  properties: {
    id: texto,
    contato_id: texto,
    usuario_id: textoOuNulo, // null se o usuário foi excluído (ON DELETE SET NULL)
    tipo: texto,
    nota: textoOuNulo,
    ocorrida_em: texto,
    criado_em: texto,
  },
};

const interacaoPublica = (linha) => ({
  ...linha,
  ocorrida_em: linha.ocorrida_em.toISOString(),
  criado_em: linha.criado_em.toISOString(),
});

const futuro = () =>
  new ErroContrato(400, 'VALIDACAO', {
    extras: { campos: [{ campo: 'ocorrida_em', erro: 'A data não pode estar no futuro.' }] },
  });

export default async function rotasInteracoes(app, { pool }) {
  app.get(
    '/contatos/:id/interacoes',
    {
      ...comId,
      schema: {
        params: paramsId,
        response: { 200: { type: 'object', properties: { itens: { type: 'array', items: interacaoSchema } } } },
      },
    },
    async (req) => {
      const itens = await withTenant(pool, req.user.tenant_id, async (c) => {
        // Primeiro o contato: sem ele, a lista vazia esconderia o 404 (T-ISO-16).
        const contato = await c.query('SELECT 1 FROM orbita.contatos WHERE id = $1', [req.params.id]);
        if (contato.rowCount === 0) throw naoEncontrado(NAO_ENCONTRADO);
        const { rows } = await c.query(
          `SELECT ${COLUNAS_INTERACAO} FROM orbita.interacoes
           WHERE contato_id = $1 ORDER BY ocorrida_em DESC, id DESC`,
          [req.params.id],
        );
        return rows;
      });
      return { itens: itens.map(interacaoPublica) };
    },
  );

  app.post(
    '/contatos/:id/interacoes',
    {
      ...comId,
      schema: {
        params: paramsId,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tipo'],
          properties: {
            tipo: { type: 'string', enum: TIPOS },
            nota: { type: ['string', 'null'], maxLength: 2000 },
            ocorrida_em: { type: 'string', format: 'date-time' },
          },
        },
        response: {
          201: { type: 'object', properties: { interacao: interacaoSchema, contato: contatoSchema } },
        },
      },
    },
    async (req, rep) => {
      const { tipo, ocorrida_em: ocorridaTexto } = req.body;
      // Retroativo é permitido (lançar o histórico de quem vinha de uma planilha); futuro não.
      if (ocorridaTexto && Date.parse(ocorridaTexto) > Date.now() + TOLERANCIA_FUTURO_MS) throw futuro();
      const nota = req.body.nota?.trim() || null; // nota só com espaços vira null
      // Sem ocorrida_em, vale o now() do banco: dentro da transação ele é o mesmo nas duas instruções.
      const ocorrida = ocorridaTexto ?? null;

      const { interacao, contato } = await withTenant(pool, req.user.tenant_id, async (c) => {
        // UPDATE antes do INSERT, na MESMA transação:
        //  - rowCount 0 = contato de outro tenant ou inexistente -> 404 sem gravar nada (o throw desfaz tudo);
        //  - o UPDATE trava a linha do contato, então duas interações simultâneas não se atropelam.
        // GREATEST: lançar hoje uma ligação da semana passada não pode fazer o contato parecer mais frio.
        // No PostgreSQL, GREATEST ignora NULL: na primeira interação, GREATEST(NULL, x) = x.
        const atualizado = await c.query(
          `UPDATE orbita.contatos
           SET ultima_interacao_em = GREATEST(ultima_interacao_em, COALESCE($2::timestamptz, now())),
               atualizado_em = now()
           WHERE id = $1 RETURNING ${COLUNAS}`,
          [req.params.id, ocorrida],
        );
        if (atualizado.rowCount === 0) throw naoEncontrado(NAO_ENCONTRADO);
        // tenant_id não aparece: o DEFAULT da coluna pega o app.tenant_id da transação (regra 4).
        const { rows } = await c.query(
          `INSERT INTO orbita.interacoes (contato_id, usuario_id, tipo, nota, ocorrida_em)
           VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now())) RETURNING ${COLUNAS_INTERACAO}`,
          [req.params.id, req.user.sub, tipo, nota, ocorrida],
        );
        return { interacao: rows[0], contato: atualizado.rows[0] };
      });
      return rep.status(201).send({ interacao: interacaoPublica(interacao), contato: publico(contato) });
    },
  );
}
