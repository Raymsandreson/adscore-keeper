import { Instagram, Facebook, Youtube, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Platform } from "@/types/editorial";
import { platformConfig } from "@/types/editorial";

interface PlatformIconProps {
  platform: Platform;
  className?: string;
}

// Custom TikTok icon
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 24 24" 
      fill="currentColor"
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
    </svg>
  );
}

// Custom Kwai icon
function KwaiIcon({ className }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 24 24" 
      fill="currentColor"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="bold">K</text>
    </svg>
  );
}

export function PlatformIcon({ platform, className }: PlatformIconProps) {
  const config = platformConfig[platform];
  
  if (!config) {
    return null;
  }
  
  const baseClassName = cn(config.color, className);

  switch (platform) {
    case "all":
      return <Globe className={baseClassName} />;
    case "instagram":
      return <Instagram className={baseClassName} />;
    case "facebook":
      return <Facebook className={baseClassName} />;
    case "youtube":
      return <Youtube className={baseClassName} />;
    case "tiktok":
      return <TikTokIcon className={baseClassName} />;
    case "kwai":
      return <KwaiIcon className={baseClassName} />;
    default:
      return null;
  }
}
