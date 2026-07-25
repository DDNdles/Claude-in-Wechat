import { useState } from 'react';
import { Card } from '@shared/components/ui/card';
import { Button } from '@shared/components/ui/button';
import { Progress } from '@shared/components/ui/progress';
import { Badge } from '@shared/components/ui/badge';
import { cn } from '@shared/lib/utils';
import { toast } from 'sonner';
import {
  Cable,
  QrCode,
  Wrench,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Zap,
} from 'lucide-react';

interface SetupWizardProps {
  onComplete: () => void;
}

const STEPS = [
  { id: 'welcome', title: '欢迎', icon: Sparkles },
  { id: 'wechat', title: '微信绑定', icon: Cable },
  { id: 'hooks', title: 'Claude Hooks', icon: Wrench },
  { id: 'done', title: '完成', icon: CheckCircle2 },
];

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [wechatStatus, setWechatStatus] = useState<'pending' | 'checking' | 'connected' | 'needLogin' | 'failed'>('pending');
  const [wechatInfo, setWechatInfo] = useState('');
  const [claudeStatus, setClaudeStatus] = useState<'pending' | 'checking' | 'ok' | 'failed'>('pending');
  const [claudeInfo, setClaudeInfo] = useState('');

  const checkWeChat = async () => {
    setWechatStatus('checking');
    const api = window.electronAPI;
    if (!api) { setWechatStatus('failed'); setWechatInfo('需要 Electron 环境'); return; }

    try {
      const accountResp = await api.wechatAccount();
      if (accountResp.success && accountResp.data) {
        setWechatStatus('connected');
        setWechatInfo(`账户已绑定: ${(accountResp.data as any).accountId || 'OK'}`);
        return;
      }
      setWechatStatus('needLogin');
      setWechatInfo('点击下方按钮扫码绑定');
    } catch {
      setWechatStatus('failed');
      setWechatInfo('检测失败，请重试');
    }
  };

  const handleWeChatLogin = async () => {
    setWechatStatus('checking');
    setWechatInfo('正在生成二维码...');
    const api = window.electronAPI;
    if (!api) return;

    const resp = await api.wechatLogin();
    if (resp.success && resp.data?.success) {
      // Poll for account
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const checkResp = await api.wechatAccount();
        if (checkResp.success && checkResp.data) {
          setWechatStatus('connected');
          setWechatInfo(`✅ 已绑定: ${(checkResp.data as any).accountId || ''}`);
          toast.success('微信绑定成功！');
          return;
        }
      }
      setWechatStatus('needLogin');
      setWechatInfo('扫码超时，请重试');
    } else {
      setWechatStatus('failed');
      setWechatInfo(resp.data?.message || resp.error || '登录失败');
    }
  };

  const configureHooks = async () => {
    setClaudeStatus('checking');
    setClaudeInfo('正在安装 hooks...');
    const api = window.electronAPI;
    if (!api) { setClaudeStatus('failed'); setClaudeInfo('需要 Electron 环境'); return; }

    const resp = await api.hooksInstall();
    if (resp.success && resp.data?.success) {
      setClaudeStatus('ok');
      setClaudeInfo((resp.data as any).message || '✅ Hooks 配置完成');
      toast.success('Hooks 配置完成');
    } else {
      setClaudeStatus('failed');
      setClaudeInfo(resp.data?.message || resp.error || '配置失败');
    }
  };

  const progress = ((step) / (STEPS.length - 1)) * 100;

  return (
    <div className="max-w-xl mx-auto mt-8 space-y-6">
      {/* Step indicators */}
      <div className="space-y-4">
        <Progress value={progress} className="h-1.5" />
        <div className="flex items-center justify-center gap-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <div key={s.id} className="flex items-center gap-1">
                <div
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-full transition-all duration-300',
                    isActive && 'bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-110',
                    isDone && 'bg-primary/20 text-primary',
                    !isActive && !isDone && 'bg-muted text-muted-foreground',
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
                <span className={cn(
                  'text-xs font-medium hidden sm:inline',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}>
                  {s.title}
                </span>
                {i < STEPS.length - 1 && (
                  <div className={cn(
                    'w-8 h-0.5 rounded-full mx-1 hidden sm:block',
                    i < step ? 'bg-primary/40' : 'bg-muted',
                  )} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <Card className="p-6">
        {step === 0 && (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <Zap className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight mb-2">欢迎使用 Claude in WeChat</h2>
              <p className="text-muted-foreground max-w-sm mx-auto">
                在手机上通过微信远程管理你的 Claude Code 项目。监控进度、下达任务、做决策 — 随时随地。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-left text-sm text-muted-foreground max-w-sm mx-auto">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> 远程控制</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> 多项目管理</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> 进度追踪</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> 决策确认</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> 开机自启</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> 微信通知</div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="py-4 space-y-4">
            <h2 className="text-xl font-bold tracking-tight">绑定微信</h2>
            <p className="text-sm text-muted-foreground">
              使用 claude-to-im 微信扫码登录。点击按钮后浏览器会打开二维码页面。
            </p>
            <div className="space-y-3">
              <Button className="w-full" onClick={checkWeChat} disabled={wechatStatus === 'checking'}>
                {wechatStatus === 'checking' ? '检测中...' :
                 wechatStatus === 'connected' ? '重新检测' : '检测微信连接'}
              </Button>
              {wechatStatus === 'needLogin' && (
                <Button className="w-full" variant="outline" onClick={handleWeChatLogin}>
                  <QrCode className="w-4 h-4 mr-1.5" />
                  扫码绑定微信
                </Button>
              )}
              {wechatStatus === 'connected' && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-primary text-sm font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    微信已连接
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{wechatInfo}</p>
                </div>
              )}
              {wechatStatus === 'failed' && (
                <p className="text-sm text-destructive">{wechatInfo}</p>
              )}
              {wechatInfo && wechatStatus !== 'connected' && wechatStatus !== 'failed' && (
                <p className="text-sm text-muted-foreground">{wechatInfo}</p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="py-4 space-y-4">
            <h2 className="text-xl font-bold tracking-tight">配置 Claude Code Hooks</h2>
            <p className="text-sm text-muted-foreground">
              安装必要的 hooks 来拦截工具调用和转发决策到微信。
            </p>
            <div className="space-y-3">
              <Button
                className="w-full"
                onClick={configureHooks}
                disabled={claudeStatus === 'checking'}
              >
                <Wrench className="w-4 h-4 mr-1.5" />
                {claudeStatus === 'checking' ? '配置中...' : '安装 Hooks'}
              </Button>
              {claudeStatus === 'ok' && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-primary text-sm font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {claudeInfo}
                  </p>
                </div>
              )}
              {claudeStatus === 'failed' && (
                <p className="text-sm text-destructive">❌ {claudeInfo}</p>
              )}
              <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 p-3 rounded-lg">
                <p className="font-medium mb-1">将自动配置以下 Hooks:</p>
                <p>• PreToolUse — AskUserQuestion 转发到微信</p>
                <p>• PreToolUse — 危险操作微信确认</p>
                <p>• Stop — 完成后微信通知</p>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight mb-2">设置完成！</h2>
              <p className="text-muted-foreground max-w-sm mx-auto">
                一切就绪！现在你可以：
              </p>
            </div>
            <div className="text-sm text-muted-foreground space-y-1.5 bg-muted/50 p-4 rounded-lg max-w-sm mx-auto text-left">
              <p>• 在微信发送 <code className="bg-muted px-1 rounded text-xs">/list</code> 查看项目</p>
              <p>• 发送 <code className="bg-muted px-1 rounded text-xs">/new 项目名</code> 创建新项目</p>
              <p>• 发送任务描述开始工作</p>
              <p>• 收到决策问题时回复数字</p>
            </div>
          </div>
        )}
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          上一步
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep(step + 1)}>
            下一步
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        ) : (
          <Button onClick={onComplete}>
            开始使用
            <Zap className="w-4 h-4 ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
}