/**
 * Botão "Abrir conversa WA" no header do LeadEditDialog.
 * - Só aparece se o lead tem telefone E o usuário logado tem acesso
 *   à instância de WhatsApp em que esse telefone conversa.
 * - Resolve a instância buscando a mensagem mais recente do telefone
 *   (Externo) e cruza com getMyAllowedInstanceIds (Cloud).
 * - Click → navega para /whatsapp?openChat=<phone> (deep link já existente).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db, authClient } from '@/integrations/supabase';
import { getMyAllowedInstanceIds } from '@/integrations/supabase/permissions';

interface Props {
  leadPhone?: string | null;
}

export function OpenWhatsAppLeadButton({ leadPhone }: Props) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const phone = (leadPhone || '').replace(/\D/g, '');
      if (!phone || phone.length < 8) return;

      try {
        // 1) Última mensagem desse telefone → descobre instance_name
        const last8 = phone.slice(-8);
        const { data: msg } = await db
          .from('whatsapp_messages')
          .select('instance_name')
          .ilike('phone', `%${last8}`)
          .not('instance_name', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const instanceName = (msg as any)?.instance_name as string | undefined;
        if (!instanceName) return;

        // 2) Pega user atual e instâncias permitidas
        const { data: { user } } = await authClient.auth.getUser();
        if (!user) return;
        const allowedIds = await getMyAllowedInstanceIds(user.id);
        if (!allowedIds.length) return;

        // 3) Resolve instance_name das instâncias permitidas no Externo
        const { data: instRows } = await db
          .from('whatsapp_instances')
          .select('instance_name')
          .in('id', allowedIds);

        const allowedNames = new Set(
          (instRows || [])
            .map((r: any) => (r.instance_name || '').toLowerCase())
            .filter(Boolean),
        );

        if (!cancelled && allowedNames.has(instanceName.toLowerCase())) {
          setVisible(true);
        }
      } catch (err) {
        // silencioso — botão só some
        console.warn('[OpenWhatsAppLeadButton] skipped:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [leadPhone]);

  if (!visible) return null;

  const handleClick = () => {
    const phone = (leadPhone || '').replace(/\D/g, '');
    if (!phone) return;
    navigate(`/whatsapp?openChat=${encodeURIComponent(phone)}`);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1 h-7 text-xs"
      onClick={handleClick}
      title="Abrir conversa no WhatsApp"
    >
      <MessageCircle className="h-3 w-3 text-emerald-600" />
      Conversa WA
    </Button>
  );
}
