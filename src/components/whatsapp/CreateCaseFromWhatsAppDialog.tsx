import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { useLegalCases } from '@/hooks/useLegalCases';
import { Loader2, Scale, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface ExtractedProcess {
  title: string;
  process_number?: string;
  process_type?: 'judicial' | 'administrativo';
  description?: string;
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
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const [title, setTitle] = useState('');
  const [nucleusId, setNucleusId] = useState<string>('none');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [extractedProcesses, setExtractedProcesses] = useState<ExtractedProcess[]>([]);

  useEffect(() => {
    if (open) {
      setTitle(leadName || contactName || '');
      setNucleusId('none');
      setDescription('');
      setNotes('');
      setExtractedProcesses([]);
    }
  }, [open, leadName, contactName]);

  const handleExtractWithAI = async () => {
    if (!messages?.length) {
      toast.error('Sem mensagens para analisar');
      return;
    }
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke('extract-conversation-data', {
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

      // Extract processes
      if (extracted.processes && Array.isArray(extracted.processes) && extracted.processes.length > 0) {
        setExtractedProcesses(extracted.processes);
      }

      // Auto-select nucleus
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

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error('Informe o título do caso');
      return;
    }
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

      const result = await createCase({
        lead_id: leadId || '',
        nucleus_id: nucleusId === 'none' ? null : nucleusId,
        title: title.trim(),
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      // Create extracted processes
      if (extractedProcesses.length > 0 && result?.id) {
        for (const proc of extractedProcesses) {
          await supabase.from('lead_processes').insert({
            case_id: result.id,
            lead_id: leadId || null,
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

      // Link contact as party to processes if contact exists
      if (finalContactId && result?.id) {
        // Link contact to lead if lead exists
        if (leadId) {
          await supabase.from('contact_leads').insert({
            contact_id: finalContactId,
            lead_id: leadId,
            relationship_to_victim: 'Vítima',
          }).select().maybeSingle();
        }
      }

      onCaseCreated?.(result);
      onOpenChange(false);
    } catch {
      // error already toasted by hook
    } finally {
      setSaving(false);
    }
  };

  return (
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
            <p className="text-xs text-amber-600">
              Este caso será criado sem vínculo a um lead.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Criar Caso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
