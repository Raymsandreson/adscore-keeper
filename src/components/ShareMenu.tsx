import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Share2, Link2, MessageSquare, Check } from 'lucide-react';
import { toast } from 'sonner';

type EntityType = 'contact' | 'lead' | 'activity' | 'workflow' | 'routine' | 'post';

interface ShareMenuProps {
  entityType: EntityType;
  entityId: string;
  entityName?: string;
  /** Extra summary text for WhatsApp message */
  summary?: string;
  size?: 'sm' | 'icon' | 'default';
  variant?: 'ghost' | 'outline' | 'default';
  className?: string;
}

const entityLabels: Record<EntityType, string> = {
  contact: 'Contato',
  lead: 'Lead',
  activity: 'Atividade',
  workflow: 'Fluxo',
  routine: 'Rotina',
  post: 'Postagem',
};

function buildShareUrl(entityType: EntityType, entityId: string): string {
  const base = window.location.origin;
  switch (entityType) {
    case 'contact':
      return `${base}/leads?tab=contacts&openContact=${entityId}`;
    case 'lead':
      return `${base}/leads?id=${entityId}`;
    case 'activity':
      return `${base}/?openActivity=${entityId}`;
    case 'workflow':
      return `${base}/workflow-progress?leadId=${entityId}`;
    case 'routine':
      return `${base}/team?tab=routines&memberId=${entityId}`;
    case 'post':
      return `${base}/?openPost=${entityId}`;
    default:
      return base;
  }
}

export function ShareMenu({ entityType, entityId, entityName, summary, size = 'icon', variant = 'ghost', className }: ShareMenuProps) {
  const [copied, setCopied] = useState(false);

  const url = buildShareUrl(entityType, entityId);
  const label = entityLabels[entityType];
  const displayName = entityName || label;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copiado!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar o link');
    }
  };

  const handleSendWhatsApp = () => {
    const text = summary
      ? `${label}: *${displayName}*\n${summary}\n\n${url}`
      : `${label}: *${displayName}*\n${url}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className} title={`Compartilhar ${label}`}>
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Share2 className="h-3.5 w-3.5" />}
          {size !== 'icon' && <span className="ml-1">Compartilhar</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleCopyLink}>
          <Link2 className="h-4 w-4 mr-2" />
          Copiar link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSendWhatsApp}>
          <MessageSquare className="h-4 w-4 mr-2" />
          Enviar via WhatsApp
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
