// Estado em memória do simulador + dados iniciais de demonstração (os dois tenants do bloco 3).
// Tudo fictício. Reiniciar o simulador volta a este estado.
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const DIA = 24 * 60 * 60 * 1000;
const diasAtras = (n) => new Date(Date.now() - n * DIA).toISOString();

// Senha com scrypt + sal, mesmo no simulador: não vale a pena ensinar o atalho errado.
export function gerarHash(senha) {
  const sal = randomBytes(16);
  return `${sal.toString('hex')}:${scryptSync(senha, sal, 32).toString('hex')}`;
}
export function conferirSenha(senha, hash) {
  const [salHex, chaveHex] = hash.split(':');
  const chave = scryptSync(senha, Buffer.from(salHex, 'hex'), 32);
  return timingSafeEqual(chave, Buffer.from(chaveHex, 'hex'));
}

export function criarEstado() {
  return {
    tenants: new Map(), // id -> {id, nome, plano, criado_em, cancelado_em}
    usuarios: new Map(), // id -> {id, tenant_id, nome, email, senha_hash, papel, criado_em, email_confirmado_em}
    contatos: new Map(), // id -> {..., tenant_id}
    interacoes: new Map(), // id -> {..., tenant_id}
    importacoes: new Map(), // id -> {..., tenant_id, linhas (privado)}
  };
}

// [nome, empresa, estagio, dias desde o cadastro, dias desde a última interação | null]
const CONTATOS_DEVSOLO = [
  ['João Servidor', 'Mercado Bom Preço', 'proposta', 500, 412],
  ['Ana Ribeiro', 'Clínica Vida', 'proposta', 300, 241],
  ['Carlos Menezes', null, 'lead', 180, null],
  ['Patrícia Lopes', 'Escritório Lopes & Filhos', 'cliente', 400, 20],
  ['Rafael Gomes', 'Auto Peças Gomes', 'lead', 150, 96],
];

const CONTATOS_TECHCONSULT = [
  ['Beatriz Andrade', 'Construtora Andrade', 'cliente', 600, 5],
  ['Diego Fernandes', 'Farmácia Popular Centro', 'proposta', 420, 380],
  ['Eduarda Martins', 'Martins Advocacia', 'lead', 200, 150],
  ['Fábio Costa', 'Costa Transportes', 'cliente', 700, 30],
  ['Gabriela Nunes', 'Escola Pequeno Príncipe', 'lead', 120, null],
  ['Henrique Silva', 'Silva & Silva Contabilidade', 'proposta', 365, 210],
  ['Isabela Rocha', 'Rocha Imóveis', 'perdido', 500, 400],
  ['Jorge Almeida', 'Padaria Pão Quente', 'lead', 95, null],
  ['Karina Duarte', 'Duarte Odontologia', 'cliente', 800, 60],
  ['Leonardo Pires', 'Pires Engenharia', 'proposta', 300, 99],
  ['Mariana Teixeira', 'Hotel Serra Verde', 'lead', 45, 10],
  ['Nicolas Barbosa', 'Barbosa Agro', 'cliente', 900, 365],
  ['Olívia Cardoso', 'Cardoso Eventos', 'lead', 30, null],
  ['Paulo Ribeiro', 'Supermercado Ribeiro', 'proposta', 250, 120],
  ['Quésia Moura', 'Moura Têxtil', 'perdido', 400, 200],
  ['Renato Lima', 'Lima Distribuidora', 'cliente', 1000, 2],
  ['Sabrina Gomes', 'Gomes Pet Shop', 'lead', 75, 70],
  ['Tiago Mendes', 'Mendes Logística', 'proposta', 190, 185],
  ['Úrsula Freitas', 'Freitas Arquitetura', 'lead', 160, null],
  ['Vinícius Araújo', 'Araújo Seguros', 'cliente', 550, 15],
];

function emailDe(nome, dominio) {
  const usuario = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '.');
  return `${usuario}@${dominio}`;
}

function semear(estado, { empresa, plano, nomeUsuario, email, contatos, dominio }) {
  const tenant = { id: randomUUID(), nome: empresa, plano, criado_em: diasAtras(1000), cancelado_em: null };
  estado.tenants.set(tenant.id, tenant);
  const usuario = {
    id: randomUUID(),
    tenant_id: tenant.id,
    nome: nomeUsuario,
    email,
    senha_hash: gerarHash('Demo@2026'),
    papel: 'admin',
    criado_em: tenant.criado_em,
    email_confirmado_em: tenant.criado_em,
  };
  estado.usuarios.set(usuario.id, usuario);

  contatos.forEach(([nome, empresaContato, estagio, diasCadastro, diasInteracao], i) => {
    const contato = {
      id: randomUUID(),
      tenant_id: tenant.id,
      nome,
      email: i % 4 === 3 ? null : emailDe(nome, dominio), // alguns sem e-mail (é opcional)
      telefone: i % 3 === 2 ? null : `(54) 99${String(100 + i)}-${String(1000 + i * 37)}`,
      empresa: empresaContato,
      observacao: i % 2 === 0 ? 'Conheci numa visita técnica; quer revisar a rede.' : null,
      estagio,
      ultima_interacao_em: diasInteracao === null ? null : diasAtras(diasInteracao),
      criado_em: diasAtras(diasCadastro),
      atualizado_em: diasAtras(diasInteracao ?? diasCadastro),
    };
    estado.contatos.set(contato.id, contato);
    if (diasInteracao !== null) {
      const interacao = {
        id: randomUUID(),
        tenant_id: tenant.id,
        contato_id: contato.id,
        usuario_id: usuario.id,
        tipo: ['whatsapp', 'ligacao', 'email', 'reuniao'][i % 4],
        nota: 'Conversamos sobre o próximo passo.',
        ocorrida_em: contato.ultima_interacao_em,
        criado_em: contato.ultima_interacao_em,
      };
      estado.interacoes.set(interacao.id, interacao);
    }
  });
}

export function estadoInicial() {
  const estado = criarEstado();
  semear(estado, {
    empresa: 'DevSolo Sistemas',
    plano: 'individual',
    nomeUsuario: 'Marcelo',
    email: 'marcelo@devsolo.dev',
    contatos: CONTATOS_DEVSOLO,
    dominio: 'exemplo.com.br',
  });
  semear(estado, {
    empresa: 'TechConsult Solutions',
    plano: 'equipe',
    nomeUsuario: 'Gestor TechConsult',
    email: 'gestor@techconsult.com.br',
    contatos: CONTATOS_TECHCONSULT,
    dominio: 'cliente.com.br',
  });
  return estado;
}
