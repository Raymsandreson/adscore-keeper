import { useState, useCallback } from 'react';

interface GeolocationResult {
  city: string;
  state: string;
  loading: boolean;
  error: string | null;
}

export function useGeolocation() {
  const [result, setResult] = useState<GeolocationResult>({
    city: '',
    state: '',
    loading: false,
    error: null,
  });

  const fetchLocation = useCallback(async (): Promise<{ city: string; state: string } | null> => {
    setResult(prev => ({ ...prev, loading: true, error: null }));

    try {
      // Get coordinates from browser
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocalização não suportada pelo navegador'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 300000, // cache 5 min
        });
      });

      const { latitude, longitude } = position.coords;

      // Use IBGE reverse geocoding API
      const response = await fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome`
      );

      // IBGE doesn't have a direct reverse geocoding, use Nominatim (OpenStreetMap)
      const nominatimRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=pt-BR`
      );

      if (!nominatimRes.ok) throw new Error('Erro ao buscar localização');

      const data = await nominatimRes.json();
      const address = data.address || {};

      // Extract city and state from Nominatim response
      const city = address.city || address.town || address.village || address.municipality || '';
      const stateCode = address['ISO3166-2-lvl4']?.replace('BR-', '') || '';

      if (!city && !stateCode) {
        throw new Error('Não foi possível determinar sua localização');
      }

      const locationResult = { city, state: stateCode };
      setResult({ ...locationResult, loading: false, error: null });
      return locationResult;
    } catch (err: any) {
      let errorMsg = 'Erro ao obter localização';
      if (err.code === 1) errorMsg = 'Permissão de localização negada';
      else if (err.code === 2) errorMsg = 'Localização indisponível';
      else if (err.code === 3) errorMsg = 'Tempo esgotado ao buscar localização';
      else if (err.message) errorMsg = err.message;

      setResult(prev => ({ ...prev, loading: false, error: errorMsg }));
      return null;
    }
  }, []);

  return {
    ...result,
    fetchLocation,
  };
}
