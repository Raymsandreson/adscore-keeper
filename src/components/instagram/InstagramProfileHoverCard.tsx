import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { User, ExternalLink } from 'lucide-react';
import { ReactNode } from 'react';

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
      <HoverCardContent side="top" className="w-80 p-0 overflow-hidden z-50">
        <div className="relative">
          <div className="w-full bg-muted flex items-center justify-center">
            <iframe
              src={`${profileUrl}embed/`}
              className="w-full h-[400px] border-0"
              scrolling="no"
              allowTransparency={true}
              loading="lazy"
              title={`Perfil de ${cleanUsername}`}
            />
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
            <a 
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-white flex items-center gap-1 hover:underline"
            >
              <User className="h-3 w-3" />
              @{cleanUsername}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
