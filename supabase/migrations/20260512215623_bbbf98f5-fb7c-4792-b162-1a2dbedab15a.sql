INSERT INTO public.whatsapp_instances (id, instance_name, instance_token, base_url, owner_phone, owner_name, is_active)
VALUES
  ('641aedfa-4a4b-4bb7-897b-024938ad1577', 'Ana Ligia', '', 'https://abraci.uazapi.com', '558694711139', 'Luana Barros', true),
  ('112951bd-f344-4b4b-8fbb-25abeeb73194', 'Atendimento Previdenciário 2', '0aaff251-e075-4266-b5f7-81bc47881249', 'https://abraci.uazapi.com', '558688257217', NULL, true)
ON CONFLICT (id) DO NOTHING;