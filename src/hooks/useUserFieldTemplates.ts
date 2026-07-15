import { useCallback, useEffect, useState } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import type { TemplateVariation } from './useChecklists';
import { toast } from 'sonner';

/**
 * Modelos padrão por campo — carregados automaticamente para TODOS os usuários
 * quando ainda não têm nenhum modelo próprio para aquele campo. Usam as variáveis
 * dinâmicas de `useActivityMessageTemplates` para puxar dados do lead/processo
 * automaticamente. Assim que o usuário cria/edita o primeiro modelo próprio,
 * os padrões deixam de aparecer (a lista dele passa a mandar).
 */
const p = (s: string) => `<p>${s}</p>`;

const DEFAULT_FIELD_TEMPLATES: Record<string, TemplateVariation[]> = {
  current_status: [
    {
      id: 'default:current_status:1',
      name: 'Aguardando análise',
      content: p('O pedido de {{titulo}} foi protocolado{{case_number ? " (Caso nº " + case_number + ")" : ""}}. No momento, está em análise pelo órgão responsável e seguimos monitorando o andamento.'),
    },
    {
      id: 'default:current_status:2',
      name: 'Em andamento no judiciário',
      content: p('O processo{{process_number ? " nº " + process_number : ""}} está em curso. Estamos acompanhando cada movimentação e agiremos assim que houver decisão ou intimação.'),
    },
  ],
  what_was_done: [
    {
      id: 'default:what_was_done:1',
      name: 'Protocolo administrativo',
      content: p('Realizamos o protocolo administrativo do pedido{{case_number ? " referente ao caso " + case_number : ""}} e anexamos toda a documentação necessária.'),
    },
    {
      id: 'default:what_was_done:2',
      name: 'Petição enviada',
      content: p('Peticionamento realizado no processo{{process_number ? " nº " + process_number : ""}}. Documento juntado aos autos com sucesso.'),
    },
  ],
  next_steps: [
    {
      id: 'default:next_steps:1',
      name: 'Acompanhar movimentação',
      content: p('Seguiremos acompanhando e monitorando o andamento do seu pedido, sempre atentos às novas movimentações. Retornaremos assim que houver novidade.'),
    },
    {
      id: 'default:next_steps:2',
      name: 'Aguardando prazo',
      content: p('Aguardamos o cumprimento do prazo legal{{data_retorno ? " (retorno previsto para " + data_retorno + ")" : ""}}. Assim que houver resposta, entraremos em contato.'),
    },
  ],
  solicitacao: [
    {
      id: 'default:solicitacao:1',
      name: 'Envio de documento',
      content: p('{{saudacao}} Sr(a). {{lead_name}}, para dar andamento{{case_number ? " ao caso " + case_number : ""}} precisamos que envie o documento solicitado o quanto antes.'),
    },
    {
      id: 'default:solicitacao:2',
      name: 'Confirmação de dados',
      content: p('{{saudacao}} Sr(a). {{lead_name}}, poderia confirmar os dados cadastrais para prosseguirmos com o pedido? É rápido e nos ajuda a evitar atrasos.'),
    },
  ],
  resposta_juizo: [
    {
      id: 'default:resposta_juizo:1',
      name: 'Decisão favorável',
      content: p('O juízo proferiu decisão favorável no processo{{process_number ? " nº " + process_number : ""}}. Já estamos preparando os próximos passos para cumprimento.'),
    },
    {
      id: 'default:resposta_juizo:2',
      name: 'Determinação de diligência',
      content: p('O juízo determinou diligência complementar no processo{{process_number ? " nº " + process_number : ""}}. Vamos providenciar o cumprimento no prazo.'),
    },
  ],
};

const isSynthetic = (id: string | undefined | null) => !!id && id.startsWith('default:');

/**
 * Modelos de texto por campo, POR USUÁRIO — independentes de lead/passo/fluxo.
 * Cada usuário vê apenas os modelos que ele mesmo cadastrou, agrupados por field_key.
 * Tabela: public.user_activity_field_templates (External DB).
 */
