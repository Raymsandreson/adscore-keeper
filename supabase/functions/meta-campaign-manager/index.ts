import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CampaignRequest {
  action: 'update_status' | 'update_budget' | 'update_bid' | 'duplicate' | 'update_creative' | 'get_targeting' | 'update_targeting' | 'search_locations';
  accessToken: string;
  entityId: string;
  entityType: 'campaign' | 'adset' | 'ad';
  status?: 'ACTIVE' | 'PAUSED';
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidAmount?: number;
  bidStrategy?: string;
  adAccountId?: string;
  creativeData?: {
    title?: string;
    body?: string;
    linkDescription?: string;
    callToActionType?: string;
  };
  targeting?: {
    geo_locations?: {
      countries?: string[];
      cities?: { key: string; name?: string; radius?: number; distance_unit?: string }[];
      zips?: { key: string; name?: string }[];
      regions?: { key: string; name?: string }[];
      custom_locations?: { latitude: number; longitude: number; radius?: number; distance_unit?: string; name?: string }[];
    };
  };
  searchQuery?: string;
  locationType?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: CampaignRequest = await req.json();
    const { action, accessToken, entityId, entityType } = body;

    if (!accessToken || !action) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: accessToken, action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let result;

    switch (action) {
      case 'update_status':
        result = await updateStatus(accessToken, entityId, body.status!);
        break;
      case 'update_budget':
        result = await updateBudget(accessToken, entityId, entityType, body.dailyBudget, body.lifetimeBudget);
        break;
      case 'update_bid':
        result = await updateBid(accessToken, entityId, body.bidAmount, body.bidStrategy);
        break;
      case 'duplicate':
        result = await duplicateEntity(accessToken, entityId, entityType, body.adAccountId!);
        break;
      case 'update_creative':
        result = await updateCreative(accessToken, entityId, body.creativeData!);
        break;
      case 'get_targeting':
        if (entityType === 'campaign') {
          result = await getCampaignTargeting(accessToken, entityId);
        } else {
          result = await getTargeting(accessToken, entityId);
        }
        break;
      case 'update_targeting':
        if (entityType === 'campaign') {
          result = await updateCampaignTargeting(accessToken, entityId, body.targeting!);
        } else {
          result = await updateTargeting(accessToken, entityId, body.targeting!);
        }
        break;
      case 'search_locations':
        result = await searchLocations(accessToken, body.searchQuery!, body.locationType || 'adgeolocation');
        break;
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    console.log(`Action ${action} completed for ${entityType} ${entityId}:`, JSON.stringify(result).substring(0, 500));

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in meta-campaign-manager:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function getTargeting(accessToken: string, adSetId: string) {
  const url = `https://graph.facebook.com/v21.0/${adSetId}?access_token=${accessToken}&fields=targeting,name`;
  console.log(`[get_targeting] Fetching: ${url.replace(accessToken, 'TOKEN_HIDDEN')}`);
  const response = await fetch(url);
  const data = await response.json();

  console.log(`[get_targeting] Full API response keys:`, Object.keys(data));
  console.log(`[get_targeting] Full response JSON:`, JSON.stringify(data).substring(0, 3000));

  if (data.error) {
    throw new Error(data.error.message || 'Failed to get targeting');
  }

  const targeting = data.targeting || {};
  const geoLocations = targeting.geo_locations || {};
  
  console.log(`[get_targeting] targeting keys:`, Object.keys(targeting));
  console.log(`[get_targeting] geo_locations keys:`, Object.keys(geoLocations));
  console.log(`[get_targeting] geo_locations full:`, JSON.stringify(geoLocations));
  
  return {
    adSetId,
    name: data.name,
    targeting,
  };
}

async function getAdSetsForCampaign(accessToken: string, campaignId: string): Promise<string[]> {
  const url = `https://graph.facebook.com/v21.0/${campaignId}/adsets?access_token=${accessToken}&fields=id&limit=100`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Failed to get ad sets');
  return (data.data || []).map((a: any) => a.id);
}

async function getCampaignTargeting(accessToken: string, campaignId: string) {
  const adSetIds = await getAdSetsForCampaign(accessToken, campaignId);
  if (adSetIds.length === 0) {
    return { campaignId, adSetCount: 0, targeting: { geo_locations: {} } };
  }
  const first = await getTargeting(accessToken, adSetIds[0]);
  return { campaignId, adSetCount: adSetIds.length, adSetIds, ...first };
}

async function updateCampaignTargeting(
  accessToken: string,
  campaignId: string,
  targeting: { geo_locations?: any }
) {
  const adSetIds = await getAdSetsForCampaign(accessToken, campaignId);
  if (adSetIds.length === 0) throw new Error('Nenhum conjunto de anúncios encontrado nesta campanha');
  
  const results = [];
  const errors: any[] = [];
  for (const adSetId of adSetIds) {
    try {
      const r = await updateTargeting(accessToken, adSetId, targeting);
      results.push({ adSetId, success: true, ...r });
    } catch (e: any) {
      errors.push({ adSetId, error: e.message });
    }
  }
  return { campaignId, totalAdSets: adSetIds.length, updated: results.length, errors, results };
}

async function updateTargeting(
  accessToken: string,
  adSetId: string,
  targeting: {
    geo_locations?: {
      countries?: string[];
      cities?: { key: string; name?: string; radius?: number; distance_unit?: string }[];
      zips?: { key: string; name?: string }[];
      regions?: { key: string; name?: string }[];
      custom_locations?: { latitude: number; longitude: number; radius?: number; distance_unit?: string }[];
    };
  }
) {
  // Only send geo_locations in the targeting update - do NOT merge full targeting
  // as it includes read-only fields (targeting_automation, publisher_platforms, etc.)
  // that cause "Application does not have permission" errors
  const updateTargetingPayload = {
    geo_locations: targeting.geo_locations,
  };

  console.log(`[update_targeting] Updating adset ${adSetId} with:`, JSON.stringify(updateTargetingPayload));

  // Use form-encoded POST as per Meta API docs
  const params = new URLSearchParams();
  params.append('access_token', accessToken);
  params.append('targeting', JSON.stringify(updateTargetingPayload));

  const updateUrl = `https://graph.facebook.com/v21.0/${adSetId}`;
  const updateResp = await fetch(updateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const updateData = await updateResp.json();

  if (updateData.error) {
    throw new Error(updateData.error.message || 'Failed to update targeting');
  }

  return { adSetId, updatedGeoLocations: targeting.geo_locations, ...updateData };
}

// Search locations using Meta Marketing API
// Docs: https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting/
// type=adgeolocation searches across all location types (cities, regions, countries, zips)
// type=adcountry, adregion, adcity, adzip for specific types
function isBrazilianZipQuery(query: string) {
  return /^\d{5}-?\d{3}$/.test(query.trim());
}

function formatBrazilianZip(query: string) {
  const digits = query.replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : query.trim();
}

async function fetchLocationSearch(
  accessToken: string,
  type: string,
  query: string,
  options?: { locationTypes?: string[] },
) {
  const params = new URLSearchParams({
    type,
    q: query,
    access_token: accessToken,
    locale: 'pt_BR',
    limit: '25',
  });

  if (options?.locationTypes?.length) {
    params.set('location_types', JSON.stringify(options.locationTypes));
  }

  const url = `https://graph.facebook.com/v21.0/search?${params.toString()}`;
  console.log(
    `[search_locations] Searching for "${query}" with type=${type} location_types=${JSON.stringify(options?.locationTypes || [])}`,
  );

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    console.error(`[search_locations] Error for type=${type} q="${query}":`, JSON.stringify(data.error));
    throw new Error(data.error.message || 'Failed to search locations');
  }

  return data.data || [];
}

function isPostalCodeLikeQuery(query: string) {
  const normalized = query.trim();
  return /^\d{4,10}$/.test(normalized) || /^\d{3,6}-\d{2,4}$/.test(normalized);
}

function getLocationTypeFilters(locationType: string): string[] | undefined {
  switch (locationType) {
    case 'adcountry':
      return ['country'];
    case 'adregion':
      return ['region'];
    case 'adcity':
      return ['city'];
    case 'adzip':
      return ['zip'];
    default:
      return undefined;
  }
}

async function searchLocations(accessToken: string, query: string, locationType: string) {
  const trimmedQuery = query.trim();
  const searchPlan: Array<{ type: string; query: string; locationTypes?: string[] }> = [];

  if (isBrazilianZipQuery(trimmedQuery)) {
    // Convert CEP to coordinates via ViaCEP + Nominatim, return as custom_location
    try {
      const cleanCep = trimmedQuery.replace(/\D/g, '');
      let cityName = '';
      let stateName = '';
      let neighborhood = '';
      let street = '';

      // Try ViaCEP first
      try {
        const viaCepRes = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        const viaCepData = await viaCepRes.json();
        if (!viaCepData.erro) {
          cityName = viaCepData.localidade || '';
          stateName = viaCepData.uf || '';
          neighborhood = viaCepData.bairro || '';
          street = viaCepData.logradouro || '';
        }
      } catch (e) {
        console.log('ViaCEP failed, trying BrasilAPI fallback');
      }

      // Fallback: try BrasilAPI
      if (!cityName) {
        try {
          const brasilRes = await fetch(`https://brasilapi.com.br/api/cep/v2/${cleanCep}`);
          const brasilData = await brasilRes.json();
          if (brasilData.city) {
            cityName = brasilData.city;
            stateName = brasilData.state || '';
            neighborhood = brasilData.neighborhood || '';
            street = brasilData.street || '';
          }
        } catch (e) {
          console.log('BrasilAPI also failed');
        }
      }

      // Fallback: use CEP prefix to resolve city via known ranges
      if (!cityName) {
        // Brazilian CEP prefix → city mapping (3-digit prefixes for major cities)
        const cepCityMap: Record<string, { city: string; uf: string }> = {
          '010': { city: 'São Paulo', uf: 'SP' }, '011': { city: 'São Paulo', uf: 'SP' },
          '012': { city: 'São José dos Campos', uf: 'SP' }, '013': { city: 'Santos', uf: 'SP' },
          '014': { city: 'Campinas', uf: 'SP' }, '015': { city: 'Sorocaba', uf: 'SP' },
          '016': { city: 'Ribeirão Preto', uf: 'SP' }, '019': { city: 'Americana', uf: 'SP' },
          '200': { city: 'Rio de Janeiro', uf: 'RJ' }, '201': { city: 'Rio de Janeiro', uf: 'RJ' },
          '210': { city: 'Niterói', uf: 'RJ' }, '240': { city: 'Nova Iguaçu', uf: 'RJ' },
          '300': { city: 'Belo Horizonte', uf: 'MG' }, '301': { city: 'Belo Horizonte', uf: 'MG' },
          '400': { city: 'Salvador', uf: 'BA' }, '401': { city: 'Salvador', uf: 'BA' },
          '450': { city: 'Feira de Santana', uf: 'BA' },
          '500': { city: 'Recife', uf: 'PE' }, '501': { city: 'Recife', uf: 'PE' },
          '570': { city: 'Maceió', uf: 'AL' },
          '580': { city: 'João Pessoa', uf: 'PB' },
          '590': { city: 'Natal', uf: 'RN' },
          '600': { city: 'Fortaleza', uf: 'CE' }, '601': { city: 'Fortaleza', uf: 'CE' },
          '630': { city: 'Juazeiro do Norte', uf: 'CE' },
          '640': { city: 'Teresina', uf: 'PI' }, '641': { city: 'Teresina', uf: 'PI' },
          '650': { city: 'São Luís', uf: 'MA' }, '651': { city: 'São Luís', uf: 'MA' },
          '660': { city: 'Belém', uf: 'PA' }, '661': { city: 'Belém', uf: 'PA' },
          '690': { city: 'Manaus', uf: 'AM' }, '691': { city: 'Manaus', uf: 'AM' },
          '700': { city: 'Brasília', uf: 'DF' }, '701': { city: 'Brasília', uf: 'DF' },
          '740': { city: 'Goiânia', uf: 'GO' }, '741': { city: 'Goiânia', uf: 'GO' },
          '780': { city: 'Cuiabá', uf: 'MT' },
          '790': { city: 'Campo Grande', uf: 'MS' },
          '800': { city: 'Curitiba', uf: 'PR' }, '801': { city: 'Curitiba', uf: 'PR' },
          '860': { city: 'Londrina', uf: 'PR' }, '870': { city: 'Maringá', uf: 'PR' },
          '880': { city: 'Florianópolis', uf: 'SC' }, '890': { city: 'Joinville', uf: 'SC' },
          '900': { city: 'Porto Alegre', uf: 'RS' }, '901': { city: 'Porto Alegre', uf: 'RS' },
          '490': { city: 'Aracaju', uf: 'SE' },
          '760': { city: 'Palmas', uf: 'TO' },
          '769': { city: 'Porto Velho', uf: 'RO' },
          '696': { city: 'Rio Branco', uf: 'AC' },
          '689': { city: 'Macapá', uf: 'AP' },
          '693': { city: 'Boa Vista', uf: 'RR' },
        };
        
        const prefix3 = cleanCep.substring(0, 3);
        const prefix2 = cleanCep.substring(0, 2);
        const match = cepCityMap[prefix3];
        
        if (match) {
          cityName = match.city;
          stateName = match.uf;
          console.log(`CEP ${cleanCep} resolved via prefix map: ${cityName}, ${stateName}`);
        } else {
          // Broader state-level fallback by first digit
          const stateMap: Record<string, string> = {
            '0': 'SP', '1': 'SP', '2': 'RJ', '3': 'MG', '4': 'BA',
            '5': 'PE', '6': 'CE', '7': 'DF', '8': 'PR', '9': 'RS',
          };
          stateName = stateMap[cleanCep[0]] || '';
        }
      }

      // Geocode via Nominatim with available address data
      const addressParts = [street, neighborhood, cityName, stateName, 'Brazil'].filter(Boolean);
      let lat: number | null = null;
      let lng: number | null = null;

      // Try full address first
      for (const query of [
        addressParts.join(', '),
        [cityName, stateName, 'Brazil'].filter(Boolean).join(', '),
      ]) {
        if (!query || query === 'Brazil') continue;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`,
          { headers: { 'User-Agent': 'LovableApp/1.0' } }
        );
        const data = await res.json();
        if (data.length > 0) {
          lat = parseFloat(data[0].lat);
          lng = parseFloat(data[0].lon);
          break;
        }
      }

      if (lat === null || lng === null) {
        throw new Error('Coordenadas não encontradas');
      }

      const locationName = [neighborhood, cityName, stateName].filter(Boolean).join(', ');
      console.log(`CEP ${cleanCep} resolved to coordinates: ${lat}, ${lng} (${locationName})`);

      return [{
        key: `custom_${lat}_${lng}`,
        name: `📍 ${locationName} (CEP ${cleanCep})`,
        type: 'custom_location',
        country_code: 'BR',
        country_name: 'Brazil',
        latitude: lat,
        longitude: lng,
        radius: 10,
        distance_unit: 'kilometer',
      }];
    } catch (e) {
      console.error('CEP geocoding failed:', e);
      throw new Error(`Não foi possível converter o CEP "${trimmedQuery}" em coordenadas. Tente buscar pelo nome da cidade.`);
    }
  }

  if (isPostalCodeLikeQuery(trimmedQuery)) {
    searchPlan.push(
      { type: 'adgeolocation', query: trimmedQuery, locationTypes: ['zip'] },
      { type: 'adgeolocation', query: trimmedQuery },
    );
  } else {
    searchPlan.push({
      type: 'adgeolocation',
      query: trimmedQuery,
      locationTypes: getLocationTypeFilters(locationType),
    });
  }

  const seen = new Set<string>();
  const results: any[] = [];

  for (const step of searchPlan) {
    try {
      const stepResults = await fetchLocationSearch(accessToken, step.type, step.query, {
        locationTypes: step.locationTypes,
      });

      for (const item of stepResults) {
        const dedupeKey = `${item.key || item.id || item.name}-${item.type || step.type}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        results.push(item);
      }

      if (results.length > 0 && isBrazilianZipQuery(trimmedQuery)) {
        break;
      }
    } catch (e) {
      console.warn(`[search_locations] Step type=${step.type} q="${step.query}" failed:`, e);
    }
  }

  console.log(`[search_locations] Found ${results.length} results for "${trimmedQuery}"`);
  if (results.length > 0) {
    console.log(`[search_locations] First result:`, JSON.stringify(results[0]));
  }

  return { results };
}

async function updateStatus(accessToken: string, entityId: string, status: 'ACTIVE' | 'PAUSED') {
  const url = `https://graph.facebook.com/v21.0/${entityId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken, status }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Failed to update status');
  return { entityId, newStatus: status, ...data };
}

async function updateBudget(accessToken: string, entityId: string, entityType: string, dailyBudget?: number, lifetimeBudget?: number) {
  const url = `https://graph.facebook.com/v21.0/${entityId}`;
  const params: Record<string, any> = { access_token: accessToken };
  if (dailyBudget !== undefined) params.daily_budget = Math.round(dailyBudget * 100);
  if (lifetimeBudget !== undefined) params.lifetime_budget = Math.round(lifetimeBudget * 100);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Failed to update budget');
  return { entityId, dailyBudget, lifetimeBudget, ...data };
}

async function updateBid(accessToken: string, entityId: string, bidAmount?: number, bidStrategy?: string) {
  const url = `https://graph.facebook.com/v21.0/${entityId}`;
  const params: Record<string, any> = { access_token: accessToken };
  if (bidAmount !== undefined) params.bid_amount = Math.round(bidAmount * 100);
  if (bidStrategy) params.bid_strategy = bidStrategy;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Failed to update bid');
  return { entityId, bidAmount, bidStrategy, ...data };
}

async function duplicateEntity(accessToken: string, entityId: string, entityType: string, adAccountId: string) {
  if (entityType === 'campaign') {
    const url = `https://graph.facebook.com/v21.0/${entityId}/copies`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken, deep_copy: true, status_option: 'PAUSED' }) });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Failed to duplicate campaign');
    return { originalId: entityId, newId: data.copied_campaign_id, ...data };
  }
  if (entityType === 'adset') {
    const url = `https://graph.facebook.com/v21.0/${entityId}/copies`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken, deep_copy: true, status_option: 'PAUSED' }) });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Failed to duplicate ad set');
    return { originalId: entityId, newId: data.copied_adset_id, ...data };
  }
  if (entityType === 'ad') {
    const url = `https://graph.facebook.com/v21.0/${entityId}/copies`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken }) });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Failed to duplicate ad');
    return { originalId: entityId, newId: data.copied_ad_id, ...data };
  }
  throw new Error('Invalid entity type for duplication');
}

