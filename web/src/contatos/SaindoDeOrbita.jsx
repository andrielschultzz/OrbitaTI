import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Orbit, RotateCcw, Sparkles } from 'lucide-react';
import { api } from '../api/cliente.js';
import MapaOrbita from '../orbita/MapaOrbita.jsx';

/**
 * "Saindo de órbita": os contatos mais frios (GET /contatos/esfriando?limite=5).
 * A LISTA é o conteúdo principal e acessível; o mapa complementa.
 */
export default function SaindoDeOrbita() {
  const [estado, setEstado] = useState({ carregando: true, dados: null, erro: false });
  const navegar = useNavigate();

  const carregar = useCallback(async (sinal) => {
    setEstado({ carregando: true, dados: null, erro: false });
    try {
      const dados = await api('/contatos/esfriando', { consulta: { limite: 5 }, sinal });
      setEstado({ carregando: false, dados, erro: false });
    } catch (e) {
      if (e.name === 'AbortError' || e.codigo === 'NAO_AUTENTICADO') return;
      setEstado({ carregando: false, dados: null, erro: true });
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    carregar(c.signal);
    return () => c.abort();
  }, [carregar]);

  const { carregando, dados, erro } = estado;

  return (
    <section aria-labelledby="titulo-orbita" className="cartao flex flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <Orbit aria-hidden="true" className="size-5 text-aviso" />
        <h2 id="titulo-orbita" className="text-lg">
          Saindo de órbita
        </h2>
      </div>

      {carregando && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]" aria-busy="true">
          <div className="mx-auto aspect-square w-full max-w-[220px] animate-pulse rounded-full bg-superficie-ativa md:max-w-[280px]" />
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-campo bg-superficie-ativa" />
            ))}
          </div>
        </div>
      )}

      {erro && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-texto-secundario">Não conseguimos carregar quem está esfriando.</p>
          <button type="button" className="botao botao-secundario" onClick={() => carregar()}>
            <RotateCcw aria-hidden="true" className="size-5" /> Tentar de novo
          </button>
        </div>
      )}

      {dados && dados.itens.length === 0 && (
        <p className="flex items-start gap-2 text-texto-secundario">
          <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sucesso" />
          Ninguém esfriando: todos os contatos tiveram conversa (ou foram cadastrados) nos últimos {dados.dias} dias.
        </p>
      )}

      {dados && dados.itens.length > 0 && (
        <div className="grid items-center gap-4 md:grid-cols-[minmax(0,280px)_1fr] md:gap-6">
          <MapaOrbita
            itens={dados.itens}
            aoAbrir={(id) => navegar(`/contatos/${id}`)}
            className="mx-auto max-w-[220px] md:max-w-[280px]"
          />
          <ul className="flex flex-col divide-y divide-borda-sutil">
            {dados.itens.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/contatos/${c.id}`}
                  className="flex min-h-14 flex-col justify-center rounded-campo px-2 py-2 hover:bg-superficie-ativa"
                >
                  <span className="font-semibold">{c.nome}</span>
                  <span className="text-sm text-texto-mudo">
                    {c.empresa ? `${c.empresa} · ` : ''}
                    {c.nunca_contatado
                      ? `cadastrado há ${c.dias_sem_interacao} dias, nunca contatado`
                      : `há ${c.dias_sem_interacao} dias sem contato`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
