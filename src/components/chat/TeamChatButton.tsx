import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';
import { TeamChatSheet } from './TeamChatSheet';
import { cn } from '@/lib/utils';

interface TeamChatButtonProps {
  entityType: string;
  entityId: string;
  entityName?: string;
  variant?: 'icon' | 'full';
  className?: string;
}

export function TeamChatButton({ entityType, entityId, entityName, variant = 'icon', className }: TeamChatButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === 'icon' ? (
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", className)}
          onClick={() => setOpen(true)}
          title="Chat da Equipe"
        >
          <Users className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5 text-xs", className)}
          onClick={() => setOpen(true)}
        >
          <Users className="h-3.5 w-3.5" />
          Chat Equipe
        </Button>
      )}

      <TeamChatSheet
        open={open}
        onOpenChange={setOpen}
        entityType={entityType}
        entityId={entityId}
        entityName={entityName}
      />
    </>
  );
}
