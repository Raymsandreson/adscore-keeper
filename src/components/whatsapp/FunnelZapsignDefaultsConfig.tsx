import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, FileSignature, Users, FolderOpen, Sparkles, Bell, X, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';

interface ZapTemplate { token: string; name: string; }

interface DefaultsRow {
  id?: string;
  board_id: string;
  zapsign_template_token: string | null;
  signer_role: string | null;
  signer_auth_mode: string | null;
  auto_create_lead: boolean;
  auto_create_group: boolean;
  attach_chat_docs: boolean;
  default_message_template: string | null;
  drive_folder_id: string | null;
  notify_on_signature: boolean;
  send_signed_pdf: boolean;
  notify_team_user_ids: string[];
  notify_group_jids: string[];
  notify_phone_numbers: string[];
}

const emptyDefaults = (board_id: string): DefaultsRow => ({
  board_id,
  zapsign_template_token: null,
  signer_role: 'Cliente',
  signer_auth_mode: 'assinaturaTela',
  auto_create_lead: true,
  auto_create_group: true,
  attach_chat_docs: true,
  default_message_template:
    '📝 *Documento para assinatura*\n\nOlá {{nome}}! Segue o link para assinar a procuração:\n\n👉 {{link}}\n\nQualquer dúvida, estou à disposição! 🙏',
  drive_folder_id: null,
  notify_on_signature: true,
  send_signed_pdf: true,
  notify_team_user_ids: [],
  notify_group_jids: [],
  notify_phone_numbers: [],
});

type Section = 'all' | 'documentos' | 'procuracao' | 'grupo' | 'notificacoes';

interface Props {
  boardId?: string;
  hideBoardSelector?: boolean;
  section?: Section;
  hideSaveButton?: boolean;
}

