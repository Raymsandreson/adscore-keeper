import { useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Landmark, Loader2 } from 'lucide-react';
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
  const [saving, setSaving] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    try { await ensureExternalSession(); await fn(); onChanged(); }
    catch (e) { console.error('[NucleoManager]', e); toast.error('Erro ao salvar núcleo'); }
    finally { setSaving(false); }
  };

  // Núcleos oficiais vêm do Ecossistema; aqui só gravamos o gerente (upsert por nome)
  const setManager = (name: string, userId: string) => run(async () => {
    const person = userId === 'none' ? null : people.find(p => p.user_id === userId);
    const { error } = await ((externalSupabase as any).from('org_nucleos') as any).upsert({
      name,
      manager_user_id: userId === 'none' ? null : userId,
      manager_name: person ? (person.full_name || person.email) : null,
    }, { onConflict: 'name' });
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
          Núcleos vêm do Ecossistema do Grupo (criar/editar lá). Aqui você define o gerente de cada núcleo — ele recebe o relatório de todos os times dos setores do núcleo.
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
          </div>
        ))}
        {nucleos.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhum núcleo ativo no Ecossistema do Grupo.</p>
        )}
      </CardContent>
    </Card>
  );
}
