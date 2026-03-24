

## Diagnóstico do Problema

Analisei o sistema de ponta a ponta e identifiquei as causas raiz:

### Por que transcreve errado

Existem **4 caminhos de transcrição separados e inconsistentes** no sistema:

1. **`whatsapp-webhook/downloadAndStoreMedia`** — usa `gemini-2.5-flash-lite` (modelo fraco) com prompt genérico. É **este** que salva o `message_text` no banco. Está alucinando conteúdo (ex: inventando "vaga de emprego" quando a pessoa falou outra coisa).

2. **`whatsapp-ai-agent-reply`** — faz sua PRÓPRIA transcrição com ElevenLabs + Gemini fallback, mas **não atualiza** o texto salvo. O agente IA pode "ouvir" corretamente, mas o texto exibido no chat vem do caminho 1.

3. **`whatsapp-command-processor`** — tem transcrição separada, usando `image_url` (tipo errado para áudio).

4. **`wjia-agent`** — mesma coisa, usa `image_url` ao invés de `input_audio`.

### Por que "não traz" a transcrição

O chat já exibe `message_text` abaixo do player de áudio, mas sem indicador visual de que é uma transcrição. Quando a transcrição está errada, parece que o sistema "não traz" nada útil.

---

## Plano de Correção

### 1. Criar função STT compartilhada (`_shared/stt.ts`)

Função única `transcribeAudio()` que:
- **Primário**: ElevenLabs Scribe v2 (download do áudio, envio como FormData, `language_code: "por"`)
- **Fallback**: Gemini 2.5 Flash (não flash-lite), com `temperature: 0`, prompt rigoroso, usando `input_audio` (base64) corretamente
- Aceita um `sttPrompt` opcional (editável por agente)

### 2. Atualizar `whatsapp-webhook` (`downloadAndStoreMedia`)

- Substituir o bloco de STT Gemini flash-lite (linhas 140-179) pela chamada à nova função compartilhada `transcribeAudio()`
- Garantir que o resultado fiel seja salvo em `message_text`

### 3. Atualizar `whatsapp-ai-agent-reply`

- Substituir o bloco de transcrição (linhas 391-442) pela função compartilhada
- Remover duplicação de código

### 4. Atualizar `whatsapp-command-processor`

- Substituir `transcribeWithElevenLabs()` local e o fallback Gemini (linhas 55-285) pela função compartilhada
- Corrigir o uso incorreto de `image_url` para áudio

### 5. Atualizar `wjia-agent`

- Substituir transcrição (linhas 74-87) pela função compartilhada
- Corrigir o uso de `image_url` + `urlToBase64DataUri` para áudio

### 6. UI: Indicador visual de transcrição no chat

No `WhatsAppChat.tsx`, adicionar um label `🎤 Transcrição:` antes do texto quando `message_type === 'audio'` e `message_text` existe, para deixar claro que é uma transcrição automática e não texto digitado.

---

### Detalhes Técnicos

**Nova `_shared/stt.ts`:**
```text
transcribeAudio(audioBuffer, audioMime, sttPrompt?)
  ├─ Try ElevenLabs Scribe v2  (FormData, model_id: scribe_v2, language: por)
  ├─ Fallback: Gemini 2.5 Flash  (input_audio, temperature: 0)
  └─ Return: string | null
```

**Arquivos modificados:**
- `supabase/functions/_shared/stt.ts` (novo)
- `supabase/functions/whatsapp-webhook/index.ts`
- `supabase/functions/whatsapp-ai-agent-reply/index.ts`
- `supabase/functions/whatsapp-command-processor/index.ts`
- `supabase/functions/wjia-agent/index.ts`
- `src/components/whatsapp/WhatsAppChat.tsx`

