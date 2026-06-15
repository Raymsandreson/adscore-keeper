import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/functionRouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UsersRound, ExternalLink, Pencil, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ContactGroup {
  group_jid: string;
  group_name: string | null;
  group_link: string | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_status: string | null;
  case_number: string | null;
}

interface ContactGroupsListProps {
  contactId: string;
  contactPhone?: string | null;
}

export function ContactGroupsList({ contactId, contactPhone }: ContactGroupsListProps) {
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);

  useEffect(() => {
    if (!contactId) return;

    const fetchGroups = async () => {
      setLoading(true);
      try {
        const { data: directGroups } = await supabase
          .from('contacts')
          .select('whatsapp_group_id')
          .eq('id', contactId)
          .single();

        const groupJids = new Set<string>();
        if (directGroups?.whatsapp_group_id) groupJids.add(directGroups.whatsapp_group_id);

        if (contactPhone) {
          const cleanPhone = contactPhone.replace(/\D/g, '');
          if (cleanPhone.length >= 8) {
            const phoneSuffix = cleanPhone.slice(-8);
            const { data: phoneMatches } = await supabase
              .from('contacts')
              .select('whatsapp_group_id')
              .not('whatsapp_group_id', 'is', null)
              .is('deleted_at', null)
              .ilike('phone', `%${phoneSuffix}%`)
              .neq('id', contactId);
            phoneMatches?.forEach((m) => {
              if (m.whatsapp_group_id) groupJids.add(m.whatsapp_group_id);
            });
          }
        }

        if (groupJids.size === 0) {
          setGroups([]);
          setLoading(false);
          return;
        }

        const jidArray = Array.from(groupJids);

        const { data: leadGroups } = await externalSupabase
          .from('lead_whatsapp_groups')
          .select('group_jid, group_name, group_link, lead_id, leads(lead_name, lead_status, case_number)')
          .in('group_jid', jidArray);

        const byJid = new Map<string, ContactGroup>();
        leadGroups?.forEach((lg: any) => {
          byJid.set(lg.group_jid, {
            group_jid: lg.group_jid,
            group_name: lg.group_name || null,
            group_link: lg.group_link || null,
            lead_id: lg.lead_id,
            lead_name: lg.leads?.lead_name || null,
            lead_status: lg.leads?.lead_status || null,
            case_number: lg.leads?.case_number || null,
          });
        });

        jidArray.forEach((jid) => {
          if (!byJid.has(jid)) {
            byJid.set(jid, {
              group_jid: jid,
              group_name: null,
              group_link: null,
              lead_id: null,
              lead_name: null,
              lead_status: null,
              case_number: null,
            });
          }
        });

        const needsName = Array.from(byJid.values())
          .filter((g) => !g.group_name)
          .map((g) => g.group_jid);

        if (needsName.length > 0) {
          const { data: msgs } = await externalSupabase
            .from('whatsapp_messages')
            .select('phone, contact_name, created_at')
            .in('phone', needsName)
            .not('contact_name', 'is', null)
            .order('created_at', { ascending: false })
            .limit(needsName.length * 5);

          const nameByJid = new Map<string, string>();
          msgs?.forEach((m: any) => {
            if (m.phone && m.contact_name && !nameByJid.has(m.phone)) {
              nameByJid.set(m.phone, String(m.contact_name).trim());
            }
          });
          nameByJid.forEach((name, jid) => {
            const g = byJid.get(jid);
            if (g) g.group_name = name;
          });
        }

        setGroups(Array.from(byJid.values()));
      } catch (err) {
        console.error('Error fetching contact groups:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, [contactId, contactPhone]);

  const startEdit = (group: ContactGroup) => {
    if (!group.lead_id) return;
    setEditingLeadId(group.lead_id);
    setEditValue(group.case_number || '');
  };

  const cancelEdit = () => {
    setEditingLeadId(null);
    setEditValue('');
  };

  const saveEdit = async (group: ContactGroup) => {
    if (!group.lead_id) return;
    const newNumber = editValue.trim();
    if (!newNumber) {
      toast.error('Informe um número');
      return;
    }
    setSavingLeadId(group.lead_id);
    try {
      const { error: upErr } = await externalSupabase
        .from('leads')
        .update({ case_number: newNumber })
        .eq('id', group.lead_id);
      if (upErr) {
        toast.error('Falha ao salvar: ' + upErr.message);
        return;
      }

      const { data, error } = await cloudFunctions.invoke<any>('regenerate-lead-name', {
        body: { lead_id: group.lead_id },
      });
      if (error || data?.success === false) {
        toast.warning('Número salvo, mas falhou ao renomear grupo: ' + (data?.error || error?.message || ''));
      } else {
        toast.success(
          `Atualizado para ${data?.lead_name || newNumber}` +
            (data?.group_renamed ? ' (grupo renomeado)' : ''),
        );
      }

      setGroups((prev) =>
        prev.map((g) =>
          g.lead_id === group.lead_id
            ? {
                ...g,
                case_number: newNumber,
                lead_name: data?.lead_name || g.lead_name,
                group_name: data?.group_renamed && data?.lead_name ? data.lead_name : g.group_name,
              }
            : g,
        ),
      );
      cancelEdit();
    } finally {
      setSavingLeadId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-8">
        <UsersRound className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">Nenhum grupo encontrado</p>
        <p className="text-xs text-muted-foreground mt-1">
          Este contato não participa de nenhum grupo
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-2">
        Participa de {groups.length} grupo(s)
      </p>
      {groups.map((group) => {
        const displayName = group.group_name || `Grupo ${group.group_jid.slice(-6)}`;
        const hasLink = !!group.group_link;
        const isClosed = group.lead_status === 'closed';
        const isEditing = editingLeadId === group.lead_id;
        const isSaving = savingLeadId === group.lead_id;
        return (
          <div
            key={group.group_jid}
            className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
          >
            <UsersRound className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              {hasLink ? (
                <a
                  href={group.group_link!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sm truncate text-primary hover:underline inline-flex items-center gap-1"
                  title={displayName}
                >
                  <span className="truncate">{displayName}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <p className="font-medium text-sm truncate" title={displayName}>
                  {displayName}
                </p>
              )}
              {group.lead_name && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  Lead: {group.lead_name}
                </p>
              )}
              {isClosed && group.lead_id && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-muted-foreground">Nº:</span>
                  {isEditing ? (
                    <>
                      <Input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(group);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        disabled={isSaving}
                        className="h-6 w-20 text-xs px-2"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => saveEdit(group)}
                        disabled={isSaving}
                      >
                        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={cancelEdit}
                        disabled={isSaving}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-mono">{group.case_number || '—'}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => startEdit(group)}
                        title="Editar número do caso"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
            {group.lead_status && (
              <Badge
                variant={group.lead_status === 'closed' ? 'default' : 'secondary'}
                className="text-[10px] shrink-0"
              >
                {group.lead_status === 'closed'
                  ? 'Fechado'
                  : group.lead_status === 'lost'
                  ? 'Perdido'
                  : 'Aberto'}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}
