import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ExternalLink, Upload, Trash2, FileText, Loader2, RefreshCw, Sparkles, Wand2, MessagesSquare } from 'lucide-react';
import ImportGroupDocsDialog from '@/components/leads/ImportGroupDocsDialog';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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

interface Analysis {
  document_type?: string;
  document_subtype?: string | null;
  holder_name?: string | null;
  holder_cpf?: string | null;
  description?: string;
  confidence?: 'alta' | 'média' | 'baixa' | string;
}

interface Props {
  leadId: string;
  leadName: string;
  whatsappGroupId?: string | null;
}

function formatBytes(bytes?: string) {
  if (!bytes) return '';
  const n = parseInt(bytes, 10);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function LeadDocumentsTab({ leadId, leadName, whatsappGroupId }: Props) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [folderUrl, setFolderUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{ file: DriveFile; analysis: Analysis } | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [importGroupOpen, setImportGroupOpen] = useState(false);
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [autoAnalyzing, setAutoAnalyzing] = useState(false);

  const analyzeOne = useCallback(async (fileId: string): Promise<{ analysis: Analysis; renamed: string | null } | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('lead-drive', {
        body: { action: 'analyze_file', lead_id: leadId, lead_name: leadName, file_id: fileId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return {
        analysis: ((data as any).analysis || {}) as Analysis,
        renamed: ((data as any).renamed as string | null) ?? null,
      };
    } catch (e) {
      console.warn('[LeadDocumentsTab] auto analyze failed', fileId, e);
      return null;
    }
  }, [leadId, leadName]);

  const runAutoAnalysis = useCallback(async (list: DriveFile[]) => {
    if (list.length === 0) return;
    setAutoAnalyzing(true);
    try {
      const concurrency = 3;
      for (let i = 0; i < list.length; i += concurrency) {
        const batch = list.slice(i, i + concurrency);
        const results = await Promise.all(batch.map((f) => analyzeOne(f.id).then((a) => [f.id, a] as const)));
        setAnalyses((prev) => {
          const next = { ...prev };
          for (const [id, a] of results) if (a) next[id] = a;
          return next;
        });
      }
    } finally {
      setAutoAnalyzing(false);
    }
  }, [analyzeOne]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('lead-drive', {
        body: { action: 'list_files', lead_id: leadId, lead_name: leadName },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const list: DriveFile[] = data.files || [];
      setFiles(list);
      setFolderUrl(data.folder_url);
      setAnalyses({});
      runAutoAnalysis(list);
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

  async function handleAnalyze(f: DriveFile) {
    setAnalyzingId(f.id);
    try {
      const { data, error } = await supabase.functions.invoke('lead-drive', {
        body: { action: 'analyze_file', lead_id: leadId, lead_name: leadName, file_id: f.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setAnalysisResult({ file: f, analysis: (data as any).analysis || {} });
      setAnalysisOpen(true);
    } catch (err: any) {
      console.error('[LeadDocumentsTab] analyze error', err);
      toast.error(`Erro ao analisar: ${err.message || err}`);
    } finally {
      setAnalyzingId(null);
    }
  }

  async function handleReprocess() {
    setReprocessing(true);
    const tId = toast.loading('Reprocessando procuração com IA…');
    try {
      const { data, error } = await supabase.functions.invoke('lead-reprocess-procuracao', {
        body: { lead_id: leadId },
      });
      if (error) throw error;
      if ((data as any)?.ok === false) throw new Error((data as any).error || 'Falha ao reprocessar');
      const applied = (data as any)?.enrich?.applied || {};
      const fields = Object.keys(applied);
      const filesUploaded = (data as any)?.enrich?.drive?.ok ? 1 : 0;
      toast.success(
        fields.length
          ? `Reprocessado: ${fields.length} campo(s) atualizado(s)${filesUploaded ? ' + PDF no Drive' : ''}`
          : 'Reprocessado (nenhum campo novo)',
        { id: tId },
      );
      await load();
    } catch (err: any) {
      console.error('[LeadDocumentsTab] reprocess error', err);
      toast.error(`Erro ao reprocessar: ${err.message || err}`, { id: tId });
    } finally {
      setReprocessing(false);
    }
  }

  const confidenceVariant = (c?: string) =>
    c === 'alta' ? 'default' : c === 'média' ? 'secondary' : 'outline';

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
          {whatsappGroupId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportGroupOpen(true)}
              title="Importa mídias enviadas no grupo do WhatsApp deste lead, organizando por tipo no Drive"
            >
              <MessagesSquare className="h-3.5 w-3.5 mr-1" />
              Importar do grupo
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleReprocess}
            disabled={reprocessing}
            title="Busca a procuração assinada mais recente, extrai dados via IA e sobe o PDF na pasta Drive"
          >
            {reprocessing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5 mr-1" />
            )}
            Reprocessar com IA
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
        <TooltipProvider delayDuration={150}>
          <div className="border rounded-lg divide-y">
            {autoAnalyzing && (
              <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2 bg-muted/20">
                <Loader2 className="h-3 w-3 animate-spin" /> Analisando documentos com IA…
              </div>
            )}
            {files.map((f) => {
              const a = analyses[f.id];
              const smartLabel = a?.document_type
                ? `${a.document_type}${a.holder_name ? ' — ' + a.holder_name : ''}`
                : null;
              const row = (
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
                      {smartLabel || f.name}
                    </a>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>{new Date(f.modifiedTime).toLocaleString('pt-BR')}{f.size && ` · ${formatBytes(f.size)}`}</span>
                      {smartLabel && <span className="opacity-60 truncate">· {f.name}</span>}
                      {!a && autoAnalyzing && (
                        <span className="inline-flex items-center gap-1 text-primary/70">
                          <Loader2 className="h-3 w-3 animate-spin" /> IA…
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAnalyze(f)}
                    disabled={analyzingId === f.id}
                    title="Ver análise detalhada"
                  >
                    {analyzingId === f.id ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                    )}
                    Detalhes IA
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(f)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              );
              if (!a?.description && !a?.document_type) return row;
              return (
                <Tooltip key={f.id}>
                  <TooltipTrigger asChild>{row}</TooltipTrigger>
                  <TooltipContent side="left" className="max-w-sm">
                    <div className="space-y-1 text-xs">
                      {a.document_type && (
                        <div className="font-semibold">
                          {a.document_type}
                          {a.holder_name ? ` — ${a.holder_name}` : ''}
                        </div>
                      )}
                      {a.holder_cpf && <div className="font-mono opacity-80">CPF: {a.holder_cpf}</div>}
                      {a.description && <div className="leading-relaxed opacity-90">{a.description}</div>}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      )}

      <Dialog open={analysisOpen} onOpenChange={setAnalysisOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Análise IA do documento
            </DialogTitle>
            <DialogDescription className="truncate">
              {analysisResult?.file.name}
            </DialogDescription>
          </DialogHeader>

          {analysisResult && (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                {analysisResult.analysis.document_type && (
                  <Badge variant="default">{analysisResult.analysis.document_type}</Badge>
                )}
                {analysisResult.analysis.document_subtype && (
                  <Badge variant="secondary">{analysisResult.analysis.document_subtype}</Badge>
                )}
                {analysisResult.analysis.confidence && (
                  <Badge variant={confidenceVariant(analysisResult.analysis.confidence) as any}>
                    Confiança: {analysisResult.analysis.confidence}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Titular</div>
                  <div className="font-medium">
                    {analysisResult.analysis.holder_name || <span className="text-muted-foreground">— não identificado —</span>}
                  </div>
                </div>
                {analysisResult.analysis.holder_cpf && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">CPF</div>
                    <div className="font-mono">{analysisResult.analysis.holder_cpf}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Descrição</div>
                  <div className="leading-relaxed">
                    {analysisResult.analysis.description || <span className="text-muted-foreground">—</span>}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={analysisResult.file.webViewLink} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Abrir no Drive
                  </a>
                </Button>
                <Button size="sm" onClick={() => setAnalysisOpen(false)}>Fechar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ImportGroupDocsDialog
        open={importGroupOpen}
        onOpenChange={setImportGroupOpen}
        leadId={leadId}
        leadName={leadName}
        whatsappGroupId={whatsappGroupId || null}
        onImported={load}
      />
    </div>
  );
}
