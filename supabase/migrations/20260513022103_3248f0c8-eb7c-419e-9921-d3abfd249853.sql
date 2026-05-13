DELETE FROM public.whatsapp_instance_users
WHERE user_id = 'cfab247e-c8e3-40c4-8aa7-5dbf367ea9b1'
  AND instance_id IN (
    SELECT id FROM public.whatsapp_instances
    WHERE instance_name IN (
      'Mateus Atendimento','Ana Ligia','ISRAEL ATENDIMENTO',
      'Karolyne Atendimento','Léo Teste','Luana Gerente','Raym'
    )
  );