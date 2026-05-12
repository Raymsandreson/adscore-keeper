import { useState, useCallback } from 'react';
import { db as supabase } from '@/integrations/supabase';
import { toast } from 'sonner';

export type ChecklistType = 'documentos' | 'requisitos' | 'perguntas' | 'verificacao' | 'outro';

export const CHECKLIST_TYPES: { value: ChecklistType; label: string; color: string; icon: string }[] = [
  { value: 'documentos', label: 'Documentos', color: 'orange', icon: '📄' },
  { value: 'requisitos', label: 'Requisitos', color: 'blue', icon: '✅' },
  { value: 'perguntas', label: 'Perguntas', color: 'purple', icon: '❓' },
  { value: 'verificacao', label: 'Verificação', color: 'green', icon: '🔍' },
  { value: 'outro', label: 'Outro', color: 'gray', icon: '📋' },
];

export interface DocChecklistItem {
  id: string;
  label: string;
  checked?: boolean;
  type?: ChecklistType;
  nextStageId?: string;
}

// Campos da atividade que podem ter modelo de mensagem por passo.
// Mantidos como constante para reuso no editor (tabs do dialog) e no
// pré-preenchimento ao criar a atividade vinculada ao passo.
export const ACTIVITY_MESSAGE_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'current_status', label: 'Como está', placeholder: 'Ex: Lead aguardando retorno após primeira ligação...' },
  { key: 'what_was_done', label: 'O que foi feito', placeholder: 'Ex: Entrei em contato pelo WhatsApp e enviei o script de apresentação.' },
  { key: 'next_steps', label: 'Próximo passo', placeholder: 'Ex: Aguardar resposta até {{data_retorno}} e ligar novamente se não responder.' },
  { key: 'notes', label: 'Observações', placeholder: 'Ex: {{lead_name}} prefere ser contatado após as 18h.' },
];

export interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  checked?: boolean;
  activityType?: string; // tipo de atividade associado a este passo
  script?: string; // script de contato para este passo
  nextStageId?: string; // ao concluir, mover lead para esta fase
  docChecklist?: DocChecklistItem[]; // checklist de documentação
  // Modelo de mensagem por campo da atividade gerada neste passo.
  // Chaves correspondem a ACTIVITY_MESSAGE_FIELDS (current_status, what_was_done, next_steps, notes).
  // Aceita string (legado, 1 modelo) OU array de variações (novo, múltiplos modelos por campo).
  messageTemplates?: Record<string, string | TemplateVariation[]>;
}

// Variação nomeada de modelo de mensagem (ex: "Formal", "Curta", "Padrão").
export interface TemplateVariation {
  id: string;
  name: string;
  content: string;
}

// Normaliza qualquer formato salvo (string solta ou array) para array de variações.
export function normalizeMessageTemplates(
  raw: Record<string, string | TemplateVariation[]> | undefined | null
): Record<string, TemplateVariation[]> {
  if (!raw) return {};
  const out: Record<string, TemplateVariation[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v) continue;
    if (typeof v === 'string') {
      if (v.trim()) out[k] = [{ id: 'default', name: 'Padrão', content: v }];
    } else if (Array.isArray(v)) {
      const filtered = v.filter(x => x && typeof x.content === 'string' && x.content.trim());
      if (filtered.length > 0) out[k] = filtered;
    }
  }
  return out;
}

// Serializa array de variações de volta — se 1 só sem nome customizado, salva string (compat).
export function serializeMessageTemplates(
  variations: Record<string, TemplateVariation[]>
): Record<string, string | TemplateVariation[]> {
  const out: Record<string, string | TemplateVariation[]> = {};
  for (const [k, list] of Object.entries(variations)) {
    const clean = (list || []).filter(v => v.content && v.content.trim());
    if (clean.length === 0) continue;
    if (clean.length === 1 && (!clean[0].name || clean[0].name === 'Padrão' || clean[0].name === 'default')) {
      out[k] = clean[0].content;
    } else {
      out[k] = clean;
    }
  }
  return out;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  items: ChecklistItem[];
  created_at: string;
  updated_at: string;
}

export interface ChecklistStageLink {
  id: string;
  checklist_template_id: string;
  board_id: string;
  stage_id: string;
  display_order: number;
  created_at: string;
}

export interface LeadChecklistInstance {
  id: string;
  lead_id: string;
  checklist_template_id: string;
  board_id: string;
  stage_id: string;
  items: ChecklistItem[];
  is_completed: boolean;
  is_readonly: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  template_name?: string;
  is_mandatory?: boolean;
}

