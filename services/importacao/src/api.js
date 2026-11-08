// Cliente das rotas /interno da API (contrato, seção 8), com token de serviço (regra 7).
//
// Token: JWT HS256 assinado com JWT_SERVICO_SEGREDO (segredo próprio, diferente do de usuário), com
// iss "importacao", aud "api-contatos", exp de 60 s e o claim tenant_id que veio no job. Um token novo
// por chamada: é barato (um HMAC) e nenhum token vive mais que a própria chamada.
// Assinado à mão com node:crypto: HS256 é só um HMAC-SHA256, e assim o worker não precisa de biblioteca
// de JWT (quem VERIFICA com rigor é a API).
import { createHmac } from 'node:crypto';

const VIDA_TOKEN_S = 60;
const TIMEOUT_MS = 10_000;

/** Erro que tentar de novo não resolve (4xx da API: importação inexistente, corpo inválido, token recusado). */
export class ErroDefinitivo extends Error {}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

export function assinarTokenServico(tenantId, segredo, agora = Math.floor(Date.now() / 1000)) {
  const corpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    tenant_id: tenantId,
    iss: 'importacao',
    aud: 'api-contatos',
    iat: agora,
    exp: agora + VIDA_TOKEN_S,
  })}`;
  return `${corpo}.${createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
}

/**
 * @param {{baseUrl: string, segredo: string}} cfg
 */
export function criarClienteApi({ baseUrl, segredo }) {
  async function chamar(acao, { importacaoId, tenantId, requestId }, corpo) {
    let resposta;
    try {
      resposta = await fetch(`${baseUrl}/interno/importacoes/${importacaoId}/${acao}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${assinarTokenServico(tenantId, segredo)}`,
          // O mesmo x-request-id do POST /importacoes: um pedido do usuário rastreável até o último lote.
          ...(requestId ? { 'x-request-id': requestId } : {}),
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (erro) {
      // API fora, timeout, DNS: passageiro. O BullMQ tenta de novo (backoff exponencial).
      throw new Error(`API inalcançável em ${acao}: ${erro.message}`);
    }
    const texto = await resposta.text();
    if (resposta.ok) return JSON.parse(texto);
    const mensagem = `API respondeu ${resposta.status} em ${acao}: ${texto.slice(0, 200)}`;
    // 429 e 5xx podem passar; 4xx (404 = importação de outro tenant ou apagada, 400, 401) não.
    if (resposta.status >= 400 && resposta.status < 500 && resposta.status !== 429) throw new ErroDefinitivo(mensagem);
    throw new Error(mensagem);
  }

  return {
    inicio: (ctx, totalLotes, linhasInvalidas) => chamar('inicio', ctx, { total_lotes: totalLotes, linhas_invalidas: linhasInvalidas }),
    lote: (ctx, numero, contatos) => chamar('lotes', ctx, { numero, contatos }),
    falha: (ctx, motivo) => chamar('falha', ctx, { motivo: motivo.slice(0, 500) }),
  };
}
