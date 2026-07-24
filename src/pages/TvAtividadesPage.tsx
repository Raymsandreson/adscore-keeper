import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Crown, RefreshCw, Maximize2, Minimize2, Trophy, Megaphone, Flag, Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { format, startOfDay, startOfWeek, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import PerformanceCoachDialog from '@/components/tv/PerformanceCoachDialog';
import TeamBroadcastDialog from '@/components/tv/TeamBroadcastDialog';
import WackyRaceTrack, { nameKey, type CarChoice } from '@/components/tv/WackyRaceTrack';
import { useRaceMusic } from '@/hooks/useRaceMusic';
import { useRaceSfx, detectarUltrapassagens, type Ultrapassagem } from '@/hooks/useRaceSfx';

// /tv/atividades — Telão do "Ranking de Atividades" do time.
// Dados AO VIVO do Supabase Externo via RPC `tv_atividades_ranking`, que já
// aplica a regra de ordenação: 1º PASSOS → 2º ITENS DO CHECKLIST → 3º CONCLUÍDAS
// → 4º menos ATRASADAS → 5º mais TEMPO ATIVO → 6º menos OCIOSO → 7º RESPOSTA NO CHAT.
// Feito para rodar num telão em fullscreen; auto-atualiza sozinho.

type Period = 'hoje' | 'semana' | 'mes';

interface RankRow {
  nome: string;
  passos: number;
  doc_itens: number;
  concluidas: number;
  atrasadas: number;
  aprov_pct: number | null;
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
interface Payload {
  ranking: RankRow[];
  resumo: Resumo | null;
  gerado_em: string;
}

const REFRESH_MS = 45_000;
const LIST_MAX = 7; // linhas abaixo do pódio (posições 4..10)
// Valor sentinela no seletor de time: só gestores de time + diretoria
// (team_managers + org_directors no Externo; a RPC resolve via p_grupo).
const GRUPO_GERENCIAL = 'gerencial';

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

// ---- Recorde de passos do período ----
interface RecordMark { value: number; holder: string; }
// Chave por período + time + data-base: 'hoje' usa a data do dia, 'semana' a
// segunda-feira, 'mes' o dia 1 — então o recorde reseta sozinho ao virar, e
// cada filtro de time tem o seu (evita recorde falso ao trocar de time).
function recordBucketKey(period: Period, teamId: string, since: Date): string {
  return `${period}:${teamId}:${since.toISOString().slice(0, 10)}`;
}
function loadRecord(bucket: string): RecordMark | null {
  try {
    const raw = window.localStorage.getItem(`telao_record:${bucket}`);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.value === 'number' && typeof p?.holder === 'string') return p as RecordMark;
  } catch {
    /* ignora */
  }
  return null;
}
function saveRecord(bucket: string, mark: RecordMark) {
  try {
    window.localStorage.setItem(`telao_record:${bucket}`, JSON.stringify(mark));
  } catch {
    /* ignora */
  }
}

export default function TvAtividadesPage() {
  const [params, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const titulo = params.get('titulo') || 'Time Processual';

  const [period, setPeriod] = useState<Period>('hoje');
  const [teamId, setTeamId] = useState<string>(params.get('team') || ''); // '' = todos os times
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [tv, setTv] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // Coach de desempenho: clicar num assessor abre o painel de análise + mensagem.
  const [coach, setCoach] = useState<{ row: RankRow; rank: number } | null>(null);
  // "Mensagem pra todos": dispara a coach personalizada de cada um do ranking.
  const [broadcast, setBroadcast] = useState(false);
  // Modo Corrida: o ranking vira pista estilo cartoon. Escolha de carro por nome.
  // É a visualização PADRÃO; só `?corrida=0` cai no pódio clássico.
  const [raceMode, setRaceMode] = useState(params.get('corrida') !== '0');
  const [cars, setCars] = useState<Record<string, CarChoice>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Trilha do telão: play/pausa manual pra dar energia ao ambiente.
  // Toca o arquivo configurado (public/telao-musica.mp3 ou ?musica=URL);
  // se não houver, cai numa trilha sintetizada. Ver useRaceMusic.
  const music = useRaceMusic();
  // Efeitos de corrida: zoada de aceleração + narração quando alguém ultrapassa.
  const sfx = useRaceSfx();
  const prevOrderRef = useRef<Map<string, number> | null>(null);
  const lastSfxRef = useRef(0);
  const overtakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overtakes, setOvertakes] = useState<Ultrapassagem[]>([]);
  // Recorde de passos do período: bate o topo → som especial (arquivo do Airton).
  // Guardado por período no localStorage (reseta sozinho ao virar dia/semana/mês).
  const recordRef = useRef<RecordMark | null>(null);
  const recordBucketRef = useRef<string>('');
  const lastRecordRef = useRef(0);
  const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [record, setRecord] = useState<RecordMark | null>(null);
  const [recordHit, setRecordHit] = useState<RecordMark | null>(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data: res, error } = await (externalSupabase as any).rpc('tv_atividades_ranking', {
        p_since: periodSince(period).toISOString(),
        p_team_id: teamId && teamId !== GRUPO_GERENCIAL ? teamId : null,
        p_grupo: teamId === GRUPO_GERENCIAL ? GRUPO_GERENCIAL : null,
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

  const ranking = data?.ranking ?? [];
  const podium = useMemo(() => ranking.slice(0, 3), [ranking]);
  const list = useMemo(() => ranking.slice(3, 3 + LIST_MAX), [ranking]);
  const resumo = data?.resumo ?? null;

  // Trocar de time/período reinicia a comparação (senão dispara ultrapassagem falsa).
  useEffect(() => { prevOrderRef.current = null; }, [teamId, period]);

  const { vroom, recordSound, say } = sfx;
  // Balde do recorde: por período + time + data-base (reseta ao virar).
  const recordBucket = useMemo(
    () => recordBucketKey(period, teamId || 'all', periodSince(period)),
    [period, teamId],
  );

  // RECORDE de passos do período: bate o topo → som especial (arquivo do Airton)
  // + narração + banner. Roda antes do efeito de ultrapassagem pra suprimir a
  // zoada comum quando o evento é recorde.
  useEffect(() => {
    if (!ranking.length) return;
    // Topo por passos (ranking já vem ordenado; reduce garante).
    const top = ranking.reduce((a, b) => (b.passos > a.passos ? b : a), ranking[0]);
    const mark: RecordMark = { value: top.passos, holder: top.nome };

    // Novo período/time/dia (ou 1ª carga): (re)inicializa do salvo, sem som.
    if (recordBucketRef.current !== recordBucket) {
      recordBucketRef.current = recordBucket;
      const stored = loadRecord(recordBucket);
      const seed = stored && stored.value >= mark.value ? stored : mark;
      recordRef.current = seed;
      setRecord(seed);
      saveRecord(recordBucket, seed);
      return;
    }

    const cur = recordRef.current;
    if (!cur) {
      recordRef.current = mark;
      setRecord(mark);
      saveRecord(recordBucket, mark);
      return;
    }
    if (mark.value > cur.value) {
      // RECORDE BATIDO
      recordRef.current = mark;
      setRecord(mark);
      saveRecord(recordBucket, mark);
      const now = Date.now();
      if (now - lastRecordRef.current >= 2000) {
        lastRecordRef.current = now;
        lastSfxRef.current = now; // suprime a zoada normal desta rodada
        recordSound();
        say(`Novo recorde! ${shortName(mark.holder)}, ${mark.value} passos!`);
        setRecordHit(mark);
        if (recordTimer.current) clearTimeout(recordTimer.current);
        recordTimer.current = setTimeout(() => setRecordHit(null), 8000);
      }
    } else if (mark.value === cur.value && mark.holder !== cur.holder) {
      // Empate no topo por desempate: atualiza quem exibe, sem tocar som.
      recordRef.current = mark;
      setRecord(mark);
    }
  }, [ranking, recordBucket, recordSound, say]);

  // Detecta ultrapassagens comuns → zoada + narração + banner (some sozinho).
  useEffect(() => {
    if (!ranking.length) return;
    const order = ranking.map(r => r.nome);
    const nextMap = new Map<string, number>();
    order.forEach((n, i) => nextMap.set(n, i));
    const prev = prevOrderRef.current;
    prevOrderRef.current = nextMap;
    if (!prev) return; // primeira carga: só registra a ordem, sem alarme

    const evs = detectarUltrapassagens(prev, order, 2);
    if (!evs.length) return;
    // Cooldown compartilhado: se um recorde acabou de tocar, não repete a zoada.
    const now = Date.now();
    if (now - lastSfxRef.current < 3000) return;
    lastSfxRef.current = now;

    vroom();
    say(`${shortName(evs[0].a)} ultrapassou ${shortName(evs[0].b)}`);
    setOvertakes(evs);
    if (overtakeTimer.current) clearTimeout(overtakeTimer.current);
    overtakeTimer.current = setTimeout(() => setOvertakes([]), 6000);
  }, [ranking, vroom, say]);

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

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950 text-white overflow-x-hidden"
    >
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

      <div className="mx-auto max-w-6xl px-5 py-5 md:px-8 md:py-7">
        {/* ===== Cabeçalho ===== */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-2xl md:text-3xl font-black leading-none tracking-tight">
              R. <span className="text-amber-400">Prudêncio.</span>
            </div>
            <div className="mt-1 text-[10px] md:text-xs font-semibold uppercase tracking-widest text-white/50 truncate">
              Atividades · {selectedTeamName || titulo}
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
          <span>1º <span className="text-sky-400">Passos Dados</span></span>
          <span className="text-white/30">·</span>
          <span>2º <span className="text-fuchsia-400">Itens do Checklist</span></span>
          <span className="text-white/30">·</span>
          <span>3º <span className="text-emerald-400">Concluídas</span></span>
          <span className="text-white/30">·</span>
          <span>4º <span className="text-rose-400">Menos Atrasadas</span></span>
          <span className="text-white/30">·</span>
          <span>5º <span className="text-teal-400">Mais Tempo Ativo</span></span>
          <span className="text-white/30">·</span>
          <span>6º <span className="text-orange-400">Menos Ocioso</span></span>
          <span className="text-white/30">·</span>
          <span>7º <span className="text-violet-400">Resposta no Chat</span></span>
        </div>

        {/* ===== Selo do recorde do período (sempre visível) ===== */}
        {record && record.value > 0 && (
          <div className="mt-3 flex justify-center">
            <div className="flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-1.5 text-xs md:text-sm">
              <span className="text-base md:text-lg">🏆</span>
              <span className="font-black uppercase tracking-wider text-amber-300">Recorde {periodLabel[period]}</span>
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
            onClick={() => setBroadcast(true)}
            disabled={ranking.length === 0}
            className="flex items-center gap-1.5 rounded-full bg-amber-400 text-slate-900 text-xs font-black px-3.5 py-1.5 transition hover:bg-amber-300 disabled:opacity-40"
            title="Enviar a mensagem coach de cada um pra todos de uma vez"
          >
            <Megaphone className="h-4 w-4" />
            Mensagem pra todos
          </button>
        </div>

        {ranking.length === 0 ? (
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
              onAnalyze={(row, rank) => setCoach({ row, rank })}
            />

            {/* ===== Rodapé ===== */}
            <Footer resumo={resumo} participantes={ranking.length} ranking={ranking} />
          </>
        ) : (
          <>
            {/* ===== Pódio ===== */}
            <Podium podium={podium} onSelect={(row, rank) => setCoach({ row, rank })} />

            {/* ===== Lista 4..10 ===== */}
            <div className="mt-5 space-y-2">
              {list.map((r, i) => (
                <ListRow key={r.nome} rank={i + 4} row={r} onSelect={() => setCoach({ row: r, rank: i + 4 })} />
              ))}
            </div>

            {/* ===== Rodapé ===== */}
            <Footer resumo={resumo} participantes={ranking.length} ranking={ranking} />
          </>
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

      {coach && (
        <PerformanceCoachDialog
          row={coach.row}
          rank={coach.rank}
          since={periodSince(period).toISOString()}
          teamId={teamId && teamId !== GRUPO_GERENCIAL ? teamId : null}
          grupo={teamId === GRUPO_GERENCIAL ? GRUPO_GERENCIAL : null}
          periodLabel={period === 'hoje' ? 'hoje' : period === 'mes' ? 'mês' : 'semana'}
          onClose={() => setCoach(null)}
        />
      )}
    </div>
  );
}

/* ---------- Pódio ---------- */
function Podium({ podium, onSelect }: { podium: RankRow[]; onSelect: (row: RankRow, rank: number) => void }) {
  // Ordem visual: 2º (esq) · 1º (centro) · 3º (dir).
  const first = podium[0];
  const second = podium[1];
  const third = podium[2];
  return (
    <div className="mt-6 grid grid-cols-3 items-end gap-2 md:gap-4">
      <PodiumSpot row={second} place={2} onSelect={onSelect} />
      <PodiumSpot row={first} place={1} onSelect={onSelect} />
      <PodiumSpot row={third} place={3} onSelect={onSelect} />
    </div>
  );
}

function PodiumSpot({ row, place, onSelect }: { row: RankRow | undefined; place: 1 | 2 | 3; onSelect: (row: RankRow, rank: number) => void }) {
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
        </div>
        <div className={cn('mt-1 font-black leading-none', place === 1 ? 'text-4xl md:text-5xl' : 'text-3xl md:text-4xl', cfg.num)}>
          {row.passos}
          <span className="ml-1 text-[10px] md:text-xs font-bold uppercase tracking-widest text-white/50">passos</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
          <PodiumStat text={row.doc_itens ?? 0} label="checklist" color="text-fuchsia-400" />
          <PodiumStat text={row.concluidas} label="concl" color="text-emerald-400" />
          <PodiumStat text={row.atrasadas} label="atras" color="text-rose-400" />
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
function ListRow({ rank, row, onSelect }: { rank: number; row: RankRow; onSelect: () => void }) {
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
      </div>
      <Stat value={row.passos} label="passos" color="text-sky-400" />
      <Stat value={row.doc_itens ?? 0} label="check" color="text-fuchsia-400" />
      <Stat value={row.concluidas} label="concl" color="text-emerald-400" />
      <Stat value={row.atrasadas} label="atr" color="text-rose-400" />
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

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="w-12 md:w-20 text-right">
      <span className={cn('text-base md:text-xl font-black tabular-nums', color)}>{value}</span>
      <span className="ml-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-white/40">{label}</span>
    </div>
  );
}

// Stat do pódio (top 3): mesmo tamanho de valor das linhas 4+ (text-base md:text-xl),
// em vez do texto minúsculo anterior. Aceita número (concl/atras/checklist) ou
// string já formatada (tempo/aprov/chat).
function PodiumStat({ text, label, color }: { text: string | number; label: string; color: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn('text-base md:text-xl font-black tabular-nums', color)}>{text}</span>
      <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-white/40">{label}</span>
    </span>
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
          <span><b className="text-white/80">Passos</b>: contagem dos checklists marcados no período — com empate, a ordem cai pras concluídas, depois menos atrasadas, mais tempo ativo no cronômetro, menos tempo ocioso e, por fim, quem responde o chat interno mais rápido (média do período; respostas em até 8h). {participantes} no ranking.</span>
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
