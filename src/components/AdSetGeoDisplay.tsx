import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { MapPin, Loader2 } from "lucide-react";
import { getMetaCredentials } from "@/utils/metaCredentials";

interface AdSetGeoDisplayProps {
  adSetId: string;
}

export const AdSetGeoDisplay = ({ adSetId }: AdSetGeoDisplayProps) => {
  const [locations, setLocations] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (fetched) return;

    // Skip synthetic/fallback IDs (e.g. "adset_1") — only real numeric Meta IDs
    if (!adSetId || !/^\d+$/.test(adSetId)) {
      setFetched(true);
      return;
    }

    const fetchGeo = async () => {
      const { accessToken } = await getMetaCredentials();
      if (!accessToken) return;

      setIsLoading(true);
      try {
        const response = await fetch(`https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/meta-campaign-manager`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'get_targeting',
            accessToken,
            entityId: adSetId,
            entityType: 'adset',
          }),
        });
        const data = await response.json();
        if (data.success) {
          const geo = data.data.targeting?.geo_locations || {};
          const locs: string[] = [];
          geo.countries?.forEach((c: string) => locs.push(c));
          geo.regions?.forEach((r: any) => locs.push(r.name || r.key));
          geo.cities?.forEach((c: any) => locs.push(c.name));
          geo.zips?.forEach((z: any) => locs.push(z.name || z.key));
          geo.custom_locations?.forEach((cl: any) => {
            const name = cl.name || cl.primary_city || `${cl.latitude?.toFixed(2)}, ${cl.longitude?.toFixed(2)}`;
            const radius = cl.radius ? ` (+${cl.radius}km)` : '';
            locs.push(`${name}${radius}`);
          });
          geo.geo_markets?.forEach((gm: any) => locs.push(gm.name || gm.key));
          setLocations(locs);
        }
      } catch (error) {
        console.error('Error fetching geo:', error);
      } finally {
        setIsLoading(false);
        setFetched(true);
      }
    };

    fetchGeo();
  }, [adSetId, fetched]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Carregando locais...</span>
      </div>
    );
  }

  if (locations.length === 0 && fetched) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
      {locations.slice(0, 3).map((loc, i) => (
        <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0">
          {loc}
        </Badge>
      ))}
      {locations.length > 3 && (
        <span className="text-[10px] text-muted-foreground">+{locations.length - 3}</span>
      )}
    </div>
  );
};
