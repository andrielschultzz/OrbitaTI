import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// O tema claro aparece DUAS vezes no tokens.css: uma pelo sistema (prefers-color-scheme) e uma pelo
// alternador manual ([data-tema="claro"]). O CSS não tem como reaproveitar um bloco no outro sem
// etapa extra de build, então este teste garante que os dois nunca fiquem diferentes.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** Pega o corpo { ... } que começa logo depois de `seletor` (conta chaves, não usa regex gulosa). */
function corpoDepois(seletor) {
  const inicio = css.indexOf(seletor);
  expect(inicio, `seletor não encontrado: ${seletor}`).toBeGreaterThan(-1);
  const abre = css.indexOf('{', inicio);
  let nivel = 0;
  for (let i = abre; i < css.length; i++) {
    if (css[i] === '{') nivel++;
    if (css[i] === '}' && --nivel === 0) return css.slice(abre + 1, i);
  }
  throw new Error('chave sem fechamento');
}

/** Lista de [variável, valor] na ordem, sem comentários e sem espaços. */
function variaveis(corpo) {
  return [...corpo.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, nome, valor]) => [
    nome,
    valor.replace(/\s+/g, ' ').trim(),
  ]);
}

describe('tokens do tema', () => {
  const pelaPreferencia = variaveis(corpoDepois(':root:not([data-tema="escuro"])'));
  const peloAlternador = variaveis(corpoDepois(':root[data-tema="claro"]'));
  const escuro = variaveis(corpoDepois(':root {'));

  it('os dois blocos do tema claro são idênticos', () => {
    expect(pelaPreferencia.length).toBeGreaterThan(10);
    expect(peloAlternador).toEqual(pelaPreferencia);
  });

  it('todo token que o claro redefine existe no escuro (nenhum nome com erro de digitação)', () => {
    const nomesEscuro = new Set(escuro.map(([n]) => n));
    expect(pelaPreferencia.map(([n]) => n).filter((n) => !nomesEscuro.has(n))).toEqual([]);
  });
});