export const useChecklists = () => {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTemplates = useCallback(async (): Promise<ChecklistTemplate[]> => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('checklist_templates')
        .select('*')
        .order('name');

      if (error) throw error;

      const parsed = (data || []).map(t => ({
        ...t,
        items: (t.items as unknown as ChecklistItem[]) || [],
      })) as ChecklistTemplate[];
      setTemplates(parsed);
      return parsed;
    } catch (error) {
      console.error('Error fetching checklist templates:', error);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const createTemplate = async (template: Partial<ChecklistTemplate>) => {
    try {
      const { data, error } = await supabase
        .from('checklist_templates')
        .insert({
          name: template.name || 'Novo Checklist',
          description: template.description || null,
          is_mandatory: template.is_mandatory || false,
          items: JSON.parse(JSON.stringify(template.items || [])),
        })
        .select()
        .single();

      if (error) throw error;
      toast.success('Checklist criado!');
      fetchTemplates();
      return data;
    } catch (error) {
      console.error('Error creating checklist:', error);
      toast.error('Erro ao criar checklist');
      throw error;
    }
  };

  const updateTemplate = async (id: string, updates: Partial<ChecklistTemplate>) => {
    try {
      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.description !== undefined) payload.description = updates.description;
      if (updates.is_mandatory !== undefined) payload.is_mandatory = updates.is_mandatory;
      if (updates.items !== undefined) payload.items = JSON.parse(JSON.stringify(updates.items));

      const { error } = await supabase
        .from('checklist_templates')
        .update(payload)
        .eq('id', id);

      if (error) throw error;
      toast.success('Checklist atualizado!');
      fetchTemplates();
    } catch (error) {
      console.error('Error updating checklist:', error);
      toast.error('Erro ao atualizar checklist');
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      const { error } = await supabase
        .from('checklist_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Checklist removido!');
      fetchTemplates();
    } catch (error) {
      console.error('Error deleting checklist:', error);
      toast.error('Erro ao remover checklist');
    }
  };

  // Stage Links
  const fetchStageLinks = async (boardId: string) => {
    const { data, error } = await supabase
      .from('checklist_stage_links')
      .select('*')
      .eq('board_id', boardId)
      .order('display_order');

    if (error) {
      console.error('Error fetching stage links:', error);
      return [];
    }
    return (data || []) as ChecklistStageLink[];
  };

  const linkChecklistToStage = async (templateId: string, boardId: string, stageId: string) => {
    try {
      const { error } = await supabase
        .from('checklist_stage_links')
        .insert({
          checklist_template_id: templateId,
          board_id: boardId,
          stage_id: stageId,
        });

      if (error) {
        if (error.code === '23505') {
          toast.info('Checklist já vinculado a esta fase');
          return;
        }
        throw error;
      }
      toast.success('Checklist vinculado!');
    } catch (error) {
      console.error('Error linking checklist:', error);
      toast.error('Erro ao vincular checklist');
    }
  };

  const unlinkChecklistFromStage = async (linkId: string) => {
    try {
      const { error } = await supabase
        .from('checklist_stage_links')
        .delete()
        .eq('id', linkId);

      if (error) throw error;
    } catch (error) {
      console.error('Error unlinking checklist:', error);
      toast.error('Erro ao desvincular checklist');
    }
  };

  // Lead Instances
  const fetchLeadInstances = async (leadId: string) => {
    const { data, error } = await supabase
      .from('lead_checklist_instances')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching lead checklists:', error);
      return [];
    }

    return (data || []).map(i => ({
      ...i,
      items: (i.items as unknown as ChecklistItem[]) || [],
    })) as LeadChecklistInstance[];
  };

  const createLeadInstances = async (leadId: string, boardId: string, stageId: string) => {
    // Get links for this stage
    const links = await fetchStageLinks(boardId);
    const stageLinks = links.filter(l => l.stage_id === stageId);

    if (stageLinks.length === 0) return;

    // Get templates
    const templateIds = stageLinks.map(l => l.checklist_template_id);
    const { data: templateData } = await supabase
      .from('checklist_templates')
      .select('*')
      .in('id', templateIds);

    if (!templateData || templateData.length === 0) return;

    // Check existing instances to avoid duplicates
    const { data: existing } = await supabase
      .from('lead_checklist_instances')
      .select('checklist_template_id')
      .eq('lead_id', leadId)
      .eq('board_id', boardId)
      .eq('stage_id', stageId);

    const existingTemplateIds = new Set((existing || []).map(e => e.checklist_template_id));

    const newInstances = templateData
      .filter(t => !existingTemplateIds.has(t.id))
      .map(t => ({
        lead_id: leadId,
        checklist_template_id: t.id,
        board_id: boardId,
        stage_id: stageId,
        items: JSON.parse(JSON.stringify(
          ((t.items as unknown as ChecklistItem[]) || []).map(item => ({ ...item, checked: false }))
        )),
        is_completed: false,
        is_readonly: false,
      }));

    if (newInstances.length === 0) return;

    const { error } = await supabase
      .from('lead_checklist_instances')
      .insert(newInstances);

    if (error) {
      console.error('Error creating lead checklist instances:', error);
    }
  };

  const markStageInstancesReadonly = async (leadId: string, boardId: string, stageId: string) => {
    const { error } = await supabase
      .from('lead_checklist_instances')
      .update({ is_readonly: true })
      .eq('lead_id', leadId)
      .eq('board_id', boardId)
      .eq('stage_id', stageId);

    if (error) {
      console.error('Error marking instances readonly:', error);
    }
  };

  const updateInstanceItem = async (instanceId: string, items: ChecklistItem[]) => {
    const allChecked = items.every(i => i.checked);
    const { error } = await supabase
      .from('lead_checklist_instances')
      .update({
        items: JSON.parse(JSON.stringify(items)),
        is_completed: allChecked,
        completed_at: allChecked ? new Date().toISOString() : null,
      })
      .eq('id', instanceId);

    if (error) {
      console.error('Error updating checklist instance:', error);
      toast.error('Erro ao atualizar checklist');
    }
  };

  return {
    templates,
    loading,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    fetchStageLinks,
    linkChecklistToStage,
    unlinkChecklistFromStage,
    fetchLeadInstances,
    createLeadInstances,
    markStageInstancesReadonly,
    updateInstanceItem,
  };
};
