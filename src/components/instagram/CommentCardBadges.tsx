import React from 'react';
import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Users, 
  Tag,
  UserCheck,
  UserPlus,
  Users2,
  Link2Off,
  ExternalLink,
  MessageCircle,
  Instagram
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import type { CommentContactData } from '@/hooks/useCommentContactInfo';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import type { CommentCardFieldsConfig } from '@/hooks/useCommentCardSettings';

interface CommentCardBadgesProps {
  contactData: CommentContactData;
  config: CommentCardFieldsConfig;
  compact?: boolean;
}

export const CommentCardBadges: React.FC<CommentCardBadgesProps> = ({
  contactData,
  config,
  compact = false
}) => {
  const navigate = useNavigate();
  const { contact, linkedLeads, relationships, loading } = contactData;
  const { classificationConfig } = useContactClassifications();
  
  const contactClassifications = contact?.classifications || [];
  const followerStatus = contact?.follower_status;

  if (loading) {
    return null;
  }

  const getFollowerStatusConfig = (status: string | null | undefined) => {
    switch (status) {
      case 'follower':
        return { 
          icon: UserCheck, 
          label: 'Te segue', 
          shortLabel: 'Seguidor',
          className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800' 
        };
      case 'following':
        return { 
          icon: UserPlus, 
          label: 'Você segue', 
          shortLabel: 'Seguindo',
          className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800' 
        };
      case 'mutual':
        return { 
          icon: Users2, 
          label: 'Mútuo', 
          shortLabel: 'Mútuo',
          className: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800' 
        };
      default:
        return null;
    }
  };

  const followerStatusConfig = getFollowerStatusConfig(followerStatus);

  const getClassificationConfig = (name: string) => {
    return classificationConfig[name] || { label: name, color: 'bg-gray-500' };
  };

  const formatPhoneForWhatsApp = (phone: string) => {
    return phone.replace(/\D/g, '');
  };

  const hasAnyData = followerStatusConfig || contactClassifications.length > 0 || linkedLeads.length > 0 || relationships.length > 0;

  if (!hasAnyData && !config.linkedLeads) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 flex-wrap">
        {/* Follower Status */}
        {config.followerStatus && followerStatusConfig && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline" 
                className={`text-xs gap-1 ${followerStatusConfig.className}`}
              >
                <followerStatusConfig.icon className="h-3 w-3" />
                {!compact && followerStatusConfig.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{followerStatusConfig.label}</TooltipContent>
          </Tooltip>
        )}

        {/* Classifications */}
        {config.classification && contactClassifications.length > 0 && (
          <>
            {contactClassifications.slice(0, compact ? 1 : 2).map((classification, idx) => {
              const classConfig = getClassificationConfig(classification);
              return (
                <Tooltip key={`class-${idx}`}>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant="outline" 
                      className="text-xs gap-1"
                    >
                      <div className={`w-2 h-2 rounded-full ${classConfig.color}`} />
                      {!compact && classConfig.label}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{classConfig.label}</TooltipContent>
                </Tooltip>
              );
            })}
            
            {contactClassifications.length > (compact ? 1 : 2) && (
              <HoverCard openDelay={200} closeDelay={100}>
                <HoverCardTrigger asChild>
                  <Badge 
                    variant="outline" 
                    className="cursor-pointer text-xs bg-muted hover:bg-muted/80"
                  >
                    +{contactClassifications.length - (compact ? 1 : 2)}
                  </Badge>
                </HoverCardTrigger>
                <HoverCardContent side="top" className="w-48 p-3">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Classificações:</p>
                    <div className="flex flex-wrap gap-1">
                      {contactClassifications.map((classification, idx) => {
                        const classConfig = getClassificationConfig(classification);
                        return (
                          <Badge 
                            key={`class-all-${idx}`}
                            variant="outline" 
                            className="text-xs gap-1"
                          >
                            <div className={`w-2 h-2 rounded-full ${classConfig.color}`} />
                            {classConfig.label}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
          </>
        )}

        {/* Linked Leads */}
        {config.linkedLeads && (
          <>
            {linkedLeads.length === 0 ? (
              <Badge 
                variant="outline" 
                className="text-xs gap-1 bg-muted/50 text-muted-foreground border-dashed"
              >
                <Link2Off className="h-3 w-3" />
                {!compact && "Não vinculado"}
              </Badge>
            ) : (
              <>
                {linkedLeads.slice(0, compact ? 1 : 2).map(lead => (
                  <Tooltip key={lead.id}>
                    <TooltipTrigger asChild>
                      <Badge 
                        variant="outline" 
                        className="text-xs gap-1 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900"
                        onClick={() => navigate(`/leads?leadId=${lead.id}`)}
                      >
                        {lead.lead_name?.slice(0, compact ? 10 : 15) || 'Lead'}
                        {(lead.lead_name?.length || 0) > (compact ? 10 : 15) && '...'}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        <p className="font-medium">{lead.lead_name}</p>
                        <p className="text-muted-foreground">Status: {lead.status || 'new'}</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))}
                
                {linkedLeads.length > (compact ? 1 : 2) && (
                  <HoverCard openDelay={200} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <Badge 
                        variant="outline" 
                        className="cursor-pointer text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 hover:bg-blue-100"
                      >
                        +{linkedLeads.length - (compact ? 1 : 2)} leads
                      </Badge>
                    </HoverCardTrigger>
                    <HoverCardContent side="top" className="w-64 p-3">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Leads vinculados:</p>
                        {linkedLeads.map(lead => (
                          <div 
                            key={lead.id} 
                            className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                            onClick={() => navigate(`/leads?leadId=${lead.id}`)}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{lead.lead_name || 'Sem nome'}</p>
                              <Badge variant="secondary" className="text-xs mt-1">{lead.status || 'new'}</Badge>
                            </div>
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </div>
                        ))}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                )}
              </>
            )}
          </>
        )}

        {/* Connections/Relationships */}
        {config.connections && relationships.length > 0 && (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Badge 
                variant="outline" 
                className="cursor-pointer text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900"
              >
                <Users className="h-3 w-3 mr-1" />
                {compact ? (
                  relationships.length
                ) : relationships.length === 1 ? (
                  <span className="capitalize">
                    {relationships[0].relationship_type.replace(/_/g, ' ')} de {relationships[0].related_contact.full_name.split(' ')[0]}
                  </span>
                ) : (
                  <span>{relationships.length} conexões</span>
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
                      <p className="text-sm font-medium truncate">{rel.related_contact.full_name}</p>
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
