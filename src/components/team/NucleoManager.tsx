import { useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Landmark, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export interface OrgNucleo {
  name: string;
  manager_user_id: string | null;
  manager_name: string | null;
}

interface Person { user_id: string; full_name: string | null; email: string | null; }

interface NucleoManagerProps {
  nucleos: OrgNucleo[];
  people: Person[];
  onChanged: () => void;
}

/** Núcleos — agrupam setores (Diretoria → Núcleo → Setor → Time). */
export function NucleoManager({ nucleos, people, onChanged }: NucleoManagerProps) {
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    try { await ensureExternalSession(); await fn(); onChanged(); }
    catch (e) { console.error('[NucleoManager]', e); toast.error('Erro ao salvar núcleo'); }
    finally { setSaving(false); }
  };

  const createNucleo = () => {
    const name = newName.trim();
    if (!name) return;
    if (nucleos.some(n => n.name.toLowerCase() === name.toLowerCase())) { toast.error('Núcleo já existe'); return; }
    run(async () => {
      const { error } = await (externalSupabase.from('org_nucleos') as any).insert({ name });
      if (error) throw error;
      setNewName('');
      toast.success(`Núcleo "${name}" criado`);
    });
  };

  const deleteNucleo = (name: string) => run(async () => {
    await (externalSupabase.from('org_sectors') as any).update({ nucleo_name: null }).eq('nucleo_name', name);
    const { error } = await (externalSupabase.from('org_nucleos') as any).delete().eq('name', name);
    if (error) throw error;
    toast.success(`Núcleo "${name}" excluído — setores ficaram sem núcleo`);
  });

  const setManager = (name: string, userId: string) => run(async () => {
    const person = userId === 'none' ? null : people.find(p => p.user_id === userId);
    const { error } = await (externalSupabase.from('org_nucleos') as any).update({
      manager_user_id: userId === 'none' ? null : userId,
      manager_name: person ? (person.full_name || person.email) : null,
    }).eq('name', name);
    if (error) throw error;
    toast.success(person ? `Gerente do núcleo: ${person.full_name || person.email}` : 'Gerente do núcleo removido');
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4 text-primary" />
          Núcleos
          <Badge variant="secondary">{nucleos.length}</Badge>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
        <CardDescription>
          Cada núcleo agrupa vários setores (Diretoria → Núcleo → Setor → Time). O gerente do núcleo recebe o relatório de todos os times dele.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {nucleos.map(n => (
          <div key={n.name} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
            <span className="text-sm font-medium flex-1 min-w-0 truncate">{n.name}</span>
            <Select value={n.manager_user_id || 'none'} onValueChange={(v) => setManager(n.name, v)} disabled={saving}>
              <SelectTrigger className="h-7 text-xs w-56"><SelectValue placeholder="Gerente do núcleo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem gerente de núcleo</SelectItem>
                {people.map(p => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email || 'Sem nome'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => deleteNucleo(n.name)} disabled={saving} title="Excluir núcleo">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createNucleo(); }}
            placeholder="Novo núcleo (ex: Jurídico, Comercial)"
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8 shrink-0" onClick={createNucleo} disabled={saving || !newName.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Criar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
