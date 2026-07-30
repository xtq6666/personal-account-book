-- ==========================================
-- 个人记账本 - Supabase 数据库初始化脚本
-- 在 Supabase 控制台 → SQL Editor 中执行
-- ==========================================

-- 1. 创建用户数据表
CREATE TABLE IF NOT EXISTS user_data (
  email TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{
    "records": [],
    "categories": [
      {"id":"c1","name":"餐饮","type":"expense","icon":"🍔","color":"#F59E0B","active":true,"order":1,"subCategories":[{"id":"s1","name":"早餐"},{"id":"s2","name":"正餐"}]},
      {"id":"c2","name":"交通","type":"expense","icon":"🚇","color":"#3B82F6","active":true,"order":2,"subCategories":[{"id":"s3","name":"打车"},{"id":"s4","name":"公交地铁"}]},
      {"id":"c3","name":"购物","type":"expense","icon":"🛒","color":"#EC4899","active":true,"order":3,"subCategories":[{"id":"s5","name":"日用品"},{"id":"s6","name":"数码"}]},
      {"id":"c4","name":"娱乐","type":"expense","icon":"🎮","color":"#8B5CF6","active":true,"order":4,"subCategories":[{"id":"s7","name":"电影"},{"id":"s8","name":"游戏"}]},
      {"id":"c5","name":"工资","type":"income","icon":"💰","color":"#10B981","active":true,"order":5,"subCategories":[]}
    ],
    "budget": {"total": 3000, "categoryBudgets": {}}
  }',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 启用行级安全 (RLS)
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

-- 3. 允许所有操作 (个人记账应用，通过 anon key 保护)
--    生产环境建议改用 Supabase Auth + 严格 RLS
CREATE POLICY "allow_anon_access" ON user_data
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_user_data_email ON user_data(email);
