import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Bot, User, CheckCircle2, Instagram } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface ReplyStatusBadgeProps {
  repliedAt: string | null;
  metadata?: {
    manual_reply?: boolean;
    manual_reply_text?: string;
  } | null;
  compact?: boolean;
}

export function ReplyStatusBadge({ repliedAt, metadata, compact = false }: ReplyStatusBadgeProps) {
  if (!repliedAt) {
    return null;
  }

  const isManualReply = metadata?.manual_reply === true;
  const manualReplyText = metadata?.manual_reply_text;

  if (compact) {
    return (
      <HoverCard openDelay={200}>
        <HoverCardTrigger asChild>
          <Badge 
            variant="outline" 
            className={cn(
              "text-xs cursor-help gap-1",
              isManualReply 
                ? "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-700"
                : "bg-green-100 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-700"
            )}
          >
            {isManualReply ? (
              <Instagram className="h-3 w-3" />
            ) : (
              <Bot className="h-3 w-3" />
            )}
            <CheckCircle2 className="h-3 w-3" />
          </Badge>
        </HoverCardTrigger>
        <HoverCardContent side="top" className="w-64 p-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isManualReply ? (
                <>
                  <Instagram className="h-4 w-4 text-blue-600" />
                  <span className="font-medium text-sm">Respondido no Instagram</span>
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-sm">Respondido pelo sistema</span>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {format(new Date(repliedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            </p>
            {manualReplyText && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground line-clamp-3">
                  "{manualReplyText}"
                </p>
              </div>
            )}
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <Badge 
          variant="outline" 
          className={cn(
            "text-xs cursor-help gap-1.5",
            isManualReply 
              ? "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-700"
              : "bg-green-100 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-700"
          )}
        >
          {isManualReply ? (
            <>
              <Instagram className="h-3 w-3" />
              Respondido (Instagram)
            </>
          ) : (
            <>
              <Bot className="h-3 w-3" />
              Respondido (Sistema)
            </>
          )}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72 p-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {isManualReply ? (
              <>
                <div className="p-1.5 rounded-full bg-blue-100 dark:bg-blue-900">
                  <Instagram className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">Respondido manualmente</p>
                  <p className="text-xs text-muted-foreground">Direto no Instagram</p>
                </div>
              </>
            ) : (
              <>
                <div className="p-1.5 rounded-full bg-green-100 dark:bg-green-900">
                  <Bot className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">Respondido automaticamente</p>
                  <p className="text-xs text-muted-foreground">Via este sistema</p>
                </div>
              </>
            )}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1 border-t">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {format(new Date(repliedAt), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
          </div>
          {manualReplyText && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium mb-1">Prévia da resposta:</p>
              <p className="text-xs text-muted-foreground line-clamp-3 italic">
                "{manualReplyText}"
              </p>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
