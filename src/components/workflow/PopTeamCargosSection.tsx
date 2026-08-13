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
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, Loader2, Plus, UserPlus, Users } from 'lucide-react';
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

export function PopTeamCargosSection({ teamId, teamName, onCargosChanged, onTeamCreated }: PopTeamCargosSectionProps) {
  const profilesList = useProfilesList();
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [cargos, setCargos] = useState<Record<string, string>>({}); // user_id -> cargo
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [novoTimeOpen, setNovoTimeOpen] = useState(false);
  const [novoTimeNome, setNovoTimeNome] = useState('');
  const [criando, setCriando] = useState(false);

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
  // (legado) — casar pelos dois, como o TeamsManager faz.
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

  return (
    <div className="mt-2 rounded-md border bg-muted/30 p-3 space-y-2">
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
            <div className="space-y-1.5">
              {membros.map(m => {
                const cargoAtual = cargos[m.user_id] || '';
                const empatado = cargoAtual && cargosEmpatados.has(cargoAtual.trim().toLowerCase());
                return (
                  <div key={m.user_id} className="flex items-center gap-2">
                    <span className="text-xs truncate flex-1 min-w-0" title={m.nome}>{m.nome}</span>
                    <div className="w-[55%] shrink-0">
                      <Input
                        defaultValue={cargoAtual}
                        placeholder="Cargo (quem faz o quê)..."
                        className={`h-7 text-[11px] ${empatado ? 'border-amber-500/70' : ''}`}
                        onBlur={e => {
                          const v = e.target.value;
                          if (v.trim() !== cargoAtual) void salvarCargo(m.user_id, v);
                        }}
                      />
                      {empatado && (
                        <p className="text-[10px] text-amber-600 mt-0.5">
                          2+ pessoas com este cargo: empate não resolve responsável.
                        </p>
                      )}
                    </div>
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
            ocupa o cargo atualiza todos os POPs do time de uma vez.
          </p>
        </>
      )}
    </div>
  );
}
