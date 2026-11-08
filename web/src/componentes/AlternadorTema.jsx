import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { escolherTema, temaEfetivo } from '../tema.js';

/** Alterna claro/escuro. A escolha manual vence a preferência do sistema. */
export default function AlternadorTema({ className = '' }) {
  const [tema, setTema] = useState(temaEfetivo);
  const proximo = tema === 'escuro' ? 'claro' : 'escuro';
  return (
    <button
      type="button"
      className={`botao botao-secundario ${className}`}
      aria-label={`Usar tema ${proximo}`}
      onClick={() => {
        escolherTema(proximo);
        setTema(proximo);
      }}
    >
      {tema === 'escuro' ? <Sun aria-hidden="true" className="size-5" /> : <Moon aria-hidden="true" className="size-5" />}
      <span>Tema {proximo}</span>
    </button>
  );
}
