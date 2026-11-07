import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router';
import { MarcaHorizontal } from './componentes/marca/Marca.jsx';

// /marca é a amostra visual do design system: só existe em desenvolvimento.
// Em produção o import.meta.env.DEV vira false e o Vite remove a página do bundle.
const PaginaMarca = import.meta.env.DEV ? lazy(() => import('./paginas/Marca.jsx')) : null;

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        {PaginaMarca && <Route path="/marca" element={<PaginaMarca />} />}
        <Route
          path="*"
          element={
            <main className="grid min-h-dvh place-items-center p-6">
              <div className="flex flex-col items-center gap-4 text-center">
                <MarcaHorizontal tamanho="lg" />
                <p className="text-texto-secundario">Portal em construção (bloco 13, Fase 1).</p>
              </div>
            </main>
          }
        />
      </Routes>
    </Suspense>
  );
}
