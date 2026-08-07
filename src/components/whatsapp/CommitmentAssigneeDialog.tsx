/**
 * "Quem cuida desta pendência?" — a mesma troca de responsável da caixa de
 * pendências, para poder aparecer também dentro da conversa.
 *
 * Os perfis vêm do Cloud e `assigned_to`/`owner_user_id` são do Externo, então
 * o casamento passa pelo remap nos dois sentidos.
 */
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { remapToCloudSync, remapToExternal } from '@/integrations/supabase/uuid-remap';

export interface AssigneeTarget {
  id: string;
  title: string;
  assigned_to?: string | null;
  owner_user_id?: string | null;
}

interface Props {
  /** Pendência em edição. `null` mantém o diálogo fechado. */
  item: AssigneeTarget | null;
  onClose: () => void;
  /** Perfis do Cloud (user_id + nome). */
  profiles: { user_id: string; full_name: string | null }[];
  /** Grava o responsável. `null` devolve ao automático (dono do caso/da conversa). */
  onSave: (extUserId: string | null) => Promise<unknown>;
}

export function CommitmentAssigneeDialog({ item, onClose, profiles, onSave }: Props) {
  const [valor, setValor] = useState('');
  const [salvando, setSalvando] = useState(false);

  const comNome = profiles.filter((p) => p.full_name);

  useEffect(() => {
    if (!item) return;
    const atualCloud = remapToCloudSync(item.assigned_to || item.owner_user_id || null);
    setValor(atualCloud && comNome.some((p) => p.user_id === atualCloud) ? atualCloud : '');
    // Só ao trocar de pendência: reabrir a lista de perfis não pode apagar a escolha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  const salvar = async (cloudId: string) => {
    if (!item) return;
    setSalvando(true);
    try {
      const extId = cloudId ? ((await remapToExternal(cloudId)) as string | null) : null;
      await onSave(extId);
      const nome = comNome.find((p) => p.user_id === cloudId)?.full_name;
      toast.success(
        cloudId
          ? `Agora é responsabilidade de ${nome || 'quem você escolheu'}`
          : 'Responsável de volta ao automático (dono do caso/da conversa)'
      );
      onClose();
    } catch {
      toast.error('Não consegui salvar o responsável.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Quem cuida desta pendência?</DialogTitle>
          <DialogDescription className="text-xs">{item?.title}</DialogDescription>
        </DialogHeader>
        <Select value={valor} onValueChange={setValor}>
          <SelectTrigger><SelectValue placeholder="Escolha a pessoa" /></SelectTrigger>
          <SelectContent>
            {comNome.map((p) => (
              <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={salvando}
            onClick={() => salvar('')}
            title="Voltar ao dono automático (responsável do caso / da conversa)"
          >
            Deixar automático
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" disabled={!valor || salvando} onClick={() => salvar(valor)}>
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Salvar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
