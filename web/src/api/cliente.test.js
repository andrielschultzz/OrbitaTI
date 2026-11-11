// Unitários do cliente HTTP: decisão por `codigo`, NAO_AUTENTICADO -> logout e trava do "tenant".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, conferirSemTenant, criarCanceladora, definirAoSessaoExpirar, ErroApi } from './cliente.js';
import { limparSessao, salvarToken, sessaoAtual, voltarSeguro } from './sessao.js';
import { mensagemDeErro } from './mensagens.js';

// sessionStorage em memória (o Vitest roda em Node, sem navegador)
function storageFalso() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenCom = (claims) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.assinatura`;
const tokenValido = () =>
  tokenCom({ sub: 'u', tenant_id: 't', plano: 'individual', papel: 'admin', exp: Math.floor(Date.now() / 1000) + 900 });

function respostaJson(status, corpo, cabecalhos = {}) {
  return new Response(corpo === null ? null : JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-123', ...cabecalhos },
  });
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', storageFalso());
  limparSessao();
});
afterEach(() => {
  vi.unstubAllGlobals();
  definirAoSessaoExpirar(() => {});
});

describe('trava do ADR-002 (tenant)', () => {
  it('lança erro com tenant no caminho, na query ou no corpo (inclusive aninhado)', () => {
    expect(() => conferirSemTenant('/tenants/1')).toThrow(/ADR-002/);
    expect(() => conferirSemTenant('/contatos', { tenant_id: 'x' })).toThrow(/ADR-002/);
    expect(() => conferirSemTenant('/contatos', null, { nome: 'A', tenant_id: 'x' })).toThrow(/ADR-002/);
    expect(() => conferirSemTenant('/contatos', null, { meta: [{ TenantId: 1 }] })).toThrow(/ADR-002/);
    expect(() => conferirSemTenant('/contatos', { busca: 'ana' }, { nome: 'Tenente Silva' })).not.toThrow();
  });

  it('api() nem chega a chamar o fetch quando há tenant', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    salvarToken(tokenValido());
    await expect(api('/contatos', { metodo: 'POST', corpo: { nome: 'A', tenant_id: 'x' } })).rejects.toThrow(/ADR-002/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('requisição', () => {
  it('usa /api relativo, Authorization Bearer e nunca põe o token na URL', async () => {
    const fetch = vi.fn().mockResolvedValue(respostaJson(200, { itens: [], limite: 100 }));
    vi.stubGlobal('fetch', fetch);
    const token = tokenValido();
    salvarToken(token);
    await api('/contatos', { consulta: { busca: 'ana', vazio: '' } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/contatos?busca=ana');
    expect(url).not.toContain(token);
    expect(init.headers.authorization).toBe(`Bearer ${token}`);
  });

  it('rota pública não manda Authorization', async () => {
    const fetch = vi.fn().mockResolvedValue(respostaJson(200, { token: 'x' }));
    vi.stubGlobal('fetch', fetch);
    await api('/auth/login', { metodo: 'POST', corpo: { email: 'a@a.com', senha: '12345678' }, autenticar: false });
    expect(fetch.mock.calls[0][1].headers.authorization).toBeUndefined();
  });
});

describe('erros decididos pelo codigo', () => {
  it('monta ErroApi com codigo, campos, extras no nível de cima, x-request-id e Retry-After', async () => {
    salvarToken(tokenValido());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson(422, { erro: 'texto da API', codigo: 'LINHAS_ACIMA_DO_PLANO', limite: 100, linhas: 253 }),
      ),
    );
    const erro = await api('/importacoes', { metodo: 'POST', csv: 'nome;email' }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro).toMatchObject({ status: 422, codigo: 'LINHAS_ACIMA_DO_PLANO', requestId: 'req-123' });
    expect(erro.extras).toEqual({ limite: 100, linhas: 253 });
    expect(mensagemDeErro(erro, 'importar')).toBe('Seu plano permite até 100 linhas; o arquivo tem 253.');
  });

  it('a mensagem depende do codigo e da tela, não do texto', () => {
    const e = (codigo, extra = {}) => new ErroApi({ status: 400, codigo, mensagem: 'qualquer texto', ...extra });
    expect(mensagemDeErro(e('LIMITE_REQUISICOES'), 'login')).toBe('Muitas tentativas. Aguarde um minuto.');
    expect(mensagemDeErro(e('LIMITE_REQUISICOES', { retryAfter: 12 }), 'contato')).toBe(
      'Muitas ações seguidas. Tente de novo em 12 s.',
    );
    expect(mensagemDeErro(e('NAO_ENCONTRADO'), 'contato')).toBe('Não encontramos esse contato.');
    expect(mensagemDeErro(e('FILA_INDISPONIVEL'), 'conta')).toMatch(/^Não foi possível cancelar agora/);
    expect(mensagemDeErro(e('FILA_INDISPONIVEL'), 'importar')).toBe('qualquer texto'); // texto da API
    expect(mensagemDeErro(e('ERRO_INTERNO'))).toMatch(/Não conseguimos falar com o servidor/);
  });

  it('falha de rede vira codigo REDE; 502 sem JSON vira ERRO_INTERNO', async () => {
    salvarToken(tokenValido());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect((await api('/contatos').catch((e) => e)).codigo).toBe('REDE');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })));
    expect((await api('/contatos').catch((e) => e)).codigo).toBe('ERRO_INTERNO');
  });

  it('cancelamento (AbortError) é repassado como está, para a tela ignorar', async () => {
    salvarToken(tokenValido());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('cancelada', 'AbortError')));
    expect((await api('/contatos').catch((e) => e)).name).toBe('AbortError');
  });
});

describe('sessão', () => {
  it('NAO_AUTENTICADO da API limpa a sessão e chama aoSessaoExpirar', async () => {
    salvarToken(tokenValido());
    const aoExpirar = vi.fn();
    definirAoSessaoExpirar(aoExpirar);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(401, { erro: 'x', codigo: 'NAO_AUTENTICADO' })));
    const erro = await api('/contatos').catch((e) => e);
    expect(erro.codigo).toBe('NAO_AUTENTICADO');
    expect(aoExpirar).toHaveBeenCalledOnce();
    expect(sessaoAtual()).toBeNull();
  });

  it('login com senha errada (CREDENCIAIS_INVALIDAS) NÃO derruba sessão nem redireciona', async () => {
    const aoExpirar = vi.fn();
    definirAoSessaoExpirar(aoExpirar);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(401, { erro: 'x', codigo: 'CREDENCIAIS_INVALIDAS' })));
    await api('/auth/login', { metodo: 'POST', corpo: {}, autenticar: false }).catch(() => {});
    expect(aoExpirar).not.toHaveBeenCalled();
  });

  it('token já vencido: nem chama o fetch, vai direto para o login', async () => {
    salvarToken(tokenCom({ plano: 'individual', papel: 'admin', exp: Math.floor(Date.now() / 1000) - 1 }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const aoExpirar = vi.fn();
    definirAoSessaoExpirar(aoExpirar);
    expect((await api('/contatos').catch((e) => e)).codigo).toBe('NAO_AUTENTICADO');
    expect(fetch).not.toHaveBeenCalled();
    expect(aoExpirar).toHaveBeenCalledOnce();
  });

  it('lê plano, papel e exp do token; token ilegível é descartado', () => {
    salvarToken(tokenValido());
    expect(sessaoAtual()).toMatchObject({ plano: 'individual', papel: 'admin' });
    salvarToken('isto-nao-e-jwt');
    expect(sessaoAtual()).toBeNull();
  });

  it('voltar só aceita caminho interno', () => {
    expect(voltarSeguro('/contatos/abc?x=1')).toBe('/contatos/abc?x=1');
    for (const ruim of ['//site-falso.com', '/\\site-falso.com', 'https://site-falso.com', 'contatos', null]) {
      expect(voltarSeguro(ruim)).toBe('/contatos');
    }
  });
});

describe('cancelamento da busca anterior', () => {
  it('cada novo sinal aborta o anterior', () => {
    const proximo = criarCanceladora();
    const s1 = proximo();
    const s2 = proximo();
    expect(s1.aborted).toBe(true);
    expect(s2.aborted).toBe(false);
  });
});
