import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ActivityMessageTemplate {
  id: string;
  board_id: string | null;
  workflow_id: string | null;
  name: string;
  template_content: string;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_TEMPLATE = `*Boa tarde Sr(a). {{lead_name}}*

*Assunto da atividade:* {{titulo}}

{{lead_name ? 'Referente ao caso de ' + lead_name : ''}}

{{campos_dinamicos}}

{{responsavel_dr ? responsavel_dr + ' voltará com mais informações no dia ' + data_retorno + ', até o final do dia.' : ''}}
{{tempo_dedicado}}

Estamos à disposição para quaisquer dúvidas.

🚀Avante!

Tem alguma dúvida ou precisa de uma explicação mais detalhada? Digite 1 . Se tudo está claro, digite 2.`;

export const TEMPLATE_VARIABLES = [
  { var: '{{titulo}}', label: 'Título da atividade' },
  { var: '{{lead_name}}', label: 'Nome do lead' },
  { var: '{{campos_dinamicos}}', label: 'Campos configurados (O que foi feito, etc.)' },
  { var: '{{responsavel}}', label: 'Nome completo do responsável' },
  { var: '{{responsavel_dr}}', label: 'Nome do responsável com Dr. (ex: Dr. Martin Rafael)' },
  { var: '{{data_retorno}}', label: 'Data de retorno/notificação' },
  { var: '{{criado_por}}', label: 'Nome de quem criou' },
  { var: '{{criado_em}}', label: 'Data/hora de criação' },
  { var: '{{atualizado_info}}', label: 'Info de última atualização' },
  { var: '{{tempo_dedicado}}', label: 'Tempo dedicado à atividade' },
  { var: '{{link_atividade}}', label: 'Link da atividade' },
  { var: '{{what_was_done}}', label: 'O que foi feito' },
  { var: '{{current_status}}', label: 'Como está' },
  { var: '{{next_steps}}', label: 'Próximo passo' },
  { var: '{{notes}}', label: 'Observações' },
  { var: '{{case_number}}', label: 'Número do caso' },
  { var: '{{process_number}}', label: 'Número do processo' },
];

export function useActivityMessageTemplates() {
  const [templates, setTemplates] = useState<ActivityMessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    const { data, error } = await supabase
      .from('activity_message_templates')
      .select('*')
      .order('created_at');
    
    if (!error && data) {
      setTemplates(data as ActivityMessageTemplate[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const saveTemplate = async (template: Partial<ActivityMessageTemplate> & { template_content: string }) => {
    if (template.id) {
      const { error } = await supabase
        .from('activity_message_templates')
        .update({ ...template, updated_at: new Date().toISOString() })
        .eq('id', template.id);
      if (!error) await fetchTemplates();
      return { error };
    } else {
      const { error } = await supabase
        .from('activity_message_templates')
        .insert(template);
      if (!error) await fetchTemplates();
      return { error };
    }
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase
      .from('activity_message_templates')
      .delete()
      .eq('id', id);
    if (!error) await fetchTemplates();
    return { error };
  };

  const getTemplateForContext = (boardId?: string, workflowId?: string): string => {
    // Priority: workflow-specific > board-specific > default > hardcoded
    if (workflowId) {
      const wfTemplate = templates.find(t => t.workflow_id === workflowId);
      if (wfTemplate) return wfTemplate.template_content;
    }
    if (boardId) {
      const boardTemplate = templates.find(t => t.board_id === boardId && !t.workflow_id);
      if (boardTemplate) return boardTemplate.template_content;
    }
    const defaultTemplate = templates.find(t => t.is_default);
    if (defaultTemplate) return defaultTemplate.template_content;
    return DEFAULT_TEMPLATE;
  };

  return { templates, loading, saveTemplate, deleteTemplate, getTemplateForContext, refetch: fetchTemplates, DEFAULT_TEMPLATE };
}
