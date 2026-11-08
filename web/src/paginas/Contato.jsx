import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Mail, MessageCircle, Phone, RotateCcw, Save, SearchX, Trash2 } from 'lucide-react';
import { api } from '../api/cliente.js';
import { ehInesperado, mensagemDeErro } from '../api/mensagens.js';
import { useToast } from '../componentes/Toasts.jsx';
import { ESTAGIOS, SeletorSegmentado } from '../contatos/estagios.jsx';
import { Historico, NovaInteracao } from '../contatos/Interacoes.jsx';
import { linkTelefone, linkWhatsApp, textoUltimaInteracao, vazioParaNull } from '../util/formatos.js';
import Campo from '../componentes/ui/Campo.jsx';
import Botao from '../componentes/ui/Botao.jsx';
import Dialogo from '../componentes/ui/Dialogo.jsx';

const CAMPOS = ['nome', 'email', 'telefone', 'empresa', 'observacao'];
const paraFormulario = (c) => Object.fromEntries(CAMPOS.map((k) => [k, c[k] ?? '']));

function Voltar() {
  return (
    <Link to="/contatos" className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-texto-secundario hover:text-texto">
      <ArrowLeft aria-hidden="true" className="size-5" /> Contatos
    </Link>
  );
}

function AcoesRapidas({ contato }) {
  const tel = linkTelefone(contato.telefone);
  const whats = linkWhatsApp(contato.telefone);
  const acoes = [
    tel && { href: tel, Icone: Phone, rotulo: 'Ligar', nome: `Ligar para ${contato.nome}` },
    whats && { href: whats, Icone: MessageCircle, rotulo: 'WhatsApp', nome: `WhatsApp de ${contato.nome}`, externo: true },
    contato.email && { href: `mailto:${contato.email}`, Icone: Mail, rotulo: 'E-mail', nome: `E-mail para ${contato.nome}` },
  ].filter(Boolean);
  if (acoes.length === 0) return null; // só aparecem quando o dado existe

  return (
    <div className="flex gap-2">
      {acoes.map(({ href, Icone, rotulo, nome, externo }) => (
        <a
          key={rotulo}
          href={href}
          aria-label={nome}
          className="botao botao-secundario min-h-14 flex-1 flex-col gap-0.5 px-2 py-1.5 text-sm md:max-w-36"
          {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          <Icone aria-hidden="true" className="size-5" />
          <span>{rotulo}</span>
        </a>
      ))}
    </div>
  );
}

export default function Contato() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { mostrar } = useToast();
  const [carga, setCarga] = useState({ estado: 'carregando', erro: null });
  const [contato, setContato] = useState(null);
  const [interacoes, setInteracoes] = useState([]);
  const [form, setForm] = useState(null);
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [mudandoEstagio, setMudandoEstagio] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    setCarga({ estado: 'carregando', erro: null });
    Promise.all([
      api(`/contatos/${id}`, { sinal: controle.signal }),
      api(`/contatos/${id}/interacoes`, { sinal: controle.signal }),
    ])
      .then(([c, { itens }]) => {
        setContato(c);
        setForm(paraFormulario(c));
        setInteracoes(itens);
        setCarga({ estado: 'ok', erro: null });
      })
      .catch((e) => {
        if (e.name === 'AbortError' || e.codigo === 'NAO_AUTENTICADO') return;
        setCarga({ estado: e.codigo === 'NAO_ENCONTRADO' ? 'nao-encontrado' : 'erro', erro: e });
      });
    return () => controle.abort();
  }, [id, tentativa]);

  // Só os campos que mudaram vão no PATCH (o contrato aceita corpo parcial).
  const mudancas = useMemo(() => {
    if (!contato || !form) return {};
    const m = {};
    for (const k of CAMPOS) {
      const novo = k === 'nome' ? form.nome.trim() : vazioParaNull(form[k]);
      const valor = k === 'email' && novo ? novo.toLowerCase() : novo;
      if ((contato[k] ?? null) !== valor) m[k] = valor;
    }
    return m;
  }, [contato, form]);
  const alterado = Object.keys(mudancas).length > 0;

  const mudar = (campo) => (e) => {
    setForm((f) => ({ ...f, [campo]: e.target.value }));
    if (erros[campo]) setErros((x) => ({ ...x, [campo]: undefined }));
  };

  function tratarFalha(falha) {
    if (falha.codigo === 'EMAIL_DUPLICADO') setErros({ email: mensagemDeErro(falha, 'contato') });
    else if (falha.codigo === 'VALIDACAO' && falha.campos.length) {
      setErros(Object.fromEntries(falha.campos.map((c) => [c.campo, c.erro])));
    } else if (falha.codigo === 'NAO_ENCONTRADO') setCarga({ estado: 'nao-encontrado', erro: falha });
    else if (falha.codigo !== 'NAO_AUTENTICADO') {
      mostrar({ tipo: 'erro', texto: mensagemDeErro(falha, 'contato'), codigo: ehInesperado(falha) ? falha.requestId : null });
    }
  }

  async function salvar(ev) {
    ev.preventDefault();
    if (salvando || !alterado) return;
    if (!form.nome.trim()) return setErros({ nome: 'O nome não pode ficar vazio.' });
    setSalvando(true);
    try {
      const atualizado = await api(`/contatos/${id}`, { metodo: 'PATCH', corpo: mudancas });
      setContato(atualizado);
      setForm(paraFormulario(atualizado));
      mostrar({ tipo: 'sucesso', texto: 'Alterações salvas.' });
    } catch (falha) {
      tratarFalha(falha);
    } finally {
      setSalvando(false);
    }
  }

  async function mudarEstagio(estagio) {
    if (mudandoEstagio || estagio === contato.estagio) return;
    setMudandoEstagio(true);
    try {
      const atualizado = await api(`/contatos/${id}`, { metodo: 'PATCH', corpo: { estagio } });
      setContato(atualizado);
      mostrar({ tipo: 'sucesso', texto: `Estágio: ${ESTAGIOS.find((e) => e.valor === estagio).rotulo}.` });
    } catch (falha) {
      tratarFalha(falha);
    } finally {
      setMudandoEstagio(false);
    }
  }

  async function excluir() {
    setExcluindo(true);
    try {
      await api(`/contatos/${id}`, { metodo: 'DELETE' });
      mostrar({ tipo: 'sucesso', texto: `${contato.nome} foi excluído.` });
      navegar('/contatos', { replace: true });
    } catch (falha) {
      setExcluindo(false);
      setConfirmarExclusao(false);
      tratarFalha(falha);
    }
  }

  if (carga.estado === 'carregando') {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Voltar />
        <div className="h-9 w-2/3 animate-pulse rounded bg-superficie-ativa" />
        <div className="h-64 animate-pulse rounded-cartao bg-superficie-ativa" />
      </div>
    );
  }

  if (carga.estado === 'nao-encontrado') {
    // CQ-02: nunca sugerir que o contato existe em outra conta. Mesma tela para "não existe".
    return (
      <div className="flex flex-col gap-6">
        <Voltar />
        <div className="cartao flex flex-col items-center gap-3 px-5 py-10 text-center">
          <SearchX aria-hidden="true" className="size-8 text-texto-mudo" />
          <h1 className="text-xl">Não encontramos esse contato.</h1>
          <Link to="/contatos" className="botao botao-primario">
            Ver contatos
          </Link>
        </div>
      </div>
    );
  }

  if (carga.estado === 'erro') {
    return (
      <div className="flex flex-col gap-6">
        <Voltar />
        <div className="cartao flex flex-col items-start gap-3 p-5">
          <p>{mensagemDeErro(carga.erro, 'contato')}</p>
          {ehInesperado(carga.erro) && carga.erro.requestId && (
            <p className="font-mono text-sm text-texto-mudo">código: {carga.erro.requestId}</p>
          )}
          <button type="button" className="botao botao-secundario" onClick={() => setTentativa((t) => t + 1)}>
            <RotateCcw aria-hidden="true" className="size-5" /> Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Voltar />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl break-words md:text-3xl">{contato.nome}</h1>
        <p className="text-texto-secundario">
          {contato.empresa ? `${contato.empresa} · ` : ''}
          {textoUltimaInteracao(contato)}
        </p>
      </header>

      <AcoesRapidas contato={contato} />

      {/*
        Ordem no DOM = ordem no celular (o que o Marcelo mais usa primeiro):
        estágio -> nova interação + histórico -> dados. O leitor de tela segue a mesma ordem.
        No desktop (lg), duas colunas: estágio e dados à esquerda, histórico à direita.
      */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          <section aria-labelledby="titulo-estagio" className="cartao p-4 md:p-5 lg:col-start-1 lg:row-start-1">
            <h2 id="titulo-estagio" className="sr-only">
              Estágio
            </h2>
            <SeletorSegmentado
              legenda="Estágio"
              nome="estagio"
              opcoes={ESTAGIOS}
              valor={contato.estagio}
              aoMudar={mudarEstagio}
              desabilitado={mudandoEstagio}
            />
          </section>

        <section
          aria-labelledby="titulo-historico"
          className="cartao flex flex-col gap-5 p-4 md:p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <h2 id="titulo-historico" className="text-lg">
            Histórico
          </h2>
          <NovaInteracao
            contatoId={id}
            aoRegistrar={({ interacao, contato: atualizado }) => {
              setContato(atualizado);
              setInteracoes((lista) =>
                [interacao, ...lista].sort((a, b) => Date.parse(b.ocorrida_em) - Date.parse(a.ocorrida_em)),
              );
            }}
          />
          <div className="border-t border-borda-sutil pt-5">
            <Historico itens={interacoes} />
          </div>
        </section>

          <section aria-labelledby="titulo-dados" className="cartao flex flex-col gap-4 p-4 md:p-5 lg:col-start-1 lg:row-start-2">
            <h2 id="titulo-dados" className="text-lg">
              Dados
            </h2>
            <form onSubmit={salvar} className="flex flex-col gap-4" noValidate>
              <Campo rotulo="Nome" value={form.nome} onChange={mudar('nome')} erro={erros.nome} maxLength={120} autoComplete="off" obrigatorio />
              <Campo
                rotulo="E-mail"
                tipo="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={form.email}
                onChange={mudar('email')}
                erro={erros.email}
                maxLength={254}
                autoComplete="off"
              />
              <Campo
                rotulo="Telefone"
                tipo="tel"
                inputMode="tel"
                value={form.telefone}
                onChange={mudar('telefone')}
                erro={erros.telefone}
                maxLength={30}
                autoComplete="off"
              />
              <Campo rotulo="Empresa" value={form.empresa} onChange={mudar('empresa')} erro={erros.empresa} maxLength={120} autoComplete="off" />
              <Campo
                rotulo="Observação"
                multilinha
                rows={2}
                value={form.observacao}
                onChange={mudar('observacao')}
                erro={erros.observacao}
                maxLength={500}
              />
              <div className="flex md:justify-end">
                <Botao
                  type="submit"
                  icone={Save}
                  carregando={salvando}
                  textoCarregando="Salvando…"
                  disabled={!alterado}
                  className="w-full md:w-auto"
                >
                  Salvar alterações
                </Botao>
              </div>
            </form>
          </section>
      </div>

      {/* Excluir fica no fim da página, longe do "Salvar": ação destrutiva não pode estar colada na comum. */}
      <section aria-labelledby="titulo-excluir" className="flex flex-col gap-2 border-t border-borda-sutil pt-6">
        <h2 id="titulo-excluir" className="sr-only">
          Excluir contato
        </h2>
        <Botao variante="perigo" icone={Trash2} onClick={() => setConfirmarExclusao(true)} className="self-start">
          Excluir contato
        </Botao>
        <p className="text-sm text-texto-mudo">Apaga o contato e todo o histórico de interações.</p>
      </section>

      <Dialogo
        aberto={confirmarExclusao}
        aoFechar={() => !excluindo && setConfirmarExclusao(false)}
        titulo={`Excluir ${contato.nome}?`}
        descricao="O histórico de interações vai junto. Isso não pode ser desfeito."
      >
        <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
          <Botao variante="secundario" onClick={() => setConfirmarExclusao(false)} disabled={excluindo}>
            Cancelar
          </Botao>
          <Botao variante="perigo" icone={Trash2} carregando={excluindo} textoCarregando="Excluindo…" onClick={excluir}>
            Excluir contato
          </Botao>
        </div>
      </Dialogo>
    </div>
  );
}
