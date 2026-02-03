# AdScore Keeper - Instagram Comment Tracker

Extensão Chrome que rastreia automaticamente comentários feitos no Instagram e envia para o sistema AdScore Keeper.

## 📦 Instalação

1. Abra o Chrome e vá para `chrome://extensions/`
2. Ative o **Modo desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione esta pasta `chrome-extension`

## ⚙️ Configuração

1. Clique no ícone da extensão na barra do Chrome
2. Adicione as contas do Instagram que você quer monitorar (ex: `@joaopedro.alvarengaa`)
3. Verifique se o Webhook URL está correto
4. Ative o rastreamento

## 🚀 Como funciona

1. Quando você fizer login no Instagram com uma das contas cadastradas
2. E fizer um comentário em um post de terceiros
3. A extensão detecta automaticamente e envia os dados para o webhook:
   - Nome da conta que comentou
   - @ do dono do post
   - Texto do comentário
   - URL do post

## 📋 Dados enviados

```json
{
  "account_name": "joaopedro.alvarengaa",
  "target_username": "perfil_do_post",
  "comment_text": "Texto do comentário...",
  "post_url": "https://instagram.com/p/xxxxx",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "source": "chrome_extension"
}
```

## 🔧 Ícones

Para os ícones, você pode criar imagens PNG de 16x16, 48x48 e 128x128 pixels e salvar na pasta `icons/`:
- `icon16.png`
- `icon48.png`
- `icon128.png`

## ⚠️ Limitações

- Funciona apenas no navegador Chrome/Edge
- Requer que você esteja logado na conta do Instagram que quer rastrear
- Comentários feitos no app mobile não são rastreados (apenas pelo navegador)
