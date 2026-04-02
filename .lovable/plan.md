
## Objetivo
Eliminar a distinção Admin/Membro e usar exclusivamente **Perfis de Acesso** para controlar permissões. Admin passa a ser um perfil especial com acesso total fixo.

## Mudanças

### 1. Novo módulo: "Gestão de Equipe"
- Adicionar `team_management` ao `MODULE_DEFINITIONS` 
- Quem tiver esse módulo com `edit` pode convidar, remover e alterar permissões de membros
- Admins têm acesso automático

### 2. Lógica de permissões
- Manter a tabela `user_roles` mas simplificar: `admin` continua dando acesso total fixo
- A UI deixa de mostrar "Admin/Membro" como conceito separado — mostra o **nome do perfil** aplicado
- Ao convidar, o admin escolhe um perfil (incluindo "Admin") em vez de escolher role + módulos separadamente

### 3. UI - Tela de Membros
- Substituir o seletor "Admin/Membro" por seletor de **Perfil de Acesso**
- Ao selecionar "Admin", o user_role é setado como `admin`
- Ao selecionar qualquer outro perfil, o role é `member` e as permissões do perfil são aplicadas
- Coluna "Permissão" na tabela mostra o nome do perfil em vez de "Admin/Membro"

### 4. UI - Convite
- Substituir o seletor de role por seletor de perfil
- Remover o painel manual de módulos (já vem do perfil)
- Manter opção de customizar se necessário

### 5. Perfil "Admin" como perfil de acesso
- Garantir que existe um perfil "Administrador" na tabela `access_profiles` (fixo, não deletável)
- Marcar com flag `is_system = true` para impedir edição/exclusão

### 6. Guardar perfil aplicado no membro
- Adicionar coluna `access_profile_id` na tabela `user_roles` para saber qual perfil está aplicado
- Facilita mostrar o nome do perfil na lista de membros

## O que NÃO muda
- Tabela `user_roles` continua existindo (admin tem acesso total)
- `has_role()` e `is_admin()` continuam funcionando
- RLS policies não mudam
- Lógica de `member_module_permissions` continua igual (perfil apenas popula essa tabela)
