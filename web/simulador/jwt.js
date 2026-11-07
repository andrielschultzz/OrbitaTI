// JWT HS256 mínimo com node:crypto, só para o simulador (sem dependência extra).
// A API real usa @fastify/jwt; o formato do token é o mesmo (contrato, seção 3).
import { createHmac, timingSafeEqual } from 'node:crypto';

// Segredo FIXO de desenvolvimento. Não é segredo de verdade: o simulador nunca roda em produção
// e nunca entra na imagem Docker. A API real lê JWT_SEGREDO do .env.
export const SEGREDO_SIMULADOR = 'simulador-orbitati-somente-desenvolvimento';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function assinar(claims, segredo = SEGREDO_SIMULADOR) {
  const cabecalho = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify(claims));
  const assinatura = createHmac('sha256', segredo).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

/** Devolve os claims, ou null se o token for inválido, adulterado ou expirado. */
export function verificar(token, segredo = SEGREDO_SIMULADOR) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [cabecalho, corpo, assinatura] = partes;
  const esperada = createHmac('sha256', segredo).update(`${cabecalho}.${corpo}`).digest();
  const recebida = Buffer.from(assinatura, 'base64url');
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    const h = JSON.parse(Buffer.from(cabecalho, 'base64url').toString());
    if (h.alg !== 'HS256') return null; // recusa alg "none" e afins
    const claims = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
