import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Briefcase, 
  Users, 
  ExternalLink, 
  MessageCircle, 
  Phone,
  Instagram,
  Loader2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CommentContactData } from '@/hooks/useCommentContactInfo';

interface CommentContactBadgesProps {
  contactData: CommentContactData;
  username: string | null;
}

export const CommentContactBadges: React.FC<CommentContactBadgesProps> = ({
  contactData,
  username
}) => {
  const navigate = useNavigate();
  const { contact, linkedLeads, relationships, loading } = contactData;

  if (loading) {
    return (
      <div className="flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact && linkedLeads.length === 0 && relationships.length === 0) {
    return null;
  }

  const formatPhoneForWhatsApp = (phone: string) => {
    return phone.replace(/\D/g, '');
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 flex-wrap">
        {/* Linked Leads Badge */}
        {linkedLeads.length > 0 && (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Badge 
                variant="outline" 
                className="cursor-pointer text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
              >
                <Briefcase className="h-3 w-3 mr-1" />
                {linkedLeads.length} lead{linkedLeads.length > 1 ? 's' : ''}
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent side="top" className="w-64 p-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Leads vinculados:</p>
                {linkedLeads.map(lead => (
                  <div 
                    key={lead.id} 
                    className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {lead.lead_name || 'Sem nome'}
                      </p>
                      <Badge variant="secondary" className="text-xs mt-1">
                        {lead.status || 'new'}
                      </Badge>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => navigate(`/leads?leadId=${lead.id}`)}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Ver lead</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </HoverCardContent>
          </HoverCard>
        )}

        {/* Relationships Badge */}
        {relationships.length > 0 && (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Badge 
                variant="outline" 
                className="cursor-pointer text-xs bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 transition-colors"
              >
                <Users className="h-3 w-3 mr-1" />
                {relationships.length} conexão{relationships.length > 1 ? 'ões' : ''}
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent side="top" className="w-72 p-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Conexões:</p>
                {relationships.map(rel => (
                  <div 
                    key={rel.id} 
                    className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {rel.related_contact.full_name}
                      </p>
                      <Badge variant="secondary" className="text-xs mt-1 capitalize">
                        {rel.relationship_type.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {rel.related_contact.phone && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                              onClick={() => window.open(`https://wa.me/${formatPhoneForWhatsApp(rel.related_contact.phone!)}`, '_blank')}
                            >
                              <MessageCircle className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>WhatsApp</TooltipContent>
                        </Tooltip>
                      )}
                      {rel.related_contact.instagram_username && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-pink-600 hover:text-pink-700"
                              onClick={() => window.open(`https://instagram.com/${rel.related_contact.instagram_username?.replace('@', '')}`, '_blank')}
                            >
                              <Instagram className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Instagram</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
      </div>
    </TooltipProvider>
  );
};
