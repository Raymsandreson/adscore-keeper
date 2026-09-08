/**
 * Atendente Virtual — o que ele fez, não como ele é configurado.
 *
 * Configuração é rara: mexe uma vez e esquece. Acompanhar é diário. Os dois
 * estavam amassados dentro de Configurações, e por isso a informação de
 * operação vivia escondida atrás de um lápis de edição. Aqui fica só o que
 * aconteceu.
 *
 * Quatro colunas, e a quarta é a que ninguém pensa em pedir:
 *   Na fila     — escreveu e está esperando alguém olhar
 *   Enviadas    — chegou ao cliente, com data e hora
 *   Com humano  — virou reclamação/dinheiro/prazo e foi para um atendente
 *   Silenciadas — decidiu NÃO responder, e por quê
 *
 * A última existe porque um atendente que nunca fala parece estar funcionando.
 * Sem ver o silêncio, não dá para saber se ele está calando demais ou de menos.
 */
import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, ensureExternalSession, externalFunctionUrl } from '@/integrations/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FontesDaResposta, type ContextoUsado } from './FontesDaResposta';
import { VincularFichaSheet, type GrupoSemFicha } from './VincularFichaSheet';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Inbox, Send, UserCheck, VolumeX, RefreshCw, Check, X, Loader2, MessagesSquare, SendHorizonal, Volume2, Search, AlertTriangle, UserX, Link2 } from 'lucide-react';
import { openWhatsAppChatSheet } from '@/lib/whatsappChatSheet';
import { ContagemAteEnvio } from '@/components/whatsapp/ContagemAteEnvio';

const dbAny = db as unknown as SupabaseClient;

/** O formulario unico do lead, por id. Lazy: ele arrasta o LeadEditDialog e o
 *  useLeads junto, e ninguem precisa disso ate clicar em vincular. */
const LeadPainelPorId = lazy(() => import('@/components/leads/LeadPainelPorId'));

interface Pendente {
  id: string; group_jid: string; instance_name: string | null; agendamento_id: string | null;
  audio_url: string | null; audio_voz: string | null; audio_erro: string | null;
  /** Com que ajustes ESTE áudio foi gravado. Nulos nos áudios anteriores a
   *  08/09/2026, que saíram nas constantes antigas (1,10x / 0,60 / 0,30 / sem
   *  pausa). Sem isto, mexer nos ajustes da voz reescreveria o passado: o áudio
   *  velho continuaria soando igual e a tela diria os valores novos. */
  audio_velocidade: number | null;
  audio_estabilidade: number | null;
  audio_estilo: number | null;
  audio_pausa_ms: number | null;
  group_name: string | null; pergunta: string | null; pergunta_autor: string | null;
  resposta_sugerida: string; resposta_final: string | null; intencao: string | null;
  motivo_revisao: string | null; status: string; criado_em: string; enviado_em: string | null;
  atendente_id: string | null;
  /** O que a dom_contexto_processual devolveu e virou prompt. Nulo nos
   *  rascunhos anteriores a 07/09/2026, quando ninguem guardava a fonte. */
  contexto_usado: ContextoUsado | null;
  /**
   * O PostgREST devolve relação embutida como ARRAY, mesmo sendo um-para-um.
   * Aceito os dois formatos porque depender do formato de hoje é o tipo de coisa
   * que quebra calada numa atualização de biblioteca.
   */
  dom_atendentes?: { nome: string }[] | { nome: string } | null;
}
interface GrupoPiloto {
  group_jid: string; group_name: string | null; modo: string; ativo: boolean;
}

/**
 * OS TRÊS AJUSTES DA FALA — e por que "tom" não é o que todo mundo pensa
 *
 * A API da ElevenLabs NÃO tem pitch. Os campos de `voice_settings` são cinco
 * (stability, similarity_boost, style, speed, use_speaker_boost — fonte:
 * elevenlabs/skills, text-to-speech/references/voice-settings.md). Então "deixa
 * a voz mais grave" é impossível: a altura vem da gravação que clonou a voz.
 *
 * O que dá para mudar é a EXPRESSIVIDADE, e ela é a combinação de dois campos.
 * Por isso a tela oferece TOM como nome ("Sério", "Caloroso") e não como dois
 * sliders soltos: ninguém revisando resposta de cliente sabe o que 0,45 de
 * `style` faz, mas todo mundo sabe se quer soar sério ou caloroso.
 *
 * O banco guarda os NÚMEROS, não o nome. Renomear "Caloroso" amanhã não pode
 * reescrever o que já foi gravado.
 *
 * Estes valores estão duplicados na dom-rascunho (ESTABILIDADE_PADRAO,
 * ESTILO_PADRAO) e no CHECK da migration 20260908170000. Se um mudar, os
 * outros têm que mudar junto — mesma regra já vale para a velocidade.
 */
type AjusteDeFala = {
  velocidade?: number;
  estabilidade?: number;
  estilo?: number;
  pausa_ms?: number;
};

const VELOCIDADES = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1];

const TONS: { nome: string; estabilidade: number; estilo: number; ajuda: string }[] = [
  { nome: 'Sério',       estabilidade: 0.80, estilo: 0.00, ajuda: 'firme e uniforme — para prazo, exigência, notícia ruim' },
  { nome: 'Equilibrado', estabilidade: 0.60, estilo: 0.30, ajuda: 'o padrão de hoje — serve para quase tudo' },
  { nome: 'Caloroso',    estabilidade: 0.45, estilo: 0.45, ajuda: 'mais variação — para acolher quem está ansioso' },
  { nome: 'Expressivo',  estabilidade: 0.30, estilo: 0.65, ajuda: 'bem solto — o que mais escorrega para teatral' },
];

/** O tom em que este áudio saiu. Nulo = gerado antes de 08/09/2026, nas
 *  constantes antigas — que são exatamente o "Equilibrado". */
const nomeDoTom = (estabilidade: unknown, estilo: unknown): string => {
  const e = Number(estabilidade), y = Number(estilo);
  const achado = TONS.find(t => t.estabilidade === e && t.estilo === y);
  if (achado) return achado.nome;
  if (!Number.isFinite(e) || !Number.isFinite(y)) return 'Equilibrado';
  // Voz configurada por fora da tela (SQL na mão, por exemplo). Mostrar o
  // número cru é melhor que rotular errado com o preset mais próximo.
  return `estabilidade ${e.toFixed(2)} · estilo ${y.toFixed(2)}`;
};

/**
 * PAUSA — a única das três que não é parâmetro, e sim tag `<break time>` no
 * texto. Entra em cada quebra de linha da resposta, que é onde quem escreveu
 * já quis um respiro.
 *
 * ATENÇÃO: a doc oficial da ElevenLabs sobre a tag não pôde ser lida de
 * primeira mão quando isto foi escrito (egress bloqueado). Se o modelo não
 * interpretar a tag, ele a LÊ em voz alta. Por isso "Sem pausa" é o padrão e
 * nada muda para ninguém sem um clique — e por isso a primeira escuta com
 * pausa ligada confirma ou derruba a hipótese antes de qualquer envio.
 */
const PAUSAS = [
  { ms: 0,    rotulo: 'Sem pausa' },
  { ms: 400,  rotulo: 'Curta' },
  { ms: 700,  rotulo: 'Média' },
  { ms: 1000, rotulo: 'Longa' },
];

