import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Search, Users, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface FoundGroup {
  jid: string;
  name: string | null;
  invite_link: string | null;
  participants_count: number;
}

interface Participant {
  phone: string;
  raw: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  contactPhone: string | undefined;
  instanceName: string | undefined;
  /** Nome do lead — usado como fallback de busca quando não há telefone de contato. */
  leadName?: string;
  /** Callback when user picks a group (to write back into the form). */
  onGroupSelected: (group: FoundGroup) => void;
}

type Step = 'groups' | 'participants';

export function LeadGroupSearchDialog({
  open,
  onOpenChange,
  leadId,
  contactPhone,
  instanceName,
  leadName,
  onGroupSelected,
}: Props) {
  const hasPhone = !!contactPhone;
  const [nameQuery, setNameQuery] = useState<string>(leadName || '');
  const [step, setStep] = useState<Step>('groups');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groups, setGroups] = useState<FoundGroup[]>([]);
  const [chosenGroup, setChosenGroup] = useState<FoundGroup | null>(null);

  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setStep('groups');
    setGroups([]);
    setChosenGroup(null);
    setParticipants([]);
    setSelected(new Set());
  };

  const handleSearch = async (forceRefresh = false) => {
    if (!instanceName) {
      toast.error('Instância WhatsApp não definida para este lead.');
      return;
    }
    const usingName = !hasPhone;
    if (usingName && !nameQuery.trim()) {
      toast.error('Informe um nome para buscar (ex: nome do lead).');
      return;
    }
    setLoadingGroups(true);
    try {
      const body: Record<string, unknown> = {
        instance_name: instanceName,
        force_refresh: forceRefresh,
      };
      if (hasPhone) body.phone = contactPhone;
      else body.name_query = nameQuery.trim();

      const { data, error } = await supabase.functions.invoke('find-contact-groups', { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const found: FoundGroup[] = data?.groups || [];
      setGroups(found);
      if (found.length === 0) {
        toast.info(
          usingName
            ? 'Nenhum grupo encontrado com esse nome.'
            : 'Nenhum grupo encontrado com esse contato como participante.',
        );
      } else {
        toast.success(`${found.length} grupo(s) encontrado(s)${data.from_cache ? ' (cache)' : ''}.`);
      }
    } catch (e: any) {
      toast.error('Erro ao buscar grupos: ' + (e.message || e));
    } finally {
      setLoadingGroups(false);
    }
  };

  const handlePickGroup = async (g: FoundGroup) => {
    setChosenGroup(g);
    onGroupSelected(g);
    if (!instanceName) return;
    setStep('participants');
    setLoadingParticipants(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-group-participants', {
        body: { group_jid: g.jid, instance_name: instanceName },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha ao listar participantes');
      const parts: Participant[] = data.participants || [];
      setParticipants(parts);
      setSelected(new Set(parts.map((p) => p.phone)));
    } catch (e: any) {
      toast.error('Erro ao listar participantes: ' + (e.message || e));
    } finally {
      setLoadingParticipants(false);
    }
  };

  const toggle = (phone: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === participants.length) setSelected(new Set());
    else setSelected(new Set(participants.map((p) => p.phone)));
  };

  const handleImport = async () => {
    if (!chosenGroup || selected.size === 0) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('import-group-participants', {
        body: {
          lead_id: leadId,
          group_jid: chosenGroup.jid,
          group_name: chosenGroup.name,
          phones: Array.from(selected),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha na importação');
      toast.success(
        `${data.created} criado(s), ${data.linked} vinculado(s)${data.skipped ? `, ${data.skipped} ignorado(s)` : ''}.`,
      );
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast.error('Erro ao importar: ' + (e.message || e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === 'groups' ? 'Buscar grupos do contato' : `Participantes de ${chosenGroup?.name || chosenGroup?.jid}`}
          </DialogTitle>
          <DialogDescription>
            {step === 'groups'
              ? hasPhone
                ? `Procura grupos da instância ${instanceName || '(?)'} em que ${contactPhone} é participante.`
                : `Lead sem telefone — buscando por nome do grupo na instância ${instanceName || '(?)'}.`
              : 'Escolha quem deseja importar como contato e vincular ao lead. UF/cidade são preenchidos pelo DDD.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'groups' && (
          <div className="space-y-3">
            {!hasPhone && (
              <input
                type="text"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(false); }}
                placeholder="Nome (ou parte do nome) do grupo"
                className="w-full px-3 py-2 border rounded-md text-sm bg-background"
              />
            )}
            <div className="flex gap-2">
              <Button
                onClick={() => handleSearch(false)}
                disabled={loadingGroups || !instanceName || (!hasPhone && !nameQuery.trim())}
              >
                {loadingGroups ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                Buscar
              </Button>
              <Button variant="outline" onClick={() => handleSearch(true)} disabled={loadingGroups}>
                <RefreshCw className="h-4 w-4 mr-2" /> Forçar atualização
              </Button>
            </div>

            <div className="max-h-80 overflow-y-auto border rounded-md divide-y">
              {groups.length === 0 && !loadingGroups && (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  Clique em "Buscar" para listar os grupos.
                </div>
              )}
              {groups.map((g) => (
                <button
                  type="button"
                  key={g.jid}
                  onClick={() => handlePickGroup(g)}
                  className="w-full text-left p-3 hover:bg-muted/50 transition flex items-center gap-3"
                >
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{g.name || '(sem nome)'}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{g.jid}</div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {g.participants_count} part.
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'participants' && (
          <div className="space-y-3">
            {loadingParticipants ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Carregando participantes...
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <button type="button" className="text-primary hover:underline" onClick={toggleAll}>
                    {selected.size === participants.length ? 'Desmarcar todos' : 'Marcar todos'}
                  </button>
                  <span className="text-muted-foreground">
                    {selected.size} de {participants.length} selecionado(s)
                  </span>
                </div>
                <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                  {participants.map((p) => (
                    <label
                      key={p.phone}
                      className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={selected.has(p.phone)}
                        onCheckedChange={() => toggle(p.phone)}
                      />
                      <span className="font-mono text-sm">{p.phone}</span>
                    </label>
                  ))}
                  {participants.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      Nenhum participante visível no cache. Tente "Forçar atualização" no passo anterior.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'participants' && (
            <Button variant="outline" onClick={() => setStep('groups')} disabled={importing}>
              Voltar
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>
            Fechar
          </Button>
          {step === 'participants' && (
            <Button onClick={handleImport} disabled={importing || selected.size === 0}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Importar {selected.size} contato(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
