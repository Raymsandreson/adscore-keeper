import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ExternalLink, Upload, Trash2, FileText, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  webViewLink: string;
  iconLink?: string;
  thumbnailLink?: string;
}

interface Props {
  leadId: string;
  leadName: string;
}

function formatBytes(bytes?: string) {
  if (!bytes) return '';
  const n = parseInt(bytes, 10);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function LeadDocumentsTab({ leadId, leadName }: Props) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [folderUrl, setFolderUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('lead-drive', {
        body: { action: 'list_files', lead_id: leadId, lead_name: leadName },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setFiles(data.files || []);
      setFolderUrl(data.folder_url);
    } catch (e: any) {
      console.error('[LeadDocumentsTab] load error', e);
      toast.error(`Erro ao carregar documentos: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [leadId, leadName]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Arquivo maior que 25 MB. Faça upload direto no Drive.');
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      // Convert to base64 in chunks to avoid stack overflow
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
      }
      const b64 = btoa(binary);

      const { data, error } = await supabase.functions.invoke('lead-drive', {
        body: {
          action: 'upload',
          lead_id: leadId,
          lead_name: leadName,
          file_name: file.name,
          file_base64: b64,
          mime_type: file.type,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`${file.name} enviado`);
      await load();
    } catch (err: any) {
      console.error('[LeadDocumentsTab] upload error', err);
      toast.error(`Erro no upload: ${err.message || err}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete(f: DriveFile) {
    if (!confirm(`Excluir "${f.name}"?`)) return;
    try {
      const { error } = await supabase.functions.invoke('lead-drive', {
        body: { action: 'delete', lead_id: leadId, lead_name: leadName, file_id: f.id },
      });
      if (error) throw error;
      toast.success('Arquivo excluído');
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    } catch (err: any) {
      toast.error(`Erro ao excluir: ${err.message || err}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-muted-foreground">
          Pasta no Google Drive deste lead
        </div>
        <div className="flex gap-2">
          {folderUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={folderUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Abrir no Drive
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
          <label className="inline-flex">
            <input type="file" hidden onChange={handleUpload} disabled={uploading} />
            <Button size="sm" disabled={uploading} asChild>
              <span className="cursor-pointer">
                {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                Enviar arquivo
              </span>
            </Button>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando documentos…
        </div>
      ) : files.length === 0 ? (
        <div className="border border-dashed rounded-lg py-12 text-center text-sm text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Nenhum documento na pasta deste lead ainda.
          <div className="mt-1 text-xs">Use "Enviar arquivo" para adicionar.</div>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 p-3 hover:bg-muted/30">
              {f.iconLink ? (
                <img src={f.iconLink} alt="" className="h-5 w-5" />
              ) : (
                <FileText className="h-5 w-5 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <a
                  href={f.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium truncate hover:underline block"
                >
                  {f.name}
                </a>
                <div className="text-xs text-muted-foreground">
                  {new Date(f.modifiedTime).toLocaleString('pt-BR')} {f.size && `· ${formatBytes(f.size)}`}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(f)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