const rotuloDaPausa = (ms: unknown): string => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 'sem pausa';
  const achado = PAUSAS.find(p => p.ms === n);
  return achado ? `pausa ${achado.rotulo.toLowerCase()}` : `pausa de ${n}ms`;
};
/**
 * Grupo do piloto cuja FICHA DE CLIENTE não foi encontrada — a view
 * `vw_dom_grupo_sem_ficha` no Externo.
 *
 * Por que virou aba (08/09/2026): o assessor respondia esses grupos sem um
 * dado do processo, e isso não aparecia em lugar nenhum. Quem revisava lia o
 * "(0)" das fontes como processo parado. Consertar o vínculo dos que dava
 * (166 grupos, uma ficha só cada) resolveu a metade automática; estes aqui
 * exigem uma pessoa decidir, e por isso precisam de um lugar para serem vistos.
 */
interface SemFicha {
  group_jid: string;
  group_name: string | null;
  situacao: 'ambiguo' | 'sem_ficha';
  fichas_no_cadastro: number;
  rascunhos_no_escuro: number;
  ultimo_rascunho_em: string | null;
  o_que_fazer: string | null;
}
interface Decisao {
  id: string; group_name: string | null; group_jid: string; intencao: string | null;
  decisao: string; motivo: string | null; pergunta: string | null; criado_em: string;
}

