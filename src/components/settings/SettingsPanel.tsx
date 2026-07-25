import { useSettingsStore } from '../../stores/settingsStore';
import { useState } from 'react';

export default function SettingsPanel() {
  const { settings, updateSetting, loading } = useSettingsStore();
  const [qrStatus, setQrStatus] = useState<string>('');

  const handleWeChatSetup = async () => {
    if (window.electronAPI?.setupWechat) {
      setQrStatus('正在生成二维码...');
      const resp = await window.electronAPI.setupWechat();
      if (resp.success) {
        setQrStatus('✅ 微信已连接！请检查手机微信');
        updateSetting('wechatEnabled', true);
      } else {
        setQrStatus(`❌ 连接失败: ${resp.error || '未知错误'}`);
      }
    } else {
      setQrStatus('ℹ️ 请确保已安装 claude-to-im 并完成了微信扫码绑定');
    }
  };

  const handleHooksSetup = async () => {
    if (window.electronAPI?.setupHooks) {
      const resp = await window.electronAPI.setupHooks();
      alert(resp.success ? 'Hooks 配置成功！' : `配置失败: ${resp.error}`);
    } else {
      alert('Hooks 配置需要 Electron 环境');
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold">⚙️ 设置</h2>

      {/* WeChat Setup */}
      <div className="card">
        <h3 className="font-semibold mb-4">🔗 微信绑定</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`status-dot ${settings.wechatEnabled ? 'running' : 'idle'}`} />
            <span>状态: {settings.wechatEnabled ? '🟢 已连接' : '⚪ 未连接'}</span>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={handleWeChatSetup}>
              扫码绑定微信
            </button>
            {settings.wechatEnabled && (
              <button className="btn btn-ghost" onClick={() => updateSetting('wechatEnabled', false)}>
                断开连接
              </button>
            )}
          </div>
          {qrStatus && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{qrStatus}</p>
          )}
        </div>
      </div>

      {/* Claude Code Setup */}
      <div className="card">
        <h3 className="font-semibold mb-4">🖥️ Claude Code 配置</h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">项目目录</label>
            <input
              className="input"
              value={settings.projectDir}
              onChange={e => updateSetting('projectDir', e.target.value)}
              placeholder="~/projects/Wechat"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">最大输出长度 (发送到微信)</label>
            <input
              className="input"
              type="number"
              value={settings.maxOutputLength}
              onChange={e => updateSetting('maxOutputLength', parseInt(e.target.value) || 500)}
            />
          </div>
          <button className="btn btn-primary" onClick={handleHooksSetup}>
            配置 Claude Code Hooks
          </button>
        </div>
      </div>

      {/* General Settings */}
      <div className="card">
        <h3 className="font-semibold mb-4">⚡ 通用设置</h3>
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoStart}
              onChange={e => updateSetting('autoStart', e.target.checked)}
              className="w-4 h-4 rounded accent-blue-500"
            />
            <div>
              <p className="text-sm font-medium">开机自启动</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Windows 启动时自动运行</p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.minimizeToTray}
              onChange={e => updateSetting('minimizeToTray', e.target.checked)}
              className="w-4 h-4 rounded accent-blue-500"
            />
            <div>
              <p className="text-sm font-medium">最小化到系统托盘</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>关闭窗口时隐藏到托盘而不是退出</p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notifyOnComplete}
              onChange={e => updateSetting('notifyOnComplete', e.target.checked)}
              className="w-4 h-4 rounded accent-blue-500"
            />
            <div>
              <p className="text-sm font-medium">完成后微信通知</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Claude Code 完成回复后发送微信通知</p>
            </div>
          </label>

          <div>
            <label className="text-sm font-medium block mb-1">微信轮询间隔 (秒)</label>
            <input
              className="input w-24"
              type="number"
              min={1}
              max={30}
              value={settings.pollInterval}
              onChange={e => updateSetting('pollInterval', parseInt(e.target.value) || 5)}
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">主题</label>
            <select
              className="input"
              value={settings.theme}
              onChange={e => updateSetting('theme', e.target.value as 'dark' | 'light' | 'system')}
            >
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
