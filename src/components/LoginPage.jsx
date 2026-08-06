import React, { useState, useEffect, useRef } from 'react';
import {
  Mail, KeyRound, Fingerprint, Github, ArrowLeft,
  Eye, EyeOff, ShieldCheck, LogOut, CheckCircle,
  Sparkles, AlertCircle, RefreshCw
} from 'lucide-react';
import { useAuth, isWebAuthnSupported } from '../context/AuthContext';

// Tab 定义
const TABS = [
  { key: 'code', label: '验证码', icon: Mail },
  { key: 'password', label: '密码', icon: KeyRound },
  { key: 'github', label: 'GitHub', icon: Github },
  { key: 'webauthn', label: '生物识别', icon: Fingerprint },
];

export default function LoginPage() {
  const auth = useAuth();

  // --- 状态 ---
  const [activeTab, setActiveTab] = useState('code');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const codeInputRefs = useRef([]);
  const countdownRef = useRef(null);

  const displayError = localError || auth.error;

  // --- 检测生物识别可用性 ---
  useEffect(() => {
    (async () => {
      if (isWebAuthnSupported()) {
        const available = await auth.checkPlatformAuth();
        setPlatformAuthAvailable(available);
      }
    })();
  }, [auth]);

  // --- 倒计时 ---
  useEffect(() => {
    if (countdown > 0) {
      countdownRef.current = setTimeout(() => setCountdown(c => c - 1), 1000);
    }
    return () => clearTimeout(countdownRef.current);
  }, [countdown]);

  // --- 辅助函数 ---
  const clearAllErrors = () => { setLocalError(null); auth.clearError(); };

  // --- 发送验证码 ---
  const handleSendCode = async () => {
    clearAllErrors();
    if (!email) { setLocalError('请输入邮箱地址'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setLocalError('请输入有效的邮箱地址'); return; }

    setIsSubmitting(true);
    const sentCode = await auth.sendVerificationCode(email);
    setIsSubmitting(false);

    if (sentCode) {
      setCodeSent(true);
      setCountdown(60);
      setCode(['', '', '', '', '', '']); // 清空，等待用户输入收到的验证码
    }
  };

  // --- 验证码输入处理 ---
  const handleCodeChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    // 自动跳转下一个输入框
    if (value && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }
    // 自动提交
    if (index === 5 && value) {
      const fullCode = newCode.slice(0, 5).join('') + value;
      if (fullCode.length === 6) {
        setTimeout(() => handleCodeLogin(fullCode), 300);
      }
    }
  };

  const handleCodePaste = (e) => {
    const pasted = e.clipboardData.getData('text').trim();
    if (/^\d{6}$/.test(pasted)) {
      e.preventDefault();
      const digits = pasted.split('');
      setCode(digits);
      setTimeout(() => handleCodeLogin(pasted), 300);
    }
  };

  const handleCodeKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }
  };

  // --- 验证码登录 ---
  const handleCodeLogin = async (fullCode) => {
    clearAllErrors();
    const codeStr = fullCode || code.join('');
    if (codeStr.length !== 6) { setLocalError('请输入完整的6位验证码'); return; }

    setIsSubmitting(true);
    const result = await auth.loginWithCode(email, codeStr);
    setIsSubmitting(false);

    if (result?.isNewUser) {
      setShowPasswordSetup(true);
    }
  };

  // --- 密码登录 ---
  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    clearAllErrors();
    setIsSubmitting(true);
    await auth.loginWithPassword(email, password);
    setIsSubmitting(false);
  };

  // --- GitHub 登录 ---
  const handleGitHubLogin = async () => {
    clearAllErrors();
    setIsSubmitting(true);
    await auth.loginWithGitHub();
    setIsSubmitting(false);
  };

  // --- 生物识别登录 ---
  const handleWebAuthnLogin = async () => {
    clearAllErrors();
    if (!email) { setLocalError('请先输入邮箱地址以查找您的生物识别凭据'); return; }
    setIsSubmitting(true);
    await auth.loginWithWebAuthn(email);
    setIsSubmitting(false);
  };

  // --- 设置密码 ---
  const handleSetupPassword = async () => {
    clearAllErrors();
    if (!newPassword || newPassword.length < 6) {
      setLocalError('密码至少需要6位'); return;
    }
    setIsSubmitting(true);
    const ok = await auth.setPassword(email, newPassword);
    setIsSubmitting(false);
    if (ok) setShowPasswordSetup(false);
  };

  // --- 渲染密码设置界面 ---
  if (showPasswordSetup) {
    return (
      <div className="max-w-md mx-auto bg-gray-50 min-h-screen flex flex-col">
        <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
          <Sparkles size={24} className="text-yellow-500" />
          <h1 className="text-lg font-bold text-gray-800">完成注册</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle size={32} className="text-green-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">注册成功！</h2>
          <p className="text-gray-500 text-center mb-6 text-sm">
            赶紧设置密码吧，之后就可以用"邮箱+密码"快速登录了
          </p>

          <div className="w-full space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-2">设置登录密码</label>
              <div className="relative">
                <KeyRound size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="password" placeholder="至少6位密码" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 text-gray-800"
                  autoFocus
                />
              </div>
            </div>

            {displayError && (
              <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">
                <AlertCircle size={16} />{displayError}
              </div>
            )}

            <button onClick={handleSetupPassword} disabled={isSubmitting}
              className="w-full py-3.5 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition disabled:opacity-50"
            >
              {isSubmitting ? '设置中...' : '设置密码'}
            </button>
            <button onClick={() => setShowPasswordSetup(false)}
              className="w-full py-3 text-gray-400 text-sm hover:text-gray-600 transition"
            >
              暂时跳过
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 渲染主登录界面 ---
  return (
    <div className="max-w-md mx-auto bg-gray-50 min-h-screen flex flex-col font-sans">
      {/* 顶部 Logo 区 */}
      <div className="bg-white pt-10 pb-6 px-6 text-center shadow-sm">
        <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
          <ShieldCheck size={40} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1">个人记账本</h1>
        <p className="text-sm text-gray-400">安全登录，轻松记账</p>
      </div>

      {/* 登录表单区 */}
      <div className="flex-1 px-6 pt-6 pb-8">
        {/* Tab 切换 */}
        <div className="bg-gray-100 p-1 rounded-xl flex mb-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            // 生物识别不可用时变灰
            const isDisabled = tab.key === 'webauthn' && !platformAuthAvailable;
            return (
              <button
                key={tab.key}
                onClick={() => { if (!isDisabled) { setActiveTab(tab.key); clearAllErrors(); } }}
                disabled={isDisabled}
                className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition text-sm font-medium
                  ${isActive ? 'bg-white shadow text-blue-600' : 'text-gray-400 hover:text-gray-600'}
                  ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* 邮箱输入框 (GitHub 模式不需要) */}
        {activeTab !== 'github' && (
        <div className="mb-4">
          <label className="text-sm font-medium text-gray-600 block mb-2">邮箱地址</label>
          <div className="relative">
            <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="email" placeholder="your@email.com" value={email}
              onChange={e => { setEmail(e.target.value); clearAllErrors(); }}
              className="w-full pl-10 pr-4 py-3 bg-white rounded-xl outline-none focus:ring-2 focus:ring-blue-100 text-gray-800 border border-gray-100"
              autoComplete="email"
            />
          </div>
        </div>
        )}

        {/* 错误提示 */}
        {displayError && (
          <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 px-3 py-2.5 rounded-lg mb-4 animate-slide-up">
            <AlertCircle size={16} className="shrink-0" />
            <span>{displayError}</span>
            <button onClick={clearAllErrors} className="ml-auto shrink-0 text-red-400 hover:text-red-600">
              <XIcon size={14} />
            </button>
          </div>
        )}

        {/* === 验证码模式 === */}
        {activeTab === 'code' && (
          <div>
            {!codeSent ? (
              <button onClick={handleSendCode} disabled={isSubmitting || !email}
                className="w-full py-3.5 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <RefreshCw size={18} className="animate-spin" />
                ) : (
                  <Mail size={18} />
                )}
                {isSubmitting ? '发送中...' : '获取验证码'}
              </button>
            ) : (
              <div>
                <p className="text-sm text-gray-500 text-center mb-4">
                  验证码已发送至 <span className="text-blue-600 font-medium">{email}</span>
                  <br /><span className="text-xs text-gray-400">请查收邮件</span>
                </p>

                {/* 6 位验证码输入 */}
                <div className="flex gap-2 justify-center mb-4" onPaste={handleCodePaste}>
                  {code.map((digit, i) => (
                    <input
                      key={i}
                      ref={el => codeInputRefs.current[i] = el}
                      type="text" inputMode="numeric" maxLength={1}
                      value={digit}
                      onChange={e => handleCodeChange(i, e.target.value)}
                      onKeyDown={e => handleCodeKeyDown(i, e)}
                      className="w-12 h-14 text-center text-2xl font-bold bg-white border-2 border-gray-200 rounded-xl outline-none focus:border-blue-400 transition text-gray-800"
                      autoFocus={i === 0}
                    />
                  ))}
                </div>

                <button onClick={() => handleCodeLogin()} disabled={isSubmitting || code.join('').length !== 6}
                  className="w-full py-3.5 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition disabled:opacity-50"
                >
                  {isSubmitting ? '验证中...' : '登录 / 注册'}
                </button>

                <div className="text-center mt-4">
                  {countdown > 0 ? (
                    <span className="text-sm text-gray-400">{countdown}s 后可重新发送</span>
                  ) : (
                    <button onClick={handleSendCode} disabled={isSubmitting}
                      className="text-sm text-blue-500 hover:text-blue-600 transition"
                    >
                      重新发送验证码
                      {isSubmitting && <RefreshCw size={14} className="inline ml-1 animate-spin" />}
                    </button>
                  )}
                </div>
              </div>
            )}
            <p className="text-xs text-gray-400 text-center mt-4 leading-relaxed">
              首次使用将自动创建账号<br />
              已有账号可直接登录
            </p>
          </div>
        )}

        {/* === 密码模式 === */}
        {activeTab === 'password' && (
          <form onSubmit={handlePasswordLogin}>
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-600 block mb-2">登录密码</label>
              <div className="relative">
                <KeyRound size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'} placeholder="请输入密码" value={password}
                  onChange={e => { setPassword(e.target.value); clearAllErrors(); }}
                  className="w-full pl-10 pr-12 py-3 bg-white rounded-xl outline-none focus:ring-2 focus:ring-blue-100 text-gray-800 border border-gray-100"
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={isSubmitting || !email || !password}
              className="w-full py-3.5 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition disabled:opacity-50"
            >
              {isSubmitting ? '登录中...' : '密码登录'}
            </button>

            <p className="text-xs text-gray-400 text-center mt-4 leading-relaxed">
              还没有密码？<br />
              先用"验证码"登录后在"我的"里设置
            </p>
          </form>
        )}

        {/* === GitHub 模式 === */}
        {activeTab === 'github' && (
          <div className="text-center">
            <div className="bg-gray-800 text-white rounded-2xl p-6 mb-4">
              <Github size={48} className="mx-auto mb-3" />
              <h3 className="font-bold text-lg mb-2">GitHub 一键登录</h3>
              <p className="text-gray-300 text-sm leading-relaxed">
                使用 GitHub 账号快速登录<br />
                首次登录将自动创建记账本账号
              </p>
            </div>

            <button onClick={handleGitHubLogin} disabled={isSubmitting}
              className="w-full py-3.5 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-900 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Github size={20} />
              {isSubmitting ? '跳转中...' : '使用 GitHub 登录'}
            </button>

            <p className="text-xs text-gray-400 text-center mt-4 leading-relaxed">
              点击后将跳转至 GitHub 授权页面<br />
              授权后自动返回并登录
            </p>
          </div>
        )}

        {/* === 生物识别模式 === */}
        {activeTab === 'webauthn' && (
          <div className="text-center">
            <div className="bg-gradient-to-br from-purple-500 to-indigo-600 text-white rounded-2xl p-6 mb-4">
              <Fingerprint size={48} className="mx-auto mb-3" />
              <h3 className="font-bold text-lg mb-1">指纹 / 面容 ID</h3>
              <p className="text-purple-100 text-sm">
                支持 Touch ID、Face ID、Windows Hello
              </p>
            </div>

            <div className="space-y-3">
              <button onClick={handleWebAuthnLogin} disabled={isSubmitting || !email}
                className="w-full py-3.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-bold hover:from-purple-600 hover:to-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
              >
                <Fingerprint size={20} />
                {isSubmitting ? '验证中...' : '指纹 / 面容 登录'}
              </button>
            </div>

            <p className="text-xs text-gray-400 text-center mt-4 leading-relaxed">
              请先使用其他方式登录，在"我的"页面绑定指纹<br />
              之后即可一键指纹/面容登录
            </p>

            {!platformAuthAvailable && (
              <div className="bg-gray-100 rounded-xl p-3 mt-4">
                <p className="text-xs text-gray-500 text-center">
                  当前设备或浏览器不支持平台认证器
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="px-6 pb-8 text-center">
        <p className="text-xs text-gray-300">
          安全加密 · 本地存储 · 隐私无忧
        </p>
      </div>
    </div>
  );
}

// 简单的 X 图标组件
function XIcon({ size = 16, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
