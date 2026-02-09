import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { Users, ExternalLink, Instagram, Phone, Mail } from 'lucide-react';

interface LinkedContact {
  id: string;
  contact_id: string;
  contact: {
    id: string;
    full_name: string;
    instagram_username: string | null;
    phone: string | null;
    email: string | null;
    classification: string | null;
    classifications: string[] | null;
  };
}

interface LeadLinkedContactsProps {
  leadId: string;
}

export function LeadLinkedContacts({ leadId }: LeadLinkedContactsProps) {
  const [contacts, setContacts] = useState<LinkedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('contact_leads')
        .select('id, contact_id, contacts:contact_id(id, full_name, instagram_username, phone, email, classification, classifications)')
        .eq('lead_id', leadId);

      if (!error && data) {
        const mapped = data
          .filter((d: any) => d.contacts)
          .map((d: any) => ({
            id: d.id,
            contact_id: d.contact_id,
            contact: d.contacts,
          }));
        setContacts(mapped);
      }
    } catch (err) {
      console.error('Error fetching linked contacts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (leadId) fetchContacts();
  }, [leadId]);

  const handleOpenContact = (contact: any) => {
    setSelectedContact(contact);
    setSheetOpen(true);
  };

  if (loading) {
    return (
      <div className="space-y-2 pt-4 border-t">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className="pt-4 border-t space-y-2">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" />
          Contatos Vinculados
          {contacts.length > 0 && (
            <Badge variant="secondary" className="text-xs">{contacts.length}</Badge>
          )}
        </h4>

        {contacts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            Nenhum contato vinculado a este lead.
          </p>
        ) : (
          <div className="space-y-1.5">
            {contacts.map((cl) => (
              <button
                key={cl.id}
                type="button"
                onClick={() => handleOpenContact(cl.contact)}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left"
              >
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{cl.contact.full_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {cl.contact.instagram_username && (
                      <span className="flex items-center gap-0.5">
                        <Instagram className="h-3 w-3" />
                        {cl.contact.instagram_username}
                      </span>
                    )}
                    {cl.contact.phone && (
                      <span className="flex items-center gap-0.5">
                        <Phone className="h-3 w-3" />
                        {cl.contact.phone}
                      </span>
                    )}
                    {cl.contact.email && (
                      <span className="flex items-center gap-0.5">
                        <Mail className="h-3 w-3" />
                        {cl.contact.email}
                      </span>
                    )}
                  </div>
                </div>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      <ContactDetailSheet
        contact={selectedContact}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onContactUpdated={fetchContacts}
      />
    </>
  );
}
