import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Search, Users, RefreshCw, Crown, Mail, IdCard, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface FoundGroup {
  jid: string;
  name: string | null;
  invite_link: string | null;
  participants_count: number;
  instance_name?: string;
}

interface Participant {
  phone: string;
  raw: string;
  lid?: string | null;
  is_admin?: boolean;
  name?: string | null;
  image?: string | null;
  lead_email?: string | null;
  lead_personalid?: string | null;
  lead_notes?: string | null;
  common_groups?: Array<{ name: string; jid: string }>;
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
  const [participantStats, setParticipantStats] = useState<{ enriched: number; unresolved: number }>({ enriched: 0, unresolved: 0 });

  const reset = () => {
    setStep('groups');
    setGroups([]);
    setChosenGroup(null);
    setParticipants([]);
    setSelected(new Set());
    setParticipantStats({ enriched: 0, unresolved: 0 });
  };

  const handleSearch = async (forceRefresh = false) => {
    if (!instanceName) {
      toast.error('Instância WhatsApp não definida para este lead.');
      return;
    }
    if (!hasPhone && !nameQuery.trim()) {
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
      // Remove emojis e símbolos — eles quebram o ILIKE no backend
      // (group_name e contact_name podem ou não ter o mesmo emoji).
      const cleanQuery = nameQuery
        .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\uFE0F]/gu, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanQuery) body.name_query = cleanQuery;

      const { data, error } = await supabase.functions.invoke('find-contact-groups', { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const found: FoundGroup[] = data?.groups || [];
      setGroups(found);
      if (found.length === 0) {
        toast.info(
          nameQuery.trim()
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

  const handlePickGroup = async (g: FoundGroup, refreshParticipants = false) => {
    setChosenGroup(g);
    if (!refreshParticipants) onGroupSelected(g);
    const useInstance = g.instance_name || instanceName;
    if (!useInstance) return;
    setStep('participants');
    setLoadingParticipants(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-group-participants', {
        body: { group_jid: g.jid, instance_name: useInstance, refresh: refreshParticipants },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha ao listar participantes');
      const parts: Participant[] = data.participants || [];
      setParticipants(parts);
      setSelected(new Set(parts.map((p) => p.phone)));
      setParticipantStats({ enriched: data.enriched_count || 0, unresolved: data.unresolved_count || 0 });
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
      const selectedParts = participants.filter((p) => selected.has(p.phone));
      const { data, error } = await supabase.functions.invoke('import-group-participants', {
        body: {
          lead_id: leadId,
          group_jid: chosenGroup.jid,
          group_name: chosenGroup.name,
          phones: Array.from(selected),
          participants: selectedParts,
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === 'groups' ? 'Buscar grupos do contato' : `Participantes de ${chosenGroup?.name || chosenGroup?.jid}`}
          </DialogTitle>
          <DialogDescription>
            {step === 'groups'
              ? `Busca por nome varre TODAS as instâncias conectadas. Busca por participante usa a instância ${instanceName || '(?)'}${hasPhone ? ` (${contactPhone})` : ''}.`
              : 'Escolha quem deseja importar como contato e vincular ao lead. UF/cidade são preenchidos pelo DDD.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'groups' && (
          <div className="space-y-3">
            <input
              type="text"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(false); }}
              placeholder="Nome (ou parte do nome) do grupo"
              className="w-full px-3 py-2 border rounded-md text-sm bg-background"
            />
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
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {g.instance_name ? `[${g.instance_name}] ` : ''}{g.jid}
                    </div>
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
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {selected.size} de {participants.length} selecionado(s)
                      {participantStats.enriched ? ` · ${participantStats.enriched} com nome` : ''}
                    </span>
                    {chosenGroup && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handlePickGroup(chosenGroup, true)}
                        disabled={loadingParticipants || importing}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar dados
                      </Button>
                    )}
                  </div>
                </div>
                {participantStats.unresolved > 0 && (
                  <div className="text-xs text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
                    {participantStats.unresolved} participante(s) vieram da API apenas como ID interno, sem telefone público. Clique em Atualizar dados para forçar nova leitura pela instância.
                  </div>
                )}
                <div className="max-h-[28rem] overflow-y-auto border rounded-md divide-y">
                  {participants.map((p) => {
                    const initials = (p.name || p.phone).slice(0, 2).toUpperCase();
                    return (
                      <label
                        key={p.phone}
                        className="flex items-start gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                      >
                        <Checkbox
                          className="mt-1"
                          checked={selected.has(p.phone)}
                          onCheckedChange={() => toggle(p.phone)}
                        />
                        <Avatar className="h-9 w-9 shrink-0">
                          {p.image ? <AvatarImage src={p.image} alt={p.name || p.phone} /> : null}
                          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm truncate">
                              {p.name || `+${p.phone}`}
                            </span>
                            {p.is_admin && (
                              <Badge variant="secondary" className="text-[10px] gap-1">
                                <Crown className="h-3 w-3" /> admin
                              </Badge>
                            )}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground">+{p.phone}</div>
                          {(p.lead_email || p.lead_personalid) && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {p.lead_email && (
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="h-3 w-3" /> {p.lead_email}
                                </span>
                              )}
                              {p.lead_personalid && (
                                <span className="inline-flex items-center gap-1">
                                  <IdCard className="h-3 w-3" /> {p.lead_personalid}
                                </span>
                              )}
                            </div>
                          )}
                          {p.common_groups && p.common_groups.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {p.common_groups.slice(0, 4).map((g) => (
                                <a
                                  key={g.jid}
                                  href={`https://wa.me/${g.jid.replace(/@.*/, '')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] hover:bg-muted/70"
                                  title={g.jid}
                                >
                                  <Users className="h-3 w-3" />
                                  <span className="truncate max-w-[110px]">{g.name}</span>
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              ))}
                              {p.common_groups.length > 4 && (
                                <span className="text-[10px] text-muted-foreground self-center">
                                  +{p.common_groups.length - 4}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
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
