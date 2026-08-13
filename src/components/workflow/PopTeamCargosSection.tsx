// =============================================================================
// Seção "Time e cargos" dentro do editor de POP.
//
// O POP resolve responsável por CARGO do time vinculado (src/lib/popCargo.ts),
// mas até 13/08/2026 os cargos só eram editáveis em Configurações → Times —
// uma tela de distância do lugar onde são usados, e a tabela estava vazia em
// produção por causa disso. Esta seção mostra os membros do time vinculado com
// o cargo editável inline, inclui pessoa no time e cria time novo sem sair do
// POP.
//
// O time continua sendo entidade GLOBAL: fonte de verdade em teams/team_members
// no Cloud (espelhada no Externo por sync_teams_snapshot), cargos em
// team_member_cargos no Externo chaveados por nome do time — as MESMAS tabelas
// e chaves que o TeamsManager usa. Aqui é só uma janela de edição no contexto
// do POP, não um cadastro paralelo.
//
// Ponte com o plano de carreira (13/08/2026): o cargo do time é texto livre,
// mas quando o nome bate com um cargo formal (job_positions, Cloud) a seção
// mostra a DESCRIÇÃO (atribuições) e o PLANO DE CRESCIMENTO (career_plans) do
// cargo, e deixa vincular a pessoa a ele (member_positions). Cargo digitado
// sem ficha formal pode ganhar uma aqui mesmo (descrição + plano) — escrita
// nessas tabelas é admin-only por RLS, então a falha vira aviso, não quebra.
// A IA do POP já lê as duas fontes (buildTeamForAI no WorkflowBuilder).
// =============================================================================
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, ChevronDown, ChevronUp, GraduationCap, Loader2, Plus, UserPlus, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useProfilesList } from '@/hooks/useProfilesList';
import { ALL_METRICS } from '@/components/team/TeamsManager';
import { toast } from 'sonner';

interface PopTeamCargosSectionProps {
  /** Time vinculado ao POP (settings.responsible_team_id); '' = nenhum. */
  teamId: string;
  /** Nome do time vinculado — chave de team_member_cargos. */
  teamName?: string;
  /** Cargo mudou: o builder recarrega o CargoMap dos seletores de responsável. */
  onCargosChanged: () => void;
  /** Time criado aqui: o builder recarrega a lista e vincula o novo. */
  onTeamCreated: (team: { id: string; name: string }) => void;
}

interface JobPositionLite {
  id: string;
  name: string;
  description: string | null;
  career_plan_id: string | null;
  level: number;
}

/**
 * Reconstrói a cópia Externo de teams/team_members a partir do Cloud — o mesmo
 * espelhamento que o TeamsManager dispara ao abrir a aba Times. Sem isso, time
 * criado ou membro incluído aqui não existiria para popCargo/telão até alguém
 * abrir aquela aba. Best-effort: falha vira warn, não bloqueia a edição.
 */
async function espelharSnapshotExterno() {
  try {
    const [{ data: teamsData }, { data: membersData }] = await Promise.all([
      supabase.from('teams').select('id, name, description, color'),
      supabase.from('team_members').select('team_id, user_id'),
    ]);
    if (!teamsData || teamsData.length === 0) return;
    await ensureExternalSession();
    await (externalSupabase as any).rpc('sync_teams_snapshot', {
      p_teams: teamsData.map(t => ({ id: t.id, name: t.name, description: t.description, color: t.color })),
      p_members: (membersData || []).map(m => ({ team_id: m.team_id, user_id: m.user_id })),
    });
  } catch (e) {
    console.warn('[PopTeamCargos] sync_teams_snapshot:', e);
  }
}

/**
 * Card das sugestões de cargo da IA (sugestoes_cargos do generate/edit-workflow),
 * agora com AÇÃO: confirmar cria o cargo de verdade — a ficha formal
 * (job_positions) nasce com o motivo da IA como descrição e, se o usuário já
 * escolher quem assume, o cargo do time (team_member_cargos) é gravado junto.
 * Sem ocupante o cargo ainda entra nas opções do POP (fetchCargoMap inclui as
 * fichas formais) e a pessoa é definida depois na seção "Time e cargos".
 */
