import { useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OrgSector } from './SectorManager';

interface TeamSectorPickerProps {
  teamId: string;
  teamName: string;
  sectors: OrgSector[];
  currentSector: string | null;
  onChanged: () => void;
}

/** Vincula o time a um setor (team_managers.sector_name no Externo). */
export function TeamSectorPicker({ teamId, teamName, sectors, currentSector, onChanged }: TeamSectorPickerProps) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (value: string) => {
    setSaving(true);
    try {
      await ensureExternalSession();
      const sectorName = value === 'none' ? null : value;
      // Upsert por team_name atualiza só as colunas enviadas — não mexe no gestor
      const { error } = await (externalSupabase.from('team_managers') as any).upsert({
        team_name: teamName,
        team_id: teamId,
        sector_name: sectorName,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'team_name' });
      if (error) throw error;
      toast.success(sectorName ? `Time no setor "${sectorName}"` : 'Time sem setor');
      onChanged();
    } catch (e) {
      console.error('[TeamSectorPicker] Failed to set sector:', e);
      toast.error('Erro ao definir setor do time');
    } finally {
      setSaving(false);
    }
  };

  if (sectors.length === 0) return null;

  return (
    <div className="pt-2 border-t">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium py-1 mb-1">
        <Building2 className="h-3.5 w-3.5 text-primary" />
        Setor
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
      <Select value={currentSector || 'none'} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Selecionar setor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sem setor</SelectItem>
          {sectors.map(s => (
            <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
