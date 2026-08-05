import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { signInWithGitHub, signOut as supabaseSignOut, onAuthStateChange, getSession, isSupabaseConfigured, sendEmailOtp, verifyEmailOtp } from '../lib/supabase';
import { authApi, setToken, getToken } from '../lib/api';

const AuthContext = createContext(null);

// --- 模拟后端存储 (localStorage) ---
const STORAGE_KEY = 'auth_users';
const CURRENT_USER_KEY = 'auth_current_user';
const SESSION_KEY = 'auth_session';

function getUsers() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveUsers(users) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
}

// --- 简易哈希 (仅演示, 生产环境务必使用 bcrypt 等后端方案) ---
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'hash_' + Math.abs(hash).toString(36) + '_' + btoa(str).substring(0, 8);
}

// --- WebAuthn 工具 ---
function isWebAuthnSupported() {
  return typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined';
}

function isPlatformAuthenticatorAvailable() {
  return window.PublicKeyCredential &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';
}

// 生成随机挑战码
function generateChallenge(length = 32) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

// ArrayBuffer 转 Base64URL
function bufferToBase64URL(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach(b => str += String.fromCharCode(b));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Base64URL 转 ArrayBuffer
function base64URLToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64 + padding);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

// --- Provider ---
export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // 启动时检查登录状态
  useEffect(() => {
    const session = localStorage.getItem(SESSION_KEY);
    if (session) {
      try {
        const user = JSON.parse(session);
        setCurrentUser(user);
      } catch { localStorage.removeItem(SESSION_KEY); }
    }
    setIsLoading(false);
  }, []);

  // 第三方/生物识别登录成功后：向 FastAPI 换取 JWT token（保证大模型等鉴权接口可用）
  const exchangeExternalToken = useCallback(async (email) => {
    try {
      const data = await authApi.external(email);
      setToken(data.access_token);
    } catch (err) {
      console.warn('获取后端 token 失败:', err.message);
    }
  }, []);

  // 监听 Supabase OAuth 回调 (GitHub 登录)
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const finalize = (session) => {
      if (!session?.user) return;
      const email = session.user.email;
      const sessionUser = {
        email,
        displayName: session.user.user_metadata?.full_name || session.user.user_metadata?.user_name || email,
        loginMethod: 'github',
      };
      setCurrentUser(sessionUser);
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
      exchangeExternalToken(email); // 换取 FastAPI JWT
    };
    // 页面加载时检查是否有 OAuth 回调的 session
    getSession().then(session => {
      if (session?.user) {
        finalize(session);
        setIsLoading(false);
      }
    });
    // 监听后续的认证变化
    const { data: { subscription } } = onAuthStateChange((_event, session) => {
      finalize(session);
    });
    return () => subscription?.unsubscribe();
  }, [exchangeExternalToken]);

  const clearError = () => setError(null);

  // --- 邮箱 + 密码登录 ---
  const loginWithPassword = useCallback(async (email, password) => {
    clearError();
    if (!email || !password) { setError('请输入邮箱和密码'); return false; }

    try {
      const data = await authApi.login(email, password, null);
      setToken(data.access_token);
      const sessionUser = { email, displayName: email.split('@')[0], loginMethod: 'password' };
      setCurrentUser(sessionUser);
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
      return true;
    } catch (err) {
      setError(err.message || '登录失败');
      return false;
    }
  }, []);

  // --- 发送验证码 ---
  const sendVerificationCode = useCallback(async (email) => {
    clearError();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的邮箱地址');
      return null;
    }
    try {
      await authApi.sendCode(email);
      return true;
    } catch (err) {
      setError('发送失败: ' + (err.message || '未知错误'));
      return null;
    }
  }, []);

  // --- 邮箱 + 验证码登录 / 注册 ---
  const loginWithCode = useCallback(async (email, code) => {
    clearError();
    if (!email || !code) { setError('请输入邮箱和验证码'); return null; }
    if (code.length !== 6) { setError('验证码为6位数字'); return null; }

    try {
      const data = await authApi.login(email, null, code);
      setToken(data.access_token);
      const sessionUser = { email, displayName: email.split('@')[0], loginMethod: 'code' };
      setCurrentUser(sessionUser);
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
      return sessionUser;
    } catch (err) {
      setError('验证失败: ' + (err.message || '验证码错误'));
      return null;
    }
  }, []);

  // --- 注册后设置密码 ---
  const setPassword = useCallback(async (email, password) => {
    if (!password || password.length < 6) { setError('密码至少6位'); return false; }
    try {
      await authApi.setPassword(password);
      return true;
    } catch (err) {
      setError(err.message || '设置失败');
      return false;
    }
  }, []);

  // --- GitHub OAuth 登录 ---
  const loginWithGitHub = useCallback(async () => {
    clearError();
    if (!isSupabaseConfigured()) {
      setError('请先配置 Supabase 以启用 GitHub 登录');
      return false;
    }
    try {
      await signInWithGitHub();
      // 页面会跳转到 GitHub, 不需要返回值
      return true;
    } catch (err) {
      setError('GitHub 登录失败: ' + (err.message || '未知错误'));
      return false;
    }
  }, []);

  // --- WebAuthn 指纹/面容 ID 注册 ---
  const registerWebAuthn = useCallback(async (email) => {
    clearError();
    if (!isWebAuthnSupported()) { setError('当前浏览器不支持指纹/面容 ID'); return false; }

    try {
      const challenge = generateChallenge();
      const userId = new Uint8Array(16);
      crypto.getRandomValues(userId);

      const publicKey = {
        challenge,
        rp: { name: '个人记账本', id: window.location.hostname },
        user: {
          id: userId,
          name: email,
          displayName: email.split('@')[0],
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'none',
      };

      const credential = await navigator.credentials.create({ publicKey });
      if (!credential) { setError('生物识别注册失败'); return false; }

      // 存储凭据信息
      const credentialInfo = {
        id: credential.id,
        rawId: bufferToBase64URL(credential.rawId),
        type: credential.type,
      };
      const users = getUsers();
      if (!users[email]) {
        // 如果用户不存在（比如通过 GitHub 登录的），自动创建
        users[email] = { email, displayName: email.split('@')[0], createdAt: Date.now() };
      }
      users[email].webauthnCredential = credentialInfo;
      saveUsers(users);
      return true;
    } catch (err) {
      console.error('WebAuthn 注册失败:', err);
      setError('生物识别注册失败: ' + (err.message || '未知错误'));
      return false;
    }
  }, []);

  // --- WebAuthn 指纹/面容 ID 登录 ---
  const loginWithWebAuthn = useCallback(async (email) => {
    clearError();
    if (!isWebAuthnSupported()) { setError('当前浏览器不支持指纹/面容 ID'); return false; }

    try {
      const users = getUsers();
      const user = users[email];
      if (!user || !user.webauthnCredential) {
        setError('该账号未绑定生物识别，请先用其他方式登录并注册指纹/面容');
        return false;
      }

      const challenge = generateChallenge();
      const publicKey = {
        challenge,
        timeout: 60000,
        rpId: window.location.hostname,
        allowCredentials: [{
          id: base64URLToBuffer(user.webauthnCredential.rawId),
          type: 'public-key',
          transports: ['internal'],
        }],
        userVerification: 'required',
      };

      const assertion = await navigator.credentials.get({ publicKey });
      if (!assertion) { setError('生物识别验证失败'); return false; }

      const sessionUser = {
        email,
        displayName: user.displayName || email,
        loginMethod: 'webauthn',
      };
      setCurrentUser(sessionUser);
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
      exchangeExternalToken(email); // 换取 FastAPI JWT
      return true;
    } catch (err) {
      console.error('WebAuthn 登录失败:', err);
      setError('生物识别验证失败: ' + (err.message || '未知错误'));
      return false;
    }
  }, []);

  // --- 检查设备是否支持平台认证器 ---
  const checkPlatformAuth = useCallback(async () => {
    if (!isWebAuthnSupported()) return false;
    if (!isPlatformAuthenticatorAvailable()) return false;
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch { return false; }
  }, []);

  // --- 退出登录 (一键退出) ---
  const logout = useCallback(() => {
    setCurrentUser(null);
    localStorage.removeItem(SESSION_KEY);
    setToken(''); // 清除 JWT
    supabaseSignOut(); // 同时退出 Supabase（如果用了的话）
  }, []);

  const value = {
    currentUser,
    isAuthenticated: !!currentUser,
    isLoading,
    error,
    clearError,
    loginWithPassword,
    sendVerificationCode,
    loginWithCode,
    setPassword,
    loginWithGitHub,
    registerWebAuthn,
    loginWithWebAuthn,
    checkPlatformAuth,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { isWebAuthnSupported, isPlatformAuthenticatorAvailable };
