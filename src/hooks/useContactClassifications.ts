import { useState, useEffect, useCallback } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { toast } from 'sonner';

export interface ContactClassificationRecord {
  id: string;
  name: string;
  color: string;
  icon: string;
  display_order: number;
  is_system: boolean;
  show_in_workflow: boolean;
  created_at: string;
}

// Color options for new classifications
export const classificationColors = [
  { value: 'bg-red-500', label: 'Vermelho' },
  { value: 'bg-orange-500', label: 'Laranja' },
  { value: 'bg-amber-500', label: 'Âmbar' },
  { value: 'bg-yellow-500', label: 'Amarelo' },
  { value: 'bg-lime-500', label: 'Lima' },
  { value: 'bg-green-500', label: 'Verde' },
  { value: 'bg-emerald-500', label: 'Esmeralda' },
  { value: 'bg-teal-500', label: 'Teal' },
  { value: 'bg-cyan-500', label: 'Ciano' },
  { value: 'bg-sky-500', label: 'Céu' },
  { value: 'bg-blue-500', label: 'Azul' },
  { value: 'bg-indigo-500', label: 'Índigo' },
  { value: 'bg-violet-500', label: 'Violeta' },
  { value: 'bg-purple-500', label: 'Roxo' },
  { value: 'bg-fuchsia-500', label: 'Fúcsia' },
  { value: 'bg-pink-500', label: 'Rosa' },
  { value: 'bg-rose-500', label: 'Rose' },
  { value: 'bg-slate-500', label: 'Cinza' },
];

// Rótulos dos status padrão (o `name` é slug técnico gravado em contacts.classifications).
export const CLASSIFICATION_SYSTEM_LABELS: Record<string, string> = {
  client: 'Cliente',
  non_client: 'Não-Cliente',
  prospect: 'Prospect',
  partner: 'Parceiro',
  supplier: 'Fornecedor',
  ponte: 'Ponte',
  ex_cliente: 'Ex-cliente',
  advogado_interno: 'Advogado Interno',
  advogado_externo: 'Advogado Externo',
  advogado_adverso: 'Advogado Adverso',
  parte_contraria: 'Parte Contrária',
  prestador_servico: 'Prestador de Serviço',
  equipe_interna: 'Equipe Interna',
};

