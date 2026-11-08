// Montagem dos e-mails (unitário, sem SMTP e sem Redis).
import { describe, expect, it } from 'vitest';
import { DadosInvalidos, escaparHtml, mascararEmail, montarEmail } from '../src/mensagens.js';

const JOB = { tipo: 'confirmar-cadastro', para: 'marcelo@devsolo.dev', nome: 'Marcelo', link: 'http://localhost:8080/confirmar-email?token=abc.def.ghi' };

describe('confirmar-cadastro', () => {
  it('assunto, destinatário e o link no texto e no HTML', () => {
    const e = montarEmail(JOB);
    expect(e.to).toBe('marcelo@devsolo.dev');
    expect(e.subject).toBe('Confirme seu e-mail no OrbitaTI');
    expect(e.text).toContain(JOB.link);
    expect(e.html).toContain(`href="${JOB.link}"`);
    expect(e.text).toContain('24 horas');
  });

  it('o nome digitado no cadastro é escapado no HTML (não vira link nem script)', () => {
    const e = montarEmail({ ...JOB, nome: '<a href="https://golpe">clique</a>' });
    expect(e.html).not.toContain('<a href="https://golpe">');
    expect(e.html).toContain('&lt;a href=&quot;https://golpe&quot;&gt;');
  });

  it('link que não é http(s) é recusado (nada de javascript: no href)', () => {
    expect(() => montarEmail({ ...JOB, link: 'javascript:alert(1)' })).toThrow(DadosInvalidos);
  });
});

describe('dados sem conserto -> DadosInvalidos (o worker não tenta de novo)', () => {
  it.each([
    ['tipo desconhecido', { ...JOB, tipo: 'outro' }],
    ['sem destinatário', { ...JOB, para: undefined }],
    ['vários destinatários', { ...JOB, para: 'a@x.dev, b@y.dev' }],
    ['sem nome', { ...JOB, nome: ' ' }],
  ])('%s', (_nome, dados) => {
    expect(() => montarEmail(dados)).toThrow(DadosInvalidos);
  });
});

describe('o que vai para o log', () => {
  it('e-mail mascarado: primeira letra e domínio', () => {
    expect(mascararEmail('marcelo@devsolo.dev')).toBe('m***@devsolo.dev');
    expect(mascararEmail(undefined)).toBe('***');
  });

  it('escaparHtml cobre os 5 caracteres especiais', () => {
    expect(escaparHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
