import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { User, ExternalLink, Instagram } from 'lucide-react';
import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface InstagramProfileHoverCardProps {
  username: string;
  children?: ReactNode;
  className?: string;
  showIcon?: boolean;
}

export function InstagramProfileHoverCard({ 
  username, 
  children,
  className = "",
  showIcon = true
}: InstagramProfileHoverCardProps) {
  // Clean username (remove @ if present)
  const cleanUsername = username.replace(/^@/, '');
  const profileUrl = `https://www.instagram.com/${cleanUsername}/`;

  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 hover:underline cursor-pointer group ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children || (
            <>
              {showIcon && <User className="h-3 w-3" />}
              <span>{username.startsWith('@') ? username : `@${cleanUsername}`}</span>
              <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </>
          )}
        </a>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72 p-0 overflow-hidden z-50">
        <div className="bg-gradient-to-br from-pink-500 via-purple-500 to-orange-400 p-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border-2 border-white/40">
              <Instagram className="h-7 w-7 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-base truncate">@{cleanUsername}</p>
              <p className="text-white/80 text-xs">Perfil do Instagram</p>
            </div>
          </div>
        </div>
        <div className="p-3 bg-card">
          <Button
            asChild
            size="sm"
            className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white"
          >
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Ver perfil no Instagram
            </a>
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
