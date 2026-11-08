// Cliente HTTP único do Portal. TODO acesso à API passa por aqui.
//
// - URL relativa /api: o mesmo build serve simulador, compose, kind e VM (nunca host/porta fixos).
// - Injeta Authorization: Bearer. O token nunca vai para URL nem para log.
// - Trava do ADR-002: em desenvolvimento, lança erro se caminho, query ou corpo tiver "tenant".
// - Erros decididos pelo `codigo` do contrato (nunca comparando texto).
// - NAO_AUTENTICADO: limpa a sessão e avisa quem registrou aoSessaoExpirar (vai para o login).
// - Lê o x-request-id da resposta para o toast de erro inesperado ("código: ...").
// - Aceita AbortSignal; criarCanceladora() cancela a busca anterior quando chega uma nova.
import { limparSessao, sessaoAtual } from './sessao.js';

const BASE = '/api';

export class ErroApi extends Error {
  constructor({ status, codigo, mensagem, campos = [], extras = {}, requestId = null, retryAfter = null }) {
    super(mensagem ?? codigo);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.campos = campos;
    this.extras = extras; // dados extras do erro, no nível de cima do corpo (ex.: limite, linhas)
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

let aoExpirar = () => {};
/** A casca do app registra aqui o que fazer quando a sessão expira (ir para /entrar). */
export function definirAoSessaoExpirar(fn) {
  aoExpirar = fn;
}

function temChaveTenant(valor) {
  if (Array.isArray(valor)) return valor.some(temChaveTenant);
  if (valor && typeof valor === 'object') {
    return Object.entries(valor).some(([chave, v]) => /tenant/i.test(chave) || temChaveTenant(v));
  }
  return false;
}

/** ADR-002: o tenant vem só do token. Esta trava pega o erro no desenvolvimento, antes da API. */
export function conferirSemTenant(caminho, consulta, corpo) {
  if (/tenant/i.test(caminho) || temChaveTenant(consulta ?? {}) || temChaveTenant(corpo ?? {})) {
    throw new Error(`ADR-002: o Portal nunca envia tenant (caminho, query ou corpo). Requisição: ${caminho}`);
  }
}

function montarUrl(caminho, consulta) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(consulta ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const qs = params.toString();
  return `${BASE}${caminho}${qs ? `?${qs}` : ''}`;
}

/**
 * Chama a API.
 * @param {string} caminho  caminho do contrato, sem /api (ex.: "/contatos")
 * @param {object} [op]
 * @param {string} [op.metodo]       GET (padrão), POST, PATCH, DELETE
 * @param {object} [op.consulta]     query string
 * @param {object} [op.corpo]        corpo JSON
 * @param {Blob|string} [op.csv]     corpo text/csv (importação)
 * @param {AbortSignal} [op.sinal]   para cancelar
 * @param {boolean} [op.autenticar]  false nas rotas públicas
 * @param {'json'|'blob'} [op.resposta]
 */
export async function api(
  caminho,
  { metodo = 'GET', consulta, corpo, csv, sinal, autenticar = true, resposta = 'json' } = {},
) {
  if (import.meta.env.DEV) conferirSemTenant(caminho, consulta, corpo);

  const cabecalhos = { accept: 'application/json' };
  if (autenticar) {
    const sessao = sessaoAtual();
    if (!sessao) {
      // Token vencido ou ausente: nem faz a requisição.
      aoExpirar();
      throw new ErroApi({ status: 401, codigo: 'NAO_AUTENTICADO', mensagem: 'Sua sessão expirou. Entre de novo.' });
    }
    cabecalhos.authorization = `Bearer ${sessao.token}`;
  }

  let body;
  if (csv !== undefined) {
    cabecalhos['content-type'] = 'text/csv; charset=utf-8';
    body = csv;
  } else if (corpo !== undefined) {
    cabecalhos['content-type'] = 'application/json';
    body = JSON.stringify(corpo);
  }

  let res;
  try {
    res = await fetch(montarUrl(caminho, consulta), { method: metodo, headers: cabecalhos, body, signal: sinal });
  } catch (erro) {
    if (erro?.name === 'AbortError') throw erro; // cancelada de propósito: quem chamou ignora
    throw new ErroApi({ status: 0, codigo: 'REDE', mensagem: 'Não conseguimos falar com o servidor.' });
  }

  const requestId = res.headers.get('x-request-id');
  const ehJson = (res.headers.get('content-type') ?? '').includes('application/json');

  if (res.ok) {
    if (res.status === 204) return null;
    if (resposta === 'blob') return res.blob();
    return ehJson ? res.json() : null;
  }

  const dados = ehJson ? await res.json().catch(() => ({})) : {};
  const { erro: mensagem, codigo, campos, ...extras } = dados;
  const ra = Number(res.headers.get('retry-after'));
  const erro = new ErroApi({
    status: res.status,
    // Sem corpo do contrato (ex.: 502 em HTML vindo de um proxy): trata como erro do servidor.
    codigo: codigo ?? (res.status >= 500 ? 'ERRO_INTERNO' : 'DESCONHECIDO'),
    mensagem,
    campos: campos ?? [],
    extras,
    requestId,
    retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null,
  });

  if (erro.codigo === 'NAO_AUTENTICADO' && autenticar) {
    limparSessao();
    aoExpirar();
  }
  throw erro;
}

/** Cada chamada devolve um AbortSignal novo e cancela o anterior (busca com debounce). */
export function criarCanceladora() {
  let atual = null;
  return () => {
    atual?.abort();
    atual = new AbortController();
    return atual.signal;
  };
}

export const ehCancelamento = (erro) => erro?.name === 'AbortError';