export const classificationLabel = (name: string): string =>
  CLASSIFICATION_SYSTEM_LABELS[name] ||
  (name || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

/** Contatos que carregam esse status (array novo `classifications` ou coluna legada `classification`). */
export const contactsWithClassificationFilter = (query: any, name: string) =>
  query.or(`classification.eq.${name},classifications.cs.{"${name}"}`);

/**
 * Troca (ou remove, com `to = null`) o status em todos os contatos afetados.
 * Uma única instrução no Postgres — 'prospect' sozinho tem ~25k contatos.
 */
async function rewriteOnContacts(from: string, to: string | null): Promise<number> {
  await ensureExternalSession();
  const { data, error } = await (db as any).rpc('contact_classification_rewrite', {
    p_from: from,
    p_to: to,
  });
  if (error) {
    console.error('[contact_classifications] falha ao migrar contatos', error);
    toast.error('Status alterado, mas os contatos não foram atualizados');
    return 0;
  }
  return Number(data) || 0;
}

const renameOnContacts = (from: string, to: string) => rewriteOnContacts(from, to);
const removeFromContacts = (name: string) => rewriteOnContacts(name, null);

export const useContactClassifications = () => {
  const [classifications, setClassifications] = useState<ContactClassificationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchClassifications = useCallback(async () => {
    try {
      await ensureExternalSession();
      const { data, error } = await (db as any)
        .from('contact_classifications')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setClassifications((data || []) as ContactClassificationRecord[]);
    } catch (error) {
      console.error('Error fetching classifications:', error);
    }
  }, []);

  const addClassification = async (name: string, color: string = 'bg-gray-500', showInWorkflow: boolean = true) => {
    if (!name.trim()) {
      toast.error('Nome da classificação é obrigatório');
      return null;
    }

    // Check if classification already exists
    const exists = classifications.some(
      c => c.name.toLowerCase() === name.toLowerCase().trim()
    );
    if (exists) {
      toast.error('Essa classificação já existe');
      return null;
    }

    setLoading(true);
    try {
      await ensureExternalSession();
      const { data, error } = await (db as any)
        .from('contact_classifications')
        .insert([{
          name: name.toLowerCase().trim().replace(/\s+/g, '_'),
          color,
          display_order: classifications.length + 1,
          is_system: false,
          show_in_workflow: showInWorkflow
        }])
        .select()
        .single();

      if (error) throw error;
      
      toast.success('Classificação criada com sucesso!');
      await fetchClassifications();
      return data;
    } catch (error: any) {
      console.error('Error adding classification:', error);
      if (error.code === '23505') {
        toast.error('Essa classificação já existe');
      } else {
        toast.error('Erro ao criar classificação');
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateClassification = async (
    id: string,
    updates: Partial<Pick<ContactClassificationRecord, 'name' | 'color' | 'show_in_workflow'>>,
  ): Promise<boolean> => {
    const current = classifications.find(c => c.id === id);
    const nextName = updates.name !== undefined
      ? updates.name.toLowerCase().trim().replace(/\s+/g, '_')
      : undefined;

    if (updates.name !== undefined && !nextName) {
      toast.error('Nome da classificação é obrigatório');
      return false;
    }
    if (nextName && classifications.some(c => c.id !== id && c.name.toLowerCase() === nextName)) {
      toast.error('Essa classificação já existe');
      return false;
    }

    try {
      await ensureExternalSession();
      const payload = { ...updates, ...(nextName ? { name: nextName } : {}) };
      const { data, error } = await (db as any)
        .from('contact_classifications')
        .update(payload)
        .eq('id', id)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error('Sem permissão para editar esse status');
        return false;
      }

      // Renomear o status precisa acompanhar os contatos, senão o valor antigo
      // fica órfão em contacts.classifications e some da lista.
      if (nextName && current && nextName !== current.name) {
        const migrated = await renameOnContacts(current.name, nextName);
        if (migrated > 0) toast.info(`${migrated} contato(s) atualizado(s)`);
      }

      toast.success('Classificação atualizada');
      await fetchClassifications();
      return true;
    } catch (error) {
      console.error('Error updating classification:', error);
      toast.error('Erro ao atualizar classificação');
      return false;
    }
  };

  const deleteClassification = async (id: string): Promise<boolean> => {
    const current = classifications.find(c => c.id === id);

    try {
      await ensureExternalSession();
      // Tira o status dos contatos ANTES de apagar a linha: se a exclusão
      // falhar no meio, sobra a classificação órfã (recuperável), não o inverso.
      const removed = current ? await removeFromContacts(current.name) : 0;

      const { data, error } = await (db as any)
        .from('contact_classifications')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error('Sem permissão para excluir esse status');
        return false;
      }

      toast.success(
        removed > 0 ? `Classificação removida de ${removed} contato(s)` : 'Classificação removida',
      );
      await fetchClassifications();
      return true;
    } catch (error) {
      console.error('Error deleting classification:', error);
      toast.error('Erro ao remover classificação');
      return false;
    }
  };

  useEffect(() => {
    fetchClassifications();
  }, [fetchClassifications]);

  // Build config object for use in components
  const classificationConfig = classifications.reduce((acc, c) => {
    acc[c.name] = {
      label: classificationLabel(c.name),
      color: c.color,
      isSystem: c.is_system,
      showInWorkflow: c.show_in_workflow
    };
    return acc;
  }, {} as Record<string, { label: string; color: string; isSystem: boolean; showInWorkflow: boolean }>);

  return {
    classifications,
    classificationConfig,
    loading,
    fetchClassifications,
    addClassification,
    updateClassification,
    deleteClassification,
  };
};
