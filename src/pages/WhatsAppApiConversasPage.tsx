import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { WhatsAppInbox } from '@/components/whatsapp/WhatsAppInbox';
import { useAuthContext } from '@/contexts/AuthContext';
import { canSeeCloudApi } from '@/lib/cloudApiAllowlist';

export default function WhatsAppApiConversasPage() {
  const { user } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !canSeeCloudApi(user.email)) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  if (user && !canSeeCloudApi(user.email)) return null;

  return <WhatsAppInbox lockInstanceName="cloud_gerencia" chrome="minimal" backTo="/whatsapp-api" />;
}
