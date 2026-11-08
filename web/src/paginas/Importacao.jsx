import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CheckCircle2, Hourglass, Loader2, SearchX, Upload, UsersRound, XCircle } from 'lucide-react';
import { api } from '../api/cliente.js';
import { mensagemDeErro } from '../api/mensagens.js';

const INTERVALO_MS = 2000;
const TERMINAIS = ['concluida', 'falhou'];

/**
 * Consulta GET /importacoes/:id a cada 2 s até concluir ou falhar.
 * - Para ao sair da tela (desmontar).
 * - Pausa com a aba oculta (visibilitychange) e retoma ao voltar.
 * - Respeita o Retry-After de um 429.
 * Por quê: no plano Individual o limite é 60 req/min e só este polling já gasta 30.
 */
function useProgresso(id) {
  const [estado, setEstado] = useState({ dados: null, erro: null });
  const timer = useRef(null);

  useEffect(() => {
    let ativo = true;
    let terminou = false;
    let controle = null;

    async function consultar() {
      clearTimeout(timer.current);
      if (!ativo || terminou || document.hidden) return;
      controle = new AbortController();
      let espera = INTERVALO_MS;
      try {
        const dados = await api(`/importacoes/${id}`, { sinal: controle.signal });
        if (!ativo) return;
        setEstado({ dados, erro: null });
        if (TERMINAIS.includes(dados.status)) terminou = true;
      } catch (e) {
        if (!ativo || e.name === 'AbortError' || e.codigo === 'NAO_AUTENTICADO') return;
        if (e.codigo === 'NAO_ENCONTRADO') {
          terminou = true;
          setEstado({ dados: null, erro: e });
          return;
        }
        if (e.codigo === 'LIMITE_REQUISICOES' && e.retryAfter) espera = e.retryAfter * 1000;
        // Erro passageiro (rede, 429, 5xx): mantém o último progresso e tenta de novo.
      }
      if (ativo && !terminou) timer.current = setTimeout(consultar, espera);
    }

    const aoMudarVisibilidade = () => {
      if (!document.hidden) consultar();
      else clearTimeout(timer.current);
    };

    consultar();
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => {
      ativo = false;
      clearTimeout(timer.current);
      controle?.abort();
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    };
  }, [id]);

  return estado;
}

function Barra({ valor, maximo }) {
  const pct = maximo ? Math.round((valor / maximo) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-label="Progresso da importação"
        aria-valuemin={0}
        aria-valuemax={maximo}
        aria-valuenow={valor}
        aria-valuetext={`${valor} de ${maximo} lotes`}
        className="h-3 overflow-hidden rounded-full bg-superficie-ativa"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: 'var(--primario-fundo)' }}
        />
      </div>
      <p className="text-sm text-texto-mudo">
        {valor} de {maximo} lotes · {pct}%
      </p>
    </div>
  );
}

export default function Importacao() {
  const { id } = useParams();
  const { dados, erro } = useProgresso(id);

  if (erro?.codigo === 'NAO_ENCONTRADO') {
    return (
      <div className="cartao flex flex-col items-center gap-3 px-5 py-10 text-center">
        <SearchX aria-hidden="true" className="size-8 text-texto-mudo" />
        <h1 className="text-xl">Não encontramos essa importação.</h1>
        <Link to="/importar" className="botao botao-primario">
          Importar um arquivo
        </Link>
      </div>
    );
  }

  const importados = dados && dados.linhas_invalidas !== null ? dados.total_linhas - dados.linhas_invalidas : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl md:text-3xl">Importação</h1>

      <section className="cartao flex flex-col gap-5 p-5 md:p-6" aria-labelledby="titulo-status">
        {/* Região viva: o leitor de tela anuncia cada mudança de status sem mover o foco. */}
        <div aria-live="polite" className="flex flex-col gap-5">
          {!dados && (
            <p id="titulo-status" className="flex items-center gap-3">
              <Loader2 aria-hidden="true" className="size-5 animate-spin text-primario" /> Consultando…
            </p>
          )}

          {dados?.status === 'na_fila' && (
            <>
              <h2 id="titulo-status" className="flex items-center gap-3 text-lg">
                <Hourglass aria-hidden="true" className="size-5 text-aviso" /> Na fila…
              </h2>
              {/* total_lotes ainda é null: indicador indeterminado */}
              <div role="progressbar" aria-label="Aguardando na fila" className="relative h-3 overflow-hidden rounded-full bg-superficie-ativa">
                <div className="barra-indeterminada absolute inset-y-0 w-1/3 rounded-full" />
              </div>
              <p className="text-sm text-texto-mudo">{dados.total_linhas} linhas recebidas. O processamento começa em instantes.</p>
            </>
          )}

          {dados?.status === 'processando' && (
            <>
              <h2 id="titulo-status" className="flex items-center gap-3 text-lg">
                <Loader2 aria-hidden="true" className="size-5 animate-spin text-primario" /> Importando…
              </h2>
              <Barra valor={dados.lotes_aplicados} maximo={dados.total_lotes} />
            </>
          )}

          {dados?.status === 'concluida' && (
            <>
              <h2 id="titulo-status" className="flex items-center gap-3 text-lg">
                <CheckCircle2 aria-hidden="true" className="size-6 text-sucesso" /> Importação concluída
              </h2>
              <p className="text-lg">
                <strong>{importados}</strong> {importados === 1 ? 'contato importado' : 'contatos importados'},{' '}
                <strong>{dados.linhas_invalidas}</strong> {dados.linhas_invalidas === 1 ? 'linha com erro' : 'linhas com erro'}
              </p>
              {dados.linhas_invalidas > 0 && (
                <p className="text-sm text-texto-mudo">
                  Linhas com erro não têm nome ou têm e-mail ausente ou inválido. Corrija na planilha e importe de novo:
                  quem já entrou é atualizado, não duplicado.
                </p>
              )}
            </>
          )}

          {dados?.status === 'falhou' && (
            <>
              <h2 id="titulo-status" className="flex items-center gap-3 text-lg">
                <XCircle aria-hidden="true" className="size-6 text-erro" /> A importação falhou
              </h2>
              <p className="text-texto-secundario">
                Não conseguimos terminar de processar o arquivo. Os contatos que já tinham entrado continuam salvos. Tente
                importar de novo.
              </p>
            </>
          )}
        </div>

        {erro && erro.codigo !== 'NAO_ENCONTRADO' && (
          <p className="text-sm text-texto-mudo">{mensagemDeErro(erro)} Tentando de novo…</p>
        )}

        {dados && TERMINAIS.includes(dados.status) && (
          <div className="flex flex-col gap-3 md:flex-row">
            <Link to="/contatos" className="botao botao-primario">
              <UsersRound aria-hidden="true" className="size-5" /> Ver contatos
            </Link>
            <Link to="/importar" className="botao botao-secundario">
              <Upload aria-hidden="true" className="size-5" /> Importar outro arquivo
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
