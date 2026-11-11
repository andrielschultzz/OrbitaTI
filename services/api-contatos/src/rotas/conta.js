// Conta (contrato, seções 4 e 9; bloco 14, LGPD): exportação, cancelamento e o link de exportação.
//
//   GET  /conta/exportacao           admin; JSON com todos os dados do próprio tenant (download)
//   POST /conta/cancelamento         admin; grava cancelado_em e manda por e-mail o link de exportação
//   GET  /conta/exportacao/arquivo   PÚBLICA (o login já não funciona); o mesmo JSON, pelo token do link
//
// Por que 403 e não 404 para quem não é admin: o recurso existe e é do próprio tenant; o que falta é
// permissão DENTRO dele (contrato, seção 2). 404 é só para "de outro tenant ou inexistente" (regra 5).
import { randomUUID } from 'node:crypto';
import { DIAS_EXPORTACAO, FINALIDADE_EXPORTAR_CONTA } from '../autenticacao.js';
import { withTenant } from '../db.js';
import { ErroContrato } from '../erros.js';
import { FilaIndisponivel } from '../fila.js';
import { limiteExportacaoLink } from '../limite.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_MAXIMO = 2048; // mesmo teto do link de confirmação: acima disto é lixo
const DIA_MS = 24 * 60 * 60 * 1000;
const linkInvalido = () => new ErroContrato(400, 'LINK_INVALIDO');

// 503 do cancelamento: mesmo código da importação (o Portal decide pelo código), texto próprio.
const FILA_FORA_CANCELAMENTO =
  'Não foi possível cancelar agora: o envio do link de exportação está fora do ar. Tente de novo em instantes.';

function exigirAdmin(req) {
  if (req.user.papel !== 'admin') throw new ErroContrato(403, 'SEM_PERMISSAO');
}

/**
 * Lê TODOS os dados do tenant fixado (RLS) e monta o JSON da exportação (contrato, seção 9).
 * Colunas sempre explícitas, nunca SELECT *: uma coluna sensível criada no futuro (ex.: outro hash) não
 * vaza na exportação sem alguém decidir. senha_hash nunca sai (T-LGPD-01).
 *
 * Fica de fora importacao.erros_linha: é do schema do worker, que a API não lê (regra 10). Limitação
 * registrada em docs/lgpd.md. Esses erros são apagados junto na exclusão do tenant.
 *
 * @returns {Promise<object|null>} null quando o tenant não existe mais (excluído)
 */
export async function montarExportacao(pool, tenantId) {
  return withTenant(pool, tenantId, async (c) => {
    const tenant = (await c.query('SELECT id, nome, plano, criado_em, cancelado_em FROM orbita.tenants')).rows[0];
    if (!tenant) return null;
    const lista = async (sql) => (await c.query(sql)).rows;
    return {
      tenant,
      usuarios: await lista(
        'SELECT id, nome, email, papel, criado_em, email_confirmado_em FROM orbita.usuarios ORDER BY criado_em, id',
      ),
      contatos: await lista(
        `SELECT id, nome, email, telefone, empresa, observacao, estagio, ultima_interacao_em, criado_em, atualizado_em
           FROM orbita.contatos ORDER BY criado_em, id`,
      ),
      interacoes: await lista(
        'SELECT id, contato_id, usuario_id, tipo, nota, ocorrida_em, criado_em FROM orbita.interacoes ORDER BY ocorrida_em, id',
      ),
      importacoes: await lista(
        `SELECT id, usuario_id, status, total_linhas, total_lotes, linhas_invalidas, lotes_aplicados, criado_em, concluida_em
           FROM orbita.importacoes ORDER BY criado_em, id`,
      ),
    };
  });
}

/** Responde o JSON como download (o navegador salva o arquivo em vez de mostrar). */
function enviarArquivo(rep, dados) {
  const hoje = new Date().toISOString().slice(0, 10);
  return rep
    .header('content-disposition', `attachment; filename="orbitati-exportacao-${hoje}.json"`)
    .type('application/json; charset=utf-8')
    .send(JSON.stringify(dados));
}

