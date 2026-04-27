import { useEffect, useState, useCallback, useMemo } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Image as ImageIcon, FileText, Music, Video, Inbox } from 'lucide-react';
import { toast } from 'sonner';

const DOC_TYPES = [
  'Procuração',
  'Perícia Social',
  'Perícia Médica',
  'RG',
  'CPF',
  'Comprovante de Residência',
  'Outro',
] as const;

type DocType = typeof DOC_TYPES[number];

interface GroupMedia {
  id: string;                   // external_message_id (last 32 chars used as msgId)
  external_message_id: string;
  message_type: string;         // image | document | video | audio
  message_text: string | null;
  media_url: string | null;
  created_at: string;
  sender_name?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  whatsappGroupId: string | null;
  onImported?: () => void;
}

function iconForType(t: string) {
  if (t === 'image') return <ImageIcon className="h-4 w-4 text-muted-foreground" />;
  if (t === 'video') return <Video className="h-4 w-4 text-muted-foreground" />;
  if (t === 'audio') return <Music className="h-4 w-4 text-muted-foreground" />;
  return <FileText className="h-4 w-4 text-muted-foreground" />;
}

export default function ImportGroupDocsDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  whatsappGroupId,
  onImported,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [medias, setMedias] = useState<GroupMedia[]>([]);
  const [selection, setSelection] = useState<Record<string, DocType>>({});

  const load = useCallback(async () => {
    if (!whatsappGroupId) return;
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data, error } = await externalSupabase
        .from('whatsapp_messages')
        .select('external_message_id, message_type, message_text, media_url, created_at, metadata, contact_name')
        .eq('phone', whatsappGroupId)
        .in('message_type', ['image', 'document', 'video', 'audio'])
        .not('media_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      const mapped: GroupMedia[] = (data || []).map((m: any) => {
        const content = m.metadata?.message?.content || {};
        const fileName = content.fileName || content.title || null;
        const mimeType = content.mimetype || content.mimeType || null;
        const last = (m.external_message_id || '').slice(-32);
        return {
          id: last,
          external_message_id: m.external_message_id,
          message_type: m.message_type,
          message_text: m.message_text,
          media_url: m.media_url,
          created_at: m.created_at,
          sender_name: m.sender_name,
          file_name: fileName,
          mime_type: mimeType,
        };
      });
      setMedias(mapped);
    } catch (e: any) {
      console.error('[ImportGroupDocsDialog] load error', e);
      toast.error(`Erro ao carregar mídias do grupo: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [whatsappGroupId]);

  useEffect(() => {
    if (open) load();
    if (!open) setSelection({});
  }, [open, load]);

  const selectedCount = useMemo(() => Object.keys(selection).length, [selection]);

  function toggle(id: string, defaultType: DocType = 'Outro') {
    setSelection((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = defaultType;
      return next;
    });
  }

  function setType(id: string, t: DocType) {
    setSelection((prev) => ({ ...prev, [id]: t }));
  }

  async function handleImport() {
    if (selectedCount === 0) {
      toast.warning('Selecione pelo menos um documento');
      return;
    }
    setImporting(true);
    const tId = toast.loading(`Importando ${selectedCount} documento(s)...`);
    try {
      const documents = Object.entries(selection).map(([message_id, document_type]) => ({
        message_id,
        document_type,
      }));

      const { data, error } = await supabase.functions.invoke('import-group-docs-to-lead', {
        body: {
          lead_id: leadId,
          lead_name: leadName,
          documents,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const results = (data as any).results || [];
      const ok = results.filter((r: any) => r.status === 'ok').length;
      const okNoDrive = results.filter((r: any) => r.status === 'ok_no_drive').length;
      const failed = results.length - ok - okNoDrive;

      if (failed === 0 && okNoDrive === 0) {
        toast.success(`${ok} documento(s) importado(s) e enviado(s) para o Drive`, { id: tId });
      } else if (failed === 0) {
        toast.success(`${ok + okNoDrive} importado(s); ${okNoDrive} sem Drive`, { id: tId });
      } else {
        toast.warning(`${ok + okNoDrive} ok, ${failed} com erro — verifique o console`, { id: tId });
        console.warn('[ImportGroupDocsDialog] failed results:', results.filter((r: any) => r.status !== 'ok' && r.status !== 'ok_no_drive'));
      }

      onImported?.();
      onOpenChange(false);
    } catch (e: any) {
      console.error('[ImportGroupDocsDialog] import error', e);
      toast.error(`Erro: ${e.message || e}`, { id: tId });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar documentos do grupo WhatsApp</DialogTitle>
          <DialogDescription>
            Selecione mídias enviadas no grupo deste lead, escolha o tipo, e elas serão salvas
            no Drive em subpastas por tipo dentro da pasta do lead.
          </DialogDescription>
        </DialogHeader>

        {!whatsappGroupId ? (
          <div className="border border-dashed rounded-lg py-12 text-center text-sm text-muted-foreground">
            Este lead não tem grupo de WhatsApp vinculado.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando mídias…
          </div>
        ) : medias.length === 0 ? (
          <div className="border border-dashed rounded-lg py-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Nenhuma mídia encontrada no grupo.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto border rounded-lg divide-y">
            {medias.map((m) => {
              const checked = m.id in selection;
              const label =
                m.file_name ||
                m.message_text?.slice(0, 60) ||
                `${m.message_type} ${new Date(m.created_at).toLocaleString('pt-BR')}`;
              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-3 p-3 hover:bg-muted/30 ${checked ? 'bg-primary/5' : ''}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(m.id)}
                  />
                  {iconForType(m.message_type)}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{label}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(m.created_at).toLocaleString('pt-BR')}
                      {m.sender_name && ` · ${m.sender_name}`}
                      {m.mime_type && ` · ${m.mime_type}`}
                    </div>
                  </div>
                  <Select
                    value={selection[m.id] || 'Outro'}
                    onValueChange={(v) => {
                      if (!checked) toggle(m.id, v as DocType);
                      else setType(m.id, v as DocType);
                    }}
                    disabled={!checked}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {DOC_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2">
          <div className="flex-1 text-sm text-muted-foreground self-center">
            {selectedCount > 0 && `${selectedCount} selecionado(s)`}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancelar
          </Button>
          <Button onClick={handleImport} disabled={importing || selectedCount === 0}>
            {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Importar {selectedCount > 0 ? `(${selectedCount})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
