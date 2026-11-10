// Contatos: T-CON-01 a T-CON-04 do docs/plano-de-testes.md, contra a API do compose, e uma checagem
// mínima de isolamento (regra do CLAUDE.md: funcionalidade nova com dado de tenant ganha teste de
// isolamento). A tabela completa de rotas cruzadas (T-ISO-01 a 15) fica no tests/isolamento.test.js (bloco 3).
// Pré-requisito: docker compose up -d --build --wait
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cadastrar, chamar, limparTenants, randomUUID } from './apoio/api.js';

// Formato do objeto Contato (contrato, seção 5). estagio entrou no bloco 12. Nunca tenant_id.
const CAMPOS_CONTATO = [
  'atualizado_em', 'criado_em', 'email', 'empresa', 'estagio', 'id', 'nome', 'observacao', 'telefone', 'ultima_interacao_em',
];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NAO_ENCONTRADO = { erro: 'Contato não encontrado.', codigo: 'NAO_ENCONTRADO' };

let A; // tenant A
let B; // tenant B
const criar = (tenant, corpo) => chamar('POST', '/contatos', { token: tenant.token, corpo });

beforeAll(async () => {
  A = await cadastrar({ empresa: 'Tenant A' });
  B = await cadastrar({ empresa: 'Tenant B' });
});
afterAll(limparTenants);

describe('T-CON-01: CRUD completo de um tenant', () => {
  it('cria, lê, altera, lista e exclui (201, 200, 200, 200, 204; depois 404)', async () => {
    const criado = await criar(A, {
      nome: 'João Servidor',
      email: 'Joao@Exemplo.com.br',
      telefone: '(54) 99999-0000',
      empresa: 'Mercado Bom Preço',
      observacao: 'Quer orçamento de rede para a filial',
    });
    expect(criado.status).toBe(201);
    expect(Object.keys(criado.corpo).sort()).toEqual(CAMPOS_CONTATO);
    expect(criado.corpo).toMatchObject({
      nome: 'João Servidor',
      email: 'joao@exemplo.com.br', // sempre minúsculo
      telefone: '(54) 99999-0000',
      empresa: 'Mercado Bom Preço',
      ultima_interacao_em: null,
    });
    expect(criado.corpo.criado_em).toMatch(ISO);
    const id = criado.corpo.id;

    const lido = await chamar('GET', `/contatos/${id}`, { token: A.token });
    expect(lido.status).toBe(200);
    expect(lido.corpo).toEqual(criado.corpo);

    // Parcial: só o que foi enviado muda; null limpa um opcional.
    const alterado = await chamar('PATCH', `/contatos/${id}`, {
      token: A.token,
      corpo: { nome: 'João Servidor Silva', telefone: null },
    });
    expect(alterado.status).toBe(200);
    expect(alterado.corpo).toMatchObject({ nome: 'João Servidor Silva', telefone: null, email: 'joao@exemplo.com.br' });
    expect(new Date(alterado.corpo.atualizado_em) >= new Date(criado.corpo.atualizado_em)).toBe(true);

    const lista = await chamar('GET', '/contatos', { token: A.token });
    expect(lista.status).toBe(200);
    expect(lista.corpo.limite).toBe(100);
    expect(lista.corpo.itens.map((c) => c.id)).toContain(id);
    expect(Object.keys(lista.corpo.itens[0]).sort()).toEqual(CAMPOS_CONTATO);

    const excluido = await chamar('DELETE', `/contatos/${id}`, { token: A.token });
    expect(excluido.status).toBe(204);
    expect(excluido.corpo).toBeNull();

    const depois = await chamar('GET', `/contatos/${id}`, { token: A.token });
    expect(depois.status).toBe(404);
    expect(depois.corpo).toEqual(NAO_ENCONTRADO);
    expect((await chamar('DELETE', `/contatos/${id}`, { token: A.token })).status).toBe(404);
  });
});

