import { Link } from 'react-router';
import { MarcaHorizontal } from '../../componentes/marca/Marca.jsx';

/** Moldura das telas sem login (entrar, criar conta, confirmar e-mail). */
export default function LayoutPublico({ titulo, subtitulo, children, largura = 'max-w-md' }) {
  return (
    <main id="conteudo" className="flex min-h-dvh flex-col items-center px-4 py-8 md:justify-center md:py-12">
      <div className={`flex w-full ${largura} flex-col gap-6`}>
        <Link to="/" className="self-center" aria-label="OrbitaTI, página inicial">
          <MarcaHorizontal tamanho="md" />
        </Link>
        <div className="cartao flex flex-col gap-6 p-5 md:p-8">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl">{titulo}</h1>
            {subtitulo && <p className="text-texto-secundario">{subtitulo}</p>}
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
