// Sugere "pontes" (estabelecimentos próximos) para um lead, via Google Maps.
// Fluxo: geocodifica o ENDEREÇO COMPLETO do lead (rua+num+bairro+cidade+CEP) ->
//        se a precisão for de nível casa/rua, faz Places Nearby Search por tipo ->
//        ranqueia por distância + tipo + "fixture local" e retorna a lista.
//
// NÃO persiste nada nesta fatia — é a etapa de validação. POST { lead_id, radius_m?, types? }.
//
// Reaproveita os mesmos secrets do backfill-lead-geocode (LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY)
// e o mesmo Connector Gateway. Lê os leads via service-role (embutido se deployada no Externo,
// EXTERNAL_* se deployada no Cloud).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

// Precisão de geocoding aceitável para raio de vizinhança. APPROXIMATE = centro da cidade -> rejeita.
const HOUSE_LEVEL = new Set(["ROOFTOP", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER"]);

// Tipos de estabelecimento buscados (Places "type"), com peso de "probabilidade de conhecer o morador".
// Igreja e comércio de bairro no topo; rede grande/genérico embaixo.
const DEFAULT_TYPES: { type: string; keyword?: string; weight: number; label: string }[] = [
  { type: "church", weight: 1.0, label: "Igreja" },
  { type: "place_of_worship", weight: 1.0, label: "Local de culto" },
  { type: "bakery", weight: 0.9, label: "Padaria" },
  { type: "convenience_store", weight: 0.88, label: "Mercadinho / conveniência" },
  { type: "supermarket", weight: 0.8, label: "Mercado / supermercado" },
  { type: "pharmacy", weight: 0.7, label: "Farmácia" },
  { type: "restaurant", weight: 0.6, label: "Restaurante" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
    // Se deployada no próprio projeto Externo (onde moram os leads), usa o service-role embutido.
    // Se deployada no Cloud (como o backfill), usa EXTERNAL_* para alcançar os leads de fora.
    const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL");
    const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      return json({ success: false, error: "Missing Google Maps gateway credentials" });
    }
    if (!EXT_URL || !EXT_KEY) {
      return json({ success: false, error: "Missing Supabase credentials" });
    }

    const body = await req.json().catch(() => ({}));
    const leadId = String(body.lead_id || "").trim();
    if (!leadId) return json({ success: false, error: "lead_id is required" });

    const radius = Math.min(Math.max(Number(body.radius_m) || 5000, 200), 5000);
    const wantedTypes = Array.isArray(body.types) && body.types.length
      ? DEFAULT_TYPES.filter((t) => body.types.includes(t.type))
      : DEFAULT_TYPES;

    const gwHeaders = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
    };

    const db = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });

    const { data: lead, error } = await db
      .from("leads")
      .select("id, street, street_number, neighborhood, city, state, cep, accident_address, visit_address, visit_city, visit_state")
      .eq("id", leadId)
      .maybeSingle();

    if (error) return json({ success: false, error: error.message });
    if (!lead) return json({ success: false, error: "lead not found" });

    // Monta o endereço mais preciso disponível. Prioriza os campos estruturados; cai pra texto livre.
    const structured = [
      [lead.street, lead.street_number].filter(Boolean).join(", "),
      lead.neighborhood,
      lead.city,
      lead.state,
      lead.cep && lead.cep !== "00000000" ? lead.cep : null,
    ].filter(Boolean).join(", ");

    const freeText = [lead.accident_address || lead.visit_address, lead.visit_city || lead.city, lead.visit_state || lead.state]
      .filter(Boolean).join(", ");

    const addressStr = (structured.length > (lead.city?.length || 0) + 3 ? structured : freeText || structured);
    if (!addressStr) return json({ success: false, error: "lead has no address to geocode" });

    // 1) Geocode do endereço completo.
    const geoUrl = `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(addressStr + ", Brasil")}&region=br&language=pt-BR`;
    const geoResp = await fetch(geoUrl, { headers: gwHeaders });
    const geoData = await geoResp.json();
    const top = geoData?.results?.[0];
    const loc = top?.geometry?.location;
    const locType = top?.geometry?.location_type as string | undefined;

    if (!loc || typeof loc.lat !== "number") {
      return json({ success: false, error: "geocode failed", geocode_status: geoData?.status, address_used: addressStr });
    }

    const preciseEnough = !!locType && HOUSE_LEVEL.has(locType);

    // 2) Se não for nível casa/rua, para aqui e avisa — não sugere pontes de centro de cidade.
    if (!preciseEnough) {
      return json({
        success: true,
        precise_enough: false,
        location_type: locType,
        center: { lat: loc.lat, lng: loc.lng },
        address_used: addressStr,
        formatted_address: top?.formatted_address,
        message: "Endereço muito impreciso (nível cidade). Cadastre rua/número/CEP para sugerir pontes.",
        suggestions: [],
      });
    }

    // 3) Nearby Search por tipo, dedup por place_id.
    const byPlace = new Map<string, any>();
    for (const t of wantedTypes) {
      const params = new URLSearchParams({
        location: `${loc.lat},${loc.lng}`,
        radius: String(radius),
        type: t.type,
        language: "pt-BR",
      });
      if (t.keyword) params.set("keyword", t.keyword);
      const url = `${GATEWAY_URL}/maps/api/place/nearbysearch/json?${params.toString()}`;
      const r = await fetch(url, { headers: gwHeaders });
      const d = await r.json();
      for (const place of (d?.results || [])) {
        const pid = place.place_id;
        if (!pid) continue;
        const plat = place.geometry?.location?.lat;
        const plng = place.geometry?.location?.lng;
        if (typeof plat !== "number" || typeof plng !== "number") continue;
        const dist = haversine(loc.lat, loc.lng, plat, plng);
        if (dist > radius) continue;
        const existing = byPlace.get(pid);
        // mantém a classificação de tipo de maior peso quando o mesmo lugar cai em vários tipos
        if (!existing || t.weight > existing._typeWeight) {
          byPlace.set(pid, {
            place_id: pid,
            name: place.name,
            address: place.vicinity,
            type_label: t.label,
            google_type: t.type,
            lat: plat,
            lng: plng,
            distance_m: Math.round(dist),
            rating: place.rating ?? null,
            user_ratings_total: place.user_ratings_total ?? null,
            _typeWeight: t.weight,
          });
        }
      }
    }

    // 4) Score: distância (60%) + tipo (30%) + "fixture local" (10%).
    const suggestions = [...byPlace.values()].map((p) => {
      const distScore = Math.max(0, 1 - p.distance_m / radius);
      const typeScore = p._typeWeight;
      const fixtureScore = fixtureLocal(p.user_ratings_total);
      const score = distScore * 0.6 + typeScore * 0.3 + fixtureScore * 0.1;
      const { _typeWeight, ...rest } = p;
      return { ...rest, score: Math.round(score * 100) };
    }).sort((a, b) => b.score - a.score);

    return json({
      success: true,
      precise_enough: true,
      location_type: locType,
      center: { lat: loc.lat, lng: loc.lng },
      address_used: addressStr,
      formatted_address: top?.formatted_address,
      radius_m: radius,
      count: suggestions.length,
      suggestions,
    });
  } catch (e: any) {
    return json({ success: false, error: e.message });
  }
});

// Distância em metros (Haversine).
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Heurística: comércio de bairro (dezenas a poucas centenas de avaliações) é onde alguém
// conhece o morador. 0 avaliações = incerto; milhares = rede grande/impessoal.
function fixtureLocal(total: number | null): number {
  if (total == null || total === 0) return 0.4;
  if (total <= 300) return 1.0;
  if (total <= 1000) return 0.6;
  return 0.3;
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
