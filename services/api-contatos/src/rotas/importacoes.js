// Importações (contrato, seção 7). Autenticadas com token de USUÁRIO; todo acesso ao banco via withTenant.
//
//   POST /importacoes      recebe o CSV, confere cabeçalho e limites, registra e ENFILEIRA (202)
//   GET  /importacoes/:id  progresso (o Portal consulta até concluir)
//
// A API não valida linha por linha nem grava contatos aqui: isso é do worker, fora da requisição
// (ADR-003). O worker devolve os contatos pela API, nas rotas /interno (rotas/interno.js).
import { withTenant } from '../db.js';
import { ErroContrato, naoEncontrado } from '../erros.js';
import { lerCabecalho } from '../csv.js';
import { FilaIndisponivel } from '../fila.js';
import { TAMANHO_MAXIMO_CSV_BYTES, limitesDo } from '../planos.js';

const NAO_ENCONTRADA = 'Importação não encontrada.';
const OBRIGATORIAS = ['nome', 'email'];

export const importacaoSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string' },
    total_linhas: { type: 'integer' },
    linhas_invalidas: { type: ['integer', 'null'] }, // nulos enquanto na_fila: quem calcula é o worker
    total_lotes: { type: ['integer', 'null'] },
    lotes_aplicados: { type: 'integer' },
    criado_em: { type: 'string' },
    concluida_em: { type: ['string', 'null'] },
  },
};
const paramsId = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };

const publica = (l) => ({
  ...l,
  criado_em: l.criado_em.toISOString(),
  concluida_em: l.concluida_em?.toISOString() ?? null,
});

export default async function rotasImportacoes(app, { pool, fila }) {
  // Parser de text/csv: o corpo chega como string. Fica DENTRO deste plugin (encapsulado), então só as
  // rotas daqui aceitam CSV; mandar text/csv para /contatos continua dando 415.
  // "text/csv; charset=utf-8" também casa: o Fastify compara só o tipo, sem os parâmetros.
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (req, corpo, pronto) => pronto(null, corpo));

  app.post(
    '/importacoes',
    {
      // 1 MB (planos.js). Acima disso o Fastify recusa antes de ler o corpo: 413 ARQUIVO_GRANDE.
      bodyLimit: TAMANHO_MAXIMO_CSV_BYTES,
      schema: {
        response: { 202: { type: 'object', properties: { importacao_id: { type: 'string' } } } },
      },
    },
    async (req, rep) => {
      // Confere o Content-Type, não o tipo do corpo: o Fastify também entrega text/plain como string
      // (parser padrão), e JSON chega como objeto. Só text/csv (com ou sem charset) é CSV.
      const tipo = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (tipo !== 'text/csv') throw new ErroContrato(415, 'TIPO_NAO_SUPORTADO');
      // Corpo vazio com Content-Type text/csv: o Fastify pode nem chamar o parser. Vazio é CSV_VAZIO, não 415.
      if (typeof req.body !== 'string') req.body = '';
      const tenantId = req.user.tenant_id;
      const limites = limitesDo(req.user.plano);

      // 1. só o cabeçalho e a contagem de linhas
      const { colunas, linhas } = lerCabecalho(req.body);
      if (!colunas) throw new ErroContrato(422, 'CSV_VAZIO');
      if (!OBRIGATORIAS.every((c) => colunas.includes(c))) throw new ErroContrato(422, 'CSV_SEM_COLUNAS');
      if (linhas === 0) throw new ErroContrato(422, 'CSV_VAZIO');

      // 2a. limite de linhas do plano
      if (linhas > limites.linhas_por_importacao) {
        throw new ErroContrato(422, 'LINHAS_ACIMA_DO_PLANO', {
          erro: `Seu plano permite até ${limites.linhas_por_importacao} linhas por importação.`,
          extras: { limite: limites.linhas_por_importacao, linhas },
        });
      }

      // Fila fora: nem toca o banco (evita gravar e logo desfazer).
      if (!(await fila.verificar())) throw new ErroContrato(503, 'FILA_INDISPONIVEL');

      // 2b + 3. importações simultâneas, contadas no banco, e o registro, na mesma transação.
      const importacaoId = await withTenant(pool, tenantId, async (c) => {
        // Trava a linha do próprio tenant: duas requisições ao mesmo tempo não passam juntas pela
        // contagem (sem isto, as duas leriam "1 em andamento" e o Individual teria 3). Só serializa
        // importações do MESMO tenant; os outros nem percebem.
        await c.query('SELECT 1 FROM orbita.tenants WHERE id = $1 FOR UPDATE', [tenantId]);
        const { rows: [{ total }] } = await c.query(
          `SELECT count(*)::int AS total FROM orbita.importacoes WHERE status IN ('na_fila', 'processando')`,
        );
        if (total >= limites.importacoes_simultaneas) {
          throw new ErroContrato(429, 'IMPORTACOES_SIMULTANEAS', { extras: { limite: limites.importacoes_simultaneas } });
        }
        // total_lotes e linhas_invalidas nascem nulos: quem os conhece é o worker (/interno/.../inicio).
        const { rows } = await c.query(
          'INSERT INTO orbita.importacoes (usuario_id, total_linhas) VALUES ($1, $2) RETURNING id',
          [req.user.sub, linhas],
        );
        return rows[0].id;
      });

      // 4. enfileirar DEPOIS do COMMIT. Se fosse antes, o worker poderia chamar /inicio antes de a linha
      // existir (404). Se enfileirar falhar, a compensação apaga o registro: "transação lógica".
      // Risco que sobra (API cair entre o COMMIT e o add): docs/pendencias-bloco-7.md.
      try {
        await fila.enfileirar(
          // O CSV vai no payload (ADR-004: até 1 MB no job). tenant_id vem do TOKEN, nunca do cliente.
          { importacao_id: importacaoId, tenant_id: tenantId, usuario_id: req.user.sub, request_id: req.id, csv: req.body },
          importacaoId, // jobId = importacao_id (regra 8)
        );
      } catch (erro) {
        if (!(erro instanceof FilaIndisponivel)) throw erro;
        req.log.warn({ err: erro, importacao_id: importacaoId }, 'importacao: fila indisponivel, registro desfeito');
        await withTenant(pool, tenantId, (c) =>
          c.query(`DELETE FROM orbita.importacoes WHERE id = $1 AND status = 'na_fila'`, [importacaoId]),
        );
        throw new ErroContrato(503, 'FILA_INDISPONIVEL');
      }

      req.log.info({ importacao_id: importacaoId, linhas }, 'importacao: enfileirada');
      return rep.status(202).send({ importacao_id: importacaoId });
    },
  );

  app.get(
    '/importacoes/:id',
    {
      config: { naoEncontrado: NAO_ENCONTRADA },
      schema: { params: paramsId, response: { 200: importacaoSchema } },
    },
    async (req) => {
      const { rows } = await withTenant(pool, req.user.tenant_id, (c) =>
        c.query(
          `SELECT id, status, total_linhas, linhas_invalidas, total_lotes, lotes_aplicados, criado_em, concluida_em
           FROM orbita.importacoes WHERE id = $1`,
          [req.params.id],
        ),
      );
      // Outro tenant ou inexistente: 0 linhas (RLS) -> mesmo 404 (regra 5, T-ISO-08).
      if (rows.length === 0) throw naoEncontrado(NAO_ENCONTRADA);
      return publica(rows[0]);
    },
  );
}
