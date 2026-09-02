import { WhatsAppInbox } from '@/components/whatsapp/WhatsAppInbox';

export default function WhatsAppApiConversasPage() {
  // `lockInstanceName` com um nome de linha Cloud trava a caixa no CANAL Cloud,
  // não naquela linha: o hook expande para todas as linhas Cloud e o seletor da
  // barra escolhe entre elas. Por isso o nome aqui é só um marcador de canal.
  return <WhatsAppInbox lockInstanceName="abraci" chrome="minimal" backTo="/whatsapp-api/config" />;
}