/** Lê o nome do atendente venha ele como objeto ou como array de um item. */
function nomeDoAtendente(p: Pendente): string | null {
  const r = p.dom_atendentes;
  if (!r) return null;
  return Array.isArray(r) ? (r[0]?.nome ?? null) : (r.nome ?? null);
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

type Filtro = { chave: string; rotulo: string; casa: (i: string | null) => boolean };

/**
 * As intenções em cinco famílias, que é como a decisão de fato é tomada:
 * a letra manda, o número é detalhe. Filtrar por "E16" obrigaria a pessoa a
 * decorar códigos; filtrar por "Precisa de gente" é a pergunta que ela faz.
 */
const FAMILIAS: Filtro[] = [
  { chave: 'todas', rotulo: 'Todas', casa: () => true },
  { chave: 'A', rotulo: 'Perguntou algo', casa: (i) => (i || '').startsWith('A') },
  { chave: 'B', rotulo: 'Desabafo', casa: (i) => (i || '').startsWith('B') },
  { chave: 'C', rotulo: 'Entregou algo', casa: (i) => (i || '').startsWith('C') },
  { chave: 'D', rotulo: 'Não pede resposta', casa: (i) => (i || '').startsWith('D') },
  { chave: 'E', rotulo: 'Precisa de gente', casa: (i) => (i || '').startsWith('E') },
  { chave: 'COBRANCA', rotulo: 'Cobrança', casa: (i) => i === 'COBRANCA' },
];

/**
 * Aqui a regra da família se inverte de propósito.
 *
 * Cinco falas mudam o dia de quem lê e desapareciam dentro da letra:
 * reclamação e desistência viravam "Precisa de gente" junto com quem só
 * perguntou de prazo, e elogio virava "Desabafo". Quem abre este painel de
 * manhã não procura a letra E — procura quem falou em desistir.
 *
 * Por isso estes chips filtram por CÓDIGO, e vivem numa fileira separada: não
 * são um recorte das famílias, são o que não pode passar batido.
 */
const OLHO_NELAS: Filtro[] = [
  { chave: 'E20', rotulo: 'Desistência', casa: (i) => i === 'E20' },
  { chave: 'E16', rotulo: 'Reclamação', casa: (i) => i === 'E16' },
  { chave: 'E21', rotulo: 'Pede dinheiro', casa: (i) => i === 'E21' },
  { chave: 'E22', rotulo: 'Indicação', casa: (i) => i === 'E22' },
  { chave: 'B23', rotulo: 'Elogio', casa: (i) => i === 'B23' },
];

const FILTROS: Filtro[] = [...FAMILIAS, ...OLHO_NELAS];

/**
 * Abre a conversa do grupo no painel de baixo pra cima — o mesmo drawer do
 * resto do sistema, com histórico ao vivo, mídia e resposta. Nunca redireciona.
 */
function abrirConversa(groupJid: string, _instanceName: string | null, groupName: string | null) {
  openWhatsAppChatSheet({
    phone: groupJid,
    // SEM instância, de propósito. Em grupo, CADA instância nossa grava a sua
    // cópia da mesma mensagem: quem enviou grava `outbound`, as outras gravam a
    // MESMA mensagem como `inbound`. Fixar uma instância mostra um espelho só —
    // e se a resposta que saiu não tiver espelho naquela instância, ela
    // simplesmente não aparece, que foi o que aconteceu no PREV 291.
    // Sem filtro, todos os espelhos chegam em `dedupeMirroredMessages`, que
    // junta e decide o `direction` olhando o conjunto.
    instanceName: null,
    contactName: groupName,
    direction: 'bottom',
    forceSheet: true,
  });
}

/** Uma mensagem achada dentro da conversa de um grupo que está na fila. */
interface NaConversa {
  group_jid: string;
  group_name: string | null;
  quem_falou: string | null;
  direcao: string;
  quando: string;
  trecho: string;
  message_id: string;
  pendencia_id: string;
  intencao: string | null;
}

/** Linha comum das três listas que saem de dom_respostas_pendentes. */
function LinhaPendente({ p, onClick, rodape, marcada, onMarcar }: {
  p: Pendente; onClick?: () => void; rodape?: React.ReactNode;
  marcada?: boolean; onMarcar?: (v: boolean) => void;
}) {
  return (
    <Card className={onClick ? 'cursor-pointer hover:border-primary/40' : ''} onClick={onClick}>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-2">
          {onMarcar && (
            <span onClick={(e) => e.stopPropagation()} className="shrink-0">
              <Checkbox checked={!!marcada} onCheckedChange={(v) => onMarcar(v === true)} />
            </span>
          )}
          <p className="text-xs font-medium flex-1 truncate">{p.group_name || '—'}</p>
          {p.intencao && <Badge variant="outline" className="text-[10px]">{p.intencao}</Badge>}
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{quando(p.criado_em)}</span>
          <Button
            size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
            title="Abrir a conversa do grupo"
            onClick={(e) => { e.stopPropagation(); abrirConversa(p.group_jid, p.instance_name, p.group_name); }}
          >
            <MessagesSquare className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground truncate">
          <strong>{p.pergunta_autor || 'Cliente'}:</strong> {p.pergunta}
        </p>
        <p className="text-[11px] truncate">{p.resposta_final || p.resposta_sugerida}</p>
        {rodape}
      </CardContent>
    </Card>
  );
}

export function AtendenteVirtualPanel() {
  const [fila, setFila] = useState<Pendente[]>([]);
  const [enviadas, setEnviadas] = useState<Pendente[]>([]);
  const [comHumano, setComHumano] = useState<Pendente[]>([]);
  const [silenciadas, setSilenciadas] = useState<Decisao[]>([]);
  const [grupos, setGrupos] = useState<GrupoPiloto[]>([]);
  const [semFicha, setSemFicha] = useState<SemFicha[]>([]);
  const [vinculando, setVinculando] = useState<GrupoSemFicha | null>(null);
  const [leadAberto, setLeadAberto] = useState<string | null>(null);
  const [trocandoModo, setTrocandoModo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [familia, setFamilia] = useState('todas');
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  /**
   * Quando cada rascunho agendado vai sair, indexado por agendamento_id.
   *
   * Sem isto o painel mostrava botão de aprovar em cima de mensagem que já ia
   * sair sozinha — e quem lia concluía, com razão, que ainda precisava aprovar.
   */
  const [saiEm, setSaiEm] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<GrupoPiloto[]>([]);
  const [buscaConversa, setBuscaConversa] = useState('');
  const [nasConversas, setNasConversas] = useState<NaConversa[]>([]);
  const [buscandoConversas, setBuscandoConversas] = useState(false);
  const [totalGrupos, setTotalGrupos] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState<Pendente | null>(null);
  const [texto, setTexto] = useState('');
  const [regerando, setRegerando] = useState(false);

  /**
   * Refaz o áudio deste rascunho — e o ajuste que vier fica guardado na voz.
   *
   * Por que passa pela edge function em vez de escrever direto na tabela: a
   * RLS de `custom_voices` só deixa o DONO da voz mexer, e a sessão do painel
   * no banco externo é anônima. Quem tem permissão para gravar os ajustes é
   * a função, com a chave de serviço — e ela é o único lugar que fala com a
   * ElevenLabs de qualquer jeito.
   *
   * Manda SÓ o que mudou: mexer no tom não pode reescrever a velocidade que já
   * estava boa. Campo ausente no corpo = a função não toca nele.
   *
   * O áudio antigo NÃO é apagado do storage de propósito: se o ajuste novo
   * ficar pior, o arquivo anterior ainda existe para comparar.
   */
  const regerarAudio = useCallback(async (ajuste: AjusteDeFala = {}) => {
    if (!aberto || regerando) return;
    setRegerando(true);
    try {
      await ensureExternalSession();
      const { data: { session } } = await db.auth.getSession();
      if (!session?.access_token) throw new Error('sem sessão para chamar o atendente');
      const r = await fetch(externalFunctionUrl('dom-rascunho'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ regerar_audio: aberto.id, ...ajuste }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.regerado) throw new Error(j?.error || `falhou (HTTP ${r.status})`);

      // A tela tem que mudar AGORA, não na próxima recarga: quem está
      // escolhendo ritmo clica, ouve, clica de novo. Recarregar a lista
      // inteira entre um clique e outro quebra esse laço.
      const novo: Pendente = {
        ...aberto,
        audio_url: j.audio_url ?? null,
        audio_voz: j.audio_voz ?? null,
        audio_erro: j.audio_erro ?? null,
        audio_velocidade: typeof j.velocidade === 'number' ? j.velocidade : null,
        audio_estabilidade: typeof j.estabilidade === 'number' ? j.estabilidade : null,
        audio_estilo: typeof j.estilo === 'number' ? j.estilo : null,
        audio_pausa_ms: typeof j.pausa_ms === 'number' ? j.pausa_ms : null,
      };
      setAberto(novo);
      const trocar = (lista: Pendente[]) => lista.map(x => (x.id === novo.id ? novo : x));
      setFila(trocar); setEnviadas(trocar); setComHumano(trocar);

      if (j.audio_url) {
        toast.success(
          `Áudio refeito · ${Number(j.velocidade).toFixed(2)}x · tom ${nomeDoTom(j.estabilidade, j.estilo)}`
          + ` · ${rotuloDaPausa(j.pausa_ms)}`,
        );
      }
      else toast.error(`Não consegui gerar: ${j.audio_erro ?? 'sem motivo'}`);
    } catch (e) {
      toast.error(`Não consegui refazer o áudio: ${(e as Error).message}`);
    } finally {
      setRegerando(false);
    }
  }, [aberto, regerando]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      await ensureExternalSession();
      const sel = 'id, group_jid, instance_name, agendamento_id, audio_url, audio_voz, audio_erro, audio_velocidade, audio_estabilidade, audio_estilo, audio_pausa_ms, group_name, pergunta, pergunta_autor, resposta_sugerida, resposta_final, intencao, motivo_revisao, status, criado_em, enviado_em, atendente_id, contexto_usado, dom_atendentes(nome)';
      const [f, e, h, s, gp, sf] = await Promise.all([
        // "Na fila" é tudo que AINDA NÃO SAIU — inclusive o que alguém já
        // aprovou. Filtrar só por 'pendente' fazia a resposta aprovada sumir
        // das quatro abas: não estava mais na fila, nunca chegou em enviadas,
        // e ficava parada para sempre sem ninguém ver.
        dbAny.from('dom_respostas_pendentes').select(sel)
          .in('status', ['pendente', 'aprovada', 'editada']).is('atendente_id', null)
          .order('criado_em', { ascending: false }).limit(100),
        dbAny.from('dom_respostas_pendentes').select(sel)
          .eq('status', 'enviada')
          .order('enviado_em', { ascending: false }).limit(100),
        dbAny.from('dom_respostas_pendentes').select(sel)
          .not('atendente_id', 'is', null)
          .order('criado_em', { ascending: false }).limit(100),
        dbAny.from('dom_decisoes')
          .select('id, group_name, group_jid, intencao, decisao, motivo, pergunta, criado_em')
          .eq('decisao', 'silencio')
          .order('criado_em', { ascending: false }).limit(100),
        // Só os que RESPONDEM SOZINHOS. São mais de mil grupos no piloto:
        // desenhar mil chaves na tela não é configuração, é entulho. Quem
        // procura um grupo específico usa a busca abaixo.
        dbAny.from('dom_grupos_piloto')
          .select('group_jid, group_name, modo, ativo')
          .eq('ativo', true).eq('modo', 'automatico').order('group_name'),
        // Os que o assessor atende sem saber de quem são. Ordenados pelo
        // ESTRAGO já feito — quantas respostas saíram no escuro — e não por
        // nome: a fila de conserto começa por onde já custou caro.
        dbAny.from('vw_dom_grupo_sem_ficha')
          .select('group_jid, group_name, situacao, fichas_no_cadastro, rascunhos_no_escuro, ultimo_rascunho_em, o_que_fazer')
          .order('rascunhos_no_escuro', { ascending: false })
          .order('group_name'),
      ]);
      setFila((f.data as unknown as Pendente[]) || []);
      setEnviadas((e.data as unknown as Pendente[]) || []);
      setComHumano((h.data as unknown as Pendente[]) || []);
      setSilenciadas((s.data as unknown as Decisao[]) || []);
      setGrupos((gp.data as unknown as GrupoPiloto[]) || []);
      setSemFicha((sf.data as unknown as SemFicha[]) || []);

      const { count } = await dbAny.from('dom_grupos_piloto')
        .select('group_jid', { count: 'exact', head: true }).eq('ativo', true);
      setTotalGrupos(count || 0);

      const ids = [...((f.data as unknown as Pendente[]) || [])]
        .map(p => p.agendamento_id).filter(Boolean) as string[];
      if (ids.length) {
        const { data: ags } = await dbAny.from('whatsapp_mensagens_agendadas')
          .select('id, proximo_envio_at, ativo').in('id', ids);
        const mapa: Record<string, string> = {};
        for (const a of (ags as { id: string; proximo_envio_at: string; ativo: boolean }[]) || []) {
          if (a.ativo) mapa[a.id] = a.proximo_envio_at;
        }
        setSaiEm(mapa);
      } else {
        setSaiEm({});
      }
    } catch (err) {
      console.error('[AtendenteVirtualPanel]', err);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const decidir = async (p: Pendente, status: 'aprovada' | 'editada' | 'descartada') => {
    const { error } = await dbAny.from('dom_respostas_pendentes')
      .update({
        status,
        resposta_final: status === 'descartada' ? null : texto,
        revisado_em: new Date().toISOString(),
      } as never)
      .eq('id', p.id);
    if (error) { toast.error('Não salvou: ' + error.message); return; }
    setAberto(null);
    toast.success(status === 'descartada' ? 'Descartada' : 'Marcada como boa');
    carregar();
  };

  /**
   * Liga/desliga o "responde sozinho" de um grupo.
   *
   * `rascunho` → escreve e espera alguém aprovar (nada sai).
   * `automatico` → entra na fila de envio com 5 minutos de atraso; a janela é a
   * revisão, e a bolha tracejada na conversa deixa cancelar ou mandar na hora.
   */
  const trocarModo = async (g: GrupoPiloto, sozinho: boolean) => {
    setTrocandoModo(g.group_jid);
    const modo = sozinho ? 'automatico' : 'rascunho';
    const { error } = await dbAny.from('dom_grupos_piloto')
      .update({ modo } as never).eq('group_jid', g.group_jid);
    setTrocandoModo(null);
    if (error) { toast.error('Não salvou: ' + error.message); return; }
    setAchados(atual => atual.map(x => (x.group_jid === g.group_jid ? { ...x, modo } : x)));
    setGrupos(atual => sozinho
      ? (atual.some(x => x.group_jid === g.group_jid) ? atual : [...atual, { ...g, modo }])
      : atual.filter(x => x.group_jid !== g.group_jid));
    toast.success(sozinho
      ? `${g.group_name}: responde sozinho, 5 min depois de o cliente escrever`
      : `${g.group_name}: volta a só rascunhar`);
  };

  /**
   * Aprovar E mandar — o botão que faltava.
   *
   * "Marcar como boa" só marca: um rascunho de grupo em modo Rascunho não tinha
   * NENHUM caminho para chegar ao cliente, e ficava preso no painel para sempre.
   * Aqui ele entra na mesma fila de agendamento do resto, com os mesmos 5
   * minutos — então ainda dá para desistir pela bolha na conversa, e quem
   * escreveu no grupo nesse meio-tempo cancela o envio sozinho.
   */
  const porNaFilaDeEnvio = async (p: Pendente, corpo: string) => {
    const quando = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    // QUEM FALOU POR VOZ RECEBE VOZ. O áudio já estava pronto e tocava aqui do
    // lado — o que faltava era o cano: até 08/09/2026 a fila só sabia carregar
    // texto, então a resposta falada morria no painel e a cliente que mandou
    // três áudios recebeu parágrafo (Caso 09, 07/09/2026).
    //
    // Vai SÓ a nota de voz, sem o texto atrás: mandar os dois é a mesma coisa
    // dita duas vezes. O texto continua gravado em `mensagem`, que é o registro
    // do que foi dito e o que a bolha da conversa mostra.
    //
    // Áudio editado NÃO sai: se a pessoa mexeu no texto, a fala gravada não é
    // mais essa resposta. Nesse caso sai o texto, e o botão avisa antes.
    // `audio_erro` COM url é o áudio que ficou pela metade (teto de fala): ele
    // soa completo e omite o final, o que é pior que mandar escrito.
    const falaVale = !!p.audio_url && !p.audio_erro
      && corpo === (p.resposta_final || p.resposta_sugerida);
    const { data: ag, error: errAg } = await dbAny.from('whatsapp_mensagens_agendadas').insert({
      phone: p.group_jid,
      instance_name: p.instance_name,
      contact_name: p.group_name,
      mensagem: corpo,
      mensagem_original: corpo,
      media_url: falaVale ? p.audio_url : null,
      media_type: falaVale ? 'audio/mpeg' : null,
      media_ptt: falaVale,
      proximo_envio_at: quando,
      repeticao: 'nenhuma',
      intervalo: 1,
      unidade: 'dias',
      pular_se_responder: true,
      criado_por_nome: 'Atendente virtual (aprovado à mão)',
    } as never).select('id').maybeSingle();
    if (errAg) throw errAg;

    const { error } = await dbAny.from('dom_respostas_pendentes')
      .update({
        resposta_final: corpo,
        agendamento_id: (ag as { id: string }).id,
        revisado_em: new Date().toISOString(),
        motivo_revisao: 'aprovado à mão — sai em 5 min',
      } as never)
      .eq('id', p.id);
    if (error) throw error;
  };

  const aprovarEEnviar = async (p: Pendente) => {
    setEnviando(true);
    try {
      await porNaFilaDeEnvio(p, texto);
      setAberto(null);
      toast.success('Na fila — sai em 5 minutos, dá para cancelar pela conversa');
      carregar();
    } catch (e) {
      toast.error('Não consegui pôr na fila: ' + ((e as Error)?.message || 'erro'));
    } finally {
      setEnviando(false);
    }
  };

  /**
   * Ação em lote sobre o que estiver marcado. Uma fila de trinta rascunhos não
   * se resolve abrindo trinta painéis.
   */
  const emLote = async (acao: 'enviar' | 'descartar') => {
    const alvos = fila.filter(p => marcadas.has(p.id));
    if (alvos.length === 0) return;
    setEnviando(true);
    let ok = 0;
    const falhas: string[] = [];
    for (const p of alvos) {
      try {
        if (acao === 'enviar') {
          await porNaFilaDeEnvio(p, p.resposta_final || p.resposta_sugerida);
        } else {
          const { error } = await dbAny.from('dom_respostas_pendentes')
            .update({ status: 'descartada', revisado_em: new Date().toISOString() } as never)
            .eq('id', p.id);
          if (error) throw error;
        }
        ok++;
      } catch (e) {
        falhas.push(`${p.group_name}: ${(e as Error)?.message || 'erro'}`);
      }
    }
    setEnviando(false);
    setMarcadas(new Set());
    if (ok) {
      toast.success(acao === 'enviar'
        ? `${ok} na fila — saem em 5 minutos`
        : `${ok} descartada(s)`);
    }
    // Falha silenciosa em lote é o pior tipo: a pessoa acha que mandou tudo.
    if (falhas.length) toast.error(`${falhas.length} não deu: ${falhas[0]}`);
    carregar();
  };

  /** Desistir de um envio que já está agendado — o mesmo "tirar da fila" da conversa. */
  const tirarDaFila = async (p: Pendente) => {
    if (!p.agendamento_id) return;
    setEnviando(true);
    try {
      const { error } = await dbAny.from('whatsapp_mensagens_agendadas')
        .update({
          ativo: false,
          cancelado_em: new Date().toISOString(),
          cancelado_por_nome: 'Tirado da fila no painel',
          encerrado_motivo: 'cancelada',
        } as never)
        .eq('id', p.agendamento_id);
      if (error) throw error;
      await dbAny.from('dom_respostas_pendentes')
        .update({ motivo_revisao: 'tirado da fila à mão — não vai sair' } as never)
        .eq('id', p.id);
      setAberto(null);
      toast.success('Tirado da fila — não vai sair');
      carregar();
    } catch (e) {
      toast.error('Não consegui tirar: ' + ((e as Error)?.message || 'erro'));
    } finally {
      setEnviando(false);
    }
  };

  /** Procurar um grupo entre os mais de mil, para ligar ou desligar. */
  /**
   * Busca dentro das CONVERSAS dos grupos que têm rascunho esperando revisão.
   *
   * É outra pergunta da busca por nome de grupo logo acima: aquela procura um
   * grupo para LIGAR o atendente; esta procura o que foi DITO nos grupos que já
   * estão na fila, para quem precisa saber do que se falou antes de aprovar a
   * resposta.
   *
   * O recorte pelos grupos da fila é o que deixa isso barato: whatsapp_messages
   * tem 1,7 milhão de linhas e 7,1 GB, e a RPC olha só os ~77 grupos com
   * rascunho pendente (200 ms, sem índice novo). A deduplicação por messageid
   * mora no banco — a mesma mensagem de grupo é gravada uma vez por instância
   * da casa que está lá dentro, e sem isso a mesma frase voltaria 4 vezes.
   */
  const procurarNasConversas = async (termo: string) => {
    setBuscaConversa(termo);
    const t = termo.trim();
    if (t.length < 3) { setNasConversas([]); return; }
    setBuscandoConversas(true);
    try {
      const { data, error } = await (dbAny as any)
        .rpc('buscar_nas_conversas_da_fila', { p_termo: t, p_limite: 50 });
      if (error) throw error;
      setNasConversas((data as NaConversa[]) || []);
    } catch (e: any) {
      toast.error('Falha ao buscar nas conversas: ' + (e?.message || ''));
      setNasConversas([]);
    } finally {
      setBuscandoConversas(false);
    }
  };

  const procurar = async (termo: string) => {
    setBusca(termo);
    if (termo.trim().length < 3) { setAchados([]); return; }
    const { data } = await dbAny.from('dom_grupos_piloto')
      .select('group_jid, group_name, modo, ativo')
      .eq('ativo', true).ilike('group_name', `%${termo.trim()}%`)
      .order('group_name').limit(30);
    setAchados((data as unknown as GrupoPiloto[]) || []);
  };

  const marcar = (id: string, v: boolean) => {
    setMarcadas(atual => {
      const novo = new Set(atual);
      if (v) novo.add(id); else novo.delete(id);
      return novo;
    });
  };

  /** O filtro de intenção vale para as três listas que têm intenção. */
  const casa = FILTROS.find(f => f.chave === familia) ?? FILTROS[0];
  const filaF = fila.filter(p => casa.casa(p.intencao));
  const enviadasF = enviadas.filter(p => casa.casa(p.intencao));
  const comHumanoF = comHumano.filter(p => casa.casa(p.intencao));
  const silenciadasF = silenciadas.filter(d => casa.casa(d.intencao));

  /**
   * Quanto cada chip tem, somando as quatro listas que carregam intenção.
   *
   * Sem o número, chip zerado e chip cheio são idênticos até você clicar — e a
   * pergunta "cadê a desistência?" não tem resposta na tela. Com o número, zero
   * é uma resposta: ninguém falou nisso no que está carregado aqui.
   */
  const contagens = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const f of FILTROS) {
      mapa[f.chave] =
        fila.filter(p => f.casa(p.intencao)).length +
        enviadas.filter(p => f.casa(p.intencao)).length +
        comHumano.filter(p => f.casa(p.intencao)).length +
        silenciadas.filter(d => f.casa(d.intencao)).length;
    }
    return mapa;
  }, [fila, enviadas, comHumano, silenciadas]);

  const vazio = (txt: string) => <p className="text-xs text-muted-foreground py-6 text-center">{txt}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] text-muted-foreground flex-1">
          O que o atendente virtual fez.{' '}
          {grupos.length === 0
            ? `Nenhum dos ${totalGrupos} grupos responde sozinho ainda — tudo fica esperando revisão e nada sai para o cliente.`
            : `${grupos.length} de ${totalGrupos} grupos respondem sozinhos: a resposta entra na fila e sai 5 minutos depois, se ninguém escrever antes.`}
        </p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={carregar} disabled={carregando}>
          {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-[11px] font-medium">Quem responde sozinho</p>
          <p className="text-[10px] text-muted-foreground">
            Ligado, ele responde sozinho 5 minutos depois de o cliente escrever. A mensagem
            aparece na conversa como bolha tracejada com cronômetro — dá para tirar da fila
            ou mandar na hora. Se alguém escrever no grupo antes, ela não sai.
            {' '}Os outros continuam trabalhando em modo rascunho: escrevem e enchem a fila,
            sem nada chegar no cliente.
          </p>

          <div className="space-y-1 pt-1">
            {grupos.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic py-1">
                Nenhum grupo responde sozinho ainda.
              </p>
            )}
            {grupos.map(g => (
              <div key={g.group_jid} className="flex items-center gap-2">
                <span className="text-[11px] flex-1 truncate">{g.group_name || g.group_jid}</span>
                <span className="text-[10px] text-emerald-700 whitespace-nowrap">responde sozinho</span>
                <Switch
                  checked
                  disabled={trocandoModo === g.group_jid}
                  onCheckedChange={(v) => trocarModo(g, v)}
                />
              </div>
            ))}
          </div>

          <div className="pt-2 border-t space-y-1">
            <Input
              value={busca}
              onChange={(e) => procurar(e.target.value)}
              placeholder={`Procurar entre os ${totalGrupos} grupos para ligar…`}
              className="h-7 text-xs"
            />
            {busca.trim().length >= 3 && achados.length === 0 && (
              <p className="text-[10px] text-muted-foreground py-1">Nenhum grupo com esse nome.</p>
            )}
            {achados.map(g => (
              <div key={g.group_jid} className="flex items-center gap-2">
                <span className="text-[11px] flex-1 truncate">{g.group_name || g.group_jid}</span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {g.modo === 'automatico' ? 'responde sozinho' : 'só rascunha'}
                </span>
                <Switch
                  checked={g.modo === 'automatico'}
                  disabled={trocandoModo === g.group_jid}
                  onCheckedChange={(v) => trocarModo(g, v)}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground mr-1">Intenção:</span>
          {FAMILIAS.map(f => (
            <Button
              key={f.chave}
              size="sm"
              variant={familia === f.chave ? 'default' : 'outline'}
              className="h-6 px-2 text-[10px]"
              onClick={() => { setFamilia(f.chave); setMarcadas(new Set()); }}
            >
              {f.rotulo}
              {f.chave !== 'todas' && (
                <span className="ml-1 opacity-60">{contagens[f.chave] ?? 0}</span>
              )}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground mr-1">Olho nelas:</span>
          {OLHO_NELAS.map(f => (
            <Button
              key={f.chave}
              size="sm"
              variant={familia === f.chave ? 'default' : 'outline'}
              className="h-6 px-2 text-[10px]"
              onClick={() => { setFamilia(f.chave); setMarcadas(new Set()); }}
            >
              {f.rotulo}
              <span className="ml-1 opacity-60">{contagens[f.chave] ?? 0}</span>
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          As de cima são as cinco famílias — a letra que decide o que o Dom faz. As de
          baixo são falas específicas que não podem passar batido, e o número diz quantas
          existem no que está carregado nas quatro abas.
        </p>
      </div>

      <Tabs defaultValue="fila">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="fila" className="text-xs gap-1">
            <Inbox className="h-3.5 w-3.5" />Na fila
            {filaF.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{filaF.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="enviadas" className="text-xs gap-1">
            <Send className="h-3.5 w-3.5" />Enviadas
            {enviadasF.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{enviadasF.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="humano" className="text-xs gap-1">
            <UserCheck className="h-3.5 w-3.5" />Com humano
            {comHumanoF.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{comHumanoF.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="silencio" className="text-xs gap-1">
            <VolumeX className="h-3.5 w-3.5" />Silenciadas
            {silenciadasF.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{silenciadasF.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="conversas" className="text-xs gap-1">
            <Search className="h-3.5 w-3.5" />Nas conversas
          </TabsTrigger>
          {/* A sexta é a que dói: grupos que ele atende sem saber de quem são. */}
          <TabsTrigger value="semficha" className="text-xs gap-1">
            <UserX className="h-3.5 w-3.5" />Sem ficha
            {semFicha.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{semFicha.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fila" className="space-y-2 pt-3">
          {filaF.length > 0 && (
            <div className="flex items-center gap-2 pb-1">
              <Checkbox
                checked={marcadas.size > 0 && marcadas.size === filaF.length}
                onCheckedChange={(v) => setMarcadas(v === true ? new Set(filaF.map(p => p.id)) : new Set())}
              />
              <span className="text-[10px] text-muted-foreground flex-1">
                {marcadas.size > 0 ? `${marcadas.size} marcada(s)` : 'Marcar todas'}
              </span>
              {marcadas.size > 0 && (
                <>
                  <Button size="sm" className="h-6 px-2 text-[10px] gap-1"
                    disabled={enviando} onClick={() => emLote('enviar')}>
                    {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <SendHorizonal className="h-3 w-3" />}
                    Enviar as marcadas
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1"
                    disabled={enviando} onClick={() => emLote('descartar')}>
                    <X className="h-3 w-3" />Descartar
                  </Button>
                </>
              )}
            </div>
          )}
          {filaF.length === 0 && vazio('Nada esperando revisão.')}
          {filaF.map(p => (
            <LinhaPendente key={p.id} p={p}
              marcada={marcadas.has(p.id)}
              onMarcar={(v) => marcar(p.id, v)}
              onClick={() => { setAberto(p); setTexto(p.resposta_final || p.resposta_sugerida); }}
              rodape={
                p.audio_url ? (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Volume2 className="h-3 w-3" />vai como nota de voz — abra para escutar antes
                  </p>
                ) : p.agendamento_id && saiEm[p.agendamento_id] ? (
                  <p className="text-[10px] text-emerald-700 font-medium">
                    Vai sozinha — <ContagemAteEnvio quando={saiEm[p.agendamento_id]} />
                  </p>
                ) : p.status !== 'pendente' ? (
                  <p className="text-[10px] text-amber-700">
                    Marcada como boa, mas ainda não saiu — abra e use "Aprovar e enviar".
                  </p>
                ) : p.motivo_revisao ? (
                  <p className="text-[10px] text-amber-700 truncate">{p.motivo_revisao}</p>
                ) : null
              } />
          ))}
        </TabsContent>

        <TabsContent value="conversas" className="space-y-2 pt-3">
          <Input
            value={buscaConversa}
            onChange={(e) => procurarNasConversas(e.target.value)}
            placeholder="Procurar no que foi dito nos grupos que estão esperando revisão…"
            className="h-8 text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            Procura só dentro dos grupos com rascunho na fila — é o recorte que deixa a busca
            rápida. Cada resultado abre a conversa por cima, no ponto em que a frase apareceu.
          </p>

          {buscandoConversas && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 py-2">
              <Loader2 className="h-3 w-3 animate-spin" />procurando…
            </p>
          )}
          {!buscandoConversas && buscaConversa.trim().length > 0 && buscaConversa.trim().length < 3 && (
            <p className="text-[10px] text-muted-foreground py-2">Digite ao menos 3 letras.</p>
          )}
          {!buscandoConversas && buscaConversa.trim().length >= 3 && nasConversas.length === 0 && (
            <p className="text-[10px] text-muted-foreground py-2">
              Ninguém falou isso nos grupos que estão na fila.
            </p>
          )}

          {nasConversas.map(r => (
            <button
              key={r.message_id}
              onClick={() => openWhatsAppChatSheet({
                phone: r.group_jid,
                contactName: r.group_name,
                direction: 'bottom',
                forceSheet: true,
              })}
              className="w-full text-left rounded-md border p-2 hover:bg-muted/50 transition-colors space-y-1"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium truncate flex-1">
                  {r.group_name || r.group_jid}
                </span>
                {r.intencao && (
                  <Badge variant="outline" className="h-4 px-1 text-[9px] shrink-0">{r.intencao}</Badge>
                )}
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(r.quando).toLocaleDateString('pt-BR')}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{r.trecho}</p>
              <p className="text-[10px] text-muted-foreground/80">
                {r.direcao === 'outbound' ? 'nós' : (r.quem_falou || 'alguém do grupo')}
              </p>
            </button>
          ))}
        </TabsContent>

        <TabsContent value="enviadas" className="space-y-2 pt-3">
          {enviadasF.length === 0 && vazio('Nenhuma mensagem chegou ao cliente ainda.')}
          {/* Clicável como na fila, e pelo mesmo motivo: conferir de onde saiu a
              resposta só vale se der para conferir DEPOIS que ela saiu. Sem
              isto, a única aba onde a pergunta "em que ele se baseou?" aparece
              de verdade — a das mensagens que o cliente já leu — era a única
              que não respondia. O painel abre em leitura: o que saiu, saiu. */}
          {enviadasF.map(p => (
            <LinhaPendente key={p.id} p={p}
              onClick={() => { setAberto(p); setTexto(p.resposta_final || p.resposta_sugerida); }}
              rodape={<p className="text-[10px] text-emerald-700">
                Enviada em {p.enviado_em ? quando(p.enviado_em) : '—'}
              </p>} />
          ))}
        </TabsContent>

        <TabsContent value="humano" className="space-y-2 pt-3">
          {comHumanoF.length === 0 && vazio('Nada foi encaminhado para atendente.')}
          {comHumanoF.map(p => (
            <LinhaPendente key={p.id} p={p}
              onClick={() => { setAberto(p); setTexto(p.resposta_final || p.resposta_sugerida); }}
              rodape={<p className="text-[10px] text-blue-700">
                Para {nomeDoAtendente(p) || 'atendente'} · {p.motivo_revisao}
              </p>} />
          ))}
        </TabsContent>

        <TabsContent value="silencio" className="space-y-2 pt-3">
          {silenciadasF.length === 0 && vazio('Ele ainda não decidiu calar em nenhuma conversa.')}
          {silenciadasF.map(d => (
            <Card key={d.id}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium flex-1 truncate">{d.group_name || d.group_jid}</p>
                  {d.intencao && <Badge variant="outline" className="text-[10px]">{d.intencao}</Badge>}
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{quando(d.criado_em)}</span>
                  <Button
                    size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
                    title="Abrir a conversa do grupo"
                    onClick={() => abrirConversa(d.group_jid, null, d.group_name)}
                  >
                    <MessagesSquare className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  <strong>Cliente:</strong> {d.pergunta}
                </p>
                <p className="text-[10px] text-muted-foreground italic">Não respondeu — {d.motivo}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── Sem ficha ──────────────────────────────────────────────────
            Não é lista de erro do assessor: é fila de cadastro. Ele responde
            esses grupos sem UM dado do processo, e continuará respondendo até
            alguém ligar o grupo à ficha. O número de respostas já escritas no
            escuro fica visível de propósito — é o custo de adiar. */}
        <TabsContent value="semficha" className="space-y-2 pt-3">
          {semFicha.length === 0
            ? vazio('Todo grupo do piloto tem ficha de cliente. Nada a consertar aqui.')
            : (
              <p className="text-[11px] text-muted-foreground">
                {semFicha.length} grupos que o assessor atende sem achar a ficha do cliente.
                Nesses, a resposta sai sem movimentação, sem peça e sem a atividade da equipe —
                e o painel de fontes mostra "(0)" por falta de ficha, não por processo parado.
              </p>
            )}
          {semFicha.map(g => (
            <Card key={g.group_jid}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium flex-1 truncate">{g.group_name || g.group_jid}</p>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${g.situacao === 'ambiguo'
                      ? 'border-amber-400 text-amber-700'
                      : 'border-rose-300 text-rose-700'}`}
                  >
                    {g.situacao === 'ambiguo' ? `${g.fichas_no_cadastro} fichas` : 'sem ficha'}
                  </Badge>
                  <Button
                    size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
                    title="Abrir a conversa do grupo"
                    onClick={() => abrirConversa(g.group_jid, null, g.group_name)}
                  >
                    <MessagesSquare className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {/* O conserto fica no mesmo cartão do diagnóstico. Ler o problema
                    e ter que procurar onde resolver em outra tela é como o painel
                    ficou nove meses: informação sem saída. */}
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => setVinculando({
                    group_jid: g.group_jid,
                    group_name: g.group_name,
                    situacao: g.situacao,
                    fichas_no_cadastro: g.fichas_no_cadastro,
                  })}
                >
                  <Link2 className="h-3 w-3" />
                  {g.situacao === 'ambiguo' ? 'Escolher a ficha' : 'Ligar a uma ficha'}
                </Button>
                {g.o_que_fazer && (
                  <p className="text-[11px] text-muted-foreground">{g.o_que_fazer}</p>
                )}
                {g.rascunhos_no_escuro > 0 && (
                  <p className="text-[10px] text-rose-700 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {g.rascunhos_no_escuro === 1
                      ? '1 resposta já foi escrita sem o processo.'
                      : `${g.rascunhos_no_escuro} respostas já foram escritas sem o processo.`}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Detalhe em painel lateral — nunca redireciona, nunca abre aba nova. */}
      <Sheet open={!!aberto} onOpenChange={o => !o && setAberto(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle className="text-sm">{aberto?.group_name || 'Rascunho'}</SheetTitle></SheetHeader>
          {aberto && (
            <div className="space-y-3 mt-4">
              <div className="space-y-1">
                <Label className="text-xs">O cliente escreveu</Label>
                <p className="text-xs bg-muted rounded p-2 whitespace-pre-wrap">{aberto.pergunta}</p>
                <p className="text-[10px] text-muted-foreground">
                  {aberto.pergunta_autor} · intenção {aberto.intencao || '—'} · {quando(aberto.criado_em)}
                </p>
              </div>
              {aberto.motivo_revisao && (
                <div className="space-y-1">
                  <Label className="text-xs">Por que parou aqui</Label>
                  <p className="text-[11px] text-amber-700">{aberto.motivo_revisao}</p>
                </div>
              )}
              <div className="space-y-1">
                {aberto.status === 'enviada' ? (
                  <>
                    {/* Já chegou ao cliente: editar aqui não muda o que ele leu,
                        só mentiria sobre o que foi dito. */}
                    <Label className="text-xs">O que foi enviado</Label>
                    <p className="text-xs bg-muted rounded p-2 whitespace-pre-wrap">
                      {aberto.resposta_final || aberto.resposta_sugerida}
                    </p>
                  </>
                ) : (
                  <>
                    <Label className="text-xs">Resposta sugerida (dá para editar)</Label>
                    <Textarea className="text-xs min-h-[180px]" value={texto} onChange={e => setTexto(e.target.value)} />
                  </>
                )}
              </div>

              {/* As fontes que geraram a resposta. Vêm DEPOIS dela de propósito:
                  quem revisa lê a resposta primeiro e depois confere contra o
                  que a máquina tinha na mão — não o contrário, que enviesaria a
                  leitura. */}
              <div className="space-y-1">
                <Label className="text-xs">De onde saiu (para conferir)</Label>
                <FontesDaResposta contexto={aberto.contexto_usado} />
              </div>

              {/* O cliente falou por áudio, então ele gravou a resposta também.
                  Isto NÃO foi enviado e não vai ser: é só para escutar. */}
              {(aberto.audio_url || aberto.audio_erro) && (
                <div className="space-y-1 rounded border border-dashed p-2">
                  <Label className="text-xs flex items-center gap-1">
                    <Volume2 className="h-3.5 w-3.5" />
                    Como ficaria falado
                    {aberto.audio_voz && (
                      <span className="font-normal text-muted-foreground">· voz {aberto.audio_voz}</span>
                    )}
                  </Label>
                  {aberto.audio_url
                    ? <audio controls src={aberto.audio_url} className="w-full h-8" />
                    : <p className="text-[11px] text-destructive">Não consegui gerar: {aberto.audio_erro}</p>}
                  {/* Áudio PRONTO e mesmo assim com aviso = ele foi cortado. Antes
                      este caso ficava invisível: existindo url, o erro não era
                      mostrado, e um áudio pela metade parecia inteiro. */}
                  {aberto.audio_url && aberto.audio_erro && (
                    <p className="text-[11px] text-amber-700 flex items-start gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      {aberto.audio_erro}
                    </p>
                  )}
                  {/* ESCOLHER O RITMO OUVINDO, que é o único jeito de escolher.
                      Cada botão regera o áudio naquela velocidade E guarda ela
                      na voz — então o que você acertar aqui vale para todos os
                      próximos áudios desta voz, não só para este. Voz diferente
                      pede ritmo diferente: quem fala pausado na gravação
                      original soa arrastado a 0,90x. */}
                  {/* Refazer a fala só faz sentido antes de sair: a resposta
                      que já chegou ao cliente não muda de voz nem de ritmo. */}
                  {aberto.status !== 'enviada' && (
                  <div className="space-y-2.5 border-t pt-2">

                    {/* VELOCIDADE — o ritmo. Já existia desde 07/09/2026. */}
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">
                        Velocidade da fala
                        {aberto.audio_velocidade != null && (
                          <span className="ml-1 font-normal">
                            · este áudio saiu a <strong>{Number(aberto.audio_velocidade).toFixed(2)}x</strong>
                          </span>
                        )}
                        {aberto.audio_velocidade == null && aberto.audio_url && (
                          <span className="ml-1 font-normal">· gerado antes deste ajuste (1,10x)</span>
                        )}
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {VELOCIDADES.map(v => (
                          <Button
                            key={v}
                            size="sm"
                            variant={Number(aberto.audio_velocidade) === v ? 'default' : 'outline'}
                            className="h-7 px-2 text-[11px] tabular-nums"
                            disabled={regerando}
                            onClick={() => regerarAudio({ velocidade: v })}>
                            {v.toFixed(2).replace('.', ',')}x
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* TOM — a expressividade, NÃO a altura da voz.
                        Grave/agudo não existe na API da ElevenLabs; isso vem da
                        gravação que clonou a voz e só muda regravando. O que
                        muda aqui é o quanto a voz varia ao falar. */}
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">
                        Tom da fala
                        <span className="ml-1 font-normal">
                          · este áudio saiu <strong>{nomeDoTom(aberto.audio_estabilidade, aberto.audio_estilo)}</strong>
                          {aberto.audio_estabilidade == null && aberto.audio_url && ' (gerado antes deste ajuste)'}
                        </span>
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {TONS.map(t => (
                          <Button
                            key={t.nome}
                            size="sm"
                            title={t.ajuda}
                            variant={nomeDoTom(aberto.audio_estabilidade, aberto.audio_estilo) === t.nome ? 'default' : 'outline'}
                            className="h-7 px-2 text-[11px]"
                            disabled={regerando}
                            onClick={() => regerarAudio({ estabilidade: t.estabilidade, estilo: t.estilo })}>
                            {t.nome}
                          </Button>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Tom aqui é o quanto a voz <strong>varia</strong>, não grave ou agudo — a altura
                        da voz vem da gravação que clonou ela e não tem ajuste.
                      </p>
                    </div>

                    {/* PAUSA — respiro em cada quebra de linha da resposta. */}
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">
                        Pausa entre as linhas
                        <span className="ml-1 font-normal">
                          · este áudio saiu <strong>{rotuloDaPausa(aberto.audio_pausa_ms)}</strong>
                        </span>
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {PAUSAS.map(p => (
                          <Button
                            key={p.ms}
                            size="sm"
                            variant={Number(aberto.audio_pausa_ms ?? 0) === p.ms ? 'default' : 'outline'}
                            className="h-7 px-2 text-[11px]"
                            disabled={regerando}
                            onClick={() => regerarAudio({ pausa_ms: p.ms })}>
                            {p.rotulo}
                          </Button>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        A pausa entra em <strong>cada quebra de linha</strong> da resposta — é onde quem
                        escreveu já quis um respiro. Esta é nova: escute uma vez com pausa ligada
                        antes de confiar nela.
                      </p>
                    </div>

                    <Button
                      size="sm" variant="outline" className="w-full h-7 text-[11px] gap-1"
                      disabled={regerando}
                      onClick={() => regerarAudio()}>
                      {regerando
                        ? <><Loader2 className="h-3 w-3 animate-spin" />Gravando…</>
                        : <><RefreshCw className="h-3 w-3" />Refazer com o texto de agora</>}
                    </Button>
                    <p className="text-[10px] text-muted-foreground">
                      O botão de cima refaz falando o texto que está no campo <strong>já salvo</strong> —
                      se você editou a resposta e ainda não salvou, o áudio sai com o texto antigo.
                      Qualquer ajuste escolhido aqui passa a valer para todos os próximos áudios
                      desta voz{aberto.audio_voz ? ` (${aberto.audio_voz})` : ''}, não só para este.
                    </p>
                  </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {aberto.status === 'enviada'
                      ? 'Esta é a fala que acompanhou a resposta.'
                      : aberto.audio_erro
                        ? 'Esta fala está incompleta, então ela NÃO sai: vai o texto. Refaça o áudio para poder mandar falado.'
                        : texto === (aberto.resposta_final || aberto.resposta_sugerida)
                          ? 'É ISTO que chega no cliente: só a nota de voz, sem o texto atrás. Escute antes de aprovar.'
                          : 'Você editou o texto, então esta fala não é mais esta resposta — vai sair o TEXTO. Para mandar falado, use "Refazer com o texto de agora" depois de salvar.'}
                  </p>
                </div>
              )}
              <Button size="sm" variant="outline" className="w-full text-xs gap-1"
                onClick={() => abrirConversa(aberto.group_jid, aberto.instance_name, aberto.group_name)}>
                <MessagesSquare className="h-3.5 w-3.5" />Abrir a conversa do grupo
              </Button>
              {aberto.status === 'enviada' ? (
                // Não há decisão a tomar sobre o que já foi lido. Mostrar
                // "Aprovar e enviar" aqui criaria uma segunda cópia da mesma
                // resposta na fila — o botão certo é nenhum.
                <div className="rounded border border-emerald-600/40 bg-emerald-600/5 p-2 text-center">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    Já chegou ao cliente{aberto.enviado_em ? ` em ${quando(aberto.enviado_em)}` : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Esta tela é só para conferir o que foi dito e de onde saiu.
                  </p>
                </div>
              ) : aberto.agendamento_id && saiEm[aberto.agendamento_id] ? (
                // Já está indo. Mostrar "aprovar" aqui seria mentira — e pior,
                // faria a pessoa achar que a mensagem depende dela.
                <>
                  <div className="rounded border border-emerald-600/40 bg-emerald-600/5 p-2 text-center">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Esta resposta vai sozinha — <ContagemAteEnvio quando={saiEm[aberto.agendamento_id]} />
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Você não precisa aprovar. Ela some sozinha se alguém escrever no grupo antes.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="w-full text-xs gap-1"
                    disabled={enviando} onClick={() => tirarDaFila(aberto)}>
                    {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    Tirar da fila — não deixar sair
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" className="w-full text-xs gap-1"
                    disabled={enviando || !texto.trim()}
                    onClick={() => aprovarEEnviar(aberto)}>
                    {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizonal className="h-3.5 w-3.5" />}
                    {aberto.audio_url && !aberto.audio_erro && texto === (aberto.resposta_final || aberto.resposta_sugerida)
                      ? 'Aprovar e mandar em áudio (sai em 5 min)'
                      : 'Aprovar e enviar (sai em 5 min)'}
                  </Button>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs gap-1 flex-1"
                      onClick={() => decidir(aberto, texto === aberto.resposta_sugerida ? 'aprovada' : 'editada')}>
                      <Check className="h-3.5 w-3.5" />Só marcar como boa
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1"
                      onClick={() => decidir(aberto, 'descartada')}>
                      <X className="h-3.5 w-3.5" />Descartar
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Esta não vai sair sozinha — ou é de antes de o grupo passar a responder
                    sozinho, ou é assunto que precisa de gente (reclamação, dinheiro, prazo), ou o
                    próprio agente pediu revisão. <strong>Aprovar e enviar</strong> põe na fila com
                    5 minutos de atraso, e ainda dá para cancelar pela conversa.
                  </p>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Escolher a ficha do grupo. Irmão do Sheet acima, não filho — é o
          arranjo que o ProtocolosListaSheet já usa para empilhar painel sobre
          painel sem que um vire filho do outro e feche junto. */}
      <VincularFichaSheet
        grupo={vinculando}
        onOpenChange={o => { if (!o) setVinculando(null); }}
        onVinculado={leadId => {
          // Fecha o seletor e abre a ficha por cima: ligar o grupo é metade do
          // caminho, e quem acabou de ligar quase sempre quer conferir o caso e
          // os processos em seguida — que é onde esta história começou.
          setVinculando(null);
          setLeadAberto(leadId);
          void carregar();
        }}
      />

      {/* A ficha do cliente: lead, caso e processos. É o LeadEditDialog de
          sempre, por id — nada de segunda versão do formulário do lead. */}
      {leadAberto && (
        <Suspense fallback={null}>
          <LeadPainelPorId leadId={leadAberto} onClose={() => setLeadAberto(null)} />
        </Suspense>
      )}
    </div>
  );
}
