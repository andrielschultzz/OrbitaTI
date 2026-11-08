// Formatação para a tela. Funções puras (testadas em formatos.test.js).
// Datas chegam em ISO 8601 UTC (contrato) e são mostradas no fuso do navegador.

const DIA = 24 * 60 * 60 * 1000;

/** 4900 -> "R$ 49"; 4990 -> "R$ 49,90". Preço vem em centavos (inteiro) de GET /planos. */
export function formatarPreco(centavos) {
  const inteiro = centavos % 100 === 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: inteiro ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(centavos / 100);
}

/** 1048576 -> "1 MB"; 512000 -> "500 KB". */
export function formatarBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1).replace('.', ',')} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function diasDesde(iso, agora = Date.now()) {
  return Math.max(0, Math.floor((agora - Date.parse(iso)) / DIA));
}

/** "hoje", "ontem", "há 5 dias". */
export function haQuantoTempo(iso, agora = Date.now()) {
  const d = diasDesde(iso, agora);
  if (d === 0) return 'hoje';
  if (d === 1) return 'ontem';
  return `há ${d} dias`;
}

/** Situação do contato em uma linha. Não recalcula regra de negócio: só lê os campos. */
export function textoUltimaInteracao(contato, agora = Date.now()) {
  if (!contato.ultima_interacao_em) return `Cadastrado ${haQuantoTempo(contato.criado_em, agora)}, nunca contatado`;
  return `Último contato ${haQuantoTempo(contato.ultima_interacao_em, agora)}`;
}

export function formatarDataHora(iso) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

/** Date -> "AAAA-MM-DDTHH:mm" no fuso local (formato do <input type="datetime-local">). */
export function paraDatetimeLocal(data) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}T${p(data.getHours())}:${p(data.getMinutes())}`;
}

/** Link tel: só com dígitos e "+". */
export function linkTelefone(telefone) {
  const limpo = (telefone ?? '').replace(/[^\d+]/g, '');
  return limpo.replace(/\D/g, '').length >= 8 ? `tel:${limpo}` : null;
}

/**
 * Link do WhatsApp: https://wa.me/ só com dígitos.
 * - Começa com "+": o DDI veio explícito, usa como está.
 * - 10 ou 11 dígitos (DDD + número): prefixa 55 (Brasil).
 * - 12 ou 13 dígitos: assume que o DDI já veio. Fora disso, não arrisca (sem botão).
 */
export function linkWhatsApp(telefone) {
  const texto = (telefone ?? '').trim();
  const digitos = texto.replace(/\D/g, '');
  if (texto.startsWith('+')) return digitos.length >= 10 && digitos.length <= 15 ? `https://wa.me/${digitos}` : null;
  if (digitos.length === 10 || digitos.length === 11) return `https://wa.me/55${digitos}`;
  if (digitos.length === 12 || digitos.length === 13) return `https://wa.me/${digitos}`;
  return null;
}

/** "" ou só espaços vira null (o contrato usa null para campo opcional vazio). */
export const vazioParaNull = (v) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};
