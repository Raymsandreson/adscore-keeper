import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Crown, RefreshCw, Maximize2, Minimize2, Trophy, Megaphone, Flag, Play, Pause, Volume2, VolumeX, SlidersHorizontal, Check, RotateCw, Timer, ListChecks, Briefcase } from 'lucide-react';
import { format, startOfDay, startOfWeek, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import PerformanceCoachDialog from '@/components/tv/PerformanceCoachDialog';
import RankDetailSheet, { type DetailCriterio } from '@/components/tv/RankDetailSheet';
import TeamBroadcastDialog from '@/components/tv/TeamBroadcastDialog';
import WackyRaceTrack, { nameKey, estrelaLabel, type CarChoice, type RaceRow } from '@/components/tv/WackyRaceTrack';
import TvCarteiraPanel from '@/components/tv/TvCarteiraPanel';
import TvAvaliacaoPanel from '@/components/tv/TvAvaliacaoPanel';
// Ficha completa do processo, aberta por cima do detalhe. Lazy porque é o
// ProcessDetailSheet inteiro — não pode entrar no bundle que a TV carrega só
// pra mostrar ranking.
const ProcessQuickSheet = lazy(() => import('@/components/tv/ProcessQuickSheet'));
import { getTimeOffForDate, TIME_OFF_TYPE_LABELS, type TimeOffEntry } from '@/lib/timeOff';
import { useRaceMusic } from '@/hooks/useRaceMusic';
import {
  useRaceSfx,
  detectarUltrapassagens,
  narracaoUltrapassagem,
  narracaoRecorde,
  OVERTAKE_PRESETS,
  NARRATION_STYLES,
  type NarrationStyleId,
  type VozDisponivel,
  type Ultrapassagem,
} from '@/hooks/useRaceSfx';

// /tv/atividades — Telão do "Ranking de Atividades" do time.
// Dados AO VIVO do Supabase Externo via RPC `tv_atividades_ranking`, que já
// aplica a regra de ordenação: STATUS ESPERADO → FASES → OBJETIVOS → PASSOS →
// ITENS DO CHECKLIST → CONCLUÍDAS → menos ATRASADAS → maior MÉDIA DE ESTRELAS →
// menos FEEDBACKS SEM AVALIAR → mais TEMPO ATIVO → menos OCIOSO → RESPOSTA NO CHAT.
// Feito para rodar num telão em fullscreen; auto-atualiza sozinho.

type Period = 'hoje' | 'semana' | 'mes';

interface RankRow {
  nome: string;
  resultado: number;
  fases: number;
  objetivos: number;
  passos: number;
  doc_itens: number;
  concluidas: number;
  atrasadas: number;
  aprov_pct: number | null;
  /** Média das estrelas RECEBIDAS no período (null = sem avaliação no período). */
  media_estrelas: number | string | null;
  /** Média que PONTUA no ranking: só existe com >= 3 notas no período. */
  qualidade?: number | string | null;
  notas_n: number;
  /** Feedbacks que ela deveria avaliar e não avaliou (backlog total). */
  fb_pendentes: number;
  /** Pendências do cliente cumpridas no período, nos casos sob responsabilidade dela. */
  pend_feitas: number;
  /** Pendências do cliente em aberto sob responsabilidade da pessoa (backlog total). */
  pend_cliente: number;
  chat_resp_seg: number | null;
  ativo_seg: number;
  ocioso_seg: number;
  home_office?: boolean;
}
interface Resumo {
  trabalhando_h: number;
  ocioso_h: number;
  aproveitamento_pct: number | null;
}
// Recorde individual de passos do período/time — vem do servidor (RPC), já
// filtrado pelo time selecionado. { passos, nome } = valor + quem detém.
interface MetaRecorde { passos: number; nome: string | null; }
interface Payload {
  ranking: RankRow[];
  resumo: Resumo | null;
  meta?: MetaRecorde | null;
  gerado_em: string;
}

const REFRESH_MS = 45_000;
const LIST_MAX = 7; // linhas abaixo do pódio (posições 4..10)
// Valor sentinela no seletor de time: só gestores de time + diretoria
// (team_managers + org_directors no Externo; a RPC resolve via p_grupo).
const GRUPO_GERENCIAL = 'gerencial';
// A vista "Protocolos do Dia" saiu do rodízio em 05/08/2026 (o telão é sobre
// marcos, não sobre volume de protocolo). Os mesmos números continuam na Visão
// Geral e no Acompanhamento Processual, via ProtocolosDiaCard.
// A TV fica dias no ar sem ninguém tocar na URL: se o telão estiver parado em
// ?team=protocolos, esse valor cairia no p_team_id da RPC e quebraria o cast de
// uuid, deixando a tela vazia pra sempre. Por isso o valor legado vira ''.
const VISTA_PROTOCOLOS_LEGADO = 'protocolos';
function sanitizeTeamParam(v: string | null) {
  return !v || v === VISTA_PROTOCOLOS_LEGADO ? '' : v;
}
// Token na URL pro "Ranking Geral" (teamId '') na lista de itens fora do rodízio.
function rotEnc(v: string) { return v === '' ? 'geral' : v; }
function rotDec(t: string) { return t === 'geral' ? '' : t; }

// Paleta estável por nome (cada assessor sempre com a mesma cor de avatar).
const AVATAR_COLORS = [
  'bg-sky-500', 'bg-emerald-500', 'bg-fuchsia-500', 'bg-cyan-500', 'bg-rose-500',
  'bg-amber-500', 'bg-violet-500', 'bg-teal-500', 'bg-indigo-500', 'bg-pink-500',
  'bg-lime-500', 'bg-orange-500',
];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '—';
}
// Nome curto pra narração/banner de ultrapassagem (primeiros 2 nomes).
function shortName(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).join(' ') || name;
}
function periodSince(p: Period): Date {
  const now = new Date();
  if (p === 'hoje') return startOfDay(now);
  if (p === 'mes') return startOfMonth(now);
  return startOfWeek(now, { weekStartsOn: 1 }); // segunda-feira
}
function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function aprovLabel(v: number | null) {
  return v == null ? '—' : `${v}%`;
}
// Média de resposta no chat interno, em segundos → rótulo curto pro telão.
function chatRespLabel(s: number | null | undefined) {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
}
// Tempo ativo/ocioso do cronômetro no período; 0 = não usou → traço.
function tempoLabel(s: number | null | undefined) {
  return s ? chatRespLabel(s) : '—';
}
// Contagem regressiva mm:ss (rotação automática de times).
function fmtMMSS(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
}

// ---- Recorde de passos do período (selo + comemoração) ----
// value = passos, holder = quem detém. Fonte = servidor (data.meta), filtrado
// por time — sem localStorage, então não vaza recorde de um time pro outro.
interface RecordMark { value: number; holder: string; }

