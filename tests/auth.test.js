// Cadastro e login: T-AUTH-01 a T-AUTH-08 do docs/plano-de-testes.md (seção 2.3), contra a API do compose.
// Pré-requisito: docker compose up -d --build --wait
import { afterAll, describe, expect, it } from 'vitest';
import { SENHA, cadastrar, chamar, conectar, emailUnico, limparTenants, payload, registrarTenant } from './apoio/api.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterAll(limparTenants);

describe('POST /auth/cadastro', () => {
  it('T-AUTH-01: cria a empresa e devolve 201 {token} com tenant_id, plano e papel admin', async () => {
    const email = emailUnico('cadastro');
    const r = await chamar('POST', '/auth/cadastro', {
      corpo: { empresa: 'DevSolo Teste', plano: 'equipe', nome: 'Marcelo', email, senha: SENHA },
    });
    expect(r.status).toBe(201);
    expect(Object.keys(r.corpo)).toEqual(['token']); // nada além do token (nenhum tenant_id solto)
    const claims = payload(r.corpo.token);
    registrarTenant(claims.tenant_id);
    expect(claims.tenant_id).toMatch(UUID);
    expect(claims.sub).toMatch(UUID);
    expect(claims.plano).toBe('equipe');
    expect(claims.papel).toBe('admin');
  });

  it('T-AUTH-02: e-mail repetido -> 409, também com o e-mail em maiúsculas', async () => {
    const { email } = await cadastrar();
    const corpo = { empresa: 'Outra', plano: 'individual', nome: 'Outra Pessoa', senha: SENHA };
    for (const variante of [email, email.toUpperCase()]) {
      const r = await chamar('POST', '/auth/cadastro', { corpo: { ...corpo, email: variante } });
      expect(r.status).toBe(409);
      expect(r.corpo).toEqual({ erro: 'Esse e-mail já tem conta.', codigo: 'EMAIL_JA_CADASTRADO' });
    }
  });

  it('T-AUTH-03: corpo inválido -> 400 VALIDACAO com os campos (sem e-mail; plano fora da lista)', async () => {
    const semEmail = await chamar('POST', '/auth/cadastro', {
      corpo: { empresa: 'X', plano: 'individual', nome: 'X', senha: SENHA },
    });
    expect(semEmail.status).toBe(400);
    expect(semEmail.corpo.codigo).toBe('VALIDACAO');
    expect(semEmail.corpo.campos).toContainEqual({ campo: 'email', erro: 'Campo obrigatório.' });

    const planoRuim = await chamar('POST', '/auth/cadastro', {
      corpo: { empresa: 'X', plano: 'ouro', nome: 'X', email: emailUnico(), senha: SENHA },
    });
    expect(planoRuim.status).toBe(400);
    expect(planoRuim.corpo.campos.map((c) => c.campo)).toContain('plano');

    const senhaCurta = await chamar('POST', '/auth/cadastro', {
      corpo: { empresa: 'X', plano: 'individual', nome: 'X', email: emailUnico(), senha: '1234567' },
    });
    expect(senhaCurta.status).toBe(400);
    expect(senhaCurta.corpo.campos).toContainEqual({ campo: 'senha', erro: 'Pelo menos 8 caracteres.' });
  });
});

describe('POST /auth/login', () => {
  it('T-AUTH-04: login correto -> 200 {token} com o mesmo tenant do cadastro (e-mail em qualquer caixa)', async () => {
    const { email, tenantId } = await cadastrar();
    const r = await chamar('POST', '/auth/login', { corpo: { email: email.toUpperCase(), senha: SENHA } });
    expect(r.status).toBe(200);
    expect(payload(r.corpo.token).tenant_id).toBe(tenantId);
    expect(payload(r.corpo.token).papel).toBe('admin');
  });

  it('T-AUTH-05: senha errada e e-mail inexistente -> 401 com corpo idêntico', async () => {
    const { email } = await cadastrar();
    const senhaErrada = await chamar('POST', '/auth/login', { corpo: { email, senha: 'outra-senha-123' } });
    const naoExiste = await chamar('POST', '/auth/login', { corpo: { email: emailUnico('fantasma'), senha: SENHA } });
    expect(senhaErrada.status).toBe(401);
    expect(naoExiste.status).toBe(401);
    expect(senhaErrada.corpo).toEqual(naoExiste.corpo);
    expect(senhaErrada.corpo).toEqual({ erro: 'E-mail ou senha incorretos.', codigo: 'CREDENCIAIS_INVALIDAS' });
  });

  it('T-AUTH-07: o token vale 15 min (exp - iat = 900 s)', async () => {
    const { email } = await cadastrar();
    const r = await chamar('POST', '/auth/login', { corpo: { email, senha: SENHA } });
    const { iat, exp } = payload(r.corpo.token);
    expect(exp - iat).toBe(900);
  });

  it('T-AUTH-08: a senha é guardada com Argon2id e não aparece no hash', async () => {
    const { email } = await cadastrar();
    // buscar_credencial é a única forma de ler o hash sem tenant (e só o api_contatos pode executá-la).
    const api = await conectar('api_contatos');
    try {
      const { rows } = await api.query('SELECT senha_hash FROM orbita.buscar_credencial($1)', [email]);
      expect(rows).toHaveLength(1);
      expect(rows[0].senha_hash.startsWith('$argon2id$')).toBe(true);
      expect(rows[0].senha_hash).not.toContain(SENHA);
    } finally {
      await api.end();
    }
  });
});

describe('rotas protegidas', () => {
  it('T-AUTH-06: GET /contatos sem token -> 401 NAO_AUTENTICADO', async () => {
    const r = await chamar('GET', '/contatos');
    expect(r.status).toBe(401);
    expect(r.corpo).toEqual({ erro: 'Sua sessão expirou. Entre de novo.', codigo: 'NAO_AUTENTICADO' });
  });

  it('token com assinatura inválida -> 401 (mesmo corpo de "sem token")', async () => {
    const { token } = await cadastrar();
    const adulterado = `${token.slice(0, -4)}AAAA`;
    const r = await chamar('GET', '/contatos', { token: adulterado });
    expect(r.status).toBe(401);
    expect(r.corpo.codigo).toBe('NAO_AUTENTICADO');
  });

  it('x-request-id: devolvido o recebido; gerado quando ausente', async () => {
    const comId = await chamar('GET', '/saude', { headers: { 'x-request-id': 'teste-auth-123' } });
    expect(comId.headers.get('x-request-id')).toBe('teste-auth-123');
    const semId = await chamar('GET', '/saude');
    expect(semId.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(semId.corpo).toEqual({ db: 'ok', fila: 'ok' });
  });
});
