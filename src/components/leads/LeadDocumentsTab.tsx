import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ExternalLink, Upload, Trash2, FileText, Loader2, RefreshCw, Sparkles, Wand2, MessagesSquare, Combine, X, ShieldCheck, Check, AlertTriangle, User } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import ImportGroupDocsDialog from '@/components/leads/ImportGroupDocsDialog';
import { useAutoImportGroupDocs } from '@/hooks/useAutoImportGroupDocs';
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
  /** Análise IA persistida no próprio arquivo do Drive (lead-drive v5+). */
  ai_analysis?: Analysis | null;
  ai_analyzed_at?: string | null;
}

interface Analysis {
  document_type?: string;
  document_subtype?: string | null;
  holder_name?: string | null;
  holder_cpf?: string | null;
  description?: string;
  confidence?: 'alta' | 'média' | 'baixa' | string;
  extracted_fields?: Array<{ field_id: string; value: string }>;
  /** Dados achados no documento que não têm campo neste funil — só informativo. */
  other_findings?: Array<{ label: string; value: string }>;
}

/** Campo decidido pela IA depois de cruzar TODOS os documentos do lead. */
interface ConsolidatedField {
  field_id: string;
  field_name?: string;
  value: string;
  reasoning?: string;
  confidence?: string | null;
  sources?: Array<{ file_id: string; file_name: string; document_type: string | null }>;
}

interface ConsolidationConflict {
  field_id: string;
  field_name?: string;
  note?: string;
  candidates?: Array<{ value: string; source: { file_id: string; file_name: string } | null }>;
}

