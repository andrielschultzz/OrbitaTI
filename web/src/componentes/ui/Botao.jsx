import { Loader2 } from 'lucide-react';

/**
 * Botão com estado de carregamento: enquanto `carregando`, fica desabilitado (não aceita envio
 * duplo), anuncia aria-busy e troca o ícone por um indicador. A largura não muda (sem pulo).
 */
export default function Botao({
  variante = 'primario',
  carregando = false,
  textoCarregando,
  icone: Icone,
  children,
  className = '',
  disabled,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={`botao botao-${variante} ${className}`}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...props}
    >
      {carregando ? (
        <Loader2 aria-hidden="true" className="size-5 animate-spin" />
      ) : (
        Icone && <Icone aria-hidden="true" className="size-5" />
      )}
      <span>{carregando && textoCarregando ? textoCarregando : children}</span>
    </button>
  );
}
