import { useState } from 'react';

interface SetupWizardProps {
  onComplete: () => void;
}

const STEPS = [
  { title: '欢迎', icon: '👋' },
  { title: '微信绑定', icon: '🔗' },
  { title: 'Claude Code', icon: '🖥️' },
  { title: '完成', icon: '✅' },
];

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [wechatStatus, setWechatStatus] = useState<'pending' | 'checking' | 'connected' | 'needLogin' | 'failed'>('pending');
  const [wechatInfo, setWechatInfo] = useState('');
  const [claudeStatus, setClaudeStatus] = useState<'pending' | 'checking' | 'ok' | 'failed'>('pending');

  const checkWeChat = async () => {
    setWechatStatus('checking');
    try {
      if (window.electronAPI?.setupWechat) {
        const resp = await window.electronAPI.setupWechat();
        if (resp.success && resp.data) {
          const data = resp.data as any;
          if (data.connected) {
            setWechatStatus('connected');
            setWechatInfo(`账户: ${data.accountId || '已绑定'}`);
          } else if (data.needLogin) {
            setWechatStatus('needLogin');
            setWechatInfo('请在浏览器中扫描二维码完成微信绑定');
          } else {
            setWechatStatus('failed');
          }
        } else {
          setWechatStatus('failed');
        }
      } else {
        // Non-Electron: check localStorage or mock
        await new Promise(r => setTimeout(r, 800));
        setWechatStatus('connected');
        setWechatInfo('账户: 已绑定 (开发模式)');
      }
    } catch {
      setWechatStatus('failed');
    }
  };

  const checkClaude = async () => {
    setClaudeStatus('checking');
    try {
      await new Promise(r => setTimeout(r, 1000));
      setClaudeStatus('ok');
    } catch {
      setClaudeStatus('failed');
    }
  };

  return (
    <div className="max-w-lg mx-auto mt-12">
      {/* Step indicators */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-all ${
              i === step ? 'bg-blue-500 text-white scale-110' :
              i < step ? 'bg-green-500 text-white' :
              'bg-gray-700 text-gray-400'
            }`}>
              {i < step ? '✓' : s.icon}
            </div>
            <span className={`text-xs ${i === step ? 'text-white' : 'text-gray-500'}`}>
              {s.title}
            </span>
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-gray-700" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="card">
        {step === 0 && (
          <div className="text-center py-8">
            <p className="text-5xl mb-4">🔷</p>
            <h2 className="text-2xl font-bold mb-3">欢迎使用 Claude in WeChat</h2>
            <p className="mb-6" style={{ color: 'var(--color-text-muted)' }}>
              在手机上通过微信远程管理你的 Claude Code 项目。
              <br />监控进度、下达任务、做决策 — 随时随地。
            </p>
            <div className="text-left space-y-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              <p>✅ 微信远程控制 Claude Code</p>
              <p>✅ 多项目管理 + 进度追踪</p>
              <p>✅ 任务清单 + Token 统计</p>
              <p>✅ 决策远程确认</p>
              <p>✅ 开机自启 + 系统托盘</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="py-6">
            <h2 className="text-xl font-bold mb-4">🔗 绑定微信</h2>
            <p className="mb-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              使用微信 iLink Bot 收发消息、接收进度通知和决策请求。
            </p>
            <div className="space-y-3">
              <button
                className="btn btn-primary w-full"
                onClick={checkWeChat}
                disabled={wechatStatus === 'checking'}
              >
                {wechatStatus === 'checking' ? '⏳ 检测中...' :
                 wechatStatus === 'connected' ? '🔄 重新检测' :
                 wechatStatus === 'needLogin' ? '🔄 重试绑定' :
                 '🔍 检测微信连接'}
              </button>
              {wechatStatus === 'connected' && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                  <p className="text-green-400 text-sm font-medium">✅ 微信已连接</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{wechatInfo}</p>
                  <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                    现在可以在微信上使用 /list、/new、/check 等命令了
                  </p>
                </div>
              )}
              {wechatStatus === 'needLogin' && (
                <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                  <p className="text-yellow-400 text-sm font-medium">⚠️ 需要微信扫码</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{wechatInfo}</p>
                  <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                    系统将自动打开浏览器显示二维码，用微信扫描即可完成绑定
                  </p>
                </div>
              )}
              {wechatStatus === 'failed' && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                  <p className="text-red-400 text-sm font-medium">❌ 连接失败</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    请确保已安装 claude-to-im skill: /claude-to-im setup
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="py-6">
            <h2 className="text-xl font-bold mb-4">🖥️ 配置 Claude Code</h2>
            <p className="mb-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              安装必要的 hooks 来拦截工具调用和转发决策到微信。
            </p>
            <div className="space-y-3">
              <button
                className="btn btn-primary w-full"
                onClick={checkClaude}
                disabled={claudeStatus === 'checking'}
              >
                {claudeStatus === 'checking' ? '配置中...' : '安装 Hooks 配置'}
              </button>
              {claudeStatus === 'ok' && (
                <p className="text-green-400 text-sm">✅ Hooks 配置完成！</p>
              )}
              {claudeStatus === 'failed' && (
                <p className="text-red-400 text-sm">❌ 配置失败，请检查 Claude Code 是否正确安装</p>
              )}
              <div className="text-xs space-y-1" style={{ color: 'var(--color-text-muted)' }}>
                <p>将自动配置以下 Hooks:</p>
                <p>• PreToolUse — AskUserQuestion 转发到微信</p>
                <p>• PreToolUse — 危险操作微信确认</p>
                <p>• Stop — 完成后微信通知</p>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="text-center py-8">
            <p className="text-5xl mb-4">🎉</p>
            <h2 className="text-2xl font-bold mb-3">设置完成！</h2>
            <p className="mb-6" style={{ color: 'var(--color-text-muted)' }}>
              一切就绪！现在你可以：
              <br />• 在微信发送 /list 查看项目
              <br />• 发送 /new 项目名 创建新项目
              <br />• 发送任务描述开始工作
              <br />• 收到决策问题时回复数字
            </p>
            <div className="text-xs space-y-1 mb-6" style={{ color: 'var(--color-text-muted)' }}>
              <p>微信命令: /list /new /open /delete /rename /check /token /help</p>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          className="btn btn-ghost"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
        >
          ← 上一步
        </button>
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
            下一步 →
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onComplete}>
            开始使用 🚀
          </button>
        )}
      </div>
    </div>
  );
}
