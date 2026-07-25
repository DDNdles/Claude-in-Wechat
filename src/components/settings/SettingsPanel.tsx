import { useSettingsStore } from '../../stores/settingsStore';
import { useRelayStore } from '../../stores/relayStore';
import { useState, useEffect } from 'react';
import { Card } from '@shared/components/ui/card';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Switch } from '@shared/components/ui/switch';
import { Badge } from '@shared/components/ui/badge';
import { Separator } from '@shared/components/ui/separator';
import { toast } from 'sonner';
import {
  Cable,
  Link,
  Plug,
  Play,
  Square,
  QrCode,
  Wrench,
  Monitor,
  Bell,
  Sun,
} from 'lucide-react';

export default function SettingsPanel() {
  const { settings, updateSetting } = useSettingsStore();
  const { running, hasAccount, configured, refreshStatus, loginWeChat, startBridge, stopBridge } = useRelayStore();
  const [wechatMsg, setWechatMsg] = useState('');
  const [hookMsg, setHookMsg] = useState('');
  const [hookStatus, setHookStatus] = useState<{ installed: boolean }>({ installed: false });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    refreshStatus();
    loadHookStatus();
  }, []);

  const loadHookStatus = async () => {
    const api = window.electronAPI;
    if (!api) return;
    const resp = await api.hooksStatus();
    if (resp.success && resp.data) {
      setHookStatus({ installed: (resp.data as any).installed ?? false });
    }
  };

  // ── WeChat ──────────────────────────────────────────────────────

  const handleWeChatLogin = async () => {
    setLoading(true);
    const result = await loginWeChat();
    setWechatMsg(result.message);
    if (result.success) {
      toast.success('微信绑定成功');
      await refreshStatus();
    } else {
      toast.error(result.message || '绑定失败');
    }
    setLoading(false);
  };

  const handleStartBridge = async () => {
    const result = await startBridge();
    if (result.success) toast.success('桥接已启动');
    else toast.error(result.message || '启动失败');
  };

  const handleStopBridge = async () => {
    const result = await stopBridge();
    if (result.success) toast.success('桥接已停止');
    else toast.error(result.message || '停止失败');
  };

  // ── Hooks ───────────────────────────────────────────────────────

  const handleInstallHooks = async () => {
    setHookMsg('正在配置...');
    const api = window.electronAPI;
    if (!api) { setHookMsg('❌ 需要 Electron 环境'); return; }
    const resp = await api.hooksInstall();
    if (resp.success && resp.data) {
      const msg = (resp.data as any).message || '配置完成';
      setHookMsg(msg);
      toast.success('Hooks 配置完成');
      loadHookStatus();
    } else {
      setHookMsg(`❌ ${resp.error || '配置失败'}`);
      toast.error(resp.error || '配置失败');
    }
  };

  const handleRemoveHooks = async () => {
    setHookMsg('正在移除...');
    const api = window.electronAPI;
    if (!api) return;
    const resp = await api.hooksRemove();
    if (resp.success && resp.data) {
      setHookMsg((resp.data as any).message);
      toast.success('Hooks 已移除');
      loadHookStatus();
    } else {
      setHookMsg(`❌ ${resp.error || '移除失败'}`);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <h2 className="text-2xl font-bold tracking-tight">设置</h2>

      {/* WeChat Bridge */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Cable className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">微信桥接</h3>
        </div>

        {/* Status */}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${hasAccount ? 'bg-green-400 animate-pulse-glow' : 'bg-muted-foreground/40'}`} />
            <span className="text-muted-foreground">微信</span>
            <Badge variant={hasAccount ? 'default' : 'secondary'} className="h-5 text-[10px]">
              {hasAccount ? '已绑定' : '未绑定'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${running ? 'bg-green-400 animate-pulse-glow' : 'bg-muted-foreground/40'}`} />
            <span className="text-muted-foreground">桥接</span>
            <Badge variant={running ? 'default' : 'secondary'} className="h-5 text-[10px]">
              {running ? '运行中' : '未启动'}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleWeChatLogin} disabled={loading}>
            <QrCode className="w-4 h-4 mr-1.5" />
            {hasAccount ? '重新扫码绑定' : '扫码绑定微信'}
          </Button>
          {configured && !running && (
            <Button onClick={handleStartBridge}>
              <Play className="w-4 h-4 mr-1.5" />
              启动桥接
            </Button>
          )}
          {running && (
            <Button variant="outline" onClick={handleStopBridge}>
              <Square className="w-4 h-4 mr-1.5" />
              停止桥接
            </Button>
          )}
        </div>
        {wechatMsg && (
          <p className="text-sm text-muted-foreground">{wechatMsg}</p>
        )}
        <p className="text-xs text-muted-foreground">
          扫码绑定使用 claude-to-im 的微信 iLink Bot。点击按钮后会打开浏览器显示二维码。
        </p>
      </Card>

      {/* Claude Code Hooks */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Wrench className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Claude Code Hooks</h3>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <div className={`w-2 h-2 rounded-full ${hookStatus.installed ? 'bg-green-400 animate-pulse-glow' : 'bg-muted-foreground/40'}`} />
          <span className="text-muted-foreground">
            {hookStatus.installed ? '已配置' : '未配置'}
          </span>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleInstallHooks}>
            {hookStatus.installed ? '重新配置' : '配置 Hooks'}
          </Button>
          {hookStatus.installed && (
            <Button variant="outline" onClick={handleRemoveHooks}>
              移除 Hooks
            </Button>
          )}
        </div>
        {hookMsg && (
          <p className="text-sm text-muted-foreground">{hookMsg}</p>
        )}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>配置后会安装以下 Claude Code Hooks:</p>
          <p>• PreToolUse — AskUserQuestion 转发到微信</p>
          <p>• PreToolUse — 危险操作微信确认</p>
          <p>• Stop — Claude 完成后微信通知</p>
        </div>
      </Card>

      {/* General Settings */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Monitor className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">通用设置</h3>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">项目目录</label>
          <Input
            value={settings.projectDir}
            onChange={e => updateSetting('projectDir', e.target.value)}
            placeholder="C:\Users\xxx\projects\Wechat"
          />
        </div>

        <Separator />

        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium">开机自启动</p>
              <p className="text-xs text-muted-foreground">Windows 启动时自动运行</p>
            </div>
            <Switch
              checked={settings.autoStart}
              onCheckedChange={v => updateSetting('autoStart', v)}
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium">最小化到系统托盘</p>
              <p className="text-xs text-muted-foreground">关闭窗口时隐藏到托盘</p>
            </div>
            <Switch
              checked={settings.minimizeToTray}
              onCheckedChange={v => updateSetting('minimizeToTray', v)}
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5" />
                完成后微信通知
              </p>
              <p className="text-xs text-muted-foreground">Claude Code 完成后发送微信通知</p>
            </div>
            <Switch
              checked={settings.notifyOnComplete}
              onCheckedChange={v => updateSetting('notifyOnComplete', v)}
            />
          </label>
        </div>
      </Card>
    </div>
  );
}