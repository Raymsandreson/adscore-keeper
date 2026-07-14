import { useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export interface OrgSector {
  name: string;
  manager_user_id: string | null;
  manager_name: string | null;
  nucleo_name?: string | null;
}

interface Person {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface SectorManagerProps {
  sectors: OrgSector[];
  people: Person[];
  nucleos?: { name: string }[];
  onChanged: () => void;
}

/**
 * Setores — agrupam times (Diretoria → Setor → Time → Membros).
 * Grava em org_sectors no Supabase Externo. O gerente do setor entra nos
 * grupos de relatório diário de todos os times do setor.
 */
export function SectorManager({ sectors, people, nucleos = [], onChanged }: SectorManagerProps) {
  const setSectorNucleo = async (name: string, nucleoName: string) => {
    setSaving(true);
    try {
      await ensureExternalSession();
      const { error } = await ((externalSupabase as any).from('org_sectors') as any)
        .update({ nucleo_name: nucleoName === 'none' ? null : nucleoName })
        .eq('name', name);
      if (error) throw error;
      toast.success(nucleoName === 'none' ? 'Setor sem núcleo' : `Setor no núcleo "${nucleoName}"`);
      onChanged();
    } catch (e) {
      console.error('[SectorManager] Failed to set nucleo:', e);
      toast.error('Erro ao vincular núcleo');
    } finally {
      setSaving(false);
    }
  };
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const createSector = async () => {
    const name = newName.trim();
    if (!name) return;
    if (sectors.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Já existe um setor com esse nome');
      return;
    }
    setSaving(true);
    try {
      await ensureExternalSession();
      const { error } = await ((externalSupabase as any).from('org_sectors') as any).insert({ name });
      if (error) throw error;
      setNewName('');
      toast.success(`Setor "${name}" criado`);
      onChanged();
    } catch (e) {
      console.error('[SectorManager] Failed to create sector:', e);
      toast.error('Erro ao criar setor');
    } finally {
      setSaving(false);
    }
  };

  const deleteSector = async (name: string) => {
    setSaving(true);
    try {
      await ensureExternalSession();
      // Desvincula os times antes de excluir o setor
      await ((externalSupabase as any).from('team_managers') as any)
        .update({ sector_name: null })
        .eq('sector_name', name);
      const { error } = await ((externalSupabase as any).from('org_sectors') as any)
        .delete()
        .eq('name', name);
      if (error) throw error;
      toast.success(`Setor "${name}" excluído — times ficaram sem setor`);
      onChanged();
    } catch (e) {
      console.error('[SectorManager] Failed to delete sector:', e);
      toast.error('Erro ao excluir setor');
    } finally {
      setSaving(false);
    }
  };

  const setSectorManager = async (name: string, userId: string) => {
    setSaving(true);
    try {
      await ensureExternalSession();
      const person = userId === 'none' ? null : people.find(p => p.user_id === userId);
      const { error } = await ((externalSupabase as any).from('org_sectors') as any)
        .update({
          manager_user_id: userId === 'none' ? null : userId,
          manager_name: person ? (person.full_name || person.email) : null,
        })
        .eq('name', name);
      if (error) throw error;
      toast.success(person ? `Gerente do setor: ${person.full_name || person.email}` : 'Gerente do setor removido');
      onChanged();
    } catch (e) {
      console.error('[SectorManager] Failed to set sector manager:', e);
      toast.error('Erro ao definir gerente do setor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          Setores
          <Badge variant="secondary">{sectors.length}</Badge>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
        <CardDescription>
          Agrupam os times (Diretoria → Setor → Time). O gerente do setor recebe o relatório diário de todos os times dele.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sectors.map(s => (
          <div key={s.name} className="flex items-center gap-2 p-2 rounded-md bg-muted/50 flex-wrap">
            <span className="text-sm font-medium flex-1 min-w-0 truncate">{s.name}</span>
            {nucleos.length > 0 && (
              <Select value={s.nucleo_name || 'none'} onValueChange={(v) => setSectorNucleo(s.name, v)} disabled={saving}>
                <SelectTrigger className="h-7 text-xs w-44"><SelectValue placeholder="Núcleo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem núcleo</SelectItem>
                  {nucleos.map(n => (
                    <SelectItem key={n.name} value={n.name}>{n.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={s.manager_user_id || 'none'}
              onValueChange={(v) => setSectorManager(s.name, v)}
              disabled={saving}
            >
              <SelectTrigger className="h-7 text-xs w-56">
                <SelectValue placeholder="Gerente do setor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem gerente de setor</SelectItem>
                {people.map(p => (
                  <SelectItem key={p.user_id} value={p.user_id}>
                    {p.full_name || p.email || 'Sem nome'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => deleteSector(s.name)}
              disabled={saving}
              title="Excluir setor"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createSector(); }}
            placeholder="Novo setor (ex: Acolhimento, Processual, Marketing)"
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8 shrink-0" onClick={createSector} disabled={saving || !newName.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Criar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