describe('T-CON-02: só nome é obrigatório', () => {
  it('{nome} -> 201 com os opcionais em null; sem nome -> 400 VALIDACAO', async () => {
    const so = await criar(A, { nome: 'Só Nome' });
    expect(so.status).toBe(201);
    expect(so.corpo).toMatchObject({ email: null, telefone: null, empresa: null, observacao: null });

    const semNome = await criar(A, { email: 'sem-nome@x.com' });
    expect(semNome.status).toBe(400);
    expect(semNome.corpo.codigo).toBe('VALIDACAO');
    expect(semNome.corpo.campos).toContainEqual({ campo: 'nome', erro: 'Campo obrigatório.' });

    const soEspacos = await criar(A, { nome: '   ' });
    expect(soEspacos.status).toBe(400);
  });

  it('PATCH: nome null, corpo vazio ou e-mail inválido -> 400', async () => {
    const { corpo } = await criar(A, { nome: 'Para Validar' });
    for (const invalido of [{ nome: null }, { nome: '' }, {}, { email: 'nao-e-email' }, { observacao: 'x'.repeat(501) }]) {
      const r = await chamar('PATCH', `/contatos/${corpo.id}`, { token: A.token, corpo: invalido });
      expect(r.status, JSON.stringify(invalido)).toBe(400);
      expect(r.corpo.codigo).toBe('VALIDACAO');
    }
  });
});

describe('T-CON-03: e-mail em minúsculas e único dentro do tenant', () => {
  it('mesmo e-mail com outra caixa em A -> 409; o mesmo e-mail em B -> 201', async () => {
    const email = `dup-${randomUUID()}@x.com`;
    expect((await criar(A, { nome: 'Primeiro', email })).status).toBe(201);

    const repetido = await criar(A, { nome: 'Segundo', email: email.toUpperCase() });
    expect(repetido.status).toBe(409);
    expect(repetido.corpo).toEqual({ erro: 'Já existe um contato com esse e-mail.', codigo: 'EMAIL_DUPLICADO' });

    expect((await criar(B, { nome: 'Em B', email })).status).toBe(201);
  });

  it('PATCH para um e-mail já usado no tenant -> 409', async () => {
    const email = `dup-patch-${randomUUID()}@x.com`;
    await criar(A, { nome: 'Dono do e-mail', email });
    const { corpo } = await criar(A, { nome: 'Outro' });
    const r = await chamar('PATCH', `/contatos/${corpo.id}`, { token: A.token, corpo: { email } });
    expect(r.status).toBe(409);
    expect(r.corpo.codigo).toBe('EMAIL_DUPLICADO');
  });

  it('vários contatos sem e-mail convivem no mesmo tenant', async () => {
    expect((await criar(A, { nome: 'Sem e-mail 1' })).status).toBe(201);
    expect((await criar(A, { nome: 'Sem e-mail 2', email: null })).status).toBe(201);
  });
});

