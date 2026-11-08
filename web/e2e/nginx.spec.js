// O nginx da imagem (Fase 4): proxy, bloqueio de /api/interno, cabeçalhos de segurança, cache e SPA.
// Só faz sentido com E2E_URL apontando para o nginx (8080 no Docker, 30080 no kind).
import { expect, test } from '@playwright/test';

test.describe('nginx do Portal', () => {
  test('/healthz responde 200 sem passar pela API', async ({ request }) => {
    const r = await request.get('/healthz');
    expect(r.status()).toBe(200);
  });

  test('/api/saude chega na API pelo proxy (o /api é removido)', async ({ request }) => {
    const r = await request.get('/api/saude');
    expect(r.status()).toBe(200);
    expect(await r.json()).toMatchObject({ db: 'ok' });
  });

  for (const caminho of ['/api/interno/x', '/api/interno', '/api//interno/x', '/api/%69nterno/x', '/api/contatos/../interno/x']) {
    test(`${caminho} responde 404 no nginx`, async ({ request }) => {
      const r = await request.post(caminho, { data: {} });
      expect(r.status()).toBe(404);
    });
  }

  test('x-request-id: o do cliente é repassado; sem ele, o nginx gera um', async ({ request }) => {
    const comId = await request.get('/api/saude', { headers: { 'x-request-id': 'e2e-correlacao-1' } });
    expect(comId.headers()['x-request-id']).toBe('e2e-correlacao-1');
    const semId = await request.get('/api/saude');
    expect(semId.headers()['x-request-id']).toMatch(/^[0-9a-f-]{16,}$/);
  });

  test('cabeçalhos de segurança e cache do index.html', async ({ request }) => {
    const h = (await request.get('/')).headers();
    expect(h['content-security-policy']).toBe(
      "default-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['strict-transport-security']).toBeUndefined(); // sem HSTS: pode rodar em HTTP
    expect(h['cache-control']).toBe('no-cache');
    expect(h.server).toBe('nginx'); // sem versão (server_tokens off)
  });

  test('assets com hash: cache de 1 ano, imutável, gzip e CSP mantida', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const js = html.match(/\/assets\/index-[\w-]+\.js/)[0];
    const r = await request.get(js, { headers: { 'accept-encoding': 'gzip' } });
    expect(r.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.headers()['content-encoding']).toBe('gzip');
    expect(r.headers()['content-security-policy']).toBeTruthy();
  });

  test('SPA: rota do Portal devolve o index.html (o React Router decide a tela)', async ({ request }) => {
    const r = await request.get('/contatos/qualquer-coisa');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('text/html');
  });
});
