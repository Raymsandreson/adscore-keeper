import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, FileSignature, Users, FolderOpen, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface ZapTemplate {
  token: string;
  name: string;
}

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
});

interface Props {
  boardId?: string;
  hideBoardSelector?: boolean;
}

export function FunnelZapsignDefaultsConfig({ boardId, hideBoardSelector }: Props = {}) {
  const { boards, loading: loadingBoards } = useKanbanBoards();
  const funnels = useMemo(() => boards.filter((b) => b.board_type === 'funnel'), [boards]);

  const [internalBoardId, setInternalBoardId] = useState<string>('');
  const selectedBoardId = boardId ?? internalBoardId;
  const setSelectedBoardId = (v: string) => {
    if (boardId === undefined) setInternalBoardId(v);
  };
  const [templates, setTemplates] = useState<ZapTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingRow, setLoadingRow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [row, setRow] = useState<DefaultsRow | null>(null);

  // Load templates once
  useEffect(() => {
    (async () => {
      setLoadingTemplates(true);
      try {
        const { data, error } = await supabase.functions.invoke('zapsign-action', {
          body: { action: 'list_templates' },
        });
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
  }, []);

  // Auto-select first funnel
  useEffect(() => {
    if (!selectedBoardId && funnels.length > 0) {
      setSelectedBoardId(funnels[0].id);
    }
  }, [funnels, selectedBoardId]);

  // Load row for selected funnel
  useEffect(() => {
    if (!selectedBoardId) {
      setRow(null);
      return;
    }
    (async () => {
      setLoadingRow(true);
      try {
        const { data, error } = await (supabase as any)
          .from('funnel_zapsign_defaults')
          .select('*')
          .eq('board_id', selectedBoardId)
          .maybeSingle();
        if (error) throw error;
        setRow(data ? (data as DefaultsRow) : emptyDefaults(selectedBoardId));
      } catch (err: any) {
        console.error('load defaults error:', err);
        toast.error('Erro ao carregar configurações: ' + err.message);
        setRow(emptyDefaults(selectedBoardId));
      } finally {
        setLoadingRow(false);
      }
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
        .from('funnel_zapsign_defaults')
        .upsert(payload, { onConflict: 'board_id' });
      if (error) throw error;
      toast.success('Configurações salvas como padrão deste funil');
    } catch (err: any) {
      console.error('save defaults error:', err);
      toast.error('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="h-5 w-5 text-primary" />
            Padrões de procuração por funil
          </CardTitle>
          <CardDescription>
            Defina o modelo, comportamento e mensagem padrão usados ao gerar documentos a partir do chat.
            Estes valores são aplicados automaticamente quando alguém abrir o assistente de geração para um lead deste funil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Funil</Label>
            <Select value={selectedBoardId} onValueChange={setSelectedBoardId} disabled={loadingBoards}>
              <SelectTrigger>
                <SelectValue placeholder={loadingBoards ? 'Carregando funis…' : 'Escolha um funil'} />
              </SelectTrigger>
              <SelectContent>
                {funnels.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {loadingRow || !row ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando configurações…
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Modelo de procuração</CardTitle>
              <CardDescription>Modelo do ZapSign usado por padrão neste funil.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Modelo padrão</Label>
                <Select
                  value={row.zapsign_template_token || ''}
                  onValueChange={(v) => update({ zapsign_template_token: v })}
                  disabled={loadingTemplates}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingTemplates ? 'Carregando…' : 'Escolha um modelo'} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.token} value={t.token}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Papel do signatário</Label>
                  <Input
                    value={row.signer_role || ''}
                    placeholder="Cliente"
                    onChange={(e) => update({ signer_role: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Modo de autenticação</Label>
                  <Select
                    value={row.signer_auth_mode || 'assinaturaTela'}
                    onValueChange={(v) => update({ signer_auth_mode: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="assinaturaTela">Assinatura na tela</SelectItem>
                      <SelectItem value="tokenSms">Token por SMS</SelectItem>
                      <SelectItem value="tokenEmail">Token por e-mail</SelectItem>
                      <SelectItem value="selfieDocFoto">Selfie + foto do documento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-5 w-5 text-primary" /> Automações ao gerar
              </CardTitle>
              <CardDescription>O que acontece automaticamente quando o documento é gerado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4 p-3 rounded-lg border bg-muted/20">
                <div>
                  <div className="font-medium text-sm">Criar lead automaticamente</div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Obrigatório — sem lead vinculado o pós-assinatura (grupo, importação de documentos, notificações)
                    não roda.
                  </p>
                </div>
                <Switch checked disabled />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label>Criar grupo no WhatsApp</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Cria o grupo do caso após a assinatura e envia a equipe responsável.
                  </p>
                </div>
                <Switch
                  checked={row.auto_create_group}
                  onCheckedChange={(v) => update({ auto_create_group: v })}
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-pink-500" /> IA sugere documentos do chat
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Analisa o histórico e sugere RG, CPF, comprovantes etc. para anexar à procuração.
                  </p>
                </div>
                <Switch
                  checked={row.attach_chat_docs}
                  onCheckedChange={(v) => update({ attach_chat_docs: v })}
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label>Notificar a equipe na assinatura</Label>
                </div>
                <Switch
                  checked={row.notify_on_signature}
                  onCheckedChange={(v) => update({ notify_on_signature: v })}
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label>Enviar PDF assinado para o cliente</Label>
                </div>
                <Switch
                  checked={row.send_signed_pdf}
                  onCheckedChange={(v) => update({ send_signed_pdf: v })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mensagem enviada com o link</CardTitle>
              <CardDescription>
                Variáveis disponíveis: <code className="text-xs">{'{{nome}}'}</code>,{' '}
                <code className="text-xs">{'{{link}}'}</code>, <code className="text-xs">{'{{documento}}'}</code>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                rows={6}
                value={row.default_message_template || ''}
                onChange={(e) => update({ default_message_template: e.target.value })}
                placeholder="Mensagem padrão…"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderOpen className="h-5 w-5 text-primary" /> Pasta no Drive (opcional)
              </CardTitle>
              <CardDescription>ID da pasta onde a cópia assinada será arquivada.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                value={row.drive_folder_id || ''}
                onChange={(e) => update({ drive_folder_id: e.target.value })}
                placeholder="ID da pasta do Google Drive"
              />
            </CardContent>
          </Card>

          <div className="flex justify-end sticky bottom-0 bg-background/80 backdrop-blur py-3 -mx-4 px-4 border-t">
            <Button onClick={handleSave} disabled={saving} size="lg" className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar como padrão deste funil
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
