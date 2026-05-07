import { useEffect, useState } from 'react';
import { ZapSignDocumentDialog } from './ZapSignDocumentDialog';
import { onZapSignOpen, type ZapSignOpenPayload } from '@/lib/zapsignDialogEvent';

/**
 * Host global do ZapSignDocumentDialog.
 * Fica montado em um pai estável (WhatsAppInbox) e escuta eventos
 * 'zapsign:open' para abrir o dialog. Dessa forma o popup sobrevive
 * a remounts do WhatsAppChat (ex: quando a lista de conversas atualiza).
 */
export function ZapSignDialogHost() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<ZapSignOpenPayload | null>(null);

  useEffect(() => {
    return onZapSignOpen((p) => {
      setPayload(p);
      setOpen(true);
    });
  }, []);

  if (!payload) return null;

  return (
    <ZapSignDocumentDialog
      open={open}
      onOpenChange={setOpen}
      phone={payload.phone}
      contactName={payload.contactName}
      contactId={payload.contactId}
      leadId={payload.leadId}
      legalCaseId={payload.legalCaseId}
      instanceName={payload.instanceName}
      messages={payload.messages || []}
      leadData={payload.leadData}
      contactData={payload.contactData}
      onSendMessage={payload.onSendMessage}
    />
  );
}
