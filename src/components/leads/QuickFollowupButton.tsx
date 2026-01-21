import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Plus, 
  Phone, 
  MessageSquare, 
  Mail, 
  Home, 
  Users,
  ChevronDown,
  History
} from 'lucide-react';
import { 
  useLeadFollowups, 
  FollowupType,
  FOLLOWUP_TYPE_CONFIG
} from '@/hooks/useLeadFollowups';

interface QuickFollowupButtonProps {
  leadId: string;
  followupCount?: number;
  onFollowupAdded?: () => void;
  onViewHistory?: () => void;
  variant?: 'default' | 'compact';
}

const TYPE_ICONS: Record<FollowupType, React.ReactNode> = {
  whatsapp: <MessageSquare className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  visit: <Home className="h-4 w-4" />,
  meeting: <Users className="h-4 w-4" />,
};

export function QuickFollowupButton({ 
  leadId, 
  followupCount = 0, 
  onFollowupAdded,
  onViewHistory,
  variant = 'default'
}: QuickFollowupButtonProps) {
  const { addFollowup } = useLeadFollowups();
  const [isAdding, setIsAdding] = useState(false);

  const handleQuickAdd = async (type: FollowupType) => {
    setIsAdding(true);
    try {
      await addFollowup(leadId, type);
      onFollowupAdded?.();
    } finally {
      setIsAdding(false);
    }
  };

  if (variant === 'compact') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm"
            className="h-7 px-2 gap-1"
            disabled={isAdding}
          >
            <Plus className="h-3 w-3" />
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {followupCount}
            </Badge>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(Object.keys(FOLLOWUP_TYPE_CONFIG) as FollowupType[]).map((type) => (
            <DropdownMenuItem 
              key={type}
              onClick={() => handleQuickAdd(type)}
            >
              {TYPE_ICONS[type]}
              <span className="ml-2">{FOLLOWUP_TYPE_CONFIG[type].label}</span>
            </DropdownMenuItem>
          ))}
          {onViewHistory && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onViewHistory}>
                <History className="h-4 w-4" />
                <span className="ml-2">Ver histórico</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline" 
            size="sm"
            className="gap-2"
            disabled={isAdding}
          >
            <Plus className="h-4 w-4" />
            Follow-up
            <Badge variant="secondary" className="ml-1">
              {followupCount}
            </Badge>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(Object.keys(FOLLOWUP_TYPE_CONFIG) as FollowupType[]).map((type) => (
            <DropdownMenuItem 
              key={type}
              onClick={() => handleQuickAdd(type)}
            >
              {TYPE_ICONS[type]}
              <span className="ml-2">{FOLLOWUP_TYPE_CONFIG[type].label}</span>
            </DropdownMenuItem>
          ))}
          {onViewHistory && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onViewHistory}>
                <History className="h-4 w-4" />
                <span className="ml-2">Ver histórico completo</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
