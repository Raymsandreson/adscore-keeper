import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  GitMerge,
  Loader2,
  User,
  Phone,
  Mail,
  Instagram,
  MapPin,
  Tag,
  AlertCircle,
  Check,
  X,
  ChevronRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Contact, ContactClassification, FollowerStatus } from '@/hooks/useContacts';

interface DuplicateGroup {
  normalizedUsername: string;
  contacts: Contact[];
  selectedPrimaryId: string;
  selectedForMerge: boolean;
}

interface MergeDuplicatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMergeComplete: () => void;
}

export const MergeDuplicatesDialog: React.FC<MergeDuplicatesDialogProps> = ({
  open,
  onOpenChange,
  onMergeComplete,
}) => {
  const [loading, setLoading] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [step, setStep] = useState<'scanning' | 'preview' | 'merging' | 'complete'>('scanning');
  const [mergeProgress, setMergeProgress] = useState({ current: 0, total: 0, merged: 0, errors: 0 });

  // Scan for duplicates when dialog opens
  const scanForDuplicates = useCallback(async () => {
    setLoading(true);
    setStep('scanning');
    
    try {
      // Fetch ALL contacts with Instagram username using pagination
      let allContacts: Contact[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;
      
      while (hasMore) {
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .not('instagram_username', 'is', null)
          .order('created_at', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;
        
        if (data && data.length > 0) {
          allContacts = [...allContacts, ...(data as Contact[])];
          hasMore = data.length === pageSize;
          page++;
        } else {
          hasMore = false;
        }
      }

      // Group contacts by normalized Instagram username
      const contactsByUsername = new Map<string, Contact[]>();
      
      allContacts.forEach(contact => {
        const normalized = contact.instagram_username?.replace('@', '').toLowerCase();
        if (normalized) {
          if (!contactsByUsername.has(normalized)) {
            contactsByUsername.set(normalized, []);
          }
          contactsByUsername.get(normalized)!.push(contact);
        }
      });

      // Find groups with duplicates
      const groups: DuplicateGroup[] = [];
      contactsByUsername.forEach((contacts, normalizedUsername) => {
        if (contacts.length > 1) {
          // Sort by data richness
          const sorted = [...contacts].sort((a, b) => {
            const scoreA = scoreContact(a);
            const scoreB = scoreContact(b);
            return scoreB - scoreA;
          });
          
          groups.push({
            normalizedUsername,
            contacts: sorted,
            selectedPrimaryId: sorted[0].id, // Default to richest contact
            selectedForMerge: true,
          });
        }
      });

      setDuplicateGroups(groups);
      setStep(groups.length > 0 ? 'preview' : 'complete');
      
      if (groups.length === 0) {
        toast.info('Nenhum contato duplicado encontrado');
      }
    } catch (error) {
      console.error('Error scanning:', error);
      toast.error('Erro ao buscar duplicados');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      scanForDuplicates();
    } else {
      // Reset state when closed
      setDuplicateGroups([]);
      setStep('scanning');
      setMergeProgress({ current: 0, total: 0, merged: 0, errors: 0 });
    }
  }, [open, scanForDuplicates]);

  // Score a contact by data richness
  const scoreContact = (contact: Contact): number => {
    let score = 0;
    if (contact.full_name && !contact.full_name.startsWith('@')) score += 10;
    if (contact.phone) score += 8;
    if (contact.email) score += 8;
    if (contact.city) score += 5;
    if (contact.state) score += 5;
    if (contact.neighborhood) score += 3;
    if (contact.street) score += 3;
    if (contact.cep) score += 3;
    if (contact.notes) score += 2;
    if (contact.classification && contact.classification !== 'prospect') score += 5;
    if (contact.classifications && contact.classifications.length > 0) score += 5;
    if (contact.lead_id) score += 10;
    if (contact.tags && contact.tags.length > 0) score += contact.tags.length;
    // Prefer older contacts
    score += Math.max(0, 10 - Math.floor((Date.now() - new Date(contact.created_at).getTime()) / (30 * 24 * 60 * 60 * 1000)));
    return score;
  };

  // Toggle group selection
  const toggleGroupSelection = (normalizedUsername: string) => {
    setDuplicateGroups(prev => prev.map(g => 
      g.normalizedUsername === normalizedUsername 
        ? { ...g, selectedForMerge: !g.selectedForMerge }
        : g
    ));
  };

  // Set primary contact for a group
  const setPrimaryContact = (normalizedUsername: string, contactId: string) => {
    setDuplicateGroups(prev => prev.map(g => 
      g.normalizedUsername === normalizedUsername 
        ? { ...g, selectedPrimaryId: contactId }
        : g
    ));
  };

  // Perform the merge
  const handleMerge = async () => {
    const groupsToMerge = duplicateGroups.filter(g => g.selectedForMerge);
    
    if (groupsToMerge.length === 0) {
      toast.info('Nenhum grupo selecionado para mesclar');
      return;
    }

    setStep('merging');
    setMergeProgress({ current: 0, total: groupsToMerge.length, merged: 0, errors: 0 });

    let merged = 0;
    let errors = 0;

    for (let i = 0; i < groupsToMerge.length; i++) {
      const group = groupsToMerge[i];
      const primary = group.contacts.find(c => c.id === group.selectedPrimaryId);
      const duplicatesToMerge = group.contacts.filter(c => c.id !== group.selectedPrimaryId);

      if (!primary) continue;

      try {
        // Build merged data
        const mergedData: Partial<Contact> = {};
        
        // Name: prefer non-@ names
        if (!primary.full_name || primary.full_name.startsWith('@')) {
          const betterName = duplicatesToMerge.find(d => d.full_name && !d.full_name.startsWith('@'))?.full_name;
          if (betterName) mergedData.full_name = betterName;
        }
        
        // Fill missing fields
        if (!primary.phone) {
          const phone = duplicatesToMerge.find(d => d.phone)?.phone;
          if (phone) mergedData.phone = phone;
        }
        if (!primary.email) {
          const email = duplicatesToMerge.find(d => d.email)?.email;
          if (email) mergedData.email = email;
        }
        if (!primary.city) {
          const city = duplicatesToMerge.find(d => d.city)?.city;
          if (city) mergedData.city = city;
        }
        if (!primary.state) {
          const state = duplicatesToMerge.find(d => d.state)?.state;
          if (state) mergedData.state = state;
        }
        if (!primary.neighborhood) {
          const neighborhood = duplicatesToMerge.find(d => d.neighborhood)?.neighborhood;
          if (neighborhood) mergedData.neighborhood = neighborhood;
        }
        if (!primary.street) {
          const street = duplicatesToMerge.find(d => d.street)?.street;
          if (street) mergedData.street = street;
        }
        if (!primary.cep) {
          const cep = duplicatesToMerge.find(d => d.cep)?.cep;
          if (cep) mergedData.cep = cep;
        }
        
        // Classification
        if (!primary.classification || primary.classification === 'prospect') {
          const betterClass = duplicatesToMerge.find(d => d.classification && d.classification !== 'prospect')?.classification;
          if (betterClass) mergedData.classification = betterClass;
        }
        
        // Merge classifications array
        const allClassifications = new Set<string>();
        [primary, ...duplicatesToMerge].forEach(c => {
          (c.classifications || []).forEach(cls => allClassifications.add(cls));
        });
        if (allClassifications.size > 0) {
          mergedData.classifications = Array.from(allClassifications);
        }
        
        // Follower status
        const allStatuses = [primary.follower_status, ...duplicatesToMerge.map(d => d.follower_status)];
        if (allStatuses.includes('mutual')) {
          mergedData.follower_status = 'mutual';
        } else if (allStatuses.includes('follower') && allStatuses.includes('following')) {
          mergedData.follower_status = 'mutual';
        } else if (allStatuses.includes('follower') && primary.follower_status !== 'follower') {
          mergedData.follower_status = 'follower';
        } else if (allStatuses.includes('following') && primary.follower_status !== 'following') {
          mergedData.follower_status = 'following';
        }
        
        // Merge tags
        const allTags = new Set<string>();
        [primary, ...duplicatesToMerge].forEach(c => {
          (c.tags || []).forEach(t => allTags.add(t));
        });
        if (allTags.size > 0) {
          mergedData.tags = Array.from(allTags);
        }
        
        // Merge notes
        const allNotes = [primary.notes, ...duplicatesToMerge.map(d => d.notes)]
          .filter(Boolean)
          .join('\n---\n');
        if (allNotes && allNotes !== primary.notes) {
          mergedData.notes = allNotes;
        }

        // Normalize instagram_username
        mergedData.instagram_username = group.normalizedUsername;

        // Update primary contact
        if (Object.keys(mergedData).length > 0) {
          await supabase
            .from('contacts')
            .update(mergedData)
            .eq('id', primary.id);
        }

        // Move contact_leads from duplicates to primary
        const duplicateIds = duplicatesToMerge.map(d => d.id);
        await supabase
          .from('contact_leads')
          .update({ contact_id: primary.id })
          .in('contact_id', duplicateIds);

        // Move contact_relationships from duplicates to primary
        await supabase
          .from('contact_relationships')
          .update({ contact_id: primary.id })
          .in('contact_id', duplicateIds);
        
        await supabase
          .from('contact_relationships')
          .update({ related_contact_id: primary.id })
          .in('related_contact_id', duplicateIds);

        // Delete duplicate contacts
        const { error: deleteError } = await supabase
          .from('contacts')
          .delete()
          .in('id', duplicateIds);

        if (deleteError) throw deleteError;

        merged++;
      } catch (err) {
        console.error(`Error merging ${group.normalizedUsername}:`, err);
        errors++;
      }

      setMergeProgress({ current: i + 1, total: groupsToMerge.length, merged, errors });
    }

    setStep('complete');
    
    if (merged > 0) {
      toast.success(`✅ ${merged} grupo(s) mesclados com sucesso!`);
      onMergeComplete();
    }
    if (errors > 0) {
      toast.warning(`${errors} erro(s) durante a mesclagem`);
    }
  };

  const selectedCount = duplicateGroups.filter(g => g.selectedForMerge).length;
  const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.contacts.length - 1, 0);

  const getFieldValue = (contact: Contact, field: keyof Contact) => {
    const value = contact[field];
    if (value === null || value === undefined || value === '') return null;
    if (Array.isArray(value) && value.length === 0) return null;
    return value;
  };

  const renderContactCard = (contact: Contact, isPrimary: boolean, group: DuplicateGroup) => (
    <div 
      key={contact.id}
      className={`p-3 rounded-lg border transition-all cursor-pointer ${
        isPrimary 
          ? 'border-primary bg-primary/5 ring-2 ring-primary/20' 
          : 'border-border hover:border-muted-foreground/50'
      }`}
      onClick={() => setPrimaryContact(group.normalizedUsername, contact.id)}
    >
      <div className="flex items-start gap-3">
        <RadioGroupItem value={contact.id} id={contact.id} />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={contact.id} className="font-medium cursor-pointer">
              {contact.full_name}
            </Label>
            {isPrimary && (
              <Badge variant="default" className="text-xs">Principal</Badge>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {contact.instagram_username && (
              <div className="flex items-center gap-1">
                <Instagram className="h-3 w-3" />
                <span>@{contact.instagram_username.replace('@', '')}</span>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-1">
                <Phone className="h-3 w-3" />
                <span>{contact.phone}</span>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-1">
                <Mail className="h-3 w-3" />
                <span>{contact.email}</span>
              </div>
            )}
            {(contact.city || contact.state) && (
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                <span>{[contact.city, contact.state].filter(Boolean).join(', ')}</span>
              </div>
            )}
          </div>
          
          <div className="flex flex-wrap gap-1">
            {contact.classification && (
              <Badge variant="secondary" className="text-xs">{contact.classification}</Badge>
            )}
            {contact.classifications?.map(c => (
              <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
            ))}
            {contact.follower_status && contact.follower_status !== 'none' && (
              <Badge variant="outline" className="text-xs">{contact.follower_status}</Badge>
            )}
            {contact.tags?.map(t => (
              <Badge key={t} variant="outline" className="text-xs bg-muted">{t}</Badge>
            ))}
          </div>
          
          {contact.notes && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              📝 {contact.notes}
            </p>
          )}
          
          <p className="text-xs text-muted-foreground/60">
            Criado em: {new Date(contact.created_at).toLocaleDateString('pt-BR')}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Mesclar Contatos Duplicados
          </DialogTitle>
          <DialogDescription>
            {step === 'scanning' && 'Buscando contatos duplicados...'}
            {step === 'preview' && `${duplicateGroups.length} grupo(s) de duplicados encontrados (${totalDuplicates} para remover)`}
            {step === 'merging' && 'Mesclando contatos...'}
            {step === 'complete' && mergeProgress.merged > 0 && 'Mesclagem concluída!'}
            {step === 'complete' && mergeProgress.merged === 0 && duplicateGroups.length === 0 && 'Nenhum duplicado encontrado.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {step === 'scanning' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Analisando contatos...</p>
            </div>
          )}

          {step === 'preview' && (
            <ScrollArea className="h-[50vh]">
              <div className="space-y-4 pr-4">
                {duplicateGroups.map((group) => (
                  <Card key={group.normalizedUsername} className={!group.selectedForMerge ? 'opacity-50' : ''}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <Checkbox
                          id={`group-${group.normalizedUsername}`}
                          checked={group.selectedForMerge}
                          onCheckedChange={() => toggleGroupSelection(group.normalizedUsername)}
                        />
                        <Label 
                          htmlFor={`group-${group.normalizedUsername}`}
                          className="font-medium flex-1 cursor-pointer"
                        >
                          @{group.normalizedUsername}
                        </Label>
                        <Badge variant="outline">
                          {group.contacts.length} contatos
                        </Badge>
                      </div>
                      
                      {group.selectedForMerge && (
                        <>
                          <p className="text-xs text-muted-foreground mb-3">
                            Selecione o contato principal (os dados dos outros serão mesclados nele):
                          </p>
                          
                          <RadioGroup
                            value={group.selectedPrimaryId}
                            onValueChange={(value) => setPrimaryContact(group.normalizedUsername, value)}
                            className="space-y-2"
                          >
                            {group.contacts.map((contact) => 
                              renderContactCard(
                                contact, 
                                contact.id === group.selectedPrimaryId,
                                group
                              )
                            )}
                          </RadioGroup>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}

          {step === 'merging' && (
            <div className="py-8 space-y-4">
              <Progress value={(mergeProgress.current / mergeProgress.total) * 100} />
              <p className="text-center text-sm text-muted-foreground">
                Processando {mergeProgress.current} de {mergeProgress.total}...
              </p>
              <div className="flex justify-center gap-4 text-sm">
                <span className="text-green-500">✓ {mergeProgress.merged} mesclados</span>
                {mergeProgress.errors > 0 && (
                  <span className="text-destructive">✗ {mergeProgress.errors} erros</span>
                )}
              </div>
            </div>
          )}

          {step === 'complete' && (
            <div className="py-8 text-center">
              {mergeProgress.merged > 0 ? (
                <>
                  <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
                  <p className="text-lg font-medium">
                    {mergeProgress.merged} grupo(s) mesclados com sucesso!
                  </p>
                  {mergeProgress.errors > 0 && (
                    <p className="text-sm text-destructive mt-2">
                      {mergeProgress.errors} erro(s) durante o processo
                    </p>
                  )}
                </>
              ) : (
                <>
                  <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    Nenhum contato duplicado encontrado.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={handleMerge} 
                disabled={selectedCount === 0}
              >
                <GitMerge className="h-4 w-4 mr-2" />
                Mesclar {selectedCount} grupo(s)
              </Button>
            </>
          )}
          
          {step === 'complete' && (
            <Button onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
