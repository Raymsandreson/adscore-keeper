import { WhatsAppSettingsPage } from '@/components/whatsapp/WhatsAppSettingsPage';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialTab = params.get('tab') || 'instances';
  return <WhatsAppSettingsPage onBack={() => navigate(-1)} initialTab={initialTab} />;
}
