// Lê a escolha manual de tema (claro/escuro) antes da primeira pintura.
// Sem escolha manual, quem decide é o CSS (prefers-color-scheme, com escuro como padrão).
// Guardar a preferência de tema não é dado pessoal de contato (LGPD ok).
try {
  var t = localStorage.getItem('orbitati.tema');
  if (t === 'claro' || t === 'escuro') document.documentElement.dataset.tema = t;
} catch (e) {
  /* storage bloqueado (aba privada): segue o sistema */
}
