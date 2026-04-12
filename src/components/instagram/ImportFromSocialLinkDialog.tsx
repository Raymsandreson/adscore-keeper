import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Link2, Loader2, Sparkles, UserPlus, FileText, ClipboardList, CheckCircle2, MessageSquare, Users, AlertTriangle } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { usePostMetadata } from '@/hooks/usePostMetadata';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AccidentLeadForm, AccidentLeadFormData } from '@/components/leads/AccidentLeadForm';
import { useAuthContext } from '@/contexts/AuthContext';
import { generateLeadName } from '@/utils/generateLeadName';

interface ImportFromSocialLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialUrl?: string;
}

type TargetType = 'lead' | 'contact' | 'activity';

interface ExtractedData {
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  cpf?: string | null;
  cidade?: string | null;
  estado?: string | null;
  regiao?: string | null;
  profissao?: string | null;
  interesse?: string | null;
  contexto?: string | null;
  tags?: string[] | null;
  urgencia?: string | null;
  tipo_caso?: string | null;
  observacoes?: string | null;
  victim_name?: string | null;
  victim_age?: string | null;
  accident_date?: string | null;
  accident_address?: string | null;
  damage_description?: string | null;
  contractor_company?: string | null;
  main_company?: string | null;
  sector?: string | null;
  additional_victims?: Array<{
    victim_name?: string;
    victim_age?: string;
    damage_description?: string;
  }> | null;
}

// Convert date from DD/MM/YYYY to YYYY-MM-DD (ISO)
const convertDateToISO = (dateStr: string): string => {
  if (!dateStr) return '';
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // DD/MM/YYYY format
  const match = dateStr.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return '';
};

const stateToRegionMap: Record<string, string> = {
  'AC': 'Norte', 'AP': 'Norte', 'AM': 'Norte', 'PA': 'Norte', 'RO': 'Norte', 'RR': 'Norte', 'TO': 'Norte',
  'AL': 'Nordeste', 'BA': 'Nordeste', 'CE': 'Nordeste', 'MA': 'Nordeste', 'PB': 'Nordeste', 'PE': 'Nordeste', 'PI': 'Nordeste', 'RN': 'Nordeste', 'SE': 'Nordeste',
  'DF': 'Centro-Oeste', 'GO': 'Centro-Oeste', 'MT': 'Centro-Oeste', 'MS': 'Centro-Oeste',
  'ES': 'Sudeste', 'MG': 'Sudeste', 'RJ': 'Sudeste', 'SP': 'Sudeste',
  'PR': 'Sul', 'RS': 'Sul', 'SC': 'Sul',
};

// Map AI tipo_caso to exact caseType values
const caseTypeMap: Record<string, string> = {
  'acidente_trabalho': 'Outro',
  'trabalhista': 'Outro',
  'previdenciário': 'Outro',
  'queda': 'Queda de Altura',
  'queda_altura': 'Queda de Altura',
  'soterramento': 'Soterramento',
  'choque_eletrico': 'Choque Elétrico',
  'choque elétrico': 'Choque Elétrico',
  'eletrico': 'Choque Elétrico',
  'maquinas': 'Acidente com Máquinas',
  'acidente_maquinas': 'Acidente com Máquinas',
  'intoxicacao': 'Intoxicação',
  'explosao': 'Explosão',
  'incendio': 'Incêndio',
  'acidente_transito': 'Acidente de Trânsito',
  'transito': 'Acidente de Trânsito',
  'esmagamento': 'Esmagamento',
  'corte': 'Corte/Amputação',
  'amputacao': 'Corte/Amputação',
  'afogamento': 'Afogamento',
};

const mapCaseType = (aiValue: string): string => {
  if (!aiValue) return '';
  // Direct match with existing values
  const validTypes = ['Queda de Altura', 'Soterramento', 'Choque Elétrico', 'Acidente com Máquinas', 'Intoxicação', 'Explosão', 'Incêndio', 'Acidente de Trânsito', 'Esmagamento', 'Corte/Amputação', 'Afogamento', 'Outro'];
  if (validTypes.includes(aiValue)) return aiValue;
  // Normalize and map
  const normalized = aiValue.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
  if (caseTypeMap[normalized]) return caseTypeMap[normalized];
  // Partial match
  for (const [key, value] of Object.entries(caseTypeMap)) {
    if (normalized.includes(key) || key.includes(normalized)) return value;
  }
  return 'Outro';
};

