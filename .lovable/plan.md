

## Diagnóstico

Existem **dois componentes** que fazem chamadas no sistema:

1. **`WhatsAppCallRecorder`** (usado no chat WhatsApp e detalhes de contato) — já foi migrado para Twilio SDK v2.x ✅
2. **`FloatingWhatsAppCall`** (botão flutuante global no App) — **ainda usa `make-whatsapp-call` (UazAPI)** ❌

Quando você liga pelo chat do WhatsApp, o `WhatsAppCallRecorder` é usado e deveria funcionar com Twilio. Porém, se você está usando o botão flutuante, ele ainda chama a UazAPI que apenas dispara a chamada no WhatsApp (não conecta áudio no navegador).

Além disso, o problema de "Conectando..." pode estar relacionado ao **TwiML App** — quando o Twilio conecta a chamada WebRTC, ele precisa de um TwiML que instrua o que fazer (dial para o número). Se o TwiML não responde corretamente, o áudio nunca conecta.

## Plano

### 1. Verificar a Edge Function `twilio-voice-twiml`
- Confirmar que ela retorna TwiML correto com `<Dial><Number>` para o número passado como parâmetro
- Garantir que o `TWILIO_TWIML_APP_SID` aponta para um TwiML App configurado com a URL correta desta edge function

### 2. Migrar `FloatingWhatsAppCall` para Twilio
- Substituir a chamada `make-whatsapp-call` (UazAPI) pelo mesmo fluxo Twilio SDK v2.x usado no `WhatsAppCallRecorder`
- Ou redirecionar para usar o `TwilioSoftphone` componente

### 3. Verificar o fluxo completo Twilio
- Token → Device → Connect → TwiML → Dial → Áudio bidirecional

### Detalhes técnicos

O fluxo Twilio correto é:
```text
Browser → Device.connect({phone}) → Twilio Cloud → 
  → Busca TwiML no webhook (twilio-voice-twiml) →
  → TwiML retorna <Dial><Number>+55XXXXXXXXXX</Number></Dial> →
  → Twilio liga para o número → Áudio bidirecional via WebRTC
```

Se o TwiML não está configurado corretamente, a chamada fica em "Connecting" para sempre.

Preciso verificar a edge function `twilio-voice-twiml` antes de implementar para garantir que o fluxo está correto.

