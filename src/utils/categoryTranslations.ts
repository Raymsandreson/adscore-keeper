// Mapa de tradução das categorias Pluggy para português
export const categoryTranslations: Record<string, string> = {
  // Alimentação
  'Restaurants': 'Restaurantes',
  'Food': 'Alimentação',
  'Fast Food': 'Fast Food',
  'Coffee Shops': 'Cafeterias',
  'Groceries': 'Supermercado',
  'Supermarkets': 'Supermercados',
  'Bakeries': 'Padarias',
  'Eating out': 'Refeições Fora',
  'Eating Out': 'Refeições Fora',
  
  // Transporte
  'Transport': 'Transporte',
  'Transportation': 'Transporte',
  'Gas Stations': 'Postos de Combustível',
  'Gas stations': 'Postos de Combustível',
  'Fuel': 'Combustível',
  'Parking': 'Estacionamento',
  'Public Transportation': 'Transporte Público',
  'Taxi': 'Táxi',
  'Uber': 'Uber',
  'Ride Sharing': 'Aplicativos de Transporte',
  'Car Rental': 'Aluguel de Carro',
  'Auto': 'Automóvel',
  'Car Maintenance': 'Manutenção de Veículo',
  
  // Viagem e Hospedagem
  'Travel': 'Viagem',
  'Airlines': 'Companhias Aéreas',
  'Hotels': 'Hotéis',
  'Lodging': 'Hospedagem',
  'Vacation': 'Férias',
  'Accomodation': 'Hospedagem',
  'Accommodation': 'Hospedagem',
  
  // Compras
  'Shopping': 'Compras',
  'Clothing': 'Vestuário',
  'Electronics': 'Eletrônicos',
  'Department Stores': 'Lojas de Departamento',
  'Online Shopping': 'Compras Online',
  'Houseware': 'Artigos para Casa',
  'Home Goods': 'Artigos para Casa',
  
  // Entretenimento
  'Entertainment': 'Entretenimento',
  'Movies': 'Cinema',
  'Music': 'Música',
  'Games': 'Jogos',
  'Streaming Services': 'Streaming',
  'Sports': 'Esportes',
  
  // Saúde
  'Health': 'Saúde',
  'Healthcare': 'Saúde',
  'Pharmacy': 'Farmácia',
  'Medical': 'Médico',
  'Hospitals': 'Hospitais',
  'Dentist': 'Dentista',
  'Gym': 'Academia',
  'Fitness': 'Fitness',
  
  // Serviços
  'Services': 'Serviços',
  'Utilities': 'Utilidades',
  'Phone': 'Telefone',
  'Internet': 'Internet',
  'Insurance': 'Seguros',
  'Professional Services': 'Serviços Profissionais',
  'Legal': 'Jurídico',
  'Digital services': 'Serviços Digitais',
  'Digital Services': 'Serviços Digitais',
  
  // Educação
  'Education': 'Educação',
  'Books': 'Livros',
  'Courses': 'Cursos',
  
  // Casa
  'Home': 'Casa',
  'Home Improvement': 'Reforma',
  'Furniture': 'Móveis',
  'Rent': 'Aluguel',
  
  // Finanças
  'Finance': 'Finanças',
  'Bank Fees': 'Taxas Bancárias',
  'ATM': 'Caixa Eletrônico',
  'Transfer': 'Transferência',
  'Investment': 'Investimento',
  'Taxes': 'Impostos',
  'Credit card payment': 'Pagamento de Cartão',
  'Credit Card Payment': 'Pagamento de Cartão',
  'Credit Card': 'Cartão de Crédito',
  
  // Pets
  'Pets': 'Animais de Estimação',
  'Pet Stores': 'Pet Shop',
  'Veterinary': 'Veterinário',
  
  // Outros
  'Other': 'Outros',
  'Uncategorized': 'Sem Categoria',
  'General': 'Geral',
  'Miscellaneous': 'Diversos',
  'Unknown': 'Desconhecido',
  
  // Pagamentos
  'Payment': 'Pagamento',
  'Bills': 'Contas',
  'Subscription': 'Assinatura',
  'Subscriptions': 'Assinaturas',
};

