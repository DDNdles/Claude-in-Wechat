import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { Button } from '@shared/components/ui/button';
import { toast } from 'sonner';
import { RefreshCw, Loader2, CheckCircle2, QrCode } from 'lucide-react';

interface QrLoginProps {
  onConnected?: (accountId: string) => void;
  /** when true, start fetching QR automatically on mount */
  autoStart?: boolean;
}

/**
 * Live WeChat QR login component.
 * Fetches a QR code from the iLink API (via main process), renders it
 * inline using a QR library, and polls the scan status until confirmed.
 */
export default function QrLogin({ onConnected, autoStart = true }: QrLoginProps) {
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const fetchQr = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.wechatQrStart) { setStatus('error'); setMessage('Electron API 不可用'); return; }
    stopPolling();
    setStatus('loading');
    setMessage('正在获取二维码…');
    try {
      const resp = await api.wechatQrStart();
      if (resp.success && resp.data?.success && resp.data.qrcode) {
        setQrcode(resp.data.qrcode);
        setStatus('waiting');
        setMessage('请用微信扫码');
        // Generate QR SVG locally
        generateQrSvg(resp.data.qrcode).then(setQrSvg).catch(() => setQrSvg(null));
        startPolling();
      } else {
        setStatus('error');
        setMessage(resp.data?.message || resp.error || '获取二维码失败');
      }
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || '获取二维码失败');
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const api = window.electronAPI;
      if (!api?.wechatQrStatus) return;
      try {
        const resp = await api.wechatQrStatus();
        if (!resp.success || !resp.data) return;
        const st = resp.data.status;
        if (st === 'waiting') { setStatus('waiting'); setMessage('请用微信扫码'); }
        else if (st === 'scanned') { setStatus('scanned'); setMessage('已扫码，请在手机确认'); }
        else if (st === 'confirmed') {
          setStatus('confirmed');
          setMessage(resp.data.message || '登录成功');
          stopPolling();
          toast.success('微信绑定成功！');
          onConnected?.(resp.data.message || '');
        }
        else if (st === 'expired') {
          setStatus('expired');
          setMessage('二维码已过期，请重新获取');
          stopPolling();
        }
      } catch { /* keep polling */ }
    }, 2500);
  }, [stopPolling, onConnected]);

  useEffect(() => {
    if (autoStart) fetchQr();
    return () => {
      stopPolling();
      window.electronAPI?.wechatQrCancel?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* QR display */}
      <div
        className="w-56 h-56 rounded-2xl flex items-center justify-center relative overflow-hidden"
        style={{
          backgroundColor: '#ffffff',
          boxShadow: '0 0 0 1px oklch(0 0 0 / 0.08), 0 12px 32px -12px oklch(0 0 0 / 0.4)',
        }}
      >
        {status === 'loading' && (
          <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
        )}
        {status === 'waiting' && qrSvg && (
          <div className="w-full h-full p-3" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        )}
        {status === 'scanned' && (
          <div className="flex flex-col items-center gap-2 text-[oklch(0.72_0.19_145)]">
            <CheckCircle2 className="w-12 h-12" />
            <p className="text-sm font-medium">已扫码</p>
          </div>
        )}
        {status === 'confirmed' && (
          <div className="flex flex-col items-center gap-2 text-[oklch(0.72_0.19_145)]">
            <CheckCircle2 className="w-12 h-12" />
            <p className="text-sm font-medium">绑定成功</p>
          </div>
        )}
        {status === 'expired' && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <QrCode className="w-10 h-10 opacity-40" />
            <p className="text-xs">二维码已过期</p>
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-2 text-destructive">
            <QrCode className="w-10 h-10 opacity-40" />
            <p className="text-xs px-4 text-center">{message}</p>
          </div>
        )}
        {status === 'idle' && (
          <QrCode className="w-10 h-10 text-muted-foreground/40" />
        )}
      </div>

      {/* Status text */}
      <p className="text-sm text-muted-foreground text-center min-h-5">
        {message}
      </p>

      {/* Refresh button */}
      {(status === 'expired' || status === 'error' || status === 'idle') && (
        <Button variant="outline" size="sm" onClick={fetchQr}>
          <RefreshCw className="w-3.5 h-3.5" />
          重新获取二维码
        </Button>
      )}
    </div>
  );
}

/**
 * Generate a QR code SVG from a string using the qrcode library.
 */
async function generateQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    width: 220,
    color: { dark: '#000000', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
}