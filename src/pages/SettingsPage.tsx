import { WhatsAppSettingsPage } from '@/components/whatsapp/WhatsAppSettingsPage';
import { useNavigate } from 'react-router-dom';

export default function SettingsPage() {
  const navigate = useNavigate();
  return <WhatsAppSettingsPage onBack={() => navigate(-1)} />;
}
