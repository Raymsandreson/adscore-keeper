import { WhatsAppInbox } from '@/components/whatsapp/WhatsAppInbox';

export default function WhatsAppApiConversasPage() {
  return <WhatsAppInbox lockInstanceName="cloud_gerencia" chrome="minimal" backTo="/whatsapp-api/config" />;
}
