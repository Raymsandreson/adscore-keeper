import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { Loader2, Plus, RefreshCw, Trash2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useProfilesList } from '@/hooks/useProfilesList';

interface Rule {
  id?: string;
  name: string;
  priority: number;
  match_type: 'funnel' | 'product' | 'keyword' | 'ctwa_ad' | 'default';
  match_value: string | null;
  eligible_user_ids: string[];
  is_active: boolean;
}

interface Config {
  id?: string;
  phone_number_id: string;
  waba_id: string;
  display_phone?: string | null;
  display_name?: string | null;
  status?: string;
  last_heartbeat_at?: string | null;
}

const emptyRule: Rule = {
  name: '',
  priority: 100,
  match_type: 'default',
  match_value: '',
  eligible_user_ids: [],
  is_active: true,
};

export default function WhatsAppCloudPage() {
  const { toast } = useToast();
  const profiles = useProfilesList();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<Config | null>(null);
  const [configDraft, setConfigDraft] = useState<Config>({ phone_number_id: '', waba_id: '' });
  const [rules, setRules] = useState<Rule[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const profileById = useMemo(() => {
    const m = new Map<string, string>();
    (profiles || []).forEach((p: any) => m.set(p.user_id, p.full_name || p.email || p.user_id.slice(0, 8)));
    return m;
  }, [profiles]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await cloudFunctions.invoke('whatsapp-cloud-admin', { body: { action: 'overview' } });
      if (data?.success) {
        setConfig(data.config || null);
        setConfigDraft(data.config || { phone_number_id: '', waba_id: '' });
        setRules(data.rules || []);
        setLog(data.log || []);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const saveConfig = async () => {
    if (!configDraft.phone_number_id || !configDraft.waba_id) {
      toast({ title: 'Faltam campos', description: 'phone_number_id e waba_id são obrigatórios', variant: 'destructive' });
      return;
    }
    const { data } = await cloudFunctions.invoke('whatsapp-cloud-admin', {
      body: { action: 'save_config', ...configDraft },
    });
    if (data?.success) { toast({ title: 'Configuração salva' }); load(); }
    else toast({ title: 'Erro', description: data?.error, variant: 'destructive' });
  };

  const saveRule = async () => {
    if (!editingRule) return;
    const { data } = await cloudFunctions.invoke('whatsapp-cloud-admin', {
      body: { action: 'save_rule', rule: editingRule },
    });
    if (data?.success) { toast({ title: 'Regra salva' }); setEditingRule(null); load(); }
    else toast({ title: 'Erro', description: data?.error, variant: 'destructive' });
  };

  const deleteRule = async (rule_id: string) => {
    const { data } = await cloudFunctions.invoke('whatsapp-cloud-admin', { body: { action: 'delete_rule', rule_id } });
    if (data?.success) load();
  };

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-6xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">WhatsApp Cloud — Número de Gerência</h1>
          <p className="text-sm text-muted-foreground">Porta de entrada única via Meta oficial. Distribui leads entre atendentes.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {config ? <ShieldCheck className="h-5 w-5 text-emerald-500" /> : <ShieldAlert className="h-5 w-5 text-amber-500" />}
            Configuração Meta
            {config?.status && <Badge variant="outline">{config.status}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Phone Number ID</Label>
            <Input value={configDraft.phone_number_id} onChange={(e) => setConfigDraft({ ...configDraft, phone_number_id: e.target.value })} placeholder="123456789012345" />
          </div>
          <div className="space-y-2">
            <Label>WABA ID</Label>
            <Input value={configDraft.waba_id} onChange={(e) => setConfigDraft({ ...configDraft, waba_id: e.target.value })} placeholder="987654321098765" />
          </div>
          <div className="space-y-2">
            <Label>Telefone visível</Label>
            <Input value={configDraft.display_phone || ''} onChange={(e) => setConfigDraft({ ...configDraft, display_phone: e.target.value })} placeholder="+55 11 99999-0000" />
          </div>
          <div className="space-y-2">
            <Label>Nome do número</Label>
            <Input value={configDraft.display_name || ''} onChange={(e) => setConfigDraft({ ...configDraft, display_name: e.target.value })} placeholder="Atendimento WhatsJUD" />
          </div>
          <div className="md:col-span-2 flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              Os secrets <code>WHATSAPP_CLOUD_ACCESS_TOKEN</code>, <code>WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN</code> e <code>WHATSAPP_CLOUD_APP_SECRET</code> precisam estar configurados nos servidores antes de o webhook funcionar.
            </p>
            <Button onClick={saveConfig}>Salvar configuração</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Regras de Roteamento</CardTitle>
          <Dialog open={!!editingRule} onOpenChange={(o) => !o && setEditingRule(null)}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setEditingRule({ ...emptyRule })}><Plus className="h-4 w-4 mr-1" /> Nova regra</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingRule?.id ? 'Editar regra' : 'Nova regra'}</DialogTitle></DialogHeader>
              {editingRule && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input value={editingRule.name} onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select value={editingRule.match_type} onValueChange={(v) => setEditingRule({ ...editingRule, match_type: v as Rule['match_type'] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Padrão (fallback)</SelectItem>
                          <SelectItem value="ctwa_ad">CTWA / Anúncio</SelectItem>
                          <SelectItem value="keyword">Palavra-chave</SelectItem>
                          <SelectItem value="funnel">Funil</SelectItem>
                          <SelectItem value="product">Produto</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Prioridade</Label>
                      <Input type="number" value={editingRule.priority} onChange={(e) => setEditingRule({ ...editingRule, priority: Number(e.target.value) || 100 })} />
                    </div>
                  </div>
                  {editingRule.match_type !== 'default' && (
                    <div className="space-y-2">
                      <Label>Valor do match</Label>
                      <Input value={editingRule.match_value || ''} onChange={(e) => setEditingRule({ ...editingRule, match_value: e.target.value })} placeholder="ex: ctwa_clid, palavra, id do funil" />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Atendentes elegíveis (round-robin)</Label>
                    <div className="border rounded p-2 max-h-48 overflow-auto space-y-1">
                      {(profiles || []).map((p: any) => (
                        <label key={p.user_id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editingRule.eligible_user_ids.includes(p.user_id)}
                            onChange={(e) => {
                              const set = new Set(editingRule.eligible_user_ids);
                              if (e.target.checked) set.add(p.user_id); else set.delete(p.user_id);
                              setEditingRule({ ...editingRule, eligible_user_ids: Array.from(set) });
                            }}
                          />
                          {p.full_name || p.email}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={editingRule.is_active} onCheckedChange={(v) => setEditingRule({ ...editingRule, is_active: v })} />
                    <span className="text-sm">Ativa</span>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingRule(null)}>Cancelar</Button>
                <Button onClick={saveRule}>Salvar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma regra. Crie ao menos uma regra <strong>padrão</strong> com o pool de atendentes.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Pool</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.match_type}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.match_value || '—'}</TableCell>
                    <TableCell className="text-xs">{(r.eligible_user_ids || []).length} atendente(s)</TableCell>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell>{r.is_active ? <Badge>ativa</Badge> : <Badge variant="secondary">inativa</Badge>}</TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditingRule({ ...r })}>Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => r.id && deleteRule(r.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Últimos roteamentos</CardTitle></CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma mensagem roteada ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Atendente</TableHead>
                  <TableHead>Match</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{new Date(l.created_at).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-xs font-mono">{l.phone}</TableCell>
                    <TableCell className="text-xs">{l.assigned_user_id ? (profileById.get(l.assigned_user_id) || l.assigned_user_id.slice(0, 8)) : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.matched_value || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {loading && (
        <div className="fixed bottom-4 right-4 bg-background border rounded p-2 shadow-md text-xs flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
        </div>
      )}
    </div>
  );
}
