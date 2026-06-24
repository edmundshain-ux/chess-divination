# 象棋占卜 部署說明

## ✅ 已完成
- Supabase 專案：已建立
- Supabase URL：https://zpwsxxxustpwumcoeldr.supabase.co
- 資料表 records / settings：請確認已在 SQL Editor 執行過 supabase_setup.sql

## 第一步：確認 Supabase 資料表（若還沒做過）

1. 登入 Supabase → 左側 **SQL Editor** → New query
2. 貼上 `supabase_setup.sql` 全部內容 → 點 **Run**
3. 看到 Success 即完成

## 第二步：取得 AI API 金鑰

### Claude（建議優先使用）
1. 前往 https://console.anthropic.com
2. 左側 **API Keys** → Create Key
3. 複製金鑰（格式：sk-ant-...）

### DeepSeek（備用）
1. 前往 https://platform.deepseek.com
2. API Keys → 建立金鑰
3. 複製金鑰（格式：sk-...）

## 第三步：上傳到 GitHub

1. 登入 https://github.com → 建立新 Repository（如 chess-divination）
2. 把整個專案資料夾上傳
   - **注意**：`.env.local` 不會被上傳（已在 .gitignore），這是正常的，金鑰要在 Vercel 後台設定

## 第四步：Vercel 部署

1. 登入 https://vercel.com → **Add New Project**
2. 選擇剛上傳的 GitHub repo
3. 展開 **Environment Variables**，逐筆加入：

| Key | Value |
|---|---|
| VITE_SUPABASE_URL | https://zpwsxxxustpwumcoeldr.supabase.co |
| VITE_SUPABASE_ANON_KEY | 你的 anon key（從 Supabase API 設定頁複製） |
| ANTHROPIC_API_KEY | 你的 Claude API 金鑰（sk-ant-...） |
| DEEPSEEK_API_KEY | 你的 DeepSeek API 金鑰（可留空，之後再補） |

4. 點 **Deploy**，等待約1分鐘完成

## 重要安全提醒

- `ANTHROPIC_API_KEY` 和 `DEEPSEEK_API_KEY` 絕對不能加 `VITE_` 前綴，否則會暴露在前端程式碼裡被任何人看到
- 只有 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 可以是 VITE_ 開頭（這兩個本來就設計給前端公開用）
- AI 解盤的真正呼叫是透過 `/api/ai-reading.js`（後端執行），金鑰不會傳到使用者瀏覽器

## 老師密碼

預設密碼：**888888**
修改方式：App.jsx 搜尋 `TEACHER_PWD` 改掉後重新部署

## 使用方式

- **學生**：打開網址 → 起卦 → 儲存紀錄 → 可選擇產生 AI 解盤
- **老師**：首頁「老師模式」輸入密碼 → 歷史紀錄可看到所有學生紀錄並填寫解盤

## 之後要加帳號系統時

目前用瀏覽器本機 ID 識別使用者（`localStorage` 存一個隨機ID）。
之後若要做「真帳號登入＋訂閱方案＋AI次數限制」，建議：
1. 啟用 Supabase Auth（Email 或 LINE 登入）
2. 在 `api/ai-reading.js` 加入次數檢查（查 Supabase 該用戶當月已使用次數）
3. 加一張 `subscriptions` 表記錄訂閱狀態
這部分我們可以下一階段再做。