interface Consolidation {
  docs_considered: number;
  main_holder_name?: string | null;
  main_holder_cpf?: string | null;
  summary?: string | null;
  fields: ConsolidatedField[];
  conflicts: ConsolidationConflict[];
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

/** Converte o valor que a IA devolve (sempre string) para o tipo do campo do CRM. */
function coerceFieldValue(
  type: DocCustomFieldDef['type'],
  raw: string,
): string | number | boolean | null {
  if (type === 'number') {
    const n = Number(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'checkbox') return String(raw).toLowerCase() === 'true';
  if (type === 'date') return raw || null;
  return raw;
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
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const batchAbort = useRef(false);
  const [batchSummaryOpen, setBatchSummaryOpen] = useState(false);
  const [batchResults, setBatchResults] = useState<Array<{ file: DriveFile; analysis: Analysis }>>([]);
  const [batchSelected, setBatchSelected] = useState<Record<string, boolean>>({});

  const [consolidating, setConsolidating] = useState(false);
  const [consolidation, setConsolidation] = useState<Consolidation | null>(null);
  const [consolidationOpen, setConsolidationOpen] = useState(false);
  const [consolidationSelected, setConsolidationSelected] = useState<Record<string, boolean>>({});

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
      // A análise vem persistida no arquivo do Drive (lead-drive v5+). Hidratar
      // aqui é o que faz a tela lembrar quais documentos já foram extraídos —
      // antes o state era zerado e tudo voltava a parecer "não analisado".
      const hydrated: Record<string, Analysis> = {};
      for (const f of list) {
        if (f.ai_analysis && typeof f.ai_analysis === 'object') hydrated[f.id] = f.ai_analysis;
      }
      setAnalyses(hydrated);
      setSelectedIds((prev) => prev.filter((id) => list.some((f) => f.id === id)));
    } catch (e: any) {
      console.error('[LeadDocumentsTab] load error', e);
      toast.error(`Erro ao carregar documentos: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [leadId, leadName]);

  useEffect(() => { load(); }, [load]);

  // Auto-importa mídias recentes do grupo WhatsApp para o Drive (tudo como "Outro").
  // Roda 1x por sessão por lead; a edge `lead-drive` e `import-group-docs-to-lead`
  // deduplicam, então re-abrir o lead não cria duplicatas.
  useAutoImportGroupDocs(leadId, leadName, whatsappGroupId, load);



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

  const cfPayload = useMemo(
    () => (customFields || []).map((c) => ({ id: c.id, name: c.name, type: c.type, options: c.options })),
    [customFields],
  );

  /**
   * Roda a análise IA de um arquivo. `force` reprocessa mesmo se já houver
   * análise gravada no Drive; `silent` não abre o diálogo (usado pelo lote).
   */
  const runAnalyze = useCallback(
    async (f: DriveFile, opts: { force?: boolean } = {}): Promise<Analysis> => {
      const { data, error } = await supabase.functions.invoke('lead-drive', {
        body: {
          action: 'analyze_file',
          lead_id: leadId,
          lead_name: leadName,
          file_id: f.id,
          custom_fields: cfPayload,
          force: !!opts.force,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const analysis = ((data as any).analysis || {}) as Analysis;
      const renamed = (data as any).renamed as string | null;
      setAnalyses((prev) => ({ ...prev, [f.id]: analysis }));
      setFiles((prev) =>
        prev.map((x) =>
          x.id === f.id
            ? { ...x, ...(renamed ? { name: renamed } : {}), ai_analysis: analysis, ai_analyzed_at: new Date().toISOString() }
            : x,
        ),
      );
      return analysis;
    },
    [leadId, leadName, cfPayload],
  );

  async function handleAnalyze(f: DriveFile, opts: { force?: boolean } = {}) {
    setAnalyzingId(f.id);
    try {
      const analysis = await runAnalyze(f, opts);
      setAnalysisResult({ file: f, analysis });
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

  /** Abre o diálogo com a análise já gravada, sem gastar nova chamada de IA. */
  function openStoredAnalysis(f: DriveFile) {
    const analysis = analyses[f.id];
    if (!analysis) return;
    setAnalysisResult({ file: f, analysis });
    const sel: Record<string, boolean> = {};
    (analysis.extracted_fields || []).forEach((ef) => { sel[ef.field_id] = true; });
    setSelectedExtracted(sel);
    setAnalysisOpen(true);
  }

  const pendingFiles = useMemo(() => files.filter((f) => !analyses[f.id]), [files, analyses]);
  const analyzedCount = useMemo(() => files.filter((f) => !!analyses[f.id]).length, [files, analyses]);

  /**
   * FASE 2 da extração: manda o dossiê inteiro do lead para a IA decidir cada
   * campo olhando o CONJUNTO dos documentos.
   *
   * A fase 1 (`analyze_file`) lê um documento por vez e não sabe que os outros
   * existem — então o RG frente não sabia do verso, e quando dois documentos
   * traziam o mesmo campo quem desempatava era a ordem da fila, não a IA.
   * Aqui ela vê tudo junto antes de escolher.
   */
  const runConsolidation = useCallback(async (): Promise<Consolidation | null> => {
    if (!onApplyExtractedFields || cfPayload.length === 0) return null;
    setConsolidating(true);
    try {
      const { data, error } = await supabase.functions.invoke('lead-drive', {
        body: {
          action: 'consolidate_lead_fields',
          lead_id: leadId,
          lead_name: leadName,
          custom_fields: cfPayload,
        },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.ok === false) throw new Error(d?.error || 'Falha ao cruzar os documentos');
      const result: Consolidation = {
        docs_considered: d.docs_considered || 0,
        main_holder_name: d.main_holder_name || null,
        main_holder_cpf: d.main_holder_cpf || null,
        summary: d.summary || null,
        fields: Array.isArray(d.fields) ? d.fields : [],
        conflicts: Array.isArray(d.conflicts) ? d.conflicts : [],
      };
      setConsolidation(result);
      const sel: Record<string, boolean> = {};
      // Confiança baixa não vem pré-marcada — o usuário confirma antes de gravar.
      result.fields.forEach((f) => { sel[f.field_id] = f.confidence !== 'baixa'; });
      setConsolidationSelected(sel);
      return result;
    } catch (e: any) {
      console.error('[LeadDocumentsTab] consolidate error', e);
      toast.error(`Erro ao cruzar documentos: ${e.message || e}`);
      return null;
    } finally {
      setConsolidating(false);
    }
  }, [leadId, leadName, cfPayload, onApplyExtractedFields]);

  /** Só a fase 2, para quando todos os documentos já estão extraídos. */
  async function handleConsolidateOnly() {
    const result = await runConsolidation();
    if (!result) return;
    if (result.fields.length === 0 && result.conflicts.length === 0) {
      toast.info(`Cruzei ${result.docs_considered} documento(s) e nenhum campo do funil pôde ser preenchido com segurança.`);
      return;
    }
    setConsolidationOpen(true);
  }

  /**
   * Extrai em lote todos os documentos ainda não analisados.
   * Concorrência 3: o gateway do Drive + Gemini aguentam, e mantém o tempo
   * total baixo sem disparar 429 (a edge já tem retry, mas evitar é melhor).
   */
  async function handleAnalyzeAll() {
    const queue = [...pendingFiles];
    if (queue.length === 0) {
      await handleConsolidateOnly();
      return;
    }
    batchAbort.current = false;
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: queue.length });
    const results: Array<{ file: DriveFile; analysis: Analysis }> = [];
    const failures: string[] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length && !batchAbort.current) {
        const f = queue[cursor++];
        try {
          const analysis = await runAnalyze(f);
          results.push({ file: f, analysis });
        } catch (e: any) {
          console.error('[LeadDocumentsTab] batch analyze error', f.name, e);
          failures.push(f.name);
        } finally {
          setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
      if (failures.length) {
        toast.warning(`${results.length} extraído(s), ${failures.length} falharam: ${failures.slice(0, 3).join(', ')}`);
      } else if (!batchAbort.current) {
        toast.success(`${results.length} documento(s) extraído(s)`);
      }
    } finally {
      setBatchRunning(false);
    }

    if (batchAbort.current || !onApplyExtractedFields) return;

    // FASE 2: agora que todo documento tem leitura própria, a IA cruza o
    // conjunto inteiro e decide os campos. Se ela falhar, cai no resumo antigo
    // (um bloco por documento) para o trabalho da fase 1 não se perder.
    const consolidated = await runConsolidation();
    if (consolidated && (consolidated.fields.length > 0 || consolidated.conflicts.length > 0)) {
      setConsolidationOpen(true);
      return;
    }

    const withFields = results.filter((r) => (r.analysis.extracted_fields || []).length > 0);
    if (withFields.length) {
      setBatchResults(withFields);
      // Fallback: pré-seleciona 1 valor por campo, o primeiro documento vence.
      const sel: Record<string, boolean> = {};
      const seenField = new Set<string>();
      for (const r of withFields) {
        for (const ef of r.analysis.extracted_fields || []) {
          const key = `${r.file.id}:${ef.field_id}`;
          sel[key] = !seenField.has(ef.field_id);
          seenField.add(ef.field_id);
        }
      }
      setBatchSelected(sel);
      setBatchSummaryOpen(true);
    }
  }

  /** Grava no lead os campos consolidados que o usuário deixou marcados. */
  async function handleApplyConsolidation() {
    if (!consolidation || !onApplyExtractedFields) return;
    const defs = customFields || [];
    const values: Record<string, { type: DocCustomFieldDef['type']; value: string | number | boolean | null }> = {};
    for (const f of consolidation.fields) {
      if (!consolidationSelected[f.field_id]) continue;
      const def = defs.find((d) => d.id === f.field_id);
      if (!def) continue;
      values[f.field_id] = { type: def.type, value: coerceFieldValue(def.type, f.value) };
    }
    if (Object.keys(values).length === 0) {
      toast.info('Nenhum campo selecionado');
      return;
    }
    setApplyingFields(true);
    try {
      await onApplyExtractedFields(values);
      toast.success(`${Object.keys(values).length} campo(s) atualizado(s)`);
      setConsolidationOpen(false);
    } catch (e: any) {
      toast.error(`Erro ao aplicar: ${e.message || e}`);
    } finally {
      setApplyingFields(false);
    }
  }

  /** Aplica no lead os campos marcados no resumo do lote. */
  async function handleApplyBatch() {
    if (!onApplyExtractedFields) return;
    const defs = customFields || [];
    const values: Record<string, { type: DocCustomFieldDef['type']; value: string | number | boolean | null }> = {};
    for (const r of batchResults) {
      for (const ef of r.analysis.extracted_fields || []) {
        if (!batchSelected[`${r.file.id}:${ef.field_id}`]) continue;
        const def = defs.find((d) => d.id === ef.field_id);
        if (!def) continue;
        values[ef.field_id] = { type: def.type, value: coerceFieldValue(def.type, ef.value) };
      }
    }
    if (Object.keys(values).length === 0) {
      toast.info('Nenhum campo selecionado');
      return;
    }
    setApplyingFields(true);
    try {
      await onApplyExtractedFields(values);
      toast.success(`${Object.keys(values).length} campo(s) atualizado(s)`);
      setBatchSummaryOpen(false);
    } catch (e: any) {
      toast.error(`Erro ao aplicar: ${e.message || e}`);
    } finally {
      setApplyingFields(false);
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
      values[ef.field_id] = { type: def.type, value: coerceFieldValue(def.type, ef.value) };
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

  const signedProcuracao = files.find((f) => /^procura[cç]/i.test(f.name));

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
            onClick={handleAnalyzeAll}
            disabled={batchRunning || consolidating || loading || files.length === 0}
            title="Lê os documentos que faltam e depois cruza TODOS eles numa análise só, para a IA decidir cada campo com o contexto completo do lead"
          >
            {batchRunning || consolidating ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1" />
            )}
            {batchRunning
              ? `Lendo ${batchProgress.done}/${batchProgress.total}…`
              : consolidating
                ? 'Cruzando documentos…'
                : pendingFiles.length > 0
                  ? `Extrair e cruzar com IA (${pendingFiles.length})`
                  : `Cruzar os ${analyzedCount} documentos`}
          </Button>
          {batchRunning && (
            <Button variant="ghost" size="sm" onClick={() => { batchAbort.current = true; }}>
              <X className="h-3.5 w-3.5 mr-1" /> Parar
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

      {signedProcuracao && (
        <a
          href={signedProcuracao.webViewLink}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm hover:bg-emerald-500/15 transition-colors"
          title="Clique para abrir a procuração assinada no Drive"
        >
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-emerald-700 dark:text-emerald-300">
              Procuração assinada · arquivada automaticamente
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {signedProcuracao.name}
              {signedProcuracao.modifiedTime && (
                <> · {new Date(signedProcuracao.modifiedTime).toLocaleDateString('pt-BR')}</>
              )}
            </div>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </a>
      )}

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
              const done = !!a;
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
                      title={smartLabel ? `${smartLabel}\n${f.name}` : f.name}
                    >
                      {smartLabel || f.name}
                    </a>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>{new Date(f.modifiedTime).toLocaleString('pt-BR')}{f.size && ` · ${formatBytes(f.size)}`}</span>
                      {smartLabel && <span className="opacity-60 truncate">· {f.name}</span>}
                      {done && (
                        <Badge variant="outline" className="h-4 px-1 gap-0.5 text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                          <Check className="h-2.5 w-2.5" /> IA extraída
                        </Badge>
                      )}
                    </div>
                  </div>
                  {done ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openStoredAnalysis(f)} title="Ver a análise já extraída (não gasta IA)">
                        Ver detalhes
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleAnalyze(f, { force: true })}
                        disabled={analyzingId === f.id || batchRunning}
                        title="Reanalisar com IA"
                      >
                        {analyzingId === f.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAnalyze(f)}
                      disabled={analyzingId === f.id || batchRunning}
                      title="Extrair dados deste documento com IA"
                    >
                      {analyzingId === f.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                      )}
                      Detalhes IA
                    </Button>
                  )}
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

              {(analysisResult.analysis.other_findings || []).length > 0 && (
                <div className="border-t pt-3 space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">
                    Também encontrado no documento
                    <span className="font-normal"> · sem campo neste funil, não é aplicado</span>
                  </div>
                  <div className="space-y-1">
                    {(analysisResult.analysis.other_findings || []).map((of, i) => (
                      <div key={`${of.label}-${i}`} className="text-sm px-2 py-1 rounded bg-muted/40">
                        <span className="text-xs text-muted-foreground">{of.label}: </span>
                        <span className="break-words">{of.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

      {/* Resultado da FASE 2: a IA já cruzou todos os documentos e traz UM valor
          por campo, com a origem e o motivo da escolha. */}
      <Dialog open={consolidationOpen} onOpenChange={(o) => !applyingFields && setConsolidationOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              Análise cruzada dos documentos
            </DialogTitle>
            <DialogDescription>
              A IA leu os {consolidation?.docs_considered ?? 0} documentos deste lead em conjunto antes de decidir cada campo.
            </DialogDescription>
          </DialogHeader>

          {consolidation && (
            <div className="max-h-[60vh] overflow-auto space-y-3 pr-1">
              {(consolidation.main_holder_name || consolidation.summary) && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                  {consolidation.main_holder_name && (
                    <div className="flex items-start gap-2 text-sm">
                      <User className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">Titular identificado no conjunto</div>
                        <div className="font-medium break-words">
                          {consolidation.main_holder_name}
                          {consolidation.main_holder_cpf && (
                            <span className="font-mono text-xs text-muted-foreground ml-2">
                              {consolidation.main_holder_cpf}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {consolidation.summary && (
                    <div className="text-sm leading-relaxed text-muted-foreground">{consolidation.summary}</div>
                  )}
                </div>
              )}

              {consolidation.fields.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  Nenhum campo do funil pôde ser preenchido com segurança a partir destes documentos.
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-muted-foreground">
                    Campos decididos · marque o que deve ir para o lead
                  </div>
                  {consolidation.fields.map((f) => (
                    <label
                      key={f.field_id}
                      className="flex items-start gap-2.5 p-2 rounded-lg border hover:bg-muted/40 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={!!consolidationSelected[f.field_id]}
                        onChange={(e) =>
                          setConsolidationSelected((p) => ({ ...p, [f.field_id]: e.target.checked }))
                        }
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">{f.field_name || f.field_id}</span>
                          {f.confidence && (
                            <Badge variant={confidenceVariant(f.confidence) as any} className="h-4 px-1 text-[10px]">
                              {f.confidence}
                            </Badge>
                          )}
                        </div>
                        <div className="font-medium break-words">{f.value}</div>
                        {f.reasoning && (
                          <div className="text-xs text-muted-foreground leading-relaxed">{f.reasoning}</div>
                        )}
                        {(f.sources || []).length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {(f.sources || []).map((s) => (
                              <Badge
                                key={s.file_id}
                                variant="outline"
                                className="h-4 px-1 text-[10px] max-w-[220px] truncate"
                                title={s.file_name}
                              >
                                {s.document_type || s.file_name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {consolidation.conflicts.length > 0 && (
                <div className="space-y-1.5 border-t pt-3">
                  <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Documentos discordam · precisa de conferência humana
                  </div>
                  {consolidation.conflicts.map((c) => (
                    <div key={c.field_id} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 space-y-1">
                      <div className="text-xs font-medium">{c.field_name || c.field_id}</div>
                      {c.note && <div className="text-xs text-muted-foreground leading-relaxed">{c.note}</div>}
                      {(c.candidates || []).map((cd, i) => (
                        <div key={`${c.field_id}-${i}`} className="text-sm flex items-baseline gap-2 flex-wrap">
                          <span className="break-words">{cd.value}</span>
                          {cd.source && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[220px]" title={cd.source.file_name}>
                              · {cd.source.file_name}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setConsolidationOpen(false)} disabled={applyingFields}>
              Fechar
            </Button>
            <Button
              size="sm"
              onClick={handleApplyConsolidation}
              disabled={applyingFields || !consolidation?.fields.length}
            >
              {applyingFields ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
              Aplicar aos campos
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={batchSummaryOpen} onOpenChange={(o) => !applyingFields && setBatchSummaryOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Campos detectados na extração em lote
            </DialogTitle>
            <DialogDescription>
              {batchResults.length} documento(s) trouxeram dados. Marque o que deve ir para os campos do lead.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-auto space-y-3">
            {batchResults.map((r) => {
              const defs = customFields || [];
              const rows = (r.analysis.extracted_fields || [])
                .map((ef) => ({ ef, def: defs.find((d) => d.id === ef.field_id) }))
                .filter((x) => x.def);
              if (rows.length === 0) return null;
              return (
                <div key={r.file.id} className="border rounded-lg p-2 space-y-1">
                  <div className="text-xs font-semibold truncate">
                    {r.analysis.document_type || r.file.name}
                    {r.analysis.holder_name ? ` — ${r.analysis.holder_name}` : ''}
                  </div>
                  {rows.map(({ ef, def }) => {
                    const key = `${r.file.id}:${ef.field_id}`;
                    return (
                      <label key={key} className="flex items-start gap-2 text-sm p-1.5 rounded hover:bg-muted/40 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!!batchSelected[key]}
                          onChange={(e) => setBatchSelected((p) => ({ ...p, [key]: e.target.checked }))}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-muted-foreground">{def!.name}</div>
                          <div className="font-medium break-words">{ef.value}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setBatchSummaryOpen(false)} disabled={applyingFields}>
              Fechar
            </Button>
            <Button size="sm" onClick={handleApplyBatch} disabled={applyingFields}>
              {applyingFields ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
              Aplicar aos campos
            </Button>
          </div>
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
