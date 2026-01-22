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
  Loader2,
  Tag,
  UserCheck,
  UserPlus,
  Users2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CommentContactData } from '@/hooks/useCommentContactInfo';
import { useContactClassifications } from '@/hooks/useContactClassifications';

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
  const { classificationConfig } = useContactClassifications();
  
  const contactClassifications = contact?.classifications || [];
  const followerStatus = contact?.follower_status;

  if (loading) {
    return (
      <div className="flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact && linkedLeads.length === 0 && relationships.length === 0 && contactClassifications.length === 0) {
    return null;
  }

  const getFollowerStatusConfig = (status: string | null | undefined) => {
    switch (status) {
      case 'follower':
        return { 
          icon: UserCheck, 
          label: 'Te segue', 
          className: 'bg-green-50 text-green-700 border-green-200' 
        };
      case 'following':
        return { 
          icon: UserPlus, 
          label: 'Você segue', 
          className: 'bg-orange-50 text-orange-700 border-orange-200' 
        };
      case 'mutual':
        return { 
          icon: Users2, 
          label: 'Mútuo', 
          className: 'bg-cyan-50 text-cyan-700 border-cyan-200' 
        };
      default:
        return null;
    }
  };

  const followerStatusConfig = getFollowerStatusConfig(followerStatus);

  const formatPhoneForWhatsApp = (phone: string) => {
    return phone.replace(/\D/g, '');
  };

  const getClassificationConfig = (name: string) => {
    return classificationConfig[name] || { label: name, color: 'bg-gray-500' };
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 flex-wrap">
        {/* Follower Status Indicator */}
        {followerStatusConfig && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline" 
                className={`text-xs gap-1 ${followerStatusConfig.className}`}
              >
                <followerStatusConfig.icon className="h-3 w-3" />
                {followerStatusConfig.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Status de seguidor</TooltipContent>
          </Tooltip>
        )}

        {/* Linked Leads - Show directly on card */}
        {linkedLeads.length > 0 && linkedLeads.slice(0, 2).map(lead => (
          <Badge 
            key={lead.id}
            variant="outline" 
            className="cursor-pointer text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors gap-1"
            onClick={() => navigate(`/leads?leadId=${lead.id}`)}
          >
            <Briefcase className="h-3 w-3" />
            <span className="max-w-[100px] truncate">
              {lead.lead_name || 'Sem nome'}
            </span>
            <span className="text-blue-500">
              ({lead.status || 'new'})
            </span>
            <ExternalLink className="h-3 w-3 ml-0.5" />
          </Badge>
        ))}
        
        {/* Show "+X more" badge if more than 2 leads */}
        {linkedLeads.length > 2 && (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Badge 
                variant="outline" 
                className="cursor-pointer text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
              >
                +{linkedLeads.length - 2} leads
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent side="top" className="w-64 p-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Mais leads vinculados:</p>
                {linkedLeads.slice(2).map(lead => (
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

        {/* Relationships Badge - show first relationship directly */}
        {relationships.length > 0 && (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Badge 
                variant="outline" 
                className="cursor-pointer text-xs bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 transition-colors"
              >
                <Users className="h-3 w-3 mr-1" />
                {relationships.length === 1 ? (
                  <span className="capitalize">
                    {relationships[0].relationship_type.replace(/_/g, ' ')} de {relationships[0].related_contact.full_name.split(' ')[0]}
                  </span>
                ) : (
                  <span>
                    {relationships.length} conexões
                  </span>
                )}
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

        {/* Contact Classifications - show directly on card */}
        {contactClassifications.length > 0 && contactClassifications.slice(0, 2).map((classification, idx) => {
          const config = getClassificationConfig(classification);
          return (
            <Badge 
              key={`class-${idx}`}
              variant="outline" 
              className="text-xs gap-1 capitalize"
              style={{ 
                backgroundColor: `${config.color}15`, 
                color: config.color.replace('bg-', '').includes('-') ? undefined : config.color,
                borderColor: `${config.color}40`
              }}
            >
              <Tag className="h-3 w-3" />
              {config.label}
            </Badge>
          );
        })}
        
        {/* Show "+X more" badge if more than 2 classifications */}
        {contactClassifications.length > 2 && (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Badge 
                variant="outline" 
                className="cursor-pointer text-xs bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 transition-colors"
              >
                +{contactClassifications.length - 2} tags
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent side="top" className="w-48 p-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Mais classificações:</p>
                <div className="flex flex-wrap gap-1">
                  {contactClassifications.slice(2).map((classification, idx) => {
                    const config = getClassificationConfig(classification);
                    return (
                      <Badge 
                        key={`class-more-${idx}`}
                        variant="outline" 
                        className="text-xs capitalize"
                      >
                        {config.label}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
      </div>
    </TooltipProvider>
  );
};
