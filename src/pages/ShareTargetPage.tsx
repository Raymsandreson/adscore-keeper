import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ImportFromSocialLinkDialog } from '@/components/instagram/ImportFromSocialLinkDialog';
import { Loader2 } from 'lucide-react';

export default function ShareTargetPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);
  const [sharedUrl, setSharedUrl] = useState('');

  useEffect(() => {
    const url = searchParams.get('url') || '';
    const text = searchParams.get('text') || '';
    const title = searchParams.get('title') || '';

    // Try to extract a URL from text or url params
    const urlPattern = /https?:\/\/[^\s]+/;
    let detectedUrl = '';

    if (url && urlPattern.test(url)) {
      detectedUrl = url;
    } else if (text) {
      const match = text.match(urlPattern);
      if (match) {
        detectedUrl = match[0];
      }
    }

    if (!detectedUrl && title) {
      const match = title.match(urlPattern);
      if (match) {
        detectedUrl = match[0];
      }
    }

    setSharedUrl(detectedUrl || text || url || title);
    setShowDialog(true);
  }, [searchParams]);

  const handleClose = (open: boolean) => {
    if (!open) {
      navigate('/instagram');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground text-sm">Processando link compartilhado...</p>
      </div>
      <ImportFromSocialLinkDialog
        open={showDialog}
        onOpenChange={handleClose}
        initialUrl={sharedUrl}
      />
    </div>
  );
}
