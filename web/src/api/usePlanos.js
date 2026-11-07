import { useCallback, useEffect, useState } from 'react';
import { api } from './cliente.js';

// GET /planos é pública e igual para todo mundo: busca uma vez por carregamento da página.
// Nenhum número de plano fica no Portal: tudo vem daqui (o planos.js da API é a única fonte).
let cache = null;

export function usePlanos() {
  const [estado, setEstado] = useState(() => (cache ? { itens: cache, erro: null } : { itens: null, erro: null }));

  const carregar = useCallback(async () => {
    setEstado({ itens: null, erro: null });
    try {
      const { itens } = await api('/planos', { autenticar: false });
      cache = itens;
      setEstado({ itens, erro: null });
    } catch (erro) {
      setEstado({ itens: null, erro });
    }
  }, []);

  useEffect(() => {
    if (!cache) carregar();
  }, [carregar]);

  return { ...estado, recarregar: carregar };
}

/** O plano atual sai do claim `plano` do token; os números saem de GET /planos. */
export function usePlanoAtual(nomePlano) {
  const { itens, erro, recarregar } = usePlanos();
  return { plano: itens?.find((p) => p.plano === nomePlano) ?? null, erro, recarregar };
}
