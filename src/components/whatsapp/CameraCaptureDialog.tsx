/**
 * "Câmera" do menu de anexo — igual ao app do WhatsApp: abre a webcam, tira a
 * foto e devolve o arquivo pro host enviar pelo mesmo caminho de mídia que a
 * galeria usa. Nada de upload aqui dentro: o host já sabe enviar mídia.
 */
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, RefreshCcw, Send } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recebe a foto tirada; o host envia pelo próprio fluxo de mídia. */
  onCapture: (file: File) => void;
}

export function CameraCaptureDialog({ open, onOpenChange, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [snapshot, setSnapshot] = useState<Blob | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        console.error('[CameraCaptureDialog] getUserMedia falhou', e);
        toast.error('Não foi possível acessar a câmera');
        onOpenChange(false);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setSnapshot(null);
      setSnapshotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setSnapshot(blob);
      setSnapshotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    }, 'image/jpeg', 0.9);
  };

  const handleSend = () => {
    if (!snapshot) return;
    const file = new File([snapshot], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
    onOpenChange(false);
    onCapture(file);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> Câmera
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-md border bg-black">
            {snapshotUrl ? (
              <img src={snapshotUrl} alt="Foto capturada" className="max-h-80 w-full object-contain" />
            ) : (
              <video ref={videoRef} autoPlay playsInline muted className="max-h-80 w-full object-contain" />
            )}
          </div>
          {snapshot ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => {
                  setSnapshot(null);
                  setSnapshotUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                }}
              >
                <RefreshCcw className="h-4 w-4" /> Tirar outra
              </Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700 gap-2" onClick={handleSend}>
                <Send className="h-4 w-4" /> Enviar foto
              </Button>
            </div>
          ) : (
            <Button className="w-full gap-2" onClick={takePhoto}>
              <Camera className="h-4 w-4" /> Tirar foto
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
