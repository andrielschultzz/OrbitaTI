import { defineConfig, devices } from '@playwright/test';

// A suíte roda contra QUALQUER Portal no ar: o alvo vem de E2E_URL.
//   agora (modo B):  simulador + imagem do nginx  -> http://localhost:8080 (padrão)
//   Fase 6:          stack real do compose         -> http://localhost:8080
//   kind:            NodePort                      -> http://localhost:30080
// As chamadas de preparo (cadastro, contato de outra empresa) também passam por E2E_URL + /api,
// nunca direto na porta da API: assim a suíte testa o caminho que o usuário usa, com o nginx no meio.
const baseURL = process.env.E2E_URL ?? 'http://localhost:8080';

// Celular do Marcelo, em português, no fuso de Brasília. O --lang=pt-BR faz os controles nativos
// (datetime-local) seguirem o formato brasileiro; só o `locale` não basta para eles.
const comum = {
  ...devices['Desktop Chrome'],
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  launchOptions: { args: ['--lang=pt-BR'] },
};

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // O simulador guarda estado em memória e tem rate limit por IP no cadastro: 2 workers basta e não
  // dispara o limite. Cada teste cria a própria empresa com e-mail único, então a ordem não importa.
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'e2e',
      testIgnore: /capturas\.spec\.js/,
      use: { ...comum, viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true },
    },
    {
      // Separado: gera 4 tamanhos × 2 temas de cada tela. Roda com `npm run capturas`.
      name: 'capturas',
      testMatch: /capturas\.spec\.js/,
      use: { ...comum, reducedMotion: 'reduce' },
    },
  ],
});
