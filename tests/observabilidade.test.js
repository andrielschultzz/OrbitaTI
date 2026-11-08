// Observabilidade (bloco 5): x-request-id. O "id atravessa a fila" (T-OBS-02) é ensaio com os logs do
// compose; aqui fica só o que dá para conferir pela resposta HTTP.
//
// Pré-requisito: docker compose up -d --build --wait
import { describe, expect, it } from 'vitest';
import { chamar } from './apoio/api.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idDa = async (headers) => (await chamar('GET', '/saude', { headers })).headers.get('x-request-id');

describe('T-OBS-01: x-request-id aceito ou gerado', () => {
  it('com x-request-id: demo-123 -> a resposta devolve demo-123', async () => {
    expect(await idDa({ 'x-request-id': 'demo-123' })).toBe('demo-123');
  });

  it('sem o header -> a API gera um UUID (diferente a cada requisição)', async () => {
    const [um, dois] = [await idDa({}), await idDa({})];
    expect(um).toMatch(UUID);
    expect(dois).toMatch(UUID);
    expect(um).not.toBe(dois);
  });

  it('valor fora do formato (espaço, gigante) -> descartado e trocado por um UUID', async () => {
    // Vai para todo log: um valor com quebra de linha ou de 10 KB poderia forjar ou poluir linhas de log.
    expect(await idDa({ 'x-request-id': 'a b' })).toMatch(UUID);
    expect(await idDa({ 'x-request-id': 'x'.repeat(129) })).toMatch(UUID);
  });

  it('erro também leva o id (é o código que o usuário informa ao suporte)', async () => {
    const r = await chamar('GET', '/contatos', { headers: { 'x-request-id': 'demo-401' } });
    expect(r.status).toBe(401);
    expect(r.headers.get('x-request-id')).toBe('demo-401');
  });
});
