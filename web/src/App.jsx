import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { LogOut } from 'lucide-react';
import { ProvedorToasts } from './componentes/Toasts.jsx';
import { ProvedorSessao, RotaProtegida, useSessao } from './sessao/ProvedorSessao.jsx';
import Casca from './componentes/casca/Casca.jsx';
import AlternadorTema from './componentes/AlternadorTema.jsx';
import EmConstrucao from './paginas/EmConstrucao.jsx';

// Code splitting por rota: cada tela vira um arquivo JS separado, baixado só quando é aberta.
const Entrar = lazy(() => import('./paginas/publico/Entrar.jsx'));

// /marca é a amostra visual do design system: só existe em desenvolvimento.
// Em produção import.meta.env.DEV vira false e o Vite remove a página do bundle.
const PaginaMarca = import.meta.env.DEV ? lazy(() => import('./paginas/Marca.jsx')) : null;

function ContaProvisoria() {
  const { sessao, sair } = useSessao();
  return (
    <EmConstrucao titulo="Conta">
      <p className="text-texto-secundario">
        Plano atual: <strong className="text-texto">{sessao.plano === 'equipe' ? 'Equipe' : 'Individual'}</strong>
      </p>
      <div className="flex flex-wrap gap-3">
        <AlternadorTema />
        <button type="button" className="botao botao-secundario" onClick={sair}>
          <LogOut aria-hidden="true" className="size-5" /> Sair
        </button>
      </div>
    </EmConstrucao>
  );
}

function NaoEncontrada() {
  return (
    <main id="conteudo" className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-2xl">Página não encontrada</h1>
        <a href="/contatos" className="botao botao-primario">
          Ir para Contatos
        </a>
      </div>
    </main>
  );
}

// Reserva a altura da tela enquanto o arquivo da rota chega (o layout não pula).
const Carregando = () => <div className="min-h-dvh" aria-busy="true" />;

export default function App() {
  return (
    <ProvedorToasts>
      <ProvedorSessao>
        <Suspense fallback={<Carregando />}>
          <Routes>
            <Route path="/" element={<Navigate to="/contatos" replace />} />
            <Route path="/entrar" element={<Entrar />} />
            <Route path="/cadastro" element={<EmConstrucao titulo="Criar conta" />} />
            <Route path="/confirmar-email" element={<EmConstrucao titulo="Confirmar e-mail" />} />

            <Route
              element={
                <RotaProtegida>
                  <Casca />
                </RotaProtegida>
              }
            >
              <Route path="/contatos" element={<EmConstrucao titulo="Contatos" />} />
              <Route path="/contatos/:id" element={<EmConstrucao titulo="Contato" />} />
              <Route path="/importar" element={<EmConstrucao titulo="Importar contatos" />} />
              <Route path="/importar/:id" element={<EmConstrucao titulo="Importação" />} />
              <Route path="/conta" element={<ContaProvisoria />} />
            </Route>

            {PaginaMarca && <Route path="/marca" element={<PaginaMarca />} />}
            <Route path="*" element={<NaoEncontrada />} />
          </Routes>
        </Suspense>
      </ProvedorSessao>
    </ProvedorToasts>
  );
}
