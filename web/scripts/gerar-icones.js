// Gera os ícones PNG do Portal a partir do símbolo SVG, usando o Chromium do Playwright
// (já é dependência de desenvolvimento por causa dos testes E2E; nada de lib nova).
//
// Uso: npm run icones   (rode de novo só se simbolo.svg mudar; os PNGs ficam versionados em public/)
//
// Por que quadrado cheio, sem canto arredondado: o iOS (apple-touch-icon) e o Android (manifest)
// recortam os cantos sozinhos. O símbolo ocupa 78% para sobrar margem quando o sistema recorta.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const simbolo = readFileSync(`${raiz}src/assets/marca/simbolo.svg`, 'utf8');
const simboloDataUrl = `data:image/svg+xml;base64,${Buffer.from(simbolo).toString('base64')}`;

const icones = [
  { arquivo: 'apple-touch-icon.png', tamanho: 180 },
  { arquivo: 'icone-192.png', tamanho: 192 },
  { arquivo: 'icone-512.png', tamanho: 512 },
];

const navegador = await chromium.launch();
try {
  for (const { arquivo, tamanho } of icones) {
    const pagina = await navegador.newPage({ viewport: { width: tamanho, height: tamanho } });
    await pagina.setContent(`
      <body style="margin:0">
        <div style="width:${tamanho}px;height:${tamanho}px;display:grid;place-items:center;
                    background:linear-gradient(180deg,#0B1B30,#020A1F)">
          <img src="${simboloDataUrl}" style="width:78%;height:78%" alt="">
        </div>
      </body>`);
    await pagina.locator('img').evaluate((img) => img.decode());
    await pagina.screenshot({ path: `${raiz}public/${arquivo}` });
    await pagina.close();
    console.log(`public/${arquivo} (${tamanho}x${tamanho})`);
  }
} finally {
  await navegador.close();
}
