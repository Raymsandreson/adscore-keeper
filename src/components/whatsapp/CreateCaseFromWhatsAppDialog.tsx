import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { useLegalCases } from '@/hooks/useLegalCases';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { Loader2, Scale, Sparkles, CalendarIcon, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { findClosedStageId } from '@/utils/kanbanStageTypes';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface ExtractedProcess {
  title: string;
  process_number?: string;
  process_type?: 'judicial' | 'administrativo';
  description?: string;
}

interface DuplicateCase {
  id: string;
  case_number: string;
  title: string;
  status: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string | null;
  leadName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactId?: string | null;
  messages?: any[];
  onCaseCreated?: (caseData: any) => void;
}

export function CreateCaseFromWhatsAppDialog({ open, onOpenChange, leadId, leadName, contactName, contactPhone, contactId, messages, onCaseCreated }: Props) {
  const { nuclei, loading: nucleiLoading } = useSpecializedNuclei();
  const { createCase } = useLegalCases();
  const { boards } = useKanbanBoards();
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCase[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);

  const [title, setTitle] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [nucleusId, setNucleusId] = useState<string>('none');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [extractedProcesses, setExtractedProcesses] = useState<ExtractedProcess[]>([]);
  const [closingDate, setClosingDate] = useState<Date>(new Date());
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');

  // Auto-extract on open when messages are available
  const hasAutoExtracted = useRef(false);

  useEffect(() => {
    if (open) {
      setTitle(leadName || contactName || '');
      setCaseNumber('');
      setNucleusId('none');
      setDescription('');
      setNotes('');
      setExtractedProcesses([]);
      setClosingDate(new Date());
      setDuplicates([]);
      setShowDuplicateWarning(false);
      const defaultBoard = boards.find(b => b.is_default) || boards[0];
      setSelectedBoardId(defaultBoard?.id || '');
      hasAutoExtracted.current = false;
    }
  }, [open, leadName, contactName, boards]);

  // Auto-trigger AI extraction when dialog opens with messages
  useEffect(() => {
    if (open && messages?.length && !hasAutoExtracted.current && !extracting) {
      hasAutoExtracted.current = true;
      handleExtractWithAI();
    }
  }, [open, messages]);

  const handleExtractWithAI = async () => {
    if (!messages?.length) {
      toast.error('Sem mensagens para analisar');
      return;
    }
    setExtracting(true);
    try {
      const { data, error } = await cloudFunctions.invoke('extract-conversation-data', {
        body: {
          messages: messages.map(m => ({
            direction: m.direction,
            message_text: m.message_text,
          })),
          targetType: 'case',
        },
      });
      if (error) throw error;

      const extracted = data?.data || {};

      if (extracted.title) setTitle(extracted.title);
      else if (extracted.lead_name && title === (leadName || contactName || '')) setTitle(extracted.lead_name);

      const descParts: string[] = [];
      if (extracted.victim_name) descParts.push(`Vítima: ${extracted.victim_name}`);
      if (extracted.main_company) descParts.push(`Empresa: ${extracted.main_company}`);
      if (extracted.contractor_company) descParts.push(`Contratante: ${extracted.contractor_company}`);
      if (extracted.damage_description) descParts.push(`Dano: ${extracted.damage_description}`);
      if (extracted.accident_date) descParts.push(`Data do acidente: ${extracted.accident_date}`);
      if (extracted.accident_address) descParts.push(`Local: ${extracted.accident_address}`);
      if (extracted.city) descParts.push(`Cidade: ${extracted.city}${extracted.state ? `/${extracted.state}` : ''}`);
      if (extracted.sector) descParts.push(`Setor: ${extracted.sector}`);
      if (extracted.case_number) descParts.push(`Processo: ${extracted.case_number}`);
      if (extracted.liability_type) descParts.push(`Responsabilidade: ${extracted.liability_type}`);
      if (extracted.news_link) descParts.push(`Notícia: ${extracted.news_link}`);

      if (descParts.length > 0) setDescription(descParts.join('\n'));
      if (extracted.notes) setNotes(extracted.notes);

      if (extracted.processes && Array.isArray(extracted.processes) && extracted.processes.length > 0) {
        setExtractedProcesses(extracted.processes);
      }

      if (extracted.case_type) {
        const typeMap: Record<string, string[]> = {
          'acidente_trabalho': ['AT', 'TRAB', 'ACIDENTE'],
          'acidente_transito': ['TRANS', 'TRANSITO'],
          'previdenciario': ['PREV'],
          'consumidor': ['CONS'],
        };
        const keywords = typeMap[extracted.case_type] || [];
        if (keywords.length > 0) {
          const match = nuclei.find(n => n.is_active && keywords.some(k => n.prefix.toUpperCase().includes(k)));
          if (match) setNucleusId(match.id);
        }
      }

      toast.success('Dados extraídos da conversa!');
    } catch (err) {
      console.error('Extract error:', err);
      toast.error('Erro ao extrair dados da conversa');
    } finally {
      setExtracting(false);
    }
  };

  const checkDuplicates = async (): Promise<DuplicateCase[]> => {
    const searchTitle = title.trim();
    if (!searchTitle) return [];

    try {
      // Search by similar title or same lead
      let query = supabase
        .from('legal_cases')
        .select('id, case_number, title, status, created_at')
        .ilike('title', `%${searchTitle}%`)
        .limit(10);

      const { data: byTitle } = await query;

      // Also search by lead_id if available
      let byLead: any[] = [];
      if (leadId) {
        const { data } = await supabase
          .from('legal_cases')
          .select('id, case_number, title, status, created_at')
          .eq('lead_id', leadId);
        byLead = data || [];
      }

      // Merge and deduplicate
      const allResults = [...(byTitle || []), ...byLead];
      const unique = allResults.filter((item, index, self) =>
        index === self.findIndex(t => t.id === item.id)
      );

      return unique;
    } catch (err) {
      console.error('Error checking duplicates:', err);
      return [];
    }
  };

  const handleCreateClick = async () => {
    if (!title.trim()) {
      toast.error('Informe o título do caso');
      return;
    }

    const found = await checkDuplicates();
    if (found.length > 0) {
      setDuplicates(found);
      setShowDuplicateWarning(true);
      return;
    }

    await executeCreate();
  };

  const executeCreate = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Auto-create contact if none exists
      let finalContactId = contactId;
      if (!finalContactId && contactPhone) {
        const normalizedPhone = contactPhone.replace(/\D/g, '');
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('id, full_name')
          .or(`phone.eq.${contactPhone},phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`)
          .limit(1)
          .maybeSingle();

        if (existingContact) {
          finalContactId = existingContact.id;
        } else {
          const { data: newContact, error: cErr } = await supabase
            .from('contacts')
            .insert([{
              full_name: contactName || 'Contato WhatsApp',
              phone: contactPhone,
              source: 'whatsapp',
              created_by: user?.id || null,
            }] as any)
            .select('id')
            .single();
          if (!cErr && newContact) {
            finalContactId = newContact.id;
            toast.success('Contato criado automaticamente');
          }
        }
      }

      // Auto-create Lead as "fechado" if no lead exists
      let finalLeadId = leadId;
      if (!finalLeadId) {
        if (!selectedBoardId) {
          toast.error('Selecione um funil para o lead');
          setSaving(false);
          return;
        }

        const board = boards.find(b => b.id === selectedBoardId);
        const closedStageId = board ? findClosedStageId(board.stages) : null;

        const closingDateStr = format(closingDate, 'yyyy-MM-dd');
        const leadInsert: Record<string, any> = {
          lead_name: title.trim(),
          lead_phone: contactPhone || null,
          source: 'whatsapp',
          created_by: user?.id || null,
          became_client_date: closingDateStr,
          board_id: selectedBoardId,
          status: closedStageId || 'closed',
        };
        const { data: newLead, error: leadErr } = await supabase
          .from('leads')
          .insert(leadInsert)
          .select('id')
          .single();
        if (leadErr) throw leadErr;
        finalLeadId = newLead.id;
        toast.success('Lead criado como fechado');

        // Link contact to lead
        if (finalContactId) {
          await supabase.from('contact_leads').insert({
            contact_id: finalContactId,
            lead_id: finalLeadId,
            relationship_to_victim: 'Vítima',
          }).select().maybeSingle();
        }
      }

      const result = await createCase({
        lead_id: finalLeadId || '',
        nucleus_id: nucleusId === 'none' ? null : nucleusId,
        title: title.trim(),
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
        case_number: caseNumber.trim() || undefined,
      });

      // Create extracted processes
      if (extractedProcesses.length > 0 && result?.id) {
        for (const proc of extractedProcesses) {
          await supabase.from('lead_processes').insert({
            case_id: result.id,
            lead_id: finalLeadId || null,
            title: proc.title,
            process_number: proc.process_number || null,
            process_type: proc.process_type || 'judicial',
            description: proc.description || null,
            status: 'em_andamento',
            created_by: user?.id || null,
          } as any);
        }
        toast.success(`${extractedProcesses.length} processo(s) criado(s) automaticamente`);
      }

      // Link contact as party if not already linked
      if (finalContactId && finalLeadId && leadId) {
        await supabase.from('contact_leads').insert({
          contact_id: finalContactId,
          lead_id: finalLeadId,
          relationship_to_victim: 'Vítima',
        }).select().maybeSingle();
      }

      onCaseCreated?.(result);
      onOpenChange(false);
    } catch {
      // error already toasted by hook
    } finally {
      setSaving(false);
    }
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { aberto: 'Aberto', em_andamento: 'Em Andamento', encerrado: 'Encerrado', arquivado: 'Arquivado' };
    return map[s] || s;
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Criar Caso Jurídico
          </DialogTitle>
        </DialogHeader>

        {messages?.length ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExtractWithAI}
            disabled={extracting}
            className="w-full gap-2"
          >
            {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-amber-500" />}
            {extracting ? 'Analisando conversa...' : 'Preencher com IA a partir da conversa'}
          </Button>
        ) : null}

        <div className="space-y-4 py-2">
          <div>
            <Label>Número do Caso</Label>
            <Input value={caseNumber} onChange={e => setCaseNumber(e.target.value)} placeholder="Ex: CASO-0001 (vazio = automático)" className="mt-1" />
          </div>
          <div>
            <Label>Título *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Acidente de trabalho - João" className="mt-1" />
          </div>

          <div>
            <Label>Núcleo Especializado</Label>
            <Select value={nucleusId} onValueChange={setNucleusId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Nenhum (sequência geral)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum (sequência geral)</SelectItem>
                {nuclei.filter(n => n.is_active).map(n => (
                  <SelectItem key={n.id} value={n.id}>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: n.color }} />
                      {n.name} ({n.prefix})
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Descrição</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição do problema jurídico..." className="mt-1" rows={3} />
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anotações internas..." className="mt-1" rows={2} />
          </div>

          {extractedProcesses.length > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <Label className="text-xs font-semibold">Processos detectados ({extractedProcesses.length})</Label>
              {extractedProcesses.map((proc, i) => (
                <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                  <Scale className="h-3 w-3 shrink-0" />
                  <span>{proc.title}{proc.process_number ? ` - ${proc.process_number}` : ''}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground italic">Serão criados automaticamente ao salvar</p>
            </div>
          )}

          {leadId && (
            <p className="text-xs text-muted-foreground">
              Vinculado ao lead: <strong>{leadName || leadId}</strong>
            </p>
          )}
          {!leadId && (
            <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground">
                Um <strong>Lead</strong> será criado automaticamente como <strong className="text-green-600">Fechado</strong>.
              </p>
              
              <div>
                <Label className="text-xs">Funil *</Label>
                <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Selecione o funil" />
                  </SelectTrigger>
                  <SelectContent>
                    {boards.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                          {b.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Data de Fechamento</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn("w-full mt-1 justify-start text-left font-normal", !closingDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {closingDate ? format(closingDate, "dd/MM/yyyy") : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={closingDate}
                      onSelect={(d) => d && setClosingDate(d)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCreateClick} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Criar Caso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showDuplicateWarning} onOpenChange={setShowDuplicateWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            Caso possivelmente duplicado
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>Foram encontrados casos semelhantes já cadastrados:</p>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {duplicates.map(d => (
                  <div key={d.id} className="flex items-center gap-3 p-2 rounded-lg border bg-muted/50">
                    <Scale className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{d.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.case_number} · {statusLabel(d.status)} · {format(new Date(d.created_at), 'dd/MM/yyyy')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm font-medium">Deseja criar um novo caso mesmo assim?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setShowDuplicateWarning(false);
              executeCreate();
            }}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Criar mesmo assim
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
