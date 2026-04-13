import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { UsersRound, ExternalLink } from 'lucide-react';

interface ContactGroup {
  group_jid: string;
  group_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_status: string | null;
}

interface ContactGroupsListProps {
  contactId: string;
  contactPhone?: string | null;
}

export function ContactGroupsList({ contactId, contactPhone }: ContactGroupsListProps) {
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!contactId) return;
    
    const fetchGroups = async () => {
      setLoading(true);
      try {
        // 1) Get groups where this contact is directly linked via whatsapp_group_id
        const { data: directGroups } = await supabase
          .from('contacts')
          .select('whatsapp_group_id')
          .eq('id', contactId)
          .single();

        const groupJids = new Set<string>();

        if (directGroups?.whatsapp_group_id) {
          groupJids.add(directGroups.whatsapp_group_id);
        }

        // 2) Also find groups where phone matches other contacts in groups
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

            phoneMatches?.forEach(m => {
              if (m.whatsapp_group_id) groupJids.add(m.whatsapp_group_id);
            });
          }
        }

        if (groupJids.size === 0) {
          setGroups([]);
          setLoading(false);
          return;
        }

        // 3) For each group JID, get lead info
        const jidArray = Array.from(groupJids);
        const { data: leadGroups } = await supabase
          .from('lead_whatsapp_groups')
          .select('group_jid, group_name, lead_id, leads(lead_name, lead_status)')
          .in('group_jid', jidArray);

        const result: ContactGroup[] = [];
        const matchedJids = new Set<string>();

        leadGroups?.forEach((lg: any) => {
          matchedJids.add(lg.group_jid);
          result.push({
            group_jid: lg.group_jid,
            group_name: lg.group_name || lg.group_jid,
            lead_id: lg.lead_id,
            lead_name: lg.leads?.lead_name || null,
            lead_status: lg.leads?.lead_status || null,
          });
        });

        // Add JIDs not found in lead_whatsapp_groups
        jidArray.forEach(jid => {
          if (!matchedJids.has(jid)) {
            result.push({
              group_jid: jid,
              group_name: jid,
              lead_id: null,
              lead_name: null,
              lead_status: null,
            });
          }
        });

        setGroups(result);
      } catch (err) {
        console.error('Error fetching contact groups:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, [contactId, contactPhone]);

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
        <p className="text-sm text-muted-foreground">
          Nenhum grupo encontrado
        </p>
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
      {groups.map((group) => (
        <div
          key={group.group_jid}
          className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
        >
          <UsersRound className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">
              {group.group_name || group.group_jid}
            </p>
            {group.lead_name && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                Lead: {group.lead_name}
              </p>
            )}
          </div>
          {group.lead_status && (
            <Badge
              variant={group.lead_status === 'closed' ? 'default' : 'secondary'}
              className="text-[10px] shrink-0"
            >
              {group.lead_status === 'closed' ? 'Fechado' : group.lead_status === 'lost' ? 'Perdido' : 'Aberto'}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}
