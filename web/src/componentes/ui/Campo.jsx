import { useId, useState } from 'react';
import { Eye, EyeOff, XCircle } from 'lucide-react';

/**
 * Campo de formulário com label visível (placeholder não é label), ajuda e erro ligados por
 * aria-describedby, e aria-invalid quando há erro. O erro aparece logo abaixo do campo.
 */
export default function Campo({
  rotulo,
  erro,
  ajuda,
  obrigatorio = false,
  tipo = 'text',
  className = '',
  multilinha = false,
  ...props
}) {
  const id = useId();
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const idAjuda = ajuda ? `${id}-ajuda` : null;
  const idErro = erro ? `${id}-erro` : null;
  const descritoPor = [idErro, idAjuda].filter(Boolean).join(' ') || undefined;
  const ehSenha = tipo === 'password';
  const Controle = multilinha ? 'textarea' : 'input';

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-texto-secundario">
        {rotulo}
        {/* O "*" é só visual: o atributo required já faz o leitor de tela dizer "obrigatório". */}
        {obrigatorio && <span aria-hidden="true"> *</span>}
      </label>
      <div className="relative">
        <Controle
          id={id}
          type={multilinha ? undefined : ehSenha && senhaVisivel ? 'text' : tipo}
          className={`campo ${ehSenha ? 'pr-14' : ''} ${multilinha ? 'min-h-24 resize-y' : ''}`}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritoPor}
          required={obrigatorio || undefined}
          {...props}
        />
        {ehSenha && (
          <button
            type="button"
            className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-campo text-texto-secundario hover:text-texto"
            aria-label={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={senhaVisivel}
            onClick={() => setSenhaVisivel((v) => !v)}
          >
            {senhaVisivel ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
          </button>
        )}
      </div>
      {erro && (
        <p id={idErro} className="flex items-start gap-1.5 text-sm text-erro">
          <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {erro}
        </p>
      )}
      {ajuda && (
        <p id={idAjuda} className="text-sm text-texto-mudo">
          {ajuda}
        </p>
      )}
    </div>
  );
}
