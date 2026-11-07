// Amostra visual do design system (só em desenvolvimento: ver App.jsx).
// Serve para revisar a direção visual nos dois temas antes de construir as telas.
import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  MessageCircle,
  Orbit,
  Phone,
  Plus,
  XCircle,
} from 'lucide-react';
import { IconeApp, Logotipo, MarcaHorizontal, Simbolo } from '../componentes/marca/Marca.jsx';
import AlternadorTema from '../componentes/AlternadorTema.jsx';
import MapaOrbita from '../orbita/MapaOrbita.jsx';

const CORES = [
  ['fundo', 'página'],
  ['superficie', 'cartões, folhas'],
  ['superficie-elevada', 'modal, menu'],
  ['texto', 'corpo'],
  ['texto-secundario', 'rótulos'],
  ['texto-mudo', 'metadados'],
  ['borda-sutil', 'divisórias (decoração)'],
  ['borda-campo', 'contorno de campo (3:1)'],
  ['primario', 'links, destaque'],
  ['ciano', 'foco, glow'],
  ['teal', 'início do anel'],
  ['azul', 'fim do gradiente'],
  ['indigo', 'só decoração'],
  ['sucesso', 'estado'],
  ['aviso', 'estado'],
  ['erro', 'estado'],
];

// Dados fictícios só para a amostra (nenhum dado real).
const FRIOS = [
  { id: 'a1', nome: 'João Servidor', empresa: 'Mercado Bom Preço', dias_sem_interacao: 412, nunca_contatado: false },
  { id: 'a2', nome: 'Ana Ribeiro', empresa: 'Clínica Vida', dias_sem_interacao: 241, nunca_contatado: false },
  { id: 'a3', nome: 'Carlos Menezes', empresa: null, dias_sem_interacao: 180, nunca_contatado: true },
  { id: 'a4', nome: 'Patrícia Lopes', empresa: 'Escritório Lopes & Filhos', dias_sem_interacao: 131, nunca_contatado: false },
  { id: 'a5', nome: 'Rafael Gomes', empresa: 'Auto Peças Gomes', dias_sem_interacao: 96, nunca_contatado: false },
];

const ESTAGIOS = [
  ['lead', 'Lead'],
  ['proposta', 'Proposta'],
  ['cliente', 'Cliente'],
  ['perdido', 'Perdido'],
];

function Secao({ titulo, children }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl text-texto">{titulo}</h2>
      {children}
    </section>
  );
}

function Rotulo({ children }) {
  return <p className="text-sm text-texto-mudo">{children}</p>;
}

