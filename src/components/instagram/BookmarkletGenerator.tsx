import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bookmark, Copy, Check, ExternalLink, Info, GripVertical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InstagramAccount {
  id: string;
  instagram_id: string;
  account_name: string;
}

export const BookmarkletGenerator = () => {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [copied, setCopied] = useState(false);
  
  const webhookUrl = "https://webhooks.prudenciosolucoes.com.br/webhook/outbound-comment";

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    const { data } = await supabase
      .from("instagram_accounts")
      .select("id, instagram_id, account_name")
      .eq("is_active", true);
    
    if (data) {
      setAccounts(data);
      if (data.length > 0) {
        setSelectedAccount(data[0].account_name);
      }
    }
  };

  // Generate the bookmarklet code
  const generateBookmarkletCode = () => {
    const code = `
(function(){
  var account = "${selectedAccount.replace("@", "")}";
  var webhook = "${webhookUrl}";
  
  var postOwner = "";
  var postUrl = window.location.href;
  
  // Try to get post owner
  var header = document.querySelector("article header a[href^='/']");
  if(header){
    var match = header.getAttribute("href").match(/^\\/([^/]+)\\/?$/);
    if(match) postOwner = match[1];
  }
  
  var comment = prompt("📝 Comentário feito por @" + account + "\\n\\nNo post de: @" + (postOwner || "?") + "\\n\\nDigite o texto do comentário:");
  
  if(comment && comment.trim()){
    if(!postOwner){
      postOwner = prompt("@ do dono do post:") || "desconhecido";
    }
    
    fetch(webhook, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      mode: "no-cors",
      body: JSON.stringify({
        account_name: account,
        target_username: postOwner,
        comment_text: comment.trim(),
        post_url: postUrl,
        timestamp: new Date().toISOString(),
        source: "bookmarklet"
      })
    });
    
    alert("✅ Comentário registrado!\\n\\nConta: @" + account + "\\nPost: @" + postOwner);
  }
})();
    `.trim().replace(/\n\s*/g, " ");
    
    return `javascript:${encodeURIComponent(code)}`;
  };

  const bookmarkletCode = generateBookmarkletCode();

  const copyCode = () => {
    navigator.clipboard.writeText(bookmarkletCode);
    setCopied(true);
    toast.success("Código copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bookmark className="h-5 w-5" />
          Bookmarklet - Registro Rápido
        </CardTitle>
        <CardDescription>
          Arraste o botão abaixo para sua barra de favoritos e use-o dentro do Instagram
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Account selector */}
        <div className="space-y-2">
          <Label>Conta para registrar comentários</Label>
          <div className="flex flex-wrap gap-2">
            {accounts.map((account) => (
              <Button
                key={account.id}
                variant={selectedAccount === account.account_name ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedAccount(account.account_name)}
              >
                {account.account_name}
              </Button>
            ))}
          </div>
          {accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta cadastrada. Adicione uma conta do Instagram primeiro.
            </p>
          )}
        </div>

        {/* Bookmarklet button */}
        {selectedAccount && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4" />
              <span>Arraste este botão para sua barra de favoritos:</span>
            </div>
            
            <div className="flex items-center justify-center p-6 bg-muted/50 rounded-lg border-2 border-dashed">
              <a
                href={bookmarkletCode}
                onClick={(e) => e.preventDefault()}
                draggable="true"
                className="inline-flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground rounded-lg font-medium shadow-lg hover:shadow-xl transition-all cursor-grab active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4 opacity-60" />
                <Bookmark className="h-5 w-5" />
                📸 Registrar Comentário ({selectedAccount})
              </a>
            </div>

            <div className="bg-muted/30 rounded-lg p-4 space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <Badge variant="outline">Como usar</Badge>
              </h4>
              <ol className="text-sm space-y-2 text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-bold text-primary">1.</span>
                  <span>Arraste o botão acima para sua <strong>barra de favoritos</strong></span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-primary">2.</span>
                  <span>Vá ao Instagram e faça seu comentário normalmente</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-primary">3.</span>
                  <span>Após comentar, clique no bookmarklet na barra de favoritos</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-primary">4.</span>
                  <span>Digite o texto do comentário que você fez e confirme</span>
                </li>
              </ol>
            </div>

            {/* Alternative: Copy code */}
            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-2">
                Alternativa: copie o código e crie um favorito manualmente
              </p>
              <div className="flex gap-2">
                <Input 
                  value={bookmarkletCode} 
                  readOnly 
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={copyCode}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Test link */}
        <div className="flex items-center justify-between pt-4 border-t">
          <span className="text-sm text-muted-foreground">Testar no Instagram</span>
          <Button variant="outline" size="sm" asChild>
            <a href="https://www.instagram.com" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Abrir Instagram
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
