# Testemunho de cliente → post de Instagram

**Status:** implementado (ago/2026); migration aplicada no Externo em 29/08/2026. Publicação aguarda `META_ACCESS_TOKEN` no env do Railway.

## O que é

O agradecimento que o cliente manda por áudio no WhatsApp (transcrito pelo sistema) vira um post de Instagram pronto — card 1080×1350 + legenda — com **revisão humana obrigatória** antes de publicar. Nada é publicado automaticamente.

## Fluxo

1. Na conversa (WhatsAppChat), toda mensagem **recebida** com texto tem o botão **"Post IG"** na barra de ações da bolha (junto de Copiar / Responder c/ IA / Comentar).
2. O botão abre o **TestimonialPostSheet** (Sheet lateral, sem redirect). Na abertura, chama `testimonial-to-instagram-post` (Railway):
   - IA (`EXTRACT_AI_MODEL`, padrão gemini-3.6-flash) extrai a citação forte, limpa vícios de fala e escreve a legenda — com regras de OAB (sem promessa de resultado, sem valores) e LGPD (só primeiro nome, sem dado sensível);
   - o card é renderizado com `sharp` (SVG → JPEG) usando **Poppins embutida no repo** (`railway-server/assets/fonts/`, licença OFL) + `fonts.conf` gerado em runtime — o container do Railway não tem fonte nenhuma instalada;
   - a imagem sobe no bucket público `whatsapp-media` (pasta `instagram-posts/`) e o rascunho é gravado em `instagram_testimonial_posts` (Externo).
3. O revisor edita citação, nome, contexto e legenda; "Atualizar arte" re-renderiza **sem** chamar a IA (`regenerate_post_id` + `quote_text`).
   - **Com a voz da cliente (padrão quando a bolha é áudio)**: `with_voice: true` baixa o áudio original (`media_url` da mensagem) e o ffmpeg (`ffmpeg-static`, `lib/testimonial-video.ts`) muxa card + áudio em MP4 1080×1920 (card centralizado, H.264 + AAC, `+faststart`). O vídeo sobe ao lado da imagem (`instagram-posts/<id>.mp4`) e o rascunho fica com `post_type='reel'`.
4. Publicar exige: escolher a conta (via edge `list-instagram-accounts`) **e marcar o checkbox de autorização do cliente (LGPD)**. Aí sim `publish-instagram-testimonial` (Railway) roda o Content Publishing da Graph API: container `/media` → poll `status_code` → `/media_publish` → salva `ig_media_id` + `permalink` e status `publicado`. Rascunho `reel` publica com `media_type=REELS` + `share_to_feed=true` (aparece no grid também); o poll de vídeo espera até ~2min o transcode da Meta.

## Peças

| Peça | Onde |
|---|---|
| Tabela `instagram_testimonial_posts` | Externo — migration `20260828120000_testemunho_vira_post_instagram.sql` |
| Geração (IA + card + upload) | `railway-server/src/functions/testimonial-to-instagram-post.ts` |
| Renderer do card | `railway-server/src/lib/testimonial-card.ts` |
| Publicação (Graph API) | `railway-server/src/functions/publish-instagram-testimonial.ts` |
| UI de revisão | `src/components/whatsapp/TestimonialPostSheet.tsx` |
| Botão na bolha | `WhatsAppChat.tsx` (barra de ações, só `direction === 'inbound'`) |
| Rotas | `functionRouter.ts` → ambas `railway` |

## Setup necessário (pendências de infra)

1. **Aplicar a migration no Externo** (`kmedldlepwiityjsdahz`).
2. **`META_ACCESS_TOKEN` no env do Railway** — o mesmo token que já vive nas edge functions do Cloud, mas precisa das permissões `instagram_basic`, `instagram_content_publish` e `pages_read_engagement`. Sem ele, a geração de rascunho funciona; a publicação retorna erro claro pedindo o token.
3. Opcionais no env do Railway: `INSTAGRAM_CARD_BRAND` (rodapé do card; padrão "R. Prudêncio Advocacia"), `INSTAGRAM_CARD_HANDLE` (ex.: `@rprudencioadv`), `META_API_VERSION` (padrão `v21.0`).

## Limites conhecidos

- A Graph API só publica imagem por **URL pública** — por isso o card vai pro bucket público antes (a URL leva cache-buster `?v=` porque o upsert regrava o mesmo path).
- Instagram Content Publishing tem cota de **50 posts/24h** por conta — irrelevante pro volume de testemunhos.
- Publicidade de advocacia: o prompt já força sobriedade (Provimento 205/2021), mas a revisão humana é a barreira final — por isso o checkbox de consentimento é obrigatório.
