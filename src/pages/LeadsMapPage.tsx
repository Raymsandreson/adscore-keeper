import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { db } from "@/integrations/supabase";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin } from "lucide-react";
import { Link } from "react-router-dom";

// Fix default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface LeadPin {
  id: string;
  lead_name: string | null;
  lead_status: string | null;
  status: string | null;
  lead_city: string | null;
  lead_state: string | null;
  lead_phone: string | null;
  lead_lat: number;
  lead_lng: number;
  acolhedor: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6",
  closed: "#22c55e",
  refused: "#ef4444",
  lost: "#ef4444",
  default: "#a855f7",
};

function coloredIcon(color: string) {
  return L.divIcon({
    className: "lead-pin",
    html: `<div style="background:${color};width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 18],
    popupAnchor: [0, -18],
  });
}

function FitBounds({ pins }: { pins: LeadPin[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) return;
    const bounds = L.latLngBounds(pins.map((p) => [p.lead_lat, p.lead_lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  }, [pins, map]);
  return null;
}

export default function LeadsMapPage() {
  const [leads, setLeads] = useState<LeadPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error } = await db
        .from("leads")
        .select("id,lead_name,lead_status,status,lead_city,lead_state,lead_phone,lead_lat,lead_lng,acolhedor")
        .not("lead_lat", "is", null)
        .not("lead_lng", "is", null)
        .is("deleted_at", null)
        .limit(5000);
      if (!active) return;
      if (error) {
        console.error("[LeadsMap] load error", error);
        setLeads([]);
      } else {
        setLeads((data as any[])?.filter((l) => l.lead_lat && l.lead_lng) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const cities = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.lead_city) set.add(`${l.lead_city}${l.lead_state ? "/" + l.lead_state : ""}`);
    });
    return Array.from(set).sort();
  }, [leads]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.lead_status && set.add(l.lead_status));
    return Array.from(set).sort();
  }, [leads]);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (statusFilter !== "all" && l.lead_status !== statusFilter) return false;
      if (cityFilter !== "all") {
        const key = `${l.lead_city ?? ""}${l.lead_state ? "/" + l.lead_state : ""}`;
        if (key !== cityFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = `${l.lead_name ?? ""} ${l.lead_phone ?? ""} ${l.lead_city ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, statusFilter, cityFilter, search]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] w-full">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b bg-card">
        <div className="flex items-center gap-2 mr-2">
          <MapPin className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Mapa de Leads</h1>
        </div>
        <Input
          placeholder="Buscar por nome, telefone, cidade..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-9"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={cityFilter} onValueChange={setCityFilter}>
          <SelectTrigger className="w-[220px] h-9">
            <SelectValue placeholder="Cidade" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">Todas as cidades</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground">
          {loading ? (
            <span className="flex items-center gap-1">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
            </span>
          ) : (
            `${filtered.length} de ${leads.length} leads`
          )}
        </div>
      </div>

      <div className="flex-1 relative">
        <MapContainer
          center={[-14.235, -51.9253]}
          zoom={4}
          scrollWheelZoom
          className="w-full h-full"
          style={{ background: "hsl(var(--muted))" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds pins={filtered} />
          {filtered.map((lead) => {
            const color = STATUS_COLORS[lead.lead_status ?? ""] ?? STATUS_COLORS.default;
            return (
              <Marker
                key={lead.id}
                position={[lead.lead_lat, lead.lead_lng]}
                icon={coloredIcon(color)}
              >
                <Popup>
                  <div className="space-y-1 min-w-[180px]">
                    <div className="font-semibold">{lead.lead_name ?? "Sem nome"}</div>
                    {lead.lead_phone && (
                      <div className="text-xs text-muted-foreground">{lead.lead_phone}</div>
                    )}
                    <div className="text-xs">
                      {lead.lead_city}
                      {lead.lead_state ? `/${lead.lead_state}` : ""}
                    </div>
                    {lead.lead_status && (
                      <div className="text-xs">
                        Status: <span className="font-medium">{lead.lead_status}</span>
                      </div>
                    )}
                    {lead.acolhedor && (
                      <div className="text-xs">Acolhedor: {lead.acolhedor}</div>
                    )}
                    <Button asChild size="sm" className="w-full mt-2 h-7 text-xs">
                      <Link to={`/leads?lead=${lead.id}`}>Abrir lead</Link>
                    </Button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
