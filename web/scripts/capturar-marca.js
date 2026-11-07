// Capturas da amostra /marca em 375 e 1440 px, nos temas escuro e claro.
// Sobe o Vite em modo desenvolvimento (a /marca só existe em DEV), tira as capturas e derruba.
// Saída: capturas/marca/ (ignorada pelo git).
//
// Uso: npm run capturas:marca
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const saida = `${raiz}capturas/marca`;
mkdirSync(saida, { recursive: true });

const servidor = await createServer({ root: raiz, server: { port: 5199, strictPort: true }, logLevel: 'warn' });
await servidor.listen();
const navegador = await chromium.launch();
const errosConsole = [];
try {
  for (const largura of [375, 1440]) {
    for (const tema of ['escuro', 'claro']) {
      const contexto = await navegador.newContext({
        viewport: { width: largura, height: largura < 768 ? 812 : 900 },
        deviceScaleFactor: largura < 768 ? 2 : 1,
        colorScheme: tema === 'claro' ? 'light' : 'dark',
        reducedMotion: 'reduce', // captura estável: nada girando
      });
      const pagina = await contexto.newPage();
      pagina.on('console', (m) => m.type() === 'error' && errosConsole.push(`${largura}/${tema}: ${m.text()}`));
      pagina.on('pageerror', (e) => errosConsole.push(`${largura}/${tema}: ${e.message}`));
      await pagina.goto('http://localhost:5199/marca', { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      const rolagemHorizontal = await pagina.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      const arquivo = `${saida}/marca-${largura}-${tema}.png`;
      await pagina.screenshot({ path: arquivo, fullPage: true });
      console.log(`${arquivo}${rolagemHorizontal ? '  <-- ROLAGEM HORIZONTAL' : ''}`);
      await contexto.close();
    }
  }
} finally {
  await navegador.close();
  await servidor.close();
}
if (errosConsole.length) {
  console.error('Erros no console do navegador:\n' + errosConsole.join('\n'));
  process.exitCode = 1;
}
