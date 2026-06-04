import { useEffect, useMemo, useState } from 'react';
import { db, authClient } from '@/integrations/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Phone, PhoneOff, Loader2, RotateCw, XCircle, AlertTriangle } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  pending_permission: 'Aguardando envio do template',
  awaiting_permission: 'Template enviado, aguardando resposta',
  ready_to_call: 'Pronto pra ligar',
  awaiting_meta_calling_api: 'Stub Meta (sem API ainda)',
  calling: 'Discando',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

type QueueRow = {
  id: string;
  phone: string;
  lead_id: string | null;
  lead_name: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  provider: string;
  phone_number_id_used: string | null;
  owner_user_id: string | null;
  board_id: string | null;
  last_result: string | null;
  next_action_at: string | null;
};

type UserNumber = {
  id: string;
  user_id: string;
  phone_number_id: string;
  waba_id: string | null;
  display_phone: string | null;
  display_name: string | null;
  is_active: boolean;
};

type Board = {
  id: string;
  name: string;
  settings: any;
};

type Profile = { user_id: string; full_name: string | null };

const STATUS_COLORS: Record<string, string> = {
  pending_permission: 'bg-blue-500/10 text-blue-700',
  awaiting_permission: 'bg-amber-500/10 text-amber-700',
  ready_to_call: 'bg-emerald-500/10 text-emerald-700',
  awaiting_meta_calling_api: 'bg-purple-500/10 text-purple-700',
  calling: 'bg-cyan-500/10 text-cyan-700',
  completed: 'bg-green-500/10 text-green-700',
  failed: 'bg-red-500/10 text-red-700',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function AutoDialerPage() {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [numbers, setNumbers] = useState<UserNumber[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros do painel
  const [filterOwner, setFilterOwner] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterFrom, setFilterFrom] = useState<string>(''); // yyyy-mm-dd
  const [filterTo, setFilterTo] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState<string>('');

  const profileName = (uid?: string | null) =>
    profiles.find((p) => p.user_id === uid)?.full_name || uid?.slice(0, 8) || '—';
  const boardName = (bid?: string | null) => boards.find((b) => b.id === bid)?.name || '—';

  const filteredQueue = useMemo(() => {
    return queue.filter((r) => {
      if (filterOwner !== 'all' && (r.owner_user_id || '') !== filterOwner) return false;
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (filterFrom) {
        const from = new Date(filterFrom + 'T00:00:00');
        if (new Date(r.scheduled_at) < from) return false;
      }
      if (filterTo) {
        const to = new Date(filterTo + 'T23:59:59');
        if (new Date(r.scheduled_at) > to) return false;
      }
      if (filterSearch.trim()) {
        const q = filterSearch.trim().toLowerCase();
        const hay = `${r.lead_name || ''} ${r.phone || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [queue, filterOwner, filterStatus, filterFrom, filterTo, filterSearch]);

  const kpis = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of filteredQueue) acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, [filteredQueue]);

  function clearFilters() {
    setFilterOwner('all');
    setFilterStatus('all');
    setFilterFrom('');
    setFilterTo('');
    setFilterSearch('');
  }



  async function loadAll() {
    setLoading(true);
    try {
      const dbAny = db as any;
      const authAny = authClient as any;
      const [{ data: q }, { data: n }, { data: b }, { data: p }] = await Promise.all([
        dbAny
          .from('whatsapp_call_queue')
          .select('id, phone, lead_id, lead_name, status, attempts, max_attempts, scheduled_at, provider, phone_number_id_used, owner_user_id, board_id, last_result, next_action_at')
          .eq('provider', 'meta_cloud')
          .order('scheduled_at', { ascending: false })
          .limit(200),
        dbAny.from('whatsapp_cloud_user_numbers').select('*').order('created_at', { ascending: false }),
        dbAny.from('kanban_boards').select('id, name, settings').order('display_order', { ascending: true }),
        authAny.from('profiles').select('user_id, full_name'),
      ]);
      setQueue((q as QueueRow[]) || []);
      setNumbers((n as UserNumber[]) || []);
      setBoards((b as Board[]) || []);
      setProfiles((p as Profile[]) || []);
    } catch (e: any) {
      toast.error('Erro carregando discadora', { description: e?.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const i = setInterval(loadAll, 15000);
    return () => clearInterval(i);
  }, []);

  async function cancelItem(id: string) {
    const { error } = await (db as any)
      .from('whatsapp_call_queue')
      .update({ status: 'cancelled', last_result: 'cancelled_by_user' })
      .eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Cancelado');
    loadAll();
  }

  async function forceRetry(id: string) {
    const { error } = await (db as any)
      .from('whatsapp_call_queue')
      .update({ status: 'ready_to_call', scheduled_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Reagendado pra agora');
    loadAll();
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Phone className="h-6 w-6 text-primary" /> Discadora automática
        </h1>
        <p className="text-sm text-muted-foreground">
          Liga pros leads novos via WhatsApp Cloud Calling (Meta) assim que entram no funil.
        </p>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex gap-3 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>API de chamadas Meta em beta fechado.</strong> A fila e os pedidos de
            permissão já funcionam. O disparo da chamada fica em <code>awaiting_meta_calling_api</code> até
            você receber acesso ao endpoint <code>POST /{`{phone_number_id}`}/calls</code>.
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Fila ({queue.length})</TabsTrigger>
          <TabsTrigger value="numbers">Números Meta por usuário</TabsTrigger>
          <TabsTrigger value="boards">Configuração por funil</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-2">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={loadAll} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              <span className="ml-1">Atualizar</span>
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Funil</TableHead>
                  <TableHead>Dono</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tentativas</TableHead>
                  <TableHead>Próx. ação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      Nenhum item na fila.
                    </TableCell>
                  </TableRow>
                )}
                {queue.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.lead_name || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{r.phone}</TableCell>
                    <TableCell className="text-xs">{boardName(r.board_id)}</TableCell>
                    <TableCell className="text-xs">{profileName(r.owner_user_id)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_COLORS[r.status] || ''}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.attempts}/{r.max_attempts}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(r.scheduled_at).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {['awaiting_meta_calling_api', 'awaiting_permission', 'failed'].includes(r.status) && (
                          <Button size="sm" variant="ghost" onClick={() => forceRetry(r.id)} title="Forçar retry">
                            <RotateCw className="h-4 w-4" />
                          </Button>
                        )}
                        {!['completed', 'cancelled', 'failed'].includes(r.status) && (
                          <Button size="sm" variant="ghost" onClick={() => cancelItem(r.id)} title="Cancelar">
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="numbers">
          <UserNumbersTab numbers={numbers} profiles={profiles} reload={loadAll} />
        </TabsContent>

        <TabsContent value="boards">
          <BoardSettingsTab boards={boards} reload={loadAll} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UserNumbersTab({
  numbers,
  profiles,
  reload,
}: {
  numbers: UserNumber[];
  profiles: Profile[];
  reload: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [pnid, setPnid] = useState('');
  const [waba, setWaba] = useState('');
  const [display, setDisplay] = useState('');

  async function save() {
    if (!userId || !pnid) return toast.error('Selecione um usuário e informe o phone_number_id');
    const { error } = await (db as any).from('whatsapp_cloud_user_numbers').upsert(
      {
        user_id: userId,
        phone_number_id: pnid.trim(),
        waba_id: waba.trim() || null,
        display_phone: display.trim() || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) return toast.error(error.message);
    toast.success('Número salvo');
    setUserId(''); setPnid(''); setWaba(''); setDisplay('');
    reload();
  }

  async function toggle(id: string, active: boolean) {
    await (db as any).from('whatsapp_cloud_user_numbers').update({ is_active: active }).eq('id', id);
    reload();
  }
  async function remove(id: string) {
    await (db as any).from('whatsapp_cloud_user_numbers').delete().eq('id', id);
    reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Números Meta por usuário</CardTitle>
        <CardDescription>
          Cada acolhedor liga a partir do número Meta dele. Sem cadastro = lead pula a discagem.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <div className="md:col-span-2">
            <Label>Usuário (dono do lead)</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.user_id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>phone_number_id</Label>
            <Input value={pnid} onChange={(e) => setPnid(e.target.value)} placeholder="123456..." />
          </div>
          <div>
            <Label>waba_id (opcional)</Label>
            <Input value={waba} onChange={(e) => setWaba(e.target.value)} />
          </div>
          <div>
            <Label>Display (opcional)</Label>
            <Input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="+55..." />
          </div>
          <Button onClick={save} className="md:col-span-5">Salvar</Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>phone_number_id</TableHead>
              <TableHead>Display</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {numbers.map((n) => {
              const name = profiles.find((p) => p.user_id === n.user_id)?.full_name || n.user_id.slice(0, 8);
              return (
                <TableRow key={n.id}>
                  <TableCell>{name}</TableCell>
                  <TableCell className="font-mono text-xs">{n.phone_number_id}</TableCell>
                  <TableCell>{n.display_phone || '—'}</TableCell>
                  <TableCell>
                    <Switch checked={n.is_active} onCheckedChange={(v) => toggle(n.id, v)} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => remove(n.id)}>
                      <PhoneOff className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BoardSettingsTab({ boards, reload }: { boards: Board[]; reload: () => void }) {
  async function update(boardId: string, patch: any) {
    const cur = boards.find((b) => b.id === boardId)?.settings || {};
    const next = { ...cur, ...patch };
    const { error } = await (db as any).from('kanban_boards').update({ settings: next }).eq('id', boardId);
    if (error) return toast.error(error.message);
    reload();
  }

  return (
    <div className="space-y-3">
      {boards.map((b) => {
        const s = b.settings || {};
        return (
          <Card key={b.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{b.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Discadora</span>
                  <Switch
                    checked={!!s.auto_call_enabled}
                    onCheckedChange={(v) => update(b.id, { auto_call_enabled: v })}
                  />
                </div>
              </div>
            </CardHeader>
            {s.auto_call_enabled && (
              <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <Label>Máx. tentativas</Label>
                  <Input
                    type="number"
                    defaultValue={s.auto_call_max_attempts ?? 3}
                    onBlur={(e) => update(b.id, { auto_call_max_attempts: parseInt(e.target.value || '3', 10) })}
                  />
                </div>
                <div>
                  <Label>Janela início (HH:MM)</Label>
                  <Input
                    defaultValue={s.auto_call_window?.start || '08:00'}
                    onBlur={(e) =>
                      update(b.id, {
                        auto_call_window: { ...(s.auto_call_window || {}), start: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Janela fim (HH:MM)</Label>
                  <Input
                    defaultValue={s.auto_call_window?.end || '20:00'}
                    onBlur={(e) =>
                      update(b.id, {
                        auto_call_window: { ...(s.auto_call_window || {}), end: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Retry (min, vírgula)</Label>
                  <Input
                    defaultValue={(s.auto_call_retry_minutes || [5, 30, 120]).join(',')}
                    onBlur={(e) =>
                      update(b.id, {
                        auto_call_retry_minutes: e.target.value
                          .split(',')
                          .map((x) => parseInt(x.trim(), 10))
                          .filter((x) => !isNaN(x)),
                      })
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Template Meta de permissão de chamada</Label>
                  <Input
                    defaultValue={s.auto_call_permission_template_name || ''}
                    placeholder="ex: solicita_permissao_ligacao"
                    onBlur={(e) => update(b.id, { auto_call_permission_template_name: e.target.value || null })}
                  />
                </div>
                <div>
                  <Label>Idioma do template</Label>
                  <Input
                    defaultValue={s.auto_call_permission_template_language || 'pt_BR'}
                    onBlur={(e) =>
                      update(b.id, { auto_call_permission_template_language: e.target.value || 'pt_BR' })
                    }
                  />
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
