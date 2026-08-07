import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Home, PieChart as PieChartIcon, Wallet, User, Plus, X,
  Settings, Check, Upload, Mic, Trash2, ArrowUp, ArrowDown, BellOff, LogOut, AlertTriangle,
  ChevronLeft, ChevronRight, Pencil, Download, FileText, Calendar, KeyRound, Camera, Search, Sparkles
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, Legend
} from 'recharts';
import * as XLSX from 'xlsx';
import { useAuth } from './context/AuthContext';
import LoginPage from './components/LoginPage';
import { loadUserData, saveUserData, isSupabaseConfigured } from './lib/supabase';
import { billsApi, categoriesApi, budgetsApi, aiApi, getToken } from './lib/api';

// --- 初始静态数据 ---
const DEFAULT_CATEGORIES = [
  { id: 'c1', name: '餐饮', type: 'expense', icon: '🍔', color: '#F59E0B', active: true, order: 1, subCategories: [{ id: 's1', name: '早餐' }, { id: 's2', name: '正餐' }] },
  { id: 'c2', name: '交通', type: 'expense', icon: '🚇', color: '#3B82F6', active: true, order: 2, subCategories: [{ id: 's3', name: '打车' }, { id: 's4', name: '公交地铁' }] },
  { id: 'c3', name: '购物', type: 'expense', icon: '🛒', color: '#EC4899', active: true, order: 3, subCategories: [{ id: 's5', name: '日用品' }, { id: 's6', name: '数码' }] },
  { id: 'c4', name: '娱乐', type: 'expense', icon: '🎮', color: '#8B5CF6', active: true, order: 4, subCategories: [{ id: 's7', name: '电影' }, { id: 's8', name: '游戏' }] },
  { id: 'c5', name: '工资', type: 'income', icon: '💰', color: '#10B981', active: true, order: 5, subCategories: [] },
  { id: 'c6', name: '其他', type: 'expense', icon: '📦', color: '#9CA3AF', active: true, order: 6, subCategories: [] },
];

const ICONS_POOL = [
  '🍔', '🍕', '🍜', '🥤', '☕', '🍰', '🍺', '🍳',   // 餐饮
  '🚇', '🚌', '🚗', '⛽', '🚲', '✈️', '🚕',           // 交通
  '🛒', '👔', '👗', '👟', '💄', '👜', '💍',           // 购物
  '🏠', '💡', '💧', '📱', '💻', '🎧',                 // 居家/数码
  '🎮', '🎬', '🎵', '🎤', '🎸', '📚', '🎨',           // 娱乐/教育
  '💊', '🏥', '🏃', '🧘',                               // 健康
  '🐾', '🎁', '🧧', '🎂', '🌹',                         // 宠物/礼金
  '💰', '💳', '📈', '🏦',                               // 理财
]
const COLORS_POOL = ['#F59E0B', '#3B82F6', '#EC4899', '#8B5CF6', '#10B981', '#EF4444', '#14B8A6', '#F97316'];

// --- 工具函数 ---
const generateId = () => Math.random().toString(36).substr(2, 9);
const formatMoney = (amount) => Number(amount).toFixed(2);

