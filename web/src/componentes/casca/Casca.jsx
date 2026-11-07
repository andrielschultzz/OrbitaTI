import { NavLink, Link, Outlet } from 'react-router';
import { Plus, Upload, UserRound, UsersRound } from 'lucide-react';
import { MarcaHorizontal } from '../marca/Marca.jsx';

// Casca da área logada.
// Celular (< 1024 px): barra inferior (Contatos, Importar, Conta) + botão flutuante "+" ao alcance
//   do polegar, respeitando a safe-area (iPhone com barra de gestos).
// Desktop (>= 1024 px): barra lateral.
const ITENS = [
  { para: '/contatos', rotulo: 'Contatos', Icone: UsersRound },
  { para: '/importar', rotulo: 'Importar', Icone: Upload },
  { para: '/conta', rotulo: 'Conta', Icone: UserRound },
];

const NOVO_CONTATO = '/contatos?novo=1';

export default function Casca() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-campo bg-superficie-elevada px-4 py-3 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>

      {/* Barra lateral (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-borda-sutil bg-superficie/60 px-4 py-6 lg:flex">
        <Link to="/contatos" className="px-2" aria-label="OrbitaTI, ir para Contatos">
          <MarcaHorizontal tamanho="sm" />
        </Link>
        <Link to={NOVO_CONTATO} className="botao botao-primario">
          <Plus aria-hidden="true" className="size-5" /> Novo contato
        </Link>
        <nav aria-label="Principal">
          <ul className="flex flex-col gap-1">
            {ITENS.map(({ para, rotulo, Icone }) => (
              <li key={para}>
                <NavLink
                  to={para}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center gap-3 rounded-campo px-3 font-medium transition-colors ${
                      isActive
                        ? 'border-l-[3px] border-primario bg-superficie-ativa pl-[9px] text-primario shadow-[var(--brilho-ativo)]'
                        : 'text-texto-secundario hover:bg-superficie-ativa hover:text-texto'
                    }`
                  }
                >
                  <Icone aria-hidden="true" className="size-5" />
                  {rotulo}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Topo (celular) */}
      <header className="flex h-14 items-center px-4 lg:hidden">
        <Link to="/contatos" aria-label="OrbitaTI, ir para Contatos">
          <MarcaHorizontal tamanho="sm" />
        </Link>
      </header>

      <main
        id="conteudo"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl px-4 pt-2 pb-[calc(6.5rem+env(safe-area-inset-bottom))] outline-none md:px-6 lg:px-10 lg:py-8"
      >
        <Outlet />
      </main>

      {/* Botão flutuante "+" (celular) */}
      <Link
        to={NOVO_CONTATO}
        aria-label="Novo contato"
        className="botao botao-primario fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 size-14 rounded-full p-0 lg:hidden"
      >
        <Plus aria-hidden="true" className="size-7" />
      </Link>

      {/* Barra inferior (celular) */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-borda-sutil bg-superficie pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-3">
          {ITENS.map(({ para, rotulo, Icone }) => (
            <li key={para}>
              <NavLink
                to={para}
                className={({ isActive }) =>
                  `flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors ${
                    isActive ? 'text-primario' : 'text-texto-mudo hover:text-texto'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${
                        isActive ? 'bg-superficie-ativa shadow-[var(--brilho-ativo)]' : ''
                      }`}
                    >
                      <Icone aria-hidden="true" className="size-5" />
                    </span>
                    {rotulo}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
