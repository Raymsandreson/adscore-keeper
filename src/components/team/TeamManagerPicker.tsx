import { useEffect, useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Crown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface TeamManagerPickerProps {
  teamId: string;
  teamName: string;
  members: { user_id: string; full_name: string | null; email: string | null }[];
}

/**
 * Define o gestor do time. Grava em team_managers no Supabase Externo
 * (chaveado por nome do time) — é o que o relatório diário do Railway lê.
 */
export function TeamManagerPicker({ teamId, teamName, members }: TeamManagerPickerProps) {
  const [managerId, setManagerId] = useState<string>('none');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data } = await (externalSupabase.from('team_managers') as any)
          .select('manager_user_id')
          .eq('team_name', teamName)
          .maybeSingle();
        if (!cancelled) setManagerId(data?.manager_user_id || 'none');
      } catch (e) {
        console.error('[TeamManagerPicker] Failed to load manager:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamName]);

  const handleChange = async (value: string) => {
    const previous = managerId;
    setManagerId(value);
    setSaving(true);
    try {
      await ensureExternalSession();

      if (value === 'none') {
        // Zera o gestor mas preserva a linha (mantém o setor do time)
        const { error } = await (externalSupabase.from('team_managers') as any).upsert({
          team_name: teamName,
          team_id: teamId,
          manager_user_id: null,
          manager_name: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'team_name' });
        if (error) throw error;
        toast.success('Gestor removido — time sai do relatório diário');
        return;
      }

      const member = members.find(m => m.user_id === value);
      const { error } = await (externalSupabase.from('team_managers') as any).upsert({
        team_name: teamName,
        team_id: teamId,
        manager_user_id: value,
        manager_name: member?.full_name || member?.email || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'team_name' });
      if (error) throw error;
      toast.success(`Gestor definido: ${member?.full_name || member?.email}`);
    } catch (e) {
      console.error('[TeamManagerPicker] Failed to save manager:', e);
      setManagerId(previous);
      toast.error('Erro ao salvar gestor do time');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pt-2 border-t">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium py-1 mb-1">
        <Crown className="h-3.5 w-3.5 text-amber-500" />
        Gestor do time
        {(loading || saving) && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
      <Select value={managerId} onValueChange={handleChange} disabled={loading || saving}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Selecionar gestor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sem gestor (fora do relatório diário)</SelectItem>
          {members.map(m => (
            <SelectItem key={m.user_id} value={m.user_id}>
              {m.full_name || m.email || 'Sem nome'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground mt-1">
        Recebe o relatório diário do time (18h) no chat interno, junto com o diretor.
      </p>
    </div>
  );
}
