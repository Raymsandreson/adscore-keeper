/**
 * Painel de gestão das etiquetas-de-etapa do Kanban.
 *
 * Permite:
 *  - Ver status de cada etapa (sincronizada / pendente, por instância)
 *  - Definir result_key (reaproveitar etiqueta global Fechado/Recusado/Inviável/Cancelado/Em andamento)
 *  - Disparar "Sincronizar etiquetas com WhatsApp" (cria/atualiza no UazAPI)
 *  - Apagar todas as etiquetas do board
 *  - 🧪 Simular webhook UazAPI (testar o fluxo WA → Kanban sem precisar do app real)
 */
import { useState } from 'react';
import { Tag, RefreshCw, Trash2, FlaskConical, Loader2, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useQueryClient } from '@tanstack/react-query';
import { useStageLabelMappings } from '@/hooks/useStageLabelMappings';
import { cloudFunctions } from '@/lib/functionRouter';

interface Props {
  boardId: string;
  boardName?: string;
}

const RESULT_KEY_OPTIONS = [
  { value: '__none__', label: 'Etiqueta própria desta etapa' },
  { value: 'closed',      label: '✅ Reaproveitar "Fechado" (global)' },
  { value: 'refused',     label: '❌ Reaproveitar "Recusado" (global)' },
  { value: 'inviavel',    label: '⚠️ Reaproveitar "Inviável" (global)' },
  { value: 'cancelled',   label: '🚫 Reaproveitar "Cancelado" (global)' },
  { value: 'in_progress', label: '🕐 Reaproveitar "Em andamento" (global)' },
];

