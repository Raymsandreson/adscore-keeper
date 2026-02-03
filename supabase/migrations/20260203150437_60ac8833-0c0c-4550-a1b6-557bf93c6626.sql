-- Inserir CBOs de Montador de diversos tipos
INSERT INTO public.cbo_professions (cbo_code, title, family_code, family_title) VALUES
-- Montadores de veículos automotores
('7251-05', 'Montador de veículos automotores (linha de montagem)', '7251', 'Montadores de veículos automotores'),
('7251-10', 'Montador de automóveis', '7251', 'Montadores de veículos automotores'),
('7251-15', 'Montador de caminhões', '7251', 'Montadores de veículos automotores'),
('7251-20', 'Montador de motocicletas', '7251', 'Montadores de veículos automotores'),
('7251-25', 'Montador de ônibus', '7251', 'Montadores de veículos automotores'),
('7251-30', 'Montador de tratores', '7251', 'Montadores de veículos automotores'),

-- Montadores de máquinas
('7252-05', 'Montador de máquinas industriais', '7252', 'Montadores de máquinas industriais'),
('7252-10', 'Montador de máquinas agrícolas', '7252', 'Montadores de máquinas industriais'),
('7252-15', 'Montador de máquinas de escritório', '7252', 'Montadores de máquinas industriais'),
('7252-20', 'Montador de máquinas operatrizes', '7252', 'Montadores de máquinas industriais'),
('7252-25', 'Montador de máquinas têxteis', '7252', 'Montadores de máquinas industriais'),
('7252-30', 'Montador de máquinas gráficas', '7252', 'Montadores de máquinas industriais'),

-- Montadores de equipamentos eletroeletrônicos
('7311-05', 'Montador de equipamentos eletrônicos (aparelhos médicos)', '7311', 'Montadores de equipamentos eletroeletrônicos'),
('7311-10', 'Montador de equipamentos eletrônicos (computadores)', '7311', 'Montadores de equipamentos eletroeletrônicos'),
('7311-15', 'Montador de equipamentos eletrônicos (telefonia)', '7311', 'Montadores de equipamentos eletroeletrônicos'),
('7311-20', 'Montador de equipamentos eletrodomésticos', '7311', 'Montadores de equipamentos eletroeletrônicos'),
('7311-25', 'Montador de placas eletrônicas', '7311', 'Montadores de equipamentos eletroeletrônicos'),

-- Montadores de estruturas
('7244-05', 'Montador de estruturas metálicas', '7244', 'Montadores de estruturas metálicas e de concreto armado'),
('7244-10', 'Montador de estruturas de concreto armado', '7244', 'Montadores de estruturas metálicas e de concreto armado'),
('7244-15', 'Montador de andaimes', '7244', 'Montadores de estruturas metálicas e de concreto armado'),
('7244-20', 'Montador de estruturas de alumínio', '7244', 'Montadores de estruturas metálicas e de concreto armado'),

-- Montadores de móveis
('7741-05', 'Montador de móveis de madeira', '7741', 'Montadores de móveis e artefatos de madeira'),
('7741-10', 'Montador de móveis de metal', '7741', 'Montadores de móveis e artefatos de madeira'),
('7741-15', 'Montador de móveis modulados', '7741', 'Montadores de móveis e artefatos de madeira'),
('7741-20', 'Montador de móveis planejados', '7741', 'Montadores de móveis e artefatos de madeira'),

-- Montadores diversos
('7841-05', 'Montador de brinquedos', '7841', 'Montadores de produtos diversos'),
('7841-10', 'Montador de bijuterias', '7841', 'Montadores de produtos diversos'),
('7841-15', 'Montador de instrumentos musicais', '7841', 'Montadores de produtos diversos'),
('7841-20', 'Montador de produtos de plástico', '7841', 'Montadores de produtos diversos'),
('7841-25', 'Montador de artefatos de borracha', '7841', 'Montadores de produtos diversos'),

-- Montadores de instalações
('7156-05', 'Montador de instalações elétricas', '7156', 'Montadores de instalações elétricas'),
('7156-10', 'Montador de instalações hidráulicas', '7156', 'Montadores de instalações elétricas'),
('7156-15', 'Montador de instalações de gás', '7156', 'Montadores de instalações elétricas'),
('7156-20', 'Montador de painéis elétricos', '7156', 'Montadores de instalações elétricas'),

-- Montadores de tubulações
('7241-05', 'Montador de tubulações (instalações industriais)', '7241', 'Encanadores e instaladores de tubulações'),
('7241-10', 'Montador de tubulações de petróleo', '7241', 'Encanadores e instaladores de tubulações'),
('7241-15', 'Montador de tubulações de gás', '7241', 'Encanadores e instaladores de tubulações')

ON CONFLICT (cbo_code) DO NOTHING;