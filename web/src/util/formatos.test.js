import { describe, expect, it } from 'vitest';
import {
  formatarBytes,
  formatarPreco,
  haQuantoTempo,
  linkTelefone,
  linkWhatsApp,
  textoUltimaInteracao,
  vazioParaNull,
} from './formatos.js';

const nbsp = (s) => s.replace(/ /g, ' ');

describe('formatos', () => {
  it('preço em centavos', () => {
    expect(nbsp(formatarPreco(4900))).toBe('R$ 49');
    expect(nbsp(formatarPreco(24900))).toBe('R$ 249');
    expect(nbsp(formatarPreco(4990))).toBe('R$ 49,90');
  });

  it('bytes', () => {
    expect(formatarBytes(1048576)).toBe('1 MB');
    expect(formatarBytes(1572864)).toBe('1,5 MB');
    expect(formatarBytes(512000)).toBe('500 KB');
  });

  it('WhatsApp: só dígitos, 55 quando vem sem DDI, nada quando não dá para saber', () => {
    expect(linkWhatsApp('(54) 99999-0000')).toBe('https://wa.me/5554999990000');
    expect(linkWhatsApp('(54) 3333-0000')).toBe('https://wa.me/555433330000');
    expect(linkWhatsApp('+55 54 99999-0000')).toBe('https://wa.me/5554999990000');
    expect(linkWhatsApp('+1 415 555 0100')).toBe('https://wa.me/14155550100'); // "+" = DDI explícito
    expect(linkWhatsApp('54 99999-0000')).toBe('https://wa.me/5554999990000'); // sem "+": regra BR
    expect(linkWhatsApp('ramal 23')).toBe(null);
    expect(linkWhatsApp(null)).toBe(null);
  });

  it('telefone: tel: só com dígitos e +', () => {
    expect(linkTelefone('(54) 99999-0000')).toBe('tel:54999990000');
    expect(linkTelefone('+55 54 99999-0000')).toBe('tel:+5554999990000');
    expect(linkTelefone('123')).toBe(null);
  });

  it('tempo relativo e situação do contato', () => {
    const agora = Date.parse('2026-11-07T12:00:00Z');
    expect(haQuantoTempo('2026-11-07T08:00:00Z', agora)).toBe('hoje');
    expect(haQuantoTempo('2026-11-06T08:00:00Z', agora)).toBe('ontem');
    expect(haQuantoTempo('2026-10-28T12:00:00Z', agora)).toBe('há 10 dias');
    expect(textoUltimaInteracao({ ultima_interacao_em: null, criado_em: '2026-10-28T12:00:00Z' }, agora)).toBe(
      'Cadastrado há 10 dias, nunca contatado',
    );
  });

  it('vazio vira null', () => {
    expect(vazioParaNull('  ')).toBe(null);
    expect(vazioParaNull(' Ana ')).toBe('Ana');
  });
});