// Mapeamento de categorias Pluggy para nossas categorias locais (por nome)
// Chave: categoria traduzida do Pluggy, Valor: nome da categoria local
export const pluggyCategoryMapping: Record<string, string[]> = {
  // Alimentação - mapeia para categoria "Alimentação"
  'Restaurantes': ['Alimentação', 'Restaurantes', 'Refeições'],
  'Alimentação': ['Alimentação'],
  'Fast Food': ['Alimentação', 'Fast Food'],
  'Cafeterias': ['Alimentação', 'Cafeterias'],
  'Supermercado': ['Alimentação', 'Supermercado'],
  'Supermercados': ['Alimentação', 'Supermercados'],
  'Padarias': ['Alimentação', 'Padarias'],
  'Refeições Fora': ['Alimentação', 'Refeições Fora'],
  
  // Transporte
  'Transporte': ['Transporte'],
  'Postos de Combustível': ['Combustível', 'Transporte', 'Postos de Combustível'],
  'Combustível': ['Combustível', 'Transporte'],
  'Estacionamento': ['Transporte', 'Estacionamento'],
  'Transporte Público': ['Transporte', 'Transporte Público'],
  'Táxi': ['Uber/99', 'Transporte', 'Táxi'],
  'Uber': ['Uber/99', 'Transporte', 'Uber'],
  'Aplicativos de Transporte': ['Uber/99', 'Transporte'],
  'Aluguel de Carro': ['Transporte', 'Aluguel de Carro'],
  'Automóvel': ['Transporte', 'Automóvel'],
  'Manutenção de Veículo': ['Transporte', 'Manutenção de Veículo'],
  
  // Hospedagem e Viagem
  'Viagem': ['Passagem Aérea', 'Viagem'],
  'Companhias Aéreas': ['Passagem Aérea', 'Companhias Aéreas'],
  'Hotéis': ['Hospedagem', 'Hotéis'],
  'Hospedagem': ['Hospedagem'],
  'Férias': ['Hospedagem', 'Viagem'],
  
  // Compras
  'Compras': ['Outros', 'Compras'],
  'Vestuário': ['Outros', 'Vestuário'],
  'Eletrônicos': ['Outros', 'Eletrônicos'],
  'Lojas de Departamento': ['Outros', 'Compras'],
  'Compras Online': ['Outros', 'Compras Online'],
  'Artigos para Casa': ['Material de Escritório', 'Artigos para Casa'],
  
  // Entretenimento
  'Entretenimento': ['Outros', 'Entretenimento'],
  'Cinema': ['Outros', 'Cinema'],
  'Música': ['Outros', 'Música'],
  'Jogos': ['Outros', 'Jogos'],
  'Streaming': ['Outros', 'Streaming'],
  'Esportes': ['Outros', 'Esportes'],
  
  // Saúde
  'Saúde': ['Outros', 'Saúde'],
  'Farmácia': ['Outros', 'Farmácia'],
  'Médico': ['Outros', 'Médico'],
  'Hospitais': ['Outros', 'Hospitais'],
  'Dentista': ['Outros', 'Dentista'],
  'Academia': ['Outros', 'Academia'],
  'Fitness': ['Outros', 'Fitness'],
  
  // Serviços
  'Serviços': ['Outros', 'Serviços'],
  'Utilidades': ['Outros', 'Utilidades'],
  'Telefone': ['Outros', 'Telefone'],
  'Internet': ['Outros', 'Internet'],
  'Seguros': ['Outros', 'Seguros'],
  'Serviços Profissionais': ['Outros', 'Serviços Profissionais'],
  'Jurídico': ['Outros', 'Jurídico'],
  'Serviços Digitais': ['Outros', 'Serviços Digitais'],
  
  // Educação
  'Educação': ['Outros', 'Educação'],
  'Livros': ['Material de Escritório', 'Livros'],
  'Cursos': ['Outros', 'Cursos'],
  
  // Casa
  'Casa': ['Outros', 'Casa'],
  'Reforma': ['Outros', 'Reforma'],
  'Móveis': ['Outros', 'Móveis'],
  'Aluguel': ['Outros', 'Aluguel'],
  
  // Finanças
  'Finanças': ['Outros', 'Finanças'],
  'Taxas Bancárias': ['Outros', 'Taxas Bancárias'],
  'Caixa Eletrônico': ['Outros'],
  'Transferência': ['Outros'],
  'Investimento': ['Outros', 'Investimento'],
  'Impostos': ['Outros', 'Impostos'],
  'Pagamento de Cartão': ['Outros'],
  'Cartão de Crédito': ['Outros'],
  
  // Pets
  'Animais de Estimação': ['Outros', 'Pets'],
  'Pet Shop': ['Outros', 'Pet Shop'],
  'Veterinário': ['Outros', 'Veterinário'],
  
  // Outros
  'Outros': ['Outros'],
  'Sem Categoria': ['Outros'],
  'Geral': ['Outros'],
  'Diversos': ['Outros'],
  'Desconhecido': ['Outros'],
  
  // Pagamentos
  'Pagamento': ['Outros'],
  'Contas': ['Outros', 'Contas'],
  'Assinatura': ['Outros', 'Assinaturas'],
  'Assinaturas': ['Outros', 'Assinaturas'],
};

