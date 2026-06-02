# 韩语词卡

一个本地可用、也可以接 Supabase 云端同步的韩语单词卡小工具。

## 启动

在这个文件夹运行：

```bash
node server.mjs
```

然后打开：

```text
http://localhost:4173
```

## 使用方式

输入韩语单词、中文释义、发音、词性、变形和自己的笔记，然后加入词库。

复习时先看韩语词，点“显示答案”后选择“不认识 / 模糊 / 认识”，系统会自动安排下次复习日期。

## 本地数据

词库会先保存在当前浏览器的本地存储中。右侧提供导出和导入按钮，建议定期导出 JSON 备份。

## 云端同步

云端同步使用 Supabase。配置后，手机和电脑打开同一个网页，用同一个邮箱登录，就可以同步同一份词库。

### 1. 创建 Supabase 项目

1. 打开 https://supabase.com
2. 注册或登录
3. 创建一个新项目
4. 等项目初始化完成

### 2. 创建词卡表

1. 进入 Supabase 项目
2. 打开左侧 SQL Editor
3. 复制本文件夹里的 `supabase-schema.sql` 全部内容
4. 粘贴到 SQL Editor
5. 点击 Run

这个脚本会创建 `vocab_cards` 表，并开启 Row Level Security。每个登录用户只能读取和修改自己的词卡。

### 3. 找到 URL 和 anon key

1. 在 Supabase 项目里打开 Project Settings
2. 进入 API
3. 复制 Project URL
4. 复制 anon public key

这两个值可以填进网页左侧的“云端同步”区域。anon key 可以放在前端；真正保护数据的是表上的 RLS 规则。

### 4. 配置登录跳转地址

如果你把网页部署到了 GitHub Pages、Netlify 或 Vercel，需要在 Supabase 里允许这个网址作为登录回跳地址：

1. 打开 Authentication
2. 进入 URL Configuration
3. Site URL 填你的网页地址
4. Redirect URLs 也加入你的网页地址

本地调试时可以加入：

```text
http://localhost:4173
```

### 5. 在网页里登录和同步

1. 打开韩语词卡网页
2. 在“云端同步”里填 Supabase URL 和 anon key
3. 点击“保存云配置”
4. 输入邮箱
5. 点击“发送登录邮件”
6. 到邮箱里点登录链接
7. 回到网页后点击“同步到云端”

手机上打开同一个网页后，用同一个邮箱登录，再点击“从云端拉取”。

## 部署

这个工具是静态网页，部署时只需要上传这些文件：

- `index.html`
- `styles.css`
- `app.js`
- `README.md`
- `supabase-schema.sql`

部署到 GitHub Pages、Netlify 或 Vercel 都可以。
