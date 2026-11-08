import { describe, expect, it } from 'vitest';
import { DIAS_ANEL_EXTERNO, DIAS_ANEL_INTERNO, fracaoDistancia, posicaoNoMapa } from './orbita.js';

// Mesma geometria do MapaOrbita.jsx (SVG de 320 × 320).
const GEO = { centro: 160, raioInterno: 72, raioExterno: 140 };
const distancia = ({ x, y }) => Math.hypot(x - GEO.centro, y - GEO.centro);

describe('mapa de órbita: distância do centro', () => {
  it('90 dias fica no anel interno e 365 no externo', () => {
    expect(distancia(posicaoNoMapa(DIAS_ANEL_INTERNO, 0, GEO))).toBeCloseTo(GEO.raioInterno);
    expect(distancia(posicaoNoMapa(DIAS_ANEL_EXTERNO, 0, GEO))).toBeCloseTo(GEO.raioExterno);
  });

  it('entre os dois anéis a distância é linear (meio do caminho = raio do meio)', () => {
    const meio = (DIAS_ANEL_INTERNO + DIAS_ANEL_EXTERNO) / 2;
    expect(fracaoDistancia(meio)).toBeCloseTo(0.5);
    expect(distancia(posicaoNoMapa(meio, 3, GEO))).toBeCloseTo(106);
  });

  it('quanto mais dias sem conversa, mais longe do centro', () => {
    const raios = [90, 120, 200, 300, 365].map((d) => posicaoNoMapa(d, 0, GEO).raio);
    expect(raios).toEqual([...raios].sort((a, b) => a - b));
    expect(new Set(raios).size).toBe(raios.length);
  });

  it('valores fora da faixa não quebram o desenho: ficam presos nos anéis', () => {
    expect(fracaoDistancia(10)).toBe(0);
    expect(fracaoDistancia(5000)).toBe(1);
    expect(fracaoDistancia(Number.NaN)).toBe(0);
    expect(distancia(posicaoNoMapa(5000, 1, GEO))).toBeCloseTo(GEO.raioExterno);
  });
});

describe('mapa de órbita: ângulo', () => {
  it('a mesma lista desenha sempre igual (determinístico)', () => {
    expect(posicaoNoMapa(150, 2, GEO)).toEqual(posicaoNoMapa(150, 2, GEO));
  });

  it('5 contatos com os mesmos dias não se sobrepõem', () => {
    const pts = [0, 1, 2, 3, 4].map((i) => posicaoNoMapa(200, i, GEO));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        // 14 = 2 × raio do ponto desenhado (7): os círculos não encostam
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(14);
      }
    }
  });

  it('todo ponto cabe dentro do SVG', () => {
    for (let i = 0; i < 20; i++) {
      const { x, y } = posicaoNoMapa(365, i, GEO);
      expect(x).toBeGreaterThanOrEqual(GEO.centro - GEO.raioExterno - 1e-9);
      expect(x).toBeLessThanOrEqual(GEO.centro + GEO.raioExterno + 1e-9);
      expect(y).toBeGreaterThanOrEqual(GEO.centro - GEO.raioExterno - 1e-9);
      expect(y).toBeLessThanOrEqual(GEO.centro + GEO.raioExterno + 1e-9);
    }
  });
});
