import { useCallback, useEffect, useState } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import type { TemplateVariation } from './useChecklists';
import { toast } from 'sonner';

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
    if (!userId || !fieldKey) {
      setVariations([]);
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
      setVariations(
        ((data as any[]) || []).map(r => ({
          id: r.id,
          name: r.name || '',
          content: r.content || '',
        })),
      );
    } catch (err) {
      console.error('[useUserFieldTemplates:reload]', err);
      setVariations([]);
    } finally {
      setLoading(false);
    }
  }, [userId, fieldKey]);

  useEffect(() => { reload(); }, [reload]);

  /**
   * Recebe a lista COMPLETA que deve existir para (user, field). Faz diff:
   * cria os novos, atualiza os existentes que mudaram, remove os que sumiram.
   * Retorna true em sucesso.
   */
  const persist = useCallback(async (next: TemplateVariation[]): Promise<boolean> => {
    if (!userId || !fieldKey) {
      toast.error('Faça login para salvar modelos.');
      return false;
    }
    try {
      const prevById = new Map(variations.map(v => [v.id, v]));
      const nextIds = new Set(next.map(v => v.id).filter(Boolean));

      // Deletes
      const toDelete = variations.filter(v => v.id && !nextIds.has(v.id)).map(v => v.id!);
      if (toDelete.length > 0) {
        const { error } = await externalSupabase
          .from('user_activity_field_templates' as any)
          .delete()
          .in('id', toDelete)
          .eq('user_id', userId);
        if (error) throw error;
      }

      // Inserts (id novo ou não existe no prev) e Updates
      for (let i = 0; i < next.length; i++) {
        const v = next[i];
        const prev = v.id ? prevById.get(v.id) : undefined;
        if (!prev) {
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