export const CargoSugestoesCard = memo(function CargoSugestoesCard({ sugestoes, teamId, teamName, onRemove, onCargosChanged }: {
  sugestoes: { cargo: string; motivo: string }[];
  teamId: string;
  teamName?: string;
  /** Sugestão criada/resolvida — o pai tira da lista (chaveado pelo nome). */
  onRemove: (cargo: string) => void;
  onCargosChanged: () => void;
}) {
  const profilesList = useProfilesList();
  const [membros, setMembros] = useState<{ user_id: string; nome: string; cargoAtual: string }[]>([]);
  // Ocupante escolhido por sugestão, chaveado pelo NOME do cargo (índice
  // muda quando uma sugestão sai da lista).
  const [ocupantes, setOcupantes] = useState<Record<string, string>>({});
  const [criando, setCriando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!teamId || !teamName) { setMembros([]); return; }
      try {
        const { data: memberRows } = await supabase
          .from('team_members').select('user_id').eq('team_id', teamId);
        await ensureExternalSession();
        const { data: cargoRows } = await ((externalSupabase as any).from('team_member_cargos') as any)
          .select('user_id, cargo').eq('team_name', teamName);
        if (!vivo) return;
        const cargoPorUser = new Map(
          (((cargoRows as { user_id: string; cargo: string | null }[]) || [])).map(r => [r.user_id, r.cargo || ''])
        );
        setMembros(((memberRows as { user_id: string }[]) || []).map(r => {
          const p = profilesList.find(pp => pp.user_id === r.user_id || pp.id === r.user_id);
          return {
            user_id: r.user_id,
            nome: p?.full_name || p?.email || 'Sem nome',
            cargoAtual: cargoPorUser.get(r.user_id) || '',
          };
        }));
      } catch (e) {
        console.error('[CargoSugestoes] Failed to load team members:', e);
      }
    })();
    return () => { vivo = false; };
  }, [teamId, teamName, profilesList]);

  const criar = async (s: { cargo: string; motivo: string }) => {
    if (!teamName) return;
    const nome = s.cargo.trim();
    const ocupante = ocupantes[s.cargo] || '';
    setCriando(s.cargo);
    try {
      // Ficha formal (se ainda não existir cargo com esse nome): é ela que
      // põe o cargo nas opções do POP mesmo sem ocupante, e o motivo da IA
      // vira a descrição/atribuições. Admin-only por RLS.
      const { data: existente } = await (supabase as any).from('job_positions')
        .select('id').ilike('name', nome).limit(1).maybeSingle();
      let fichaOk = !!existente;
      if (!existente) {
        const { error } = await (supabase as any).from('job_positions')
          .insert({ name: nome, description: s.motivo?.trim() || null });
        fichaOk = !error;
        if (error) console.warn('[CargoSugestoes] Failed to create job position:', error);
      }

      if (ocupante) {
        // Um membro tem UM cargo por time (PK team_name+user_id): atribuir
        // aqui substitui o cargo atual dele — o seletor mostra qual é.
        await ensureExternalSession();
        const { error } = await ((externalSupabase as any).from('team_member_cargos') as any).upsert({
          team_name: teamName,
          user_id: ocupante,
          cargo: nome,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'team_name,user_id' });
        if (error) throw error;
      } else if (!fichaOk) {
        toast.error('Sem permissão pra criar a ficha formal (gestão de admin) — escolha quem assume pra criar como cargo do time.');
        return;
      }

      onCargosChanged();
      onRemove(s.cargo);
      toast.success(ocupante ? `Cargo "${nome}" criado e atribuído` : `Cargo "${nome}" criado — defina quem assume na seção Time e cargos`);
    } catch (e) {
      console.error('[CargoSugestoes] Failed to create cargo:', e);
      toast.error('Erro ao criar o cargo');
    } finally {
      setCriando(null);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Funções que o POP exige e a IA não encontrou em nenhum cargo do time. Confirme pra criar:
        escolhendo quem assume, o cargo já resolve responsável; sem ocupante, ele fica disponível
        e a pessoa é definida depois na seção "Time e cargos".
      </p>
      <div className="space-y-2">
        {sugestoes.map(s => (
          <div key={s.cargo} className="rounded-md border border-amber-500/30 bg-background/60 p-2 space-y-1">
            <p className="text-xs font-medium text-foreground">{s.cargo}</p>
            {s.motivo && <p className="text-[11px] text-muted-foreground">{s.motivo}</p>}
            <div className="flex items-center gap-2">
              <Select
                value={ocupantes[s.cargo] || '__depois__'}
                onValueChange={v => setOcupantes(prev => ({ ...prev, [s.cargo]: v === '__depois__' ? '' : v }))}
              >
                <SelectTrigger className="h-7 text-[11px] flex-1">
                  <SelectValue placeholder="Quem assume?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__depois__"><span className="text-muted-foreground">Definir quem assume depois</span></SelectItem>
                  {membros.map(m => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.nome}{m.cargoAtual ? ` (hoje: ${m.cargoAtual})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-7 text-[11px] shrink-0"
                disabled={criando === s.cargo}
                onClick={() => void criar(s)}
              >
                {criando === s.cargo ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Plus className="h-3 w-3 mr-1" />Criar cargo</>}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// React.memo: o WorkflowBuilder re-renderiza a cada tecla do formulário; esta
// seção só depende do time vinculado e de callbacks estáveis (useCallback no
// builder), então memo corta o re-render por keystroke.
export const PopTeamCargosSection = memo(function PopTeamCargosSection({ teamId, teamName, onCargosChanged, onTeamCreated }: PopTeamCargosSectionProps) {
  const profilesList = useProfilesList();
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [cargos, setCargos] = useState<Record<string, string>>({}); // user_id -> cargo
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [novoTimeOpen, setNovoTimeOpen] = useState(false);
  const [novoTimeNome, setNovoTimeNome] = useState('');
  const [criando, setCriando] = useState(false);

  // ─── Cargo formal (plano de carreira, Cloud) ───
  const [positions, setPositions] = useState<JobPositionLite[]>([]);
  const [planos, setPlanos] = useState<{ id: string; name: string }[]>([]);
  const [memberPositions, setMemberPositions] = useState<{ user_id: string; position_id: string }[]>([]);
  // Editor inline da ficha formal: cria (posId ausente) ou completa (posId
  // presente) descrição + plano do cargo digitado para aquele membro.
  const [fichaEditor, setFichaEditor] = useState<{ userId: string; posId?: string; nome: string } | null>(null);
  const [fichaDesc, setFichaDesc] = useState('');
  const [fichaPlanoId, setFichaPlanoId] = useState('');
  const [fichaSaving, setFichaSaving] = useState(false);

  const carregarPlanoCarreira = useCallback(async () => {
    try {
      const [posRes, planRes, mpRes] = await Promise.all([
        (supabase as any).from('job_positions').select('id, name, description, career_plan_id, level').eq('is_active', true),
        (supabase as any).from('career_plans').select('id, name').eq('is_active', true),
        (supabase as any).from('member_positions').select('user_id, position_id'),
      ]);
      setPositions((posRes.data as JobPositionLite[]) || []);
      setPlanos((planRes.data as { id: string; name: string }[]) || []);
      setMemberPositions((mpRes.data as { user_id: string; position_id: string }[]) || []);
    } catch (e) {
      console.warn('[PopTeamCargos] Failed to load career plan data:', e);
    }
  }, []);

  useEffect(() => { void carregarPlanoCarreira(); }, [carregarPlanoCarreira]);

  const carregar = useCallback(async () => {
    if (!teamId || !teamName) { setMemberIds([]); setCargos({}); return; }
    setLoading(true);
    try {
      // Membros da fonte de verdade (Cloud) — mesmo id gravado em
      // team_member_cargos.user_id pelo TeamsManager.
      const { data: memberRows } = await supabase
        .from('team_members').select('user_id').eq('team_id', teamId);
      await ensureExternalSession();
      const { data: cargoRows } = await ((externalSupabase as any).from('team_member_cargos') as any)
        .select('user_id, cargo').eq('team_name', teamName);
      setMemberIds(((memberRows as { user_id: string }[]) || []).map(r => r.user_id));
      const map: Record<string, string> = {};
      (((cargoRows as { user_id: string; cargo: string | null }[]) || [])).forEach(r => {
        if (r.cargo) map[r.user_id] = r.cargo;
      });
      setCargos(map);
    } catch (e) {
      console.error('[PopTeamCargos] Failed to load team members:', e);
    } finally {
      setLoading(false);
    }
  }, [teamId, teamName]);

  useEffect(() => { void carregar(); }, [carregar]);

  // team_members.user_id guarda ora o auth user_id, ora o id do profile
  // (legado) — casar pelos dois, como o TeamsManager faz. member_positions é
  // chaveado pelo auth user_id (CareerPlanManager), daí o resolve.
  const resolveAuthId = useCallback((storedId: string) => {
    const p = profilesList.find(pp => pp.user_id === storedId || pp.id === storedId);
    return p?.user_id || storedId;
  }, [profilesList]);

  const membros = useMemo(() => memberIds.map(storedId => {
    const p = profilesList.find(pp => pp.user_id === storedId || pp.id === storedId);
    return { user_id: storedId, nome: p?.full_name || p?.email || 'Sem nome' };
  }), [memberIds, profilesList]);

  const disponiveis = useMemo(() => {
    const stored = new Set(memberIds);
    const q = search.trim().toLowerCase();
    return profilesList
      .filter(p => !stored.has(p.user_id) && !stored.has(p.id))
      .filter(p => !q || (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q));
  }, [memberIds, profilesList, search]);

  const posPorNome = useMemo(() => new Map(
    positions.map(p => [p.name.trim().toLowerCase(), p])
  ), [positions]);

  const planoNome = useMemo(() => new Map(planos.map(p => [p.id, p.name])), [planos]);

  // Cargo com 2+ ocupantes não resolve responsável (empate desce a cascata) —
  // avisar aqui, onde o cargo é digitado, e não só no seletor lá embaixo.
  const cargosEmpatados = useMemo(() => {
    const contagem = new Map<string, number>();
    Object.values(cargos).forEach(c => {
      const k = c.trim().toLowerCase();
      if (k) contagem.set(k, (contagem.get(k) || 0) + 1);
    });
    return new Set([...contagem.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [cargos]);

  const salvarCargo = async (userId: string, cargo: string) => {
    if (!teamName) return;
    try {
      await ensureExternalSession();
      const { error } = await ((externalSupabase as any).from('team_member_cargos') as any).upsert({
        team_name: teamName,
        user_id: userId,
        cargo: cargo.trim() || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'team_name,user_id' });
      if (error) throw error;
      setCargos(prev => {
        const next = { ...prev };
        if (cargo.trim()) next[userId] = cargo.trim(); else delete next[userId];
        return next;
      });
      onCargosChanged();
    } catch (e) {
      console.error('[PopTeamCargos] Failed to save cargo:', e);
      toast.error('Erro ao salvar cargo');
    }
  };

  const incluirMembro = async (userId: string) => {
    try {
      const { error } = await supabase.from('team_members').insert({
        team_id: teamId,
        user_id: userId,
        evaluated_metrics: ALL_METRICS.map(m => m.key),
      });
      if (error) throw error;
      await espelharSnapshotExterno();
      await carregar();
    } catch (e: any) {
      if (e?.code === '23505') toast.error('Já está neste time');
      else toast.error(e?.message || 'Erro ao incluir no time');
    }
  };

  const criarTime = async () => {
    const nome = novoTimeNome.trim();
    if (!nome) return;
    setCriando(true);
    try {
      const { data, error } = await supabase.from('teams')
        .insert({ name: nome, color: '#3b82f6' })
        .select('id, name').single();
      if (error) throw error;
      // Espelhar ANTES de avisar o builder: a lista de times do POP lê o Externo.
      await espelharSnapshotExterno();
      setNovoTimeNome('');
      setNovoTimeOpen(false);
      toast.success(`Time "${nome}" criado e vinculado ao POP`);
      onTeamCreated({ id: (data as { id: string }).id, name: nome });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao criar time');
    } finally {
      setCriando(false);
    }
  };

  // Vincula a PESSOA ao cargo formal no plano de carreira (member_positions).
  const vincularNoPlano = async (storedUserId: string, positionId: string) => {
    const authId = resolveAuthId(storedUserId);
    try {
      const { error } = await (supabase as any).from('member_positions').insert({
        user_id: authId, position_id: positionId,
      });
      if (error && error.code !== '23505') throw error;
      setMemberPositions(prev => [...prev, { user_id: authId, position_id: positionId }]);
      toast.success('Pessoa vinculada ao cargo no plano de carreira');
    } catch (e) {
      console.error('[PopTeamCargos] Failed to assign member position:', e);
      toast.error('Sem permissão para vincular — gestão de cargos formais é de admin (Equipe → Carreira).');
    }
  };

  const abrirFichaEditor = (userId: string, nome: string, pos?: JobPositionLite) => {
    setFichaEditor({ userId, posId: pos?.id, nome });
    setFichaDesc(pos?.description || '');
    setFichaPlanoId(pos?.career_plan_id || '');
  };

  // Cria ou completa a ficha formal do cargo (job_positions): descrição =
  // atribuições escritas; plano = trilha de crescimento. Admin-only por RLS.
  const salvarFicha = async () => {
    if (!fichaEditor) return;
    setFichaSaving(true);
    try {
      const payload = {
        description: fichaDesc.trim() || null,
        career_plan_id: fichaPlanoId || null,
      };
      if (fichaEditor.posId) {
        const { error } = await (supabase as any).from('job_positions')
          .update(payload).eq('id', fichaEditor.posId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('job_positions')
          .insert({ name: fichaEditor.nome, ...payload });
        if (error) throw error;
      }
      await carregarPlanoCarreira();
      setFichaEditor(null);
      toast.success('Ficha do cargo salva');
    } catch (e) {
      console.error('[PopTeamCargos] Failed to save job position:', e);
      toast.error('Sem permissão para editar cargos formais — é gestão de admin (Equipe → Carreira).');
    } finally {
      setFichaSaving(false);
    }
  };

  const datalistId = `pop-cargos-sugestoes-${teamId || 'novo'}`;

  return (
    <div className="mt-2 rounded-md border bg-muted/30 p-3 space-y-2">
      {/* Sugestões do campo de cargo: os cargos formais do plano de carreira,
          pra puxar o texto livre pro vocabulário que tem descrição e trilha. */}
      <datalist id={datalistId}>
        {positions.map(p => <option key={p.id} value={p.name} />)}
      </datalist>

      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Time e cargos
          {teamId && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{membros.length}</Badge>}
        </span>
        {!novoTimeOpen && (
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setNovoTimeOpen(true)}>
            <Plus className="h-3 w-3 mr-1" />Novo time
          </Button>
        )}
      </div>

      {novoTimeOpen && (
        <div className="flex items-center gap-2">
          <Input
            value={novoTimeNome}
            onChange={e => setNovoTimeNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void criarTime(); } }}
            placeholder="Nome do novo time..."
            className="h-8 text-xs"
            autoFocus
          />
          <Button size="sm" className="h-8 text-xs" onClick={criarTime} disabled={criando || !novoTimeNome.trim()}>
            {criando ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Criar'}
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setNovoTimeOpen(false); setNovoTimeNome(''); }}>
            Cancelar
          </Button>
        </div>
      )}

      {!teamId ? (
        <p className="text-[11px] text-muted-foreground">
          Selecione o time responsável acima (ou crie um) para definir os cargos que o POP usa como responsável.
        </p>
      ) : loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {membros.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nenhum membro neste time ainda — inclua abaixo.</p>
          ) : (
            <div className="space-y-2">
              {membros.map(m => {
                const cargoAtual = cargos[m.user_id] || '';
                const empatado = cargoAtual && cargosEmpatados.has(cargoAtual.trim().toLowerCase());
                const pos = cargoAtual ? posPorNome.get(cargoAtual.trim().toLowerCase()) : undefined;
                const authId = resolveAuthId(m.user_id);
                const vinculado = pos ? memberPositions.some(mp => mp.user_id === authId && mp.position_id === pos.id) : false;
                const editandoFicha = fichaEditor?.userId === m.user_id;
                return (
                  <div key={m.user_id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs truncate flex-1 min-w-0" title={m.nome}>{m.nome}</span>
                      <div className="w-[55%] shrink-0">
                        <Input
                          defaultValue={cargoAtual}
                          list={datalistId}
                          placeholder="Cargo (quem faz o quê)..."
                          className={`h-7 text-[11px] ${empatado ? 'border-amber-500/70' : ''}`}
                          onBlur={e => {
                            const v = e.target.value;
                            if (v.trim() !== cargoAtual) void salvarCargo(m.user_id, v);
                          }}
                        />
                      </div>
                    </div>
                    {empatado && (
                      <p className="text-[10px] text-amber-600 text-right">
                        2+ pessoas com este cargo: empate não resolve responsável.
                      </p>
                    )}

                    {/* Ficha formal do cargo digitado: descrição + plano de crescimento */}
                    {cargoAtual && !editandoFicha && (
                      pos ? (
                        <div className="pl-2 border-l-2 border-muted space-y-0.5">
                          {pos.description ? (
                            <p className="text-[10px] text-muted-foreground line-clamp-2" title={pos.description}>
                              {pos.description}
                            </p>
                          ) : (
                            <button
                              type="button"
                              className="text-[10px] text-muted-foreground underline underline-offset-2"
                              onClick={() => abrirFichaEditor(m.user_id, pos.name, pos)}
                            >
                              Cargo sem descrição — escrever as atribuições
                            </button>
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            {pos.career_plan_id && planoNome.get(pos.career_plan_id) ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1">
                                <GraduationCap className="h-3 w-3" />
                                {planoNome.get(pos.career_plan_id)} · nível {pos.level}
                              </Badge>
                            ) : (
                              <button
                                type="button"
                                className="text-[10px] text-muted-foreground underline underline-offset-2"
                                onClick={() => abrirFichaEditor(m.user_id, pos.name, pos)}
                              >
                                Sem plano de crescimento — vincular
                              </button>
                            )}
                            {vinculado ? (
                              <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                                <Check className="h-3 w-3" />no plano de carreira
                              </span>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 text-[10px] px-1.5"
                                onClick={() => void vincularNoPlano(m.user_id, pos.id)}
                              >
                                <GraduationCap className="h-3 w-3 mr-1" />
                                Vincular pessoa ao cargo formal
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="pl-2 border-l-2 border-amber-500/40 flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-amber-600">
                            Cargo sem ficha formal: sem descrição nem plano de crescimento.
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 text-[10px] px-1.5"
                            onClick={() => abrirFichaEditor(m.user_id, cargoAtual)}
                          >
                            <Plus className="h-3 w-3 mr-1" />Criar ficha do cargo
                          </Button>
                        </div>
                      )
                    )}

                    {editandoFicha && fichaEditor && (
                      <div className="pl-2 border-l-2 border-primary/40 space-y-1.5 py-1">
                        <p className="text-[10px] font-medium">
                          Ficha do cargo "{fichaEditor.nome}"
                        </p>
                        <Textarea
                          value={fichaDesc}
                          onChange={e => setFichaDesc(e.target.value)}
                          placeholder="Descrição / atribuições do cargo (o que essa função entrega)..."
                          className="text-[11px] min-h-[52px]"
                        />
                        <Select value={fichaPlanoId || '__none__'} onValueChange={v => setFichaPlanoId(v === '__none__' ? '' : v)}>
                          <SelectTrigger className="h-7 text-[11px]">
                            <SelectValue placeholder="Plano de crescimento" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__"><span className="text-muted-foreground">Sem plano de crescimento</span></SelectItem>
                            {planos.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                          <Button size="sm" className="h-6 text-[11px]" onClick={salvarFicha} disabled={fichaSaving}>
                            {fichaSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Salvar ficha'}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setFichaEditor(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-1 border-t">
            <button
              type="button"
              onClick={() => setAddOpen(v => !v)}
              className="flex items-center justify-between w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              <span className="flex items-center gap-1.5 font-medium">
                <UserPlus className="h-3 w-3" />
                Incluir pessoa no time
              </span>
              {addOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {addOpen && (
              <div className="mt-1.5 space-y-1.5">
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou email..."
                  className="h-7 text-[11px]"
                />
                {disponiveis.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center py-1">
                    {search ? 'Nenhum resultado' : 'Todo mundo já está no time'}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                    {disponiveis.map(p => (
                      <Button
                        key={p.user_id}
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px]"
                        onClick={() => void incluirMembro(p.user_id)}
                        title={p.email || ''}
                      >
                        <UserPlus className="h-3 w-3 mr-1" />
                        {p.full_name || p.email || 'Sem nome'}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground">
            Os cargos daqui viram as opções de responsável de fase, objetivo e passo. Trocar quem
            ocupa o cargo atualiza todos os POPs do time de uma vez. Cargo com ficha formal traz a
            descrição e o plano de crescimento (gestão completa em Equipe → Carreira).
          </p>
        </>
      )}
    </div>
  );
});
