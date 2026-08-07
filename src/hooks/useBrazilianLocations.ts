import { useState, useEffect } from 'react';

interface State {
  id: number;
  sigla: string;
  nome: string;
}

interface City {
  id: number;
  nome: string;
}

// Lista estática de estados brasileiros para carregamento mais rápido
const BRAZILIAN_STATES: State[] = [
  { id: 12, sigla: 'AC', nome: 'Acre' },
  { id: 27, sigla: 'AL', nome: 'Alagoas' },
  { id: 16, sigla: 'AP', nome: 'Amapá' },
  { id: 13, sigla: 'AM', nome: 'Amazonas' },
  { id: 29, sigla: 'BA', nome: 'Bahia' },
  { id: 23, sigla: 'CE', nome: 'Ceará' },
  { id: 53, sigla: 'DF', nome: 'Distrito Federal' },
  { id: 32, sigla: 'ES', nome: 'Espírito Santo' },
  { id: 52, sigla: 'GO', nome: 'Goiás' },
  { id: 21, sigla: 'MA', nome: 'Maranhão' },
  { id: 51, sigla: 'MT', nome: 'Mato Grosso' },
  { id: 50, sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { id: 31, sigla: 'MG', nome: 'Minas Gerais' },
  { id: 15, sigla: 'PA', nome: 'Pará' },
  { id: 25, sigla: 'PB', nome: 'Paraíba' },
  { id: 41, sigla: 'PR', nome: 'Paraná' },
  { id: 26, sigla: 'PE', nome: 'Pernambuco' },
  { id: 22, sigla: 'PI', nome: 'Piauí' },
  { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
  { id: 24, sigla: 'RN', nome: 'Rio Grande do Norte' },
  { id: 43, sigla: 'RS', nome: 'Rio Grande do Sul' },
  { id: 11, sigla: 'RO', nome: 'Rondônia' },
  { id: 14, sigla: 'RR', nome: 'Roraima' },
  { id: 42, sigla: 'SC', nome: 'Santa Catarina' },
  { id: 35, sigla: 'SP', nome: 'São Paulo' },
  { id: 28, sigla: 'SE', nome: 'Sergipe' },
  { id: 17, sigla: 'TO', nome: 'Tocantins' },
];

/**
 * O DF tem um município só (Brasília, IBGE 5300108), então a API do IBGE
 * devolve uma opção única e o usuário não consegue selecionar Samambaia,
 * Ceilândia, Taguatinga etc. Estas são as 34 regiões administrativas
 * restantes (RA II a RA XXXV) — Plano Piloto/Brasília já vem do IBGE.
 *
 * Os ids são sintéticos (9 dígitos, prefixo do código de Brasília) só para
 * servir de `key` no select; não são códigos IBGE de município. Ao gravar,
 * o valor é o nome da RA — `findMunicipality` em `src/lib/geo/municipalities.ts`
 * já resolve qualquer RA do DF para Brasília no mapa e nos relatórios.
 */
const DF_ADMINISTRATIVE_REGIONS: City[] = [
  'Água Quente',
  'Águas Claras',
  'Arapoanga',
  'Arniqueira',
  'Brazlândia',
  'Candangolândia',
  'Ceilândia',
  'Cruzeiro',
  'Fercal',
  'Gama',
  'Guará',
  'Itapoã',
  'Jardim Botânico',
  'Lago Norte',
  'Lago Sul',
  'Núcleo Bandeirante',
  'Paranoá',
  'Park Way',
  'Planaltina',
  'Recanto das Emas',
  'Riacho Fundo',
  'Riacho Fundo II',
  'Samambaia',
  'Santa Maria',
  'São Sebastião',
  'SCIA/Estrutural',
  'SIA',
  'Sobradinho',
  'Sobradinho II',
  'Sol Nascente/Pôr do Sol',
  'Sudoeste/Octogonal',
  'Taguatinga',
  'Varjão',
  'Vicente Pires',
].map((nome, i) => ({ id: 530010801 + i, nome }));

export function useBrazilianLocations() {
  const [states] = useState<State[]>(BRAZILIAN_STATES);
  const [cities, setCities] = useState<City[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);

  const fetchCities = async (stateAbbreviation: string) => {
    if (!stateAbbreviation) {
      setCities([]);
      return;
    }

    const state = BRAZILIAN_STATES.find(s => s.sigla === stateAbbreviation);
    if (!state) {
      setCities([]);
      return;
    }

    setLoadingCities(true);
    try {
      const response = await fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state.id}/municipios?orderBy=nome`
      );
      const data: City[] = await response.json();
      // No DF, Brasília (único município) fica no topo e as regiões
      // administrativas vêm logo abaixo, em ordem alfabética.
      setCities(stateAbbreviation === 'DF' ? [...data, ...DF_ADMINISTRATIVE_REGIONS] : data);
    } catch (error) {
      console.error('Erro ao buscar cidades:', error);
      setCities([]);
    } finally {
      setLoadingCities(false);
    }
  };

  return {
    states,
    cities,
    loadingCities,
    fetchCities,
  };
}