export default function PaginaMarca() {
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [estagio, setEstagio] = useState('proposta');
  const [aberto, setAberto] = useState(null);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-6 pb-24 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <MarcaHorizontal />
        <AlternadorTema />
      </header>

      <div>
        <h1 className="text-3xl md:text-4xl">Design system</h1>
        <p className="mt-2 max-w-prose text-texto-secundario">
          Amostra visual do Portal. A marca manda: cores, fontes e brilho saem da logo. Esta página só existe em
          desenvolvimento.
        </p>
      </div>

      <Secao titulo="Logo">
        <div className="cartao flex flex-col items-center gap-2 px-4 py-10">
          <Simbolo tamanho="lg" className="!size-40 md:!size-52" rotulo="Símbolo do OrbitaTI" />
          <Logotipo tamanho="lg" className="md:text-6xl" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="cartao col-span-2 flex flex-col items-center justify-center gap-3 p-4 md:col-span-1">
            <MarcaHorizontal tamanho="sm" />
            <Rotulo>Horizontal</Rotulo>
          </div>
          <div className="cartao flex flex-col items-center gap-3 p-4">
            <Simbolo tamanho="lg" rotulo="Só o símbolo" />
            <Rotulo>Só o símbolo</Rotulo>
          </div>
          <div className="cartao flex flex-col items-center gap-3 p-4">
            <IconeApp />
            <Rotulo>Ícone de app</Rotulo>
          </div>
          <div className="cartao col-span-2 flex flex-col items-center justify-center gap-3 p-4 md:col-span-1">
            <div className="flex items-end gap-3">
              <img src="/favicon.svg" alt="" width="16" height="16" />
              <img src="/favicon.svg" alt="" width="32" height="32" />
              <img src="/favicon.svg" alt="" width="48" height="48" />
            </div>
            <Rotulo>Favicon 16 / 32 / 48</Rotulo>
          </div>
        </div>
      </Secao>

      <Secao titulo="Cores">
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {CORES.map(([token, uso]) => (
            <li key={token} className="cartao flex items-center gap-3 p-3">
              <span
                aria-hidden="true"
                className="size-10 shrink-0 rounded-campo border border-borda-sutil"
                style={{ background: `var(--${token})` }}
              />
              <span className="min-w-0">
                <span className="block truncate font-mono text-sm text-texto">{token}</span>
                <span className="block truncate text-sm text-texto-mudo">{uso}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <div className="h-3 rounded-full" style={{ background: 'var(--anel-gradiente)' }} aria-hidden="true" />
          <Rotulo>Gradiente do anel (teal → ciano → azul → índigo): só decoração, nunca atrás de texto.</Rotulo>
        </div>
      </Secao>

      <Secao titulo="Tipografia">
        <div className="cartao flex flex-col gap-3 p-5">
          <p className="font-titulo text-3xl font-extrabold">Montserrat 800 · Saindo de órbita</p>
          <p className="font-titulo text-xl font-bold">Montserrat 700 · Contatos</p>
          <p className="text-base">
            Inter 400 · 16 px. Corpo do texto: cadastre um contato em menos de 30 segundos, só com o nome.
          </p>
          <p className="text-base font-semibold">Inter 600 · Rótulos de botão e destaque</p>
          <p className="text-sm text-texto-secundario">Inter 14 px · texto secundário</p>
          <p className="text-sm text-texto-mudo">Inter 14 px · metadado: atualizado há 3 dias</p>
        </div>
      </Secao>

      <Secao titulo="Botões">
        <div className="cartao flex flex-col gap-5 p-5">
          <div className="flex flex-wrap gap-3">
            <button type="button" className="botao botao-primario">
              <Plus aria-hidden="true" className="size-5" /> Novo contato
            </button>
            <button type="button" className="botao botao-secundario">Cancelar</button>
            <button type="button" className="botao botao-fantasma">Mais campos</button>
            <button type="button" className="botao botao-perigo">Excluir contato</button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="botao botao-primario" style={{ outline: '2px solid var(--foco)', outlineOffset: 2 }}>
              Com foco
            </button>
            <button type="button" className="botao botao-primario" disabled>
              Desabilitado
            </button>
            <button type="button" className="botao botao-primario" disabled aria-busy="true">
              <Loader2 aria-hidden="true" className="size-5 animate-spin" /> Salvando…
            </button>
          </div>
          <Rotulo>
            Primário no escuro: gradiente ciano → azul com texto escuro (4,9:1 no pior ponto; branco daria 4,0:1 e reprova). No claro: azul #1D5FC0 com texto branco (6,1:1).
          </Rotulo>
        </div>
      </Secao>

      <Secao titulo="Campos">
        <form className="cartao grid gap-5 p-5 md:grid-cols-2" onSubmit={(e) => e.preventDefault()} noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="m-nome" className="text-sm font-medium text-texto-secundario">
              Nome <span aria-hidden="true">*</span>
            </label>
            <input id="m-nome" className="campo" autoComplete="off" defaultValue="Marcelo" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="m-tel" className="text-sm font-medium text-texto-secundario">
              Telefone
            </label>
            <input id="m-tel" className="campo" inputMode="tel" placeholder="(54) 99999-0000" autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="m-email" className="text-sm font-medium text-texto-secundario">
              E-mail
            </label>
            <input
              id="m-email"
              className="campo"
              type="email"
              defaultValue="joao@exemplo.com.br"
              aria-invalid="true"
              aria-describedby="m-email-erro"
              autoComplete="off"
            />
            <p id="m-email-erro" className="flex items-center gap-1.5 text-sm text-erro">
              <XCircle aria-hidden="true" className="size-4 shrink-0" /> Já existe um contato com esse e-mail.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="m-senha" className="text-sm font-medium text-texto-secundario">
              Senha
            </label>
            <div className="relative">
              <input
                id="m-senha"
                className="campo pr-14"
                type={senhaVisivel ? 'text' : 'password'}
                defaultValue="Demo@2026"
                aria-describedby="m-senha-ajuda"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-campo text-texto-secundario hover:text-texto"
                aria-label={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={senhaVisivel}
                onClick={() => setSenhaVisivel((v) => !v)}
              >
                {senhaVisivel ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
              </button>
            </div>
            <p id="m-senha-ajuda" className="text-sm text-texto-mudo">
              Pelo menos 8 caracteres.
            </p>
          </div>
          <fieldset className="flex min-w-0 flex-col gap-1.5 md:col-span-2">
            <legend className="mb-1.5 text-sm font-medium text-texto-secundario">Estágio</legend>
            <div className="grid grid-cols-4 gap-1 rounded-campo border border-borda-campo p-1">
              {ESTAGIOS.map(([valor, rotulo]) => (
                <label
                  key={valor}
                  className={`grid min-h-11 place-items-center rounded-[calc(var(--raio-campo)-4px)] px-2 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-foco ${
                    estagio === valor ? 'botao-primario' : 'text-texto-secundario hover:text-texto'
                  }`}
                >
                  <input
                    type="radio"
                    name="m-estagio"
                    value={valor}
                    checked={estagio === valor}
                    onChange={() => setEstagio(valor)}
                    className="sr-only"
                  />
                  {rotulo}
                </label>
              ))}
            </div>
          </fieldset>
        </form>
      </Secao>

      <Secao titulo="Cartão de contato">
        <div className="grid gap-4 md:grid-cols-2">
          <article className="cartao flex flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-lg">João Servidor</h3>
                <p className="truncate text-sm text-texto-secundario">Mercado Bom Preço</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-borda-sutil px-2.5 py-1 text-xs font-semibold text-aviso">
                <Orbit aria-hidden="true" className="size-3.5" /> Saindo de órbita
              </span>
            </div>
            <p className="text-sm text-texto-mudo">Há 412 dias sem contato · Proposta</p>
            <div className="flex gap-2">
              <a href="tel:+5554999990000" className="botao botao-secundario min-h-14 flex-1 flex-col gap-0.5 px-2 py-1.5 text-sm" aria-label="Ligar para João Servidor">
                <Phone aria-hidden="true" className="size-5" /> <span>Ligar</span>
              </a>
              <a
                href="https://wa.me/5554999990000"
                className="botao botao-secundario min-h-14 flex-1 flex-col gap-0.5 px-2 py-1.5 text-sm"
                aria-label="WhatsApp de João Servidor"
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle aria-hidden="true" className="size-5" /> <span>WhatsApp</span>
              </a>
              <a href="mailto:joao@exemplo.com.br" className="botao botao-secundario min-h-14 flex-1 flex-col gap-0.5 px-2 py-1.5 text-sm" aria-label="E-mail para João Servidor">
                <Mail aria-hidden="true" className="size-5" /> <span>E-mail</span>
              </a>
            </div>
          </article>
          <div className="flex flex-col gap-3">
            <div role="status" className="cartao flex items-start gap-3 bg-superficie-elevada p-4 shadow-elevada">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-sucesso" />
              <p>Contato salvo.</p>
            </div>
            <div role="alert" className="cartao flex items-start gap-3 bg-superficie-elevada p-4 shadow-elevada">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-erro" />
              <div>
                <p>Não conseguimos falar com o servidor. Tente de novo.</p>
                <p className="mt-1 font-mono text-sm text-texto-mudo">código: 7f3a9c2e-41b0</p>
              </div>
            </div>
            <Rotulo>Toasts: ícone + texto + cor. Ficam em região aria-live.</Rotulo>
          </div>
        </div>
      </Secao>

      <Secao titulo="Saindo de órbita">
        <div className="cartao grid items-center gap-6 p-5 md:grid-cols-[320px_1fr]">
          <MapaOrbita itens={FRIOS} aoAbrir={setAberto} className="mx-auto" />
          <ul className="flex flex-col divide-y divide-borda-sutil">
            {FRIOS.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setAberto(c.id)}
                  className={`flex min-h-14 w-full flex-col items-start justify-center rounded-campo px-3 py-2 text-left hover:bg-superficie-elevada ${
                    aberto === c.id ? 'bg-superficie-elevada' : ''
                  }`}
                >
                  <span className="font-semibold">{c.nome}</span>
                  <span className="text-sm text-texto-mudo">
                    {c.empresa ? `${c.empresa} · ` : ''}
                    {c.nunca_contatado
                      ? `cadastrado há ${c.dias_sem_interacao} dias, nunca contatado`
                      : `há ${c.dias_sem_interacao} dias sem contato`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <Rotulo>
          A lista é o conteúdo acessível; o mapa complementa (role="img" com descrição). 90 dias no anel interno, 1 ano
          ou mais no externo.
        </Rotulo>
      </Secao>
    </div>
  );
}