export function useUserFieldTemplates(fieldKey: string | null | undefined) {
  const { user } = useAuthContext();
  const userId = user?.id || null;
  const [variations, setVariations] = useState<TemplateVariation[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!fieldKey) {
      setVariations([]);
      return;
    }
    if (!userId) {
      // Usuário não logado — mostra defaults só como preview.
      setVariations(DEFAULT_FIELD_TEMPLATES[fieldKey] || []);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await externalSupabase
        .from('user_activity_field_templates' as any)
        .select('id, name, content, sort_order')
        .eq('user_id', userId)
        .eq('field_key', fieldKey)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      const userRows = ((data as any[]) || []).map(r => ({
        id: r.id,
        name: r.name || '',
        content: r.content || '',
      })) as TemplateVariation[];

      if (userRows.length === 0) {
        // Sem modelos próprios ainda → exibe os padrões do sistema.
        setVariations(DEFAULT_FIELD_TEMPLATES[fieldKey] || []);
      } else {
        setVariations(userRows);
      }
    } catch (err) {
      console.error('[useUserFieldTemplates:reload]', err);
      setVariations(DEFAULT_FIELD_TEMPLATES[fieldKey] || []);
    } finally {
      setLoading(false);
    }
  }, [userId, fieldKey]);

  useEffect(() => { reload(); }, [reload]);

  /**
   * Recebe a lista COMPLETA que deve existir para (user, field). Faz diff
   * ignorando entradas sintéticas (id `default:*`), que sempre entram como
   * novos INSERTs quando o usuário optar por editá-las/salvá-las.
   */
  const persist = useCallback(async (next: TemplateVariation[]): Promise<boolean> => {
    if (!userId || !fieldKey) {
      toast.error('Faça login para salvar modelos.');
      return false;
    }
    try {
      // Só compara com as linhas REAIS que já existem no DB (não com defaults sintéticos).
      const realPrev = variations.filter(v => !isSynthetic(v.id));
      const prevById = new Map(realPrev.map(v => [v.id, v]));
      const nextRealIds = new Set(next.filter(v => !isSynthetic(v.id)).map(v => v.id).filter(Boolean));

      // Deletes: apenas linhas reais que sumiram.
      const toDelete = realPrev.filter(v => v.id && !nextRealIds.has(v.id)).map(v => v.id!);
      if (toDelete.length > 0) {
        const { error } = await externalSupabase
          .from('user_activity_field_templates' as any)
          .delete()
          .in('id', toDelete)
          .eq('user_id', userId);
        if (error) throw error;
      }

      // Inserts e Updates
      for (let i = 0; i < next.length; i++) {
        const v = next[i];
        const prev = v.id && !isSynthetic(v.id) ? prevById.get(v.id) : undefined;
        if (!prev) {
          // Entrada nova (inclui sintéticas que o usuário decidiu salvar).
          const { error } = await externalSupabase
            .from('user_activity_field_templates' as any)
            .insert({
              user_id: userId,
              field_key: fieldKey,
              name: v.name || '',
              content: v.content || '',
              sort_order: i,
            });
          if (error) throw error;
        } else if (prev.name !== v.name || prev.content !== v.content) {
          const { error } = await externalSupabase
            .from('user_activity_field_templates' as any)
            .update({
              name: v.name || '',
              content: v.content || '',
              sort_order: i,
              updated_at: new Date().toISOString(),
            })
            .eq('id', v.id!)
            .eq('user_id', userId);
          if (error) throw error;
        }
      }

      await reload();
      return true;
    } catch (err) {
      console.error('[useUserFieldTemplates:persist]', err);
      toast.error('Erro ao salvar modelo.');
      return false;
    }
  }, [userId, fieldKey, variations, reload]);

  return { variations, loading, persist, canPersist: !!userId, reload };
}
