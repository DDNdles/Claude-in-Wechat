import { useSettingsStore } from '../../stores/settingsStore';
import { useRelayStore } from '../../stores/relayStore';
import { useState, useEffect } from 'react';

export default function SettingsPanel() {
  const { settings, updateSetting } = useSettingsStore();
  const { running, hasAccount, configured, refreshStatus, loginWeChat, startBridge, stopBridge } = useRelayStore();
  const [wechatMsg, setWechatMsg] = useState('');
  const [hookMsg, setHookMsg] = useState('');
  const [hookStatus, setHookStatus] = useState<{ installed: boolean }>({ installed: false });

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
    setWechatMsg('正在生成二维码...');
    const result = await loginWeChat();
    setWechatMsg(result.message);
    if (result.success) await refreshStatus();
  };

  const handleStartBridge = async () => {
    setWechatMsg('正在启动桥接服务...');
    const result = await startBridge();
    setWechatMsg(result.message);
  };

  const handleStopBridge = async () => {
    setWechatMsg('正在停止桥接服务...');
    const result = await stopBridge();
    setWechatMsg(result.message);
  };

  // ── Hooks ───────────────────────────────────────────────────────

  const handleInstallHooks = async () => {
    setHookMsg('正在配置...');
    const api = window.electronAPI;
    if (!api) { setHookMsg('❌ 需要 Electron 环境'); return; }
    const resp = await api.hooksInstall();
    if (resp.success && resp.data) {
      setHookMsg((resp.data as any).message);
      loadHookStatus();
    } else {
      setHookMsg(`❌ ${resp.error || '配置失败'}`);
    }
  };

  const handleRemoveHooks = async () => {
    setHookMsg('正在移除...');
    const api = window.electronAPI;
    if (!api) return;
    const resp = await api.hooksRemove();
    if (resp.success && resp.data) {
      setHookMsg((resp.data as any).message);
      loadHookStatus();
    } else {
      setHookMsg(`❌ ${resp.error || '移除失败'}`);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold">⚙️ 设置</h2>

      {/* WeChat Bridge */}
      <div className="card">
        <h3 className="font-semibold mb-4">🔗 微信桥接</h3>
        <div className="space-y-3">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={`status-dot ${hasAccount ? 'running' : 'idle'}`} />
            <span>微信: {hasAccount ? '🟢 已绑定' : '⚪ 未绑定'}</span>
            <span className="text-gray-600">|</span>
            <span className={`status-dot ${running ? 'running' : 'idle'}`} />
            <span>桥接: {running ? '🟢 运行中' : '⚪ 未启动'}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={handleWeChatLogin}>
              {hasAccount ? '🔄 重新扫码绑定' : '📱 扫码绑定微信'}
            </button>
            {configured && !running && (
              <button className="btn btn-primary" onClick={handleStartBridge}>
                ▶️ 启动桥接
              </button>
            )}
            {running && (
              <button className="btn btn-ghost" onClick={handleStopBridge}>
                ⏹️ 停止桥接
              </button>
            )}
          </div>
          {wechatMsg && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{wechatMsg}</p>
          )}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            扫码绑定使用 claude-to-im 的微信 iLink Bot。点击按钮后会打开浏览器显示二维码，用微信扫描即可。
          </p>
        </div>
      </div>

      {/* Claude Code Hooks */}
      <div className="card">
        <h3 className="font-semibold mb-4">🪝 Claude Code Hooks</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`status-dot ${hookStatus.installed ? 'running' : 'idle'}`} />
            <span>状态: {hookStatus.installed ? '🟢 已配置' : '⚪ 未配置'}</span>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={handleInstallHooks}>
              {hookStatus.installed ? '🔄 重新配置' : '🔧 配置 Hooks'}
            </button>
            {hookStatus.installed && (
              <button className="btn btn-ghost" onClick={handleRemoveHooks}>
                移除 Hooks
              </button>
            )}
          </div>
          {hookMsg && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{hookMsg}</p>
          )}
          <div className="text-xs space-y-1" style={{ color: 'var(--color-text-muted)' }}>
            <p>配置后会安装以下 Claude Code Hooks:</p>
            <p>• <b>PreToolUse</b> — AskUserQuestion 转发到微信</p>
            <p>• <b>PreToolUse</b> — 危险操作微信确认 (rm -rf, git push --force 等)</p>
            <p>• <b>Stop</b> — Claude 完成后微信通知</p>
          </div>
        </div>
      </div>

      {/* General Settings */}
      <div className="card">
        <h3 className="font-semibold mb-4">⚡ 通用设置</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">项目目录</label>
            <input
              className="input"
              value={settings.projectDir}
              onChange={e => updateSetting('projectDir', e.target.value)}
              placeholder="C:\Users\xxx\projects\Wechat"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.autoStart}
              onChange={e => updateSetting('autoStart', e.target.checked)}
              className="w-4 h-4 rounded accent-blue-500" />
            <div>
              <p className="text-sm font-medium">开机自启动</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Windows 启动时自动运行</p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.minimizeToTray}
              onChange={e => updateSetting('minimizeToTray', e.target.checked)}
              className="w-4 h-4 rounded accent-blue-500" />
            <div>
              <p className="text-sm font-medium">最小化到系统托盘</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>关闭窗口时隐藏到托盘</p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.notifyOnComplete}
              onChange={e => updateSetting('notifyOnComplete', e.target.checked)}
              className="w-4 h-4 rounded accent-blue-500" />
            <div>
              <p className="text-sm font-medium">完成后微信通知</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Claude Code 完成后发送微信通知</p>
            </div>
          </label>

          <div>
            <label className="text-sm font-medium block mb-1">主题</label>
            <select className="input" value={settings.theme}
              onChange={e => updateSetting('theme', e.target.value as 'dark' | 'light' | 'system')}>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
              <option value="system">跟随系统</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