export function translateCategory(category: string | null | undefined): string {
  if (!category) return 'Sem Categoria';
  
  // Tenta encontrar tradução exata
  if (categoryTranslations[category]) {
    return categoryTranslations[category];
  }
  
  // Tenta encontrar tradução case-insensitive
  const lowerCategory = category.toLowerCase();
  for (const [key, value] of Object.entries(categoryTranslations)) {
    if (key.toLowerCase() === lowerCategory) {
      return value;
    }
  }
  
  // Tenta encontrar tradução parcial
  for (const [key, value] of Object.entries(categoryTranslations)) {
    if (lowerCategory.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerCategory)) {
      return value;
    }
  }
  
  // Retorna a categoria original se não encontrar tradução
  return category;
}

// Encontra a categoria local que corresponde a uma categoria do Pluggy
export function findMatchingLocalCategory(
  pluggyCategory: string | null | undefined,
  localCategories: { id: string; name: string }[]
): { id: string; name: string } | null {
  if (!pluggyCategory || localCategories.length === 0) return null;
  
  // Primeiro traduz a categoria
  const translatedCategory = translateCategory(pluggyCategory);
  
  // Busca no mapeamento as possíveis categorias locais
  const possibleMatches = pluggyCategoryMapping[translatedCategory] || [];
  
  // Tenta encontrar uma correspondência exata com as categorias locais
  for (const matchName of possibleMatches) {
    const localCategory = localCategories.find(
      c => c.name.toLowerCase() === matchName.toLowerCase()
    );
    if (localCategory) {
      return localCategory;
    }
  }
  
  // Se não encontrou correspondência exata, tenta busca parcial
  for (const matchName of possibleMatches) {
    const localCategory = localCategories.find(
      c => c.name.toLowerCase().includes(matchName.toLowerCase()) ||
           matchName.toLowerCase().includes(c.name.toLowerCase())
    );
    if (localCategory) {
      return localCategory;
    }
  }
  
  // Tenta buscar diretamente pelo nome traduzido
  const directMatch = localCategories.find(
    c => c.name.toLowerCase() === translatedCategory.toLowerCase()
  );
  if (directMatch) {
    return directMatch;
  }
  
  // Busca parcial pelo nome traduzido
  const partialMatch = localCategories.find(
    c => c.name.toLowerCase().includes(translatedCategory.toLowerCase()) ||
         translatedCategory.toLowerCase().includes(c.name.toLowerCase())
  );
  if (partialMatch) {
    return partialMatch;
  }
  
  return null;
}
