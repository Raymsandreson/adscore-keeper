import { useState, useMemo } from 'react';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Copy, FileSpreadsheet, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const RAILWAY_BASE_URL =
  (import.meta.env.VITE_RAILWAY_WEBHOOK_BASE_URL as string | undefined) ||
  'https://YOUR-RAILWAY-APP.up.railway.app';

const FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'phone', label: 'Telefone (obrigatório)' },
  { value: 'name', label: 'Nome' },
  { value: 'estado_civil', label: 'Estado civil' },
  { value: 'filho_autista', label: 'Filho autista' },
  { value: 'laudo', label: 'Laudo' },
  { value: 'renda', label: 'Renda' },
  { value: 'possui_advogado', label: 'Possui advogado' },
  { value: 'cidade', label: 'Cidade' },
  { value: 'estado', label: 'Estado' },
  { value: 'observacao', label: 'Observação' },
];

function generateToken(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Props {
  board: KanbanBoard;
  stages: KanbanStage[];
  onSave: (id: string, updates: Partial<KanbanBoard>) => Promise<KanbanBoard>;
}

export function BoardSheetIngestSection({ board, stages, onSave }: Props) {
  const [enabled, setEnabled] = useState(!!board.sheet_enabled);
  const [sourceUrl, setSourceUrl] = useState(board.sheet_source_url || '');
  const [initialStageId, setInitialStageId] = useState(board.sheet_initial_stage_id || stages[0]?.id || '');
  const [token, setToken] = useState(board.sheet_webhook_token || '');
  const [mapping, setMapping] = useState<Record<string, string>>(
    (board.sheet_field_mapping as Record<string, string>) || {},
  );
  const [headersInput, setHeadersInput] = useState(
    Object.values(mapping).join('\n'),
  );

  const webhookUrl = useMemo(() => {
    if (!token) return '';
    return `${RAILWAY_BASE_URL}/webhooks/sheet-lead-ingest/${token}`;
  }, [token]);

  const appsScriptCode = useMemo(() => {
    if (!webhookUrl) return '';
    return `// Cole no Editor de Apps Script da planilha
// (Extensões → Apps Script). Salve e crie um gatilho:
// Trigger: do evento "Ao enviar formulário" (onFormSubmit).
function onFormSubmit(e) {
  const headers = e.range.getSheet().getRange(1, 1, 1, e.values.length).getValues()[0];
  const row = {};
  headers.forEach((h, i) => { row[h] = e.values[i]; });

  UrlFetchApp.fetch('${webhookUrl}', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ row: row }),
    muteHttpExceptions: true,
  });
}`;
  }, [webhookUrl]);

  const headers = useMemo(
    () => headersInput.split('\n').map((s) => s.trim()).filter(Boolean),
    [headersInput],
  );

  const handleEnsureToken = () => {
    if (!token) setToken(generateToken());
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error('Erro ao copiar');
    }
  };

  const handleSetMapping = (field: string, header: string) => {
    setMapping((m) => {
      const next = { ...m };
      if (!header || header === '__none__') delete next[field];
      else next[field] = header;
      return next;
    });
  };

  const handleSave = async () => {
    if (enabled && !mapping.phone) {
      toast.error('Mapeie pelo menos a coluna de Telefone');
      return;
    }
    if (enabled && !token) {
      toast.error('Gere o token de segurança primeiro');
      return;
    }
    await onSave(board.id, {
      sheet_enabled: enabled,
      sheet_source_url: sourceUrl || null,
      sheet_webhook_token: token || null,
      sheet_field_mapping: mapping,
      sheet_initial_stage_id: initialStageId || null,
    });
    toast.success('Ingestão por planilha salva');
  };

  return (
    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          <Label className="font-semibold">Origem: Planilha (Lead Form)</Label>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); if (v) handleEnsureToken(); }} />
      </div>

      {enabled && (
        <>
          <div>
            <Label className="text-xs">URL da planilha</Label>
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="h-8 text-xs"
            />
          </div>

          <div>
            <Label className="text-xs">Estágio inicial dos leads criados</Label>
            <Select value={initialStageId} onValueChange={setInitialStageId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Cabeçalhos da planilha (uma coluna por linha)</Label>
            <Textarea
              value={headersInput}
              onChange={(e) => setHeadersInput(e.target.value)}
              placeholder={'Telefone\nNome\nEstado civil\nLaudo\nRenda'}
              rows={4}
              className="text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Cole aqui os nomes exatos das colunas da planilha (linha 1).
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Mapeamento (campo do lead → coluna da planilha)</Label>
            {FIELD_OPTIONS.map((f) => (
              <div key={f.value} className="grid grid-cols-2 gap-2 items-center">
                <span className="text-xs">{f.label}</span>
                <Select
                  value={mapping[f.value] || '__none__'}
                  onValueChange={(v) => handleSetMapping(f.value, v)}
                >
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— não usar —</SelectItem>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Token de segurança</Label>
              <div className="flex gap-1">
                {token && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setToken(generateToken())}>
                    Rotacionar
                  </Button>
                )}
                {!token && (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={handleEnsureToken}>
                    Gerar token
                  </Button>
                )}
              </div>
            </div>
            {webhookUrl && (
              <div className="space-y-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">URL do webhook</Label>
                  <div className="flex gap-1">
                    <Input value={webhookUrl} readOnly className="h-7 text-[10px] font-mono" />
                    <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleCopy(webhookUrl, 'URL')}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Apps Script (cole na planilha)</Label>
                  <Textarea value={appsScriptCode} readOnly rows={8} className="text-[10px] font-mono" />
                  <Button size="sm" variant="outline" className="h-7 mt-1 w-full" onClick={() => handleCopy(appsScriptCode, 'Apps Script')}>
                    <Copy className="h-3 w-3 mr-2" /> Copiar Apps Script
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <Button onClick={handleSave} size="sm" className="w-full">Salvar configuração de planilha</Button>
    </div>
  );
}
