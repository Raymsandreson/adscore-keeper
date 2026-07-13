import { useEffect, useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Crown, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

interface Person {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface Director {
  user_id: string;
  name: string | null;
}

interface DirectorPickerProps {
  people: Person[];
}

/**
 * Diretoria — "gestores dos gestores". Grava em org_directors no Supabase
 * Externo. Diretores entram em todos os grupos de relatório diário dos times
 * e recebem o relatório consolidado "📊 Diretoria — Gestores".
 */
export function DirectorPicker({ people }: DirectorPickerProps) {
  const [directors, setDirectors] = useState<Director[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data } = await (externalSupabase.from('org_directors') as any)
          .select('user_id, name')
          .order('created_at');
        if (!cancelled) setDirectors(data || []);
      } catch (e) {
        console.error('[DirectorPicker] Failed to load directors:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const addDirector = async (userId: string) => {
    if (directors.some(d => d.user_id === userId)) return;
    const person = people.find(p => p.user_id === userId);
    const name = person?.full_name || person?.email || null;
    setSaving(true);
    try {
      await ensureExternalSession();
      const { error } = await (externalSupabase.from('org_directors') as any)
        .insert({ user_id: userId, name });
      if (error) throw error;
      setDirectors(prev => [...prev, { user_id: userId, name }]);
      toast.success(`${name || 'Diretor'} adicionado à diretoria`);
    } catch (e) {
      console.error('[DirectorPicker] Failed to add director:', e);
      toast.error('Erro ao adicionar diretor');
    } finally {
      setSaving(false);
    }
  };

  const removeDirector = async (userId: string) => {
    if (directors.length === 1) {
      toast.error('Deixe pelo menos um diretor — senão ninguém recebe o relatório da diretoria.');
      return;
    }
    setSaving(true);
    try {
      await ensureExternalSession();
      const { error } = await (externalSupabase.from('org_directors') as any)
        .delete()
        .eq('user_id', userId);
      if (error) throw error;
      setDirectors(prev => prev.filter(d => d.user_id !== userId));
      toast.success('Diretor removido');
    } catch (e) {
      console.error('[DirectorPicker] Failed to remove director:', e);
      toast.error('Erro ao remover diretor');
    } finally {
      setSaving(false);
    }
  };

  const available = people.filter(p => !directors.some(d => d.user_id === p.user_id));

  return (
    <Card className="border-amber-500/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Crown className="h-4 w-4 text-amber-500" />
          Diretoria
          {(loading || saving) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
        <CardDescription>
          Gere os gestores: entra em todos os grupos de relatório diário dos times e recebe o consolidado "📊 Diretoria — Gestores" às 18h.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {directors.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">Nenhum diretor definido.</p>
          )}
          {directors.map(d => (
            <Badge key={d.user_id} variant="secondary" className="pl-2 pr-1 py-1 gap-1 text-xs">
              <Crown className="h-3 w-3 text-amber-500" />
              {d.name || d.user_id.slice(0, 8)}
              <button
                type="button"
                onClick={() => removeDirector(d.user_id)}
                className="ml-1 p-0.5 rounded hover:bg-destructive/20"
                title="Remover da diretoria"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <Select value="" onValueChange={addDirector} disabled={loading || saving}>
          <SelectTrigger className="h-8 text-xs w-full sm:w-72">
            <SelectValue placeholder="Adicionar diretor..." />
          </SelectTrigger>
          <SelectContent>
            {available.map(p => (
              <SelectItem key={p.user_id} value={p.user_id}>
                {p.full_name || p.email || 'Sem nome'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
