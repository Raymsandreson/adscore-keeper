import { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import "leaflet/dist/leaflet.css";

// Fix default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface PinMapProps {
  onAddPin: (lat: number, lng: number, radius: number) => void;
  existingPins?: Array<{ latitude: number; longitude: number; radius?: number }>;
}

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FlyToPin({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], 12, { duration: 0.5 });
  }, [lat, lng, map]);
  return null;
}

export const GeoTargetingPinMap = ({ onAddPin, existingPins = [] }: PinMapProps) => {
  const [tempPin, setTempPin] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState("17");
  const [cepInput, setCepInput] = useState("");
  const [isSearchingCep, setIsSearchingCep] = useState(false);

  const handleMapClick = (lat: number, lng: number) => {
    setTempPin({ lat, lng });
  };

  const handleConfirm = () => {
    if (!tempPin) return;
    onAddPin(tempPin.lat, tempPin.lng, parseInt(radius));
    setTempPin(null);
  };

  const searchByCep = async () => {
    const clean = cepInput.replace(/\D/g, "");
    if (clean.length !== 8) {
      toast.error("CEP inválido. Digite 8 dígitos.");
      return;
    }

    setIsSearchingCep(true);
    try {
      // Step 1: ViaCEP to get address
      const viaCepRes = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const viaCepData = await viaCepRes.json();
      if (viaCepData.erro) {
        toast.error("CEP não encontrado.");
        return;
      }

      // Step 2: Nominatim to geocode the address
      const searchParts = [
        viaCepData.logradouro,
        viaCepData.bairro,
        viaCepData.localidade,
        viaCepData.uf,
        "Brazil",
      ].filter(Boolean);

      const nominatimRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchParts.join(", "))}&limit=1&countrycodes=br`,
        { headers: { "Accept-Language": "pt-BR" } }
      );
      const nominatimData = await nominatimRes.json();

      if (!nominatimData.length) {
        // Fallback: try city + state only
        const fallbackRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(`${viaCepData.localidade}, ${viaCepData.uf}, Brazil`)}&limit=1&countrycodes=br`,
          { headers: { "Accept-Language": "pt-BR" } }
        );
        const fallbackData = await fallbackRes.json();

        if (!fallbackData.length) {
          toast.error("Não foi possível localizar coordenadas para este CEP.");
          return;
        }

        const lat = parseFloat(fallbackData[0].lat);
        const lng = parseFloat(fallbackData[0].lon);
        setTempPin({ lat, lng });
        toast.success(`CEP ${clean} → ${viaCepData.localidade}/${viaCepData.uf} (aproximado)`);
        return;
      }

      const lat = parseFloat(nominatimData[0].lat);
      const lng = parseFloat(nominatimData[0].lon);
      setTempPin({ lat, lng });
      toast.success(`CEP ${clean} → ${viaCepData.logradouro || viaCepData.localidade}, ${viaCepData.localidade}/${viaCepData.uf}`);
    } catch (err) {
      toast.error("Erro ao buscar CEP. Tente novamente.");
      console.error("CEP geocoding error:", err);
    } finally {
      setIsSearchingCep(false);
    }
  };

  const radiusMeters = parseInt(radius) * 1000;

  const defaultCenter = useMemo(() => {
    if (existingPins.length > 0) {
      return [existingPins[0].latitude, existingPins[0].longitude] as [number, number];
    }
    return [-14.235, -51.9253] as [number, number];
  }, [existingPins]);

  return (
    <div className="space-y-3">
      {/* CEP search */}
      <div className="flex gap-2">
        <Input
          placeholder="Buscar por CEP (ex: 64000-020)"
          value={cepInput}
          onChange={(e) => setCepInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && searchByCep()}
          className="text-sm h-9"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={searchByCep}
          disabled={isSearchingCep || !cepInput.trim()}
          className="gap-1 shrink-0"
        >
          {isSearchingCep ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          CEP
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Digite um CEP acima ou clique no mapa para soltar um pino.
      </p>

      <div className="rounded-md overflow-hidden border" style={{ height: 300 }}>
        <MapContainer
          center={defaultCenter}
          zoom={existingPins.length > 0 ? 10 : 4}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onClick={handleMapClick} />

          {tempPin && (
            <>
              <FlyToPin lat={tempPin.lat} lng={tempPin.lng} />
              <Marker position={[tempPin.lat, tempPin.lng]} />
              <Circle
                center={[tempPin.lat, tempPin.lng]}
                radius={radiusMeters}
                pathOptions={{ color: "#8b5cf6", fillColor: "#8b5cf6", fillOpacity: 0.15 }}
              />
            </>
          )}

          {existingPins.map((pin, i) => (
            <Circle
              key={`existing-${i}`}
              center={[pin.latitude, pin.longitude]}
              radius={(pin.radius || 17) * 1000}
              pathOptions={{ color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.1 }}
            />
          ))}
        </MapContainer>
      </div>

      {tempPin && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs">
              Pino: ({tempPin.lat.toFixed(4)}, {tempPin.lng.toFixed(4)})
            </Label>
            <Select value={radius} onValueChange={setRadius}>
              <SelectTrigger className="text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 5, 10, 16, 17, 20, 24, 29, 30, 40, 50, 80].map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {r} km
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="gap-1" onClick={handleConfirm}>
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
      )}
    </div>
  );
};
