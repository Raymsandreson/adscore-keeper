// =============================================================================
// Conferência do processo — "esse valor e esse marco estão certos mesmo?".
//
// Abre por cima da Carteira do POP (Sheet lateral, empilhado; fechar devolve
// exatamente onde estava). Não é mais um relatório: é a MATÉRIA PRIMA ao lado do
// número, para o número poder ser contestado.
//
// O que a tela responde, nesta ordem:
//   1. Alertas — o que está errado ou frágil neste processo.
//   2. Marco — qual é o atual, que evidência o detectou, e a trilha inteira.
//   3. Valor — por cliente: qual decisão foi usada e quais foram DESCARTADAS
//      (somar todas infla ~2,6x; a tela mostra a soma ingênua para comparação).
//   4. Pagamentos — o que virou caixa de verdade.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle, Calculator, CheckCircle2, FileText, Info, Loader2, Milestone, Paperclip, Plus, RefreshCw, ShieldAlert, Undo2, Unlink, UserRound, XCircle,
} from 'lucide-react';
import { useConferenciaProcesso, type AlvoConferencia, type NivelAlerta } from '@/hooks/useConferenciaProcesso';
import { FONTE_LABEL, useProcessoMarcos } from '@/hooks/useProcessoMarcos';
import { ReguaMarcosDoPop, type MarcoDaRegua } from '@/components/cases/ReguaMarcosDoPop';
import { ESTAGIO_LABEL } from '@/hooks/usePopMarcos';
import { formatCnj, onlyDigits } from '@/lib/cnj';
import { MudancasDaPecaDialog } from './MudancasDaPecaDialog';
import { MarcoEvidenciaDialog, type AlvoEvidencia } from './MarcoEvidenciaDialog';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { usePecasDoProcesso } from '@/hooks/usePecasDoProcesso';
import { melhorPeca, rotuloDaPeca, type AssuntoPeca, type PecaDoProcesso } from '@/lib/pecasDoProcesso';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataBR = (d: string | null) => {
  if (!d) return '—';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

/** "2026-07-01" -> "jul/2026". Número corrigido sem data não serve pra negociar. */
const mesAno = (iso: string | null) => {
  const m = (iso || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return '—';
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m[2]) - 1]}/${m[1]}`;
};

const INDICE_LABEL: Record<string, string> = {
  SELIC_SIMPLES_JT: 'SELIC simples (Justiça do Trabalho)',
  TCM_ESTADUAL: 'TCM (Justiça Estadual)',
};

const CORES: Record<NivelAlerta, string> = {
  alto: 'border-destructive/40 bg-destructive/10 text-destructive',
  atencao: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  info: 'border-border bg-muted/50 text-muted-foreground',
};

const ICONE: Record<NivelAlerta, typeof AlertTriangle> = {
  alto: ShieldAlert,
  atencao: AlertTriangle,
  info: Info,
};

function Secao({ titulo, children, acao, refSecao }: {
  titulo: string;
  children: React.ReactNode;
  acao?: React.ReactNode;
  refSecao?: React.Ref<HTMLElement>;
}) {
  return (
    <section ref={refSecao} className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
        {acao}
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </section>
  );
}

/**
 * "ver a peça" — abre o PDF dos autos por cima da tela, nunca em aba nova.
 *
 * Regra permanente do projeto: clique que abre alguma coisa abre em painel por
 * cima, e o fechar devolve a pessoa exatamente de onde saiu. O MediaLightbox é
 * o mesmo visualizador do WhatsApp — mesma leitura, mesmo botão de baixar.
 *
 * Sem peça casada o botão NÃO aparece. Botão que não abre nada é pior que
 * ausência de botão: promete prova e entrega frustração.
 */
function BotaoPeca({ pecas, data, assunto, janelaDias, onAbrir }: {
  pecas: PecaDoProcesso[];
  data: string | null;
  assunto: AssuntoPeca;
  janelaDias?: number;
  onAbrir: (peca: PecaDoProcesso, rotulo: string) => void;
}) {
  const peca = melhorPeca(pecas, data, { assunto, janelaDias });
  if (!peca) return null;
  const rotulo = rotuloDaPeca(peca);
  // De onde a peça veio: quem confere precisa saber se está lendo o que o
  // tribunal juntou ou o que alguém do escritório subiu à mão.
  const procedencia = peca.origem === 'manual' ? 'anexada à mão' : 'peça do tribunal';
  return (
    <button
      type="button"
      onClick={() => onAbrir(peca, rotulo)}
      className="inline-flex items-center gap-1 text-[11px] underline underline-offset-2 hover:text-foreground"
      title={`${rotulo} · ${procedencia}`}
    >
      <Paperclip className="h-3 w-3 shrink-0" />
      ver a peça
      {peca.tipo === 'RESTRITO' && (
        <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[8px]">restrita</Badge>
      )}
      {!peca.exata && <span className="text-muted-foreground">(+{peca.distanciaDias}d)</span>}
    </button>
  );
}

/**
 * "anexar peça" — o caminho manual, que existe porque o automático não basta.
 *
 * O certificado digital abre um tribunal em oito, e a peça que decide dinheiro
 * (termo de acordo, planilha homologada) é quase sempre restrita. Sem isto, a
 * carteira ficaria esperando um certificado que pode nunca funcionar.
 *
 * A peça entra amarrada à DATA DO MARCO — é o que faz o casamento por data
 * encontrá-la depois, sem nenhuma chave nova.
 */
function BotaoAnexar({ rotulo, data, onAnexar }: {
  rotulo: string;
  data: string | null;
  onAnexar: (a: File, d: { titulo: string; dataDocumento: string | null }) => Promise<{ ok: boolean; erro?: string }>;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <>
      <input
        ref={input} type="file" accept="application/pdf" className="hidden"
        onChange={async (e) => {
          const a = e.target.files?.[0];
          e.target.value = ''; // permite reanexar o mesmo arquivo depois de um erro
          if (!a) return;
          setSubindo(true); setErro(null);
          const r = await onAnexar(a, { titulo: rotulo, dataDocumento: data });
          setSubindo(false);
          if (!r.ok) setErro(r.erro ?? 'falha ao anexar');
        }}
      />
      <button
        type="button"
        disabled={subindo}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        title={`Anexar a peça que comprova "${rotulo}"`}
      >
        {subindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        {subindo ? 'anexando…' : 'anexar peça'}
      </button>
      {erro && <span className="text-[10px] text-destructive">{erro}</span>}
    </>
  );
}

/**
 * "desvincular" — a peça errada sai de cena, e nada se apaga.
 *
 * Vale igual para peça do tribunal e para upload manual: o Escavador baixa
 * trocado, o tribunal junta no lugar errado, o casamento por data pega a peça de
 * outro ato, ou alguém sobe o arquivo errado. Em todos, o que se quer é que ela
 * pare de aparecer aqui — não que ela deixe de existir.
 *
 * Apagar não traria nada que isto não traga, e traria risco: o que veio do
 * tribunal custou uma solicitação, e ela funciona em um tribunal de oito.
 */
function BotaoDesvincular({ peca, onDesvincular }: {
  peca: PecaDoProcesso;
  onDesvincular: (p: PecaDoProcesso, motivo: string) => Promise<{ ok: boolean; erro?: string }>;
}) {
  const [indo, setIndo] = useState(false);
  return (
    <button
      type="button"
      disabled={indo}
      onClick={async () => {
        setIndo(true);
        await onDesvincular(peca, 'peça errada para este marco');
        setIndo(false);
      }}
      className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
      title="Desvincular: a peça deixa de aparecer neste marco. O arquivo continua no acervo e dá para desfazer."
    >
      {indo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
    </button>
  );
}

/**
 * "o que esta peça muda" — para peça que JÁ está no marco.
 *
 * O diálogo de mudanças só abria depois de anexar, e isso deixava de fora o caso
 * mais comum: a peça certa já veio nos autos e ninguém nunca a leu. Foi o que
 * aconteceu no caso 88 — o termo de acordo estava no bucket desde 24/08 e a
 * carteira seguia com o valor errado, sem caminho na tela para descobrir.
 */
function BotaoOQueMuda({ peca, onVer }: {
  peca: PecaDoProcesso;
  onVer: (p: PecaDoProcesso) => Promise<void>;
}) {
  const [indo, setIndo] = useState(false);
  return (
    <button
      type="button"
      disabled={indo}
      onClick={async () => { setIndo(true); await onVer(peca); setIndo(false); }}
      className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
      title="Ver o que esta peça muda nos valores"
    >
      {indo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Calculator className="h-3 w-3" />}
    </button>
  );
}

/** Uma peça foi desvinculada aqui — o caminho de volta fica à vista. */
function AvisoOculta({ pecas, data, onReexibir }: {
  pecas: PecaDoProcesso[]; data: string | null;
  onReexibir: (p: PecaDoProcesso) => Promise<{ ok: boolean; erro?: string }>;
}) {
  const [indo, setIndo] = useState(false);
  const p = pecas.find(x => (x.dataDocumento ?? '') === (data ?? '') && data);
  if (!p) return null;
  return (
    <button
      type="button"
      disabled={indo}
      onClick={async () => { setIndo(true); await onReexibir(p); setIndo(false); }}
      className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
      title={`"${p.titulo ?? 'peça'}" foi desvinculada — clique para trazer de volta`}
    >
      <Undo2 className="h-3 w-3" /> desfazer
    </button>
  );
}

interface Props {
  alvo: AlvoConferencia | null;
  onClose: () => void;
  /** Abre a ficha completa do processo — o pai monta o sheet, para não aninhar. */
  onAbrirFicha: (processId: string) => void;
  /**
   * Abre a ficha do CASO (o lead). Mesma razão do `onAbrirFicha`: quem monta o
   * painel é o pai. O processo é metade da história — a outra metade (contato,
   * atividades, financeiro do cliente) mora no lead, e até aqui a única forma de
   * chegar nele a partir da carteira era fechar tudo e procurar pelo nome.
   */
  onAbrirLead?: (leadId: string) => void;
}

export function ProcessoConferenciaSheet({ alvo, onClose, onAbrirFicha, onAbrirLead }: Props) {
  const {
    marcos, marcoAtual, temAcordo, suspenso, clientes, pagamentos, duplicatas,
    totalConferido, totalAtualizado, totalPago, somaIngenua, alertas, loading, erro,
    recarregar, leadDoProcesso, leadIdDoProcesso, jcmIndice, jcmReferencia,
  } = useConferenciaProcesso(alvo);

  // As peças dos autos deste CNJ, para poder abrir a prova ao lado do número.
  const { pecas, ocultas, assinar, anexar, ocultar, reexibir, lerPeca, corrigirValores } = usePecasDoProcesso(alvo?.cnj ?? null);

  // A régua completa do POP (mesma RPC da ficha e da fase automática): a seção
  // "Marcos" desenha a linha inteira — prevista + detectada — e não só a trilha
  // do que foi visto. A conta local do hook segue valendo como AUDITORIA do
  // marco atual; a régua da RPC é o retrato oficial.
  const regua = useProcessoMarcos(alvo?.processId ?? null);

  // O que muda com a peça recém-anexada. Sem este retorno, trocar documento é um
  // clique que não produz efeito visível — e o Raym leu isso como tela quebrada.
  const [mudancas, setMudancas] = useState<{
    aberto: boolean; carregando: boolean; erro: string | null;
    leitura: Record<string, unknown> | null; titulo: string;
  }>({ aberto: false, carregando: false, erro: null, leitura: null, titulo: '' });
  const [pecaAberta, setPecaAberta] = useState<{ url: string; titulo: string } | null>(null);
  const [erroPeca, setErroPeca] = useState<string | null>(null);
  // Qual marco está sendo auditado — "por que este marco?" abre a evidência crua.
  const [evidenciaDe, setEvidenciaDe] = useState<AlvoEvidencia | null>(null);
  // O `anexar` recarrega a lista; a ref dá acesso ao valor JÁ atualizado sem
  // esperar o próximo render.
  const pecasRef = useRef<PecaDoProcesso[]>([]);

  /** Anexa e, na sequência, mostra o efeito nos números. */
  const anexarEMostrar = useCallback(async (
    arquivo: File, dados: { titulo: string; dataDocumento: string | null },
  ) => {
    const r = await anexar(arquivo, dados);
    if (!r.ok) return r;
    // A peça acabou de nascer: acha o id dela pela data e pelo título que demos.
    const nova = pecasRef.current.find(
      p => p.origem === 'manual' && p.titulo === dados.titulo
        && (p.dataDocumento ?? null) === (dados.dataDocumento ?? null),
    );
    if (!nova) return r; // anexou, mas não deu para localizar — melhor calar que errar
    setMudancas({ aberto: true, carregando: true, erro: null, leitura: null, titulo: dados.titulo });
    const lida = await lerPeca(nova.id);
    setMudancas(m => ({
      ...m, carregando: false,
      leitura: lida.leitura ?? null,
      erro: lida.ok ? null : (lida.erro ?? 'a leitura não voltou'),
    }));
    return r;
  }, [anexar, lerPeca]);

  /** Lê uma peça que já está no marco e mostra o efeito dela nos números. */
  const verOQueMuda = useCallback(async (peca: PecaDoProcesso) => {
    const titulo = peca.titulo ?? 'Peça dos autos';
    setMudancas({ aberto: true, carregando: true, erro: null, leitura: null, titulo });
    const lida = await lerPeca(peca.id);
    setMudancas(m => ({
      ...m, carregando: false,
      leitura: lida.leitura ?? null,
      erro: lida.ok ? null : (lida.erro ?? 'a leitura não voltou'),
    }));
  }, [lerPeca]);

  const abrirPeca = useCallback(async (peca: PecaDoProcesso, rotulo: string) => {
    setErroPeca(null);
    const url = await assinar(peca.storagePath);
    // Assinatura falha quando o bucket não libera a sessão. Dizer isso é melhor
    // que abrir um visualizador vazio e deixar a pessoa achando que quebrou.
    if (!url) { setErroPeca(`Não consegui abrir "${rotulo}".`); return; }
    setPecaAberta({ url, titulo: rotulo });
  }, [assinar]);

  pecasRef.current = pecas;

  /** A régua da RPC no formato do componente unificado. */
  const reguaItens = useMemo<MarcoDaRegua[]>(
    () => regua.marcos.map(m => ({
      chave: m.marco_chave,
      rotulo: m.rotulo,
      ordem: m.ordem,
      estado: m.estado,
      eventual: m.eventual,
      terminal: m.terminal,
      atravessaFases: m.atravessa_fases,
      data: m.data_detectada,
      fonte: m.fonte,
      temProvaDocumental: m.tem_prova_documental,
      atual: m.atual,
      stageNome: m.stage_nome,
    })),
    [regua.marcos],
  );

  const recebidos = pagamentos.filter(p => p.data_recebida);
  const previstos = pagamentos.filter(p => !p.data_recebida);

  // Quem chegou clicando NO VALOR quer ver a abertura por parte, não os alertas.
  const secaoValores = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (alvo?.foco !== 'valores' || loading || !secaoValores.current) return;
    secaoValores.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [alvo?.foco, alvo?.processId, loading]);

  return (
    <Sheet open={!!alvo} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base">
            {/* De quem é o processo no lugar de maior destaque — o CNJ não diz
                nada para quem lê, o nome do caso diz. */}
            {leadDoProcesso || alvo?.leadNome || 'Conferência do processo'}
          </SheetTitle>
          {(leadDoProcesso || alvo?.leadNome) && (
            <p className="text-xs text-muted-foreground">Conferência do processo</p>
          )}
          <p className="break-all font-mono text-xs text-muted-foreground">{formatCnj(onlyDigits(alvo?.cnj))}</p>
          {alvo?.titulo && <p className="text-xs text-muted-foreground">{alvo.titulo}</p>}
        </SheetHeader>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => alvo && onAbrirFicha(alvo.processId)}
          >
            <FileText className="h-3.5 w-3.5" /> Abrir ficha do processo
          </Button>
          {/* O caso, não o processo. Só aparece quando existe lead vinculado e
              quem montou a conferência sabe abrir um — botão morto seria pior. */}
          {onAbrirLead && leadIdDoProcesso && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onAbrirLead(leadIdDoProcesso)}
            >
              <UserRound className="h-3.5 w-3.5" /> Abrir o caso
            </Button>
          )}
          <Button
            size="sm" variant="ghost" className="gap-1.5"
            onClick={() => { void recarregar(); void regua.recarregar(); }}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Recarregar
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : (
          <>
            {/* 1. O veredito da conferência */}
            {alertas.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Nada divergente aqui: um cadastro só para este CNJ, marco de fase detectado com data,
                  e todo valor vem de decisão lida. O número da carteira se sustenta.
                </span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {alertas.map((a, i) => {
                  const Icone = ICONE[a.nivel];
                  return (
                    <div key={i} className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${CORES[a.nivel]}`}>
                      <Icone className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold">{a.titulo}</div>
                        <div className="opacity-90">{a.detalhe}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 2. Marco */}
            <Secao titulo="Marco">
              {marcoAtual ? (
                <div className="rounded-md border bg-muted/30 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Milestone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-semibold">{marcoAtual.rotulo}</span>
                    <Badge variant="secondary" className="text-[10px]">marco atual</Badge>
                    {temAcordo && <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">acordo homologado</Badge>}
                    {suspenso && <Badge className="bg-amber-500 text-[10px] hover:bg-amber-500">suspenso</Badge>}
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Detectado em <span className="font-medium text-foreground">{dataBR(marcoAtual.dataDetectada)}</span>
                    {marcoAtual.fonte && <> por <span className="font-medium text-foreground">{FONTE_LABEL[marcoAtual.fonte] || marcoAtual.fonte}</span></>}
                    {marcoAtual.temProvaDocumental
                      ? <> · <span className="text-emerald-600 dark:text-emerald-400">com prova documental</span></>
                      : <> · <span className="text-amber-600 dark:text-amber-400">sem prova documental</span></>}
                    {marcoAtual.estagioSugerido && <> · sugere estágio <span className="font-medium text-foreground">{ESTAGIO_LABEL[marcoAtual.estagioSugerido] || marcoAtual.estagioSugerido}</span></>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEvidenciaDe({
                      processId: alvo!.processId, marcoChave: marcoAtual.chave, rotulo: marcoAtual.rotulo,
                    })}
                    className="mt-1 text-[11px] underline underline-offset-2 hover:text-foreground"
                  >
                    Por que este marco?
                  </button>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    É o marco atual por ser o de maior ordem entre os que são FASE. Acordo e suspensão são
                    estado — atravessam fases e não disputam esta posição.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Nenhum marco de fase detectado neste processo.</p>
              )}

              {regua.marcos.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Marcos</div>
                  {/* A régua INTEIRA do POP — prevista + detectada — no mesmo
                      layout e com a mesma fonte da aba Marcos da ficha e da
                      fase automática (unificação de 27/08/2026). Degrau
                      eventual só aparece se aconteceu; acordo e suspensão são
                      estado e viram badge no topo. */}
                  <ReguaMarcosDoPop
                    marcos={reguaItens}
                    onVerFonte={(m) => setEvidenciaDe({
                      processId: alvo!.processId, marcoChave: m.chave, rotulo: m.rotulo,
                    })}
                    renderDireita={(m) => {
                      if (m.estado !== 'atingido') return null;
                      const p = melhorPeca(pecas, m.data, { assunto: 'MARCO' });
                      // Sem peça casada, o que a linha precisa não é de um botão
                      // morto: é do caminho para trazer a prova que falta.
                      return (
                        <span className="flex shrink-0 items-center gap-1.5">
                          {p ? (
                            <>
                              <BotaoPeca pecas={pecas} data={m.data} assunto="MARCO" onAbrir={abrirPeca} />
                              <BotaoOQueMuda peca={p} onVer={verOQueMuda} />
                              <BotaoDesvincular peca={p} onDesvincular={ocultar} />
                            </>
                          ) : (
                            <BotaoAnexar rotulo={m.rotulo} data={m.data} onAnexar={anexarEMostrar} />
                          )}
                          <AvisoOculta pecas={ocultas} data={m.data} onReexibir={reexibir} />
                        </span>
                      );
                    }}
                  />
                  {marcos.some(m => m.semCadastroNoPop) && (
                    <div className="space-y-0.5 pt-1">
                      {/* Marco gravado no processo cuja chave não existe mais na
                          régua deste POP: a carteira o ignora, mas escondê-lo
                          apagaria evidência. */}
                      {marcos.filter(m => m.semCadastroNoPop).map(m => (
                        <div key={m.chave} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs">
                          <Badge variant="outline" className="shrink-0 border-amber-500/50 text-[9px] text-amber-600 dark:text-amber-400">
                            fora do POP
                          </Badge>
                          <span className="min-w-0 flex-1 truncate">{m.rotulo}</span>
                          <button
                            type="button"
                            onClick={() => setEvidenciaDe({
                              processId: alvo!.processId, marcoChave: m.chave, rotulo: m.rotulo,
                            })}
                            className="shrink-0 text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                            title="Ver a evidência que gerou este marco"
                          >
                            {m.fonte ? FONTE_LABEL[m.fonte] || m.fonte : 'sem fonte'}
                          </button>
                          <span className="w-20 shrink-0 text-right text-muted-foreground">{dataBR(m.dataDetectada)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {marcos.length > 0 && regua.marcos.length === 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Marcos detectados</div>
                  {/* Fallback: POP sem régua cadastrada (a RPC volta vazia) — a
                      lista antiga, do mais antigo para o mais novo. */}
                  {[...marcos]
                    .sort((a, b) => (a.dataDetectada ?? '').localeCompare(b.dataDetectada ?? ''))
                    .map((m, i, todos) => (
                    <div
                      key={`${m.chave}-${m.dataDetectada}`}
                      className={`flex items-start gap-2 rounded px-1.5 py-1 text-xs ${m.atual ? 'bg-muted/60 font-medium' : ''}`}
                    >
                      {/* Fio da linha do tempo: bolinha cheia no marco atual, e o
                          traço só até o penúltimo, para a linha não sobrar solta. */}
                      <span className="relative flex w-3 shrink-0 justify-center self-stretch">
                        <span
                          className={`z-10 mt-1 h-2 w-2 shrink-0 rounded-full ${
                            m.atual ? 'bg-primary ring-2 ring-primary/30' : 'bg-muted-foreground/40'}`}
                        />
                        {i < todos.length - 1 && (
                          <span className="absolute left-1/2 top-2 h-full w-px -translate-x-1/2 bg-border" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{m.rotulo}</span>
                      {m.atravessaFases && (
                        <Badge variant="outline" className="shrink-0 text-[9px]">estado</Badge>
                      )}
                      {m.semCadastroNoPop && (
                        <Badge variant="outline" className="shrink-0 border-amber-500/50 text-[9px] text-amber-600 dark:text-amber-400">
                          fora do POP
                        </Badge>
                      )}
                      {/* A fonte deixa de ser rótulo e vira porta: clicar abre a
                          linha que gerou o marco — o movimento do DataJud, a
                          peça, a publicação. Era a única afirmação da tela que
                          ninguém podia conferir. */}
                      <button
                        type="button"
                        onClick={() => setEvidenciaDe({
                          processId: alvo!.processId, marcoChave: m.chave, rotulo: m.rotulo,
                        })}
                        className="shrink-0 text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                        title="Ver a evidência que gerou este marco"
                      >
                        {m.fonte ? FONTE_LABEL[m.fonte] || m.fonte : 'sem fonte'}
                      </button>
                      {(() => {
                        const p = melhorPeca(pecas, m.dataDetectada, { assunto: 'MARCO' });
                        // Sem peça casada, o que a linha precisa não é de um botão
                        // morto: é do caminho para trazer a prova que falta.
                        return (
                          <span className="flex shrink-0 items-center gap-1.5">
                            {p ? (
                              <>
                                <BotaoPeca
                                  pecas={pecas} data={m.dataDetectada} assunto="MARCO"
                                  onAbrir={abrirPeca}
                                />
                                <BotaoOQueMuda peca={p} onVer={verOQueMuda} />
                                <BotaoDesvincular peca={p} onDesvincular={ocultar} />
                              </>
                            ) : (
                              <BotaoAnexar rotulo={m.rotulo} data={m.dataDetectada} onAnexar={anexarEMostrar} />
                            )}
                            <AvisoOculta pecas={ocultas} data={m.dataDetectada} onReexibir={reexibir} />
                          </span>
                        );
                      })()}
                      <span className="w-20 shrink-0 text-right text-muted-foreground">{dataBR(m.dataDetectada)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Secao>

            {/* 3. Valor — a abertura por parte */}
            <Secao
              refSecao={secaoValores}
              /* "líquido" no nome, não em nota de rodapé: este número é a cota do
                 cliente JÁ descontado o honorário contratual — o termo do caso 88
                 diz isso com todas as letras ("já descontados os honorários
                 contratuais"). Sem o rótulo, ele passa por valor do processo, e o
                 processo vale mais. */
              titulo={clientes.length === 1
                ? 'Valor líquido da parte'
                : `Valor líquido das partes (${clientes.length})`}
              acao={
                <span className="flex flex-col items-end leading-tight">
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                    líquido total das partes
                  </span>
                  <span className="text-xs font-semibold">{brl(totalConferido)}</span>
                  {totalAtualizado > totalConferido + 0.01 && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                      {brl(totalAtualizado)} corrigido
                    </span>
                  )}
                </span>
              }
            >
              {clientes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum valor lançado na jurimetria para este CNJ — na carteira ele entra como projetado.
                </p>
              ) : (
                <>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Valor LÍQUIDO de cada parte — já sem o honorário contratual. Não é o valor do
                    processo: a condenação inteira é maior, porque inclui o que é do escritório. O que
                    a carteira mostra é a soma das {clientes.length}{' '}
                    {clientes.length === 1 ? 'parte' : 'partes'} abaixo.
                  </p>
                  {clientes.map(c => (
                    <div key={c.cliente} className="rounded-md border p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{c.cliente}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[9px]">{ESTAGIO_LABEL[c.estagio] || c.estagio}</Badge>
                          <span className="flex flex-col items-end leading-tight">
                            <span className="text-sm font-semibold">{brl(c.valor)}</span>
                            {c.valorAtualizado > c.valor + 0.01 && (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                {brl(c.valorAtualizado)} corrigido
                              </span>
                            )}
                          </span>
                        </span>
                      </div>

                      {c.decisaoUsada ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Vale a decisão de <span className="font-medium text-foreground">{dataBR(c.decisaoUsada.data_decisao)}</span>
                          {c.decisaoUsada.tipo_evento && <> · {c.decisaoUsada.tipo_evento}</>}
                          {c.decisaoUsada.instancia && <> · {c.decisaoUsada.instancia}</>}
                          {c.decisaoUsada.orgao && <> · {c.decisaoUsada.orgao}</>}
                          <div>
                            moral {brl(c.danoMoral)} + estético {brl(c.danoEstetico)}
                          </div>
                          {/* A conta inteira, para o número poder ser contestado. */}
                          {c.pagoEm ? (
                            <div className="text-emerald-700 dark:text-emerald-400">
                              Pago em {dataBR(c.pagoEm)} — valor que já caiu na conta não corrige;
                              fica pelo nominal.
                            </div>
                          ) : c.corrigido ? (
                            <div className="text-emerald-700 dark:text-emerald-400">
                              {brl(c.valor)} × {c.coeficiente?.toFixed(4)} = <span className="font-semibold">{brl(c.valorAtualizado)}</span>
                              <span className="text-muted-foreground">
                                {' '}· {jcmIndice ? INDICE_LABEL[jcmIndice] || jcmIndice : 'índice'} de{' '}
                                {dataBR(c.termoInicial)} até {mesAno(jcmReferencia)}
                                {c.termoEstimado && ' · termo estimado pela data da decisão'}
                              </span>
                            </div>
                          ) : (
                            <div className="text-amber-600 dark:text-amber-400">
                              Sem índice de correção para este ramo — o valor fica pelo nominal.
                            </div>
                          )}
                          {/* A prova vem primeiro de casa: temos os autos no bucket. O
                              site do tribunal só sobra para decisão cujo PDF não baixamos —
                              aí sim é exceção legítima, porque não roda dentro do app. */}
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <BotaoPeca
                              pecas={pecas} data={c.decisaoUsada.data_decisao} assunto="DECISAO"
                              onAbrir={abrirPeca}
                            />
                            {c.decisaoUsada.link && !melhorPeca(pecas, c.decisaoUsada.data_decisao, { assunto: 'DECISAO' }) && (
                              <a
                                href={c.decisaoUsada.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] underline underline-offset-2"
                              >
                                ver a decisão no tribunal
                              </a>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> valor sem decisão vinculada
                        </div>
                      )}

                      {c.descartadas.length > 0 && (
                        <div className="mt-1.5 border-t pt-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Descartadas — decisões anteriores do mesmo cliente, NÃO somadas
                          </div>
                          {c.descartadas.map((d, i) => (
                            <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground line-through">
                              <XCircle className="h-3 w-3 shrink-0 opacity-60" />
                              <span className="min-w-0 flex-1 truncate">
                                {dataBR(d.decisao?.data_decisao ?? null)}
                                {d.decisao?.tipo_evento ? ` · ${d.decisao.tipo_evento}` : ''}
                              </span>
                              <span>{brl(d.valor)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {somaIngenua > totalConferido + 0.01 && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Somar todas as linhas de valor daria {brl(somaIngenua)} — {(somaIngenua / (totalConferido || 1)).toFixed(1)}x
                      o correto. A conferência usa só a última decisão de cada cliente, como a carteira.
                    </p>
                  )}
                </>
              )}
            </Secao>

            {/* 4. Pagamentos */}
            <Secao
              titulo="Pagamentos"
              acao={
                <span className="text-xs font-semibold">
                  {totalPago === 0 && recebidos.length > 0 && recebidos.every(p => p.valor_pago == null)
                    ? `${recebidos.length} parcela(s) recebida(s) sem valor importado`
                    : `${brl(totalPago)} recebido`}
                </span>
              }
            >
              {pagamentos.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma parcela lançada para este processo.</p>
              ) : (
                <div className="space-y-1">
                  {[...recebidos, ...previstos].map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs">
                      {p.data_recebida
                        ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                        : <Info className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate">
                        {p.cliente || '(sem cliente)'}
                        {p.n_parcela != null && <span className="text-muted-foreground"> · parcela {p.n_parcela}</span>}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {p.data_recebida ? `recebido ${dataBR(p.data_recebida)}` : `previsto ${dataBR(p.data_prevista)}`}
                      </span>
                      <BotaoPeca
                        pecas={pecas} data={p.data_recebida ?? p.data_prevista}
                        assunto="PAGAMENTO" janelaDias={15} onAbrir={abrirPeca}
                      />
                      <span className="w-24 shrink-0 text-right font-medium">
                        {/* Recebida sem valor digitado ≠ recebeu zero — a planilha
                            importou o status sem o valor. Dizer "R$ 0,00" mentiria. */}
                        {(p.data_recebida ? p.valor_pago : p.valor_previsto) == null
                          ? <span className="font-normal text-muted-foreground">sem valor</span>
                          : brl(Number(p.data_recebida ? p.valor_pago : p.valor_previsto) || 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Secao>

            {/* 5. Cadastros do mesmo CNJ */}
            {duplicatas.length > 1 && (
              <Secao titulo={`Cadastros deste CNJ (${duplicatas.length})`}>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  A carteira soma por cadastro. Cada linha abaixo leva o valor inteiro do processo para o
                  total do POP — só uma deveria existir.
                </p>
                {duplicatas.map(d => (
                  <div key={d.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/40">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {d.leadNome || <span className="italic text-muted-foreground">sem lead vinculado</span>}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {d.title || '(sem título)'}
                      </span>
                    </span>
                    {d.esta && <Badge variant="secondary" className="shrink-0 text-[9px]">este</Badge>}
                    {d.workflowId !== alvo?.boardId && (
                      <Badge variant="outline" className="shrink-0 text-[9px]">outro POP</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-2 text-[11px]"
                      onClick={() => onAbrirFicha(d.id)}
                    >
                      abrir
                    </Button>
                  </div>
                ))}
              </Secao>
            )}

            <p className="pb-2 text-[11px] leading-snug text-muted-foreground">
              Tudo nesta tela é leitura — conferir não altera nada. Os números repetem as regras da
              carteira: valor é quanto o processo vale (última decisão de cada parte), não o caixa do
              escritório. O corrigido aplica juros e correção do termo inicial de cada decisão até
              {' '}{mesAno(jcmReferencia)} — a carteira continua somando o nominal.
            </p>
          </>
        )}
        {/* Falha de assinatura não pode virar clique morto: a pessoa clicou
            esperando a prova e precisa saber por que ela não veio. */}
        {erroPeca && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            {erroPeca} A peça está nos autos, mas o bucket não liberou o acesso.
          </p>
        )}
      </SheetContent>

      {/* Empilha por cima do próprio Sheet: telão -> conferência -> peça, e o
          fechar devolve à conferência, não à carteira. Mesmo visualizador do
          WhatsApp, com o mesmo botão de baixar. */}
      <MudancasDaPecaDialog
        aberto={mudancas.aberto}
        onClose={() => setMudancas(m => ({ ...m, aberto: false }))}
        carregando={mudancas.carregando}
        erro={mudancas.erro}
        leitura={mudancas.leitura}
        tituloPeca={mudancas.titulo}
        atuais={clientes.map(c => ({ cliente: c.cliente, valor: c.valor }))}
        /* A decisão que a peça corrige é a que a carteira está usando hoje —
           todas as partes apontam para a mesma, por isso basta a primeira. */
        decId={clientes.find(c => c.decisaoUsada?.dec_id)?.decisaoUsada?.dec_id ?? null}
        onAplicar={async (leituraId, decId) => {
          const r = await corrigirValores(leituraId, decId, false);
          if (r.ok) await recarregar();
          return r;
        }}
      />

      {/* A evidência do marco. Recebe as peças já carregadas para poder abrir a
          prova no mesmo visualizador, sem uma segunda ida ao banco. */}
      <MarcoEvidenciaDialog
        alvo={evidenciaDe}
        onClose={() => setEvidenciaDe(null)}
        pecas={pecas}
        onAbrirPeca={abrirPeca}
        pecaDoMarco={evidenciaDe
          ? melhorPeca(pecas, marcos.find(m => m.chave === evidenciaDe.marcoChave)?.dataDetectada ?? null,
              { assunto: 'MARCO' })
          : null}
      />

      <MediaLightbox
        url={pecaAberta?.url ?? null}
        title={pecaAberta?.titulo ?? 'Peça dos autos'}
        onClose={() => setPecaAberta(null)}
      />
    </Sheet>
  );
}
