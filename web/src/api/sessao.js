// Sessão do Portal: só o token, em sessionStorage (some ao fechar a aba).
// Nenhum dado de contato vai para storage (LGPD); só o token.
//
// O Portal DECODIFICA o token sem verificar a assinatura, só para ler plano, papel e exp e decidir
// o que mostrar. Quem decide permissão é sempre a API (ela verifica a assinatura em toda requisição).
// O tenant_id do token nunca é lido nem enviado pelo Portal (ADR-002): o token já o carrega.
const CHAVE = 'orbitati.token';

function armazenamento() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null; // storage bloqueado: a sessão dura só enquanto a página estiver aberta
  }
}
let tokenEmMemoria = null;

/** Lê os claims do JWT (parte do meio, base64url). Devolve null se não for um JWT legível. */
export function decodificarToken(token) {
  try {
    const meio = token.split('.')[1];
    const base64 = meio.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(meio.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return typeof claims.exp === 'number' ? claims : null;
  } catch {
    return null;
  }
}

// Fonte da verdade: o sessionStorage. A memória é só reserva para quando o storage está bloqueado
// (aba privada em alguns navegadores); nunca as duas ao mesmo tempo, para não haver dois tokens.
export function salvarToken(token) {
  try {
    const s = armazenamento();
    if (!s) throw new Error('sem storage');
    s.setItem(CHAVE, token);
    tokenEmMemoria = null;
  } catch {
    tokenEmMemoria = token;
  }
}

export function limparSessao() {
  tokenEmMemoria = null;
  try {
    armazenamento()?.removeItem(CHAVE);
  } catch {
    /* nada a limpar */
  }
}

/** O token guardado na aba, sem validar (para saber se HAVIA uma sessão que venceu). */
export function tokenGuardado() {
  let token = null;
  try {
    token = armazenamento()?.getItem(CHAVE) ?? null;
  } catch {
    /* sem storage */
  }
  return token ?? tokenEmMemoria;
}

/**
 * Sessão válida agora, ou null. Token vencido é apagado na hora: abrir o Portal com o token
 * vencido leva direto ao login, sem uma requisição que já se sabe que vai dar 401.
 */
export function sessaoAtual(agora = Date.now()) {
  const token = tokenGuardado();
  if (!token) return null;
  const claims = decodificarToken(token);
  if (!claims || claims.exp * 1000 <= agora) {
    limparSessao();
    return null;
  }
  return { token, plano: claims.plano, papel: claims.papel, exp: claims.exp };
}

/**
 * Para onde voltar depois do login. Só caminhos internos: começa com "/" e não com "//".
 * Também recusa "/\", que alguns navegadores tratam como "//".
 * Sem isso, um link /entrar?voltar=//site-falso.com mandaria o usuário para fora depois de entrar.
 */
export function voltarSeguro(voltar, padrao = '/contatos') {
  if (typeof voltar !== 'string' || !voltar.startsWith('/')) return padrao;
  if (voltar.startsWith('//') || voltar.startsWith('/\\')) return padrao;
  return voltar;
}
