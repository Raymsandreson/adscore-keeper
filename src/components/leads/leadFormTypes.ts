export interface AccidentLeadFormData {
  // Basic info
  lead_name: string;
  lead_phone: string;
  lead_email: string;
  source: string;
  notes: string;

  // Accident specific
  acolhedor: string;
  case_type: string;
  group_link: string;

  // Classification & birth
  client_classification: string;
  expected_birth_date: string;

  // Visit location
  visit_city: string;
  visit_state: string;
  visit_region: string;
  visit_address: string;

  // Accident details
  accident_date: string;
  damage_description: string;
  victim_name: string;
  victim_age: string;
  accident_address: string;

  // Companies
  contractor_company: string;
  main_company: string;
  sector: string;

  // Legal
  news_link: string;
  company_size_justification: string;
  liability_type: string;
  legal_viability: string;
}
