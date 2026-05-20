import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ExternalLink, Upload, Trash2, FileText, Loader2, RefreshCw, Sparkles, Wand2, MessagesSquare, Combine, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
  extracted_fields?: Array<{ field_id: string; value: string }>;
}

export interface DocCustomFieldDef {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'url' | 'password';
  options?: string[];
}

interface Props {
  leadId: string;
  leadName: string;
  whatsappGroupId?: string | null;
  customFields?: DocCustomFieldDef[];
  onApplyExtractedFields?: (
    values: Record<string, { type: DocCustomFieldDef['type']; value: string | number | boolean | null }>,
  ) => Promise<void> | void;
}

function formatBytes(bytes?: string) {
  if (!bytes) return '';
  const n = parseInt(bytes, 10);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function LeadDocumentsTab({ leadId, leadName, whatsappGroupId, customFields, onApplyExtractedFields }: Props) {
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

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeName, setMergeName] = useState('');
  const [mergeDeleteOriginals, setMergeDeleteOriginals] = useState(true);
  const [merging, setMerging] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return [...prev, id];
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds([]);

  async function handleMerge() {
    if (selectedIds.length < 2) {
      toast.error('Selecione 2 ou mais arquivos para agrupar.');
      return;
    }
    setMerging(true);
    const tId = toast.loading(`Agrupando ${selectedIds.length} arquivos em um PDF...`);
    try {
      const { data, error } = await supabase.functions.invoke('lead-drive', {
        body: {
          action: 'merge_drive_files',
          lead_id: leadId,
          lead_name: leadName,
          file_ids: selectedIds,
          output_name: mergeName.trim() || undefined,
          delete_originals: mergeDeleteOriginals,
        },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.success === false || d?.ok === false) throw new Error(d?.error || 'Falha ao agrupar');
      const skipped = (d?.skipped || []).length;
      toast.success(
        skipped
          ? `PDF criado (${d.merged.length} OK, ${skipped} pulados)`
          : `PDF criado com ${d.merged.length} arquivo(s)`,
        { id: tId },
      );
      clearSelection();
      setMergeOpen(false);
      setMergeName('');
      await load();
    } catch (err: any) {
      console.error('[LeadDocumentsTab] merge error', err);
      toast.error(`Erro ao agrupar: ${err.message || err}`, { id: tId });
    } finally {
      setMerging(false);
    }
  }

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
      setSelectedIds((prev) => prev.filter((id) => list.some((f) => f.id === id)));
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

  const [selectedExtracted, setSelectedExtracted] = useState<Record<string, boolean>>({});
  const [applyingFields, setApplyingFields] = useState(false);

  async function handleAnalyze(f: DriveFile) {
    setAnalyzingId(f.id);
    try {
      const cfPayload = (customFields || []).map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        options: c.options,
      }));
      const { data, error } = await supabase.functions.invoke('lead-drive', {
        body: {
          action: 'analyze_file',
          lead_id: leadId,
          lead_name: leadName,
          file_id: f.id,
          custom_fields: cfPayload,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const analysis = ((data as any).analysis || {}) as Analysis;
      const renamed = (data as any).renamed as string | null;
      setAnalysisResult({ file: { ...f, name: renamed || f.name }, analysis });
      setAnalyses((prev) => ({ ...prev, [f.id]: analysis }));
      if (renamed) {
        setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, name: renamed } : x)));
      }
      // pré-selecionar todos os campos extraídos
      const sel: Record<string, boolean> = {};
      (analysis.extracted_fields || []).forEach((ef) => { sel[ef.field_id] = true; });
      setSelectedExtracted(sel);
      setAnalysisOpen(true);
    } catch (err: any) {
      console.error('[LeadDocumentsTab] analyze error', err);
      toast.error(`Erro ao analisar: ${err.message || err}`);
    } finally {
      setAnalyzingId(null);
    }
  }

  async function handleApplyExtracted() {
    if (!analysisResult || !onApplyExtractedFields) return;
    const extracted = analysisResult.analysis.extracted_fields || [];
    const defs = customFields || [];
    const values: Record<string, { type: DocCustomFieldDef['type']; value: string | number | boolean | null }> = {};
    for (const ef of extracted) {
      if (!selectedExtracted[ef.field_id]) continue;
      const def = defs.find((d) => d.id === ef.field_id);
      if (!def) continue;
      let v: string | number | boolean | null = ef.value;
      if (def.type === 'number') {
        const n = Number(String(ef.value).replace(',', '.'));
        v = Number.isFinite(n) ? n : null;
      } else if (def.type === 'checkbox') {
        v = String(ef.value).toLowerCase() === 'true';
      } else if (def.type === 'date') {
        v = ef.value || null;
      }
      values[ef.field_id] = { type: def.type, value: v };
    }
    if (Object.keys(values).length === 0) {
      toast.info('Nenhum campo selecionado');
      return;
    }
    setApplyingFields(true);
    try {
      await onApplyExtractedFields(values);
      toast.success(`${Object.keys(values).length} campo(s) atualizado(s)`);
      setAnalysisOpen(false);
    } catch (e: any) {
      toast.error(`Erro ao aplicar: ${e.message || e}`);
    } finally {
      setApplyingFields(false);
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

      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 flex-wrap">
          <div className="text-sm">
            <span className="font-medium">{selectedIds.length}</span> arquivo(s) selecionado(s)
            {selectedIds.length < 2 && (
              <span className="text-muted-foreground"> · selecione 2 ou mais para agrupar</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="h-3.5 w-3.5 mr-1" /> Limpar
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const firstName = files.find((f) => f.id === selectedIds[0])?.name || '';
                setMergeName(firstName.replace(/\.[^.]+$/, ''));
                setMergeOpen(true);
              }}
              disabled={selectedIds.length < 2}
            >
              <Combine className="h-3.5 w-3.5 mr-1" /> Agrupar em PDF
            </Button>
          </div>
        </div>
      )}

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
            {files.map((f) => {
              const a = analyses[f.id];
              const smartLabel = a?.document_type
                ? `${a.document_type}${a.holder_name ? ' — ' + a.holder_name : ''}`
                : null;
              const row = (
                <div key={f.id} className={`flex items-center gap-3 p-3 hover:bg-muted/30 ${selectedIds.includes(f.id) ? 'bg-primary/5' : ''}`}>
                  <Checkbox
                    checked={selectedIds.includes(f.id)}
                    onCheckedChange={() => toggleSelect(f.id)}
                    aria-label="Selecionar para agrupar"
                  />
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

              {(() => {
                const extracted = analysisResult.analysis.extracted_fields || [];
                if (extracted.length === 0) return null;
                const defs = customFields || [];
                const rows = extracted
                  .map((ef) => ({ ef, def: defs.find((d) => d.id === ef.field_id) }))
                  .filter((r) => r.def);
                if (rows.length === 0) return null;
                return (
                  <div className="border-t pt-3 space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Campos detectados no documento
                    </div>
                    <div className="space-y-1.5">
                      {rows.map(({ ef, def }) => (
                        <label
                          key={ef.field_id}
                          className="flex items-start gap-2 text-sm p-2 rounded hover:bg-muted/40 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={!!selectedExtracted[ef.field_id]}
                            onChange={(e) =>
                              setSelectedExtracted((p) => ({ ...p, [ef.field_id]: e.target.checked }))
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-muted-foreground">{def!.name}</div>
                            <div className="font-medium break-words">{ef.value}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={analysisResult.file.webViewLink} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Abrir no Drive
                  </a>
                </Button>
                {(analysisResult.analysis.extracted_fields || []).length > 0 && onApplyExtractedFields && (
                  <Button size="sm" onClick={handleApplyExtracted} disabled={applyingFields}>
                    {applyingFields ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
                    Aplicar aos campos
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setAnalysisOpen(false)}>Fechar</Button>
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

      <Dialog open={mergeOpen} onOpenChange={(o) => !merging && setMergeOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Combine className="h-4 w-4" /> Agrupar em um PDF único
            </DialogTitle>
            <DialogDescription>
              {selectedIds.length} arquivo(s) serão unidos na ordem de seleção. PDFs, JPG e PNG são suportados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nome do PDF</label>
              <Input
                value={mergeName}
                onChange={(e) => setMergeName(e.target.value)}
                placeholder="Ex.: RG — João Silva — PREV 597"
                disabled={merging}
              />
              <div className="text-[11px] text-muted-foreground mt-1">.pdf será adicionado automaticamente.</div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={mergeDeleteOriginals}
                onCheckedChange={(v) => setMergeDeleteOriginals(v === true)}
                disabled={merging}
              />
              Apagar os arquivos originais após agrupar
            </label>
            <div className="max-h-40 overflow-auto rounded border p-2 space-y-1">
              {selectedIds.map((id, i) => {
                const f = files.find((x) => x.id === id);
                if (!f) return null;
                return (
                  <div key={id} className="text-xs flex items-center gap-2">
                    <span className="font-mono opacity-60 w-5 text-right">{i + 1}.</span>
                    <span className="truncate">{f.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(false)} disabled={merging}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleMerge} disabled={merging || selectedIds.length < 2}>
              {merging ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Combine className="h-3.5 w-3.5 mr-1" />}
              Agrupar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
