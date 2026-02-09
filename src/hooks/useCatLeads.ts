import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CatLead {
  id: string;
  agente_causador: string | null;
  cbo: string | null;
  cid_10: string | null;
  cnae_empregador: string | null;
  filiacao_segurado: string | null;
  indica_obito: boolean;
  municipio_empregador: string | null;
  natureza_lesao: string | null;
  origem_cadastramento: string | null;
  parte_corpo_atingida: string | null;
  sexo: string | null;
  tipo_acidente: string | null;
  uf_municipio_acidente: string | null;
  uf_municipio_empregador: string | null;
  data_afastamento: string | null;
  data_acidente: string | null;
  data_nascimento: string | null;
  data_emissao_cat: string | null;
  tipo_empregador: string | null;
  cnpj_cei_empregador: string | null;
  cpf: string | null;
  nome_completo: string;
  endereco: string | null;
  bairro: string | null;
  cep: string | null;
  municipio: string | null;
  uf: string | null;
  celular_1: string | null;
  resultado_celular_1: string | null;
  celular_2: string | null;
  resultado_celular_2: string | null;
  celular_3: string | null;
  resultado_celular_3: string | null;
  celular_4: string | null;
  resultado_celular_4: string | null;
  fixo_1: string | null;
  resultado_fixo_1: string | null;
  fixo_2: string | null;
  resultado_fixo_2: string | null;
  fixo_3: string | null;
  resultado_fixo_3: string | null;
  fixo_4: string | null;
  resultado_fixo_4: string | null;
  contact_status: string;
  assigned_to: string | null;
  priority: string;
  notes: string | null;
  lead_id: string | null;
  imported_at: string;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CatLeadContact {
  id: string;
  cat_lead_id: string;
  contacted_by: string | null;
  contact_channel: string;
  contact_result: string;
  phone_used: string | null;
  notes: string | null;
  next_action: string | null;
  next_action_date: string | null;
  created_at: string;
}

export function useCatLeads() {
  const [catLeads, setCatLeads] = useState<CatLead[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCatLeads = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cat_leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCatLeads((data || []) as CatLead[]);
    } catch (error) {
      console.error('Error fetching CAT leads:', error);
      toast.error('Erro ao carregar CATs');
    } finally {
      setLoading(false);
    }
  }, []);

  const importCatLeads = async (leads: Partial<CatLead>[]) => {
    try {
      const batchId = `import_${Date.now()}`;
      const records = leads
        .filter(l => l.nome_completo)
        .map(l => ({
          ...l,
          nome_completo: l.nome_completo!,
          import_batch_id: batchId,
          contact_status: 'pending',
        }));

      const { error } = await supabase
        .from('cat_leads')
        .insert(records);

      if (error) throw error;

      toast.success(`${records.length} CATs importadas com sucesso`);
      fetchCatLeads();
      return records.length;
    } catch (error) {
      console.error('Error importing CAT leads:', error);
      toast.error('Erro ao importar CATs');
      throw error;
    }
  };

  const updateCatLead = async (id: string, updates: Partial<CatLead>) => {
    try {
      const { error } = await supabase
        .from('cat_leads')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      toast.success('CAT atualizada');
      fetchCatLeads();
    } catch (error) {
      console.error('Error updating CAT lead:', error);
      toast.error('Erro ao atualizar CAT');
    }
  };

  const deleteCatLead = async (id: string) => {
    try {
      const { error } = await supabase
        .from('cat_leads')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('CAT removida');
      fetchCatLeads();
    } catch (error) {
      console.error('Error deleting CAT lead:', error);
      toast.error('Erro ao remover CAT');
    }
  };

  const addContact = async (contact: Omit<CatLeadContact, 'id' | 'created_at'>) => {
    try {
      const { error } = await supabase
        .from('cat_lead_contacts')
        .insert([contact]);

      if (error) throw error;
      toast.success('Contato registrado');
    } catch (error) {
      console.error('Error adding contact:', error);
      toast.error('Erro ao registrar contato');
    }
  };

  const fetchContacts = async (catLeadId: string): Promise<CatLeadContact[]> => {
    try {
      const { data, error } = await supabase
        .from('cat_lead_contacts')
        .select('*')
        .eq('cat_lead_id', catLeadId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as CatLeadContact[];
    } catch (error) {
      console.error('Error fetching contacts:', error);
      return [];
    }
  };

  useEffect(() => {
    fetchCatLeads();
  }, [fetchCatLeads]);

  return {
    catLeads,
    loading,
    fetchCatLeads,
    importCatLeads,
    updateCatLead,
    deleteCatLead,
    addContact,
    fetchContacts,
  };
}