describe('T-CON-04: busca por nome, e-mail ou empresa, ordenada, com teto de 100', () => {
  // Tenant próprio, plano equipe: 101 POSTs seguidos cabem no rate limit de 600/min (bloco 5);
  // no individual (60/min) este teste quebraria quando o rate limit entrar.
  let C;
  const marca = `zq${Date.now().toString(36)}`; // termo que só existe neste tenant

  beforeAll(async () => {
    C = await cadastrar({ plano: 'equipe', empresa: 'Tenant Busca' });
    const pedidos = [];
    for (let i = 0; i < 101; i += 1) {
      pedidos.push(criar(C, { nome: `${marca} Contato ${String(i).padStart(3, '0')}` }));
    }
    const respostas = await Promise.all(pedidos);
    expect(respostas.every((r) => r.status === 201)).toBe(true);
    await criar(C, { nome: 'Beatriz', email: `beatriz.${marca}@cliente.com` });
    await criar(C, { nome: 'Alberto', empresa: `Padaria ${marca.toUpperCase()}` });
    await criar(C, { nome: 'Cem por cento', observacao: 'teste de curinga', empresa: 'Loja 100% Nova' });
  }, 60_000);

  it('sem busca: no máximo 100 itens, ordenados por nome', async () => {
    const r = await chamar('GET', '/contatos', { token: C.token });
    expect(r.status).toBe(200);
    expect(r.corpo.itens).toHaveLength(100);
    const nomes = r.corpo.itens.map((c) => c.nome);
    expect(nomes).toEqual([...nomes].sort((x, y) => x.localeCompare(y, 'en')));
  });

  it('acha por nome, e-mail e empresa, sem diferenciar maiúsculas', async () => {
    const r = await chamar('GET', `/contatos?busca=${marca.toUpperCase()}`, { token: C.token });
    expect(r.corpo.itens).toHaveLength(100); // 103 casam; o teto corta em 100
    const porNome = await chamar('GET', `/contatos?busca=${marca}%20Contato%20100`, { token: C.token });
    expect(porNome.corpo.itens.map((c) => c.nome)).toEqual([`${marca} Contato 100`]);
    const porEmail = await chamar('GET', `/contatos?busca=beatriz.${marca}`, { token: C.token });
    expect(porEmail.corpo.itens.map((c) => c.nome)).toEqual(['Beatriz']);
    const porEmpresa = await chamar('GET', `/contatos?busca=padaria%20${marca}`, { token: C.token });
    expect(porEmpresa.corpo.itens.map((c) => c.nome)).toEqual(['Alberto']);
  });

  it('% e _ na busca são texto, não curinga', async () => {
    const porcento = await chamar('GET', `/contatos?busca=${encodeURIComponent('100%')}`, { token: C.token });
    expect(porcento.corpo.itens.map((c) => c.nome)).toEqual(['Cem por cento']);
    const sublinhado = await chamar('GET', '/contatos?busca=_', { token: C.token });
    expect(sublinhado.corpo.itens).toHaveLength(0);
  });

  it('busca com mais de 100 caracteres -> 400', async () => {
    const r = await chamar('GET', `/contatos?busca=${'a'.repeat(101)}`, { token: C.token });
    expect(r.status).toBe(400);
  });
});

describe('isolamento mínimo e ids (a suíte completa é o bloco 3)', () => {
  it('B não lê, não altera e não exclui o contato de A: 404 igual ao de um id inexistente', async () => {
    const { corpo: deA } = await criar(A, { nome: 'Segredo de A', email: `segredo-${randomUUID()}@a.com` });
    const inexistente = await chamar('GET', `/contatos/${randomUUID()}`, { token: B.token });

    const leitura = await chamar('GET', `/contatos/${deA.id}`, { token: B.token });
    const alteracao = await chamar('PATCH', `/contatos/${deA.id}`, { token: B.token, corpo: { nome: 'invadido' } });
    const exclusao = await chamar('DELETE', `/contatos/${deA.id}`, { token: B.token });
    for (const r of [inexistente, leitura, alteracao, exclusao]) {
      expect(r.status).toBe(404);
      expect(r.corpo).toEqual(NAO_ENCONTRADO);
    }

    const intacto = await chamar('GET', `/contatos/${deA.id}`, { token: A.token });
    expect(intacto.corpo).toEqual(deA);
    const listaB = await chamar('GET', '/contatos?busca=Segredo', { token: B.token });
    expect(listaB.corpo.itens.map((c) => c.id)).not.toContain(deA.id);
  });

  it('tenant_id no corpo e na query é descartado', async () => {
    const r = await criar(A, { nome: 'Tentou trocar', tenant_id: B.tenantId });
    expect(r.status).toBe(201);
    expect(r.corpo).not.toHaveProperty('tenant_id');
    const deB = await chamar('GET', `/contatos?tenant_id=${B.tenantId}&busca=Tentou`, { token: A.token });
    expect(deB.corpo.itens.map((c) => c.id)).toEqual([r.corpo.id]); // é de A, e só A o vê
    const vistoPorB = await chamar('GET', `/contatos/${r.corpo.id}`, { token: B.token });
    expect(vistoPorB.status).toBe(404);
  });

  it(':id que não é UUID -> 404 (nunca 500 vindo do Postgres)', async () => {
    for (const metodo of ['GET', 'PATCH', 'DELETE']) {
      const r = await chamar(metodo, '/contatos/nao-e-uuid', {
        token: A.token,
        corpo: metodo === 'PATCH' ? { nome: 'x' } : undefined,
      });
      expect(r.status, metodo).toBe(404);
      expect(r.corpo).toEqual(NAO_ENCONTRADO);
    }
  });
});