export default function App() {
  const auth = useAuth();

  // --- 状态管理 (包含 LocalStorage 持久化) ---
  const [records, setRecords] = useState(() => JSON.parse(localStorage.getItem('my_records')) || []);
  const [categories, setCategories] = useState(() => JSON.parse(localStorage.getItem('my_categories')) || DEFAULT_CATEGORIES);
  const [budget, setBudget] = useState(() => JSON.parse(localStorage.getItem('my_budget')) || { total: 3000, categoryBudgets: {} });
  const [snoozeAlert, setSnoozeAlert] = useState(() => localStorage.getItem('my_snooze') === new Date().getMonth().toString());
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportHistory, setExportHistory] = useState(() => JSON.parse(localStorage.getItem('my_export_history')) || []);

  const [currentTab, setCurrentTab] = useState('home');
  const [showAddModal, setShowAddModal] = useState(false);
  const [deletedRecords, setDeletedRecords] = useState([]); // 批量撤回

  // ⚠️ 所有 hooks 必须在条件返回之前调用（React 规则）
  useEffect(() => { localStorage.setItem('my_records', JSON.stringify(records)); }, [records]);
  useEffect(() => { localStorage.setItem('my_categories', JSON.stringify(categories)); }, [categories]);
  useEffect(() => { localStorage.setItem('my_budget', JSON.stringify(budget)); }, [budget]);
  useEffect(() => { localStorage.setItem('my_export_history', JSON.stringify(exportHistory)); }, [exportHistory]);

  // ===== Supabase 云端同步 =====
  const [syncStatus, setSyncStatus] = useState('off'); // off | syncing | online | error

  // 登录后从云端拉取数据
  useEffect(() => {
    if (!isSupabaseConfigured() || !auth.currentUser?.email) return;
    const email = auth.currentUser.email;
    setSyncStatus('syncing');
    loadUserData(email).then(cloudData => {
      if (cloudData) {
        if (cloudData.records?.length) setRecords(cloudData.records);
        if (cloudData.categories?.length) setCategories(cloudData.categories);
        if (cloudData.budget) setBudget(cloudData.budget);
      }
      // 无论云端有无数据，都标记在线并触发一次推送（确保两端数据一致）
      setSyncStatus('online');
    }).catch(() => setSyncStatus('error'));
  }, [auth.currentUser?.email]);

  // 数据变更后推送到云端（限流 2 秒）
  useEffect(() => {
    if (!isSupabaseConfigured() || !auth.currentUser?.email) return;
    if (syncStatus === 'off' || syncStatus === 'syncing') return;
    const timer = setTimeout(() => {
      saveUserData(auth.currentUser.email, { records, categories, budget });
    }, 2000);
    return () => clearTimeout(timer);
  }, [records, categories, budget, syncStatus]);

  // ===== Supabase 云端同步（主数据存储）=====
  // 数据存在 Supabase，不会因 Render 重启丢失。后端 FastAPI 只管认证 + AI 识别。

  // 登录后从 Supabase 拉取数据（含首次迁移逻辑）
  useEffect(() => {
    if (!isSupabaseConfigured() || !auth.currentUser?.email) return;
    const email = auth.currentUser.email;
    setSyncStatus('syncing');
    loadUserData(email).then(cloudData => {
      const hasCloud = cloudData?.records?.length || cloudData?.categories?.length;
      const hasLocal = records.length > 0 || categories.length > DEFAULT_CATEGORIES.length;

      if (hasCloud) {
        // 云端有数据 → 用云端的
        if (cloudData.records?.length) setRecords(cloudData.records);
        if (cloudData.categories?.length) setCategories(cloudData.categories);
        if (cloudData.budget) setBudget(cloudData.budget);
      } else if (hasLocal) {
        // 云端空 + 本地有数据 → 首次迁移：推本地到云端
        console.log('⬆️ 首次数据迁移：本地 → Supabase');
        saveUserData(email, { records, categories, budget });
      }
      setSyncStatus('online');
    }).catch(() => setSyncStatus('error'));
  }, [auth.currentUser?.email]);

  // 数据变更后推送到 Supabase（限流 2 秒）+ 页面关闭前强制推送
  useEffect(() => {
    if (!isSupabaseConfigured() || !auth.currentUser?.email) return;
    if (syncStatus === 'off' || syncStatus === 'syncing') return;
    // 防止空数据覆盖：records 为空时不主动推送（首次登录加载中）
    if (!records.length && syncStatus === 'online') return;
    const timer = setTimeout(() => {
      saveUserData(auth.currentUser.email, { records, categories, budget });
    }, 2000);
    const handleUnload = () => { if (records.length) saveUserData(auth.currentUser.email, { records, categories, budget }); };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [records, categories, budget, syncStatus]);

  // --- 衍生数据计算 ---
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const currentMonthRecords = useMemo(() => {
    return records.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
  }, [records, currentMonth, currentYear]);

  // 总支出 (排除待报销)
  const totalExpense = currentMonthRecords.filter(r => r.type === 'expense' && !r.isReimbursable).reduce((sum, r) => sum + Number(r.amount), 0);
  const totalIncome = currentMonthRecords.filter(r => r.type === 'income').reduce((sum, r) => sum + Number(r.amount), 0);

  // 预算进度与预警
  const budgetProgress = budget.total > 0 ? (totalExpense / budget.total) * 100 : 0;
  const showStrongAlert = budgetProgress >= 120 && !snoozeAlert;

  const handleSnooze = () => {
    setSnoozeAlert(true);
    localStorage.setItem('my_snooze', currentMonth.toString());
  };

  // 撤回机制
  const handleDeleteRecord = (id) => {
    const target = records.find(r => r.id === id);
    if (!target) return;
    setDeletedRecords(prev => [...prev, target]);
    setRecords(records.filter(r => r.id !== id));
    setTimeout(() => setDeletedRecords(prev => prev.filter(r => r.id !== id)), 5000);
  };

  const undoDelete = () => {
    if (deletedRecords.length > 0) {
      setRecords([...records, ...deletedRecords]);
      setDeletedRecords([]);
    }
  };

  // 补充批量删除的逻辑
  const handleDeleteBatch = (idsToDelete) => {
    const targets = records.filter(r => idsToDelete.includes(r.id));
    if (targets.length === 0) return;
    setDeletedRecords(prev => [...prev, ...targets]);
    setRecords(records.filter(r => !idsToDelete.includes(r.id)));
    setTimeout(() => setDeletedRecords(prev => prev.filter(r => !idsToDelete.includes(r.id))), 5000);
  };

  // 补充修改分类的逻辑
  const handleUpdateRecord = (id, updates) => {
    setRecords(records.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  // --- 登录守卫: 未登录时显示登录页（所有 hooks 之后） ---
  if (auth.isLoading) {
    return (
      <div className="max-w-md mx-auto bg-gray-50 h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <LoginPage />;
  }

  // --- 渲染核心布局 ---
  return (
    <div className="max-w-md mx-auto bg-gray-50 h-screen flex flex-col relative overflow-hidden font-sans">

      {/* 预警弹窗 (120%) */}
      {showStrongAlert && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <BellOff size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">预算严重超支警告</h2>
            <p className="text-gray-600 mb-6">
              本月支出已达 <span className="text-red-500 font-bold">{formatMoney(totalExpense)}</span> 元，
              超出总预算的 120%！请注意控制后续消费。
            </p>
            <div className="space-y-3">
              <button onClick={() => setSnoozeAlert(true)} className="w-full py-3 bg-red-500 text-white rounded-xl font-medium">知道了，延后提醒</button>
              <button onClick={handleSnooze} className="w-full py-3 bg-gray-100 text-gray-600 rounded-xl font-medium">本月不再提醒</button>
            </div>
          </div>
        </div>
      )}

      {/* 顶部标题栏 */}
      <header className="bg-white px-4 py-3 flex justify-between items-center shadow-sm z-10">
        <div>
          <h1 className="text-lg font-bold text-gray-800">个人记账本</h1>
          {auth.currentUser && (
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-gray-400 truncate max-w-[160px]">{auth.currentUser.email}</p>
              {isSupabaseConfigured() && (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${syncStatus === 'online' ? 'bg-green-400' : syncStatus === 'syncing' ? 'bg-amber-400 animate-pulse' : syncStatus === 'error' ? 'bg-red-400' : 'bg-gray-300'}`}
                  title={syncStatus === 'online' ? '云端已同步' : syncStatus === 'syncing' ? '同步中...' : syncStatus === 'error' ? '同步失败' : '离线模式'} />
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => { if (confirm('确定要退出登录吗？')) auth.logout(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-500 rounded-lg text-sm font-medium hover:bg-red-100 transition"
          title="一键退出登录"
        >
          <LogOut size={16} />
          <span>退出</span>
        </button>
      </header>

      {/* 主要内容区 */}
      <main className="flex-1 overflow-y-auto no-scrollbar pb-20">
        {currentTab === 'home' && (
          <HomeTab
            records={currentMonthRecords}
            totalExpense={totalExpense}
            totalIncome={totalIncome}
            budget={budget}
            budgetProgress={budgetProgress}
            categories={categories}
            onDelete={handleDeleteRecord}
            onViewAll={() => setCurrentTab('reports')}
          />
        )}
        {currentTab === 'reports' && <ReportsTab records={records} categories={categories} onDeleteBatch={handleDeleteBatch} onDelete={handleDeleteRecord} onUpdate={handleUpdateRecord} />}
        {currentTab === 'budget' && <BudgetTab budget={budget} setBudget={setBudget} records={currentMonthRecords} categories={categories} />}
        {currentTab === 'profile' && <ProfileTab categories={categories} setCategories={setCategories} onOpenExport={() => setShowExportModal(true)} />}
      </main>

      {/* 底部导航栏 */}
      <nav className="absolute bottom-0 w-full bg-white border-t flex justify-around items-center h-16 pb-safe z-20">
        <NavItem icon={<Home />} label="首页" active={currentTab === 'home'} onClick={() => setCurrentTab('home')} />
        <NavItem icon={<PieChartIcon />} label="报表" active={currentTab === 'reports'} onClick={() => setCurrentTab('reports')} />

        {/* 悬浮记账按钮 */}
        <div className="relative -top-5">
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-blue-500 text-white p-4 rounded-full shadow-lg shadow-blue-500/30 hover:bg-blue-600 transition"
          >
            <Plus size={24} />
          </button>
        </div>

        <NavItem icon={<Wallet />} label="预算" active={currentTab === 'budget'} onClick={() => setCurrentTab('budget')} />
        <NavItem icon={<User />} label="我的" active={currentTab === 'profile'} onClick={() => setCurrentTab('profile')} />
      </nav>

      {/* 记账弹窗 */}
      {showAddModal && (
        <AddRecordModal
          onClose={() => setShowAddModal(false)}
          categories={categories.filter(c => c.active)}
          onSave={(newRecord) => {
            setRecords([...records, newRecord]);
            setShowAddModal(false);
          }}
        />
      )}

      {/* 撤销提示框 */}
      {deletedRecords.length > 0 && (
        <div className="absolute bottom-20 left-4 right-4 bg-gray-800 text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center z-30 animate-slide-up">
          <span className="text-sm">{deletedRecords.length} 笔账单已删除（5秒后不可恢复）</span>
          <button onClick={undoDelete} className="text-blue-400 font-bold text-sm hover:text-blue-300 transition-colors">撤销</button>
        </div>
      )}

      {/* 导出弹窗 */}
      {showExportModal && (
        <ExportModal
          records={records}
          categories={categories}
          exportHistory={exportHistory}
          setExportHistory={setExportHistory}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}

// ================= 组件: 底部导航 Item =================
function NavItem({ icon, label, active, onClick }) {
  return (
    <div onClick={onClick} className={`flex flex-col items-center justify-center w-16 cursor-pointer ${active ? 'text-blue-500' : 'text-gray-400'}`}>
      {React.cloneElement(icon, { size: 22 })}
      <span className="text-[10px] mt-1">{label}</span>
    </div>
  );
}

// ================= 组件: 首页明细 (升级版 UI) =================
function HomeTab({ records, totalExpense, totalIncome, budget, budgetProgress, categories, onDelete, onViewAll }) {
  const getCat = (id) => categories.find(c => c.id === id) || { icon: '❓', name: '未知' };

  // 动态计算今日可用余额
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - today.getDate() + 1;
  const remainingBudget = Math.max(0, budget.total - totalExpense);
  const dailyAvailable = budget.total > 0 ? (remainingBudget / remainingDays) : 0;

  // 进度条颜色分级
  let progressColor = 'bg-blue-500';
  if (budgetProgress >= 100) progressColor = 'bg-red-500';
  else if (budgetProgress >= 80) progressColor = 'bg-orange-500';

  return (
    <div className="p-4 space-y-4">
      {/* 顶部概览卡片 */}
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-5 text-white shadow-lg mb-2">
        <p className="text-blue-100 text-sm mb-1">本月结余 · {today.getMonth() + 1}月</p>
        <h2 className="text-3xl font-bold mb-4">{formatMoney(totalIncome - totalExpense)}</h2>
        <div className="flex justify-between border-t border-blue-400/30 pt-4">
          <div><p className="text-blue-100 text-xs">本月收入</p><p className="font-semibold">{formatMoney(totalIncome)}</p></div>
          <div><p className="text-blue-100 text-xs">本月支出</p><p className="font-semibold">{formatMoney(totalExpense)}</p></div>
        </div>
      </div>

      {/* 预算进度卡片 - 全新 UI */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-50">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2 text-gray-700 font-bold">
            <Wallet size={18} className="text-gray-400" />
            <span className="text-[15px]">预算进度</span>
          </div>
          <span className="text-sm text-gray-500 font-medium">{budgetProgress.toFixed(1)}%</span>
        </div>

        <div className="w-full bg-gray-100 rounded-full h-3 mb-4">
          <div
            className={`h-3 rounded-full transition-all ${progressColor}`}
            style={{ width: `${Math.min(budgetProgress, 100)}%` }}
          />
        </div>

        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-500">已用: ¥{formatMoney(totalExpense)} / ¥{budget.total}</span>
          <span className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg font-medium text-xs">
            今日可用: ¥{formatMoney(dailyAvailable)}
          </span>
        </div>
      </div>

      {/* 最近账单列表 */}
      <div>
        <div className="flex justify-between items-center mb-3 mt-5 px-1">
          <h3 className="text-lg font-bold text-gray-800">最近账单</h3>
          <span onClick={onViewAll} className="text-sm text-blue-500 cursor-pointer hover:text-blue-600 transition-colors">查看全部 &gt;</span>
        </div>

        <div className="space-y-2">
          {records.length === 0 ? <p className="text-center text-gray-400 py-6 text-sm">暂无账单</p> :
            [...records].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 15).map(r => {
              const cat = getCat(r.categoryId);
              return (
                <div key={r.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex items-center justify-between hover:shadow transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl bg-gray-50" style={{ color: cat.color }}>{cat.icon}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-800">{cat.name} {r.subCategoryName ? `- ${r.subCategoryName}` : ''}</span>
                        {r.isReimbursable && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">报销</span>}
                      </div>
                      <span className="text-xs text-gray-400">{r.date.split('T')[0]} {r.remark && `| ${r.remark}`}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-base font-bold ${r.type === 'income' ? 'text-green-500' : 'text-gray-800'}`}>{r.type === 'income' ? '+' : '-'}{formatMoney(r.amount)}</span>
                    <button onClick={() => onDelete(r.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16}/></button>
                  </div>
                </div>
              );
            })
          }
        </div>
      </div>
    </div>
  );
}

// ================= 组件: 记账弹窗 (修复: 增加日期选择与默认值) =================
function AddRecordModal({ onClose, categories, onSave }) {
  const [type, setType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedSubCat, setSelectedSubCat] = useState(null);
  const [remark, setRemark] = useState('');
  const [isReimbursable, setIsReimbursable] = useState(false);
  const [smartText, setSmartText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [attachments, setAttachments] = useState([]); // 照片附件 (base64)

  // 语义关键词映射：大模型返回的自由分类名 → 已有主分类
  const CATEGORY_KEYWORDS = {
    '餐饮': ['餐', '食', '吃', '饭', '面', '饮', '咖啡', '奶茶', '茶', '奶', '早餐', '午餐', '晚餐', '外卖', '夜宵', '水', '零食', '水果', '菜', '汉堡', '披萨', '超市便当'],
    '交通': ['车', '地铁', '公交', '出租', '打车', '加油', '停车', '高铁', '机票', '充电', '骑行', '单车', '油费', '过路'],
    '购物': ['购', '买', '超市', '百货', '用品', '衣服', '鞋', '数码', '日用品', '商场', '便利店', '淘宝', '京东', '生活用品', '家居'],
    '娱乐': ['电影', '游戏', 'KTV', '音乐', '演出', '旅游', '景区', '门票', '健身', '运动', '网吧', '桌游'],
    '住房': ['房租', '水电', '煤气', '燃气', '物业', '维修', '家电', '家具', '宽带'],
    '医疗': ['药', '医院', '挂号', '体检', '牙', '医', '疫苗'],
  };

  // 根据建议分类名匹配主分类+子分类
  const applySuggestedCategory = (suggestedName, cats) => {
    if (!suggestedName) return;
    const name = String(suggestedName).trim();
    // 1) 先匹配子分类（建议名包含子分类名或反之）
    const withSub = cats.find(c =>
      c.subCategories?.find(s => name.includes(s.name) || s.name.includes(name))
    );
    if (withSub) {
      setSelectedCat(withSub);
      const sub = withSub.subCategories.find(s => name.includes(s.name) || s.name.includes(name));
      if (sub) setSelectedSubCat(sub);
      return;
    }
    // 2) 精确匹配主分类
    const found = cats.find(c => c.name === name || c.name.includes(name) || name.includes(c.name));
    if (found) {
      setSelectedCat(found);
      setSelectedSubCat(null);
      return;
    }
    // 3) 语义关键词兜底：映射到已有主分类
    for (const [catName, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some(k => name.includes(k))) {
        const cat = cats.find(c => c.name === catName);
        if (cat) {
          setSelectedCat(cat);
          setSelectedSubCat(null);
          return;
        }
      }
    }
    // 4) 都没匹配到 → 落到"其他"
    setSelectedCat(cats.find(c => c.name === '其他') || null);
  };

  // 中文数字转阿拉伯数字
  const parseChineseNumber = (text) => {
    const map = { '零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,
                  '十':10,'百':100,'千':1000,'万':10000,'两':2 };
    const chars = text.split('');
    let total = 0, current = 0;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (c === '十') {
        current = (current || 1) * 10;
      } else if (c === '百') {
        current = (current || 1) * 100;
      } else if (c === '千') {
        current = (current || 1) * 1000;
      } else if (c === '万') {
        total = (total + current) * 10000; current = 0;
      } else if (map[c] !== undefined) {
        if (current >= 10) { total += current; current = 0; }
        current += map[c];
      }
    }
    return total + current;
  };

  // 将文本中的中文数字替换为阿拉伯数字
  const replaceChineseNumbers = (text) => {
    // 先去除"块/元"等货币后缀，避免干扰数字匹配
    let t = text.replace(/[块元钱]/g, '');
    return t.replace(/[零一二三四五六七八九十百千万两]+/g, (match) => {
      const num = parseChineseNumber(match);
      return String(num);
    });
  };

  // 语音识别
  const startVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('您的浏览器不支持语音识别，请使用 Chrome 或 Edge。');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setIsListening(true);
    recognition.start();

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      // 去掉中文标点
      let cleaned = transcript.replace(/[。，！？、]/g, ' ').replace(/\s+/g, ' ').trim();
      // 中文数字转阿拉伯数字
      cleaned = replaceChineseNumbers(cleaned);
      setSmartText(cleaned);
      setIsListening(false);
      setTimeout(() => {
        // 优先大模型识别
        if (getToken()) {
          aiApi.recognizeText(cleaned, categories.filter(c => c.type === type).map(c => c.name)).then(res => {
            const r = res.result;
            if (r.amount) setAmount(String(r.amount));
            applySuggestedCategory(r.suggested_category_name, categories.filter(c => c.type === type).sort((a,b) => a.order - b.order));
            if (r.note) setRemark(r.note);
          }).catch(() => {});
        }
        // 正则降级
        const match = cleaned.match(/(\D+)\s*(\d+(?:\.\d+)?)/);
        const keyword = match ? match[1].trim() : cleaned;
        if (match && !getToken()) setAmount(match[2]);
        const cats = categories.filter(c => c.type === type).sort((a,b) => a.order - b.order);
        const foundCat = cats.find(c =>
          keyword.includes(c.name) || c.name.includes(keyword) ||
          (c.subCategories?.find(s => keyword.includes(s.name) || s.name.includes(keyword)))
        );
        if (foundCat) {
          setSelectedCat(foundCat);
          const sub = foundCat.subCategories?.find(s => keyword.includes(s.name) || s.name.includes(keyword));
          if (sub) setSelectedSubCat(sub);
        }
      }, 100);
    };

    recognition.onerror = () => {
      setIsListening(false);
      alert('语音识别失败，请重试。');
    };

    recognition.onend = () => {
      setIsListening(false);
    };
  };

  // 根据分类获取常用金额
  const getQuickAmounts = () => {
    if (type === 'income') return [3000, 5000, 8000, 10000, 15000, 20000];
    const name = selectedCat?.name || '';
    if (name.includes('餐饮') || name.includes('饭') || name.includes('食')) return [15, 25, 35, 50, 80, 120];
    if (name.includes('交通') || name.includes('行')) return [3, 5, 10, 20, 30, 50];
    if (name.includes('购物') || name.includes('买')) return [50, 100, 200, 300, 500, 1000];
    if (name.includes('娱乐') || name.includes('玩')) return [30, 50, 80, 150, 200, 300];
    if (name.includes('住') || name.includes('房')) return [500, 1000, 2000, 3000, 5000];
    return [10, 20, 50, 100, 200, 500];
  };

  const quickAmounts = selectedCat ? getQuickAmounts() : [];
  const [recordDate, setRecordDate] = useState(() => {
    const today = new Date();
    // 处理时区偏移，确保显示本地正确的日期
    const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
    return localDate.toISOString().split('T')[0];
  });

  // 获取当前类型下激活的主分类
  const activeCategories = categories.filter(c => c.type === type).sort((a,b) => a.order - b.order);

  // 智能解析文本（优先大模型，降级正则）
  const handleSmartParse = () => {
    if(!smartText) return;
    // 尝试大模型识别
    if (getToken()) {
      aiApi.recognizeText(smartText, activeCategories.map(c => c.name)).then(res => {
        const r = res.result;
        if (r.amount) setAmount(String(r.amount));
        applySuggestedCategory(r.suggested_category_name, activeCategories);
        if (r.note) setRemark(r.note);
        if (r.biz_date) setRecordDate(r.biz_date);
      }).catch(() => { /* 失败静默，降级正则 */ });
    }
    // 正则降级（立即执行，大模型结果异步覆盖）
    const match = smartText.match(/(\D+)\s*(\d+(?:\.\d+)?)/);
    const keyword = match ? match[1].trim() : smartText;
    if(match && !getToken()) setAmount(match[2]); // 无 API 时用正则金额
    const cat = activeCategories.find(c =>
      keyword.includes(c.name) || c.name.includes(keyword) ||
      (c.subCategories?.find(s => keyword.includes(s.name) || s.name.includes(keyword)))
    );
    if(cat) {
      setSelectedCat(cat);
      const sub = cat.subCategories?.find(s => keyword.includes(s.name) || s.name.includes(keyword));
      if(sub) setSelectedSubCat(sub);
    }
  };

  // 拍照/选照片
  const handlePickImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('图片不能超过 5MB'); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachments(prev => [...prev, reader.result]);
    reader.readAsDataURL(file);
    e.target.value = '';
    // 大模型图片识别
    if (getToken()) {
      const catNames = activeCategories.map(c => c.name).join(',');
      aiApi.recognizeImage(file, catNames).then(res => {
        const r = res.result;
        if (r.amount) setAmount(String(r.amount));
        applySuggestedCategory(r.suggested_category_name, activeCategories);
        if (r.note) setRemark(r.note);
        if (r.biz_date) setRecordDate(r.biz_date);
      }).catch(() => {});
    }
  };

  const removeAttachment = (idx) => setAttachments(prev => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    if (!amount || Number(amount) <= 0 || !selectedCat) return;

    // 将用户选择的日期转换为完整的 ISO 时间戳（默认取当天的中午12点以防跨时区变动）
    const finalDate = new Date(`${recordDate}T12:00:00Z`).toISOString();

    onSave({
      id: generateId(),
      type,
      amount: Number(amount),
      categoryId: selectedCat.id,
      subCategoryName: selectedSubCat?.name || '',
      date: finalDate,
      remark,
      isReimbursable: type === 'expense' ? isReimbursable : false,
      attachments
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white w-full rounded-t-2xl p-4 flex flex-col h-[85vh] animate-slide-up">
        {/* 顶部标题与类型切换 */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex gap-4 bg-gray-100 p-1 rounded-lg">
            <button className={`px-4 py-1 rounded-md text-sm ${type === 'expense' ? 'bg-white shadow font-bold' : 'text-gray-500'}`} onClick={() => {setType('expense'); setSelectedCat(null);}}>支出</button>
            <button className={`px-4 py-1 rounded-md text-sm ${type === 'income' ? 'bg-white shadow font-bold' : 'text-gray-500'}`} onClick={() => {setType('income'); setSelectedCat(null);}}>收入</button>
          </div>
          <button onClick={onClose} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X size={18} /></button>
        </div>

        {/* 智能输入框 */}
        <div className="flex gap-2 mb-1">
          <input type="text" placeholder="输入文字描述(例: 午餐 25)" value={smartText} onChange={e=>setSmartText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSmartParse()} className="flex-1 bg-gray-50 p-2 rounded-lg text-sm outline-none border border-gray-100 focus:border-blue-300"/>
          <button onClick={handleSmartParse} disabled={!smartText.trim()} className="p-2 rounded-lg transition-all shrink-0 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed" title="AI 识别"><Sparkles size={18}/></button>
          <button onClick={startVoice} disabled={isListening} className={`p-2 rounded-lg transition-all shrink-0 ${isListening ? 'bg-red-50 text-red-500 animate-pulse' : 'bg-gray-50 text-gray-500 hover:text-blue-500'}`} title="语音录入"><Mic size={18}/></button>
        </div>

        {/* 拍照附件按钮（独立一行，避免与智能输入冲突） */}
        <div className="mb-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-500 cursor-pointer transition-colors">
            <input type="file" accept="image/*" onChange={handlePickImage} className="hidden" />
            <Camera size={16}/> 拍照添加附件
          </label>
        </div>

        {/* 照片附件预览 */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar pb-1">
            {attachments.map((img, idx) => (
              <div key={idx} className="relative shrink-0">
                <img src={img} alt={`附件${idx+1}`} className="w-20 h-20 object-cover rounded-xl border border-gray-100" />
                <button onClick={() => removeAttachment(idx)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-800/70 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors"><X size={10}/></button>
              </div>
            ))}
            <label className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 hover:border-blue-300 hover:text-blue-400 cursor-pointer transition-colors shrink-0">
              <input type="file" accept="image/*" onChange={handlePickImage} className="hidden" />
              <Plus size={22}/>
            </label>
          </div>
        )}

        {/* 金额输入 */}
        <div className="border-b-2 border-blue-500 mb-3 pb-2 flex items-center">
          <span className="text-3xl font-bold mr-2 text-gray-800">¥</span>
          <input type="number" autoFocus placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full text-4xl font-bold outline-none text-gray-800 bg-transparent"/>
        </div>

        {/* 常用金额快捷按钮 */}
        {quickAmounts.length > 0 && (
          <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar pb-1">
            {quickAmounts.map((val, idx) => (
              <button key={idx} onClick={() => setAmount(String(val))}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${String(amount) === String(val) ? 'bg-blue-500 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 active:scale-95'}`}>
                ¥{val}
              </button>
            ))}
          </div>
        )}

        {/* 主分类选择区 */}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-4 gap-y-5 gap-x-2">
            {activeCategories.map(cat => (
              <div key={cat.id} onClick={() => { setSelectedCat(cat); setSelectedSubCat(null); }} className={`flex flex-col items-center gap-1.5 cursor-pointer transition-transform ${selectedCat?.id === cat.id ? 'scale-110' : 'opacity-70 hover:opacity-100'}`}>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${selectedCat?.id === cat.id ? 'shadow-md ring-2 ring-blue-400 ring-offset-2' : 'bg-gray-50'}`} style={{ backgroundColor: selectedCat?.id === cat.id ? cat.color : '#f9fafb', color: selectedCat?.id === cat.id ? '#fff' : cat.color }}>
                  {cat.icon}
                </div>
                <span className={`text-xs ${selectedCat?.id === cat.id ? 'font-bold text-gray-800' : 'text-gray-500'}`}>{cat.name}</span>
              </div>
            ))}
          </div>

          {/* 子分类展示 */}
          {selectedCat?.subCategories?.length > 0 && (
            <div className="mt-6 bg-gray-50 p-3 rounded-xl border border-gray-100">
              <p className="text-xs text-gray-400 mb-2">选择子分类 (可选)</p>
              <div className="flex flex-wrap gap-2">
                {selectedCat.subCategories.map(sub => (
                  <button key={sub.id} onClick={() => setSelectedSubCat(sub)} className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${selectedSubCat?.id === sub.id ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                    {sub.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部表单与操作区 (修复: 加入日期选择器) */}
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-3 pb-safe bg-white">
          <div className="flex gap-2">
             {/* 日期选择器 */}
             <input
              type="date"
              value={recordDate}
              onChange={(e) => setRecordDate(e.target.value)}
              className="bg-gray-50 p-3 rounded-xl outline-none text-sm text-gray-700 w-36 border border-transparent focus:border-blue-300"
            />
            {/* 备注输入 */}
            <input
              type="text"
              placeholder="添加备注..."
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="flex-1 bg-gray-50 p-3 rounded-xl outline-none text-sm border border-transparent focus:border-blue-300"
            />
          </div>

          {type === 'expense' && (
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer pl-1">
              <input type="checkbox" checked={isReimbursable} onChange={e=>setIsReimbursable(e.target.checked)} className="w-4 h-4 rounded text-blue-500" />
              不计入总支出 / 待报销
            </label>
          )}

          <button onClick={handleSave} disabled={!amount || !selectedCat} className={`w-full py-3.5 rounded-xl font-bold text-white transition-all ${!amount || !selectedCat ? 'bg-blue-200 cursor-not-allowed' : 'bg-blue-500 shadow-lg shadow-blue-500/30 hover:bg-blue-600 active:scale-95'}`}>
            保存账单
          </button>
        </div>
      </div>
    </div>
  );
}

// ================= 组件: 报表与批量操作 (深度还原版 UI) =================
function ReportsTab({ records, categories, onDeleteBatch, onDelete, onUpdate }) {
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [drillDownCat, setDrillDownCat] = useState(null);
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [editExpandedCat, setEditExpandedCat] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [swipedId, setSwipedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const touchStartX = useRef(0);

  const [reportDate, setReportDate] = useState(() => new Date());
  const reportMonth = reportDate.getMonth();
  const reportYear = reportDate.getFullYear();

  const reportRecords = useMemo(() => {
    return records.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() === reportMonth && d.getFullYear() === reportYear;
    });
  }, [records, reportMonth, reportYear]);

  const expenseRecords = reportRecords.filter(r => r.type === 'expense' && !r.isReimbursable);

  // 搜索过滤
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return reportRecords;
    const q = searchQuery.trim().toLowerCase();
    return reportRecords.filter(r => {
      const cat = categories.find(c => c.id === r.categoryId);
      return (r.remark || '').toLowerCase().includes(q) ||
        (cat?.name || '').toLowerCase().includes(q) ||
        (r.subCategoryName || '').toLowerCase().includes(q) ||
        String(r.amount).includes(q) ||
        r.date.split('T')[0].includes(q);
    });
  }, [reportRecords, searchQuery, categories]);
  const reportExpense = expenseRecords.reduce((sum, r) => sum + Number(r.amount), 0);
  const reportIncome = reportRecords.filter(r => r.type === 'income').reduce((sum, r) => sum + Number(r.amount), 0);

  const pieData = useMemo(() => {
    const map = {};
    expenseRecords.forEach(r => { map[r.categoryId] = (map[r.categoryId] || 0) + Number(r.amount); });
    return Object.entries(map).map(([catId, val]) => {
      const c = categories.find(c => c.id === catId);
      return { name: c?.name || '其他', value: val, id: catId, color: c?.color || '#ccc', icon: c?.icon || '?' };
    }).sort((a,b) => b.value - a.value);
  }, [expenseRecords, categories]);

  const lineData = useMemo(() => {
    const dailyMap = {};
    const daysInMonth = new Date(reportYear, reportMonth + 1, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) dailyMap[i] = 0;
    expenseRecords.forEach(r => {
        const day = new Date(r.date).getDate();
        dailyMap[day] += Number(r.amount);
    });
    return Object.entries(dailyMap).map(([day, amount]) => ({
        day: `${day}日`,
        amount: Number(amount.toFixed(2))
    }));
  }, [expenseRecords, reportYear, reportMonth]);

  const handlePrevMonth = () => setReportDate(new Date(reportYear, reportMonth - 1, 1));
  const handleNextMonth = () => setReportDate(new Date(reportYear, reportMonth + 1, 1));

  const toggleBatchMode = () => { setIsBatchMode(!isBatchMode); setSelectedIds([]); };
  const toggleSelect = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  // 左滑删除手势
  const handleTouchStart = (e, id) => { touchStartX.current = e.touches[0].clientX; setSwipedId(id); };
  const handleTouchMove = (e, id) => {
    if (swipedId !== id) return;
    const dx = touchStartX.current - e.touches[0].clientX;
    const el = document.getElementById(`swipe-${id}`);
    if (el) el.style.transform = `translateX(${Math.max(-80, -dx)}px)`;
  };
  const handleTouchEnd = (e, id) => {
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    const el = document.getElementById(`swipe-${id}`);
    if (dx > 60) {
      if (el) el.style.transform = 'translateX(-80px)';
    } else {
      if (el) el.style.transform = 'translateX(0)';
      setSwipedId(null);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.length === reportRecords.length) setSelectedIds([]);
    else setSelectedIds(reportRecords.map(r => r.id));
  };

  const handleBatchDelete = () => {
    if(window.confirm(`确定要删除选中的 ${selectedIds.length} 笔账单吗？`)) {
      onDeleteBatch(selectedIds);
      setIsBatchMode(false);
      setSelectedIds([]);
    }
  };

  // 点击空白处关闭编辑弹窗
  useEffect(() => {
    if (!editingRecordId) return;
    const handler = (e) => {
      if (!e.target.closest('.edit-popup')) {
        setEditingRecordId(null);
        setEditExpandedCat(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [editingRecordId]);

  // 打开编辑时初始化金额和日期
  const openEdit = (r) => {
    setEditingRecordId(r.id);
    setEditAmount(String(r.amount));
    setEditDate(r.date.split('T')[0]);
    setEditExpandedCat(null);
  };

  const handleSaveAmount = (r) => {
    const updates = {};
    const num = Number(editAmount);
    if (num > 0 && num !== Number(r.amount)) updates.amount = num;
    if (editDate && editDate !== r.date.split('T')[0]) {
      updates.date = new Date(`${editDate}T12:00:00Z`).toISOString();
    }
    if (Object.keys(updates).length > 0) onUpdate(r.id, updates);
    setEditingRecordId(null);
  };

  return (
    <div className="bg-gray-50 min-h-full pb-24">

      {/* 顶部沉浸式紫色区域 */}
      <div className="bg-[#5A54F9] text-white pt-8 pb-16 px-5 rounded-b-[2rem] shadow-sm">
        <h1 className="text-center text-lg font-bold mb-6 tracking-wider">统计报表</h1>

        <div className="flex justify-between items-center bg-white/10 hover:bg-white/20 transition-colors rounded-xl p-3 mb-8 shadow-inner">
          <button onClick={handlePrevMonth} className="px-2 text-white"><ChevronLeft size={20}/></button>
          <button onClick={() => setShowMonthPicker(!showMonthPicker)} className="font-bold text-[16px] tracking-wide hover:text-white/80 transition-colors">
            {reportYear}年{String(reportMonth + 1).padStart(2, '0')}月
          </button>
          <button onClick={handleNextMonth} className="px-2 text-white"><ChevronRight size={20}/></button>
        </div>

        {/* 年月快速跳转 */}
        {showMonthPicker && (
          <div className="flex justify-center mb-6 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="bg-white/15 backdrop-blur rounded-2xl p-4 w-full">
              {/* 年份选择 */}
              <div className="flex items-center justify-center gap-3 mb-3">
                <button onClick={() => setReportDate(new Date(reportYear - 1, reportMonth, 1))} className="text-white/60 hover:text-white"><ChevronLeft size={16}/></button>
                <span className="text-white font-bold text-lg">{reportYear}年</span>
                <button onClick={() => setReportDate(new Date(reportYear + 1, reportMonth, 1))} className="text-white/60 hover:text-white"><ChevronRight size={16}/></button>
              </div>
              {/* 月份网格 */}
              <div className="grid grid-cols-4 gap-2">
                {Array.from({length: 12}, (_, i) => (
                  <button key={i} onClick={() => { setReportDate(new Date(reportYear, i, 1)); setShowMonthPicker(false); }}
                    className={`py-2 rounded-lg text-sm font-medium transition-all ${i === reportMonth ? 'bg-white text-[#5A54F9] shadow' : 'text-white/70 hover:bg-white/20'}`}>
                    {i + 1}月
                  </button>
                ))}
              </div>
              {/* 快捷回到本月 */}
              <button onClick={() => { setReportDate(new Date()); setShowMonthPicker(false); }}
                className="w-full mt-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors">
                回到本月
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-between px-2">
          <div>
            <p className="text-white/70 text-xs mb-1.5 font-medium">共支出</p>
            <p className="text-3xl font-bold tracking-tight">¥{formatMoney(reportExpense)}</p>
          </div>
          <div className="text-right">
            <p className="text-white/70 text-xs mb-1.5 font-medium">共收入</p>
            <p className="text-3xl font-bold tracking-tight">¥{formatMoney(reportIncome)}</p>
          </div>
        </div>
      </div>

      {/* 饼图卡片 (附带图例列表) */}
      <div className="bg-white mx-4 -mt-8 p-5 rounded-2xl shadow-sm border border-gray-50 relative z-10">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[16px] font-bold text-gray-900">支出分类占比</h2>
          <span className="text-[10px] bg-[#EEF0FF] text-[#5A54F9] px-2.5 py-1 rounded-full font-medium">
            点击查看明细
          </span>
        </div>

        {pieData.length === 0 ? <div className="text-gray-400 text-sm h-40 flex items-center justify-center">该月暂无消费数据</div> : (
          <>
            <div className="h-56 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData} cx="50%" cy="50%"
                    innerRadius={65} outerRadius={90}
                    paddingAngle={2} dataKey="value" stroke="none"
                    style={{ cursor: 'pointer', outline: 'none' }}
                    onClick={(data) => setDrillDownCat(data.payload)}
                  >
                    {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                  </Pie>
                  <RechartsTooltip formatter={(val) => `¥${formatMoney(val)}`} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* 列表式图例 */}
            <div className="mt-4 space-y-4 pt-2">
               {pieData.map(item => {
                  const percent = reportExpense > 0 ? ((item.value / reportExpense) * 100).toFixed(1) : 0;
                  return (
                      <div key={item.id} onClick={() => setDrillDownCat(item)} className="flex justify-between items-center text-sm cursor-pointer hover:bg-gray-50 rounded-lg px-2 py-1 -mx-2 transition-colors">
                         <div className="flex items-center gap-2.5">
                           <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: item.color}}></div>
                           <span className="text-gray-700 font-medium">{item.name}</span>
                           <span className="text-gray-400 text-xs ml-1 font-mono">{percent}%</span>
                         </div>
                         <span className="text-gray-700 font-mono">¥{formatMoney(item.value)}</span>
                      </div>
                  )
               })}
            </div>
          </>
        )}
      </div>

      {/* 每日支出趋势卡片 */}
      <div className="bg-white mx-4 mt-4 p-5 rounded-2xl shadow-sm border border-gray-50">
        <h2 className="text-[16px] font-bold text-gray-900 mb-6">每日支出趋势</h2>
         {expenseRecords.length === 0 ? <div className="flex h-32 items-center justify-center text-gray-400 text-sm">该月暂无趋势数据</div> : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{fontSize: 10, fill: '#9ca3af'}} axisLine={{stroke: '#e5e7eb'}} tickLine={false} tickMargin={10} />
                  <YAxis tick={{fontSize: 10, fill: '#9ca3af'}} axisLine={false} tickLine={false} />
                  <RechartsTooltip formatter={(val) => [`¥${val}`, '支出']} labelStyle={{color: '#6b7280', fontSize: '12px'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}/>
                  <Line type="monotone" dataKey="amount" stroke="#5A54F9" strokeWidth={3} dot={false} activeDot={{r: 6, fill: '#5A54F9', stroke: '#fff', strokeWidth: 2}} />
                </LineChart>
              </ResponsiveContainer>
            </div>
         )}
      </div>

      {/* 账单明细列表 */}
      <div className="mx-4 mt-5">
        {/* 搜索栏 */}
        <div className="relative mb-4">
          <input type="text" placeholder="搜索备注/分类/金额/日期..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-white pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none border border-gray-100 focus:border-[#5A54F9] transition-colors shadow-sm" />
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-gray-900 text-[16px]">账单明细 ({reportYear}-{String(reportMonth + 1).padStart(2, '0')}){searchQuery && <span className="text-xs text-gray-400 font-normal ml-1">筛选 {filteredRecords.length}/{reportRecords.length}</span>}</h3>
          <div className="flex items-center gap-3">
              {isBatchMode && (
                 <button onClick={handleSelectAll} className="text-sm text-gray-500 hover:text-indigo-500 transition-colors">
                   {selectedIds.length === reportRecords.length ? '取消全选' : '全选'}
                 </button>
              )}
              <button onClick={toggleBatchMode} className="text-[13px] font-medium text-[#5A54F9] bg-[#EEF0FF] hover:bg-indigo-100 transition-colors px-3 py-1.5 rounded-full">
                  {isBatchMode ? '退出操作' : '批量操作'}
              </button>
          </div>
        </div>

        <div className="space-y-3">
          {filteredRecords.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">{searchQuery ? '未找到匹配的账单，请调整搜索条件' : '无账单记录'}</p> :
           filteredRecords.sort((a, b) => new Date(b.date) - new Date(a.date)).map(r => {
            const cat = categories.find(c => c.id === r.categoryId) || {};
            return (
              <div key={r.id} className="relative"
                onTouchStart={e => handleTouchStart(e, r.id)}
                onTouchMove={e => handleTouchMove(e, r.id)}
                onTouchEnd={e => handleTouchEnd(e, r.id)}>
                {/* 左滑露出的红色删除背景 */}
                <div className="absolute inset-y-0 right-0 w-20 bg-red-500 rounded-2xl overflow-hidden flex items-center justify-center">
                  <button onClick={(e) => { e.stopPropagation(); if(onDelete) onDelete(r.id); setSwipedId(null); }}
                    className="text-white font-bold text-sm">删除</button>
                </div>
                {/* 可滑动的卡片主体 */}
                <div id={`swipe-${r.id}`} className="group bg-white p-3.5 rounded-2xl flex items-center justify-between border border-gray-50 shadow-sm hover:shadow-md transition-all cursor-default relative z-10" style={{transition: 'transform 0.2s ease'}}>
                <div className="flex items-center gap-3">
                  {isBatchMode && <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-[#5A54F9]" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} />}

                  {/* 实心彩色背景图标 */}
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl shadow-sm shrink-0" style={{ backgroundColor: cat.color, color: '#fff' }}>
                    {cat.icon}
                  </div>

                  <div>
                      <p className="font-bold text-[15px] text-gray-800">
                          {cat.name}{r.subCategoryName ? `-${r.subCategoryName}` : ''}
                          {r.isReimbursable && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 ml-1.5 rounded align-text-bottom font-normal">报销</span>}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{r.date.split('T')[0]} {r.remark && `| ${r.remark}`}</p>
                  </div>
                </div>

                {/* 操作按钮容器 */}
                <div className="relative flex items-center justify-end w-28 overflow-hidden h-full">
                  <span className={`text-[15px] font-bold font-mono transition-all duration-200 group-hover:opacity-0 group-hover:-translate-x-6 ${r.type === 'income' ? 'text-[#05c160]' : 'text-[#ee0a24]'}`}>
                    {r.type === 'income' ? '+' : '-'}&yen;{formatMoney(r.amount)}
                  </span>

                  <button
                    onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                    className="absolute inset-y-0 right-8 flex items-center justify-end text-gray-400 hover:text-[#5A54F9] opacity-100 sm:opacity-0 transform translate-x-0 sm:translate-x-4 sm:group-hover:opacity-100 sm:group-hover:translate-x-0 transition-all duration-200 px-1"
                    title="修改">
                    <Pencil size={18} />
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); if(onDelete) onDelete(r.id); }}
                    className="absolute inset-y-0 right-0 flex items-center justify-end text-red-400 hover:text-red-600 opacity-100 sm:opacity-0 transform translate-x-0 sm:translate-x-4 sm:group-hover:opacity-100 sm:group-hover:translate-x-0 transition-all duration-200 px-1"
                    title="删除记录">
                    <Trash2 size={20} />
                  </button>
                </div>
                </div>

                {/* 修改分类弹出选择器 */}
                {editingRecordId === r.id && (
                  <div className="edit-popup absolute right-0 top-full mt-1 z-30 bg-white rounded-xl shadow-xl border border-gray-100 p-3 w-56 animate-slide-up" onClick={e => e.stopPropagation()}>
                    {/* 修改金额 & 日期 */}
                    <div className="mb-3 pb-3 border-b border-gray-50 space-y-2">
                      <div>
                        <p className="text-xs text-gray-400 mb-1 px-1">金额</p>
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-500 font-bold text-sm">¥</span>
                          <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)}
                            className="flex-1 w-20 bg-gray-50 px-2 py-1.5 rounded-lg text-sm font-bold outline-none border border-transparent focus:border-[#5A54F9]" />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-1 px-1">日期</p>
                        <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                          className="w-full bg-gray-50 px-2 py-1.5 rounded-lg text-sm outline-none border border-transparent focus:border-[#5A54F9] text-gray-700" />
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleSaveAmount(r); }}
                        className="w-full py-1.5 bg-[#5A54F9] text-white rounded-lg text-xs font-bold hover:bg-indigo-600">确认修改</button>
                    </div>

                    <p className="text-xs text-gray-400 mb-2 px-1">
                      {editExpandedCat ? '选择子分类 (可选)' : '选择新分类'}
                    </p>

                    {/* 已展开子分类：显示返回 + 子分类列表 */}
                    {editExpandedCat ? (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditExpandedCat(null); }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-left text-sm text-gray-500 mb-1"
                        >
                          <ChevronLeft size={14} />
                          <span>返回分类列表</span>
                        </button>
                        {/* 直接选主分类（不选子分类） */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdate(r.id, { categoryId: editExpandedCat.id, subCategoryName: '' });
                            setEditingRecordId(null);
                            setEditExpandedCat(null);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#EEF0FF] text-[#5A54F9] transition-colors text-left text-sm font-medium mb-2"
                        >
                          <span className="text-base">{editExpandedCat.icon}</span>
                          <span>仅选 {editExpandedCat.name}</span>
                        </button>
                        {/* 子分类列表 */}
                        {editExpandedCat.subCategories?.map(sub => (
                          <button
                            key={sub.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdate(r.id, { categoryId: editExpandedCat.id, subCategoryName: sub.name });
                              setEditingRecordId(null);
                              setEditExpandedCat(null);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-left text-sm pl-8"
                          >
                            <span className="text-gray-700">{sub.name}</span>
                          </button>
                        ))}
                      </>
                    ) : (
                      /* 主分类列表 */
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {categories.filter(c => c.type === r.type && c.active).map(cat => (
                          <button
                            key={cat.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (cat.subCategories?.length > 0) {
                                setEditExpandedCat(cat);
                              } else {
                                onUpdate(r.id, { categoryId: cat.id, subCategoryName: '' });
                                setEditingRecordId(null);
                              }
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-left text-sm"
                          >
                            <span className="text-base">{cat.icon}</span>
                            <span className="text-gray-700 font-medium flex-1">{cat.name}</span>
                            {cat.subCategories?.length > 0 && (
                              <ChevronRight size={14} className="text-gray-300" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingRecordId(null); setEditExpandedCat(null); }}
                      className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 py-1"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 批量操作悬浮条 */}
      {isBatchMode && selectedIds.length > 0 && (
        <div className="fixed bottom-20 left-4 right-4 bg-white border border-gray-200 shadow-xl rounded-2xl p-4 flex justify-between items-center z-40 animate-slide-up">
          <span className="text-sm font-bold text-gray-800">已选 {selectedIds.length} 项</span>
          <button onClick={handleBatchDelete} className="px-5 py-2 bg-red-500 text-white rounded-xl text-sm font-bold shadow-md hover:bg-red-600 transition-colors">
              删除选中项
          </button>
        </div>
      )}

      {/* 饼图下钻明细弹窗 */}
      {drillDownCat && (
        <div className="fixed inset-0 bg-black/60 z-50 flex justify-center items-end">
          <div className="bg-gray-50 w-full max-w-md h-3/4 rounded-t-[2rem] flex flex-col animate-slide-up overflow-hidden">
            <div className="bg-white p-5 flex justify-between items-center border-b border-gray-100">
              <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shadow-sm" style={{backgroundColor: drillDownCat.color, color: '#fff'}}>{drillDownCat.icon}</div>
                  <h3 className="text-lg font-bold text-gray-900">{drillDownCat.name}</h3>
              </div>
              <button onClick={() => setDrillDownCat(null)} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"><X size={18}/></button>
            </div>

            <div className="bg-white px-5 py-4 flex justify-between items-center shadow-sm z-10">
                 <span className="text-sm text-gray-500 font-medium">该类目本月总计</span>
                 <span className="text-2xl font-bold font-mono" style={{color: drillDownCat.color}}>¥{formatMoney(drillDownCat.value)}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(() => {
                const catRecords = expenseRecords.filter(r => r.categoryId === drillDownCat.id);
                // 按子分类聚合
                const subMap = {};
                catRecords.forEach(r => {
                  const key = r.subCategoryName || '未分类';
                  subMap[key] = (subMap[key] || 0) + Number(r.amount);
                });
                // 按金额降序排列
                const entries = Object.entries(subMap).sort((a, b) => b[1] - a[1]);
                const total = entries.reduce((s, [, v]) => s + v, 0);

                return entries.map(([name, val]) => {
                  const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                  return (
                    <div key={name} className="bg-white p-4 rounded-2xl flex justify-between items-center shadow-sm border border-gray-50">
                      <div>
                        <p className="text-[15px] font-bold text-gray-800">{name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">占比 {pct}%</p>
                      </div>
                      <span className="font-bold text-gray-800 font-mono text-base">¥{formatMoney(val)}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ================= 组件: 预算管理 (升级版 UI) =================
function BudgetTab({ budget, setBudget, records, categories }) {
  // 计算本月总支出 (排除报销)
  const expenseRecords = records.filter(r => r.type === 'expense' && !r.isReimbursable);
  const totalExpense = expenseRecords.reduce((sum, r) => sum + Number(r.amount), 0);

  // 计算剩余预算与进度
  const remainingBudget = budget.total - totalExpense;
  const progress = budget.total > 0 ? (totalExpense / budget.total) * 100 : 0;

  // 根据进度动态设置状态标签和颜色
  let statusText = '状态良好';
  let statusColor = 'bg-green-100 text-green-600';
  let progressColor = 'bg-blue-500';

  if (progress >= 100) {
    statusText = '严重超支';
    statusColor = 'bg-red-100 text-red-600';
    progressColor = 'bg-red-500';
  } else if (progress >= 80) {
    statusText = '预算紧张';
    statusColor = 'bg-orange-100 text-orange-600';
    progressColor = 'bg-orange-400';
  }

  // 动态计算建议日均消费
  const today = new Date();
  // 获取当前月份的总天数
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  // 剩余天数（包含今天）
  const remainingDays = daysInMonth - today.getDate() + 1;
  // 建议日均消费金额
  const dailySuggest = remainingBudget > 0 ? (remainingBudget / remainingDays) : 0;

  return (
    <div className="p-4 relative min-h-full pb-24">
      <h2 className="text-xl font-bold text-gray-800 mb-4">预算管理</h2>

      {/* 核心：总预算卡片 */}
      <div className="bg-white p-5 rounded-2xl shadow-sm mb-4 border border-gray-50">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm text-gray-500">本月总预算</span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor}`}>
            {statusText}
          </span>
        </div>

        {/* 可编辑的预算金额区 */}
        <div className="flex items-end gap-2 mb-6">
          <span className="text-3xl font-bold text-gray-800 leading-none mb-1">¥</span>
          <input
            type="number"
            value={budget.total || ''}
            onChange={(e) => setBudget({...budget, total: Number(e.target.value)})}
            className="text-4xl font-bold text-gray-800 w-32 outline-none bg-transparent p-0 border-none leading-none"
          />
          <Pencil size={16} className="text-gray-400 mb-1.5" />
        </div>

        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-500">已使用占比</span>
          <span className="font-bold text-gray-800">{progress.toFixed(1)}%</span>
        </div>

        <div className="w-full bg-gray-100 rounded-full h-2.5 mb-5">
          <div
            className={`h-2.5 rounded-full transition-all ${progressColor}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>

        <div className="flex justify-between pt-4 border-t border-gray-50">
          <div>
            <p className="text-xs text-gray-500 mb-1">已支出</p>
            <p className="text-lg font-bold text-gray-800">¥{formatMoney(totalExpense)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 mb-1">剩余可用</p>
            <p className="text-lg font-bold text-blue-600">¥{formatMoney(remainingBudget)}</p>
          </div>
        </div>
      </div>

      {/* 智能建议卡片 (根据预算进度动态切换) */}
      {(() => {
        // 根据预算进度决定建议内容和样式
        let iconComp, bgClass, borderClass, textClass, content;
        if (progress >= 120) {
          iconComp = <BellOff size={20} className="text-red-500 mt-0.5 shrink-0" />;
          bgClass = 'bg-red-50'; borderClass = 'border-red-100/50'; textClass = 'text-red-800';
          content = (
            <p className="text-sm leading-relaxed font-medium">
              本月支出已超预算 <span className="text-red-600 font-bold text-base">120%</span>！强烈建议暂停非必要消费，审查已支出项，并可适当上调总预算以匹配实际财务状态。
            </p>
          );
        } else if (progress >= 100) {
          iconComp = <AlertTriangle size={20} className="text-orange-500 mt-0.5 shrink-0" />;
          bgClass = 'bg-orange-50'; borderClass = 'border-orange-100/50'; textClass = 'text-orange-800';
          content = (
            <p className="text-sm leading-relaxed">
              预算已全部用尽！后续每笔支出均为超额，建议收紧日常开销，剩余 <span className="text-orange-600 font-bold text-base">{remainingDays}</span> 天尽量使用已有资源。
            </p>
          );
        } else if (progress >= 80) {
          iconComp = <AlertTriangle size={20} className="text-amber-500 mt-0.5 shrink-0" />;
          bgClass = 'bg-amber-50'; borderClass = 'border-amber-100/50'; textClass = 'text-amber-800';
          content = (
            <p className="text-sm leading-relaxed">
              预算使用已超 <span className="text-amber-600 font-bold text-base">80%</span>，建议日均消费控制在 <span className="text-amber-600 font-bold text-base">¥{formatMoney(dailySuggest)}</span> 以内以确保不超支。
            </p>
          );
        } else {
          iconComp = <Wallet size={20} className="text-green-500 mt-0.5 shrink-0" />;
          bgClass = 'bg-green-50'; borderClass = 'border-green-100/50'; textClass = 'text-green-800';
          content = (
            <p className="text-sm leading-relaxed">
              预算使用健康，建议日均消费控制在 <span className="text-green-600 font-bold text-base">¥{formatMoney(dailySuggest)}</span> 以内，即可轻松达成月度财务目标。
            </p>
          );
        }
        return (
          <div className={`${bgClass} border ${borderClass} rounded-xl p-4 flex gap-3 mb-6 items-start shadow-sm`}>
            {iconComp}
            <div className={textClass}>{content}</div>
          </div>
        );
      })()}

      {/* 分类预算限制 (优化了样式以匹配新风格) */}
      <h3 className="font-bold text-gray-800 mb-3 text-lg">分类预算限制</h3>
      <div className="space-y-3">
        {categories.filter(c => c.type === 'expense' && c.active).map(cat => {
          const used = expenseRecords.filter(r => r.categoryId === cat.id).reduce((sum, r) => sum + Number(r.amount), 0);
          const limit = budget.categoryBudgets[cat.id] || 0;
          const prog = limit > 0 ? (used / limit) * 100 : 0;

          return (
            <div key={cat.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-50">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm" style={{backgroundColor: cat.color+'20', color: cat.color}}>
                    {cat.icon}
                  </div>
                  <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">限额¥</span>
                  <input
                    type="number"
                    value={limit || ''}
                    placeholder="未设置"
                    onChange={(e) => setBudget({...budget, categoryBudgets: {...budget.categoryBudgets, [cat.id]: Number(e.target.value)}})}
                    className="w-16 text-right text-sm font-bold outline-none border-b border-gray-200 focus:border-blue-500 bg-transparent text-gray-700"
                  />
                </div>
              </div>

              {limit > 0 && (
                <>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mt-3">
                    <div className={`h-1.5 rounded-full ${prog >= 100 ? 'bg-red-500' : prog >= 80 ? 'bg-orange-400' : 'bg-blue-400'}`} style={{width: `${Math.min(prog, 100)}%`}} />
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
                    <span>已用 ¥{formatMoney(used)}</span>
                    <span>剩余 ¥{formatMoney(limit - used)}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ================= 组件: 我的与分类管理 =================
function ProfileTab({ categories, setCategories, onOpenExport }) {
  const auth = useAuth();
  const [showCatManager, setShowCatManager] = useState(false);
  const [registeringWebAuthn, setRegisteringWebAuthn] = useState(false);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const handleRegisterWebAuthn = async () => {
    setRegisteringWebAuthn(true);
    await auth.registerWebAuthn(auth.currentUser?.email);
    setRegisteringWebAuthn(false);
  };

  const handleSetupPassword = async () => {
    if (!newPassword || newPassword.length < 6) return;
    await auth.setPassword(auth.currentUser?.email, newPassword);
    setShowSetPassword(false);
    setNewPassword('');
  };

  const loginMethodLabels = {
    password: '邮箱 + 密码',
    code: '邮箱 + 验证码',
    github: 'GitHub 授权',
    webauthn: '指纹 / 面容 ID',
  };

  return (
    <div className="p-4">
      {/* 用户信息卡片 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm flex items-center gap-4 mb-6">
        <div className="w-16 h-16 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center">
          <User size={32} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-gray-800 truncate">
            {auth.currentUser?.displayName || '记账达人'}
          </h2>
          <p className="text-sm text-gray-400 mt-1 truncate">{auth.currentUser?.email}</p>
          <span className="inline-block mt-1 text-xs bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full">
            {loginMethodLabels[auth.currentUser?.loginMethod] || '已登录'}
          </span>
        </div>
      </div>

      {/* 菜单列表 */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-50 mb-4">
        <button onClick={() => setShowCatManager(true)} className="w-full px-5 py-4 flex justify-between items-center hover:bg-gray-50 transition border-b border-gray-50">
          <div className="flex items-center gap-3"><Settings size={20} className="text-gray-500" /><span className="text-gray-700">分类管理</span></div>
          <span className="text-gray-400 text-sm">自定义收支分类 &gt;</span>
        </button>
        <button onClick={onOpenExport} className="w-full px-5 py-4 flex justify-between items-center hover:bg-gray-50 transition border-b border-gray-50">
          <div className="flex items-center gap-3"><Upload size={20} className="text-gray-500" /><span className="text-gray-700">导出账单</span></div>
          <span className="text-gray-400 text-sm">CSV / Excel &gt;</span>
        </button>
        <button onClick={() => setShowSetPassword(true)} className="w-full px-5 py-4 flex justify-between items-center hover:bg-gray-50 transition border-b border-gray-50">
          <div className="flex items-center gap-3"><KeyRound size={20} className="text-gray-500" /><span className="text-gray-700">设置密码</span></div>
          <span className="text-gray-400 text-sm">安全登录 &gt;</span>
        </button>
        <button
          onClick={handleRegisterWebAuthn}
          disabled={registeringWebAuthn}
          className="w-full px-5 py-4 flex justify-between items-center hover:bg-gray-50 transition border-b border-gray-50 disabled:opacity-50"
        >
          <div className="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
              <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><path d="M5 19.5c.5.5 4 3.5 8 2.5"/><path d="M17 21v-8"/><path d="M21 21v-8"/><path d="M12 21v-8"/><rect x="2" y="10" width="20" height="8" rx="1"/>
            </svg>
            <span className="text-gray-700">绑定指纹 / 面容 ID</span>
          </div>
          <span className="text-gray-400 text-sm">{registeringWebAuthn ? '注册中...' : '安全快捷登录 &gt;'}</span>
        </button>
      </div>

      {/* 退出登录按钮 */}
      <button
        onClick={() => { if (confirm('确定要退出登录吗？退出后需重新验证。')) auth.logout(); }}
        className="w-full py-4 bg-white rounded-2xl shadow-sm border border-red-100 flex items-center justify-center gap-2 text-red-500 font-medium hover:bg-red-50 transition"
      >
        <LogOut size={20} />
        一键退出登录
      </button>
      <p className="text-xs text-gray-300 text-center mt-3">退出后所有本地数据保留，重新登录即可恢复</p>

      {showCatManager && <CategoryEditor categories={categories} setCategories={setCategories} onClose={() => setShowCatManager(false)} />}

      {/* 设置密码弹窗 */}
      {showSetPassword && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-xl animate-slide-up">
            <h2 className="text-lg font-bold text-gray-800 mb-1">设置登录密码</h2>
            <p className="text-sm text-gray-400 mb-5">设置后即可使用"邮箱+密码"快速登录</p>
            <div className="relative mb-4">
              <KeyRound size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="password" placeholder="至少6位密码" value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 text-gray-800" autoFocus />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowSetPassword(false); setNewPassword(''); }}
                className="flex-1 py-2.5 bg-gray-100 text-gray-500 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">取消</button>
              <button onClick={handleSetupPassword} disabled={!newPassword || newPassword.length < 6}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all ${!newPassword || newPassword.length < 6 ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600 shadow-md'}`}>确认设置</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ================= 组件: 独立全屏分类编辑器 (升级版) =================
function CategoryEditor({ categories, setCategories, onClose }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingSubFor, setAddingSubFor] = useState(null); // 正在添加子分类的主分类 id
  const [editingCat, setEditingCat] = useState(null); // 正在编辑的主分类

  // 新分类表单状态
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('expense');
  const [newIcon, setNewIcon] = useState(ICONS_POOL[0]);
  const [newColor, setNewColor] = useState(COLORS_POOL[0]);
  const [newSubName, setNewSubName] = useState('');

  const toggleActive = (id) => setCategories(categories.map(c => c.id === id ? { ...c, active: !c.active } : c));

  const moveCat = (index, dir) => {
    if (index + dir < 0 || index + dir >= categories.length) return;
    const newCats = [...categories];
    [newCats[index], newCats[index + dir]] = [newCats[index + dir], newCats[index]];
    setCategories(newCats);
  };

  // 添加主分类
  const handleAddCategory = () => {
    if (!newName.trim()) return;
    const maxOrder = Math.max(0, ...categories.map(c => c.order));
    setCategories([...categories, {
      id: generateId(),
      name: newName.trim(),
      type: newType,
      icon: newIcon,
      color: newColor,
      active: true,
      order: maxOrder + 1,
      subCategories: []
    }]);
    setNewName(''); setNewIcon(ICONS_POOL[0]); setNewColor(COLORS_POOL[0]);
    setShowAddForm(false);
  };

  // 添加子分类
  const handleAddSubCategory = (catId) => {
    if (!newSubName.trim()) return;
    setCategories(categories.map(c => c.id === catId
      ? { ...c, subCategories: [...(c.subCategories || []), { id: generateId(), name: newSubName.trim() }] }
      : c
    ));
    setNewSubName('');
    setAddingSubFor(null);
  };

  // 删除子分类
  const handleDeleteSub = (catId, subId) => {
    setCategories(categories.map(c => c.id === catId
      ? { ...c, subCategories: c.subCategories?.filter(s => s.id !== subId) || [] }
      : c
    ));
  };

  // 更新主分类属性
  const handleUpdateCat = (catId, updates) => {
    setCategories(categories.map(c => c.id === catId ? { ...c, ...updates } : c));
  };

  // 重置表单
  const resetForm = () => {
    setNewName(''); setNewType('expense'); setNewIcon(ICONS_POOL[0]); setNewColor(COLORS_POOL[0]);
    setShowAddForm(true); setEditingCat(null);
  };

  return (
    <div className="fixed inset-0 bg-gray-50 z-50 flex flex-col animate-slide-up">
      <div className="bg-white p-4 flex justify-between items-center shadow-sm z-10">
        <h2 className="text-lg font-bold text-gray-800">分类管理</h2>
        <button onClick={onClose} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
        {/* 添加分类按钮 */}
        {!showAddForm && (
          <button onClick={resetForm} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:text-[#5A54F9] hover:border-[#5A54F9] transition-colors text-sm font-medium flex items-center justify-center gap-2">
            <Plus size={18} /> 添加新分类
          </button>
        )}

        {/* 新增分类表单 */}
        {showAddForm && (
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-4 animate-slide-up">
            <h3 className="font-bold text-gray-800 text-sm">新建分类</h3>

            {/* 名称 */}
            <input type="text" placeholder="分类名称" value={newName} onChange={e => setNewName(e.target.value)}
              className="w-full bg-gray-50 p-3 rounded-xl outline-none text-sm border border-transparent focus:border-[#5A54F9] transition-colors" />

            {/* 类型切换 */}
            <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
              <button onClick={() => setNewType('expense')} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${newType === 'expense' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>支出</button>
              <button onClick={() => setNewType('income')} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${newType === 'income' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>收入</button>
            </div>

            {/* 图标选择器 */}
            <div>
              <p className="text-xs text-gray-400 mb-2">选择图标</p>
              <div className="flex flex-wrap gap-2">
                {ICONS_POOL.map(icon => (
                  <button key={icon} onClick={() => setNewIcon(icon)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all ${newIcon === icon ? 'bg-[#5A54F9] text-white shadow-md scale-110' : 'bg-gray-50 hover:bg-gray-100'}`}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* 颜色选择器 */}
            <div>
              <p className="text-xs text-gray-400 mb-2">选择主题色</p>
              <div className="flex flex-wrap gap-2">
                {COLORS_POOL.map(color => (
                  <button key={color} onClick={() => setNewColor(color)}
                    className={`w-8 h-8 rounded-full transition-all ${newColor === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                    style={{ backgroundColor: color }} />
                ))}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowAddForm(false); setEditingCat(null); }}
                className="flex-1 py-2.5 bg-gray-100 text-gray-500 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">取消</button>
              <button onClick={handleAddCategory} disabled={!newName.trim()}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all ${!newName.trim() ? 'bg-gray-300 cursor-not-allowed' : 'bg-[#5A54F9] hover:bg-indigo-600 shadow-md'}`}>确认添加</button>
            </div>
          </div>
        )}

        {/* 提示 */}
        <p className="text-xs text-gray-400 mt-1">历史账单绑定的分类建议"停用"代替删除，以防数据丢失。</p>

        {/* 分类列表 */}
        {categories.map((cat, index) => (
          <div key={cat.id} className={`bg-white p-4 rounded-xl border border-gray-100 shadow-sm transition ${!cat.active && 'opacity-50'}`}>
            {/* 主分类行 */}
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setEditingCat(cat.id);
                    setNewName(cat.name); setNewType(cat.type); setNewIcon(cat.icon); setNewColor(cat.color);
                    setShowAddForm(false); setAddingSubFor(null);
                  }}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xl transition-transform hover:scale-110"
                  style={{ backgroundColor: cat.color, color: '#fff' }}
                  title="点击编辑"
                >{cat.icon}</button>
                <div>
                  {editingCat === cat.id ? (
                    <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                      className="font-bold text-gray-800 bg-gray-50 px-2 py-0.5 rounded outline-none border border-gray-200 focus:border-[#5A54F9] text-sm w-24" />
                  ) : (
                    <h3 className="font-bold text-gray-800">{cat.name}</h3>
                  )}
                  <p className="text-xs text-gray-400">{cat.type === 'expense' ? '支出' : '收入'} | {cat.subCategories?.length || 0} 个子分类</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                {editingCat === cat.id ? (
                  <>
                    <button onClick={() => {
                      handleUpdateCat(cat.id, { name: newName.trim() || cat.name, icon: newIcon, color: newColor, type: newType });
                      setEditingCat(null);
                    }} className="p-1.5 bg-[#5A54F9] text-white rounded-lg"><Check size={16} /></button>
                    <button onClick={() => setEditingCat(null)} className="p-1.5 bg-gray-100 rounded-lg"><X size={16} /></button>
                  </>
                ) : (
                  <>
                    <button onClick={() => moveCat(index, -1)} className="p-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"><ArrowUp size={16} /></button>
                    <button onClick={() => moveCat(index, 1)} className="p-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"><ArrowDown size={16} /></button>
                    <button onClick={() => toggleActive(cat.id)} className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${cat.active ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>
                      {cat.active ? '停用' : '启用'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 编辑模式：图标和颜色选择器 */}
            {editingCat === cat.id && (
              <div className="mb-3 space-y-3 pt-2 border-t border-gray-50">
                {/* 类型切换 */}
                <div className="flex gap-2 bg-gray-100 p-1 rounded-lg w-fit">
                  <button onClick={() => setNewType('expense')} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${newType === 'expense' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>支出</button>
                  <button onClick={() => setNewType('income')} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${newType === 'income' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>收入</button>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 mb-1.5">图标</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ICONS_POOL.map(icon => (
                      <button key={icon} onClick={() => setNewIcon(icon)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all ${newIcon === icon ? 'bg-[#5A54F9] text-white scale-110' : 'bg-gray-50 hover:bg-gray-100'}`}>{icon}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 mb-1.5">主题色</p>
                  <div className="flex flex-wrap gap-2">
                    {COLORS_POOL.map(color => (
                      <button key={color} onClick={() => setNewColor(color)}
                        className={`w-7 h-7 rounded-full transition-all ${newColor === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                        style={{ backgroundColor: color }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 子分类展示与添加 */}
            {cat.subCategories?.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-dashed border-gray-100">
                {cat.subCategories.map(sub => (
                  <span key={sub.id} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full group/sub">
                    {sub.name}
                    <button onClick={() => handleDeleteSub(cat.id, sub.id)}
                      className="opacity-100 sm:opacity-0 sm:group-hover/sub:opacity-100 hover:text-red-500 transition-all ml-0.5"><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}

            {/* 添加子分类 */}
            {addingSubFor === cat.id ? (
              <div className="flex gap-2 mt-3 pt-2 border-t border-gray-50">
                <input type="text" placeholder="子分类名称" value={newSubName} onChange={e => setNewSubName(e.target.value)}
                  className="flex-1 bg-gray-50 px-3 py-1.5 rounded-lg text-xs outline-none border border-transparent focus:border-[#5A54F9]" autoFocus />
                <button onClick={() => handleAddSubCategory(cat.id)} disabled={!newSubName.trim()}
                  className="px-3 py-1.5 bg-[#5A54F9] text-white rounded-lg text-xs font-bold disabled:opacity-50">添加</button>
                <button onClick={() => { setAddingSubFor(null); setNewSubName(''); }}
                  className="px-2 py-1.5 text-gray-400 hover:text-gray-600 text-xs">取消</button>
              </div>
            ) : (
              <button onClick={() => { setAddingSubFor(cat.id); setNewSubName(''); setEditingCat(null); }}
                className="mt-3 text-xs text-[#5A54F9] hover:text-indigo-600 font-medium flex items-center gap-1 pt-1">
                <Plus size={14} />添加子分类
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= 组件: 导出账单弹窗 =================
function ExportModal({ records, categories, exportHistory, setExportHistory, onClose }) {
  const [datePreset, setDatePreset] = useState('thisMonth');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selectedCatIds, setSelectedCatIds] = useState([]);
  const [exportFormat, setExportFormat] = useState('csv');
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);

  const getDateRange = () => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    switch (datePreset) {
      case 'thisMonth': return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
      case 'lastMonth': return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0) };
      case 'last3': return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 0) };
      case 'custom': return { start: customStart ? new Date(customStart + 'T00:00:00') : null, end: customEnd ? new Date(customEnd + 'T23:59:59') : null };
      default: return { start: null, end: null };
    }
  };

  const filteredRecords = useMemo(() => {
    const { start, end } = getDateRange();
    return records.filter(r => {
      const d = new Date(r.date);
      if (start && d < start) return false;
      if (end && d > end) return false;
      if (selectedCatIds.length > 0 && !selectedCatIds.includes(r.categoryId)) return false;
      return true;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [records, datePreset, customStart, customEnd, selectedCatIds]);

  const filteredCount = filteredRecords.length;

  const generateCSV = (data) => {
    const header = '日期,类型,分类,子分类,金额,备注,是否报销';
    const rows = data.map(r => {
      const cat = categories.find(c => c.id === r.categoryId);
      return [
        r.date.split('T')[0],
        r.type === 'expense' ? '支出' : '收入',
        cat?.name || '',
        r.subCategoryName || '',
        r.amount,
        '"' + (r.remark || '').replace(/"/g, '""') + '"',
        r.isReimbursable ? '是' : '否'
      ].join(',');
    });
    return '﻿' + [header, ...rows].join('\n');
  };

  const generateExcel = (data) => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: 明细
    const detailData = data.map(r => {
      const cat = categories.find(c => c.id === r.categoryId);
      return {
        '日期': r.date.split('T')[0],
        '类型': r.type === 'expense' ? '支出' : '收入',
        '分类': cat?.name || '',
        '子分类': r.subCategoryName || '',
        '金额': r.amount,
        '备注': r.remark || '',
        '是否报销': r.isReimbursable ? '是' : '否'
      };
    });
    const ws1 = XLSX.utils.json_to_sheet(detailData);
    ws1['!cols'] = [{wch:12},{wch:6},{wch:10},{wch:10},{wch:10},{wch:30},{wch:8}];
    XLSX.utils.book_append_sheet(wb, ws1, '账单明细');

    // Sheet 2: 分类汇总
    const expenseData = data.filter(r => r.type === 'expense' && !r.isReimbursable);
    const summaryMap = {};
    expenseData.forEach(r => {
      const cat = categories.find(c => c.id === r.categoryId);
      const key = cat?.name || '其他';
      summaryMap[key] = (summaryMap[key] || 0) + Number(r.amount);
    });
    const totalExp = Object.values(summaryMap).reduce((s, v) => s + v, 0);
    const summaryRows = Object.entries(summaryMap).map(([name, val]) => ({
      '分类': name, '支出金额': val, '占比': totalExp > 0 ? ((val / totalExp) * 100).toFixed(1) + '%' : '0%'
    }));
    summaryRows.push({ '分类': '合计', '支出金额': totalExp, '占比': '100%' });
    const ws2 = XLSX.utils.json_to_sheet(summaryRows);
    ws2['!cols'] = [{wch:15},{wch:12},{wch:10}];
    XLSX.utils.book_append_sheet(wb, ws2, '分类汇总');

    // Sheet 3: 每日汇总
    const dailyMap = {};
    data.forEach(r => {
      const day = r.date.split('T')[0];
      if (!dailyMap[day]) dailyMap[day] = { date: day, expense: 0, income: 0 };
      if (r.type === 'expense') dailyMap[day].expense += Number(r.amount);
      else dailyMap[day].income += Number(r.amount);
    });
    const dailyRows = Object.values(dailyMap).sort((a,b) => a.date.localeCompare(b.date));
    const ws3 = XLSX.utils.json_to_sheet(dailyRows);
    ws3['!cols'] = [{wch:12},{wch:12},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws3, '每日汇总');

    return wb;
  };

  const handleExport = () => {
    if (filteredRecords.length === 0) {
      alert('筛选范围内无账单数据，请调整筛选条件。');
      return;
    }
    setIsGenerating(true);
    setDownloadUrl(null);
    const delay = filteredRecords.length > 500 ? 1500 : 300;
    setTimeout(() => {
      try {
        let blob, filename;
        const timestamp = new Date().toISOString().slice(0, 10);
        const rangeLabel = datePreset === 'thisMonth' ? '本月' : datePreset === 'lastMonth' ? '上月' : datePreset === 'last3' ? '近三月' : '自定义';

        if (exportFormat === 'csv') {
          const csv = generateCSV(filteredRecords);
          blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          filename = `账单导出_${rangeLabel}_${timestamp}.csv`;
        } else {
          const wb = generateExcel(filteredRecords);
          const excelBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          blob = new Blob([excelBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          filename = `账单导出_${rangeLabel}_${timestamp}.xlsx`;
        }

        const url = URL.createObjectURL(blob);
        setDownloadUrl({ url, filename });
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);

        const catsLabel = selectedCatIds.length > 0
          ? selectedCatIds.map(id => categories.find(c => c.id === id)?.name || '').filter(Boolean).join('、')
          : '全部';
        setExportHistory([{
          id: generateId(),
          time: new Date().toISOString(),
          filename, format: exportFormat.toUpperCase(), count: filteredRecords.length,
          rangeLabel, catsLabel, url
        }, ...exportHistory].slice(0, 10));
      } catch (err) {
        alert('导出失败：' + err.message);
      }
      setIsGenerating(false);
    }, delay);
  };

  const toggleCatFilter = (id) => {
    setSelectedCatIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white w-full rounded-t-2xl flex flex-col h-[90vh] animate-slide-up">
        <div className="flex justify-between items-center p-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">导出账单</h2>
          <button onClick={onClose} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* 时间范围 */}
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><Calendar size={16} className="text-gray-400"/> 时间范围</h3>
            <div className="flex flex-wrap gap-2">
              {[{ key: 'thisMonth', label: '本月' },{ key: 'lastMonth', label: '上月' },{ key: 'last3', label: '近三月' },{ key: 'custom', label: '自定义' }].map(p => (
                <button key={p.key} onClick={() => setDatePreset(p.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${datePreset === p.key ? 'bg-[#5A54F9] text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{p.label}</button>
              ))}
            </div>
            {datePreset === 'custom' && (
              <div className="flex gap-2 mt-3">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="flex-1 bg-gray-50 p-2.5 rounded-lg text-sm outline-none border border-gray-100 focus:border-[#5A54F9]" />
                <span className="text-gray-400 self-center">—</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="flex-1 bg-gray-50 p-2.5 rounded-lg text-sm outline-none border border-gray-100 focus:border-[#5A54F9]" />
              </div>
            )}
          </div>

          {/* 分类筛选 */}
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3">分类筛选 <span className="text-gray-400 font-normal text-xs ml-2">{selectedCatIds.length === 0 ? '(全部)' : `(${selectedCatIds.length} 个已选)`}</span></h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSelectedCatIds([])} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedCatIds.length === 0 ? 'bg-[#5A54F9] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>全部</button>
              {categories.filter(c => c.active).map(cat => (
                <button key={cat.id} onClick={() => toggleCatFilter(cat.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${selectedCatIds.includes(cat.id) ? 'bg-[#5A54F9] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  <span>{cat.icon}</span> {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* 格式选择 */}
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3">导出格式</h3>
            <div className="flex gap-3">
              <button onClick={() => setExportFormat('csv')} className={`flex-1 p-4 rounded-xl border-2 transition-all text-left ${exportFormat === 'csv' ? 'border-[#5A54F9] bg-[#EEF0FF]' : 'border-gray-100 hover:border-gray-200'}`}>
                <FileText size={24} className={exportFormat === 'csv' ? 'text-[#5A54F9]' : 'text-gray-400'} />
                <p className={`font-bold text-sm mt-2 ${exportFormat === 'csv' ? 'text-[#5A54F9]' : 'text-gray-700'}`}>CSV 格式</p>
                <p className="text-xs text-gray-400 mt-0.5">通用格式，便于导入其他工具</p>
              </button>
              <button onClick={() => setExportFormat('excel')} className={`flex-1 p-4 rounded-xl border-2 transition-all text-left ${exportFormat === 'excel' ? 'border-[#5A54F9] bg-[#EEF0FF]' : 'border-gray-100 hover:border-gray-200'}`}>
                <Download size={24} className={exportFormat === 'excel' ? 'text-[#5A54F9]' : 'text-gray-400'} />
                <p className={`font-bold text-sm mt-2 ${exportFormat === 'excel' ? 'text-[#5A54F9]' : 'text-gray-700'}`}>Excel 格式</p>
                <p className="text-xs text-gray-400 mt-0.5">含分类汇总、每日汇总 Sheet</p>
              </button>
            </div>
          </div>

          {/* 预览 */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-sm text-gray-500">筛选结果：<span className="font-bold text-gray-800">{filteredCount}</span> 条记录
              {filteredCount > 500 && <span className="text-amber-500 text-xs ml-2">(数据较大，异步生成)</span>}
            </p>
          </div>

          {/* 导出按钮 */}
          <button onClick={handleExport} disabled={isGenerating || filteredCount === 0}
            className={`w-full py-3.5 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 ${isGenerating || filteredCount === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-[#5A54F9] hover:bg-indigo-600 shadow-lg shadow-indigo-500/30'}`}>
            {isGenerating ? (<><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/> 生成中...</>) : (<><Download size={18} /> 导出 {exportFormat.toUpperCase()} 并下载</>)}
          </button>

          {/* 导出历史 */}
          {exportHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-3 mt-2">最近导出记录</h3>
              <div className="space-y-2">
                {exportHistory.map(h => (
                  <div key={h.id} className="bg-white border border-gray-100 rounded-xl p-3 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{h.filename}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{h.time.split('T')[0]} · {h.rangeLabel} · {h.catsLabel} · {h.count}条 · {h.format}</p>
                    </div>
                    <a href={h.url} download={h.filename} className="ml-3 p-2 bg-[#EEF0FF] text-[#5A54F9] rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1 text-xs font-medium shrink-0">
                      <Download size={14} /> 重新下载
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
