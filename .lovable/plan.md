

## Problem

The phone number displayed in the chat header (`558688054381`) is being auto-detected by the Android browser as a phone number. When tapped, Android treats it as a `tel:` link, showing only phone/dialer apps (Minha Claro, Telefone). The "💬 WhatsApp" link exists separately but the user is tapping the number itself.

The CallFace extension works by scanning text on the page and injecting its own button -- this part should work on the published site if the extension is active in the browser.

## Solution

1. **Remove the plain text number** that Android auto-detects as a phone link
2. **Show two explicit buttons side by side**: one for WhatsApp (`wa.me` link) and one for regular phone call (`tel:` link)
3. **Add `tel:` meta tag** to prevent Android from auto-linking numbers in text
4. **Keep the number as copyable text** with copy button, but wrapped in a way that prevents auto-detection

### Changes

**`src/components/whatsapp/WhatsAppChat.tsx`** (lines 677-694):
- Remove the raw `<span>` with the phone number (Android auto-links it)
- Add two clear buttons:
  - `📱 WhatsApp` → `https://wa.me/{whatsappPhone}` 
  - `📞 Ligar` → `tel:+{whatsappPhone}`
  - `📋 Copiar` → copy to clipboard
- Format the number display with `tel:` prefix disabled using CSS or wrapping

**`index.html`**:
- Add `<meta name="format-detection" content="telephone=no">` to prevent auto-detection of phone numbers as links across the entire app

This ensures the user always sees explicit WhatsApp and Phone buttons, and tapping WhatsApp will open WhatsApp Business directly.

