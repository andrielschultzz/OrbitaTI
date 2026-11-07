// Cálculo puro do mapa de órbita "Saindo de órbita" (sem React, para testar com Vitest).
//
// Regra (bloco 13, Fase 3): cada contato frio é um ponto; quanto maior o dias_sem_interacao,
// mais longe do centro. 90 dias fica no anel interno e 365 ou mais no anel externo.
// Entre os dois a distância é linear. Abaixo de 90 fica no anel interno (não deveria acontecer,
// a API só devolve quem passou de `dias`, mas o desenho não pode quebrar).

export const DIAS_ANEL_INTERNO = 90;
export const DIAS_ANEL_EXTERNO = 365;

// Ângulo áureo: espalha N pontos ao redor do centro sem alinhar dois no mesmo raio visual,
// para qualquer N, e sempre na mesma posição para a mesma lista (desenho estável).
const ANGULO_AUREO = 137.508;
const ANGULO_INICIAL = -60; // primeiro ponto no alto, à direita

/** Fração 0..1 da distância entre o anel interno e o externo. */
export function fracaoDistancia(dias) {
  const t = (dias - DIAS_ANEL_INTERNO) / (DIAS_ANEL_EXTERNO - DIAS_ANEL_INTERNO);
  return Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
}

/**
 * Posição de um ponto no mapa.
 * @param {number} dias        dias_sem_interacao do contato
 * @param {number} indice      posição do contato na lista (0, 1, 2...)
 * @param {{centro:number, raioInterno:number, raioExterno:number}} geo  geometria do SVG
 * @returns {{x:number, y:number, raio:number, fracao:number}}
 */
export function posicaoNoMapa(dias, indice, { centro, raioInterno, raioExterno }) {
  const fracao = fracaoDistancia(dias);
  const raio = raioInterno + fracao * (raioExterno - raioInterno);
  const angulo = ((ANGULO_INICIAL + indice * ANGULO_AUREO) * Math.PI) / 180;
  return {
    x: centro + raio * Math.cos(angulo),
    y: centro + raio * Math.sin(angulo),
    raio,
    fracao,
  };
}
