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
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
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
import { Inbox, Send, UserCheck, VolumeX, RefreshCw, Check, X, Loader2, MessagesSquare, SendHorizonal, Volume2, Search, AlertTriangle, UserX, Link2, ClipboardList } from 'lucide-react';
import { openWhatsAppChatSheet } from '@/lib/whatsappChatSheet';
import { remapToCloud } from '@/integrations/supabase/uuid-remap';
import type { ActivityDraft } from '@/components/activities/ActivityFullSheet';
import { ContagemAteEnvio } from '@/components/whatsapp/ContagemAteEnvio';

const dbAny = db as unknown as SupabaseClient;

/** O agente Dom em `wjia_command_shortcuts` — o mesmo id que a `dom-rascunho` usa. */
const DOM_AGENT_ID = 'd6ad8eee-d6a3-452c-b852-b94ef8dd54bf';

/**
 * O ritmo do modo automático, como está configurado AGORA.
 *
 * A tela dizia "5 minutos" em três lugares, escrito à mão, de quando o atraso
 * era constante no código. Agora ele é editável na configuração do agente — e
 * um texto que promete cinco quando o banco diz três é pior que texto nenhum:
 * quem lê decide com base nele e descobre a diferença pelo cliente reclamando.
 */
const RITMO_PADRAO = { primeira: 3, seguinte: 2 };

/** O formulario unico do lead, por id. Lazy: ele arrasta o LeadEditDialog e o
 *  useLeads junto, e ninguem precisa disso ate clicar em vincular. */
const LeadPainelPorId = lazy(() => import('@/components/leads/LeadPainelPorId'));

/** O formulario COMPLETO de atividade, o mesmo da esteira. Lazy pelo mesmo
 *  motivo do painel do lead: ele so aparece se alguem responder "sim" a
 *  pergunta da atividade, e ate la nao ha razao para carrega-lo. */
const ActivityFullSheet = lazy(() => import('@/components/activities/ActivityFullSheet')
  .then(m => ({ default: m.ActivityFullSheet })));

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
  /** A ficha do grupo. Nulo em 31 dos rascunhos — e sem ela nao ha atividade
   *  para criar: `createActivity` exige vinculo com lead, caso ou processo. */
  lead_id: string | null;
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
  dom_atendentes?: { nome: string; user_id: string | null }[] | { nome: string; user_id: string | null } | null;
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

/**
 * A FAIXA ENCOLHEU EM 08/09/2026, E ENCOLHEU POR MEDIDA.
 *
 * A primeira versão desta tabela ia de 0,80/0,00 até 0,30/0,65, e o erro estava
 * na direção: cada degrau baixava a estabilidade E subia o estilo ao mesmo
 * tempo. A doc da ElevenLabs diz que os dois empurram para o mesmo lado —
 * stability baixa "can sound erratic", style alto "can reduce stability". Mexer
 * nos dois juntos é apertar o acelerador e soltar o freio na mesma curva.
 *
 * O resultado veio no ouvido: a nota de voz do Caso 182, gerada em 0,45/0,45,
 * saiu gaguejando. Já 0,60/0,30 é o valor que rodou dias em produção sem
 * ninguém reclamar — é o piso conhecido, e agora é a ponta mais expressiva que
 * a tela oferece. Nada abaixo dele, porque abaixo dele não há medição.
 *
 * "Expressivo" (0,30/0,65) foi removido: era território de gagueira.
 *
 * O banco guarda os NÚMEROS, não o nome — renomear um botão não pode reescrever
 * o passado. Estes valores também vivem na dom-rascunho (ESTABILIDADE_PADRAO,
 * ESTILO_PADRAO) e no CHECK da migration: se um mudar, os outros mudam junto.
 */
const TONS: { nome: string; estabilidade: number; estilo: number; ajuda: string }[] = [
  { nome: 'Sério',       estabilidade: 0.90, estilo: 0.00, ajuda: 'o mais firme e uniforme — para prazo, exigência, notícia ruim' },
  { nome: 'Equilibrado', estabilidade: 0.75, estilo: 0.15, ajuda: 'firme com um pouco de variação — serve para quase tudo' },
  { nome: 'Caloroso',    estabilidade: 0.60, estilo: 0.30, ajuda: 'o mais solto que temos medido — é o padrão do sistema' },
];

/**
 * O tom em que este áudio saiu.
 *
 * Nulo = gerado antes de 08/09/2026, nas constantes antigas — que são
 * exatamente 0,60/0,30, hoje rotulado "Caloroso". O padrão do sistema ser o
 * mais expressivo dos três não é descuido: é o reconhecimento de que a faixa
 * segura fica toda ACIMA do que já rodava, não abaixo.
 */
