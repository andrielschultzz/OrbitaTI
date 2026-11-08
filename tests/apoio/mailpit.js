// Apoio dos testes que leem a caixa do Mailpit (bloco 10). Não termina em .test.js.
// API do Mailpit: http://127.0.0.1:8025/api/v1 (porta publicada só em 127.0.0.1 no compose).

export const MAILPIT = process.env.MAILPIT_URL_TESTES ?? 'http://127.0.0.1:8025';

/** Mensagens endereçadas a `email` (resumo: ID, Created, Subject...). */
export async function buscar(email) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (!r.ok) throw new Error(`Mailpit respondeu ${r.status}`);
  return (await r.json()).messages ?? [];
}

/**
 * Espera a primeira mensagem para `email` aparecer, consultando a cada `intervaloMs`.
 * Devolve {mensagem, ms} (ms = desde `inicio`) ou lança depois de `limiteMs`.
 */
export async function esperarMensagem(email, { inicio = performance.now(), limiteMs = 45_000, intervaloMs = 100 } = {}) {
  for (;;) {
    const [mensagem] = await buscar(email);
    const ms = performance.now() - inicio;
    if (mensagem) return { mensagem, ms };
    if (ms > limiteMs) throw new Error(`nenhum e-mail para ${email} em ${limiteMs} ms`);
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
}

/** Mensagem completa (Text, HTML, From, To...). */
export async function lerMensagem(id) {
  const r = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  if (!r.ok) throw new Error(`Mailpit respondeu ${r.status}`);
  return r.json();
}

/** Token do link de confirmação dentro do texto do e-mail. */
export const tokenDoEmail = (texto) => new URL(texto.match(/https?:\/\/\S+confirmar-email\?token=\S+/)[0]).searchParams.get('token');

/** Apaga as mensagens de `email` (a caixa não acumula lixo da suíte entre execuções). */
export async function apagar(email) {
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, { method: 'DELETE' });
}
