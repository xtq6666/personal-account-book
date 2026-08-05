// ========== API 客户端 ==========
// 后端地址（开发环境默认 localhost:8000）
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

let authToken = localStorage.getItem('auth_token') || '';

export function setToken(token) {
  authToken = token;
  if (token) localStorage.setItem('auth_token', token);
  else localStorage.removeItem('auth_token');
}

export function getToken() {
  return authToken || localStorage.getItem('auth_token') || '';
}

async function request(method, path, body = null, isFormData = false) {
  const headers = {};
  if (getToken()) headers['Authorization'] = `Bearer ${getToken()}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `请求失败 (${res.status})`);
  }
  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : res;
}

// ========== 认证 ==========
export const authApi = {
  sendCode: (email) => request('POST', '/auth/send-code', { email }),
  login: (email, password, code) => request('POST', '/auth/login', { email, password, code }),
  setPassword: (password) => request('POST', '/auth/set-password', { password }),
  external: (email) => request('POST', '/auth/external', { email }),
  me: () => request('GET', '/auth/me'),
};

// ========== 账单 ==========
export const billsApi = {
  list: (skip = 0, limit = 500) => request('GET', `/bills/?skip=${skip}&limit=${limit}`),
  get: (id) => request('GET', `/bills/${id}`),
  create: (data) => request('POST', '/bills/', data),
  update: (id, data) => request('PUT', `/bills/${id}`, data),
  delete: (id) => request('DELETE', `/bills/${id}`),
  search: (params) => request('POST', '/bills/search', params),
};

// ========== 分类 ==========
export const categoriesApi = {
  list: (type) => request('GET', `/categories/${type ? `?type=${type}` : ''}`),
  create: (data) => request('POST', '/categories/', data),
  update: (id, data) => request('PUT', `/categories/${id}`, data),
  delete: (id) => request('DELETE', `/categories/${id}`),
};

// ========== 预算 ==========
export const budgetsApi = {
  list: (month) => request('GET', `/budgets/${month ? `?month=${month}` : ''}`),
  create: (data) => request('POST', '/budgets/', data),
  update: (id, data) => request('PUT', `/budgets/${id}`, data),
  delete: (id) => request('DELETE', `/budgets/${id}`),
};

// ========== 报表 ==========
export const reportsApi = {
  monthlySummary: (year, month) => request('GET', `/reports/monthly-summary/${year}/${month}`),
  categoryPie: (year, month, type) => request('GET', `/reports/category-pie/${year}/${month}/${type}`),
  dailyTrend: (year, month) => request('GET', `/reports/daily-trend/${year}/${month}`),
};

// ========== AI 识别 ==========
export const aiApi = {
  recognizeText: (text, categories) => request('POST', '/ai/recognize/text', { text, available_categories: categories }),
  recognizeImage: (file, categories) => {
    const fd = new FormData();
    fd.append('file', file);
    if (categories) fd.append('available_categories', categories);
    return request('POST', '/ai/recognize/image', fd, true);
  },
};

// ========== 导出 ==========
export const exportApi = {
  csv: (params) => request('POST', '/export/csv', params || {}),
  excel: (params) => request('POST', '/export/excel', params || {}),
};
