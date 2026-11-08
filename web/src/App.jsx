import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { ProvedorToasts } from './componentes/Toasts.jsx';
import { ProvedorSessao, RotaProtegida } from './sessao/ProvedorSessao.jsx';
import Casca from './componentes/casca/Casca.jsx';

// Code splitting por rota: cada tela vira um arquivo JS separado, baixado só quando é aberta.
const Entrar = lazy(() => import('./paginas/publico/Entrar.jsx'));
const Cadastro = lazy(() => import('./paginas/publico/Cadastro.jsx'));
const ConfirmarEmail = lazy(() => import('./paginas/publico/ConfirmarEmail.jsx'));
const Contatos = lazy(() => import('./paginas/Contatos.jsx'));
const Contato = lazy(() => import('./paginas/Contato.jsx'));
const Importar = lazy(() => import('./paginas/Importar.jsx'));
const Importacao = lazy(() => import('./paginas/Importacao.jsx'));
const Conta = lazy(() => import('./paginas/Conta.jsx'));

// /marca é a amostra visual do design system: só existe em desenvolvimento.
// Em produção import.meta.env.DEV vira false e o Vite remove a página do bundle.
const PaginaMarca = import.meta.env.DEV ? lazy(() => import('./paginas/Marca.jsx')) : null;

function NaoEncontrada() {
  return (
    <main id="conteudo" className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-2xl">Página não encontrada</h1>
        <Link to="/contatos" className="botao botao-primario">
          Ir para Contatos
        </Link>
      </div>
    </main>
  );
}

// Reserva a altura enquanto o arquivo da rota chega (o layout não pula).
const Carregando = () => <div className="min-h-[60dvh]" aria-busy="true" />;

export default function App() {
  return (
    <ProvedorToasts>
      <ProvedorSessao>
        <Suspense fallback={<Carregando />}>
          <Routes>
            <Route path="/" element={<Navigate to="/contatos" replace />} />
            <Route path="/entrar" element={<Entrar />} />
            <Route path="/cadastro" element={<Cadastro />} />
            <Route path="/confirmar-email" element={<ConfirmarEmail />} />

            <Route
              element={
                <RotaProtegida>
                  <Casca />
                </RotaProtegida>
              }
            >
              <Route path="/contatos" element={<Contatos />} />
              <Route path="/contatos/:id" element={<Contato />} />
              <Route path="/importar" element={<Importar />} />
              <Route path="/importar/:id" element={<Importacao />} />
              <Route path="/conta" element={<Conta />} />
            </Route>

            {PaginaMarca && <Route path="/marca" element={<PaginaMarca />} />}
            <Route path="*" element={<NaoEncontrada />} />
          </Routes>
        </Suspense>
      </ProvedorSessao>
    </ProvedorToasts>
  );
}
