import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MapPin, Search, X, Loader2, Plus, Globe, Crosshair } from "lucide-react";
import { toast } from "sonner";
import { getMetaCredentials } from "@/utils/metaCredentials";

interface GeoLocation {
  key: string;
  name: string;
  region?: string;
  country_code?: string;
  type?: string;
}

interface CustomLocation {
  latitude: number;
  longitude: number;
  radius?: number;
  distance_unit?: string;
  name?: string;
  primary_city?: string;
  region?: string;
  country?: string;
  key?: string;
}

interface GeoTargeting {
  countries?: string[];
  cities?: GeoLocation[];
  regions?: GeoLocation[];
  zips?: GeoLocation[];
  custom_locations?: CustomLocation[];
}

interface GeoTargetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  entityName: string;
  entityType?: 'campaign' | 'adset' | 'ad';
  onActionComplete?: () => void;
}

export const GeoTargetingDialog = ({
  open,
  onOpenChange,
  entityId,
  entityName,
  entityType = 'campaign',
  onActionComplete,
}: GeoTargetingDialogProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [geoLocations, setGeoLocations] = useState<GeoTargeting>({});
  const [originalGeo, setOriginalGeo] = useState<GeoTargeting>({});

  const fetchTargeting = useCallback(async () => {
    const { accessToken } = await getMetaCredentials();
    if (!accessToken) {
      console.warn('[GeoDialog] No access token found');
      toast.error('Token de acesso não encontrado. Reconecte sua conta Meta.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/meta-campaign-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get_targeting',
          accessToken,
          entityId,
          entityType,
        }),
      });
      const data = await response.json();
      console.log('[GeoDialog] FULL API response:', JSON.stringify(data));
      if (data.success) {
        const targeting = data.data?.targeting || {};
        console.log('[GeoDialog] targeting object:', JSON.stringify(targeting));
        const geo = targeting.geo_locations || {};
        console.log('[GeoDialog] geo_locations:', JSON.stringify(geo));
        console.log('[GeoDialog] custom_locations:', JSON.stringify(geo.custom_locations));
        console.log('[GeoDialog] cities:', JSON.stringify(geo.cities));
        console.log('[GeoDialog] countries:', JSON.stringify(geo.countries));
        console.log('[GeoDialog] regions:', JSON.stringify(geo.regions));
        setGeoLocations(geo);
        setOriginalGeo(geo);
      } else {
        console.error('[GeoDialog] API error:', data.error);
        toast.error(data.error || 'Erro ao carregar segmentação');
      }
    } catch (error) {
      console.error('Error fetching targeting:', error);
      toast.error('Erro ao carregar segmentação geográfica');
    } finally {
      setIsLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    if (open) {
      fetchTargeting();
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [open, fetchTargeting]);

  const searchLocations = async () => {
    if (!searchQuery.trim()) return;
    const { accessToken } = await getMetaCredentials();
    if (!accessToken) return;

    setIsSearching(true);
    try {
      const response = await fetch(`https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/meta-campaign-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'search_locations',
          accessToken,
          entityId: '',
          entityType: 'adset',
          searchQuery: searchQuery.trim(),
          locationType: 'adgeolocation',
        }),
      });
      const data = await response.json();
      console.log('[GeoDialog] Search results:', JSON.stringify(data).substring(0, 1000));
      if (data.success) {
        setSearchResults(data.data.results || []);
        if ((data.data.results || []).length === 0) {
          toast.info('Nenhuma localização encontrada. Para Brasil, a Meta não suporta busca por CEP; use cidade, estado ou pin com raio.');
        }
      } else {
        console.error('[GeoDialog] Search error:', data.error);
        toast.error(data.error || 'Erro na busca');
      }
    } catch (error) {
      console.error('Error searching locations:', error);
      toast.error('Erro ao buscar localizações');
    } finally {
      setIsSearching(false);
    }
  };

  const addLocation = (location: any) => {
    const type = location.type;
    const newGeo = { ...geoLocations };

    if (type === 'city') {
      const cities = [...(newGeo.cities || [])];
      if (!cities.some(c => c.key === location.key)) {
        cities.push({ key: location.key, name: location.name, region: location.region, country_code: location.country_code });
        newGeo.cities = cities;
      }
    } else if (type === 'region') {
      const regions = [...(newGeo.regions || [])];
      if (!regions.some(r => r.key === location.key)) {
        regions.push({ key: location.key, name: location.name, country_code: location.country_code });
        newGeo.regions = regions;
      }
    } else if (type === 'zip') {
      const zips = [...(newGeo.zips || [])];
      if (!zips.some(z => z.key === location.key)) {
        zips.push({ key: location.key, name: location.name });
        newGeo.zips = zips;
      }
    } else if (type === 'country') {
      const countries = [...(newGeo.countries || [])];
      if (!countries.includes(location.country_code)) {
        countries.push(location.country_code);
        newGeo.countries = countries;
      }
    }

    setGeoLocations(newGeo);
    setSearchResults(prev => prev.filter(r => r.key !== location.key));
  };

  const removeCity = (key: string) => {
    setGeoLocations(prev => ({
      ...prev,
      cities: (prev.cities || []).filter(c => c.key !== key),
    }));
  };

  const removeRegion = (key: string) => {
    setGeoLocations(prev => ({
      ...prev,
      regions: (prev.regions || []).filter(r => r.key !== key),
    }));
  };

  const removeZip = (key: string) => {
    setGeoLocations(prev => ({
      ...prev,
      zips: (prev.zips || []).filter(z => z.key !== key),
    }));
  };

  const removeCountry = (code: string) => {
    setGeoLocations(prev => ({
      ...prev,
      countries: (prev.countries || []).filter(c => c !== code),
    }));
  };

  const removeCustomLocation = (index: number) => {
    setGeoLocations(prev => ({
      ...prev,
      custom_locations: (prev.custom_locations || []).filter((_, i) => i !== index),
    }));
  };

  const handleSave = async () => {
    const { accessToken } = await getMetaCredentials();
    if (!accessToken) {
      toast.error('Token de acesso não encontrado');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/meta-campaign-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_targeting',
          accessToken,
          entityId,
          entityType,
          targeting: { geo_locations: geoLocations },
        }),
      });
      const data = await response.json();
      if (data.success) {
        toast.success('Segmentação geográfica atualizada!');
        onOpenChange(false);
        onActionComplete?.();
      } else {
        throw new Error(data.error || 'Erro desconhecido');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro desconhecido';
      toast.error(`Erro: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  const totalLocations = (geoLocations.cities?.length || 0) + (geoLocations.regions?.length || 0) + (geoLocations.zips?.length || 0) + (geoLocations.countries?.length || 0) + (geoLocations.custom_locations?.length || 0);

  const getLocationTypeLabel = (type: string) => {
    switch (type) {
      case 'city': return 'Cidade';
      case 'region': return 'Estado';
      case 'zip': return 'CEP';
      case 'country': return 'País';
      default: return type;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Segmentação Geográfica
          </DialogTitle>
          <DialogDescription>
            Edite as localizações da {entityType === 'campaign' ? 'campanha' : 'conjunto'} "{entityName}"
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Carregando...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current locations */}
            <div>
              <Label className="text-sm font-medium">Localizações atuais ({totalLocations})</Label>
              <div className="flex flex-wrap gap-1.5 mt-2 min-h-[40px] p-2 border rounded-md bg-muted/30">
                {totalLocations === 0 && (
                  <span className="text-xs text-muted-foreground">Nenhuma localização definida</span>
                )}
                {geoLocations.countries?.map(c => (
                  <Badge key={c} variant="secondary" className="text-xs gap-1">
                    <Globe className="h-3 w-3" />
                    {c}
                    <button onClick={() => removeCountry(c)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {geoLocations.regions?.map(r => (
                  <Badge key={r.key} variant="secondary" className="text-xs gap-1 bg-blue-100 dark:bg-blue-900/30">
                    <MapPin className="h-3 w-3" />
                    {r.name}
                    <button onClick={() => removeRegion(r.key)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {geoLocations.cities?.map(c => (
                  <Badge key={c.key} variant="secondary" className="text-xs gap-1 bg-green-100 dark:bg-green-900/30">
                    <MapPin className="h-3 w-3" />
                    {c.name}{c.region ? `, ${c.region}` : ''}
                    <button onClick={() => removeCity(c.key)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {geoLocations.zips?.map(z => (
                  <Badge key={z.key} variant="secondary" className="text-xs gap-1 bg-amber-100 dark:bg-amber-900/30">
                    📮 {z.name || z.key}
                    <button onClick={() => removeZip(z.key)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {geoLocations.custom_locations?.map((cl, i) => {
                  const name = cl.name || cl.primary_city || `${cl.latitude?.toFixed(2)}, ${cl.longitude?.toFixed(2)}`;
                  const radius = cl.radius ? ` (+${cl.radius}km)` : '';
                  return (
                    <Badge key={`custom-${i}`} variant="secondary" className="text-xs gap-1 bg-purple-100 dark:bg-purple-900/30">
                      📍 {name}{radius}
                      <button onClick={() => removeCustomLocation(i)} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            </div>

            {/* Search */}
            <div>
              <Label className="text-sm font-medium">Adicionar localização</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  placeholder="Buscar cidade, estado ou CEP..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchLocations()}
                />
                <Button size="sm" onClick={searchLocations} disabled={isSearching || !searchQuery.trim()}>
                  {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="border rounded-md max-h-[200px] overflow-y-auto">
                {searchResults.map((result) => (
                  <button
                    key={result.key}
                    className="w-full flex items-center justify-between p-2 hover:bg-muted/50 text-left text-sm border-b last:border-b-0"
                    onClick={() => addLocation(result)}
                  >
                    <div>
                      <span className="font-medium">{result.name}</span>
                      {result.region && <span className="text-muted-foreground">, {result.region}</span>}
                      {result.country_name && <span className="text-muted-foreground"> — {result.country_name}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {getLocationTypeLabel(result.type)}
                      </Badge>
                      <Plus className="h-4 w-4 text-primary" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MapPin className="h-4 w-4 mr-2" />}
            Salvar Segmentação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