const initialFormData: AccidentLeadFormData = {
  lead_name: '',
  lead_phone: '',
  lead_email: '',
  source: 'instagram',
  notes: '',
  acolhedor: '',
  case_type: '',
  group_link: '',
  client_classification: '',
  expected_birth_date: '',
  visit_city: '',
  visit_state: '',
  visit_region: '',
  visit_address: '',
  accident_date: '',
  damage_description: '',
  victim_name: '',
  victim_age: '',
  accident_address: '',
  contractor_company: '',
  main_company: '',
  sector: '',
  news_link: '',
  company_size_justification: '',
  liability_type: '',
  legal_viability: '',
};

export function ImportFromSocialLinkDialog({ open, onOpenChange, onSuccess, initialUrl }: ImportFromSocialLinkDialogProps) {
  const { user } = useAuthContext();
  const [url, setUrl] = useState(initialUrl || '');
  const [caption, setCaption] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('lead');
  const [step, setStep] = useState<'input' | 'review' | 'saving'>('input');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingComments, setIsFetchingComments] = useState(false);
  const [commentsAnalysis, setCommentsAnalysis] = useState<any>(null);
  const [commentsCount, setCommentsCount] = useState<number>(0);
  const [savedContacts, setSavedContacts] = useState<Set<string>>(new Set());
  const [savingContact, setSavingContact] = useState<string | null>(null);
  const { fetchMetadata } = usePostMetadata();
  const [additionalVictims, setAdditionalVictims] = useState<Array<{ victim_name: string; victim_age?: string; damage_description?: string }>>([]);

  // Lead form data (used in review step)
  const [formData, setFormData] = useState<AccidentLeadFormData>({ ...initialFormData });
  // Board selection
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  // Team profiles for acolhedor selector
  const [teamMembers, setTeamMembers] = useState<{ id: string; full_name: string | null; email: string | null }[]>([]);

  // When board is selected, fetch group settings and auto-set lead_name
  const handleBoardChange = async (boardId: string) => {
    setSelectedBoardId(boardId);
    if (!boardId) return;
    
    try {
      const { data: groupSettings } = await supabase
        .from('board_group_settings')
        .select('group_name_prefix, current_sequence, sequence_start')
        .eq('board_id', boardId)
        .maybeSingle();
      
      if (groupSettings?.group_name_prefix) {
        const nextSeq = (groupSettings.current_sequence || 0) > 0 
          ? groupSettings.current_sequence + 1 
          : (groupSettings.sequence_start || 1);
        
        // Generate name using the standard pattern: Prefix SEQ | Cidade/Estado | Vítima x Empresa | (Data) - Lesão
        const nameSuffix = generateLeadName({
          city: formData.visit_city,
          state: formData.visit_state,
          victim_name: formData.victim_name,
          main_company: formData.main_company,
          contractor_company: formData.contractor_company,
          accident_date: formData.accident_date,
          damage_description: formData.damage_description,
          case_type: formData.case_type,
        });
        const generatedName = `${groupSettings.group_name_prefix} ${nextSeq}${nameSuffix ? ` ${nameSuffix}` : ''}`.trim();
        setFormData(prev => ({ ...prev, lead_name: generatedName }));
      }
    } catch (err) {
      console.error('Error fetching board group settings:', err);
    }
  };

  // Update URL when initialUrl changes
  useEffect(() => {
    if (initialUrl && initialUrl !== url) {
      setUrl(initialUrl);
    }
  }, [initialUrl]);

  // Load boards and team members when entering review step
  useEffect(() => {
    if (step === 'review') {
      if (boards.length === 0) {
        supabase.from('kanban_boards').select('id, name, board_type').order('display_order').then(({ data }) => {
          if (data) {
            setBoards(data.filter(b => b.board_type === 'funnel' || !b.board_type).map(b => ({ id: b.id, name: b.name })));
          }
        });
      }
      // Always reload team members to ensure fresh data
      supabase.from('profiles').select('id, user_id, full_name, email').order('full_name').then(({ data }) => {
        if (data) {
          setTeamMembers(data.map(p => ({ id: p.id, full_name: p.full_name, email: p.email })));
        }
      });
    }
  }, [step]);

  const detectPlatform = (u: string) => {
    if (u.includes('instagram.com')) return 'Instagram';
    if (u.includes('facebook.com') || u.includes('fb.com')) return 'Facebook';
    if (u.includes('tiktok.com')) return 'TikTok';
    return 'Link';
  };

  const handleFetchCaption = async () => {
    if (!url.trim()) return;
    setIsFetchingMeta(true);
    try {
      const meta = await fetchMetadata(url.trim());
      if (meta?.caption) {
        setCaption(meta.caption);
        toast.success('Legenda extraída com sucesso!');
      } else {
        toast.info('Não foi possível extrair a legenda automaticamente. Cole manualmente.');
      }
    } catch {
      toast.error('Erro ao buscar legenda');
    } finally {
      setIsFetchingMeta(false);
    }
  };

  const handleExtract = async () => {
    if (!caption.trim()) {
      toast.error('Cole ou extraia a legenda primeiro');
      return;
    }
    setIsExtracting(true);
    try {
      const { data, error } = await cloudFunctions.invoke('extract-social-post-data', {
        body: { postUrl: url.trim(), caption: caption.trim(), targetType },
      });
      if (error) throw error;
      if (data?.success && data?.extracted) {
        const extracted: ExtractedData = data.extracted;
        // Map extracted data to AccidentLeadFormData
        const noteParts = [
          extracted.profissao ? `Profissão: ${extracted.profissao}` : null,
          extracted.interesse ? `Interesse: ${extracted.interesse}` : null,
          extracted.contexto,
          extracted.observacoes,
          url ? `Fonte: ${url}` : null,
          extracted.tags?.length ? `Tags: ${extracted.tags.join(', ')}` : null,
        ].filter(Boolean).join('\n');

        setFormData({
          ...initialFormData,
          lead_name: extracted.nome || `Lead ${detectPlatform(url)}`,
          lead_phone: extracted.telefone || '',
          lead_email: extracted.email || '',
          source: detectPlatform(url).toLowerCase(),
          visit_city: extracted.cidade || '',
          visit_state: extracted.estado?.toUpperCase() || '',
          visit_region: stateToRegionMap[extracted.estado?.toUpperCase() || ''] || '',
          case_type: mapCaseType(extracted.tipo_caso || ''),
          notes: noteParts,
          news_link: url.trim() || '',
          victim_name: extracted.victim_name || extracted.nome || '',
          victim_age: extracted.victim_age || '',
          accident_date: convertDateToISO(extracted.accident_date || ''),
          accident_address: extracted.accident_address || extracted.regiao || '',
          damage_description: extracted.damage_description || extracted.interesse || '',
          visit_address: extracted.regiao || '',
          contractor_company: extracted.contractor_company || '',
          main_company: extracted.main_company || '',
          sector: extracted.sector || '',
        });
        // Store additional victims if detected
        if (extracted.additional_victims?.length) {
          setAdditionalVictims(extracted.additional_victims.filter(v => v.victim_name).map(v => ({
            victim_name: v.victim_name || '',
            victim_age: v.victim_age,
            damage_description: v.damage_description,
          })));
        }
        // Check for duplicate based on victim_name + accident_date + city + state
        const victimName = extracted.victim_name || extracted.nome || '';
        const accidentDate = convertDateToISO(extracted.accident_date || '');
        const city = extracted.cidade || '';
        const state = extracted.estado || '';
        if (victimName.trim() && (accidentDate.trim() || city.trim())) {
          let query = supabase.from('leads').select('id, lead_name').limit(5);
          if (victimName.trim()) query = query.ilike('victim_name', `%${victimName.trim()}%`);
          if (accidentDate.trim()) query = query.eq('accident_date', accidentDate.trim());
          if (city.trim()) query = query.ilike('visit_city', `%${city.trim()}%`);
          if (state.trim()) query = query.eq('visit_state', state.trim().toUpperCase());
          const { data: duplicates } = await query;
          if (duplicates && duplicates.length > 0) {
            const names = duplicates.map(d => d.lead_name || 'Sem nome').join(', ');
            toast.warning(`⚠️ Possível duplicata encontrada! Leads similares: ${names}. Verifique antes de salvar.`, { duration: 8000 });
          }
        }

        setStep('review');
        toast.success('Dados extraídos pela IA!');
      } else {
        toast.error(data?.error || 'Não foi possível extrair dados');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro na extração');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFormChange = (data: Partial<AccidentLeadFormData>) => {
    setFormData(prev => ({ ...prev, ...data }));
  };

  const handleSave = async () => {
    // Validate required fields
    if (!formData.lead_name.trim()) {
      toast.error('O nome do lead é obrigatório');
      return;
    }
    if (!selectedBoardId) {
      toast.error('O funil de vendas é obrigatório');
      return;
    }
    if (!formData.acolhedor?.trim()) {
      toast.error('O acolhedor é obrigatório');
      return;
    }
    setIsSubmitting(true);
    setStep('saving');

    try {
      if (targetType === 'lead') {
        const { data: newLead, error } = await supabase.from('leads').insert({
          lead_name: formData.lead_name,
          lead_phone: formData.lead_phone || null,
          lead_email: formData.lead_email || null,
          source: formData.source || detectPlatform(url).toLowerCase(),
          notes: formData.notes || null,
          acolhedor: formData.acolhedor || null,
          case_type: formData.case_type || null,
          group_link: formData.group_link || null,
          city: formData.visit_city || null,
          state: formData.visit_state || null,
          visit_city: formData.visit_city || null,
          visit_state: formData.visit_state || null,
          visit_region: formData.visit_region || null,
          visit_address: formData.visit_address || null,
          accident_date: formData.accident_date || null,
          damage_description: formData.damage_description || null,
          victim_name: formData.victim_name || null,
          victim_age: formData.victim_age ? parseInt(formData.victim_age) : null,
          accident_address: formData.accident_address || null,
          contractor_company: formData.contractor_company || null,
          main_company: formData.main_company || null,
          sector: formData.sector || null,
          news_link: formData.news_link || null,
          company_size_justification: formData.company_size_justification || null,
          liability_type: formData.liability_type || null,
          legal_viability: formData.legal_viability || null,
          board_id: selectedBoardId || null,
          created_by: user?.id || null,
          updated_by: user?.id || null,
        }).select('id').single();
        if (error) throw error;

        const createdLeadId = newLead?.id;

        // Enqueue WhatsApp group creation
        if (createdLeadId && selectedBoardId) {
          try {
            const { data: groupSettings } = await supabase
              .from('board_group_settings')
              .select('group_name_prefix, current_sequence')
              .eq('board_id', selectedBoardId)
              .maybeSingle();

            if (groupSettings) {
              // Update sequence counter
              await supabase
                .from('board_group_settings')
                .update({ current_sequence: (groupSettings.current_sequence || 0) + 1 })
                .eq('board_id', selectedBoardId);

              // Enqueue group creation
              await supabase.from('group_creation_queue').insert({
                lead_id: createdLeadId,
                lead_name: formData.lead_name,
                board_id: selectedBoardId,
                phone: formData.lead_phone || null,
                creation_origin: 'instagram_import',
                status: 'pending',
              } as any);
            }
          } catch (groupErr) {
            console.error('Error enqueuing group creation:', groupErr);
            // Non-blocking: lead was already created
          }
        }

        // Link saved bridge contacts to the lead
        if (createdLeadId && savedContacts.size > 0) {
          try {
            for (const username of savedContacts) {
              const { data: contact } = await supabase
                .from('contacts')
                .select('id')
                .eq('instagram_username', username)
                .maybeSingle();
              if (contact) {
                await (supabase as any)
                  .from('contact_leads')
                  .insert({ contact_id: contact.id, lead_id: createdLeadId });
              }
            }
          } catch (linkErr) {
            console.error('Error linking contacts:', linkErr);
          }
        }

        // Create additional leads for extra victims
        if (additionalVictims.length > 0 && selectedBoardId) {
          let extraCreated = 0;
          for (const victim of additionalVictims) {
            try {
              const { data: groupSettings2 } = await supabase
                .from('board_group_settings')
                .select('group_name_prefix, current_sequence')
                .eq('board_id', selectedBoardId)
                .maybeSingle();

              const nextSeq2 = (groupSettings2?.current_sequence || 0) + 1;
              const victimLeadName = groupSettings2?.group_name_prefix
                ? `${groupSettings2.group_name_prefix} ${nextSeq2} ${generateLeadName({
                    city: formData.visit_city, state: formData.visit_state,
                    victim_name: victim.victim_name, main_company: formData.main_company,
                    contractor_company: formData.contractor_company, accident_date: formData.accident_date,
                    damage_description: victim.damage_description || formData.damage_description,
                    case_type: formData.case_type,
                  })}`.trim()
                : victim.victim_name;

              const { data: extraLead } = await supabase.from('leads').insert({
                lead_name: victimLeadName,
                source: formData.source || detectPlatform(url).toLowerCase(),
                notes: formData.notes || null,
                acolhedor: formData.acolhedor || null,
                case_type: formData.case_type || null,
                city: formData.visit_city || null,
                state: formData.visit_state || null,
                visit_city: formData.visit_city || null,
                visit_state: formData.visit_state || null,
                visit_region: formData.visit_region || null,
                visit_address: formData.visit_address || null,
                accident_date: formData.accident_date || null,
                damage_description: victim.damage_description || formData.damage_description || null,
                victim_name: victim.victim_name || null,
                victim_age: victim.victim_age ? parseInt(victim.victim_age) : null,
                accident_address: formData.accident_address || null,
                contractor_company: formData.contractor_company || null,
                main_company: formData.main_company || null,
                sector: formData.sector || null,
                news_link: formData.news_link || null,
                board_id: selectedBoardId,
                created_by: user?.id || null,
                updated_by: user?.id || null,
              }).select('id').single();

              if (extraLead?.id && groupSettings2) {
                await supabase.from('board_group_settings')
                  .update({ current_sequence: nextSeq2 })
                  .eq('board_id', selectedBoardId);
                await supabase.from('group_creation_queue').insert({
                  lead_id: extraLead.id,
                  lead_name: victimLeadName,
                  board_id: selectedBoardId,
                  creation_origin: 'instagram_import',
                  status: 'pending',
                } as any);
              }
              extraCreated++;
            } catch (err) {
              console.error('Error creating extra victim lead:', err);
            }
          }
          if (extraCreated > 0) {
            toast.success(`+ ${extraCreated} lead(s) adicional(is) criado(s) para outras vítimas`);
          }
        }

        toast.success('Lead criado com sucesso!');
      } else if (targetType === 'contact') {
        const { error } = await supabase.from('contacts').insert({
          full_name: formData.lead_name || `Contato ${detectPlatform(url)}`,
          phone: formData.lead_phone || null,
          email: formData.lead_email || null,
          city: formData.visit_city || null,
          state: formData.visit_state || null,
          notes: formData.notes || null,
        });
        if (error) throw error;
        toast.success('Contato criado com sucesso!');
      } else if (targetType === 'activity') {
        const { error } = await supabase.from('lead_activities').insert({
          title: formData.lead_name || `Atividade via ${detectPlatform(url)}`,
          description: formData.notes || null,
          activity_type: 'tarefa',
          status: 'pendente',
          priority: 'normal',
        });
        if (error) throw error;
        toast.success('Atividade criada com sucesso!');
      }

      onSuccess?.();
      handleClose();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
      setStep('review');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFetchComments = async () => {
    if (!url.trim()) {
      toast.error('URL do post é necessária para buscar comentários');
      return;
    }
    setIsFetchingComments(true);
    try {
      const { data, error } = await cloudFunctions.invoke('fetch-post-comments', {
        body: { postUrl: url.trim(), analyzeWithAI: true },
      });
      if (error) throw error;
      if (data?.success) {
        setCommentsCount(data.total || 0);
        setCommentsAnalysis(data.analysis);
        
        // Merge AI analysis into form if we have useful data
        if (data.analysis) {
          const a = data.analysis;
          setFormData(prev => {
            const updates: Partial<AccidentLeadFormData> = {};
            if (a.victim_info?.name && !prev.victim_name) updates.victim_name = a.victim_info.name;
            if (a.victim_info?.age && !prev.victim_age) updates.victim_age = a.victim_info.age;
            if (a.accident_info?.date && !prev.accident_date) updates.accident_date = convertDateToISO(a.accident_info.date);
            if (a.accident_info?.location && !prev.visit_city) updates.visit_city = a.accident_info.location;
            if (a.accident_info?.state && !prev.visit_state) updates.visit_state = a.accident_info.state;
            if (a.accident_info?.company && !prev.main_company) updates.main_company = a.accident_info.company;
            if (a.accident_info?.description) {
              updates.damage_description = prev.damage_description 
                ? `${prev.damage_description}\n\n📝 Dos comentários: ${a.accident_info.description}`
                : a.accident_info.description;
            }
            // Add contacts info to notes
            const contactNotes = a.potential_contacts?.filter((c: any) => c.username)
              .map((c: any) => `${c.username} (${c.type || 'contato'}): ${c.info || c.relationship || ''}`)
              .join('\n');
            if (contactNotes) {
              updates.notes = prev.notes 
                ? `${prev.notes}\n\n👥 Contatos dos comentários:\n${contactNotes}`
                : `👥 Contatos dos comentários:\n${contactNotes}`;
            }
            return { ...prev, ...updates };
          });
          toast.success(`${data.total} comentários analisados! Dados complementados.`);
        } else {
          toast.info(`${data.total} comentários encontrados, mas sem informações relevantes.`);
        }
      } else {
        toast.error(data?.error || 'Erro ao buscar comentários');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao buscar comentários');
    } finally {
      setIsFetchingComments(false);
    }
  };

  const [pendingContact, setPendingContact] = useState<any>(null);

  const handleSaveCommentContact = (contact: any) => {
    setPendingContact(contact);
  };

  const confirmSaveContact = async () => {
    if (!pendingContact) return;
    const contact = pendingContact;
    setPendingContact(null);
    const username = contact.username?.replace('@', '') || '';
    if (!username) return;
    setSavingContact(username);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { error } = await supabase.from('contacts').insert({
        full_name: username,
        instagram_username: username,
        instagram_url: `https://instagram.com/${username}`,
        notes: [
          contact.relationship ? `Relação: ${contact.relationship}` : null,
          contact.info ? `Info: ${contact.info}` : null,
          contact.type ? `Tipo: ${contact.type}` : null,
          `Identificado nos comentários do post: ${url}`,
        ].filter(Boolean).join('\n'),
        classifications: [contact.type === 'familiar' ? 'Familiar' : contact.type === 'testemunha' ? 'Testemunha' : 'Indicação'],
        created_by: currentUser?.id || null,
      });
      if (error) throw error;
      setSavedContacts(prev => new Set([...prev, username]));
      toast.success(`Contato @${username} cadastrado!`);
    } catch (err: any) {
      toast.error(`Erro ao cadastrar @${username}: ${err.message}`);
    } finally {
      setSavingContact(null);
    }
  };

  const handleClose = () => {
    setUrl('');
    setCaption('');
    setFormData({ ...initialFormData });
    setSelectedBoardId('');
    setStep('input');
    setTargetType('lead');
    setCommentsAnalysis(null);
    setCommentsCount(0);
    setSavedContacts(new Set());
    setAdditionalVictims([]);
    onOpenChange(false);
  };

  const platform = detectPlatform(url);

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={step === 'review' ? "max-w-2xl max-h-[90vh] overflow-y-auto" : "max-w-lg max-h-[85vh] overflow-y-auto"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Importar de Link Social
          </DialogTitle>
        </DialogHeader>

        {step === 'input' && (
          <div className="space-y-4 py-2">
            {/* URL Input */}
            <div className="space-y-2">
              <Label>URL do Post</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://instagram.com/p/... ou cole link do Facebook"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1"
                />
                {url.trim() && (
                  <Badge variant="outline" className="shrink-0 self-center">
                    {platform}
                  </Badge>
                )}
              </div>
              {url.trim() && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFetchCaption}
                  disabled={isFetchingMeta}
                  className="w-full"
                >
                  {isFetchingMeta ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Extrair legenda automaticamente
                </Button>
              )}
            </div>

            {/* Caption */}
            <div className="space-y-2">
              <Label>Legenda / Texto do Post</Label>
              <Textarea
                placeholder="Cole aqui a legenda do post ou clique acima para extrair automaticamente..."
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                A IA vai analisar este texto para extrair nome, telefone, interesse e outros dados
              </p>
            </div>

            {/* Target Type */}
            <div className="space-y-2">
              <Label>O que deseja criar?</Label>
              <Select value={targetType} onValueChange={(v) => setTargetType(v as TargetType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">
                    <span className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4" /> Lead
                    </span>
                  </SelectItem>
                  <SelectItem value="contact">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Contato
                    </span>
                  </SelectItem>
                  <SelectItem value="activity">
                    <span className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4" /> Atividade
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">Dados extraídos pela IA — edite antes de salvar</span>
            </div>

            {/* Board (Funil) selector */}
            {targetType === 'lead' && (
              <div className="space-y-2">
                <Label>Funil de Vendas</Label>
                <Select value={selectedBoardId} onValueChange={handleBoardChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o funil..." />
                  </SelectTrigger>
                  <SelectContent>
                    {boards.map(board => (
                      <SelectItem key={board.id} value={board.id}>
                        {board.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Fetch Comments Button */}
            {url.trim() && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchComments}
                disabled={isFetchingComments}
                className="w-full gap-2 border-dashed"
              >
                {isFetchingComments ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                {isFetchingComments ? 'Buscando comentários via Apify...' : '🔍 Buscar comentários do post (Apify)'}
              </Button>
            )}

            {/* Comments Analysis Display */}
            {commentsAnalysis && (
              <Accordion type="single" collapsible defaultValue="comments">
                <AccordionItem value="comments" className="border rounded-lg">
                  <AccordionTrigger className="px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      Análise de {commentsCount} comentários
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 space-y-3">
                    {/* Victim info from comments */}
                    {commentsAnalysis.victim_info && Object.values(commentsAnalysis.victim_info).some(Boolean) && (
                      <div className="p-2 rounded bg-muted/50 space-y-1">
                        <p className="text-xs font-medium flex items-center gap-1">
                          <Users className="h-3 w-3" /> Info da vítima (comentários)
                        </p>
                        {commentsAnalysis.victim_info.name && <p className="text-xs">Nome: {commentsAnalysis.victim_info.name}</p>}
                        {commentsAnalysis.victim_info.age && <p className="text-xs">Idade: {commentsAnalysis.victim_info.age}</p>}
                        {commentsAnalysis.victim_info.profession && <p className="text-xs">Profissão: {commentsAnalysis.victim_info.profession}</p>}
                        {commentsAnalysis.victim_info.condition && <p className="text-xs">Estado: {commentsAnalysis.victim_info.condition}</p>}
                      </div>
                    )}

                    {/* Accident info from comments */}
                    {commentsAnalysis.accident_info && Object.values(commentsAnalysis.accident_info).some(Boolean) && (
                      <div className="p-2 rounded bg-muted/50 space-y-1">
                        <p className="text-xs font-medium flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Info do acidente (comentários)
                        </p>
                        {commentsAnalysis.accident_info.location && <p className="text-xs">Local: {commentsAnalysis.accident_info.location}</p>}
                        {commentsAnalysis.accident_info.date && <p className="text-xs">Data: {commentsAnalysis.accident_info.date}</p>}
                        {commentsAnalysis.accident_info.company && <p className="text-xs">Empresa: {commentsAnalysis.accident_info.company}</p>}
                        {commentsAnalysis.accident_info.description && <p className="text-xs">Detalhes: {commentsAnalysis.accident_info.description}</p>}
                      </div>
                    )}

                    {/* Potential contacts with register buttons */}
                    {commentsAnalysis.potential_contacts?.length > 0 && (
                      <div className="p-2 rounded bg-muted/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium flex items-center gap-1">
                            <Users className="h-3 w-3" /> Pontes identificadas ({commentsAnalysis.potential_contacts.length})
                          </p>
                        </div>
                        {commentsAnalysis.potential_contacts.map((c: any, i: number) => {
                          const username = c.username?.replace('@', '') || '';
                          const isSaved = savedContacts.has(username);
                          const isSaving = savingContact === username;
                          return (
                            <div key={i} className="flex items-center gap-2 p-1.5 rounded border bg-background">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                  <Badge variant="outline" className="text-[10px] shrink-0">{c.type || 'contato'}</Badge>
                                  <span className="text-xs font-medium truncate">{c.username}</span>
                                </div>
                                {(c.relationship || c.info) && (
                                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                    {c.relationship || c.info}
                                  </p>
                                )}
                              </div>
                              {isSaved ? (
                                <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
                                  <CheckCircle2 className="h-3 w-3" /> Salvo
                                </Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="shrink-0 h-7 text-xs gap-1"
                                  disabled={isSaving}
                                  onClick={() => handleSaveCommentContact(c)}
                                >
                                  {isSaving ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <UserPlus className="h-3 w-3" />
                                  )}
                                  Cadastrar
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Key comments */}
                    {commentsAnalysis.key_comments?.length > 0 && (
                      <div className="p-2 rounded bg-muted/50 space-y-1">
                        <p className="text-xs font-medium">💬 Comentários relevantes</p>
                        {commentsAnalysis.key_comments.map((c: string, i: number) => (
                          <p key={i} className="text-xs text-muted-foreground italic">"{c}"</p>
                        ))}
                      </div>
                    )}

                    {commentsAnalysis.additional_details && (
                      <p className="text-xs text-muted-foreground">{commentsAnalysis.additional_details}</p>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            {/* Additional Victims Alert */}
            {additionalVictims.length > 0 && (
              <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-amber-600" />
                  {additionalVictims.length + 1} vítimas detectadas — será criado 1 lead para cada
                </p>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    <strong>Principal:</strong> {formData.victim_name || '(sem nome)'}
                  </p>
                  {additionalVictims.map((v, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-[10px] shrink-0">Vítima {i + 2}</Badge>
                      <span>{v.victim_name}</span>
                      {v.damage_description && <span className="text-muted-foreground truncate">— {v.damage_description}</span>}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-[10px] text-destructive ml-auto"
                        onClick={() => setAdditionalVictims(prev => prev.filter((_, idx) => idx !== i))}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AccidentLeadForm - same as CreateLeadFromSearchDialog */}
            <AccidentLeadForm
              formData={formData}
              onChange={handleFormChange}
              onOpenExtractor={() => {}}
              teamMembers={teamMembers}
            />
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 'input' && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button onClick={handleExtract} disabled={!caption.trim() || isExtracting}>
                {isExtracting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Analisar com IA
              </Button>
            </>
          )}
          {step === 'review' && (
            <>
              <Button variant="outline" onClick={() => setStep('input')}>Voltar</Button>
              <Button onClick={handleSave} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <UserPlus className="h-4 w-4 mr-2" />
                Criar {targetType === 'lead' ? 'Lead' : targetType === 'contact' ? 'Contato' : 'Atividade'}
              </Button>
            </>
          )}
          {step === 'saving' && (
            <Button disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Salvando...
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {/* Confirmation dialog for saving contact */}
      <AlertDialog open={!!pendingContact} onOpenChange={(open) => { if (!open) setPendingContact(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cadastrar contato?</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja salvar <strong className="text-foreground">@{pendingContact?.username?.replace('@', '') || ''}</strong> como contato?
              {pendingContact?.relationship && (
                <span className="block mt-1">Relação: {pendingContact.relationship}</span>
              )}
              {pendingContact?.type && (
                <span className="block mt-1">Tipo: {pendingContact.type}</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSaveContact}>
              Salvar Contato
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
