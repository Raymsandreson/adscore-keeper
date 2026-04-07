import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface LegalCase {
  id: string;
  lead_id: string | null;
  nucleus_id: string | null;
  case_number: string;
  title: string;
  description: string | null;
  status: 'aberto' | 'em_andamento' | 'encerrado' | 'arquivado';
  outcome: string | null;
  outcome_date: string | null;
  assigned_to: string | null;
  created_by: string | null;
  notes: string | null;
  benefit_type: string | null;
  acolhedor: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  nucleus_name?: string;
  nucleus_prefix?: string;
  nucleus_color?: string;
  process_count?: number;
}

export function useLegalCases(leadId?: string) {
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCases = useCallback(async (id?: string) => {
    const targetId = id || leadId;
    if (!targetId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('legal_cases')
        .select('*, specialized_nuclei(name, prefix, color)')
        .eq('lead_id', targetId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      
      const enriched = (data || []).map((c: any) => ({
        ...c,
        nucleus_name: c.specialized_nuclei?.name,
        nucleus_prefix: c.specialized_nuclei?.prefix,
        nucleus_color: c.specialized_nuclei?.color,
      }));
      setCases(enriched as LegalCase[]);
    } catch (error) {
      console.error('Error fetching cases:', error);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  const createCase = useCallback(async (caseData: { lead_id?: string | null; nucleus_id?: string | null; title: string; description?: string; notes?: string; case_number?: string; acolhedor?: string }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      let caseNumber = caseData.case_number?.trim();
      
      // If user provided a case_number, check uniqueness
      if (caseNumber) {
        const { data: existing } = await supabase
          .from('legal_cases')
          .select('id')
          .eq('case_number', caseNumber)
          .maybeSingle();
        if (existing) {
          toast.error(`Já existe um caso com o número "${caseNumber}"`);
          throw new Error('Número de caso duplicado');
        }
      } else {
        // Auto-generate if not provided
        const { data: generated, error: numError } = await supabase
          .rpc('generate_case_number', { p_nucleus_id: caseData.nucleus_id || null });
        if (numError) throw numError;
        caseNumber = generated;
      }

      const { data, error } = await supabase
        .from('legal_cases')
        .insert({
          lead_id: caseData.lead_id || null,
          nucleus_id: caseData.nucleus_id || null,
          case_number: caseNumber,
          title: caseData.title,
          description: caseData.description || null,
          notes: caseData.notes || null,
          acolhedor: caseData.acolhedor || null,
          created_by: user?.id,
        } as any)
        .select('*, specialized_nuclei(name, prefix, color)')
        .single();
      if (error) throw error;

      const enriched = {
        ...data,
        nucleus_name: (data as any).specialized_nuclei?.name,
        nucleus_prefix: (data as any).specialized_nuclei?.prefix,
        nucleus_color: (data as any).specialized_nuclei?.color,
      } as LegalCase;

      setCases(prev => [enriched, ...prev]);

      // Auto-create process tracking record
      try {
        // Fetch lead data for auto-fill
        let leadData: any = null;
        if (caseData.lead_id) {
          const { data: ld } = await supabase
            .from('leads')
            .select('lead_name, acolhedor, case_type')
            .eq('id', caseData.lead_id)
            .maybeSingle();
          leadData = ld;
        }

        await supabase.from('case_process_tracking').insert({
          case_id: enriched.id,
          lead_id: caseData.lead_id || null,
          cliente: leadData?.lead_name || caseData.title,
          caso: caseData.title,
          tipo: leadData?.case_type || (enriched as any).benefit_type || null,
          acolhedor: leadData?.acolhedor || (enriched as any).acolhedor || null,
          data_criacao: new Date().toISOString().split('T')[0],
          import_source: 'auto_lead_close',
        } as any);
      } catch (trackingError) {
        console.warn('Could not auto-create tracking record:', trackingError);
      }

      // Auto-create predefined processes + activities for CASO-prefixed cases
      if (caseNumber && caseNumber.startsWith('CASO')) {
        const CASO_PROCESSES: Array<{ title: string; userId: string; userName: string }> = [
          { title: 'Onboarding', userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa' },
          { title: 'Indenização', userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa' },
          { title: 'Relatório de Acidente', userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
          { title: 'TRCT + Verbas', userId: '44fd2301-47c6-4912-a583-0213b1c368eb', userName: 'João Vitor' },
          { title: 'Seguro de Vida', userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
          { title: 'Benefício INSS', userId: '4dba2de0-5357-49ab-8bf9-4c248a1440de', userName: 'Gisele' },
          { title: 'Inquérito Policial', userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa' },
          { title: 'Organizar docs', userId: '7f41a35e-7d98-4ade-8270-52d727433e6a', userName: 'Abderaman' },
        ];

        // Fetch WhatsApp group info for context
        let groupContext = '';
        if (caseData.lead_id) {
          try {
            const { data: lead } = await supabase
              .from('leads')
              .select('whatsapp_group_id, lead_phone, lead_name, case_type, lead_city, lead_state')
              .eq('id', caseData.lead_id)
              .maybeSingle();
            if (lead) {
              groupContext = [
                lead.lead_name && `Cliente: ${lead.lead_name}`,
                lead.case_type && `Tipo: ${lead.case_type}`,
                lead.lead_city && `Cidade: ${lead.lead_city}/${lead.lead_state || ''}`,
              ].filter(Boolean).join(' | ');
            }
          } catch { /* ignore */ }
        }

        for (const proc of CASO_PROCESSES) {
          try {
            const { data: savedProcess } = await supabase.from('lead_processes').insert({
              lead_id: caseData.lead_id || null,
              case_id: enriched.id,
              process_type: 'administrativo',
              title: proc.title,
              description: groupContext ? `Dados do lead: ${groupContext}` : null,
              status: 'em_andamento',
              started_at: new Date().toISOString().split('T')[0],
              created_by: user?.id,
            } as any).select('id').single();

            // Create activity assigned to the responsible person
            await supabase.from('lead_activities').insert({
              lead_id: caseData.lead_id || null,
              lead_name: caseData.title,
              title: `Dar andamento - ${proc.title}`,
              description: `Atividade criada automaticamente para o caso ${caseNumber}. ${groupContext}`,
              activity_type: 'tarefa',
              status: 'pendente',
              priority: proc.title === 'Onboarding' ? 'alta' : 'normal',
              assigned_to: proc.userId,
              assigned_to_name: proc.userName,
              created_by: user?.id,
              deadline: new Date().toISOString().split('T')[0],
              process_id: savedProcess?.id || null,
            } as any);
          } catch (procErr) {
            console.warn(`Could not auto-create process "${proc.title}":`, procErr);
          }
        }
      }

      toast.success(`Caso ${caseNumber} criado`);
      return enriched;
    } catch (error) {
      console.error('Error creating case:', error);
      toast.error('Erro ao criar caso');
      throw error;
    }
  }, []);

  const updateCase = useCallback(async (id: string, updates: Partial<LegalCase>) => {
    try {
      const { data, error } = await supabase
        .from('legal_cases')
        .update(updates as any)
        .eq('id', id)
        .select('*, specialized_nuclei(name, prefix, color)')
        .single();
      if (error) throw error;
      
      const enriched = {
        ...data,
        nucleus_name: (data as any).specialized_nuclei?.name,
        nucleus_prefix: (data as any).specialized_nuclei?.prefix,
        nucleus_color: (data as any).specialized_nuclei?.color,
      } as LegalCase;

      setCases(prev => prev.map(c => c.id === id ? enriched : c));
      toast.success('Caso atualizado');
      return enriched;
    } catch (error) {
      console.error('Error updating case:', error);
      toast.error('Erro ao atualizar caso');
      throw error;
    }
  }, []);

  const deleteCase = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('legal_cases')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setCases(prev => prev.filter(c => c.id !== id));
      toast.success('Caso removido');
    } catch (error) {
      console.error('Error deleting case:', error);
      toast.error('Erro ao remover caso');
      throw error;
    }
  }, []);

  return { cases, loading, fetchCases, createCase, updateCase, deleteCase };
}
