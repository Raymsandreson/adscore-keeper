import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { useLegalCases } from '@/hooks/useLegalCases';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { Loader2, Scale, Sparkles, CalendarIcon, AlertTriangle, CheckSquare } from 'lucide-react';
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

type ConversationMessage = {
  created_at?: string;
  direction?: string | null;
  message_text?: string | null;
  content?: string | null;
  media_type?: string | null;
  contact_name?: string | null;
  metadata?: any;
};

// Predefined processes matching LegalCasesTab
const PREDEFINED_PROCESSES = [
  'Indenização',
  'Relatório de Acidente',
  'TRCT + Verbas',
  'Seguro de Vida',
  'Benefício INSS',
  'Inquérito Policial',
  'Organizar docs',
  'Onboarding',
];

const CASO_PROCESS_ASSIGNMENTS: Record<string, { userId: string; userName: string }> = {
  'Seguro de Vida': { userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
  'Benefício INSS': { userId: '4dba2de0-5357-49ab-8bf9-4c248a1440de', userName: 'Gisele' },
  'Inquérito Policial': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa' },
  'Organizar docs': { userId: '7f41a35e-7d98-4ade-8270-52d727433e6a', userName: 'Abderaman' },
  'Onboarding': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa' },
  'Indenização': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa' },
  'Relatório de Acidente': { userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
  'TRCT + Verbas': { userId: '44fd2301-47c6-4912-a583-0213b1c368eb', userName: 'João Vitor' },
};

/**
 * Parse process numbers from free text (notes, description, etc.)
 * Handles formats: nº 0802498-08.2022.8.18.0028, (n° 123...), processo 123..., plain CNJ numbers
 */
function parseProcessesFromText(text: string, caseType?: string): ExtractedProcess[] {
  const processes: ExtractedProcess[] = [];
  const seen = new Set<string>();

  // Pattern 1: Explicit prefixed — nº, n°, processo nº, processo
  const prefixedRegex = /(?:n[ºo°\.]\s*|processo\s+n?[ºo°]?\s*)([\d][\d.\-\/]+[\d])/gi;
  let match;
  while ((match = prefixedRegex.exec(text)) !== null) {
    const num = match[1].trim();
    if (num.length >= 5 && !seen.has(num)) {
      seen.add(num);
      const afterMatch = text.substring(match.index + match[0].length, match.index + match[0].length + 150);
      const typeMatch = afterMatch.match(/[,)\s]*(?:de\s+)?([A-ZÀ-Ú][A-ZÀ-Ú\s\-]{2,40})/);
      const typeName = typeMatch ? typeMatch[1].trim() : (caseType || 'Processo');
      processes.push({
        title: typeName,
        process_number: num,
        process_type: 'judicial',
        description: 'Processo extraído automaticamente da conversa',
      });
    }
  }

  // Pattern 2: CNJ format standalone — 0000319-90.2021.5.22.0002
  const cnjRegex = /\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/g;
  while ((match = cnjRegex.exec(text)) !== null) {
    const num = match[1].trim();
    if (!seen.has(num)) {
      seen.add(num);
      const afterMatch = text.substring(match.index + match[0].length, match.index + match[0].length + 150);
      const typeMatch = afterMatch.match(/[,)\s]*(?:de\s+)?([A-ZÀ-Ú][A-ZÀ-Ú\s\-]{2,40})/);
      const typeName = typeMatch ? typeMatch[1].trim() : (caseType || 'Processo');
      processes.push({
        title: typeName,
        process_number: num,
        process_type: 'judicial',
        description: 'Processo extraído automaticamente da conversa',
      });
    }
  }

  // Pattern 3: INSS/administrative numbers — pure digits 9-15 chars (e.g., 453639857, 1682674283)
  const adminRegex = /(?:benefício|protocolo|requerimento|NB|NIT|processo)\s*(?:n[ºo°]?\s*)?(\d{9,15})/gi;
  while ((match = adminRegex.exec(text)) !== null) {
    const num = match[1].trim();
    if (!seen.has(num)) {
      seen.add(num);
      processes.push({
        title: caseType || 'Benefício/Processo Administrativo',
        process_number: num,
        process_type: 'administrativo',
        description: 'Processo administrativo extraído automaticamente da conversa',
      });
    }
  }

  return processes;
}

function stringifyExtractionValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(stringifyExtractionValue).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(stringifyExtractionValue).filter(Boolean).join('\n');
  }
  return '';
}

