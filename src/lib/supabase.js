import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Supabase 未配置，将使用本地存储模式。请复制 .env.example 为 .env 并填入你的 Supabase 凭证。');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder-key'
);

export const isSupabaseConfigured = () => !!(supabaseUrl && supabaseKey);

// ========== 认证服务 ==========

// GitHub OAuth 登录
export async function signInWithGitHub() {
  if (!isSupabaseConfigured()) throw new Error('Supabase 未配置');
  // 先清除本地 session，确保不会自动登录
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: window.location.origin + '/',
      queryParams: { prompt: 'consent' } // 强制重新授权
    }
  });
  if (error) throw error;
}

// 邮箱+密码登录
export async function signInWithPassword(email, password) {
  if (!isSupabaseConfigured()) throw new Error('Supabase 未配置');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// 邮箱+密码注册
export async function signUpWithPassword(email, password) {
  if (!isSupabaseConfigured()) throw new Error('Supabase 未配置');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

// 退出登录
export async function signOut() {
  if (!isSupabaseConfigured()) return;
  await supabase.auth.signOut();
}

// 获取当前会话
export async function getSession() {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// 监听认证状态变化
export function onAuthStateChange(callback) {
  if (!isSupabaseConfigured()) return { data: { subscription: { unsubscribe: () => {} } } };
  return supabase.auth.onAuthStateChange(callback);
}

// ========== 数据同步服务 ==========

// 从云端拉取用户全量数据
export async function loadUserData(email) {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('user_data')
      .select('data')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data?.data || null; // { records, categories, budget }
  } catch (err) {
    console.error('加载云端数据失败:', err.message);
    return null;
  }
}

// 推送用户全量数据到云端
export async function saveUserData(email, data) {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await supabase
      .from('user_data')
      .upsert({ email, data, updated_at: new Date().toISOString() }, { onConflict: 'email' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('保存云端数据失败:', err.message);
    return false;
  }
}