export default async function rotasConta(app, { pool, fila, portalUrl }) {
  app.get('/conta/exportacao', async (req, rep) => {
    exigirAdmin(req);
    const dados = await montarExportacao(pool, req.user.tenant_id);
    // Token válido de um tenant que já foi apagado (janela de 15 min): sem dados, a sessão não vale mais.
    if (!dados) throw new ErroContrato(401, 'NAO_AUTENTICADO');
    req.log.info({ evento: 'exportacao_baixada', origem: 'sessao' }, 'exportação baixada');
    return enviarArquivo(rep, dados);
  });

  app.post(
    '/conta/cancelamento',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { cancelado_em: { type: 'string' }, exportacao_disponivel_ate: { type: 'string' } },
          },
        },
      },
    },
    async (req) => {
      exigirAdmin(req);
      const { tenant_id: tenantId, sub: usuarioId } = req.user;

      // O e-mail é enfileirado DENTRO da transação: se a fila estiver fora, o ROLLBACK desfaz o
      // cancelamento e a resposta é 503. Diferente do cadastro, aqui o e-mail não é opcional: depois do
      // cancelamento o login é recusado, e o link é o único caminho até os dados.
      // Risco aceito: o COMMIT falhar DEPOIS do enfileiramento. Sai um e-mail com um link que funciona
      // (exporta os dados do próprio tenant) para uma conta que não foi cancelada. Raro e sem vazamento.
      let resultado;
      try {
        resultado = await withTenant(pool, tenantId, async (c) => {
          // COALESCE: cancelar de novo (dentro dos 15 min do token) mantém a data original, e com ela o prazo.
          const { rows } = await c.query(
            'UPDATE orbita.tenants SET cancelado_em = COALESCE(cancelado_em, now()) RETURNING cancelado_em',
          );
          const usuario = (await c.query('SELECT nome, email FROM orbita.usuarios WHERE id = $1', [usuarioId])).rows[0];
          if (!rows[0] || !usuario) throw new ErroContrato(401, 'NAO_AUTENTICADO'); // tenant ou usuário apagados
          const canceladoEm = rows[0].cancelado_em;
          const disponivelAte = new Date(canceladoEm.getTime() + DIAS_EXPORTACAO * DIA_MS);

          // O token vence junto com o prazo (cancelado_em + 30 dias), não 30 dias depois DESTE pedido: um
          // reenvio no 10º dia não pode estender o acesso além da exclusão.
          const segundos = Math.max(1, Math.floor((disponivelAte.getTime() - Date.now()) / 1000));
          const token = app.jwt.sign(
            { sub: usuarioId, tenant_id: tenantId, finalidade: FINALIDADE_EXPORTAR_CONTA },
            { expiresIn: `${segundos}s` },
          );
          // jobId NOVO a cada pedido (sem ":", fila.js explica). Com um id fixo por tenant, um envio que
          // falhou ficaria 24 h no Redis (removeOnFail) com esse id, e o BullMQ ignoraria em silêncio o
          // pedido seguinte: o mesmo problema da N9 (docs/pendencias-bloco-7.md). Pedir de novo = cancelar
          // de novo; a trava contra clique duplo fica no botão do Portal.
          await fila.enfileirarEmail(
            {
              tipo: 'exportacao-disponivel',
              para: usuario.email,
              nome: usuario.nome,
              link: `${portalUrl}/api/conta/exportacao/arquivo?token=${token}`,
              disponivel_ate: disponivelAte.toISOString(),
              request_id: req.id,
              tenant_id: tenantId,
            },
            `exportacao-${tenantId}-${randomUUID()}`,
          );
          return { cancelado_em: canceladoEm.toISOString(), exportacao_disponivel_ate: disponivelAte.toISOString() };
        });
      } catch (erro) {
        if (erro instanceof FilaIndisponivel) {
          req.log.warn({ evento: 'cancelamento_sem_fila', motivo: erro.message }, 'cancelamento recusado: fila de e-mail fora');
          throw new ErroContrato(503, 'FILA_INDISPONIVEL', { erro: FILA_FORA_CANCELAMENTO });
        }
        throw erro;
      }
      req.log.info({ evento: 'tenant_cancelado' }, 'tenant cancelado');
      return resultado;
    },
  );

  app.get(
    '/conta/exportacao/arquivo',
    {
      config: { publica: true, rateLimit: limiteExportacaoLink },
      // Igual ao /auth/confirmar: token ausente, grande ou estranho é sempre 400 LINK_INVALIDO, nunca VALIDACAO.
      schema: { querystring: { type: 'object', properties: { token: { type: 'string' } } } },
    },
    async (req, rep) => {
      const { token } = req.query;
      if (typeof token !== 'string' || !token || token.length > TOKEN_MAXIMO) throw linkInvalido();
      let claims;
      try {
        claims = app.jwt.verify(token); // assinatura e validade
      } catch {
        throw linkInvalido();
      }
      // Só o token do link vale aqui: o de sessão (sem finalidade) e o de confirmação de e-mail não (T-LGPD-04).
      if (claims.finalidade !== FINALIDADE_EXPORTAR_CONTA) throw linkInvalido();
      if (typeof claims.tenant_id !== 'string' || !UUID.test(claims.tenant_id)) throw linkInvalido();

      req.log = rep.log = req.log.child({ tenant_id: claims.tenant_id });
      const dados = await montarExportacao(pool, claims.tenant_id);
      if (!dados) throw linkInvalido(); // tenant já excluído (T-LGPD-03): o link morre junto
      req.log.info({ evento: 'exportacao_baixada', origem: 'link' }, 'exportação baixada');
      return enviarArquivo(rep, dados);
    },
  );
}