function getMessageText(message: ConversationMessage): string {
  const directText = stringifyExtractionValue(
    message.message_text ||
    message.content ||
    message.metadata?.caption ||
    message.metadata?.text ||
    message.metadata?.conversation ||
    message.metadata?.extendedTextMessage?.text ||
    message.metadata?.imageMessage?.caption ||
    message.metadata?.videoMessage?.caption ||
    message.metadata?.documentMessage?.caption
  );

  if (directText) return directText;
  if (message.media_type?.startsWith('audio')) return '[Áudio enviado]';
  if (message.media_type?.startsWith('image')) return '[Imagem enviada]';
  if (message.media_type?.startsWith('video')) return '[Vídeo enviado]';
  if (message.media_type) return `[Arquivo ${message.media_type}]`;
  return '';
}

function buildConversationTranscript(messages: ConversationMessage[], fallbackContactName?: string | null) {
  return [...messages]
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
    .slice(-200)
    .map((message) => {
      const body = getMessageText(message);
      if (!body) return '';
      const sender = message.direction === 'outbound'
        ? 'Atendente'
        : message.contact_name || fallbackContactName || 'Cliente';
      return `${sender}: ${body}`;
    })
    .filter(Boolean)
    .join('\n');
}

function mergeProcesses(...groups: ExtractedProcess[][]): ExtractedProcess[] {
  const merged: ExtractedProcess[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const process of group) {
      const title = stringifyExtractionValue(process.title) || 'Processo';
      const processNumber = stringifyExtractionValue(process.process_number);
      const key = `${title.toLowerCase()}::${processNumber.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        title,
        process_number: processNumber || undefined,
        process_type: process.process_type || (processNumber.includes('-') ? 'judicial' : 'administrativo'),
        description: stringifyExtractionValue(process.description) || 'Processo extraído automaticamente da conversa',
      });
    }
  }

  return merged;
}

function parseProcessesFromExtractionPayload(extracted: Record<string, any>, transcript: string) {
  const structuredProcesses = Array.isArray(extracted.processes)
    ? extracted.processes.map((process: any) => ({
        title: stringifyExtractionValue(process.title || process.type || process.nome || extracted.case_type || 'Processo'),
        process_number: stringifyExtractionValue(process.process_number || process.number || process.numero),
        process_type: process.process_type || (stringifyExtractionValue(process.process_number || process.number || process.numero).includes('-') ? 'judicial' : 'administrativo'),
        description: stringifyExtractionValue(process.description) || 'Processo extraído pela IA',
      }))
    : [];

  const notesProcesses = parseProcessesFromText(stringifyExtractionValue(extracted.notes), extracted.case_type);
  const descriptionProcesses = parseProcessesFromText(stringifyExtractionValue(extracted.description), extracted.case_type);
  const detailProcesses = parseProcessesFromText(
    [
      stringifyExtractionValue(extracted.case_number),
      stringifyExtractionValue(extracted.damage_description),
      stringifyExtractionValue(extracted.observations),
      stringifyExtractionValue(extracted.summary),
      stringifyExtractionValue(extracted.raw_text),
      stringifyExtractionValue(extracted),
      transcript,
    ].filter(Boolean).join('\n'),
    extracted.case_type,
  );

  return mergeProcesses(structuredProcesses, notesProcesses, descriptionProcesses, detailProcesses);
}

function hasMeaningfulExtraction(extracted: Record<string, any>, descriptionParts: string[], processes: ExtractedProcess[]) {
  return Boolean(
    stringifyExtractionValue(extracted.title) ||
    stringifyExtractionValue(extracted.lead_name) ||
    stringifyExtractionValue(extracted.notes) ||
    stringifyExtractionValue(extracted.description) ||
    descriptionParts.length > 0 ||
    processes.length > 0
  );
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
  instanceName?: string | null;
  messages?: any[];
  onCaseCreated?: (caseData: any) => void;
}

export function CreateCaseFromWhatsAppDialog({ open, onOpenChange, leadId, leadName, contactName, contactPhone, contactId, instanceName, messages, onCaseCreated }: Props) {
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
  const [selectedPredefinedProcesses, setSelectedPredefinedProcesses] = useState<Set<string>>(new Set());

  // Auto-extract on open when messages are available
  const hasAutoExtracted = useRef(false);
  const previousOpenRef = useRef(false);

  const resolveConversationMessages = async () => {
    if (messages && messages.length > 1) return messages as ConversationMessage[];

    const isGroup = contactPhone?.includes('@g.us');
    const normalizedPhone = isGroup ? contactPhone : contactPhone?.replace(/\D/g, '');
    if (!normalizedPhone || !instanceName) return (messages || []) as ConversationMessage[];

    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('created_at, direction, message_text, media_type, contact_name, metadata, instance_name')
      .eq('phone', normalizedPhone)
      .eq('instance_name', instanceName)
      .order('created_at', { ascending: false })
      .range(0, 199);

    if (error) {
      console.warn('Error loading conversation messages for extraction:', error);
      return (messages || []) as ConversationMessage[];
    }

    return ((data && data.length > 0 ? data : messages) || []) as ConversationMessage[];
  };

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      setTitle(leadName || contactName || '');
      setCaseNumber('');
      setNucleusId('none');
      setDescription('');
      setNotes('');
      setExtractedProcesses([]);
      setClosingDate(new Date());
      setDuplicates([]);
      setShowDuplicateWarning(false);
      setSelectedPredefinedProcesses(new Set());
      const defaultBoard = boards.find(b => b.is_default) || boards[0];
      setSelectedBoardId(defaultBoard?.id || '');
      hasAutoExtracted.current = false;

      // Auto-fetch group creation date if lead has a group
      if (leadId) {
        supabase.functions.invoke('fetch-group-creation-date', {
          body: { lead_id: leadId },
        }).then(({ data }) => {
          if (data?.success && data?.creation_date) {
            setClosingDate(new Date(data.creation_date + 'T12:00:00'));
            toast.info(`Data de criação do grupo preenchida: ${data.creation_date}`);
          }
        }).catch(() => {});
      }
    }
    previousOpenRef.current = open;
  }, [open, leadId, leadName, contactName, boards]);

  useEffect(() => {
    if (!open || selectedBoardId || boards.length === 0) return;
    const defaultBoard = boards.find(b => b.is_default) || boards[0];
    if (defaultBoard) setSelectedBoardId(defaultBoard.id);
  }, [open, boards, selectedBoardId]);

  // Auto-trigger AI extraction when dialog opens with phone+instance or messages
  const canExtract = !!(contactPhone && instanceName) || !!(messages?.length);
  useEffect(() => {
    if (open && canExtract && !hasAutoExtracted.current && !extracting) {
      hasAutoExtracted.current = true;
      handleExtractWithAI();
    }
  }, [open, canExtract]);

  const handleExtractWithAI = async () => {
    // Don't strip non-digits for group identifiers (contain @g.us)
    const isGroup = contactPhone?.includes('@g.us');
    const phone = isGroup ? contactPhone : contactPhone?.replace(/\D/g, '');
    if (!phone || !instanceName) {
      if (!messages?.length) {
        toast.error('Sem mensagens para analisar');
        return;
      }
    }
    setExtracting(true);
    try {
      const conversationMessages = await resolveConversationMessages();
      const transcript = buildConversationTranscript(conversationMessages, contactName);

      let data: any = null;
      if (phone && instanceName) {
        const response = await cloudFunctions.invoke('extract-conversation-data', {
          body: {
            phone,
            instance_name: instanceName,
            targetType: 'case',
          },
        });

        if (response.error) throw response.error;
        data = response.data;
      }

      if (data?.success === false && !data?.data && !data?.result) {
        console.warn('[CreateCase] extract-conversation-data returned success=false:', data);
      }

      const extracted = data?.data || data?.result || {};

      // Log for debugging
      console.log('[CreateCase] AI extraction response:', JSON.stringify(data).substring(0, 500));

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
      const extractedNotes = stringifyExtractionValue(extracted.notes);
      if (extractedNotes) setNotes(extractedNotes);

      const detectedProcesses = parseProcessesFromExtractionPayload(extracted, transcript);

      if (detectedProcesses.length > 0) {
        setExtractedProcesses(detectedProcesses);
        console.log('[CreateCase] Detected processes:', detectedProcesses);
      } else {
        setExtractedProcesses([]);
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

      // Only show success if we actually extracted meaningful data
      const hasData = hasMeaningfulExtraction(extracted, descParts, detectedProcesses);
      if (hasData) {
        const parts: string[] = [];
        if (descParts.length > 0) parts.push('dados do caso');
        if (detectedProcesses.length > 0) parts.push(`${detectedProcesses.length} processo(s)`);
        if (extractedNotes) parts.push('observações');
        toast.success(`Dados extraídos: ${parts.join(', ') || 'título'}`);
      } else if (!conversationMessages.length || data?.reason === 'no_messages' || data?.status === 'no_messages') {
        toast.warning('Nenhuma mensagem encontrada para análise. Preencha manualmente.');
      } else {
        toast.warning('IA não conseguiu extrair dados relevantes. Preencha manualmente.');
      }
    } catch (err) {
      console.error('Extract error:', err);
      toast.error('Erro ao extrair dados da conversa. Preencha manualmente.');
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
      const conversationMessages = await resolveConversationMessages();
      const transcript = buildConversationTranscript(conversationMessages, contactName);

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
        closed_at: closingDate ? closingDate.toISOString().split('T')[0] : undefined,
      });

      // Create extracted processes
      const allProcessesToCreate: { title: string; process_number?: string | null; process_type: string; description?: string | null; assignedTo?: string; assignedToName?: string }[] = [];
      const detectedAtSave = mergeProcesses(
        extractedProcesses,
        parseProcessesFromText(notes, undefined),
        parseProcessesFromText(description, undefined),
        parseProcessesFromText(caseNumber ? `processo nº ${caseNumber}` : '', undefined),
        parseProcessesFromText(transcript, undefined),
      );

      // Add AI-extracted processes
      if (detectedAtSave.length > 0) {
        for (const proc of detectedAtSave) {
          allProcessesToCreate.push({
            title: proc.title,
            process_number: proc.process_number,
            process_type: proc.process_type || 'judicial',
            description: proc.description,
          });
        }
      }

      // Add predefined processes (like LegalCasesTab)
      for (const procName of selectedPredefinedProcesses) {
        const assignment = CASO_PROCESS_ASSIGNMENTS[procName];
        allProcessesToCreate.push({
          title: procName,
          process_type: 'administrativo',
          assignedTo: assignment?.userId,
          assignedToName: assignment?.userName,
        });
      }

      // Insert all processes
      if (allProcessesToCreate.length > 0 && result?.id) {
        // Create activities for all case types, not just CASO-prefixed
        let createdProcesses = 0;
        let failedProcesses = 0;
        for (const proc of allProcessesToCreate) {
          try {
            const { data: savedProcess, error: processError } = await supabase.from('lead_processes').insert({
              case_id: result.id,
              lead_id: finalLeadId || null,
              title: proc.title,
              process_number: proc.process_number || null,
              process_type: proc.process_type || 'judicial',
              description: proc.description || null,
              status: 'em_andamento',
              started_at: new Date().toISOString().slice(0, 10),
              created_by: user?.id || null,
            } as any).select('id').single();

            if (processError) throw processError;
            createdProcesses += 1;

            // Auto-create activity for all cases with predefined process assignments
            if (proc.assignedTo && savedProcess?.id) {
              try {
                await supabase.from('lead_activities').insert({
                  lead_id: finalLeadId || null,
                  lead_name: title.trim(),
                  title: `Dar andamento - ${proc.title}`,
                  description: `Atividade criada automaticamente para o processo: ${proc.title}`,
                  activity_type: 'tarefa',
                  status: 'pendente',
                  priority: 'normal',
                  assigned_to: proc.assignedTo,
                  assigned_to_name: proc.assignedToName,
                  created_by: user?.id,
                  deadline: new Date().toISOString().slice(0, 10),
                  process_id: savedProcess.id,
                } as any);
              } catch (actErr) {
                console.warn(`Error creating activity for process "${proc.title}":`, actErr);
              }
            }
          } catch (procErr) {
            failedProcesses += 1;
            console.warn(`Error creating process "${proc.title}":`, procErr);
          }
        }
        if (createdProcesses > 0) {
          toast.success(`${createdProcesses} processo(s) criado(s) automaticamente`);
        }
        if (failedProcesses > 0) {
          toast.warning(`${failedProcesses} processo(s) não puderam ser criados automaticamente`);
        }
        if (createdProcesses > 0 && selectedPredefinedProcesses.size > 0) {
          toast.success('Atividades atribuídas automaticamente');
        }
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

        {(contactPhone && instanceName) || messages?.length ? (
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
              <Label className="text-xs font-semibold flex items-center gap-1">
                <Scale className="h-3 w-3" />
                Processos detectados pela IA ({extractedProcesses.length})
              </Label>
              {extractedProcesses.map((proc, i) => (
                <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                  <CheckSquare className="h-3 w-3 shrink-0 text-green-600" />
                  <span className="font-medium">{proc.title}</span>
                  {proc.process_number && <span className="text-muted-foreground">nº {proc.process_number}</span>}
                  {proc.process_type && <span className="text-[10px] px-1 rounded bg-muted">{proc.process_type}</span>}
                </div>
              ))}
              <p className="text-xs text-muted-foreground italic">Serão criados automaticamente ao salvar</p>
            </div>
          )}

          {/* Predefined processes (like LegalCasesTab) */}
          <div className="rounded-lg border p-3 space-y-2">
            <Label className="text-xs font-semibold">Processos padrão (opcional)</Label>
            <div className="grid grid-cols-2 gap-1">
              {PREDEFINED_PROCESSES.map(name => (
                <label key={name} className="flex items-center gap-2 cursor-pointer hover:bg-accent/50 rounded px-2 py-1.5">
                  <Checkbox
                    checked={selectedPredefinedProcesses.has(name)}
                    onCheckedChange={() => {
                      setSelectedPredefinedProcesses(prev => {
                        const next = new Set(prev);
                        if (next.has(name)) next.delete(name);
                        else next.add(name);
                        return next;
                      });
                    }}
                  />
                  <span className="text-xs">{name}</span>
                </label>
              ))}
            </div>
            {selectedPredefinedProcesses.size > 0 && (
              <p className="text-xs text-muted-foreground mt-1">{selectedPredefinedProcesses.size} processo(s) padrão será(ão) criado(s)</p>
            )}
          </div>

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
