import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MessageSquare, Smartphone, Search, X, Loader2, Cloud, ShieldCheck } from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { db } from '@/integrations/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ehRegistroCloud, idDaLinhaCloudPadrao, membrosSemLinhaPadrao, operacoesDoPadraoApi, rotuloDaLinha,
} from '@/lib/cloudApiInstances';

interface Instance {
  id: string;
  instance_name: string;
  /** `cloud_api_meta` = linha da WhatsApp API (Meta); qualquer outro = sessão UazAPI. */
  instance_token: string | null;
}

/** Linha da WhatsApp API (Meta)? Vale o token, que é o dado; o nome é só apoio. */
const ehLinhaApi = (i: Instance) => ehRegistroCloud(i);

/** Nome como a equipe lê: `prudencio_advogados` vira "Prudencio Advogados". */
const rotuloDaInstancia = (i: Instance) =>
  ehLinhaApi(i) ? rotuloDaLinha(i.instance_name) : i.instance_name;

interface InstanceUser {
  id: string;
  instance_id: string;
  user_id: string;
}

interface MemberDefaultInstance {
  user_id: string;
  default_instance_id: string | null;
}

export function WhatsAppInstancePermissions() {
  const { members, loading: membersLoading } = useTeamMembers();
  // A aba não é `adminOnly` (nenhuma é), então membro comum chega aqui. O edge
  // recusa a escrita com "forbidden", mas ação em lote não deve nem aparecer
  // para quem não pode executá-la.
  const { isAdmin } = useUserRole();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceUsers, setInstanceUsers] = useState<InstanceUser[]>([]);
  const [memberDefaults, setMemberDefaults] = useState<MemberDefaultInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [instanceSearch, setInstanceSearch] = useState('');
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [instRes, accessRes, profilesRes] = await Promise.all([
        db.from('whatsapp_instances').select('id, instance_name, instance_token').eq('is_active', true).order('instance_name'),
        supabase.functions.invoke('admin-whatsapp-instance', { body: { action: 'list_instance_accesses' } }),
        supabase.from('profiles').select('user_id, default_instance_id'),
      ]);
      setInstances(instRes.data || []);
      if (accessRes.error || (accessRes.data as any)?.success === false) {
        throw accessRes.error || new Error((accessRes.data as any)?.error || 'Erro ao carregar acessos');
      }
      setInstanceUsers((accessRes.data as any)?.access_rows || []);
      setMemberDefaults((profilesRes.data || []).map((p: any) => ({ user_id: p.user_id, default_instance_id: p.default_instance_id })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const hasAccess = (userId: string, instanceId: string) =>
    instanceUsers.some(iu => iu.user_id === userId && iu.instance_id === instanceId);

  const saveAccessOperations = async (operations: Array<{ user_id: string; instance_id: string; grant: boolean }>) => {
    const { data, error } = await supabase.functions.invoke('admin-whatsapp-instance', {
      body: { action: 'set_instance_accesses', operations },
    });
    if (error || (data as any)?.success === false) {
      throw error || new Error((data as any)?.error || 'Erro ao atualizar acesso');
    }
    return ((data as any)?.access_rows || []) as InstanceUser[];
  };

  const getDefaultInstance = (userId: string) =>
    memberDefaults.find(m => m.user_id === userId)?.default_instance_id || null;

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m =>
      (m.full_name || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q)
    );
  }, [members, memberSearch]);

  const filteredInstances = useMemo(() => {
    const q = instanceSearch.trim().toLowerCase();
    if (!q) return instances;
    // Casa pelo nome interno E pelo rótulo: quem digita "prudencio advogados"
    // (como a coluna mostra) não achava nada, porque no banco é `prudencio_advogados`.
    return instances.filter(i =>
      i.instance_name.toLowerCase().includes(q) || rotuloDaInstancia(i).toLowerCase().includes(q)
    );
  }, [instances, instanceSearch]);

  // Colunas em duas famílias, a WhatsApp API primeiro — é o canal com acesso
  // padrão. Antes as 3 linhas da API caíam no meio das 25 sessões UazAPI, em
  // ordem alfabética e com o nome interno cru (`prudencio_advogados`): dava para
  // associar, mas não dava para saber que aquilo era a API.
  const linhasApi = useMemo(() => instances.filter(ehLinhaApi), [instances]);
  const gruposDeColuna = useMemo(() => {
    const api = filteredInstances.filter(ehLinhaApi);
    const uaz = filteredInstances.filter(i => !ehLinhaApi(i));
    return [
      { chave: 'api', titulo: 'WhatsApp API (Meta)', itens: api },
      { chave: 'uaz', titulo: 'Instâncias UazAPI (celular)', itens: uaz },
    ].filter(g => g.itens.length > 0);
  }, [filteredInstances]);
  const colunas = useMemo(() => gruposDeColuna.flatMap(g => g.itens), [gruposDeColuna]);

  const countByMember = useMemo(() => {
    const map = new Map<string, number>();
    instanceUsers.forEach(iu => map.set(iu.user_id, (map.get(iu.user_id) || 0) + 1));
    return map;
  }, [instanceUsers]);

  const countByInstance = useMemo(() => {
    const map = new Map<string, number>();
    instanceUsers.forEach(iu => map.set(iu.instance_id, (map.get(iu.instance_id) || 0) + 1));
    return map;
  }, [instanceUsers]);

  const toggleAccess = async (userId: string, instanceId: string) => {
    const key = `${userId}-${instanceId}`;
    setSaving(key);
    const memberName = members.find(m => m.user_id === userId)?.full_name
      || members.find(m => m.user_id === userId)?.email
      || 'membro';
    const instanceName = instances.find(i => i.id === instanceId)?.instance_name || 'instância';
    try {
      const existing = instanceUsers.find(iu => iu.user_id === userId && iu.instance_id === instanceId);
      if (existing) {
        await saveAccessOperations([{ user_id: userId, instance_id: instanceId, grant: false }]);
        if (getDefaultInstance(userId) === instanceId) {
          await supabase.from('profiles').update({ default_instance_id: null } as any).eq('user_id', userId);
        }
        setInstanceUsers(prev => prev.filter(iu => iu.id !== existing.id));
        toast.success(`Acesso removido: ${memberName} → ${instanceName}`);
      } else {
        const rows = await saveAccessOperations([{ user_id: userId, instance_id: instanceId, grant: true }]);
        setInstanceUsers(prev => [...prev.filter(iu => !(iu.user_id === userId && iu.instance_id === instanceId)), ...rows]);
        toast.success(`Acesso concedido: ${memberName} → ${instanceName}`);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar acesso');
    } finally {
      setSaving(null);
    }
  };

  const bulkSetRow = async (userId: string, grant: boolean) => {
    setSaving(`row-${userId}`);
    try {
      const targets = filteredInstances;
      if (grant) {
        const missing = targets.filter(t => !hasAccess(userId, t.id));
        if (missing.length === 0) return;
        const rows = await saveAccessOperations(missing.map(t => ({ user_id: userId, instance_id: t.id, grant: true })));
        const rowKeys = new Set(rows.map(r => `${r.user_id}-${r.instance_id}`));
        setInstanceUsers(prev => [...prev.filter(iu => !rowKeys.has(`${iu.user_id}-${iu.instance_id}`)), ...rows]);
        toast.success(`${missing.length} acesso(s) concedido(s)`);
      } else {
        const toRemove = instanceUsers.filter(iu => iu.user_id === userId && targets.some(t => t.id === iu.instance_id));
        if (toRemove.length === 0) return;
        await saveAccessOperations(toRemove.map(r => ({ user_id: userId, instance_id: r.instance_id, grant: false })));
        setInstanceUsers(prev => prev.filter(iu => !toRemove.some(r => r.id === iu.id)));
        toast.success(`${toRemove.length} acesso(s) removido(s)`);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Erro na operação em lote');
    } finally {
      setSaving(null);
    }
  };

  const bulkSetColumn = async (instanceId: string, grant: boolean) => {
    setSaving(`col-${instanceId}`);
    try {
      const targets = filteredMembers;
      if (grant) {
        const missing = targets.filter(m => !hasAccess(m.user_id, instanceId));
        if (missing.length === 0) return;
        const rows = await saveAccessOperations(missing.map(m => ({ user_id: m.user_id, instance_id: instanceId, grant: true })));
        const rowKeys = new Set(rows.map(r => `${r.user_id}-${r.instance_id}`));
        setInstanceUsers(prev => [...prev.filter(iu => !rowKeys.has(`${iu.user_id}-${iu.instance_id}`)), ...rows]);
        toast.success(`${missing.length} acesso(s) concedido(s)`);
      } else {
        const toRemove = instanceUsers.filter(iu => iu.instance_id === instanceId && targets.some(m => m.user_id === iu.user_id));
        if (toRemove.length === 0) return;
        await saveAccessOperations(toRemove.map(r => ({ user_id: r.user_id, instance_id: instanceId, grant: false })));
        setInstanceUsers(prev => prev.filter(iu => !toRemove.some(r => r.id === iu.id)));
        toast.success(`${toRemove.length} acesso(s) removido(s)`);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Erro na operação em lote');
    } finally {
      setSaving(null);
    }
  };

  const setDefaultInstance = async (userId: string, instanceId: string | null) => {
    const key = `default-${userId}`;
    setSaving(key);
    try {
      await supabase.from('profiles').update({ default_instance_id: instanceId } as any).eq('user_id', userId);
      setMemberDefaults(prev => {
        const exists = prev.some(m => m.user_id === userId);
        if (exists) return prev.map(m => m.user_id === userId ? { ...m, default_instance_id: instanceId } : m);
        return [...prev, { user_id: userId, default_instance_id: instanceId }];
      });
      toast.success(instanceId ? 'Instância principal definida' : 'Instância principal removida');
    } catch {
      toast.error('Erro ao definir instância principal');
    } finally {
      setSaving(null);
    }
  };

  // -------------------------------------------------------------------------
  // Padrão do canal WhatsApp API: todo membro enxerga a Abraci, e só ela.
  // Prudencio Advogados e Quitepay seguem sendo marcação um a um. Admin fica de
  // fora — enxerga todas as linhas por definição do papel, não por vínculo.
  // -------------------------------------------------------------------------
  const [padraoOpen, setPadraoOpen] = useState(false);
  const idLinhaPadrao = useMemo(() => idDaLinhaCloudPadrao(linhasApi), [linhasApi]);
  const linhaPadrao = useMemo(
    () => linhasApi.find(l => l.id === idLinhaPadrao) || null,
    [linhasApi, idLinhaPadrao],
  );
  // Quem entra na conta e o que muda: regra em `cloudApiInstances.ts`, testada
  // lá — é ela que decide revogar linha da API sem tocar em instância UazAPI.
  const membrosDoPadrao = useMemo(() => filteredMembers.filter(m => m.role !== 'admin'), [filteredMembers]);
  const opsDoPadrao = useMemo(
    () => operacoesDoPadraoApi(filteredMembers, linhasApi, instanceUsers),
    [filteredMembers, linhasApi, instanceUsers],
  );
  const concessoesDoPadrao = useMemo(
    () => membrosSemLinhaPadrao(filteredMembers, linhasApi, instanceUsers).length,
    [filteredMembers, linhasApi, instanceUsers],
  );
  const revogacoesDoPadrao = opsDoPadrao.filter(o => !o.grant).length;

  const aplicarPadraoApi = async () => {
    if (!idLinhaPadrao) {
      toast.error('A linha Abraci não está entre as instâncias ativas');
      return;
    }
    setSaving('padrao-api');
    try {
      // O edge aceita 500 operações por chamada; 200 mantém folga com margem.
      for (let i = 0; i < opsDoPadrao.length; i += 200) {
        await saveAccessOperations(opsDoPadrao.slice(i, i + 200));
      }
      // Instância principal apontando para linha da API recém-revogada vira
      // acesso fantasma: `get-my-instance-accesses` soma o default à lista de
      // permitidas, então a linha voltaria pela porta dos fundos.
      const paraLimpar = membrosDoPadrao.filter(m => {
        const atual = getDefaultInstance(m.user_id);
        return !!atual && atual !== idLinhaPadrao && linhasApi.some(l => l.id === atual);
      });
      for (const m of paraLimpar) {
        await supabase.from('profiles').update({ default_instance_id: null } as any).eq('user_id', m.user_id);
      }
      await fetchData();
      toast.success(
        `Padrão aplicado a ${membrosDoPadrao.length} membro(s): ${concessoesDoPadrao} acesso(s) novo(s), ${revogacoesDoPadrao} revogação(ões)`,
      );
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao aplicar o padrão');
    } finally {
      setSaving(null);
      setPadraoOpen(false);
    }
  };

  if (loading || membersLoading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (instances.length === 0) {
    return (
      <Card className="border-0 shadow-card">
        <CardContent className="py-12 text-center">
          <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Nenhuma instância WhatsApp configurada.</p>
        </CardContent>
      </Card>
    );
  }

  const COL_W = 88; // px per instance column
  const ROW_H = 56;
  const GRUPO_H = 26; // faixa que separa WhatsApp API das sessões UazAPI

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Acesso às Instâncias WhatsApp
              </CardTitle>
              <CardDescription>
                Clique para conceder/revogar — vale tanto para as linhas da WhatsApp API (Meta) quanto para as
                sessões UazAPI. Use os botões "Tudo / Nada" para ações em lote nos resultados filtrados.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Buscar membro..."
                  className="pl-7 h-8 w-48 text-xs"
                />
                {memberSearch && (
                  <button onClick={() => setMemberSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={instanceSearch}
                  onChange={e => setInstanceSearch(e.target.value)}
                  placeholder="Buscar instância..."
                  className="pl-7 h-8 w-48 text-xs"
                />
                {instanceSearch && (
                  <button onClick={() => setInstanceSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              {linhaPadrao && isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setPadraoOpen(true)}
                  disabled={saving === 'padrao-api' || membrosDoPadrao.length === 0}
                  title={`Aplicar o padrão da WhatsApp API a ${membrosDoPadrao.length} membro(s) — ${concessoesDoPadrao} sem a linha hoje`}
                >
                  {saving === 'padrao-api'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ShieldCheck className="h-3.5 w-3.5" />}
                  Padrão da API: só {rotuloDaInstancia(linhaPadrao)}
                  {concessoesDoPadrao + revogacoesDoPadrao > 0 && (
                    <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                      {concessoesDoPadrao + revogacoesDoPadrao}
                    </Badge>
                  )}
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{filteredMembers.length} membro(s)</span>
            <span>•</span>
            <span>{colunas.length} instância(s)</span>
            <span>•</span>
            <span>{linhasApi.length} linha(s) da WhatsApp API</span>
            <span>•</span>
            <span>{instanceUsers.length} acessos totais</span>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="overflow-auto max-h-[70vh] relative border rounded-md"
            style={{ scrollBehavior: 'smooth' }}
          >
            <table className="border-collapse" style={{ minWidth: 280 + colunas.length * COL_W }}>
              <thead>
                {/* Faixa de canal: sem ela, as 3 linhas da WhatsApp API somem no
                    meio das 25 sessões UazAPI e ninguém sabe o que está marcando. */}
                <tr>
                  <th
                    className="sticky top-0 left-0 z-40 bg-card border-b border-r text-left px-3 py-1 text-[11px] font-medium text-muted-foreground"
                    style={{ width: 280, minWidth: 280, height: GRUPO_H }}
                  >
                    Canal
                  </th>
                  {gruposDeColuna.map(grupo => (
                    <th
                      key={grupo.chave}
                      colSpan={grupo.itens.length}
                      className={cn(
                        'sticky top-0 z-30 border-b border-r bg-card px-2 py-1 text-[11px] font-semibold',
                        grupo.chave === 'api' ? 'text-sky-700 dark:text-sky-400' : 'text-muted-foreground',
                      )}
                      style={{ height: GRUPO_H }}
                    >
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        {grupo.chave === 'api'
                          ? <Cloud className="h-3 w-3" />
                          : <Smartphone className="h-3 w-3" />}
                        {grupo.titulo}
                      </span>
                    </th>
                  ))}
                </tr>
                <tr>
                  <th
                    className="sticky left-0 z-40 bg-card border-b border-r text-left px-3 py-2 text-xs font-medium"
                    style={{ width: 280, minWidth: 280, top: GRUPO_H }}
                  >
                    Membro
                  </th>
                  {colunas.map(inst => {
                    const isHover = hoverCol === inst.id;
                    return (
                      <th
                        key={inst.id}
                        onMouseEnter={() => setHoverCol(inst.id)}
                        onMouseLeave={() => setHoverCol(null)}
                        className={cn(
                          'sticky z-30 border-b border-r bg-card px-1 py-2 align-bottom',
                          ehLinhaApi(inst) && 'bg-sky-50/70 dark:bg-sky-950/20',
                          isHover && 'bg-accent'
                        )}
                        style={{ width: COL_W, minWidth: COL_W, height: 120, top: GRUPO_H }}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <div
                            className="text-[11px] font-medium leading-tight text-center break-words max-w-[80px]"
                            title={ehLinhaApi(inst) ? `${inst.instance_name} — WhatsApp API (Meta)` : inst.instance_name}
                          >
                            {rotuloDaInstancia(inst)}
                          </div>
                          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                            {countByInstance.get(inst.id) || 0}
                          </Badge>
                          <div className="flex gap-0.5">
                            <button
                              onClick={() => bulkSetColumn(inst.id, true)}
                              disabled={saving === `col-${inst.id}`}
                              className="text-[9px] px-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                              title="Conceder a todos os membros filtrados"
                            >
                              Tudo
                            </button>
                            <button
                              onClick={() => bulkSetColumn(inst.id, false)}
                              disabled={saving === `col-${inst.id}`}
                              className="text-[9px] px-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-700 dark:text-rose-400"
                              title="Remover de todos os membros filtrados"
                            >
                              Nada
                            </button>
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map(member => {
                  const isRowHover = hoverRow === member.user_id;
                  return (
                    <tr
                      key={member.user_id}
                      onMouseEnter={() => setHoverRow(member.user_id)}
                      onMouseLeave={() => setHoverRow(null)}
                      className={cn(isRowHover && 'bg-accent/40')}
                    >
                      <td
                        className={cn(
                          'sticky left-0 z-20 bg-card border-b border-r px-3 py-2',
                          isRowHover && 'bg-accent'
                        )}
                        style={{ width: 280, minWidth: 280, height: ROW_H }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{member.full_name || 'Sem nome'}</p>
                            <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                              {countByMember.get(member.user_id) || 0}
                            </Badge>
                            <button
                              onClick={() => bulkSetRow(member.user_id, true)}
                              disabled={saving === `row-${member.user_id}`}
                              className="text-[9px] px-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                              title="Conceder todas as instâncias filtradas"
                            >
                              Tudo
                            </button>
                            <button
                              onClick={() => bulkSetRow(member.user_id, false)}
                              disabled={saving === `row-${member.user_id}`}
                              className="text-[9px] px-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-700 dark:text-rose-400"
                              title="Remover todas as instâncias filtradas"
                            >
                              Nada
                            </button>
                          </div>
                        </div>
                      </td>
                      {colunas.map(inst => {
                        const checked = hasAccess(member.user_id, inst.id);
                        const isSaving = saving === `${member.user_id}-${inst.id}`;
                        const isColHover = hoverCol === inst.id;
                        return (
                          <td
                            key={inst.id}
                            onClick={() => !isSaving && toggleAccess(member.user_id, inst.id)}
                            className={cn(
                              'border-b border-r text-center cursor-pointer transition-colors',
                              ehLinhaApi(inst) && 'bg-sky-50/40 dark:bg-sky-950/10',
                              (isColHover || isRowHover) && 'bg-accent/40',
                              isColHover && isRowHover && 'bg-accent',
                              checked && 'bg-emerald-50 dark:bg-emerald-950/20',
                              isSaving && 'bg-amber-50 dark:bg-amber-950/30'
                            )}
                            style={{ width: COL_W, minWidth: COL_W, height: ROW_H }}
                            title={isSaving ? 'Salvando…' : checked ? 'Tem acesso (clique para revogar)' : 'Sem acesso (clique para conceder)'}
                          >
                            {isSaving ? (
                              <Loader2 className="h-4 w-4 mx-auto animate-spin text-amber-600 dark:text-amber-400" />
                            ) : (
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleAccess(member.user_id, inst.id)}
                                className="mx-auto pointer-events-none"
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Default Instance per Member */}
      <Card className="border-0 shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Instância Principal por Membro
          </CardTitle>
          <CardDescription>
            Define de qual instância cada membro faz ligações e envia mensagens por padrão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredMembers.map(member => {
              const memberInstances = instances.filter(i => hasAccess(member.user_id, i.id));
              const currentDefault = getDefaultInstance(member.user_id);
              const isSaving = saving === `default-${member.user_id}`;
              return (
                <div key={member.user_id} className="flex items-center justify-between py-2 px-3 rounded-lg border">
                  <div>
                    <p className="text-sm font-medium">{member.full_name || 'Sem nome'}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <Select
                    value={currentDefault || 'none'}
                    onValueChange={v => setDefaultInstance(member.user_id, v === 'none' ? null : v)}
                    disabled={isSaving || memberInstances.length === 0}
                  >
                    <SelectTrigger className="w-48 h-8 text-xs">
                      <SelectValue placeholder="Sem instância" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem instância principal</SelectItem>
                      {memberInstances.map(inst => (
                        <SelectItem key={inst.id} value={inst.id}>
                          {ehLinhaApi(inst) ? `API · ${rotuloDaInstancia(inst)}` : inst.instance_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={padraoOpen} onOpenChange={setPadraoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Aplicar o padrão da WhatsApp API
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {membrosDoPadrao.length} membro(s) dos filtrados ficam com acesso
                  {linhaPadrao ? ` só à linha ${rotuloDaInstancia(linhaPadrao)}` : ''} entre as linhas da API.
                  Administradores não entram na conta: eles enxergam todas as linhas pelo papel.
                </p>
                <p>
                  <strong>{concessoesDoPadrao}</strong> acesso(s) novo(s) e{' '}
                  <strong>{revogacoesDoPadrao}</strong> revogação(ões) de outras linhas da API
                  (Prudencio Advogados, Quitepay). As instâncias UazAPI não são tocadas.
                </p>
                <p className="text-muted-foreground">
                  Reversível pela própria matriz: cada quadradinho volta a ser clicável depois.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={aplicarPadraoApi}>Aplicar padrão</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