export function StageLabelSetupPanel({ boardId, boardName }: Props) {
  const { data, isLoading, refetch } = useStageLabelMappings(boardId);
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [savingStage, setSavingStage] = useState<string | null>(null);
  const [mockOpen, setMockOpen] = useState(false);
  const [mockPhone, setMockPhone] = useState('');
  const [mockInstance, setMockInstance] = useState('');
  const [mockLabelId, setMockLabelId] = useState('');

  async function runSync(operation: 'upsert' | 'delete') {
    setSyncing(true);
    try {
      const { data: resp, error } = await cloudFunctions.invoke<any>('sync-stage-labels', {
        body: { board_id: boardId, operation },
      });
      if (error || !resp?.success) {
        toast.error(resp?.error || error?.message || 'Falha ao sincronizar');
        return;
      }
      const ok = (resp.results || []).filter((r: any) => r.ok).length;
      const fail = (resp.results || []).filter((r: any) => !r.ok).length;
      toast.success(`Sincronização concluída: ${ok} ok, ${fail} falhas`);
      await refetch();
      await qc.invalidateQueries({ queryKey: ['stage-label-mappings', boardId] });
    } finally {
      setSyncing(false);
    }
  }

  async function setResultKey(stageId: string, value: string) {
    setSavingStage(stageId);
    try {
      const normalized = value === '__none__' ? null : value;
      const { data: resp, error } = await cloudFunctions.invoke<any>('set-stage-result-key', {
        body: { board_id: boardId, stage_id: stageId, result_key: normalized },
      });
      if (error || !resp?.success) {
        toast.error(resp?.error || error?.message || 'Falha ao salvar');
        return;
      }
      toast.success('Atualizado. Rode "Sincronizar etiquetas" para aplicar no WhatsApp.');
      await refetch();
    } finally {
      setSavingStage(null);
    }
  }

  async function simulateWebhook() {
    if (!mockPhone || !mockInstance || !mockLabelId) {
      toast.error('Preencha telefone, instância e label_id');
      return;
    }
    try {
      const phoneDigits = mockPhone.replace(/\D/g, '');
      const chatId = `${phoneDigits}@s.whatsapp.net`;
      const payload = {
        EventType: 'chat_labels',
        event: 'chat_labels',
        instanceName: mockInstance,
        chat: { wa_chatid: chatId, wa_label: [mockLabelId] },
        chatid: chatId,
        labelids: [mockLabelId],
      };
      const railwayUrl = 'https://adscore-keeper-production.up.railway.app';
      const r = await fetch(`${railwayUrl}/webhooks/uazapi/${mockInstance}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      if (!r.ok) {
        toast.error(`Webhook retornou ${r.status}: ${text.slice(0, 150)}`);
        return;
      }
      toast.success('Webhook simulado enviado. O lead deve mover no Kanban em segundos.');
      setMockOpen(false);
    } catch (e: any) {
      toast.error(`Erro: ${e?.message}`);
    }
  }

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Tag className="h-4 w-4" /> Etiquetas WhatsApp (etapas) — {boardName || 'Board'}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Cada etapa do board corresponde a uma etiqueta no WhatsApp Business. Sincronizar cria/atualiza as etiquetas em todas as instâncias ativas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => runSync('upsert')} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Sincronizar etiquetas
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMockOpen(true)}>
            <FlaskConical className="h-3.5 w-3.5 mr-1.5" /> Simular webhook
          </Button>
          <Button size="sm" variant="ghost" onClick={() => {
            if (confirm('Apagar TODAS as etiquetas deste board no WhatsApp? Cards no Kanban não são afetados.')) runSync('delete');
          }} disabled={syncing}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Apagar do WhatsApp
          </Button>
        </div>
      </div>

      <div className="border rounded-md divide-y">
        {isLoading && <div className="p-4 text-sm text-muted-foreground">Carregando…</div>}
        {!isLoading && (data?.stages || []).map((s) => (
          <div key={s.stage_id} className="p-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-center">
            <div className="flex items-center gap-2 min-w-0">
              {s.synced
                ? <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                : <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />}
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{s.stage_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {s.instances.length > 0
                    ? `Sincronizada em ${s.instances.length} instância(s): ${s.instances.map((i) => i.label_name).slice(0, 2).join(', ')}`
                    : 'Pendente de sincronização'}
                </div>
              </div>
            </div>
            <Select
              value={s.result_key || '__none__'}
              onValueChange={(v) => setResultKey(s.stage_id, v)}
              disabled={savingStage === s.stage_id}
            >
              <SelectTrigger className="h-8 w-[260px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESULT_KEY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <Dialog open={mockOpen} onOpenChange={setMockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Simular webhook UazAPI</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Envia um POST direto pro endpoint público <code>/webhooks/uazapi/&lt;instance&gt;</code> simulando o evento
              <code> chat_labels</code> da UazAPI. Útil pra validar que o card move sozinho no Kanban.
            </p>
            <div>
              <Label className="text-xs">Telefone (com DDI, ex 5511999998888)</Label>
              <Input value={mockPhone} onChange={(e) => setMockPhone(e.target.value)} placeholder="55119..." />
            </div>
            <div>
              <Label className="text-xs">Nome da instância UazAPI</Label>
              <Input value={mockInstance} onChange={(e) => setMockInstance(e.target.value)} placeholder="ex: bpc-autismo-01" />
            </div>
            <div>
              <Label className="text-xs">label_id (copie da tabela acima)</Label>
              <Input value={mockLabelId} onChange={(e) => setMockLabelId(e.target.value)} placeholder="xxx-xxx" />
            </div>
            {data?.stages && (
              <div className="text-xs text-muted-foreground border rounded p-2 max-h-32 overflow-y-auto space-y-0.5">
                <div className="font-medium mb-1">label_ids disponíveis:</div>
                {data.stages.flatMap((s) => s.instances.map((i) => (
                  <div key={`${s.stage_id}-${i.instance_name}`}>
                    <button type="button" className="font-mono hover:underline" onClick={() => {
                      setMockLabelId(i.label_id);
                      setMockInstance(i.instance_name);
                    }}>
                      {i.label_id}
                    </button>
                    {' '}— {i.instance_name} / {s.stage_name}
                  </div>
                )))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMockOpen(false)}>Cancelar</Button>
            <Button onClick={simulateWebhook}>Enviar webhook simulado</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