export function FunnelZapsignDefaultsConfig({ boardId, hideBoardSelector, section = 'all', hideSaveButton }: Props = {}) {
  const { boards, loading: loadingBoards } = useKanbanBoards();
  const funnels = useMemo(() => boards.filter((b) => b.board_type === 'funnel'), [boards]);

  const [internalBoardId, setInternalBoardId] = useState<string>('');
  const selectedBoardId = boardId ?? internalBoardId;
  const setSelectedBoardId = (v: string) => { if (boardId === undefined) setInternalBoardId(v); };

  const [templates, setTemplates] = useState<ZapTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingRow, setLoadingRow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [row, setRow] = useState<DefaultsRow | null>(null);

  // Recipients data
  const [profiles, setProfiles] = useState<{ user_id: string; full_name: string | null }[]>([]);
  const [groups, setGroups] = useState<{ group_jid: string; group_name: string | null; instance_name: string }[]>([]);
  const [instances, setInstances] = useState<{ instance_name: string; owner_name: string | null; owner_phone: string | null }[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [hideUnnamedGroups, setHideUnnamedGroups] = useState(true);

  // Map instance_name -> friendly display ("Owner Name" || instance_name)
  const instanceDisplay = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of instances) {
      m.set(i.instance_name, (i.owner_name && i.owner_name.trim()) || i.instance_name);
    }
    return m;
  }, [instances]);
  const friendlyInstance = (raw: string) => instanceDisplay.get(raw) || raw;
  // Helper: a group has a "real" name if group_name is non-empty AND not equal to its JID-like code
  const hasRealName = (g: { group_jid: string; group_name: string | null }) => {
    const n = (g.group_name || '').trim();
    if (!n) return false;
    if (n === g.group_jid) return false;
    if (/^\d{10,}@g\.us$/i.test(n)) return false;
    if (/^\d{10,}$/.test(n)) return false;
    return true;
  };

  const showProc = section === 'all' || section === 'procuracao' || section === 'documentos';
  const showGroup = section === 'all' || section === 'grupo';
  const showNotif = section === 'all' || section === 'notificacoes';

  // Templates
  useEffect(() => {
    if (!showProc) return;
    (async () => {
      setLoadingTemplates(true);
      try {
        const { data, error } = await supabase.functions.invoke('zapsign-api', { body: { action: 'list_templates' } });
        if (error) throw error;
        const list = Array.isArray(data?.templates) ? data.templates : data?.templates?.results || [];
        setTemplates(list);
      } catch (err: any) {
        console.error('list_templates error:', err);
        toast.error('Não foi possível carregar os modelos do ZapSign');
      } finally {
        setLoadingTemplates(false);
      }
    })();
  }, [showProc]);

  // Recipients data load (only when notif visible)
  useEffect(() => {
    if (!showNotif) return;
    (async () => {
      const [{ data: pf }, { data: gr }] = await Promise.all([
        (supabase as any).from('profiles').select('user_id, full_name').order('full_name'),
        (supabase as any).from('whatsapp_groups_cache').select('group_jid, group_name, instance_name').order('group_name'),
      ]);
      setProfiles(pf || []);
      // dedupe by group_jid (cache may repeat across instances)
      const seen = new Set<string>();
      const dedup: any[] = [];
      for (const g of gr || []) {
        if (seen.has(g.group_jid)) continue;
        seen.add(g.group_jid);
        dedup.push(g);
      }
      setGroups(dedup);
    })();
  }, [showNotif]);

  useEffect(() => {
    if (!selectedBoardId && funnels.length > 0) setSelectedBoardId(funnels[0].id);
  }, [funnels, selectedBoardId]);

  useEffect(() => {
    if (!selectedBoardId) { setRow(null); return; }
    (async () => {
      setLoadingRow(true);
      try {
        const { data, error } = await (supabase as any)
          .from('funnel_zapsign_defaults').select('*').eq('board_id', selectedBoardId).maybeSingle();
        if (error) throw error;
        const base = emptyDefaults(selectedBoardId);
        const merged: DefaultsRow = data ? {
          ...base,
          ...(data as any),
          notify_team_user_ids: (data as any).notify_team_user_ids || [],
          notify_group_jids: (data as any).notify_group_jids || [],
          notify_phone_numbers: (data as any).notify_phone_numbers || [],
        } : base;
        setRow(merged);
      } catch (err: any) {
        console.error('load defaults error:', err);
        toast.error('Erro ao carregar configurações: ' + err.message);
        setRow(emptyDefaults(selectedBoardId));
      } finally { setLoadingRow(false); }
    })();
  }, [selectedBoardId]);

  const update = (patch: Partial<DefaultsRow>) => setRow((r) => (r ? { ...r, ...patch } : r));

  const handleSave = async () => {
    if (!row) return;
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const payload = { ...row, created_by: row.id ? undefined : userRes.user?.id };
      const { error } = await (supabase as any)
        .from('funnel_zapsign_defaults').upsert(payload, { onConflict: 'board_id' });
      if (error) throw error;
      toast.success('Configurações salvas como padrão deste funil');
    } catch (err: any) {
      console.error('save defaults error:', err);
      toast.error('Erro ao salvar: ' + err.message);
    } finally { setSaving(false); }
  };

  const toggleArr = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const addPhone = () => {
    if (!row) return;
    const cleaned = phoneInput.replace(/\D/g, '');
    if (cleaned.length < 10) { toast.error('Número inválido'); return; }
    if (row.notify_phone_numbers.includes(cleaned)) { setPhoneInput(''); return; }
    update({ notify_phone_numbers: [...row.notify_phone_numbers, cleaned] });
    setPhoneInput('');
  };

  return (
    <div className="space-y-6">
      {!hideBoardSelector && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSignature className="h-5 w-5 text-primary" /> Padrões de documentos por funil
            </CardTitle>
            <CardDescription>Defina o modelo, comportamento e mensagem padrão usados ao gerar documentos a partir do chat.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Funil</Label>
              <Select value={selectedBoardId} onValueChange={setSelectedBoardId} disabled={loadingBoards}>
                <SelectTrigger><SelectValue placeholder={loadingBoards ? 'Carregando funis…' : 'Escolha um funil'} /></SelectTrigger>
                <SelectContent>{funnels.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {loadingRow || !row ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando configurações…
        </div>
      ) : (
        <>
          {showProc && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Modelo de documento</CardTitle>
                  <CardDescription>Modelo do ZapSign usado por padrão neste funil.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Modelo padrão</Label>
                    <Select value={row.zapsign_template_token || ''} onValueChange={(v) => update({ zapsign_template_token: v })} disabled={loadingTemplates}>
                      <SelectTrigger><SelectValue placeholder={loadingTemplates ? 'Carregando…' : 'Escolha um modelo'} /></SelectTrigger>
                      <SelectContent>{templates.map((t) => (<SelectItem key={t.token} value={t.token}>{t.name}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Papel do signatário</Label>
                      <Input value={row.signer_role || ''} placeholder="Cliente" onChange={(e) => update({ signer_role: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Modo de autenticação</Label>
                      <Select value={row.signer_auth_mode || 'assinaturaTela'} onValueChange={(v) => update({ signer_auth_mode: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="assinaturaTela">Assinatura na tela</SelectItem>
                          <SelectItem value="tokenSms">Token por SMS</SelectItem>
                          <SelectItem value="tokenEmail">Token por e-mail</SelectItem>
                          <SelectItem value="tokenWhatsapp">Token por WhatsApp</SelectItem>
                          <SelectItem value="selfieDocFoto">Selfie + foto do documento</SelectItem>
                          <SelectItem value="selfieFoto">Selfie</SelectItem>
                          <SelectItem value="documentoFoto">Foto do documento</SelectItem>
                          <SelectItem value="biometricoCertificado">Biometria facial + certificado</SelectItem>
                          <SelectItem value="certificadoDigital">Certificado digital (e-CPF/e-CNPJ)</SelectItem>
                          <SelectItem value="provaDeVida">Prova de vida</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-5 w-5 text-pink-500" /> Automações de documento</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start justify-between gap-4 p-3 rounded-lg border bg-muted/20">
                    <div>
                      <div className="font-medium text-sm">Criar lead automaticamente</div>
                      <p className="text-xs text-muted-foreground mt-0.5">Obrigatório — sem lead vinculado o pós-assinatura não roda.</p>
                    </div>
                    <Switch checked disabled />
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Label className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-pink-500" /> IA sugere documentos do chat</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">Analisa o histórico e sugere RG, CPF, comprovantes etc.</p>
                    </div>
                    <Switch checked={row.attach_chat_docs} onCheckedChange={(v) => update({ attach_chat_docs: v })} />
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <div><Label>Enviar PDF assinado para o cliente</Label></div>
                    <Switch checked={row.send_signed_pdf} onCheckedChange={(v) => update({ send_signed_pdf: v })} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Mensagem enviada com o link</CardTitle>
                  <CardDescription>Variáveis: <code className="text-xs">{'{{nome}}'}</code>, <code className="text-xs">{'{{link}}'}</code>, <code className="text-xs">{'{{documento}}'}</code></CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea rows={6} value={row.default_message_template || ''} onChange={(e) => update({ default_message_template: e.target.value })} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><FolderOpen className="h-5 w-5 text-primary" /> Pasta no Drive (opcional)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Input value={row.drive_folder_id || ''} onChange={(e) => update({ drive_folder_id: e.target.value })} placeholder="ID da pasta do Google Drive" />
                </CardContent>
              </Card>
            </>
          )}

          {showGroup && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Users className="h-5 w-5 text-violet-500" /> Grupo do caso</CardTitle>
                <CardDescription>Comportamento de criação automática do grupo após a assinatura.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label>Criar grupo no WhatsApp</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Cria o grupo do caso após a assinatura e envia a equipe responsável.</p>
                  </div>
                  <Switch checked={row.auto_create_group} onCheckedChange={(v) => update({ auto_create_group: v })} />
                </div>
              </CardContent>
            </Card>
          )}

          {showNotif && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-5 w-5 text-yellow-500" /> Notificar na assinatura</CardTitle>
                <CardDescription>Quem deve receber aviso quando o documento for assinado.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label>Ativar notificações</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Quando desligado, nada é enviado mesmo com destinatários selecionados.</p>
                  </div>
                  <Switch checked={row.notify_on_signature} onCheckedChange={(v) => update({ notify_on_signature: v })} />
                </div>

                <div className={row.notify_on_signature ? 'space-y-5' : 'space-y-5 opacity-60 pointer-events-none'}>
                  {/* Membros */}
                  <div className="space-y-2">
                    <Label className="text-sm">Membros da equipe (chat interno)</Label>
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                      <Input className="pl-8 h-9" placeholder="Buscar membro…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
                    </div>
                    <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                      {profiles
                        .filter((p) => !memberSearch || (p.full_name || '').toLowerCase().includes(memberSearch.toLowerCase()))
                        .slice(0, 50)
                        .map((p) => {
                          const checked = row.notify_team_user_ids.includes(p.user_id);
                          return (
                            <label key={p.user_id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                              <Checkbox checked={checked} onCheckedChange={() => update({ notify_team_user_ids: toggleArr(row.notify_team_user_ids, p.user_id) })} />
                              <span>{p.full_name || p.user_id.slice(0, 8)}</span>
                            </label>
                          );
                        })}
                      {profiles.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum membro encontrado.</div>}
                    </div>
                    {row.notify_team_user_ids.length > 0 && (
                      <p className="text-xs text-muted-foreground">{row.notify_team_user_ids.length} membro(s) selecionado(s)</p>
                    )}
                  </div>

                  {/* Grupos WA */}
                  <div className="space-y-2">
                    <Label className="text-sm">Grupos do WhatsApp</Label>
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                      <Input className="pl-8 h-9" placeholder="Buscar grupo…" value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} />
                    </div>
                    <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                      {groups
                        .filter((g) => !groupSearch || (g.group_name || '').toLowerCase().includes(groupSearch.toLowerCase()))
                        .slice(0, 50)
                        .map((g) => {
                          const checked = row.notify_group_jids.includes(g.group_jid);
                          return (
                            <label key={g.group_jid} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                              <Checkbox checked={checked} onCheckedChange={() => update({ notify_group_jids: toggleArr(row.notify_group_jids, g.group_jid) })} />
                              <span className="truncate">{g.group_name || g.group_jid}</span>
                              <span className="ml-auto text-[10px] text-muted-foreground">{g.instance_name}</span>
                            </label>
                          );
                        })}
                      {groups.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum grupo em cache. Sincronize uma instância primeiro.</div>}
                    </div>
                    {row.notify_group_jids.length > 0 && (
                      <p className="text-xs text-muted-foreground">{row.notify_group_jids.length} grupo(s) selecionado(s)</p>
                    )}
                  </div>

                  {/* Telefones avulsos */}
                  <div className="space-y-2">
                    <Label className="text-sm">Números de WhatsApp avulsos</Label>
                    <div className="flex gap-2">
                      <Input
                        className="h-9"
                        placeholder="Ex: 5511999998888"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhone(); } }}
                      />
                      <Button type="button" size="sm" variant="outline" onClick={addPhone} className="gap-1">
                        <Plus className="h-3.5 w-3.5" /> Adicionar
                      </Button>
                    </div>
                    {row.notify_phone_numbers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {row.notify_phone_numbers.map((p) => (
                          <Badge key={p} variant="secondary" className="gap-1 pr-1">
                            {p}
                            <button type="button" onClick={() => update({ notify_phone_numbers: row.notify_phone_numbers.filter((x) => x !== p) })}
                              className="hover:bg-muted rounded p-0.5"><X className="h-3 w-3" /></button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!hideSaveButton && (
            <div className="flex justify-end sticky bottom-0 bg-background/80 backdrop-blur py-3 -mx-4 px-4 border-t">
              <Button onClick={handleSave} disabled={saving} size="lg" className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar como padrão deste funil
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