export default function TvAtividadesPage() {
  const [params, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const titulo = params.get('titulo') || 'Time Processual';

  const [period, setPeriod] = useState<Period>('hoje');
  const [teamId, setTeamId] = useState<string>(sanitizeTeamParam(params.get('team'))); // '' = todos os times
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [tv, setTv] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // Coach de desempenho: clicar num assessor abre o painel de análise + mensagem.
  const [coach, setCoach] = useState<{ row: RankRow; rank: number } | null>(null);
  // Detalhe de um critério (clique no chip passos/concl/atr de uma pessoa).
  const [detail, setDetail] = useState<{ nome: string; criterio: DetailCriterio; count: number | string } | null>(null);
  // Processo aberto por cima do detalhe (ficha completa, sem sair do telão).
  const [processoAberto, setProcessoAberto] = useState<string | null>(null);
  // "Mensagem pra todos": dispara a coach personalizada de cada um do ranking.
  const [broadcast, setBroadcast] = useState(false);
  // Modo Corrida: o ranking vira pista estilo cartoon. Escolha de carro por nome.
  // É a visualização PADRÃO; só `?corrida=0` cai no pódio clássico.
  const [raceMode, setRaceMode] = useState(params.get('corrida') !== '0');
  // Vista "Carteira": o mesmo período, mas esforço (atividades) ao lado de
  // resultado (processos que andaram). Fora do rodízio automático — é vista de
  // conversa de gestão, não de TV girando sozinha.
  const [carteiraMode, setCarteiraMode] = useState(params.get('carteira') === '1');
  const [cars, setCars] = useState<Record<string, CarChoice>>({});
  // Ausências que cobrem HOJE (member_time_off): quem está de folga/férias sai
  // da corrida e vai pro "pit stop". Casamento com o ranking é por nome.
  const [timeOffToday, setTimeOffToday] = useState<TimeOffEntry[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Trilha do telão: play/pausa manual pra dar energia ao ambiente.
  // Toca o arquivo configurado (public/telao-musica.mp3 ou ?musica=URL);
  // se não houver, cai numa trilha sintetizada. Ver useRaceMusic.
  const music = useRaceMusic();
  // Efeitos de corrida: zoada de aceleração + narração quando alguém ultrapassa.
  const sfx = useRaceSfx();
  // Ordem anterior do ranking por chave time+período+dia (ver orderKey adiante).
  const prevOrderRef = useRef<Map<string, Map<string, number>>>(new Map());
  const lastSfxRef = useRef(0);
  const overtakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overtakes, setOvertakes] = useState<Ultrapassagem[]>([]);
  // Recorde do período (vem do servidor): topo ao vivo o supera → som especial
  // (arquivo do Airton). recordBucketRef guarda o último recorde já comemorado
  // (chave time+período+valor) pra não repetir o som a cada refresh.
  const recordRef = useRef<RecordMark | null>(null);
  const recordBucketRef = useRef<string>('');
  const lastRecordRef = useRef(0);
  const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [record, setRecord] = useState<RecordMark | null>(null);
  const [recordHit, setRecordHit] = useState<RecordMark | null>(null);
  // Painel pra escolher e testar o som da ultrapassagem.
  const [soundPanel, setSoundPanel] = useState(false);
  // Vozes da conta ElevenLabs pro seletor de locutor (carrega ao abrir o painel).
  const [vozes, setVozes] = useState<VozDisponivel[] | null>(null);
  const [vozesLoading, setVozesLoading] = useState(false);

  // ---- Rotação automática de times (telão sem operador) ----
  // Percorre em ciclo: Ranking Geral (todos) → cada time → volta. Fica
  // `rotateMin` minutos em cada um. Estado na URL (?rotate=1&rotmin=3) pra
  // sobreviver a refresh/boot do telão. rotateLeft = segundos até a próxima troca.
  // Ligado por padrão (telão sem operador roda sozinho); ?rotate=0 desliga.
  const [autoRotate, setAutoRotate] = useState(params.get('rotate') !== '0');
  const [rotateMin, setRotateMin] = useState(() => {
    const m = Number(params.get('rotmin'));
    return Number.isFinite(m) && m >= 1 && m <= 60 ? m : 2;
  });
  const [rotateLeft, setRotateLeft] = useState(0);
  const rotateDeadlineRef = useRef(0);
  // Itens DESLIGADOS do rodízio (guardar os off faz time novo entrar ligado por
  // padrão). Persiste em ?rotoff=geral,<uuid>,gerencial.
  const [rotateOff, setRotateOff] = useState<Set<string>>(() => {
    const raw = params.get('rotoff');
    return raw ? new Set(raw.split(',').filter(Boolean).map(rotDec)) : new Set<string>();
  });
  const [rotatePanel, setRotatePanel] = useState(false);

  // Relógio do cabeçalho.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Times pro seletor + espelho pro Externo.
  // Lê do Cloud (fonte de verdade, atualizada pela aba Times) e replica o
  // snapshot no Externo pra RPC tv_atividades_ranking casar por team_id.
  useEffect(() => {
    (async () => {
      try {
        const [{ data: teamsData }, { data: membersData }] = await Promise.all([
          supabase.from('teams').select('id, name').order('name', { ascending: true }),
          supabase.from('team_members').select('team_id, user_id'),
        ]);
        setTeams((teamsData || []) as { id: string; name: string }[]);
        if (teamsData && teamsData.length > 0) {
          try {
            await ensureExternalSession();
            await (externalSupabase as any).rpc('sync_teams_snapshot', {
              p_teams: teamsData.map(t => ({ id: t.id, name: t.name })),
              p_members: (membersData || []).map(m => ({ team_id: m.team_id, user_id: m.user_id })),
            });
          } catch (e) {
            console.warn('[TvAtividades] sync_teams_snapshot:', e);
          }
        }
      } catch (e) {
        console.warn('[TvAtividades] teams load:', e);
      }
    })();
  }, []);

  const onSelectTeam = useCallback((id: string) => {
    setTeamId(id);
    const next = new URLSearchParams(params);
    if (id) next.set('team', id); else next.delete('team');
    setSearchParams(next, { replace: true });
  }, [params, setSearchParams]);

  const selectedTeamName = useMemo(
    () => teamId === GRUPO_GERENCIAL
      ? 'Gerencial e Diretoria'
      : teams.find(t => t.id === teamId)?.name,
    [teams, teamId],
  );
  // Nome do que está na tela agora (todos = "Ranking Geral").
  const currentViewName = teamId === '' ? 'Ranking Geral' : (selectedTeamName || titulo);

  // Todos os itens rodiziáveis: Ranking Geral ('') → cada time → Gerencial.
  const rotatable = useMemo(
    () => ['', ...teams.map(t => t.id), GRUPO_GERENCIAL],
    [teams],
  );
  // Nome legível de um item do rodízio.
  const rotItemName = useCallback(
    (v: string) => v === '' ? 'Ranking Geral'
      : v === GRUPO_GERENCIAL ? 'Gerencial e Diretoria'
      : (teams.find(t => t.id === v)?.name || v),
    [teams],
  );
  // Ciclo efetivo: só os itens ligados (não estão em rotateOff).
  const rotateCycle = useMemo(
    () => rotatable.filter(v => !rotateOff.has(v)),
    [rotatable, rotateOff],
  );
  const rotateIdx = rotateCycle.indexOf(teamId);
  const rotatePos = rotateIdx >= 0 ? rotateIdx + 1 : 1;

  const toggleRotateItem = useCallback((v: string) => {
    setRotateOff(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }, []);

  // Persiste os itens desligados na URL.
  useEffect(() => {
    setSearchParams(prev => {
      const q = new URLSearchParams(prev);
      if (rotateOff.size) q.set('rotoff', [...rotateOff].map(rotEnc).join(','));
      else q.delete('rotoff');
      return q;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotateOff]);

  // Persiste rotate/rotmin na URL (updater funcional pra não brigar com a troca
  // de ?team=).
  useEffect(() => {
    setSearchParams(prev => {
      const q = new URLSearchParams(prev);
      if (autoRotate) q.delete('rotate'); else q.set('rotate', '0');
      if (autoRotate && rotateMin !== 2) q.set('rotmin', String(rotateMin)); else q.delete('rotmin');
      return q;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRotate, rotateMin]);

  // Loop do rodízio: 1 tick/segundo pra contagem regressiva; ao zerar, avança pro
  // próximo time do ciclo. Trocar de time reinicia o cronômetro (dá tempo cheio a
  // cada visão, inclusive numa troca manual).
  useEffect(() => {
    if (!autoRotate || rotateCycle.length < 2) { setRotateLeft(0); return; }
    rotateDeadlineRef.current = Date.now() + rotateMin * 60_000;
    const tick = () => {
      const left = Math.max(0, Math.round((rotateDeadlineRef.current - Date.now()) / 1000));
      setRotateLeft(left);
      if (left <= 0) {
        const idx = rotateCycle.indexOf(teamId);
        const next = rotateCycle[(idx + 1) % rotateCycle.length] ?? '';
        rotateDeadlineRef.current = Date.now() + rotateMin * 60_000;
        onSelectTeam(next); // dispara re-run deste efeito (teamId muda)
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [autoRotate, rotateMin, rotateCycle, teamId, onSelectTeam]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data: res, error } = await (externalSupabase as any).rpc('tv_atividades_ranking', {
        p_since: periodSince(period).toISOString(),
        p_team_id: teamId && teamId !== GRUPO_GERENCIAL ? teamId : null,
        p_grupo: teamId === GRUPO_GERENCIAL ? GRUPO_GERENCIAL : null,
        // Granularidade do recorde (linha de chegada): dia/semana/mês.
        p_granularidade: period === 'hoje' ? 'dia' : period,
      });
      if (error) throw error;
      setData((res || { ranking: [], resumo: null, gerado_em: '' }) as Payload);
      setUpdatedAt(new Date());
    } catch (e) {
      console.error('[TvAtividades] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [period, teamId]);

  useEffect(() => { load(); }, [load]);

  // Auto-atualiza (telão sempre fresco).
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Carros escolhidos (Modo Corrida). SELECT direto — tabela isolada, não
  // encosta na RPC de ranking. Só busca quando o modo está ligado.
  const loadCars = useCallback(async () => {
    try {
      await ensureExternalSession();
      const { data: rows, error } = await (externalSupabase as any)
        .from('tv_race_cars')
        .select('nome_key, car_id, color');
      if (error) throw error;
      const map: Record<string, CarChoice> = {};
      for (const row of rows || []) map[row.nome_key] = { car_id: row.car_id, color: row.color };
      setCars(map);
    } catch (e) {
      console.warn('[TvAtividades] loadCars:', e);
    }
  }, []);
  useEffect(() => { if (raceMode) loadCars(); }, [raceMode, loadCars]);

  // Ausências de hoje pro pit stop. Só faz sentido no período "Hoje" (folga/
  // férias é do dia); em Semana/Mês a pessoa trabalhou os outros dias. Segue o
  // mesmo intervalo de refresh do telão.
  const loadTimeOff = useCallback(async () => {
    if (period !== 'hoje') { setTimeOffToday([]); return; }
    const rows = await getTimeOffForDate(format(new Date(), 'yyyy-MM-dd'));
    setTimeOffToday(rows);
  }, [period]);
  useEffect(() => { loadTimeOff(); }, [loadTimeOff]);
  useEffect(() => {
    const id = setInterval(loadTimeOff, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadTimeOff]);

  // Salva a escolha (upsert por nome_key) + atualização otimista no telão.
  const saveCar = useCallback(async (nome: string, car_id: string, color: string) => {
    const key = nameKey(nome);
    setCars(prev => ({ ...prev, [key]: { car_id, color } }));
    try {
      await ensureExternalSession();
      const { error } = await (externalSupabase as any)
        .from('tv_race_cars')
        .upsert({ nome_key: key, nome, car_id, color, updated_at: new Date().toISOString() });
      if (error) throw error;
    } catch (e) {
      console.warn('[TvAtividades] saveCar:', e);
    }
  }, []);

  const toggleRaceMode = useCallback(() => {
    setRaceMode(v => {
      const next = !v;
      const q = new URLSearchParams(params);
      // Corrida é o padrão: ligada → sem param; desligada → corrida=0 (pódio).
      if (next) q.delete('corrida'); else q.set('corrida', '0');
      setSearchParams(q, { replace: true });
      return next;
    });
  }, [params, setSearchParams]);

  const rawRanking = data?.ranking ?? [];
  // Quem está de folga/férias hoje → mapa por nome (fonte member_time_off).
  const offByKey = useMemo(() => {
    const m = new Map<string, TimeOffEntry>();
    for (const e of timeOffToday) {
      if (e.user_name) m.set(nameKey(e.user_name), e);
    }
    return m;
  }, [timeOffToday]);
  // Ranking exibível: tira os ausentes (só no período "Hoje"). Todos os efeitos
  // (pódio, corrida, recorde, ultrapassagem) já leem `ranking`, então some de tudo.
  const ranking = useMemo(
    () => offByKey.size ? rawRanking.filter(r => !offByKey.has(nameKey(r.nome))) : rawRanking,
    [rawRanking, offByKey],
  );
  // Pit stop: os que saíram do ranking + o motivo da ausência.
  const pit = useMemo(
    () => rawRanking
      .filter(r => offByKey.has(nameKey(r.nome)))
      .map(r => ({ nome: r.nome, entry: offByKey.get(nameKey(r.nome))! })),
    [rawRanking, offByKey],
  );
  // 🏅 Medalha de qualidade: melhor média do PERÍODO entre quem tem amostra
  // (>= 3 notas, o mesmo piso que a RPC usa pra ordenar) e nota de "Bom" pra
  // cima. Sem ninguém nessas condições, ninguém leva medalha — é assim que
  // deve ser: prêmio de qualidade não se dá por 1 nota solta.
  const medalhaQualidade = useMemo(() => {
    const MIN_MEDIA = 4;
    const candidatos = ranking
      .map(r => ({ nome: r.nome, q: r.qualidade == null ? null : Number(r.qualidade), n: r.notas_n || 0 }))
      .filter(c => c.q != null && c.q >= MIN_MEDIA) as { nome: string; q: number; n: number }[];
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => b.q - a.q || b.n - a.n || a.nome.localeCompare(b.nome));
    return candidatos[0].nome;
  }, [ranking]);

  const podium = useMemo(() => ranking.slice(0, 3), [ranking]);
  const list = useMemo(() => ranking.slice(3, 3 + LIST_MAX), [ranking]);
  const resumo = data?.resumo ?? null;

  // Chave da comparação de ordem: time + período + dia. A ordem anterior fica
  // guardada POR chave (não zerada na troca de time), senão o rodízio automático
  // — que troca de time a cada 2 min, contra um refresh de 45s — praticamente
  // nunca deixa duas leituras do mesmo time se compararem, e a ultrapassagem
  // nunca é narrada. Assim, ao voltar pro time, ele compara com a última ordem
  // que aquele time tinha. O dia entra na chave pra virada de período não
  // comparar com o ranking zerado e inventar ultrapassagem.
  const orderKey = `${teamId || 'all'}|${period}|${periodSince(period).toISOString().slice(0, 10)}`;

  const { vroom, recordSound, say, preset, setPreset, preview } = sfx;

  // Lista as vozes disponíveis quando o painel de som abre com o locutor ligado.
  useEffect(() => {
    if (!soundPanel || !sfx.narrator || vozes !== null || vozesLoading) return;
    setVozesLoading(true);
    sfx.listVoices()
      .then(setVozes)
      .finally(() => setVozesLoading(false));
  }, [soundPanel, sfx.narrator, sfx.listVoices, vozes, vozesLoading]);

  // Recorde do período/time = SERVIDOR (data.meta), sempre filtrado pelo time
  // selecionado — nada de localStorage, então não vaza entre times. O selo mostra
  // o recorde histórico a bater; ao vivo, se o topo do ranking o superar, comemora
  // (som do Airton) UMA vez por (time+período+valor) e o selo passa a exibir o novo.
  useEffect(() => {
    const recValue = data?.meta?.passos ?? 0;
    const recHolder = data?.meta?.nome ?? '';

    const top = ranking.length
      ? ranking.reduce((a, b) => (b.passos > a.passos ? b : a), ranking[0])
      : null;
    const beat = !!top && top.passos > recValue && top.passos > 0;

    // Selo: recorde ao vivo (se superado) ou o histórico do servidor.
    const shown: RecordMark | null = beat
      ? { value: top!.passos, holder: top!.nome }
      : (recValue > 0 ? { value: recValue, holder: recHolder } : null);
    setRecord(shown);
    recordRef.current = shown;
    if (!beat) return;

    // Comemora uma vez por recorde novo (evita repetir a cada refresh de 45s).
    const key = `${period}:${teamId || 'all'}:${periodSince(period).toISOString().slice(0, 10)}:${top!.passos}`;
    if (recordBucketRef.current === key) return;
    recordBucketRef.current = key;
    const now = Date.now();
    if (now - lastRecordRef.current >= 2000) {
      lastRecordRef.current = now;
      lastSfxRef.current = now; // suprime a zoada normal desta rodada
      recordSound();
      say(narracaoRecorde(shortName(top!.nome), top!.passos));
      setRecordHit({ value: top!.passos, holder: top!.nome });
      if (recordTimer.current) clearTimeout(recordTimer.current);
      recordTimer.current = setTimeout(() => setRecordHit(null), 8000);
    }
  }, [data?.meta, ranking, period, teamId, recordSound, say]);

  // Detecta ultrapassagens comuns → zoada + narração + banner (some sozinho).
  useEffect(() => {
    if (!ranking.length) return;
    const order = ranking.map(r => r.nome);
    const nextMap = new Map<string, number>();
    order.forEach((n, i) => nextMap.set(n, i));
    const prev = prevOrderRef.current.get(orderKey);
    prevOrderRef.current.set(orderKey, nextMap);
    if (!prev) return; // primeira leitura desta chave: só registra, sem alarme

    const evs = detectarUltrapassagens(prev, order, 2);
    if (!evs.length) return;
    // Cooldown compartilhado: se um recorde acabou de tocar, não repete a zoada.
    const now = Date.now();
    if (now - lastSfxRef.current < 3000) return;
    lastSfxRef.current = now;

    vroom();
    say(narracaoUltrapassagem(shortName(evs[0].a), shortName(evs[0].b)));
    setOvertakes(evs);
    if (overtakeTimer.current) clearTimeout(overtakeTimer.current);
    overtakeTimer.current = setTimeout(() => setOvertakes([]), 6000);
  }, [ranking, orderKey, vroom, say]);

  useEffect(() => () => {
    if (overtakeTimer.current) clearTimeout(overtakeTimer.current);
    if (recordTimer.current) clearTimeout(recordTimer.current);
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setTv(true)).catch(() => setTv(true));
    } else {
      document.exitFullscreen?.();
      setTv(false);
    }
  };
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setTv(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const periodLabel: Record<Period, string> = { hoje: 'HOJE', semana: 'DA SEMANA', mes: 'DO MÊS' };
  // Rótulo do RECORDE: "por dia/semana/mês" (não "hoje") — é a melhor marca de um
  // único dia/semana/mês já registrado, não o recorde de hoje.
  const recordeLabel: Record<Period, string> = { hoje: 'POR DIA', semana: 'POR SEMANA', mes: 'POR MÊS' };

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950 text-white overflow-x-hidden"
    >
      {/* ===== Selo do recorde (destaque no canto superior direito, telas largas) ===== */}
      {record && record.value > 0 && (
        <div className="pointer-events-none hidden min-[1900px]:flex absolute top-6 right-6 z-20 w-[176px] flex-col items-center gap-0.5 rounded-3xl border-2 border-amber-300/60 bg-gradient-to-br from-amber-400/25 via-amber-500/10 to-orange-500/10 px-4 pt-6 pb-4 text-center shadow-[0_0_55px_-10px] shadow-amber-400/50 backdrop-blur-sm">
          <span className="absolute -top-5 text-4xl drop-shadow-lg">🏆</span>
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
            Recorde {recordeLabel[period]}
          </span>
          <span className="text-5xl font-black leading-none tabular-nums text-amber-400 drop-shadow">
            {record.value}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">passos</span>
          <span className="mt-1 line-clamp-2 text-sm font-bold leading-tight text-white/90">
            {record.holder}
          </span>
        </div>
      )}
      {/* ===== Comemoração de RECORDE (some sozinho) ===== */}
      {recordHit && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4">
          <div className="flex flex-col items-center gap-2 rounded-3xl border-2 border-amber-300 bg-gradient-to-br from-amber-400 via-yellow-400 to-orange-500 px-8 py-6 text-slate-900 shadow-[0_0_80px_-10px] shadow-amber-400/70 animate-in fade-in zoom-in-95 duration-300">
            <span className="text-3xl md:text-5xl">🏁🏆🏁</span>
            <span className="text-xl md:text-4xl font-black uppercase tracking-tight">Novo Recorde!</span>
            <span className="text-base md:text-2xl font-black">
              {recordHit.holder} · <span className="tabular-nums">{recordHit.value}</span> passos
            </span>
          </div>
        </div>
      )}

      {/* ===== Painel: escolher e testar o som da ultrapassagem ===== */}
      {soundPanel && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSoundPanel(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-black">Som da ultrapassagem</h3>
              <button
                onClick={() => setSoundPanel(false)}
                className="rounded-full bg-white/10 px-2.5 py-1 text-sm font-black text-white/70 hover:text-white"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-xs text-white/50">
              Toca quando alguém ultrapassa sem bater o recorde. Clique em <b className="text-white/70">Testar</b> pra ouvir e escolha o seu.
            </p>
            <div className="space-y-2">
              {OVERTAKE_PRESETS.map(p => (
                <div
                  key={p.id}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border p-3 transition',
                    preset === p.id ? 'border-sky-400 bg-sky-400/10' : 'border-white/10 bg-white/[0.03]',
                  )}
                >
                  <button onClick={() => setPreset(p.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 text-sm font-black">
                      {preset === p.id ? (
                        <Check className="h-4 w-4 shrink-0 text-sky-400" />
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded-full border border-white/25" />
                      )}
                      {p.nome}
                    </div>
                    <div className="ml-6 text-xs text-white/50">{p.desc}</div>
                  </button>
                  <button
                    onClick={() => preview(p.id)}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white/80 transition hover:bg-white/20"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Testar
                  </button>
                </div>
              ))}
            </div>
            {/* Narração: voz de locutor (ElevenLabs) com a voz do navegador de
                reserva. O clique no teste também libera a fala no Chrome. */}
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black">Narração</div>
                  <div className="truncate text-xs text-white/50">
                    {sfx.narrator ? 'Voz de locutor' : 'Voz do navegador'}
                    {' · reserva: '}
                    {sfx.voiceName || 'nenhuma voz em português neste aparelho'}
                  </div>
                  {sfx.lastNarration && (
                    <div className="mt-0.5 text-[11px] text-white/40">
                      Última narração saiu {sfx.lastNarration === 'locutor' ? 'com a voz de locutor' : 'na voz do navegador'}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => sfx.sayPreview(narracaoUltrapassagem('Maria', 'João'))}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white/80 transition hover:bg-white/20"
                >
                  <Megaphone className="h-3.5 w-3.5" />
                  Testar voz
                </button>
              </div>
              {/* Seletor de locutor: lista as vozes da conta ElevenLabs. Pra
                  ter outra voz aqui, é só adicioná-la na conta — voz de pessoa
                  real só com autorização de quem fala. */}
              {sfx.narrator && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-bold text-white/60">Locutor</span>
                  <select
                    value={sfx.voiceId || ''}
                    onChange={e => sfx.setVoiceId(e.target.value || null)}
                    className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white"
                    disabled={vozesLoading}
                  >
                    <option value="">
                      {vozesLoading ? 'Carregando vozes…' : 'Padrão do sistema (Adam)'}
                    </option>
                    {(vozes || []).map(v => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.nome}
                        {v.genero ? ` · ${v.genero}` : ''}
                        {v.sotaque ? ` · ${v.sotaque}` : ''}
                      </option>
                    ))}
                  </select>
                  {vozes !== null && vozes.length === 0 && !vozesLoading && (
                    <span className="mt-1 block text-[11px] text-white/40">
                      Não consegui listar as vozes da conta ElevenLabs.
                    </span>
                  )}
                </label>
              )}

              {/* Estilos de frase: dá pra deixar só narração, só provocação, ou misturar. */}
              <div className="mt-3">
                <div className="mb-1 text-xs font-bold text-white/60">Estilo das frases</div>
                <div className="space-y-1.5">
                  {NARRATION_STYLES.map(s => {
                    const on = sfx.styles.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => sfx.setStyles(
                          on
                            ? sfx.styles.filter(x => x !== s.id)
                            : ([...sfx.styles, s.id] as NarrationStyleId[]),
                        )}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-lg border p-2 text-left transition',
                          on ? 'border-sky-400/60 bg-sky-400/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.06]',
                        )}
                        aria-pressed={on}
                      >
                        {on ? (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
                        ) : (
                          <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-white/25" />
                        )}
                        <span className="min-w-0">
                          <span className="block text-xs font-black">{s.nome}</span>
                          <span className="block text-[11px] italic text-white/45">“{s.exemplo}”</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => sfx.setNarrator(!sfx.narrator)}
                className={cn(
                  'mt-3 w-full rounded-lg px-3 py-2 text-xs font-bold transition',
                  sfx.narrator
                    ? 'bg-sky-400/15 text-sky-200 hover:bg-sky-400/25'
                    : 'bg-white/10 text-white/60 hover:bg-white/20',
                )}
                aria-pressed={sfx.narrator}
              >
                {sfx.narrator ? 'Voz de locutor ligada — clique para usar só a do navegador' : 'Ligar voz de locutor'}
              </button>
            </div>
            <p className="mt-4 text-[11px] text-white/40">
              O som do recorde (bater o topo de passos) é separado e usa o arquivo do Airton — este painel é só da ultrapassagem comum.
            </p>
          </div>
        </div>
      )}

      {/* ===== Painel: escolher quais times entram no rodízio ===== */}
      {rotatePanel && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setRotatePanel(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-black">Times no rodízio</h3>
              <button
                onClick={() => setRotatePanel(false)}
                className="rounded-full bg-white/10 px-2.5 py-1 text-sm font-black text-white/70 hover:text-white"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-white/50">
              Marque quem o telão deve mostrar no rodízio automático. {rotateCycle.length} de {rotatable.length} selecionados.
            </p>
            <div className="mb-3 flex gap-2">
              <button
                onClick={() => setRotateOff(new Set())}
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/70 hover:text-white"
              >
                Marcar todos
              </button>
              <button
                onClick={() => setRotateOff(new Set(rotatable))}
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/70 hover:text-white"
              >
                Desmarcar todos
              </button>
            </div>
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
              {rotatable.map(v => {
                const on = !rotateOff.has(v);
                return (
                  <button
                    key={v || 'geral'}
                    onClick={() => toggleRotateItem(v)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                      on ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-white/10 bg-white/[0.03]',
                    )}
                  >
                    {on ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border border-white/25" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">
                      {rotItemName(v)}
                    </span>
                    {v === '' && <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-white/40">Geral</span>}
                  </button>
                );
              })}
            </div>
            {rotateCycle.length < 2 && (
              <p className="mt-3 text-[11px] font-bold text-amber-300">
                Com menos de 2 selecionados o rodízio não alterna.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ===== Alerta de ultrapassagem (some sozinho) ===== */}
      {overtakes.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
          {overtakes.map((o, i) => (
            <div
              key={`${o.a}-${o.b}-${i}`}
              className="flex items-center gap-3 rounded-2xl border border-amber-200/50 bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 text-slate-900 shadow-2xl shadow-amber-500/40 animate-in fade-in slide-in-from-top-4 duration-300"
            >
              <span className="text-2xl md:text-3xl">🏁</span>
              <span className="text-base md:text-2xl font-black tracking-tight">
                <span className="uppercase">{shortName(o.a)}</span> ultrapassou{' '}
                <span className="uppercase">{shortName(o.b)}</span>!
              </span>
              <span className="text-2xl md:text-3xl">💨</span>
            </div>
          ))}
        </div>
      )}

      {/* max-w maior a partir do 2xl porque o ranking passou a dividir a tela com
          o painel de avaliação; o selo do recorde só volta a caber em ≥1900px. */}
      <div className="mx-auto max-w-6xl 2xl:max-w-[1400px] px-5 py-5 md:px-8 md:py-7">
        {/* ===== Cabeçalho ===== */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-2xl md:text-3xl font-black leading-none tracking-tight">
              R. <span className="text-amber-400">Prudêncio.</span>
            </div>
            <div className="mt-1 text-[10px] md:text-xs font-semibold uppercase tracking-widest text-white/50 truncate">
              Atividades ·{' '}
              <span className={cn(autoRotate && 'text-emerald-300 font-black')}>
                {currentViewName}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Ao Vivo</span>
            {updatedAt && (
              <span className="text-[10px] text-white/40 tabular-nums" title="Atualiza sozinho a cada 45 segundos">
                atualizado {format(updatedAt, 'HH:mm:ss')}
              </span>
            )}
          </div>

          <div className="text-right shrink-0">
            <div className="text-2xl md:text-3xl font-black leading-none tabular-nums">{format(now, 'HH:mm')}</div>
            <div className="text-[10px] md:text-xs text-white/50 mt-1">
              {cap(format(now, "EEEE, d 'De' MMMM", { locale: ptBR }))}
            </div>
          </div>
        </div>

        {/* ===== Faixa da regra ===== */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[11px] md:text-sm font-bold uppercase tracking-wider text-white/70">
          <span className="text-amber-400">🏆 Ranking {periodLabel[period]}</span>
          <span className="text-white/30">·</span>
          <span>1º <span className="text-yellow-300">Status Esperado</span></span>
          <span className="text-white/30">·</span>
          <span>2º <span className="text-amber-300">Fases</span></span>
          <span className="text-white/30">·</span>
          <span>3º <span className="text-lime-400">Objetivos</span></span>
          <span className="text-white/30">·</span>
          {/* Qualidade entra ACIMA do volume, com piso de amostra: só pontua
              quem tem 3+ notas no período; quem não tem fica neutro. */}
          <span>4º <span className="text-amber-400">Qualidade ⭐ (3+ notas)</span></span>
          <span className="text-white/30">·</span>
          <span>5º <span className="text-sky-400">Passos</span></span>
          <span className="text-white/30">·</span>
          <span>6º <span className="text-fuchsia-400">Itens do Checklist</span></span>
          <span className="text-white/30">·</span>
          <span>7º <span className="text-emerald-400">Concluídas</span></span>
          <span className="text-white/30">·</span>
          <span>8º <span className="text-rose-400">Menos Atrasadas</span></span>
          <span className="text-white/30">·</span>
          <span>9º <span className="text-emerald-300">Mais Pendências do Cliente Feitas</span></span>
          <span className="text-white/30">·</span>
          <span>10º <span className="text-cyan-400">Menos Pendências Faltando</span></span>
          <span className="text-white/30">·</span>
          <span>11º <span className="text-amber-300">Média ⭐ (desempate)</span></span>
          <span className="text-white/30">·</span>
          <span>12º <span className="text-pink-400">Menos Feedbacks sem Avaliar</span></span>
          <span className="text-white/30">·</span>
          <span>13º <span className="text-teal-400">Mais Tempo Ativo</span></span>
          <span className="text-white/30">·</span>
          <span>14º <span className="text-orange-400">Menos Ocioso</span></span>
          <span className="text-white/30">·</span>
          <span>15º <span className="text-violet-400">Resposta no Chat</span></span>
        </div>

        {/* ===== Pílula do recorde (telas < 2xl; no wide vira o selo do canto) ===== */}
        {record && record.value > 0 && (
          <div className="mt-3 flex justify-center min-[1900px]:hidden">
            <div className="flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-1.5 text-xs md:text-sm">
              <span className="text-base md:text-lg">🏆</span>
              <span className="font-black uppercase tracking-wider text-amber-300">Recorde {recordeLabel[period]}</span>
              <span className="text-white/40">·</span>
              <span className="font-bold text-white/90">{record.holder}</span>
              <span className="font-black tabular-nums text-amber-400">{record.value}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">passos</span>
            </div>
          </div>
        )}

        {/* ===== Controles (escondem no telão) ===== */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 rounded-full bg-white/10 text-white/70 hover:text-white text-xs font-semibold px-3 py-1.5 transition"
            title="Voltar para Atividades"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          <select
            value={teamId}
            onChange={e => onSelectTeam(e.target.value)}
            className="rounded-full bg-white/10 text-white text-xs font-semibold px-3 py-1.5 outline-none border border-white/10 max-w-[60vw] md:max-w-[16rem] [&>option]:text-slate-900"
            title="Filtrar por time"
          >
            <option value="">Todos os times</option>
            <option value={GRUPO_GERENCIAL}>Gerencial e Diretoria</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div className="flex items-center rounded-full bg-white/10 p-0.5 gap-0.5">
            {(['hoje', 'semana', 'mes'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-semibold transition',
                  period === p ? 'bg-white text-slate-900' : 'text-white/60 hover:text-white'
                )}
              >
                {p === 'hoje' ? 'Hoje' : p === 'semana' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
          {/* Rodízio automático de times: liga/desliga + minutos por time. */}
          <div className={cn(
            'flex items-center gap-1 rounded-full p-0.5 pl-2 transition',
            autoRotate ? 'bg-emerald-400/20 ring-1 ring-emerald-400/50' : 'bg-white/10',
          )}>
            <button
              onClick={() => setAutoRotate(v => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black transition',
                autoRotate ? 'text-emerald-300' : 'text-white/60 hover:text-white',
              )}
              title="Alternar times automaticamente no telão"
              aria-pressed={autoRotate}
            >
              <RotateCw className={cn('h-4 w-4', autoRotate && 'animate-spin [animation-duration:3s]')} />
              Auto
            </button>
            <input
              type="number"
              min={1}
              max={60}
              value={rotateMin}
              onChange={e => {
                const v = Math.min(60, Math.max(1, Math.round(Number(e.target.value) || 1)));
                setRotateMin(v);
              }}
              className="w-11 rounded-full bg-white/10 px-2 py-1 text-center text-xs font-bold tabular-nums text-white outline-none border border-white/10"
              title="Minutos em cada time"
              aria-label="Minutos por time"
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">min</span>
            <button
              onClick={() => setRotatePanel(true)}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider transition',
                rotateOff.size ? 'bg-emerald-400/20 text-emerald-300' : 'text-white/60 hover:text-white',
              )}
              title="Escolher quais times entram no rodízio"
            >
              <ListChecks className="h-3.5 w-3.5" />
              {rotateCycle.length}/{rotatable.length}
            </button>
          </div>
          <button
            onClick={load}
            className="rounded-full bg-white/10 p-2 text-white/70 hover:text-white transition"
            title="Atualizar"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="rounded-full bg-white/10 p-2 text-white/70 hover:text-white transition"
            title="Modo TV / tela cheia"
          >
            {tv ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={toggleRaceMode}
            className={cn(
              'flex items-center gap-1.5 rounded-full text-xs font-black px-3.5 py-1.5 transition',
              raceMode ? 'bg-emerald-400 text-slate-900 hover:bg-emerald-300' : 'bg-white/10 text-white/70 hover:text-white',
            )}
            title="Alternar entre pódio e pista de corrida"
          >
            <Flag className="h-4 w-4" />
            {raceMode ? 'Ver pódio' : 'Modo Corrida'}
          </button>
          <button
            onClick={() => setCarteiraMode(v => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-full text-xs font-black px-3.5 py-1.5 transition',
              carteiraMode ? 'bg-emerald-400 text-slate-900 hover:bg-emerald-300' : 'bg-white/10 text-white/70 hover:text-white',
            )}
            title="Atividade concluída ao lado de processo que andou"
          >
            <Briefcase className="h-4 w-4" />
            {carteiraMode ? 'Voltar ao ranking' : 'Carteira'}
          </button>
          {/* Música do telão: play/pausa + volume (aparece só tocando). */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={music.toggle}
              className={cn(
                'flex items-center gap-1.5 rounded-full text-xs font-black px-3.5 py-1.5 transition',
                music.playing ? 'bg-sky-400 text-slate-900 hover:bg-sky-300' : 'bg-white/10 text-white/70 hover:text-white',
              )}
              title={music.playing ? 'Pausar a trilha' : 'Tocar a trilha pra dar energia'}
            >
              {music.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {music.playing ? 'Pausar' : 'Música'}
            </button>
            {music.playing && (
              <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5">
                <Volume2 className="h-4 w-4 text-white/60 shrink-0" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(music.volume * 100)}
                  onChange={e => music.setVolume(Number(e.target.value) / 100)}
                  className="h-1 w-16 md:w-20 cursor-pointer accent-sky-400"
                  title="Volume da trilha"
                  aria-label="Volume da música"
                />
              </div>
            )}
          </div>
          <button
            onClick={() => sfx.setEnabled(!sfx.enabled)}
            className={cn(
              'flex items-center gap-1.5 rounded-full text-xs font-black px-3.5 py-1.5 transition',
              sfx.enabled ? 'bg-orange-400 text-slate-900 hover:bg-orange-300' : 'bg-white/10 text-white/60 hover:text-white',
            )}
            title="Zoada de aceleração + narração quando alguém ultrapassa"
            aria-pressed={sfx.enabled}
          >
            {sfx.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            Ultrapassagem
          </button>
          <button
            onClick={() => setSoundPanel(true)}
            className="flex items-center gap-1.5 rounded-full bg-white/10 text-white/70 hover:text-white text-xs font-black px-3.5 py-1.5 transition"
            title="Escolher e testar o som da ultrapassagem"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Sons
          </button>
          <button
            onClick={() => setBroadcast(true)}
            disabled={ranking.length === 0}
            className="flex items-center gap-1.5 rounded-full bg-amber-400 text-slate-900 text-xs font-black px-3.5 py-1.5 transition hover:bg-amber-300 disabled:opacity-40"
            title="Enviar a mensagem coach de cada um pra todos de uma vez"
          >
            <Megaphone className="h-4 w-4" />
            Mensagem pra todos
          </button>
        </div>

        {/* ===== Destaque do rodízio: time atual + contagem pra próxima troca ===== */}
        {autoRotate && rotateCycle.length >= 2 && (
          <div className="mt-4 flex justify-center">
            <div className="flex items-center gap-3 rounded-2xl border-2 border-emerald-400/50 bg-emerald-400/10 px-5 py-2.5 shadow-[0_0_45px_-12px] shadow-emerald-400/60">
              <RotateCw className="h-5 w-5 shrink-0 text-emerald-300 animate-spin [animation-duration:3s]" />
              <span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-emerald-300/80">
                Mostrando
              </span>
              <span className="text-lg md:text-2xl font-black leading-none text-emerald-200">
                {currentViewName}
              </span>
              <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] md:text-xs font-black tabular-nums text-emerald-300">
                {rotatePos}/{rotateCycle.length}
              </span>
              <span className="text-emerald-400/40">·</span>
              <span className="flex items-center gap-1.5 text-white/80">
                <Timer className="h-4 w-4 shrink-0 text-emerald-300" />
                <span className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-white/50">Troca em</span>
                <span className="text-lg md:text-2xl font-black tabular-nums text-white">{fmtMMSS(rotateLeft)}</span>
              </span>
            </div>
          </div>
        )}

        {carteiraMode ? (
          /* Esforço x resultado. Independe do ranking ter linhas: a carteira
             vem de process_owners() e existe mesmo numa semana sem atividade. */
          <TvCarteiraPanel rows={ranking} refreshMs={tv ? 60_000 : 0} />
        ) : (
          /* Ranking de atividades e Top de Avaliação lado a lado, ambos do time
             que o rodízio está mostrando. Abaixo de xl a avaliação empilha
             embaixo — nunca por cima. */
          <div className="mt-2 grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
            {ranking.length === 0 && pit.length === 0 ? (
              <div className="py-24 text-center text-white/50 text-lg">
                {loading ? 'Carregando…' : 'Sem atividades no período.'}
              </div>
            ) : raceMode ? (
              <>
                {/* ===== Pista de corrida (todos os pilotos) ===== */}
                <WackyRaceTrack
                  ranking={ranking}
                  cars={cars}
                  onSaveCar={saveCar}
                  onAnalyze={(row, rank) => setCoach({ row: { doc_itens: 0, media_estrelas: null, notas_n: 0, fb_pendentes: 0, pend_feitas: 0, pend_cliente: 0, ...(row as RaceRow) } as RankRow, rank })}
                  onDetail={(row, criterio, count) => setDetail({ nome: row.nome, criterio, count })}
                  meta={data?.meta?.passos}
                  periodo={period}
                  medalhaQualidade={medalhaQualidade}
                />

                {/* ===== Pit stop (de folga hoje) ===== */}
                <PitStop pit={pit} />

                {/* ===== Rodapé ===== */}
                <Footer resumo={resumo} participantes={ranking.length} ranking={ranking} />
              </>
            ) : (
              <>
                {/* ===== Pódio ===== */}
                <Podium
                  podium={podium}
                  onSelect={(row, rank) => setCoach({ row, rank })}
                  onDetail={(row, criterio, count) => setDetail({ nome: row.nome, criterio, count })}
                  medalhaQualidade={medalhaQualidade}
                />

                {/* ===== Lista 4..10 ===== */}
                <div className="mt-5 space-y-2">
                  {list.map((r, i) => (
                    <ListRow
                      key={r.nome}
                      rank={i + 4}
                      row={r}
                      onSelect={() => setCoach({ row: r, rank: i + 4 })}
                      onDetail={(criterio, count) => setDetail({ nome: r.nome, criterio, count })}
                      medalha={!!medalhaQualidade && r.nome === medalhaQualidade}
                    />
                  ))}
                </div>

                {/* ===== Pit stop (de folga hoje) ===== */}
                <PitStop pit={pit} />

                {/* ===== Rodapé ===== */}
                <Footer resumo={resumo} participantes={ranking.length} ranking={ranking} />
              </>
            )}
            </div>

            {/* ===== Top de Avaliação do mesmo time (janela de 30 dias) ===== */}
            <TvAvaliacaoPanel
              teamId={teamId && teamId !== GRUPO_GERENCIAL ? teamId : null}
              grupo={teamId === GRUPO_GERENCIAL ? GRUPO_GERENCIAL : null}
              teamName={currentViewName}
            />
          </div>
        )}
      </div>

      {broadcast && (
        <TeamBroadcastDialog
          teamId={teamId && teamId !== GRUPO_GERENCIAL ? teamId : null}
          grupo={teamId === GRUPO_GERENCIAL ? GRUPO_GERENCIAL : null}
          teamName={selectedTeamName || titulo}
          period={period}
          onClose={() => setBroadcast(false)}
        />
      )}

      {detail && (
        <RankDetailSheet
          nome={detail.nome}
          criterio={detail.criterio}
          count={detail.count}
          since={periodSince(period).toISOString()}
          periodLabel={period === 'hoje' ? 'hoje' : period === 'mes' ? 'mês' : 'semana'}
          onAbrirProcesso={id => setProcessoAberto(id)}
          onClose={() => setDetail(null)}
        />
      )}

      {/* Ficha completa do processo por cima do detalhe — fechar volta pra lista. */}
      {processoAberto && (
        <Suspense fallback={null}>
          <ProcessQuickSheet processId={processoAberto} onClose={() => setProcessoAberto(null)} />
        </Suspense>
      )}

      {coach && (
        <PerformanceCoachDialog
          row={coach.row}
          rank={coach.rank}
          since={periodSince(period).toISOString()}
          teamId={teamId && teamId !== GRUPO_GERENCIAL ? teamId : null}
          grupo={teamId === GRUPO_GERENCIAL ? GRUPO_GERENCIAL : null}
          periodLabel={period === 'hoje' ? 'hoje' : period === 'mes' ? 'mês' : 'semana'}
          onDetail={(criterio, count) => setDetail({ nome: coach.row.nome, criterio, count })}
          onClose={() => setCoach(null)}
        />
      )}
    </div>
  );
}

/* ---------- Pódio ---------- */
type OnDetail = (row: RankRow, criterio: DetailCriterio, count: number | string) => void;

function Podium({ podium, onSelect, onDetail, medalhaQualidade }: { podium: RankRow[]; onSelect: (row: RankRow, rank: number) => void; onDetail: OnDetail; medalhaQualidade?: string | null }) {
  // Ordem visual: 2º (esq) · 1º (centro) · 3º (dir).
  const first = podium[0];
  const second = podium[1];
  const third = podium[2];
  return (
    <div className="mt-6 grid grid-cols-3 items-end gap-2 md:gap-4">
      <PodiumSpot row={second} place={2} onSelect={onSelect} onDetail={onDetail} medalha={!!medalhaQualidade && second?.nome === medalhaQualidade} />
      <PodiumSpot row={first} place={1} onSelect={onSelect} onDetail={onDetail} medalha={!!medalhaQualidade && first?.nome === medalhaQualidade} />
      <PodiumSpot row={third} place={3} onSelect={onSelect} onDetail={onDetail} medalha={!!medalhaQualidade && third?.nome === medalhaQualidade} />
    </div>
  );
}

function PodiumSpot({ row, place, onSelect, onDetail, medalha }: { row: RankRow | undefined; place: 1 | 2 | 3; onSelect: (row: RankRow, rank: number) => void; onDetail: OnDetail; medalha?: boolean }) {
  if (!row) return <div />;
  const cfg = {
    1: { ring: 'ring-amber-400', glow: 'shadow-[0_0_45px_-5px] shadow-amber-400/60', bar: 'from-amber-400 to-amber-600', size: 'h-24 w-24 md:h-32 md:w-32 text-3xl md:text-4xl', barH: 'h-24 md:h-32', badge: 'bg-amber-400 text-slate-900', num: 'text-amber-300' },
    2: { ring: 'ring-slate-300', glow: 'shadow-[0_0_25px_-8px] shadow-slate-300/50', bar: 'from-slate-300 to-slate-500', size: 'h-20 w-20 md:h-24 md:w-24 text-2xl md:text-3xl', barH: 'h-16 md:h-20', badge: 'bg-slate-300 text-slate-900', num: 'text-slate-200' },
    3: { ring: 'ring-orange-400', glow: 'shadow-[0_0_25px_-8px] shadow-orange-400/50', bar: 'from-orange-400 to-orange-700', size: 'h-20 w-20 md:h-24 md:w-24 text-2xl md:text-3xl', barH: 'h-12 md:h-16', badge: 'bg-orange-400 text-slate-900', num: 'text-orange-300' },
  }[place];

  return (
    <div
      className="flex flex-col items-center cursor-pointer group"
      onClick={() => onSelect(row, place)}
      title={`Analisar desempenho de ${row.nome}`}
    >
      <div className="relative transition-transform group-hover:scale-105">
        {place === 1 && (
          <Crown className="absolute -top-6 left-1/2 -translate-x-1/2 h-7 w-7 md:h-9 md:w-9 text-amber-400 drop-shadow" />
        )}
        <div className={cn('rounded-full ring-4 flex items-center justify-center font-black', colorFor(row.nome), cfg.ring, cfg.glow, cfg.size)}>
          {initials(row.nome)}
        </div>
        <div className={cn('absolute -bottom-1 -right-1 h-7 w-7 rounded-full flex items-center justify-center text-sm font-black ring-2 ring-slate-900', cfg.badge)}>
          {place}
        </div>
      </div>

      <div className="mt-3 text-center px-1">
        <div className="font-bold leading-tight text-sm md:text-lg line-clamp-2">
          {row.nome}
          {row.home_office && <span className="ml-1" title="Home office">🏠</span>}
          {medalha && (
            <span className="ml-1" title={`Melhor avaliação do período (${row.media_estrelas} em ${row.notas_n} notas)`}>🏅</span>
          )}
        </div>
        <div className={cn('mt-1 font-black leading-none', place === 1 ? 'text-4xl md:text-5xl' : 'text-3xl md:text-4xl', cfg.num)}>
          <span
            className="cursor-pointer rounded px-0.5 transition hover:bg-white/10 hover:ring-1 hover:ring-white/25"
            title={`Ver os ${row.passos} passos de ${row.nome}`}
            onClick={e => { e.stopPropagation(); onDetail(row, 'passos', row.passos); }}
          >
            {row.passos}
          </span>
          <span className="ml-1 text-[10px] md:text-xs font-bold uppercase tracking-widest text-white/50">passos</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
          <PodiumStat text={row.resultado ?? 0} label="status" color="text-yellow-300" onClick={() => onDetail(row, 'status', row.resultado ?? 0)} />
          <PodiumStat text={row.fases ?? 0} label="fases" color="text-amber-300" onClick={() => onDetail(row, 'fases', row.fases ?? 0)} />
          <PodiumStat text={row.objetivos ?? 0} label="objetivos" color="text-lime-400" onClick={() => onDetail(row, 'objetivos', row.objetivos ?? 0)} />
          <PodiumStat text={row.doc_itens ?? 0} label="checklist" color="text-fuchsia-400" />
          <PodiumStat text={row.concluidas} label="concl" color="text-emerald-400" onClick={() => onDetail(row, 'concluidas', row.concluidas)} />
          <PodiumStat text={row.atrasadas} label="atras" color="text-rose-400" onClick={() => onDetail(row, 'atrasadas', row.atrasadas)} />
          <PodiumStat
            text={row.pend_feitas ?? 0}
            label="pend feitas"
            color="text-emerald-300"
            onClick={() => onDetail(row, 'pend_feitas', row.pend_feitas ?? 0)}
          />
          <PodiumStat
            text={row.pend_cliente ?? 0}
            label="pend faltam"
            color="text-cyan-400"
            onClick={() => onDetail(row, 'pend_cliente', row.pend_cliente ?? 0)}
          />
          <PodiumStat
            text={estrelaLabel(row.media_estrelas)}
            label="⭐"
            color="text-amber-400"
            onClick={() => onDetail(row, 'estrelas', estrelaLabel(row.media_estrelas))}
          />
          <PodiumStat
            text={row.fb_pendentes ?? 0}
            label="s/ avaliar"
            color="text-pink-400"
            onClick={() => onDetail(row, 'fb_pendentes', row.fb_pendentes ?? 0)}
          />
          <PodiumStat text={aprovLabel(row.aprov_pct)} label="aprov" color="text-amber-400" />
          <PodiumStat text={tempoLabel(row.ativo_seg)} label="ativo" color="text-teal-400" />
          <PodiumStat text={tempoLabel(row.ocioso_seg)} label="ocioso" color="text-orange-400" />
          <PodiumStat text={chatRespLabel(row.chat_resp_seg)} label="chat" color="text-violet-400" />
        </div>
        {/* Dica de clique — espaço reservado pra não deslocar o pódio no hover */}
        <div className="mt-1 h-4 text-[10px] font-black uppercase tracking-wider text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity">
          🏁 Clique pra analisar &amp; mandar mensagem
        </div>
      </div>

      <div className={cn('mt-3 w-full max-w-[9rem] rounded-t-lg bg-gradient-to-b flex items-start justify-center pt-2', cfg.bar, cfg.barH)}>
        <span className="text-2xl md:text-3xl font-black text-slate-900/80">{place}</span>
      </div>
    </div>
  );
}

/* ---------- Linha da lista ---------- */
function ListRow({ rank, row, onSelect, onDetail, medalha }: { rank: number; row: RankRow; onSelect: () => void; onDetail: (criterio: DetailCriterio, count: number | string) => void; medalha?: boolean }) {
  return (
    <div
      className="relative group flex items-center gap-3 rounded-xl bg-white/[0.04] border border-white/5 px-3 py-2.5 md:px-4 md:py-3 cursor-pointer transition hover:bg-white/[0.08]"
      onClick={onSelect}
      title={`Analisar desempenho de ${row.nome}`}
    >
      {/* Dica de clique — aparece por cima das colunas no hover */}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-black text-slate-900 shadow-lg">
        🏁 Analisar &amp; mandar mensagem
      </span>
      <div className="w-5 text-center text-sm md:text-base font-bold text-white/40 tabular-nums">{rank}</div>
      <div className={cn('h-9 w-9 md:h-11 md:w-11 shrink-0 rounded-full flex items-center justify-center text-xs md:text-sm font-black', colorFor(row.nome))}>
        {initials(row.nome)}
      </div>
      <div className="min-w-0 flex-1 font-semibold text-sm md:text-lg truncate">
        {row.nome}
        {row.home_office && <span className="ml-1" title="Home office">🏠</span>}
        {medalha && (
          <span className="ml-1" title={`Melhor avaliação do período (${row.media_estrelas} em ${row.notas_n} notas)`}>🏅</span>
        )}
      </div>
      <Stat value={row.resultado ?? 0} label="status" color="text-yellow-300" onClick={() => onDetail('status', row.resultado ?? 0)} />
      <Stat value={row.fases ?? 0} label="fases" color="text-amber-300" onClick={() => onDetail('fases', row.fases ?? 0)} />
      <Stat value={row.objetivos ?? 0} label="obj" color="text-lime-400" onClick={() => onDetail('objetivos', row.objetivos ?? 0)} />
      <Stat value={row.passos} label="passos" color="text-sky-400" onClick={() => onDetail('passos', row.passos)} />
      <Stat value={row.doc_itens ?? 0} label="check" color="text-fuchsia-400" />
      <Stat value={row.concluidas} label="concl" color="text-emerald-400" onClick={() => onDetail('concluidas', row.concluidas)} />
      <Stat value={row.atrasadas} label="atr" color="text-rose-400" onClick={() => onDetail('atrasadas', row.atrasadas)} />
      <Stat
        value={row.pend_feitas ?? 0}
        label="pend ok"
        color="text-emerald-300"
        onClick={() => onDetail('pend_feitas', row.pend_feitas ?? 0)}
      />
      <Stat
        value={row.pend_cliente ?? 0}
        label="pend falta"
        color="text-cyan-400"
        onClick={() => onDetail('pend_cliente', row.pend_cliente ?? 0)}
      />
      <Stat
        value={estrelaLabel(row.media_estrelas)}
        label="⭐"
        color="text-amber-400"
        onClick={() => onDetail('estrelas', estrelaLabel(row.media_estrelas))}
      />
      <Stat
        value={row.fb_pendentes ?? 0}
        label="s/ aval"
        color="text-pink-400"
        onClick={() => onDetail('fb_pendentes', row.fb_pendentes ?? 0)}
      />
      <div className="w-14 md:w-20 text-right">
        <span className="text-base md:text-xl font-black tabular-nums text-teal-400">{tempoLabel(row.ativo_seg)}</span>
        <span className="ml-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-white/40">ativo</span>
      </div>
      <div className="w-14 md:w-20 text-right">
        <span className="text-base md:text-xl font-black tabular-nums text-orange-400">{tempoLabel(row.ocioso_seg)}</span>
        <span className="ml-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-white/40">ocioso</span>
      </div>
      <div className="w-14 md:w-20 text-right">
        <span className="text-base md:text-xl font-black tabular-nums text-violet-400">{chatRespLabel(row.chat_resp_seg)}</span>
        <span className="ml-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-white/40">chat</span>
      </div>
      <div className="w-12 md:w-16 text-right">
        <div className="text-base md:text-xl font-black text-amber-400 tabular-nums">{aprovLabel(row.aprov_pct)}</div>
      </div>
    </div>
  );
}

function Stat({ value, label, color, onClick }: { value: number | string; label: string; color: string; onClick?: () => void }) {
  return (
    <div className="w-12 md:w-20 text-right">
      <span
        className={cn(
          'text-base md:text-xl font-black tabular-nums',
          color,
          onClick && 'cursor-pointer rounded px-0.5 transition hover:bg-white/10 hover:ring-1 hover:ring-white/25'
        )}
        title={onClick ? `Ver detalhe de ${label}` : undefined}
        onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
      >
        {value}
      </span>
      <span className="ml-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-white/40">{label}</span>
    </div>
  );
}

// Stat do pódio (top 3): mesmo tamanho de valor das linhas 4+ (text-base md:text-xl),
// em vez do texto minúsculo anterior. Aceita número (concl/atras/checklist) ou
// string já formatada (tempo/aprov/chat).
function PodiumStat({ text, label, color, onClick }: { text: string | number; label: string; color: string; onClick?: () => void }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className={cn(
          'text-base md:text-xl font-black tabular-nums',
          color,
          onClick && 'cursor-pointer rounded px-0.5 transition hover:bg-white/10 hover:ring-1 hover:ring-white/25'
        )}
        title={onClick ? `Ver detalhe de ${label}` : undefined}
        onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
      >
        {text}
      </span>
      <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-white/40">{label}</span>
    </span>
  );
}

/* ---------- Pit stop (de folga hoje) ---------- */
// Quem está de folga/férias/compensação hoje sai da corrida e descansa no box.
// Emoji por tipo de ausência (mesma leitura da aba Férias).
const TIME_OFF_EMOJI: Record<string, string> = {
  ferias: '🌴',
  compensacao: '⏱️',
  folga: '☕',
};
function PitStop({ pit }: { pit: { nome: string; entry: TimeOffEntry }[] }) {
  if (pit.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 md:p-4">
      <div className="mb-2 flex items-center gap-2 px-1 text-[10px] md:text-xs font-black uppercase tracking-widest text-white/50">
        <span>🅿️ Pit stop</span>
        <span className="text-white/30">·</span>
        <span className="text-amber-300">de folga hoje ({pit.length})</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {pit.map(({ nome, entry }) => (
          <div
            key={nome}
            className="flex items-center gap-2 rounded-full bg-slate-950/50 border border-white/5 pl-1 pr-3 py-1"
            title={entry.note || undefined}
          >
            <span className={cn('h-7 w-7 md:h-8 md:w-8 shrink-0 rounded-full flex items-center justify-center text-[10px] md:text-xs font-black opacity-80', colorFor(nome))}>
              {initials(nome)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs md:text-sm font-bold text-white/80">{nome}</span>
              <span className="block text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-white/45">
                {TIME_OFF_EMOJI[entry.type] ?? '💤'} {TIME_OFF_TYPE_LABELS[entry.type] ?? entry.type}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Rodapé ---------- */
function Footer({ resumo, participantes, ranking }: { resumo: Resumo | null; participantes: number; ranking: RankRow[] }) {
  // Escritório × home office: média de passos e concluídas por pessoa em cada
  // regime. Só aparece quando os dois grupos têm gente no ranking do período.
  const regime = useMemo(() => {
    const home = ranking.filter(r => r.home_office);
    const office = ranking.filter(r => !r.home_office);
    if (!home.length || !office.length) return null;
    const media = (rows: RankRow[], key: 'passos' | 'concluidas') =>
      Math.round((rows.reduce((s, r) => s + r[key], 0) / rows.length) * 10) / 10;
    return {
      office: { n: office.length, passos: media(office, 'passos'), concluidas: media(office, 'concluidas') },
      home: { n: home.length, passos: media(home, 'passos'), concluidas: media(home, 'concluidas') },
    };
  }, [ranking]);

  return (
    <div className="mt-6 space-y-3">
      {regime && (
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 rounded-xl bg-white/[0.04] border border-white/5 px-4 py-2.5 text-xs md:text-sm text-white/70">
          <span className="font-black uppercase tracking-wider text-white/50">Escritório × Home office</span>
          <span>
            🏢 <b className="text-sky-400">{regime.office.passos}</b> passos ·{' '}
            <b className="text-emerald-400">{regime.office.concluidas}</b> concl. /pessoa
            <span className="text-white/40"> ({regime.office.n})</span>
          </span>
          <span>
            🏠 <b className="text-sky-400">{regime.home.passos}</b> passos ·{' '}
            <b className="text-emerald-400">{regime.home.concluidas}</b> concl. /pessoa
            <span className="text-white/40"> ({regime.home.n})</span>
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="grid grid-cols-3 gap-3 rounded-xl bg-white/[0.04] border border-white/5 p-4">
        <FooterStat value={resumo ? `${resumo.trabalhando_h}h` : '—'} label="Trabalhando (7d)" color="text-emerald-400" />
        <FooterStat value={resumo ? `${resumo.ocioso_h}h` : '—'} label="Ocioso (7d)" color="text-amber-400" />
        <FooterStat value={resumo?.aproveitamento_pct != null ? `${resumo.aproveitamento_pct}%` : '—'} label="Aproveitamento" color="text-sky-400" />
      </div>
      <div className="rounded-xl bg-white/[0.04] border border-white/5 p-4 text-[11px] md:text-xs leading-relaxed text-white/60">
        <p className="flex gap-2">
          <Trophy className="h-4 w-4 shrink-0 text-amber-400" />
          <span><b className="text-white/80">Tempo</b> só de quem usa o cronômetro (7 dias).</span>
        </p>
        <p className="mt-1.5 flex gap-2">
          <span className="text-sky-400">◷</span>
          <span><b className="text-white/80">Ordem</b>: 1º fases fechadas, 2º objetivos concluídos, 3º passos, 4º itens do checklist, 5º concluídas, e no empate seguem menos atrasadas, mais pendências do cliente cumpridas no período, menos pendências faltando, melhor média de estrelas, menos feedbacks sem avaliar, mais tempo ativo, menos ocioso e resposta no chat (média do período; respostas em até 8h). <b className="text-white/80">Fase/objetivo</b> = checklist do processo fechado, creditado a quem marcou o último passo. <b className="text-white/80">⭐</b> = média das notas que a pessoa recebeu no período (feedback avaliado por quem observa); <b className="text-white/80">s/ avaliar</b> = feedbacks esperando a avaliação dela, backlog total; <b className="text-white/80">pend feitas</b> = o que o cliente ficou de fazer e cumpriu no período; <b className="text-white/80">pend faltam</b> = as que continuam em aberto (backlog total). Nos dois casos valem os casos sob responsabilidade dela — o responsável é o mesmo da caixa de pendências, e pendência de caso sem responsável definido não conta para ninguém. {participantes} no ranking.</span>
        </p>
      </div>
      </div>
    </div>
  );
}

function FooterStat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="text-center md:text-left">
      <div className={cn('text-2xl md:text-3xl font-black leading-none', color)}>{value}</div>
      <div className="mt-1 text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-white/40">{label}</div>
    </div>
  );
}
