

## Problema

O link `tel:` no cabeçalho do chat está ativando o handler de protocolo do navegador (que oferece abrir o WhatsApp), em vez de ser interceptado pela extensão CallFace. Isso acontece porque `<a href="tel:...">` dispara o sistema do navegador antes da extensão agir.

## Solução

Trocar o `<a href="tel:...">` por um `<span>` com a classe `callface-phone-number` e atributo `data-phone`, que é o formato que extensões de click-to-call como o CallFace detectam na página. Remover completamente o `tel:` para evitar que o navegador abra o diálogo do WhatsApp/FaceTime.

## Mudanças

**`src/components/whatsapp/WhatsAppChat.tsx`** (linhas 674-680):
- Substituir `<a href="tel:...">` por `<span>` com classe `callface-phone-number` e `data-phone` com o número limpo
- Manter o estilo de link clicável para indicar que é interativo
- A extensão CallFace detecta elementos com essa classe/atributo automaticamente

