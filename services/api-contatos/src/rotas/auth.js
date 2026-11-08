// POST /auth/cadastro, POST /auth/login e GET /auth/confirmar (contrato, seção 4). Rotas públicas.
import { randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { FINALIDADE_CONFIRMAR_EMAIL, VALIDADE_CONFIRMACAO } from '../autenticacao.js';
import { withTenant } from '../db.js';
import { ErroContrato, violouUnico } from '../erros.js';
import { limiteCadastro, limiteConfirmacao, limiteLogin } from '../limite.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Um JWT nosso de confirmação tem ~250 caracteres. Acima disto é lixo: nem tenta verificar.
const TOKEN_MAXIMO = 2048;
const linkInvalido = () => new ErroContrato(400, 'LINK_INVALIDO');

// O padrão do @node-rs/argon2 já é Argon2id (memória 19 MiB, 2 passadas, 1 thread: a recomendação da
// OWASP). O T-AUTH-08 confere o prefixo $argon2id$ no hash gravado.

// Hash de uma senha aleatória que ninguém conhece. Quando o e-mail não existe, o login confere a senha
// contra ele: assim "e-mail inexistente" gasta o mesmo tempo que "senha errada" e o tempo de resposta
// não revela quais e-mails têm conta (T-AUTH-05 compara o corpo; isto protege o relógio).
let hashFicticio;
const obterHashFicticio = () => (hashFicticio ??= hash(randomBytes(32).toString('hex')));

const textoObrigatorio = (max) => ({ type: 'string', minLength: 1, maxLength: max, pattern: '\\S' });
const email = { type: 'string', format: 'email', maxLength: 254 }; // 254: limite do RFC 5321
const resposta = { type: 'object', properties: { token: { type: 'string' } } };

const credencialInvalida = () => new ErroContrato(401, 'CREDENCIAIS_INVALIDAS');

export default async function rotasAuth(app, { pool, fila, limiteCadastroPorMin, portalUrl }) {
  app.post(
    '/auth/cadastro',
    {
      // Por IP: um robô criando contas em série (cada conta nova é um tenant novo, com o limite zerado).
      config: { publica: true, rateLimit: limiteCadastro(limiteCadastroPorMin) },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['empresa', 'plano', 'nome', 'email', 'senha'],
          properties: {
            empresa: textoObrigatorio(120),
            plano: { type: 'string', enum: ['individual', 'equipe'] },
            nome: textoObrigatorio(120),
            email,
            // 8: mínimo do NIST SP 800-63B. 128: senha gigante não pode gastar CPU no Argon2.
            senha: { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
        response: { 201: resposta },
      },
    },
    async (req, rep) => {
      const { empresa, plano, nome, senha } = req.body;
      const emailNormalizado = req.body.email.toLowerCase();
      // O Argon2 roda ANTES de abrir a transação: não seguramos uma conexão do pool enquanto ele calcula.
      const senhaHash = await hash(senha);

      // A API gera o id do tenant e fixa app.tenant_id com ele ANTES de inserir: a política de RLS de
      // tenants e usuarios exige (WITH CHECK) que a linha nova seja do tenant da transação.
      const tenantId = randomUUID();
      let usuarioId;
      try {
        usuarioId = await withTenant(pool, tenantId, async (c) => {
          await c.query('INSERT INTO orbita.tenants (id, nome, plano) VALUES ($1, $2, $3)', [
            tenantId,
            empresa.trim(),
            plano,
          ]);
          const { rows } = await c.query(
            `INSERT INTO orbita.usuarios (nome, email, senha_hash, papel)
             VALUES ($1, $2, $3, 'admin') RETURNING id`,
            [nome.trim(), emailNormalizado, senhaHash],
          );
          return rows[0].id;
        });
      } catch (erro) {
        // E-mail é único na base inteira (o login acha o usuário só pelo e-mail). O ROLLBACK já desfez o tenant.
        if (violouUnico(erro, 'usuarios_email_unico')) throw new ErroContrato(409, 'EMAIL_JA_CADASTRADO');
        throw erro;
      }

      // Daqui em diante (inclusive o "request completed"), o log desta requisição sai com o tenant.
      req.log = rep.log = req.log.child({ tenant_id: tenantId });
      req.log.info('cadastro: tenant criado');

      // E-mail de confirmação (bloco 10). Só DEPOIS do COMMIT (o withTenant acima já retornou): se fosse
      // antes, um ROLLBACK deixaria um e-mail no ar apontando para um usuário que não existe.
      // Fila fora NÃO impede o cadastro: o e-mail não pode travar o onboarding (T-RES-06). O usuário entra
      // do mesmo jeito; o login não exige confirmação.
      const tokenConfirmacao = app.jwt.sign(
        { sub: usuarioId, tenant_id: tenantId, finalidade: FINALIDADE_CONFIRMAR_EMAIL },
        { expiresIn: VALIDADE_CONFIRMACAO },
      );
      try {
        await fila.enfileirarEmail(
          {
            tipo: 'confirmar-cadastro',
            para: emailNormalizado,
            nome: nome.trim(),
            link: `${portalUrl}/confirmar-email?token=${tokenConfirmacao}`,
            request_id: req.id,
            tenant_id: tenantId,
          },
          `confirmar-cadastro-${usuarioId}`, // sem ":" (fila.js explica)
        );
      } catch (erro) {
        // Sem o e-mail nem o link no log: o link vale como credencial por 24 h (T-OBS-04).
        req.log.warn({ evento: 'email_nao_enfileirado', motivo: erro.message }, 'cadastro concluído sem o e-mail de confirmação');
      }

      const token = app.jwt.sign({ sub: usuarioId, tenant_id: tenantId, plano, papel: 'admin' });
      return rep.status(201).send({ token });
    },
  );

  app.get(
    '/auth/confirmar',
    {
      config: { publica: true, rateLimit: limiteConfirmacao },
      // Sem "required" e sem limite no schema: token ausente, grande ou estranho é sempre 400 LINK_INVALIDO
      // (contrato, seção 4), nunca VALIDACAO. A tela do Portal só precisa conhecer um código.
      schema: {
        querystring: { type: 'object', properties: { token: { type: 'string' } } },
        response: { 200: { type: 'object', properties: { confirmado_em: { type: 'string' } } } },
      },
    },
    async (req, rep) => {
      const { token } = req.query;
      if (typeof token !== 'string' || !token || token.length > TOKEN_MAXIMO) throw linkInvalido();

      let claims;
      try {
        claims = app.jwt.verify(token); // assinatura (HS256) e validade (exp)
      } catch {
        throw linkInvalido(); // adulterado, expirado ou não é JWT: mesma resposta
      }
      // Só o token do link vale aqui. Token de sessão (sem finalidade) é recusado (T-AUTH-12).
      if (claims.finalidade !== FINALIDADE_CONFIRMAR_EMAIL) throw linkInvalido();
      if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) throw linkInvalido();
      if (typeof claims.tenant_id !== 'string' || !UUID.test(claims.tenant_id)) throw linkInvalido();

      req.log = rep.log = req.log.child({ tenant_id: claims.tenant_id });
      // O tenant vem do token ASSINADO pela API (regra 1), e o UPDATE roda sob RLS. COALESCE: clicar de
      // novo no link mantém a data da primeira confirmação.
      const linhas = await withTenant(pool, claims.tenant_id, async (c) => {
        const { rows } = await c.query(
          `UPDATE orbita.usuarios SET email_confirmado_em = COALESCE(email_confirmado_em, now())
            WHERE id = $1 RETURNING email_confirmado_em`,
          [claims.sub],
        );
        return rows;
      });
      // Usuário apagado depois do envio (ou tenant cancelado): 0 linhas. O link não vale mais.
      if (linhas.length === 0) throw linkInvalido();
      req.log.info({ evento: 'email_confirmado' }, 'e-mail confirmado');
      return { confirmado_em: linhas[0].email_confirmado_em.toISOString() };
    },
  );

  app.post(
    '/auth/login',
    {
      // Por IP + e-mail: força bruta numa conta. Só IP bloquearia um escritório inteiro atrás do mesmo NAT;
      // só e-mail deixaria qualquer um, de qualquer lugar, travar a conta de outra pessoa.
      config: { publica: true, rateLimit: limiteLogin },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'senha'],
          properties: { email, senha: { type: 'string', minLength: 1, maxLength: 128 } },
        },
        response: { 200: resposta },
      },
    },
    async (req, rep) => {
      const { senha } = req.body;
      // buscar_credencial é a ÚNICA exceção controlada ao RLS (regra 6): SECURITY DEFINER, dono orbita_auth.
      // É uma função, não uma tabela de tenant, e o login acontece antes de saber o tenant: sem withTenant.
      const { rows } = await pool.query(
        'SELECT usuario_id, tenant_id, senha_hash, papel, plano FROM orbita.buscar_credencial($1)',
        [req.body.email.toLowerCase()],
      );
      const cred = rows[0];
      if (!cred) {
        await verify(await obterHashFicticio(), senha).catch(() => false);
        throw credencialInvalida();
      }
      if (!(await verify(cred.senha_hash, senha))) throw credencialInvalida();

      req.log = rep.log = req.log.child({ tenant_id: cred.tenant_id });
      return { token: app.jwt.sign({ sub: cred.usuario_id, tenant_id: cred.tenant_id, plano: cred.plano, papel: cred.papel }) };
    },
  );
}
