

## Plano: Corrigir Download e Exibição de Mídias (Áudio, Imagem, Vídeo)

### Problema Identificado
Os logs mostram que o download de mídia falha com "Could not download media, buffer empty or too small". A função `downloadAndStoreMedia` chama a UazAPI incorretamente:
- O token da instância está sendo colocado na URL (`/downloadMediaMessage/{token}`) em vez de ser enviado no header `token` (padrão v2 da API)
- O endpoint pode estar retornando um erro pequeno (JSON de erro) que é menor que 100 bytes

### Correções Planejadas

**1. Corrigir chamada ao endpoint da UazAPI (Edge Function `whatsapp-webhook`)**
- Enviar token via header `token` (como já é feito no `send-whatsapp`)
- Testar múltiplos formatos de message ID (com e sem prefixo do owner)
- Adicionar logging detalhado da resposta para diagnosticar erros
- Tentar endpoint alternativo `/getMediaURL` caso o primeiro falhe

**2. Reduzir limite mínimo de buffer**
- Alterar de 100 bytes para 50 bytes, pois alguns áudios curtos podem ser muito pequenos

**3. Log da resposta da API para debug**
- Registrar o status code e body da resposta quando o download falha, para identificar erros específicos da UazAPI

### Detalhes Técnicos

Alteração principal na função `downloadAndStoreMedia`:

```text
ANTES (incorreto):
  const downloadUrl = `${baseUrl}/downloadMediaMessage/${instanceToken}`;
  fetch(downloadUrl, { method: 'POST', body: { messageId } })

DEPOIS (correto - v2 API):
  const downloadUrl = `${baseUrl}/downloadMediaMessage`;
  fetch(downloadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': instanceToken },
    body: JSON.stringify({ messageId })
  })

  // Fallback: tentar também /getMediaURL
  const mediaUrlEndpoint = `${baseUrl}/getMediaURL`;
  fetch(mediaUrlEndpoint, {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json', 'token': instanceToken },
    body: JSON.stringify({ mediaId: messageId })
  })
```

### Arquivo Modificado
- `supabase/functions/whatsapp-webhook/index.ts` - Corrigir autenticação e formato da chamada de download de mídia

### Resultado Esperado
Após a correção, áudios, imagens e vídeos recebidos via webhook serão baixados automaticamente, armazenados no storage e exibidos inline no chat do sistema com players nativos.

