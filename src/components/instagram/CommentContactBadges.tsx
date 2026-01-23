import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Users, 
  ExternalLink, 
  MessageCircle, 
  Instagram,
  Loader2,
  Tag,
  UserCheck,
  UserPlus,
  Users2,
  Pencil
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CommentContactData } from '@/hooks/useCommentContactInfo';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { LeadStatusPopover } from './LeadStatusPopover';
import { EditRelationshipDialog } from './EditRelationshipDialog';
import { RelationshipPromptDialog, isRelationshipClassification } from './RelationshipPromptDialog';

interface CommentContactBadgesProps {
  contactData: CommentContactData;
  username: string | null;
  onLeadStatusChanged?: () => void;
}

export const CommentContactBadges: React.FC<CommentContactBadgesProps> = ({
  contactData,
  username,
  onLeadStatusChanged
}) => {
  const navigate = useNavigate();
  const { contact, linkedLeads, relationships, loading } = contactData;
  const { classificationConfig } = useContactClassifications();
  
  const contactClassifications = contact?.classifications || [];
  const followerStatus = contact?.follower_status;

  // Edit relationship states
  const [showEditRelationship, setShowEditRelationship] = useState(false);
  const [editingRelationship, setEditingRelationship] = useState<{
    id: string;
    type: string;
    relatedContact: { id: string; full_name: string };
  } | null>(null);

  // Create relationship states
  const [showRelationshipPrompt, setShowRelationshipPrompt] = useState(false);
  const [pendingRelationshipClassification, setPendingRelationshipClassification] = useState<string>('');

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

  // Get relationship data for a classification if it's a relationship type
  const getRelationshipForClassification = (classification: string) => {
    const lowerClassification = classification.toLowerCase();
    return relationships.find(rel => 
      rel.relationship_type.toLowerCase().includes(lowerClassification) ||
      lowerClassification.includes(rel.relationship_type.toLowerCase())
    );
  };

  // Get display label with relationship name if applicable
  const getClassificationDisplayLabel = (classification: string) => {
    const config = getClassificationConfig(classification);
    const relationship = getRelationshipForClassification(classification);
    if (relationship && relationship.related_contact?.full_name) {
      const firstName = relationship.related_contact.full_name.split(' ')[0];
      return `${config.label} de ${firstName}`;
    }
    return config.label;
  };

  const handleEditRelationship = (classification: string) => {
    const relationship = getRelationshipForClassification(classification);
    
    if (relationship && contact?.id) {
      // Has existing relationship - open edit dialog
      setEditingRelationship({
        id: relationship.id,
        type: relationship.relationship_type,
        relatedContact: {
          id: relationship.related_contact.id,
          full_name: relationship.related_contact.full_name
        }
      });
      setShowEditRelationship(true);
    } else if (contact?.id && isRelationshipClassification(classification)) {
      // No relationship exists yet - open create dialog
      setPendingRelationshipClassification(classification);
      setShowRelationshipPrompt(true);
    }
  };

  const handleEditRelationshipComplete = () => {
    setEditingRelationship(null);
    onLeadStatusChanged?.();
  };

  const handleRelationshipCreated = () => {
    setPendingRelationshipClassification('');
    onLeadStatusChanged?.();
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

        {/* Linked Leads - Show directly on card with status popover */}
        {linkedLeads.length > 0 && linkedLeads.slice(0, 2).map(lead => (
          <LeadStatusPopover
            key={lead.id}
            leadId={lead.id}
            leadName={lead.lead_name}
            currentStatus={lead.status}
            boardId={lead.board_id}
            onStatusChanged={onLeadStatusChanged}
          />
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
          const classConfig = getClassificationConfig(classification);
          const displayLabel = getClassificationDisplayLabel(classification);
          const relationship = getRelationshipForClassification(classification);
          const hasRelationship = relationship && relationship.related_contact?.full_name;
          const isRelationship = isRelationshipClassification(classification);
          const isClickable = isRelationship;
          
          return (
            <Tooltip key={`class-${idx}`}>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className={`text-xs gap-1 capitalize ${isClickable ? 'cursor-pointer hover:bg-accent' : ''}`}
                  style={{ 
                    backgroundColor: `${classConfig.color}15`, 
                    color: classConfig.color.replace('bg-', '').includes('-') ? undefined : classConfig.color,
                    borderColor: `${classConfig.color}40`
                  }}
                  onClick={isClickable ? () => handleEditRelationship(classification) : undefined}
                >
                  <Tag className="h-3 w-3" />
                  {displayLabel}
                  {isClickable && (
                    <Pencil className="h-2.5 w-2.5 ml-0.5 opacity-50" />
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {isClickable ? (hasRelationship ? 'Clique para editar o vínculo' : 'Clique para vincular a alguém') : displayLabel}
              </TooltipContent>
            </Tooltip>
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
                    const displayLabel = getClassificationDisplayLabel(classification);
                    return (
                      <Badge 
                        key={`class-more-${idx}`}
                        variant="outline" 
                        className="text-xs capitalize"
                      >
                        {displayLabel}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
      </div>

      {/* Edit Relationship Dialog */}
      {editingRelationship && (
        <EditRelationshipDialog
          open={showEditRelationship}
          onOpenChange={setShowEditRelationship}
          relationshipId={editingRelationship.id}
          relationshipType={editingRelationship.type}
          currentRelatedContact={editingRelationship.relatedContact}
          contactId={contact?.id || ''}
          contactName={contact?.full_name || username || 'Contato'}
          onComplete={handleEditRelationshipComplete}
        />
      )}

      {/* Create Relationship Dialog */}
      <RelationshipPromptDialog
        open={showRelationshipPrompt}
        onOpenChange={setShowRelationshipPrompt}
        relationshipClassification={pendingRelationshipClassification}
        contactId={contact?.id || null}
        contactName={contact?.full_name || username || 'Contato'}
        onComplete={handleRelationshipCreated}
      />
    </TooltipProvider>
  );
};
