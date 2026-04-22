import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Users, ArrowDownUp } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface CloseLeadContactPayload {
  contact_id: string;
  phone: string;
  mark_as_client: boolean;
}

interface ContactRow {
  id: string;
  full_name: string;
  phone: string | null;
  classification: string | null;
  add_to_group: boolean;
  mark_as_client: boolean;
}

interface InstancePreview {
  enter: number;
  leave: number;
}

interface Props {
  open: boolean;
  leadId: string;
  boardId: string | null | undefined;
  onClose: () => void;
  onConfirm: (payload: { contacts_to_add: CloseLeadContactPayload[] }) => void;
}

export const CloseLeadGroupDialog = ({ open, leadId, boardId, onClose, onConfirm }: Props) => {
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [instancesPreview, setInstancesPreview] = useState<InstancePreview>({ enter: 0, leave: 0 });

  useEffect(() => {
    if (!open || !leadId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        // Contacts via junction
        const { data: linkData } = await supabase
          .from("contact_leads" as any)
          .select("contact_id")
          .eq("lead_id", leadId);
        const contactIds = ((linkData || []) as unknown as { contact_id: string }[]).map(l => l.contact_id);

        // Legacy
        const { data: legacy } = await supabase
          .from("contacts")
          .select("id")
          .eq("lead_id", leadId);
        const legacyIds = (legacy || []).map(c => c.id);

        const allIds = [...new Set([...contactIds, ...legacyIds])];

        let rows: ContactRow[] = [];
        if (allIds.length > 0) {
          const { data: contactsData } = await supabase
            .from("contacts")
            .select("id, full_name, phone, classification")
            .in("id", allIds);

          rows = (contactsData || []).map(c => ({
            id: c.id,
            full_name: c.full_name || "Sem nome",
            phone: c.phone,
            classification: c.classification,
            add_to_group: !!c.phone,
            mark_as_client: c.classification !== "client",
          }));
        }

        // Instances preview
        let enter = 0;
        let leave = 0;
        if (boardId) {
          const { data: bi } = await supabase
            .from("board_group_instances")
            .select("applies_to")
            .eq("board_id", boardId);
          for (const row of bi || []) {
            const a = (row as any).applies_to || "both";
            if (a === "closed") enter++;
            else if (a === "open") leave++;
          }
        }

        if (!cancelled) {
          setContacts(rows);
          setInstancesPreview({ enter, leave });
        }
      } catch (e) {
        console.error("CloseLeadGroupDialog load error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, leadId, boardId]);

  const toggle = (id: string, field: "add_to_group" | "mark_as_client", value: boolean) => {
    setContacts(prev => prev.map(c => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const addCount = contacts.filter(c => c.add_to_group && c.phone).length;

  const handleConfirm = () => {
    const payload: CloseLeadContactPayload[] = contacts
      .filter(c => (c.add_to_group && c.phone) || c.mark_as_client)
      .map(c => ({
        contact_id: c.id,
        phone: c.add_to_group && c.phone ? c.phone : "",
        mark_as_client: c.mark_as_client,
      }));
    onConfirm({ contacts_to_add: payload });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fechar lead — sincronizar grupo e contatos</DialogTitle>
          <DialogDescription>
            Escolha quais contatos vinculados ao lead devem ser adicionados ao grupo de WhatsApp e marcados como cliente.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Instances preview */}
            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium mb-1">
                <ArrowDownUp className="h-4 w-4" />
                Instâncias do grupo
              </div>
              <div className="text-muted-foreground">
                {instancesPreview.enter} entrarão · {instancesPreview.leave} sairão
              </div>
            </div>

            {/* Contacts list */}
            <div>
              <div className="flex items-center gap-2 font-medium text-sm mb-2">
                <Users className="h-4 w-4" />
                Contatos vinculados ({contacts.length})
              </div>

              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg">
                  Nenhum contato vinculado a este lead.
                </p>
              ) : (
                <ScrollArea className="max-h-[320px] border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">Contato</th>
                        <th className="px-3 py-2 font-medium">Telefone</th>
                        <th className="px-3 py-2 font-medium text-center">Add ao grupo</th>
                        <th className="px-3 py-2 font-medium text-center">Marcar cliente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map(c => (
                        <tr key={c.id} className="border-t">
                          <td className="px-3 py-2 font-medium">{c.full_name}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {c.phone || <span className="italic">sem telefone</span>}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Checkbox
                              checked={c.add_to_group}
                              disabled={!c.phone}
                              onCheckedChange={(v) => toggle(c.id, "add_to_group", !!v)}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Checkbox
                              checked={c.mark_as_client}
                              onCheckedChange={(v) => toggle(c.id, "mark_as_client", !!v)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              {addCount} contato(s) serão adicionados ao grupo.
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={loading}>Confirmar e fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
