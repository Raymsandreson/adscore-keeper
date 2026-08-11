import { useState, useCallback } from 'react';
import { db as supabase } from '@/integrations/supabase';
import { toast } from 'sonner';
import { useAuthContext } from '@/contexts/AuthContext';
import { askStepTiming } from '@/components/checklists/askStepTiming';
import { insertChecklistInstancesTolerant } from '@/lib/checklistInstanceInsert';
import { isStepBlockedBySubItems, pendingSubItemsMessage } from '@/lib/stepSubitems';

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
  /**
   * Selo de EXIBIÇÃO: item marcado que saiu do POP. Calculado a cada load
   * em src/lib/syncChecklistInstances.ts e removido antes de gravar.
   */
  popChange?: 'alterado' | 'removido';
  type?: ChecklistType;
  /**
   * "Não se aplica" a este caso: destrava o passo sem afirmar que o item foi
   * feito. É o escape da regra de src/lib/stepSubitems.ts — sem ele, item que
   * não cabe no caso travaria o passo e o assessor marcaria tudo só pra sair.
   */
  notApplicable?: boolean;
  nextStageId?: string;
  setStatusId?: string; // ao marcar, define o STATUS do POP do lead (id em settings.resultados)
  answers?: StepAnswerOption[]; // pergunta com respostas: o destino vem da resposta escolhida (ignora nextStageId)
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

// Resposta configurável de um passo-pergunta. O destino usa a mesma
// semântica do nextStageId do passo: undefined = não mover,
// '__finalize__' = finalizar, ou id de fase para mover.
export interface StepAnswerOption {
  id: string;
  label: string;
  nextStageId?: string;
  setStatusId?: string; // se escolhida, define o STATUS do POP do lead (id em settings.resultados)
}

export interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  checked?: boolean;
  activityType?: string; // tipo de atividade associado a este passo
  script?: string; // script de contato para este passo
  nextStageId?: string; // ao concluir, mover lead para esta fase
  setStatusId?: string; // ao concluir, define o STATUS do POP do lead (id em settings.resultados)
  answers?: StepAnswerOption[]; // se presente, o passo é uma pergunta: concluir = escolher resposta, e o destino vem da resposta (ignora nextStageId)
  selectedAnswerId?: string; // resposta escolhida na instância do lead
  docChecklist?: DocChecklistItem[]; // checklist de documentação
  /**
   * Responsável deste passo. Vazio = herda do objetivo, depois da fase, depois
   * do responsável processual do lead (src/lib/popResponsavel.ts).
   */
  assigneeId?: string | null;
  /**
   * Registro do que foi feito antes de o POP mudar: guarda o id do passo
   * ATUAL que substituiu este. Persiste no banco. Item com supersededBy é
   * histórico — não é marcável e não entra em progresso/conclusão.
   */
  supersededBy?: string;
  // Selos de EXIBIÇÃO do passo já marcado quando o POP muda depois:
  // 'alterado' = continua no POP com outro conteúdo, 'removido' = saiu do POP.
  // Calculados a cada load (src/lib/syncChecklistInstances.ts) e nunca gravados.
  popChange?: 'alterado' | 'removido';
  popNewLabel?: string;
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
  /** Responsável do objetivo nesta fase deste POP; herda para os passos. */
  assignee_id?: string | null;
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
  const { user } = useAuthContext();
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

  const createTemplate = async (template: Partial<ChecklistTemplate>, { silent = false }: { silent?: boolean } = {}) => {
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
      if (!silent) toast.success('Checklist criado!');
      fetchTemplates();
      return data;
    } catch (error) {
      console.error('Error creating checklist:', error);
      if (!silent) toast.error('Erro ao criar checklist');
      throw error;
    }
  };

  const updateTemplate = async (id: string, updates: Partial<ChecklistTemplate>, { silent = false }: { silent?: boolean } = {}) => {
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
      if (!silent) toast.success('Checklist atualizado!');
      fetchTemplates();
    } catch (error) {
      console.error('Error updating checklist:', error);
      if (!silent) toast.error('Erro ao atualizar checklist');
      throw error;
    }
  };

  const deleteTemplate = async (id: string, { silent = false }: { silent?: boolean } = {}) => {
    try {
      const { error } = await supabase
        .from('checklist_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;
      if (!silent) toast.success('Checklist removido!');
      fetchTemplates();
    } catch (error) {
      console.error('Error deleting checklist:', error);
      if (!silent) toast.error('Erro ao remover checklist');
    }
  };

  // Stage Links
  const fetchStageLinks = async (boardId: string) => {
    const { data, error } = await supabase
      .from('checklist_stage_links')
      .select('*')
      .eq('board_id', boardId)
      .order('display_order')
      .order('created_at');

    if (error) {
      console.error('Error fetching stage links:', error);
      return [];
    }
    return (data || []) as ChecklistStageLink[];
  };

  const linkChecklistToStage = async (templateId: string, boardId: string, stageId: string, { silent = false, displayOrder, assigneeId }: { silent?: boolean; displayOrder?: number; assigneeId?: string | null } = {}) => {
    try {
      const { error } = await supabase
        .from('checklist_stage_links')
        .insert({
          checklist_template_id: templateId,
          board_id: boardId,
          stage_id: stageId,
          ...(displayOrder !== undefined ? { display_order: displayOrder } : {}),
          // Responsável do objetivo NESTA fase deste POP. O template é
          // reaproveitável entre POPs, então o responsável mora no vínculo.
          ...(assigneeId !== undefined ? { assignee_id: assigneeId } : {}),
        } as never);

      if (error) {
        if (error.code === '23505') {
          if (!silent) toast.info('Checklist já vinculado a esta fase');
          return;
        }
        throw error;
      }
      if (!silent) toast.success('Checklist vinculado!');
    } catch (error) {
      console.error('Error linking checklist:', error);
      if (!silent) toast.error('Erro ao vincular checklist');
      throw error;
    }
  };

  const unlinkChecklistFromStage = async (linkId: string, { silent = false }: { silent?: boolean } = {}) => {
    try {
      const { error } = await supabase
        .from('checklist_stage_links')
        .delete()
        .eq('id', linkId);

      if (error) throw error;
    } catch (error) {
      console.error('Error unlinking checklist:', error);
      if (!silent) toast.error('Erro ao desvincular checklist');
      throw error;
    }
  };

  const updateStageLinkOrder = async (linkId: string, displayOrder: number) => {
    const { error } = await supabase
      .from('checklist_stage_links')
      .update({ display_order: displayOrder })
      .eq('id', linkId);

    if (error) console.error('Error updating stage link order:', error);
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

    // O SELECT acima não protege contra corrida: duas abas no mesmo lead passam
    // por ele antes de qualquer INSERT e ambas inserem. Tolerar a colisão aqui
    // permite criar o índice único depois sem quebrar esta chamada.
    try {
      const { skipped } = await insertChecklistInstancesTolerant(supabase, newInstances);
      if (skipped > 0) {
        console.warn(`[useChecklists] ${skipped} instância(s) já existiam — corrida entre abas, ignoradas`);
      }
    } catch (error) {
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

  // Retorna false quando o usuário cancelou na caixa de timing — nesse caso
  // NADA é gravado e quem chamou deve descartar a atualização otimista.
  const updateInstanceItem = async (instanceId: string, items: ChecklistItem[]): Promise<boolean> => {
    const allChecked = items.every(i => i.checked);

    // Captura o estado anterior para logar SÓ os passos recém-marcados (progresso por pessoa).
    let prevItems: ChecklistItem[] = [];
    try {
      const { data: prev } = await supabase
        .from('lead_checklist_instances')
        .select('items')
        .eq('id', instanceId)
        .maybeSingle();
      prevItems = ((prev?.items as unknown as ChecklistItem[]) || []);
    } catch { /* segue sem log se não conseguir ler o anterior */ }

    // Passos recém-marcados: pergunta o timing ANTES de gravar, pra que
    // "Cancelar" não deixe rastro (nem checked, nem status do POP).
    const prevById = new Map(prevItems.map(p => [p.id, !!p.checked]));
    const newlyChecked = items.filter(it => it.checked && !prevById.get(it.id));

    // Sub-item do passo é CONDIÇÃO, não pontuação: passo com item de checklist
    // em aberto não fecha (ver src/lib/stepSubitems.ts). Devolver false faz quem
    // chamou descartar a marcação otimista — nada é gravado nem logado.
    const blocked = newlyChecked.filter(isStepBlockedBySubItems);
    if (blocked.length > 0) {
      toast.info(pendingSubItemsMessage(blocked[0]));
      return false;
    }

    let retroactive = false;
    if (newlyChecked.length > 0 && user?.id) {
      const timing = await askStepTiming(newlyChecked.length);
      if (timing === 'cancel') return false;
      retroactive = timing === 'before';
    }

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
      return false;
    }

    // #8: registra os passos recém-marcados via RPC (grava em user_activity_log no Externo).
    // Fire-and-forget: não bloqueia a UI e não quebra o fluxo se falhar.
    if (user?.id) {
      if (newlyChecked.length > 0) {
        const userId = user.id;

        // Status do POP por passo: se algum passo recém-marcado tiver "Definir
        // status", aplica no lead (pop_result_id + data de hoje) e loga (alimenta o
        // ranking). A resposta escolhida (setStatusId dela) vence o status do passo.
        // Vale o último passo marcado que define status.
        const effectiveStatusId = (it: ChecklistItem): string | undefined => {
          const ans = it.answers?.find(a => a.id === it.selectedAnswerId);
          return ans?.setStatusId || it.setStatusId;
        };
        const statusId = [...newlyChecked].reverse().map(effectiveStatusId).find(Boolean);
        if (statusId) {
          const setStatusId = statusId;
          (async () => {
            try {
              const { data: inst } = await supabase
                .from('lead_checklist_instances')
                .select('lead_id, board_id')
                .eq('id', instanceId)
                .maybeSingle();
              const leadId = (inst as { lead_id?: string; board_id?: string } | null)?.lead_id;
              if (!leadId) return;
              const { data: lead } = await supabase
                .from('leads')
                .select('pop_result_id')
                .eq('id', leadId)
                .maybeSingle();
              const from = (lead as { pop_result_id?: string | null } | null)?.pop_result_id ?? null;
              if (from === setStatusId) return;
              const today = new Date().toISOString().slice(0, 10);
              await supabase.from('leads').update({ pop_result_id: setStatusId, pop_result_date: today } as never).eq('id', leadId);
              (supabase as any).rpc('log_pop_result_change', {
                p_user_id: userId,
                p_lead_id: leadId,
                p_board_id: (inst as { board_id?: string } | null)?.board_id ?? null,
                p_from: from,
                p_to: setStatusId,
                p_date: today,
              }).then((res: { error?: { message?: string } | null }) => {
                if (res?.error) console.warn('[useChecklists] log status POP falhou:', res.error.message);
              });
            } catch (e) {
              console.warn('[useChecklists] aplicar status POP falhou:', e);
            }
          })();
        }

        // Timing já foi respondido lá em cima (antes de gravar); aqui só loga.
        for (const it of newlyChecked) {
          // RPC nova (não está nos tipos gerados) → cast local.
          (supabase as any).rpc('log_checklist_step', {
            p_user_id: userId,
            p_instance_id: instanceId,
            p_item_label: it.label,
            p_retroactive: retroactive,
          }).then((res: { error?: { message?: string } | null }) => {
            if (res?.error) console.warn('[useChecklists] log de passo falhou:', res.error.message);
          });
        }
      }
    }

    return true;
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
    updateStageLinkOrder,
    fetchLeadInstances,
    createLeadInstances,
    markStageInstancesReadonly,
    updateInstanceItem,
  };
};
