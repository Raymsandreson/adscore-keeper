/**
 * Dono da conversa: quem está cuidando deste papo, e como passar adiante.
 *
 * Antes disso a atribuição existia só no banco (`whatsapp_cloud_assignees`,
 * gravada quando alguém respondia) e não aparecia em lugar nenhum da tela —
 * ninguém sabia de quem era a conversa nem tinha como transferir. O resultado
 * era pendência de cliente caindo em "sem responsável definido" mesmo com uma
 * pessoa claramente cuidando do atendimento.
 *
 * Duas ações, propositalmente diferentes:
 *   - "Assumir": eu passo a ser o dono (conversa sem dono, ou tomando de quem
 *     não está mais atendendo).
 *   - "Passar para…": escolho outra pessoa da equipe.
 *
 * Grupo não entra aqui: um grupo tem vários processos e várias pessoas
 * falando, então "dono do grupo" seria uma resposta errada para a pergunta
 * certa. A atribuição em grupo é por pendência, não por conversa.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { UserCheck, UserPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { remapToCloudSync } from '@/integrations/supabase/uuid-remap';

export interface OwnerTeamOption {
  user_id: string;
  full_name: string | null;
}

interface Props {
  phone: string;
  instanceName: string | null;
  /** ID no EXTERNO de quem é dono hoje (null = conversa órfã). */
  ownerExtId: string | null;
  /** ID no EXTERNO do usuário logado, para saber se a conversa já é minha. */
  meExtId: string | null;
  /** Equipe vinda do Cloud — `user_id` é ID do Cloud. */
  teamOptions: OwnerTeamOption[];
  /** Grupo não recebe dono de conversa; o controle some. */
  isGroup?: boolean;
  onTransfer: (phone: string, instanceName: string | null, toCloudUserId: string) => Promise<boolean>;
  className?: string;
}

export function ConversationOwnerControl({
  phone, instanceName, ownerExtId, meExtId, teamOptions, isGroup, onTransfer, className,
}: Props) {
  const [abrindo, setAbrindo] = useState(false);
  const [destino, setDestino] = useState('');
  const [salvando, setSalvando] = useState(false);

  const nomePorCloudId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teamOptions) if (t.full_name) m[t.user_id] = t.full_name;
    return m;
  }, [teamOptions]);

  /** Dono vem do Externo; a lista de nomes vem do Cloud. Sem o remap, some. */
  const donoNome = useMemo(() => {
    if (!ownerExtId) return null;
    if (nomePorCloudId[ownerExtId]) return nomePorCloudId[ownerExtId];
    const cloudId = remapToCloudSync(ownerExtId);
    return (cloudId && nomePorCloudId[cloudId]) || null;
  }, [ownerExtId, nomePorCloudId]);

  const minha = !!ownerExtId && !!meExtId && ownerExtId === meExtId;

  if (isGroup) return null;

  const transferir = async (toCloudUserId: string) => {
    setSalvando(true);
    try {
      const ok = await onTransfer(phone, instanceName, toCloudUserId);
      if (ok) {
        toast.success(`Conversa com ${nomePorCloudId[toCloudUserId] || 'a equipe'}`);
        setAbrindo(false);
        setDestino('');
      } else {
        toast.error('Não consegui transferir. Tente de novo.');
      }
    } finally {
      setSalvando(false);
    }
  };

  const eu = teamOptions.find((t) => remapToCloudSync(meExtId) === t.user_id || t.user_id === meExtId);

  return (
    <>
      <div className={cn('flex items-center gap-1', className)}>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {donoNome
            ? (minha ? 'sua conversa' : `com ${donoNome.split(' ')[0]}`)
            : ownerExtId ? 'com a equipe' : 'sem dono'}
        </span>
        {!minha && eu && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] gap-1"
            disabled={salvando}
            onClick={() => transferir(eu.user_id)}
            title={ownerExtId ? 'Passar esta conversa para mim' : 'Assumir esta conversa'}
          >
            <UserCheck className="h-3 w-3" />
            Assumir
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[10px] gap-1"
          onClick={() => setAbrindo(true)}
          title="Passar esta conversa para outra pessoa"
        >
          <UserPlus className="h-3 w-3" />
          Passar
        </Button>
      </div>

      <Dialog open={abrindo} onOpenChange={setAbrindo}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Passar a conversa</DialogTitle>
            <DialogDescription>
              {donoNome
                ? `Hoje está com ${donoNome}. Quem passa a cuidar?`
                : 'Esta conversa está sem dono. Quem passa a cuidar?'}
            </DialogDescription>
          </DialogHeader>

          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger><SelectValue placeholder="Escolher pessoa" /></SelectTrigger>
            <SelectContent>
              {teamOptions
                .filter((t) => t.full_name)
                .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
                .map((t) => (
                  <SelectItem key={t.user_id} value={t.user_id}>{t.full_name}</SelectItem>
                ))}
            </SelectContent>
          </Select>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAbrindo(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={() => destino && transferir(destino)} disabled={!destino || salvando}>
              {salvando && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Passar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
