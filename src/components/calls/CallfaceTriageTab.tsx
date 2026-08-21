import { useState, useMemo, useEffect } from 'react';
import { useCallfaceTriage, TriageCall } from '@/hooks/useCallfaceTriage';
import { useLeads } from '@/hooks/useLeads';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  PhoneOutgoing, Clock, User, Sparkles, Search, Loader2, Link2, UserPlus, Trash2, RefreshCw, Inbox,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

/** (86) 98181-2709 — o banco guarda só dígitos, com 55 na frente. */
function formatarTelefone(bruto: string | null): string {
  const d = String(bruto || '').replace(/\D/g, '');
  const nac = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
  if (nac.length === 11) return `(${nac.slice(0, 2)}) ${nac.slice(2, 7)}-${nac.slice(7)}`;
  if (nac.length === 10) return `(${nac.slice(0, 2)}) ${nac.slice(2, 6)}-${nac.slice(6)}`;
  return bruto || '—';
}

function formatarDuracao(s: number | null): string {
  if (!s) return '0s';
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}min ${s % 60}s` : `${s}s`;
}

/** Tira o cabeçalho fixo que a IA da Callface repete em todo resumo. */
function resumoLimpo(texto: string | null): string {
  if (!texto) return '';
  return texto
    .replace(/^Ligação por Callface:\s*/i, '')
    .replace(/##\s*RESUMO DA LIGAÇÃO\s*##/gi, '')
    .trim();
}

interface KanbanBoard {
  id: string;
  name: string;
  is_default: boolean | null;
}

/**
 * Vira lead a partir de uma ligação. É o único caminho: nada é criado
 * automaticamente pelo webhook — a atendente é quem classifica.
 */
function CriarLeadDaLigacao({
  call,
  open,
  onOpenChange,
  onCriado,
}: {
  call: TriageCall;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCriado: (leadId: string, leadName: string) => void;
}) {
  const { addLead } = useLeads(undefined, { mode: 'paged', pageSize: 1 });
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [boardId, setBoardId] = useState('');
  const [nome, setNome] = useState(call.contact_name || '');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(call.contact_name || '');
    (async () => {
      const { data } = await externalSupabase
        .from('kanban_boards')
        .select('id, name, is_default')
        .order('display_order');
      const lista = (data || []) as unknown as KanbanBoard[];
      setBoards(lista);
      const padrao = lista.find((b) => b.is_default) || lista[0];
      if (padrao) setBoardId(padrao.id);
    })();
  }, [open, call.contact_name]);

  const criar = async () => {
    if (!nome.trim()) {
      toast.error('Dê um nome ao lead');
      return;
    }
    if (!boardId) {
      toast.error('Escolha o quadro');
      return;
    }
    setSalvando(true);
    try {
      const novo = await addLead({
        lead_name: nome.trim(),
        lead_phone: call.contact_phone || null,
        board_id: boardId,
        source: 'callface',
        notes: [
          `Criado na triagem de ligação da Callface (${format(new Date(call.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}).`,
          resumoLimpo(call.ai_summary),
        ]
          .filter(Boolean)
          .join('\n\n'),
      } as any);

      const leadId = (novo as any)?.id;
      if (!leadId) throw new Error('lead sem id');
      onCriado(leadId, nome.trim());
      onOpenChange(false);
    } catch (e) {
      console.error('[triagem callface] falha ao criar lead:', e);
      toast.error('Não foi possível criar o lead');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Criar lead desta ligação
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <p className="font-medium">{formatarTelefone(call.contact_phone)}</p>
            <p className="text-muted-foreground">
              {format(new Date(call.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })} •{' '}
              {formatarDuracao(call.duration_seconds)}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="triagem-nome">Nome do lead</Label>
            <Input
              id="triagem-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome de quem atendeu a ligação"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Quadro</Label>
            <Select value={boardId} onValueChange={setBoardId}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha o quadro" />
              </SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            O resumo da ligação entra nas observações do lead. Os demais campos você preenche na ficha.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={criar} disabled={salvando}>
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Criar lead
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Detalhe da ligação + as três saídas da triagem. Sheet: não tira ninguém da tela. */
function TriagemSheet({
  call,
  onOpenChange,
  onVincular,
  onDescartar,
}: {
  call: TriageCall | null;
  onOpenChange: (v: boolean) => void;
  onVincular: (call: TriageCall, leadId: string, leadName: string | null) => Promise<boolean>;
  onDescartar: (call: TriageCall, motivo?: string) => Promise<boolean>;
}) {
  const [busca, setBusca] = useState('');
  const [buscaAtrasada, setBuscaAtrasada] = useState('');
  const [motivo, setMotivo] = useState('');
  const [criarAberto, setCriarAberto] = useState(false);
  const [agindo, setAgindo] = useState(false);

  // Busca no servidor a cada 400ms parado, não a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtrasada(busca.trim()), 400);
    return () => clearTimeout(t);
  }, [busca]);

  const { leads, loading: buscando } = useLeads(undefined, {
    mode: 'paged',
    pageSize: 8,
    search: buscaAtrasada,
    detailLevel: 'index',
  });

  useEffect(() => {
    setBusca('');
    setBuscaAtrasada('');
    setMotivo('');
  }, [call?.id]);

  if (!call) return null;

  const resumo = resumoLimpo(call.ai_summary);

  return (
    <>
      <Sheet open={!!call} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <PhoneOutgoing className="h-4 w-4 text-blue-500" />
              {formatarTelefone(call.contact_phone)}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {format(new Date(call.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </span>
              <span>•</span>
              <span>{formatarDuracao(call.duration_seconds)}</span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              {call.autor ? (
                <span>{call.autor}</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">{call.phone_used || 'não identificado'}</span>
                  <Badge variant="outline" className="text-[10px]">
                    sem atribuição
                  </Badge>
                </span>
              )}
            </div>

            {call.audio_url && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Gravação</Label>
                <audio controls src={call.audio_url} className="w-full" preload="metadata" />
              </div>
            )}

            {resumo && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  Resumo da IA
                </Label>
                <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">
                  {resumo}
                </div>
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Link2 className="h-4 w-4" />
                Vincular a um lead existente
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome, telefone ou e-mail"
                  className="pl-8"
                />
              </div>

              {buscaAtrasada.length > 0 && (
                <ScrollArea className="max-h-52">
                  <div className="space-y-1 pr-2">
                    {buscando && (
                      <p className="py-2 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />
                        buscando…
                      </p>
                    )}
                    {!buscando && leads.length === 0 && (
                      <p className="py-2 text-sm text-muted-foreground">Nenhum lead encontrado.</p>
                    )}
                    {!buscando &&
                      leads.map((l: any) => (
                        <button
                          key={l.id}
                          disabled={agindo}
                          onClick={async () => {
                            setAgindo(true);
                            const ok = await onVincular(call, l.id, l.lead_name || null);
                            setAgindo(false);
                            if (ok) onOpenChange(false);
                          }}
                          className="w-full rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-50"
                        >
                          <span className="block font-medium">{l.lead_name || 'Sem nome'}</span>
                          <span className="block text-xs text-muted-foreground">
                            {formatarTelefone(l.lead_phone)}
                          </span>
                        </button>
                      ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Button className="w-full" onClick={() => setCriarAberto(true)} disabled={agindo}>
                <UserPlus className="mr-2 h-4 w-4" />
                Criar lead desta ligação
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="triagem-motivo" className="text-sm font-medium">
                Descartar
              </Label>
              <Textarea
                id="triagem-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo (opcional): engano, caixa postal, número errado…"
                rows={2}
              />
              <Button
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                disabled={agindo}
                onClick={async () => {
                  setAgindo(true);
                  const ok = await onDescartar(call, motivo.trim() || undefined);
                  setAgindo(false);
                  if (ok) onOpenChange(false);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Descartar ligação
              </Button>
              <p className="text-xs text-muted-foreground">
                A ligação sai da fila mas continua guardada — descartar não apaga a gravação.
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <CriarLeadDaLigacao
        call={call}
        open={criarAberto}
        onOpenChange={setCriarAberto}
        onCriado={async (leadId, leadName) => {
          const ok = await onVincular(call, leadId, leadName);
          if (ok) onOpenChange(false);
        }}
      />
    </>
  );
}

export function CallfaceTriageTab() {
  const { calls, loading, refetch, vincularLead, descartar } = useCallfaceTriage();
  const [selecionada, setSelecionada] = useState<TriageCall | null>(null);

  const semAtribuicao = useMemo(() => calls.filter((c) => !c.autor).length, [calls]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {loading ? (
            'carregando…'
          ) : (
            <>
              <span className="font-medium text-foreground">{calls.length}</span> ligação
              {calls.length !== 1 ? 'ões' : ''} sem lead
              {semAtribuicao > 0 && <> • {semAtribuicao} sem atribuição de quem ligou</>}
            </>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {!loading && calls.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <Inbox className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nenhuma ligação esperando triagem.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {calls.map((call) => (
          <button
            key={call.id}
            onClick={() => setSelecionada(call)}
            className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start gap-3">
              <PhoneOutgoing className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatarTelefone(call.contact_phone)}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(call.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </span>
                  <span className="text-xs text-muted-foreground">• {formatarDuracao(call.duration_seconds)}</span>
                  {!call.autor && (
                    <Badge variant="outline" className="text-[10px]">
                      sem atribuição
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {call.autor || call.phone_used || 'não identificado'}
                </p>
                {call.ai_summary && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{resumoLimpo(call.ai_summary)}</p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <TriagemSheet
        call={selecionada}
        onOpenChange={(v) => !v && setSelecionada(null)}
        onVincular={vincularLead}
        onDescartar={descartar}
      />
    </div>
  );
}
