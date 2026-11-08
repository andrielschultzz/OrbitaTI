// Montagem dos e-mails: funções puras, sem rede (testadas em test/mensagens.test.js).
//
// Cada "tipo" de job vira assunto + texto + HTML. Tipo desconhecido ou dado faltando é erro SEM conserto
// (DadosInvalidos): tentar de novo daria o mesmo resultado, então o worker desiste na primeira vez.

export class DadosInvalidos extends Error {}

/**
 * Escapa texto para dentro do HTML. O nome é digitado pela pessoa no cadastro: sem isto, um nome como
 * <a href="https://golpe">clique</a> viraria um link de verdade dentro de um e-mail com a nossa marca.
 */
export const escaparHtml = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * E-mail para o log: m***@devsolo.dev. O endereço completo é dado pessoal (LGPD) e não precisa estar
 * no log; o domínio basta para investigar "o provedor X está recusando".
 */
export function mascararEmail(email) {
  const [local, dominio] = String(email).split('@');
  if (!dominio) return '***';
  return `${local.slice(0, 1)}***@${dominio}`;
}

const textoValido = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function confirmarCadastro({ nome, link }) {
  if (!textoValido(nome, 120)) throw new DadosInvalidos('nome inválido');
  // O link vem da API (PORTAL_URL + token). Mesmo assim, só http(s): nada de javascript: no href.
  if (!textoValido(link, 4096) || !/^https?:\/\//.test(link)) throw new DadosInvalidos('link inválido');

  const nomeHtml = escaparHtml(nome);
  const linkHtml = escaparHtml(link);
  return {
    subject: 'Confirme seu e-mail no OrbitaTI',
    text: [
      `Olá, ${nome}!`,
      '',
      'Sua conta no OrbitaTI foi criada. Para confirmar seu e-mail, abra o link abaixo:',
      '',
      link,
      '',
      'O link vale por 24 horas. Se você não criou esta conta, ignore esta mensagem.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
<p>Olá, ${nomeHtml}!</p>
<p>Sua conta no OrbitaTI foi criada. Para confirmar seu e-mail, clique no botão:</p>
<p><a href="${linkHtml}" style="display:inline-block;padding:10px 18px;background:#4338ca;color:#ffffff;text-decoration:none;border-radius:6px">Confirmar e-mail</a></p>
<p style="font-size:13px;color:#6b7280">Se o botão não funcionar, copie este endereço no navegador:<br>${linkHtml}</p>
<p style="font-size:13px;color:#6b7280">O link vale por 24 horas. Se você não criou esta conta, ignore esta mensagem.</p>
</body></html>`,
  };
}

const TIPOS = { 'confirmar-cadastro': confirmarCadastro };

/**
 * Dados do job -> {to, subject, text, html}. Lança DadosInvalidos se o job não tem como virar e-mail.
 * @param {{tipo: string, para: string}} dados
 */
export function montarEmail(dados) {
  const montar = TIPOS[dados?.tipo];
  if (!montar) throw new DadosInvalidos(`tipo desconhecido: ${String(dados?.tipo).slice(0, 40)}`);
  // Validação simples: quem garante o formato é a API (schema do cadastro). Aqui só não deixamos passar
  // algo que o SMTP interpretaria como vários destinatários.
  if (!textoValido(dados.para, 254) || !/^[^\s@,;<>]+@[^\s@,;<>]+$/.test(dados.para)) {
    throw new DadosInvalidos('destinatário inválido');
  }
  return { to: dados.para, ...montar(dados) };
}
