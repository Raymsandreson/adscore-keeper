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