const nomeDoTom = (estabilidade: unknown, estilo: unknown): string => {
  const e = Number(estabilidade), y = Number(estilo);
  const achado = TONS.find(t => t.estabilidade === e && t.estilo === y);
  if (achado) return achado.nome;
  if (estabilidade === null || estabilidade === undefined
      || estilo === null || estilo === undefined
      || !Number.isFinite(e) || !Number.isFinite(y)) return 'Caloroso';
  // Voz configurada por fora da tela (SQL na mão), ou um áudio gerado num
  // preset que não existe mais — como o 0,45/0,45 que gaguejou. Mostrar o
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

/**
 * O motivo que serve de assunto — ou nada.
 *
 * Os dois motivos de rotina ("modo rascunho: tudo passa por revisao", "modo
 * automatico: entra na fila de envio") descrevem o CANO, nao o caso. Como
 * assunto de atividade eles sao ruido: a lista fica com trinta linhas iguais e
 * ninguem consegue escolher qual abrir.
 */
function motivoDoCaso(p: Pendente): string {
  const m = (p.motivo_revisao || '').trim();
  return m.startsWith('modo ') ? '' : m;
}

/** O assunto sugerido da atividade. Mesma frase na previa e no formulario —
 *  previa que promete um assunto e entrega outro nao e previa. */
function assuntoDaAtividade(p: Pendente): string {
  const m = motivoDoCaso(p);
  const t = m
    ? `Conferir e voltar ao cliente: ${m}`
    : `Conferir e voltar ao cliente no grupo ${p.group_name || ''}`.trim();
  return t.slice(0, 200);
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

/**
 * Os processos que entraram no prompt desta resposta, pelo número.
 *
 * Dentro da ficha é a pergunta que o cliente faria: "essa mensagem foi sobre
 * qual dos meus processos?". Sai do mesmo `contexto_usado` que abastece a
 * FontesDaResposta no detalhe — aqui é só o resumo de uma linha, para não
 * precisar abrir cada cartão para descobrir.
 *
 * Rascunho anterior a 07/09/2026 não tem `contexto_usado` e não ganha a linha:
 * inventar "sem processo" ali seria afirmar o que ninguém guardou.
 */
function processosDoRascunho(p: Pendente): string[] {
  return (p.contexto_usado?.processos || [])
    .map(pr => (pr?.numero || '').trim())
    .filter(Boolean);
}

/** Linha comum das três listas que saem de dom_respostas_pendentes. */
function LinhaPendente({ p, onClick, rodape, marcada, onMarcar }: {
  p: Pendente; onClick?: () => void; rodape?: React.ReactNode;
  marcada?: boolean; onMarcar?: (v: boolean) => void;
}) {
  const processos = processosDoRascunho(p);
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
        {processos.length > 0 && (
          <p className="text-[10px] text-muted-foreground/80 truncate">
            {processos.length === 1 ? 'sobre o processo ' : 'sobre os processos '}
            {processos.join(' · ')}
          </p>
        )}
        {rodape}
      </CardContent>
    </Card>
  );
}

/**
 * O painel inteiro, ou o mesmo painel recortado num cliente só.
 *
 * `leadId` ausente = a tela de operação, com os 1.149 grupos do piloto. Com
 * `leadId`, é a aba dentro da ficha: as mesmas listas, os mesmos cartões e o
 * mesmo detalhe lateral, só que do cliente que está aberto.
 *
 * É o MESMO componente de propósito. Um painel reduzido paralelo divergiria na
 * primeira mudança — o botão novo entraria num e não no outro, e o assessor
 * veria dentro da ficha uma ação que já não existe mais na tela de operação.
 */
export function AtendenteVirtualPanel({ leadId }: { leadId?: string } = {}) {
  const noLead = !!leadId;
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
  /**
   * O que NÃO chegou, indexado por agendamento_id → motivo da falha.
   *
   * Em 08/09/2026 o painel carimbou "Já chegou ao cliente" numa resposta que
   * morreu em timeout de DNS: a fila contava "disparei" como "entreguei" (ver
   * migration 20260908220000). O banco agora só declara entrega com confirmação
   * na mão, e o rascunho que falhou volta a `pendente` — o que é honesto, mas
   * silencioso: quem revisa veria o rascunho de novo na fila sem saber que ele
   * já tentou sair e não conseguiu, e concluiria que ninguém aprovou ainda.
   *
   * Este aviso é o que fecha a volta. Não é decoração: sem ele a pessoa reaprova
   * às cegas, e se a causa persistir ela repete o ciclo achando que é a primeira
   * vez.
   */
  const [naoChegou, setNaoChegou] = useState<Record<string, string>>({});
  const [ritmo, setRitmo] = useState(RITMO_PADRAO);
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<GrupoPiloto[]>([]);
  const [buscaConversa, setBuscaConversa] = useState('');
  const [nasConversas, setNasConversas] = useState<NaConversa[]>([]);
  const [buscandoConversas, setBuscandoConversas] = useState(false);
  /**
   * A aba é controlada porque a busca vive FORA dela.
   *
   * O campo fica embaixo da fita de abas e vale para todas: quem digita não
   * escolheu "ir para a aba de busca", escolheu procurar. Então digitar leva o
   * painel para os resultados, e apagar devolve para a aba de onde a pessoa
   * saiu — `abaAntesDaBusca` é esse endereço de volta.
   */
  const [aba, setAba] = useState('fila');
  const abaAntesDaBusca = useRef('fila');
  /**
   * Sem estes dois, cada tecla vira uma consulta ao banco.
   *
   * Medido em 09/09/2026: digitar "imposto de renda" disparava 15 chamadas da
   * RPC, cada uma varrendo 116 mil mensagens, e as 15 estouravam o statement
   * timeout — a tela virou uma pilha de erros vermelhos. `debounceBusca`
   * espera a pessoa parar de digitar; `buscaSeq` descarta resposta atrasada de
   * termo antigo, que senão sobrescreve o resultado do termo atual.
   */
  const debounceBusca = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buscaSeq = useRef(0);
  const [totalGrupos, setTotalGrupos] = useState(0);
  /**
   * Os grupos DESTE lead, no formato curto do jid — o recorte da aba da ficha.
   *
   * `null` = ainda não resolvi (não dá para carregar nada); `[]` = resolvi e a
   * ficha não tem grupo nenhum, que é uma resposta e não um erro.
   *
   * Vem de duas fontes porque o vínculo mora em dois lugares — os mesmos dois
   * degraus da `dom_contexto_processual`: a ponte explícita
   * (`lead_whatsapp_groups`) e o cadastro da ficha (`leads.whatsapp_group_id`).
   * Só a ponte perderia os grupos que existem apenas no cadastro (167 dentro do
   * piloto, medidos em 07/09/2026).
   *
   * A NORMALIZAÇÃO não é detalhe. Medido em 08/09/2026 no banco externo, as três
   * tabelas do Dom guardam o jid CURTO — 0 de 228 rascunhos, 0 de 779 decisões e
   * 0 de 1.149 grupos do piloto têm '@' — enquanto as duas fontes do lead
   * guardam misturado: 1.471 de 2.567 na ponte e 2.803 de 3.900 no cadastro.
   * Comparar cru daria lista vazia em mais da metade das fichas, e vazio aqui se
   * lê como "o assessor nunca falou com este cliente".
   */
  const [jidsDoLead, setJidsDoLead] = useState<string[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState<Pendente | null>(null);
  const [texto, setTexto] = useState('');
  /**
   * A RESPOSTA SAIU — E ALGUEM PRECISA CUMPRIR O QUE ELA PROMETEU.
   *
   * O texto que o atendente virtual manda quase sempre termina em "ja estou
   * acionando a equipe pra conferir e te responder aqui no grupo". Ate aqui
   * essa frase nao virava tarefa de ninguem: das 7 respostas que ja tinham ido
   * para a fila de envio, ZERO geraram atividade no momento do envio (medido
   * em 09/09/2026). A promessa saia para o cliente e morria no painel.
   *
   * A pergunta vem DEPOIS do envio, e nao antes, porque sao duas decisoes
   * diferentes: "esta resposta pode sair" ja foi tomada no botao; "isto exige
   * alguem da equipe" nem sempre — resposta que so informa nao precisa de
   * tarefa, e criar uma a cada envio encheria a esteira ate ninguem mais olhar.
   * Por isso e PERGUNTA com o rascunho a vista, e nao criacao automatica.
   *
   * Guarda o ID do rascunho, nao o objeto: o `carregar()` que roda logo depois
   * troca as listas, e comparar por id impede que a pergunta fique pendurada
   * sobre outro rascunho.
   */
  const [perguntarAtv, setPerguntarAtv] = useState<string | null>(null);
  /** O rascunho da atividade, montado aqui e revisado no formulario completo. */
  const [atvDraft, setAtvDraft] = useState<ActivityDraft | null>(null);
  const [atvAberta, setAtvAberta] = useState(false);
  /** De onde veio o responsavel sugerido — a previa diz, para dar para discordar. */
  const [atvOrigem, setAtvOrigem] = useState('');
  const [montandoAtv, setMontandoAtv] = useState(false);
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

  /**
   * Resolve os grupos da ficha antes de qualquer lista aparecer.
   *
   * Roda só na aba do lead. Na tela de operação `leadId` é undefined e este
   * efeito não faz uma consulta sequer — a tela grande continua exatamente
   * como estava.
   */
  useEffect(() => {
    if (!leadId) { setJidsDoLead(null); return; }
    let vivo = true;
    (async () => {
      await ensureExternalSession();
      const [ponte, ficha] = await Promise.all([
        dbAny.from('lead_whatsapp_groups').select('group_jid').eq('lead_id', leadId),
        dbAny.from('leads').select('whatsapp_group_id').eq('id', leadId).maybeSingle(),
      ]);
      if (!vivo) return;
      const curto = (j: unknown) => String(j ?? '').split('@')[0].trim();
      const todos = [
        ...((ponte.data as { group_jid: string | null }[] | null) || []).map(g => curto(g.group_jid)),
        curto((ficha.data as { whatsapp_group_id: string | null } | null)?.whatsapp_group_id),
      ].filter(Boolean);
      setJidsDoLead([...new Set(todos)]);
    })();
    return () => { vivo = false; };
  }, [leadId]);

  const carregar = useCallback(async () => {
    // `null` = ainda não sei quais são os grupos da ficha, e carregar agora
    // traria a fila do escritório inteiro dentro de um cliente — o vazamento
    // que o recorte existe para evitar.
    if (noLead && jidsDoLead === null) return;
    // `[]` = a ficha não tem grupo. As consultas sairiam com `in('group_jid',
    // [])`: cinco viagens ao banco para trazer nada. As listas são zeradas
    // porque o painel não é remontado quando a ficha aberta troca.
    if (noLead && jidsDoLead.length === 0) {
      setFila([]); setEnviadas([]); setComHumano([]);
      setSilenciadas([]); setGrupos([]); setSemFicha([]); setSaiEm({});
      return;
    }
    setCarregando(true);
    try {
      await ensureExternalSession();
      const sel = 'id, group_jid, instance_name, agendamento_id, audio_url, audio_voz, audio_erro, audio_velocidade, audio_estabilidade, audio_estilo, audio_pausa_ms, group_name, pergunta, pergunta_autor, resposta_sugerida, resposta_final, intencao, motivo_revisao, status, criado_em, enviado_em, atendente_id, lead_id, contexto_usado, dom_atendentes(nome, user_id)';
      /**
       * O recorte da ficha, aplicado a toda consulta que tem `group_jid`.
       *
       * Filtra por GRUPO e não por `lead_id`: 31 dos 228 rascunhos foram
       * gravados sem `lead_id` (o assessor não tinha achado a ficha na hora),
       * e são exatamente os que mais interessam a quem abre a ficha depois.
       * Filtrar pela coluna deixaria essas 31 fora, caladas. Pelo grupo não
       * perde nada: dos 197 com `lead_id`, os 197 batem com o grupo da ficha
       * (medido em 08/09/2026).
       */
      const escopo = (q: any) => (noLead ? q.in('group_jid', jidsDoLead ?? []) : q);

      const [f, e, h, s, gp, sf] = await Promise.all([
        // "Na fila" é tudo que AINDA NÃO SAIU — inclusive o que alguém já
        // aprovou. Filtrar só por 'pendente' fazia a resposta aprovada sumir
        // das quatro abas: não estava mais na fila, nunca chegou em enviadas,
        // e ficava parada para sempre sem ninguém ver.
        escopo(dbAny.from('dom_respostas_pendentes').select(sel)
          .in('status', ['pendente', 'aprovada', 'editada']).is('atendente_id', null))
          .order('criado_em', { ascending: false }).limit(100),
        escopo(dbAny.from('dom_respostas_pendentes').select(sel)
          .eq('status', 'enviada'))
          .order('enviado_em', { ascending: false }).limit(100),
        escopo(dbAny.from('dom_respostas_pendentes').select(sel)
          .not('atendente_id', 'is', null))
          .order('criado_em', { ascending: false }).limit(100),
        escopo(dbAny.from('dom_decisoes')
          .select('id, group_name, group_jid, intencao, decisao, motivo, pergunta, criado_em')
          .eq('decisao', 'silencio'))
          .order('criado_em', { ascending: false }).limit(100),
        // Só os que RESPONDEM SOZINHOS. São mais de mil grupos no piloto:
        // desenhar mil chaves na tela não é configuração, é entulho. Quem
        // procura um grupo específico usa a busca abaixo.
        noLead
          ? dbAny.from('dom_grupos_piloto')
              .select('group_jid, group_name, modo, ativo')
              .in('group_jid', jidsDoLead ?? []).order('group_name')
          : dbAny.from('dom_grupos_piloto')
              .select('group_jid, group_name, modo, ativo')
              .eq('ativo', true).eq('modo', 'automatico').order('group_name'),
        // Os que o assessor atende sem saber de quem são. Ordenados pelo
        // ESTRAGO já feito — quantas respostas saíram no escuro — e não por
        // nome: a fila de conserto começa por onde já custou caro.
        noLead
          ? Promise.resolve({ data: [] as unknown })
          : dbAny.from('vw_dom_grupo_sem_ficha')
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

      if (!noLead) {
        const { count } = await dbAny.from('dom_grupos_piloto')
          .select('group_jid', { count: 'exact', head: true }).eq('ativo', true);
        setTotalGrupos(count || 0);
      }

      // O ritmo é do agente, não do painel: lido aqui só para a tela contar a
      // verdade. Falhar não pode apagar a fila — cai no padrão e segue.
      const { data: cfg } = await dbAny.from('wjia_command_shortcuts')
        .select('auto_delay_first_minutes, auto_delay_next_minutes')
        .eq('id', DOM_AGENT_ID).maybeSingle();
      if (cfg) {
        const c = cfg as { auto_delay_first_minutes: number | null; auto_delay_next_minutes: number | null };
        setRitmo({
          primeira: c.auto_delay_first_minutes || RITMO_PADRAO.primeira,
          seguinte: c.auto_delay_next_minutes || RITMO_PADRAO.seguinte,
        });
      }

      const ids = [...((f.data as unknown as Pendente[]) || [])]
        .map(p => p.agendamento_id).filter(Boolean) as string[];
      if (ids.length) {
        const { data: ags } = await dbAny.from('whatsapp_mensagens_agendadas')
          .select('id, proximo_envio_at, ativo, encerrado_motivo, ultimo_erro').in('id', ids);
        const mapa: Record<string, string> = {};
        const falhas: Record<string, string> = {};
        type Ag = {
          id: string; proximo_envio_at: string; ativo: boolean;
          encerrado_motivo: string | null; ultimo_erro: string | null;
        };
        for (const a of (ags as Ag[]) || []) {
          if (a.ativo) mapa[a.id] = a.proximo_envio_at;
          // `falha_no_envio` é escrito pelo wa_agendadas_conferir quando as
          // tentativas acabaram. Só ele conta como "não chegou": agendamento
          // inativo por `fim_da_regra` é entrega concluída, e `respondida` é a
          // trava do pular_se_responder fazendo o que devia.
          if (a.encerrado_motivo === 'falha_no_envio') {
            falhas[a.id] = a.ultimo_erro || 'sem motivo registrado';
          }
        }
        setSaiEm(mapa);
        setNaoChegou(falhas);
      } else {
        setSaiEm({});
        setNaoChegou({});
      }
    } catch (err) {
      console.error('[AtendenteVirtualPanel]', err);
    } finally {
      setCarregando(false);
    }
  }, [noLead, jidsDoLead]);

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
   * `automatico` → entra na fila de envio com o atraso configurado; a janela é
   * a revisão, e a bolha tracejada na conversa deixa cancelar ou mandar na hora.
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
      ? `${g.group_name}: responde sozinho, ${ritmo.primeira} min depois de o cliente escrever`
      : `${g.group_name}: volta a só rascunhar`);
  };

  /**
   * Aprovar E mandar — o botão que faltava.
   *
   * "Marcar como boa" só marca: um rascunho de grupo em modo Rascunho não tinha
   * NENHUM caminho para chegar ao cliente, e ficava preso no painel para sempre.
   * Aqui ele entra na mesma fila de agendamento do resto.
   *
   * SEM OS CINCO MINUTOS DE ESPERA. Aquele atraso é a janela de revisão do modo
   * automático: a resposta que sai sozinha precisa de um tempo em que alguém
   * ainda possa alcançá-la. Aqui a revisão JÁ ACONTECEU — uma pessoa leu, às
   * vezes editou, e clicou em aprovar. Segurar cinco minutos depois disso não
   * protege de nada; só faz o cliente esperar por uma decisão já tomada.
   *
   * "Na hora" é o próximo tique do banco (`wa_agendadas_tick`, de minuto em
   * minuto) — até um minuto, e a tela diz isso em voz alta. Continua sendo o
   * disparo do banco quem envia, e não uma chamada direta daqui, pelo mesmo
   * motivo do "enviar agora" da conversa: um segundo caminho de envio seriam
   * duas verdades sobre a mesma mensagem, e mensagem dobrada se os dois
   * rodassem juntos.
   *
   * `pular_se_responder` fica ligado: se o cliente escrever DENTRO desse
   * minuto, a aprovada não sai. O marco da conferência é a criação do
   * agendamento, então a mensagem que gerou o rascunho — mais velha que ele —
   * não bloqueia nada.
   */
  const porNaFilaDeEnvio = async (p: Pendente, corpo: string) => {
    const quando = new Date().toISOString();
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
        motivo_revisao: 'aprovado à mão — sai no próximo minuto',
      } as never)
      .eq('id', p.id);
    if (error) throw error;
  };

  /**
   * O RASCUNHO DA ATIVIDADE — montado aqui, decidido no formulario completo.
   *
   * Nada disto e gravado: o retorno vai para o `ActivityFullSheet` em modo
   * criar, onde a pessoa le, troca o responsavel e so entao cria. E o mesmo
   * formulario da esteira, nao uma segunda versao reduzida dele.
   *
   * O RESPONSAVEL SUGERIDO PASSA POR DUAS TRADUCOES, e ignorar a primeira ja
   * custou caro: `dom_atendentes.user_id` guarda `profiles.id`, e nao o id de
   * autenticacao. As 102 atividades que a `dom-rascunho` abriu ate 09/09/2026
   * foram gravadas com esse valor, e NENHUMA bate com o `assigned_to` que o
   * resto do sistema usa — 7.118 atividades dos ultimos 30 dias apontam para
   * `profiles.user_id`. Depois dessa, a segunda: o formulario trabalha em UUID
   * do Cloud e quem remapeia para o Externo e o `createActivity`, entao mandar
   * o id do Externo daqui erraria de novo, na outra ponta.
   *
   * QUEM CUIDA DESTE CLIENTE VEM ANTES DO RODIZIO.
   *
   * O rodizio (`dom_atendentes`) existe para reclamacao que chega sem dono: é
   * a fila do plantao. Mas o grupo do print se chama "PREV 1028 | BIANCA/
   * ANUNCIO (AUX. MATERNIDADE) - KAROLYNE", e a ficha diz o mesmo —
   * `acolhedor_user_id` é a Maria Karolyne. Sugerir o plantao para um cliente
   * que já tem quem o acompanhe joga fora a única informação que faz a
   * atividade chegar em quem sabe do que se trata.
   *
   * Ordem: acolhedora da ficha → responsável processual → rodizio. Medido em
   * 09/09/2026 sobre os 362 rascunhos com ficha: 110 têm acolhedora, 95 têm
   * responsável processual, 174 (48%) têm um dos dois, e em 24 os dois existem
   * e são pessoas diferentes — é por isso que a ordem importa. Os outros 52%
   * continuam caindo no rodizio, como antes. `leads.assigned_to` ficou de
   * fora: está preenchido em ZERO das 362.
   *
   * Sugestao, nao decisao: quem aprova troca no seletor do formulario.
   */
  const montarRascunhoDaAtividade = async (
    p: Pendente, corpo: string,
  ): Promise<{ draft: ActivityDraft; origem: string }> => {
    let assignedTo = '';
    let assignedNome = '';
    let origem = '';
    let leadNome = '';

    // 1. A ficha do cliente: quem acolhe, senão quem cuida do processo. Os dois
    //    já são `profiles.user_id` (id de auth do Externo), então basta o
    //    remap para o Cloud, que é a moeda do formulário.
    if (p.lead_id) {
      const { data: lead } = await dbAny.from('leads')
        .select('lead_name, acolhedor_user_id, processual_responsible_id')
        .eq('id', p.lead_id).maybeSingle();
      const l = lead as {
        lead_name?: string; acolhedor_user_id?: string; processual_responsible_id?: string;
      } | null;
      leadNome = l?.lead_name || '';
      const daFicha = l?.acolhedor_user_id || l?.processual_responsible_id || null;
      if (daFicha) {
        assignedTo = (await remapToCloud(daFicha)) || '';
        origem = l?.acolhedor_user_id ? 'acolhedora da ficha' : 'responsável processual da ficha';
        const { data: perfil } = await dbAny.from('profiles')
          .select('full_name').eq('user_id', daFicha).maybeSingle();
        assignedNome = (perfil as { full_name?: string } | null)?.full_name || '';
      }
    }

    // 2. Sem ninguem na ficha, o plantao. `dom_atendentes.user_id` guarda
    //    `profiles.id` — e nao o id de auth. As 107 atividades que a
    //    `dom-rascunho` abriu com esse valor nao batiam com o `assigned_to`
    //    que o resto do sistema usa (7.118 das ultimas 30 dias apontam para
    //    `profiles.user_id`), e por isso nao apareciam na tela de ninguem.
    //    Aceita os dois lados de proposito: um cadastro futuro pode guardar o
    //    id certo, e ai a linha achada e a mesma.
    if (!assignedTo) {
      const at = Array.isArray(p.dom_atendentes) ? p.dom_atendentes[0] : p.dom_atendentes;
      assignedNome = at?.nome || '';
      if (at?.user_id) {
        const { data: perfil } = await dbAny.from('profiles')
          .select('user_id, full_name')
          .or(`id.eq.${at.user_id},user_id.eq.${at.user_id}`)
          .maybeSingle();
        const extUuid = (perfil as { user_id?: string } | null)?.user_id || null;
        if (extUuid) {
          assignedTo = (await remapToCloud(extUuid)) || '';
          assignedNome = (perfil as { full_name?: string } | null)?.full_name || assignedNome;
          origem = 'rodízio do atendente virtual';
        }
      }
    }

    const motivo = motivoDoCaso(p);

    // Dois dias. A pendencia aberta pela `dom-rascunho` usa tres, e ali cabe:
    // ninguem prometeu nada ao cliente. Aqui uma pessoa acabou de dizer, no
    // grupo, que a equipe volta — o prazo tem que ser menor que a paciencia.
    const prazo = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    return { origem, draft: {
      title: assuntoDaAtividade(p),
      activity_type: 'acompanhamento',
      priority: 'normal',
      deadline: prazo,
      assigned_to: assignedTo || undefined,
      assigned_to_name: assignedNome || undefined,
      lead_id: p.lead_id || undefined,
      lead_name: leadNome || undefined,
      current_status_notes: `O cliente escreveu no grupo ${p.group_name || ''}`
        + `${p.pergunta_autor ? ` (${p.pergunta_autor})` : ''}:

${p.pergunta || ''}`,
      what_was_done: `O atendente virtual respondeu no grupo, aprovado a mao em `
        + `${quando(new Date().toISOString())}.

Texto que saiu:

${corpo}`,
      next_steps: motivo
        ? `${motivo}. Conferir e responder ao cliente no proprio grupo.`
        : 'Conferir e responder ao cliente no proprio grupo.',
      // Marca a ligacao sem coluna nova nem migration: e por
      // `action_source_detail` que se acha, depois, qual resposta gerou qual
      // tarefa. Com prefixo porque o campo e livre — o id sozinho nao diz de
      // onde veio, e daqui a um mes ninguem lembra.
      action_source_detail: `atendente-virtual:${p.id}`,
    } };
  };

  /**
   * Monta o rascunho assim que a resposta sai — antes de perguntar.
   *
   * A previa tem que dizer QUEM vai ficar com a atividade, e isso depende de
   * duas consultas (a ficha do cliente e o perfil). Perguntar "cria?" com o
   * responsavel em branco, e so revelar o nome depois de abrir o formulario,
   * e pedir uma decisao escondendo a informacao que a sustenta.
   */
  const prepararRascunhoDaAtividade = async (p: Pendente, corpo: string) => {
    setMontandoAtv(true);
    try {
      const { draft, origem } = await montarRascunhoDaAtividade(p, corpo);
      setAtvDraft(draft);
      setAtvOrigem(origem);
    } catch (e) {
      // Falhar aqui nao desfaz o envio: a resposta ja saiu. A pergunta fica de
      // pe com o que der para mostrar, e o formulario abre em branco.
      toast.error('Nao consegui montar o rascunho da atividade: ' + ((e as Error)?.message || 'erro'));
    } finally {
      setMontandoAtv(false);
    }
  };

  const aprovarEEnviar = async (p: Pendente) => {
    setEnviando(true);
    try {
      await porNaFilaDeEnvio(p, texto);
      toast.success('Aprovada — sai no próximo minuto');
      // O painel NAO fecha aqui. Fechar era a perda: a resposta prometia que a
      // equipe volta ao cliente, e a promessa saia sem dono. A pergunta da
      // atividade vive no lugar dos botoes, com o rascunho a vista.
      setPerguntarAtv(p.id);
      void prepararRascunhoDaAtividade(p, texto);
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
        ? `${ok} aprovada(s) — saem no próximo minuto`
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
  const procurarNasConversas = async (t: string) => {
    const meu = ++buscaSeq.current;
    setBuscandoConversas(true);
    try {
      const { data, error } = await (dbAny as any)
        .rpc('buscar_nas_conversas_da_fila', { p_termo: t, p_limite: 50 });
      if (meu !== buscaSeq.current) return; // resposta de termo já abandonado
      if (error) throw error;
      setNasConversas((data as NaConversa[]) || []);
    } catch (e: any) {
      if (meu !== buscaSeq.current) return;
      setNasConversas([]);
      const bruto = e?.message || '';
      // "canceling statement due to statement timeout" não diz nada a quem
      // revisa fila. O id fixo no toast é o que impede a pilha de erros
      // idênticos empilhados na tela.
      toast.error(
        /statement timeout/i.test(bruto)
          ? 'A busca demorou demais e o banco cortou. Tente um termo mais específico.'
          : 'Falha ao buscar nas conversas: ' + bruto,
        { id: 'busca-nas-conversas' },
      );
    } finally {
      if (meu === buscaSeq.current) setBuscandoConversas(false);
    }
  };

  /**
   * O que acontece a cada tecla: quase nada, de propósito.
   *
   * Só marca o termo, leva o painel para os resultados e agenda a consulta para
   * meio segundo depois da última tecla. Enter atropela a espera para quem já
   * sabe o que quer.
   */
  const digitarNasConversas = (termo: string, agora = false) => {
    setBuscaConversa(termo);
    if (debounceBusca.current) clearTimeout(debounceBusca.current);
    const t = termo.trim();
    if (t.length < 3) {
      buscaSeq.current++; // invalida o que estiver em voo
      setBuscandoConversas(false);
      setNasConversas([]);
      if (aba === 'busca') setAba(abaAntesDaBusca.current);
      return;
    }
    if (aba !== 'busca') { abaAntesDaBusca.current = aba; setAba('busca'); }
    setBuscandoConversas(true);
    if (agora) { procurarNasConversas(t); return; }
    debounceBusca.current = setTimeout(() => procurarNasConversas(t), 500);
  };

  const limparBuscaNasConversas = () => digitarNasConversas('');

  useEffect(() => () => { if (debounceBusca.current) clearTimeout(debounceBusca.current); }, []);

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
          {noLead ? (
            jidsDoLead === null
              ? 'Procurando o grupo deste cliente…'
              : jidsDoLead.length === 0
                ? 'Esta ficha não tem grupo de WhatsApp ligado — o assessor virtual não tem por onde falar com este cliente, e por isso não há nada aqui.'
                : `O que o atendente virtual escreveu para este cliente, ${jidsDoLead.length === 1 ? 'no grupo da ficha' : `nos ${jidsDoLead.length} grupos da ficha`}.`
          ) : (
            <>
              O que o atendente virtual fez.{' '}
              {grupos.length === 0
                ? `Nenhum dos ${totalGrupos} grupos responde sozinho ainda — tudo fica esperando revisão e nada sai para o cliente.`
                : `${grupos.length} de ${totalGrupos} grupos respondem sozinhos: a resposta entra na fila e sai ${ritmo.primeira} min depois, se ninguém escrever antes.`}
            </>
          )}
        </p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={carregar} disabled={carregando}>
          {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      {!(noLead && jidsDoLead?.length === 0) && <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-[11px] font-medium">
            {noLead ? 'O grupo deste cliente responde sozinho?' : 'Quem responde sozinho'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Ligado, ele responde sozinho {ritmo.primeira} min depois de o cliente escrever —
            e {ritmo.seguinte} min nas respostas seguintes, enquanto a conversa continua. A
            mensagem aparece na conversa como bolha tracejada com cronômetro — dá para tirar
            da fila ou mandar na hora. Se alguém escrever no grupo antes, ela não sai.
            {noLead
              ? ' Desligado, ele continua escrevendo: o rascunho cai na fila abaixo e nada chega ao cliente sem alguém aprovar.'
              : ' Os outros continuam trabalhando em modo rascunho: escrevem e enchem a fila, sem nada chegar no cliente.'}
          </p>

          <div className="space-y-1 pt-1">
            {grupos.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic py-1">
                {!noLead
                  ? 'Nenhum grupo responde sozinho ainda.'
                  : jidsDoLead === null
                    ? 'Procurando o grupo da ficha…'
                    : 'O grupo desta ficha não está no piloto do assessor — ele não escreve nada aqui, nem rascunho.'}
              </p>
            )}
            {grupos.map(g => (
              <div key={g.group_jid} className="flex items-center gap-2">
                <span className="text-[11px] flex-1 truncate">{g.group_name || g.group_jid}</span>
                {/* Na tela grande esta lista já vem filtrada em `automatico`, então
                    o rótulo continua o mesmo. Na ficha vêm os dois modos, e dizer
                    "responde sozinho" num grupo que só rascunha seria mentira. */}
                <span className={`text-[10px] whitespace-nowrap ${g.modo === 'automatico' ? 'text-emerald-700' : 'text-muted-foreground'}`}>
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

          {!noLead && <div className="pt-2 border-t space-y-1">
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
          </div>}
        </CardContent>
      </Card>}

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

      <Tabs value={aba} onValueChange={setAba}>
        {/* Dentro da ficha cai uma aba e some a busca. Ela procura em TODOS os
            grupos com rascunho na fila — dentro de um cliente devolveria
            conversa de outro. E "Sem ficha" é a lista de grupos órfãos: esta
            ficha, por definição, não está lá. */}
        <TabsList className={`grid w-full ${noLead ? 'grid-cols-4' : 'grid-cols-5'}`}>
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
          {/* A sexta é a que dói: grupos que ele atende sem saber de quem são. */}
          {!noLead && (
            <TabsTrigger value="semficha" className="text-xs gap-1">
              <UserX className="h-3.5 w-3.5" />Sem ficha
              {semFicha.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{semFicha.length}</Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        {/*
          Um campo só, embaixo da fita, valendo para todas as abas.
          Antes ele morava DENTRO de uma sexta aba: para procurar era preciso
          primeiro adivinhar que a busca era um lugar, não uma ação. Aqui ela
          está sempre à mão, e o resultado toma o lugar da lista até a pessoa
          limpar — o X devolve para a aba de onde ela saiu.
        */}
        {!noLead && (
          <div className="pt-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={buscaConversa}
                onChange={(e) => digitarNasConversas(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') digitarNasConversas(buscaConversa, true); }}
                placeholder="Procurar no que foi dito nos grupos que estão esperando revisão…"
                className="h-8 text-xs pl-7 pr-7"
              />
              {buscaConversa.length > 0 && (
                <button
                  type="button"
                  onClick={limparBuscaNasConversas}
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {buscaConversa.trim().length > 0 && buscaConversa.trim().length < 3 && (
              <p className="text-[10px] text-muted-foreground pt-1">Digite ao menos 3 letras.</p>
            )}
          </div>
        )}

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
                // A falha vem na frente de todo o resto: saber que a mensagem
                // não chegou muda o que a pessoa faz agora; saber que ela seria
                // uma nota de voz, não.
                p.agendamento_id && naoChegou[p.agendamento_id] ? (
                  <p className="text-[10px] text-destructive font-medium flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-px shrink-0" />
                    NÃO chegou ao cliente — tentou e falhou. Abra e envie de novo.
                  </p>
                ) : p.audio_url ? (
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

        {!noLead && <TabsContent value="busca" className="space-y-2 pt-3">
          <div className="flex items-center gap-2">
            <p className="text-[10px] text-muted-foreground flex-1">
              Procura só dentro dos grupos com rascunho na fila — é o recorte que deixa a busca
              rápida. Cada resultado abre a conversa por cima, no ponto em que a frase apareceu.
            </p>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1 shrink-0"
              onClick={limparBuscaNasConversas}>
              <X className="h-3 w-3" />Voltar para as abas
            </Button>
          </div>

          {buscandoConversas && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 py-2">
              <Loader2 className="h-3 w-3 animate-spin" />procurando…
            </p>
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
        </TabsContent>}

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
        {!noLead && <TabsContent value="semficha" className="space-y-2 pt-3">
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
        </TabsContent>}
      </Tabs>

      {/* Detalhe em painel lateral — nunca redireciona, nunca abre aba nova. */}
      <Sheet open={!!aberto} onOpenChange={o => { if (!o) { setAberto(null); setPerguntarAtv(null); } }}>
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
              {perguntarAtv === aberto.id ? (
                // ACABOU DE SAIR — E A PERGUNTA QUE FALTAVA VEM AQUI.
                //
                // No lugar dos botoes de decisao, porque a decisao ja foi
                // tomada: mostrar "aprovar" de novo poria uma segunda copia da
                // mesma resposta na fila. O que sobra a decidir e outra coisa.
                <div className="space-y-2">
                  <div className="rounded border border-emerald-600/40 bg-emerald-600/5 p-2 text-center">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Enviada — sai no próximo minuto
                    </p>
                  </div>
                  <div className="rounded border p-2 space-y-2">
                    <p className="text-xs font-medium flex items-center gap-1">
                      <ClipboardList className="h-3.5 w-3.5" />
                      Criar a atividade correspondente?
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      A resposta acabou de dizer ao cliente que a equipe volta. Sem atividade,
                      essa promessa não fica com ninguém — e é assim que ela se perde.
                    </p>
                    {aberto.lead_id ? (
                      <>
                        <div className="rounded bg-muted p-2 space-y-1">
                          <p className="text-[10px] text-muted-foreground">Assunto sugerido</p>
                          <p className="text-[11px] font-medium break-words">{assuntoDaAtividade(aberto)}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Responsável sugerido:{' '}
                            {montandoAtv
                              ? <span className="italic">procurando quem cuida deste cliente…</span>
                              : (
                                <>
                                  <strong>{atvDraft?.assigned_to_name || 'ninguém ainda — você escolhe'}</strong>
                                  {/* De onde veio: sem isto, "Keliane" e "Karolyne" aparecem
                                      iguais na tela, e quem revisa não tem como discordar de
                                      uma sugestão cuja razão não está escrita. */}
                                  {atvOrigem && <> ({atvOrigem})</>}
                                </>
                              )}
                            {' '}· prazo em 2 dias
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="text-xs gap-1 flex-1" disabled={montandoAtv}
                            onClick={() => setAtvAberta(true)}>
                            {montandoAtv
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <ClipboardList className="h-3.5 w-3.5" />}
                            Revisar e criar
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs"
                            onClick={() => { setPerguntarAtv(null); setAberto(null); }}>
                            Agora não
                          </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Abre o <strong>formulário completo</strong> de atividade, o mesmo da
                          esteira, já preenchido com a pergunta do cliente e o texto que saiu. O
                          responsável se escolhe lá, e nada é criado antes de você clicar em criar.
                        </p>
                      </>
                    ) : (
                      // Sem ficha nao ha atividade: o `createActivity` recusa
                      // atividade sem lead, caso ou processo. Dizer isso aqui e
                      // melhor que abrir o formulario e ele falhar no fim.
                      <>
                        <p className="text-[11px] text-amber-700">
                          Este grupo não tem ficha, e o sistema não cria atividade sem lead.
                          Vincule a ficha primeiro — a resposta já saiu de qualquer jeito.
                        </p>
                        <Button size="sm" variant="outline" className="w-full text-xs"
                          onClick={() => { setPerguntarAtv(null); setAberto(null); }}>
                          Fechar
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ) : aberto.status === 'enviada' ? (
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
              ) : aberto.agendamento_id && naoChegou[aberto.agendamento_id] ? (
                // NÃO CHEGOU, e isso precisa ser dito antes de qualquer botão.
                //
                // Aqui é onde a tela mentiu em 08/09/2026: dizia "Já chegou ao
                // cliente" sobre uma resposta que morreu em timeout de DNS. O
                // banco parou de mentir (migration 20260908220000); esta caixa
                // é o outro lado — o revisor precisa VER que a fila tentou e
                // não conseguiu, senão ele reaprova sem saber que já falhou.
                //
                // O botão de aprovar continua logo abaixo, de propósito: o
                // caminho de sair daqui é reenviar, e ele tem que estar à mão.
                <>
                  <div className="rounded border border-destructive/40 bg-destructive/5 p-2">
                    <p className="text-xs font-medium text-destructive flex items-start gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                      Esta resposta NÃO chegou ao cliente
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      A fila tentou e desistiu depois de três vezes. Motivo registrado:
                    </p>
                    <p className="text-[10px] font-mono text-destructive/90 mt-0.5 break-words">
                      {naoChegou[aberto.agendamento_id]}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Confira se a conversa mudou desde então antes de mandar de novo — o
                      texto foi escrito para o que o cliente tinha dito naquela hora.
                    </p>
                  </div>
                  <Button size="sm" className="w-full text-xs gap-1"
                    disabled={enviando} onClick={() => aprovarEEnviar(aberto)}>
                    {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizonal className="h-3.5 w-3.5" />}
                    Tentar enviar de novo
                  </Button>
                </>
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
                      ? 'Aprovar e mandar em áudio (sai na hora)'
                      : 'Aprovar e enviar (sai na hora)'}
                  </Button>
                  {/* O aviso do que vem A SEGUIR. Sem ele a pergunta da atividade
                      aparece do nada depois do clique — e quem não a viu chegar
                      conclui que ela não existe, que foi o que aconteceu na
                      primeira vez que esta tela foi usada (09/09/2026). */}
                  <p className="text-[10px] text-muted-foreground flex items-start gap-1 -mt-1">
                    <ClipboardList className="h-3 w-3 mt-px shrink-0" />
                    Depois de enviar, eu pergunto aqui mesmo se você quer criar a atividade
                    da equipe — com o responsável já sugerido pela ficha do cliente.
                  </p>
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
                    próprio agente pediu revisão. <strong>Aprovar e enviar</strong> manda na hora:
                    a revisão é você clicando aqui, então não há mais o que esperar. Sai no
                    próximo minuto — sem janela para desistir depois.
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

      {/* A atividade que a resposta prometeu. Formulario COMPLETO, empilhado
          por cima do painel do rascunho — irmao, nao filho, senao fecharia
          junto com ele. Nada foi gravado ate aqui: e o rascunho na tela. */}
      {atvDraft && (
        <Suspense fallback={null}>
          <ActivityFullSheet
            open={atvAberta}
            mode="create"
            draft={atvDraft}
            activityId={null}
            leadId={atvDraft.lead_id ?? null}
            leadName={atvDraft.lead_name ?? null}
            onOpenChange={o => {
              // Fechar sem criar joga o rascunho fora: manter faria a proxima
              // resposta herdar a pergunta e o texto desta.
              if (!o) { setAtvAberta(false); setAtvDraft(null); setAtvOrigem(''); }
            }}
            onCreated={() => {
              setAtvAberta(false); setAtvDraft(null); setAtvOrigem('');
              setPerguntarAtv(null); setAberto(null);
              toast.success('Atividade criada — a promessa tem dono.');
            }}
          />
        </Suspense>
      )}

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
