import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  MapPin, 
  User, 
  Save, 
  RefreshCw, 
  Instagram, 
  Handshake,
  UserCheck,
  CheckCircle2,
  Building2,
  Map,
  LocateFixed,
  Loader2
} from 'lucide-react';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { cn } from '@/lib/utils';

interface PostDmContactRegistrationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instagramUsername: string;
  onContactSaved?: () => void;
}

export function PostDmContactRegistration({
  open,
  onOpenChange,
  instagramUsername,
  onContactSaved
}: PostDmContactRegistrationProps) {
  const [loading, setLoading] = useState(false);
  const [existingContact, setExistingContact] = useState<any>(null);
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    city: '',
    state: '',
    neighborhood: '',
    notes: '',
    classifications: [] as string[]
  });

  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const { classifications } = useContactClassifications();
  const { loading: geoLoading, fetchLocation } = useGeolocation();

  const handleAutoLocation = async () => {
    const loc = await fetchLocation();
    if (loc) {
      setFormData(prev => ({ ...prev, state: loc.state, city: loc.city }));
      fetchCities(loc.state);
      toast.success(`Localização detectada: ${loc.city}/${loc.state}`);
    } else {
      toast.error('Não foi possível detectar a localização');
    }
  };

  // Check if contact exists
  useEffect(() => {
    if (open && instagramUsername) {
      checkExistingContact();
    }
  }, [open, instagramUsername]);

  // Load cities when state changes
  useEffect(() => {
    if (formData.state) {
      fetchCities(formData.state);
    }
  }, [formData.state]);

  const checkExistingContact = async () => {
    const normalizedUsername = instagramUsername.replace('@', '').toLowerCase();
    
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .or(`instagram_username.ilike.${normalizedUsername},instagram_username.ilike.@${normalizedUsername}`)
      .limit(1)
      .maybeSingle();

    if (data) {
      setExistingContact(data);
      setFormData({
        full_name: data.full_name || normalizedUsername,
        phone: data.phone || '',
        city: data.city || '',
        state: data.state || '',
        neighborhood: data.neighborhood || '',
        notes: data.notes || '',
        classifications: data.classifications || []
      });
    } else {
      setExistingContact(null);
      setFormData({
        full_name: normalizedUsername,
        phone: '',
        city: '',
        state: '',
        neighborhood: '',
        notes: '',
        classifications: []
      });
    }
  };

  const toggleClassification = (classificationName: string) => {
    setFormData(prev => ({
      ...prev,
      classifications: prev.classifications.includes(classificationName)
        ? prev.classifications.filter(c => c !== classificationName)
        : [...prev.classifications, classificationName]
    }));
  };

  const handleSave = async () => {
    if (!formData.full_name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setLoading(true);
    const normalizedUsername = instagramUsername.replace('@', '').toLowerCase();

    try {
      const contactData = {
        full_name: formData.full_name,
        phone: formData.phone || null,
        city: formData.city || null,
        state: formData.state || null,
        neighborhood: formData.neighborhood || null,
        notes: formData.notes || null,
        classifications: formData.classifications,
        instagram_username: normalizedUsername,
        instagram_url: `https://instagram.com/${normalizedUsername}`,
        updated_at: new Date().toISOString()
      };

      if (existingContact) {
        const { error } = await supabase
          .from('contacts')
          .update(contactData)
          .eq('id', existingContact.id);
        
        if (error) throw error;
        toast.success('Contato atualizado com sucesso!');
      } else {
        const { error } = await supabase
          .from('contacts')
          .insert(contactData);
        
        if (error) throw error;
        toast.success('Contato cadastrado com sucesso!');
      }

      onContactSaved?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving contact:', error);
      toast.error('Erro ao salvar contato');
    } finally {
      setLoading(false);
    }
  };

  // Quick classification buttons for common use cases
  const quickClassifications = [
    { name: 'Parceiro', icon: Handshake, description: 'Pode fazer parcerias' },
    { name: 'Indicação', icon: UserCheck, description: 'Pode indicar clientes' },
    { name: 'Acolhedor', icon: User, description: 'Acolhedor local' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Cadastrar Contato
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <Instagram className="h-4 w-4 text-pink-500" />
            @{instagramUsername.replace('@', '')}
            {existingContact && (
              <Badge variant="secondary" className="ml-2">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Já cadastrado
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Quick Classification Buttons */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Tipo de Contato</Label>
            <div className="flex flex-wrap gap-2">
              {quickClassifications.map((qc) => {
                const isSelected = formData.classifications.includes(qc.name);
                const classificationData = classifications.find(c => c.name === qc.name);
                
                return (
                  <Button
                    key={qc.name}
                    type="button"
                    variant={isSelected ? 'default' : 'outline'}
                    size="sm"
                    className={cn(
                      "gap-2",
                      isSelected && classificationData?.color && `${classificationData.color} text-white`
                    )}
                    onClick={() => toggleClassification(qc.name)}
                  >
                    <qc.icon className="h-4 w-4" />
                    {qc.name}
                    {isSelected && <CheckCircle2 className="h-3 w-3" />}
                  </Button>
                );
              })}
            </div>
            
            {/* Other Classifications */}
            <div className="flex flex-wrap gap-1">
              {classifications
                .filter(c => !quickClassifications.some(qc => qc.name === c.name))
                .map((classification) => {
                  const isSelected = formData.classifications.includes(classification.name);
                  return (
                    <Badge
                      key={classification.id}
                      variant={isSelected ? 'default' : 'outline'}
                      className={cn(
                        "cursor-pointer transition-all",
                        isSelected && classification.color
                      )}
                      onClick={() => toggleClassification(classification.name)}
                    >
                      {classification.name}
                    </Badge>
                  );
                })}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              <User className="h-4 w-4 inline mr-1" />
              Nome
            </Label>
            <Input
              id="name"
              value={formData.full_name}
              onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
              placeholder="Nome completo"
            />
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="(00) 00000-0000"
            />
          </div>

          {/* Location - Auto detect + State and City */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAutoLocation}
            disabled={geoLoading}
            className="w-full gap-2 border-dashed"
          >
            {geoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
            {geoLoading ? 'Detectando...' : 'Usar minha localização atual'}
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>
                <Map className="h-4 w-4 inline mr-1" />
                Estado
              </Label>
              <Select
                value={formData.state}
                onValueChange={(value) => setFormData(prev => ({ ...prev, state: value, city: '' }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {states.map((state) => (
                    <SelectItem key={state.sigla} value={state.sigla}>
                      {state.sigla} - {state.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                <Building2 className="h-4 w-4 inline mr-1" />
                Cidade
              </Label>
              <Select
                value={formData.city}
                onValueChange={(value) => setFormData(prev => ({ ...prev, city: value }))}
                disabled={!formData.state || loadingCities}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingCities ? "Carregando..." : "Selecione..."} />
                </SelectTrigger>
                <SelectContent>
                  {cities.map((city) => (
                    <SelectItem key={city.id} value={city.nome}>
                      {city.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Neighborhood */}
          <div className="space-y-2">
            <Label htmlFor="neighborhood">Bairro</Label>
            <Input
              id="neighborhood"
              value={formData.neighborhood}
              onChange={(e) => setFormData(prev => ({ ...prev, neighborhood: e.target.value }))}
              placeholder="Nome do bairro"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Anotações sobre este contato..."
              rows={3}
            />
          </div>

          {/* Summary of what will be saved */}
          {(formData.state || formData.classifications.length > 0) && (
            <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Resumo:</p>
              <div className="flex flex-wrap gap-2">
                {formData.state && (
                  <Badge variant="outline" className="gap-1">
                    <MapPin className="h-3 w-3" />
                    {formData.city ? `${formData.city}, ${formData.state}` : formData.state}
                  </Badge>
                )}
                {formData.classifications.map(c => (
                  <Badge key={c} variant="secondary">
                    {c}
                  </Badge>
                  ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {existingContact ? 'Atualizar' : 'Cadastrar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