async function updateCreative(accessToken: string, adId: string, creativeData: { title?: string; body?: string; linkDescription?: string; callToActionType?: string }) {
  const adUrl = `https://graph.facebook.com/v21.0/${adId}?fields=creative{id}&access_token=${accessToken}`;
  const adResponse = await fetch(adUrl);
  const adData = await adResponse.json();
  if (adData.error) throw new Error(adData.error.message || 'Failed to get ad creative');
  const creativeId = adData.creative?.id;
  if (!creativeId) throw new Error('Creative ID not found for this ad');

  const creativeUrl = `https://graph.facebook.com/v21.0/${creativeId}?fields=object_story_spec,name&access_token=${accessToken}`;
  const creativeResponse = await fetch(creativeUrl);
  const currentCreative = await creativeResponse.json();
  if (currentCreative.error) throw new Error(currentCreative.error.message || 'Failed to get creative details');

  const objectStorySpec = currentCreative.object_story_spec || {};
  if (objectStorySpec.link_data) {
    if (creativeData.body !== undefined) objectStorySpec.link_data.message = creativeData.body;
    if (creativeData.title !== undefined) objectStorySpec.link_data.name = creativeData.title;
    if (creativeData.linkDescription !== undefined) objectStorySpec.link_data.description = creativeData.linkDescription;
    if (creativeData.callToActionType !== undefined) objectStorySpec.link_data.call_to_action = { type: creativeData.callToActionType };
  } else if (objectStorySpec.video_data) {
    if (creativeData.body !== undefined) objectStorySpec.video_data.message = creativeData.body;
    if (creativeData.title !== undefined) objectStorySpec.video_data.title = creativeData.title;
    if (creativeData.callToActionType !== undefined) objectStorySpec.video_data.call_to_action = { type: creativeData.callToActionType };
  }

  const updateUrl = `https://graph.facebook.com/v21.0/${creativeId}`;
  const updateResponse = await fetch(updateUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken, object_story_spec: JSON.stringify(objectStorySpec) }) });
  const updateData = await updateResponse.json();
  if (updateData.error) throw new Error(updateData.error.message || 'Failed to update creative');
  return { adId, creativeId, updatedFields: creativeData, ...updateData };
}
