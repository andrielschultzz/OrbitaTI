// Tema: escolha manual (claro | escuro) tem prioridade; sem ela, segue o sistema.
// A preferência fica em localStorage (não é dado de contato). Toda leitura/escrita em try/catch:
// em aba privada ou com storage bloqueado o Portal funciona do mesmo jeito.
const CHAVE = 'orbitati.tema';

export function temaEscolhido() {
  try {
    const t = localStorage.getItem(CHAVE);
    return t === 'claro' || t === 'escuro' ? t : null;
  } catch {
    return null;
  }
}

export function temaEfetivo() {
  return temaEscolhido() ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'escuro');
}

export function escolherTema(tema) {
  document.documentElement.dataset.tema = tema;
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {
    /* sem storage: vale só nesta aba */
  }
}
