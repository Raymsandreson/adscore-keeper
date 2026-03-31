import { useState, useCallback } from 'react';

interface ViaCepResult {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
}

interface AddressData {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  cep: string;
  lat?: number;
  lng?: number;
}

export function useViaCep() {
  const [loading, setLoading] = useState(false);

  const fetchAddress = useCallback(async (cep: string): Promise<AddressData | null> => {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8) return null;

    setLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
      const data: ViaCepResult = await res.json();
      if (data.erro) return null;

      return {
        street: data.logradouro,
        neighborhood: data.bairro,
        city: data.localidade,
        state: data.uf,
        cep: data.cep,
      };
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { fetchAddress, loading };
}
