import { useState } from 'react';
import { CalendarDays, Mail, MessageCircle, Phone, Send, StickyNote, UsersRound } from 'lucide-react';
import { api } from '../api/cliente.js';
import { ehInesperado, mensagemDeErro } from '../api/mensagens.js';
import { useToast } from '../componentes/Toasts.jsx';
import { formatarDataHora, haQuantoTempo, paraDatetimeLocal, vazioParaNull } from '../util/formatos.js';
import { SeletorSegmentado } from './estagios.jsx';
import Campo from '../componentes/ui/Campo.jsx';
import Botao from '../componentes/ui/Botao.jsx';

export const TIPOS = [
  { valor: 'ligacao', rotulo: 'Ligação', Icone: Phone },
  { valor: 'whatsapp', rotulo: 'WhatsApp', Icone: MessageCircle },
  { valor: 'email', rotulo: 'E-mail', Icone: Mail },
  { valor: 'reuniao', rotulo: 'Reunião', Icone: UsersRound },
  { valor: 'outro', rotulo: 'Outro', Icone: StickyNote },
];
const tipoDe = (v) => TIPOS.find((t) => t.valor === v) ?? TIPOS[4];

/** Nova interação: tipo, nota e quando (padrão: agora; não deixa escolher data futura). */
export function NovaInteracao({ contatoId, aoRegistrar }) {
  const [tipo, setTipo] = useState('whatsapp');
  const [nota, setNota] = useState('');
  const [quando, setQuando] = useState(() => paraDatetimeLocal(new Date()));
  const [erros, setErros] = useState({});
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();
  const agoraLocal = paraDatetimeLocal(new Date());

  async function registrar(ev) {
    ev.preventDefault();
    if (enviando) return;
    const data = quando ? new Date(quando) : new Date();
    if (Number.isNaN(data.getTime())) return setErros({ ocorrida_em: 'Informe uma data válida.' });
    if (data.getTime() > Date.now() + 60 * 1000) return setErros({ ocorrida_em: 'A data não pode estar no futuro.' });
    setErros({});
    setEnviando(true);
    try {
      const resposta = await api(`/contatos/${contatoId}/interacoes`, {
        metodo: 'POST',
        corpo: { tipo, nota: vazioParaNull(nota), ocorrida_em: data.toISOString() },
      });
      // Usa o contato que volta na resposta: a regra da "última interação" (GREATEST) é da API.
      aoRegistrar(resposta);
      setNota('');
      setQuando(paraDatetimeLocal(new Date()));
      mostrar({ tipo: 'sucesso', texto: 'Interação registrada.' });
    } catch (falha) {
      if (falha.codigo === 'VALIDACAO' && falha.campos.length) {
        setErros(Object.fromEntries(falha.campos.map((c) => [c.campo, c.erro])));
      } else if (falha.codigo !== 'NAO_AUTENTICADO') {
        mostrar({ tipo: 'erro', texto: mensagemDeErro(falha, 'contato'), codigo: ehInesperado(falha) ? falha.requestId : null });
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={registrar} className="flex flex-col gap-4" noValidate>
      <SeletorSegmentado legenda="Tipo" nome="tipo-interacao" opcoes={TIPOS} valor={tipo} aoMudar={setTipo} empilhado />
      <Campo
        rotulo="Nota"
        multilinha
        rows={2}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        erro={erros.nota}
        maxLength={2000}
        placeholder="O que foi combinado?"
      />
      <div className="flex flex-col gap-4">
        <Campo
          rotulo="Quando"
          tipo="datetime-local"
          value={quando}
          max={agoraLocal}
          onChange={(e) => setQuando(e.target.value)}
          erro={erros.ocorrida_em}
        />
        <Botao type="submit" icone={Send} carregando={enviando} textoCarregando="Registrando…" className="md:self-end">
          Registrar interação
        </Botao>
      </div>
    </form>
  );
}

/** Linha do tempo, da mais recente para a mais antiga (a API já devolve nessa ordem). */
export function Historico({ itens }) {
  if (itens.length === 0) {
    return (
      <p className="flex items-start gap-2 text-texto-secundario">
        <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Nenhuma interação registrada ainda.
      </p>
    );
  }
  return (
    <ol className="relative flex flex-col gap-5 border-l border-borda-sutil pl-6">
      {itens.map((i) => {
        const { rotulo, Icone } = tipoDe(i.tipo);
        return (
          <li key={i.id} className="relative">
            <span className="absolute top-0 -left-[2.4rem] grid size-7 place-items-center rounded-full border border-borda-sutil bg-superficie text-primario">
              <Icone aria-hidden="true" className="size-3.5" />
            </span>
            <p className="font-semibold">
              {rotulo}{' '}
              <span className="font-normal text-texto-mudo">
                · <time dateTime={i.ocorrida_em}>{formatarDataHora(i.ocorrida_em)}</time> ({haQuantoTempo(i.ocorrida_em)})
              </span>
            </p>
            {i.nota && <p className="mt-0.5 whitespace-pre-line text-texto-secundario">{i.nota}</p>}
          </li>
        );
      })}
    </ol>
  );
}
