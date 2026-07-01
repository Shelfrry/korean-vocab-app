# Otterly

Otterly 是一个私人韩语词卡学习 app。它可以本地使用，也可以通过 Supabase v2 在电脑和手机之间同步词库。

当前说明对应版本：260605。

## 功能概览

- 录入韩语单词、发音、词性、中文释义、变形/派生、例句及易混点
- 今日复习固定牌组：每天北京时间 00:00 生成一组今日卡片
- 默认今日卡片 25 张，最多扩展到 35 张
- 同一天内可以反复复习今日牌组
- 支持 `ko_to_zh` 和 `zh_to_ko` 复习卡
- 支持历史补录词首轮快速分级
- 支持 mastered 可逆状态，忘了/模糊会掉回 review
- 支持词库编辑、删除、朗读和录入时间排序
- 支持 Supabase v2 云端同步
- 支持 PWA 添加到手机主屏幕

## 本地启动

在项目文件夹运行：

```bash
node server.mjs
```

然后打开：

```text
http://127.0.0.1:4173
```

也可以部署后直接访问 GitHub Pages。

## 数据存储

Otterly 使用浏览器 localStorage 保存本地数据。

主要本地 key：

- `korean-vocab-v2`：新版词库主数据
- `korean-vocab-v2-daily-deck`：当天固定复习牌组
- `korean-vocab-v2-pending-deletes`：未登录时删除词条的待同步删除记录
- `korean-vocab-v2-last-sync-at`：最近同步时间

不要手动清空这些数据，除非你已经确认云端或 JSON 有备份。

## 今日复习规则

Otterly 每天按北京时间计算日期。

每天北京时间 00:00 后，系统会从当前到期卡片中生成新的今日牌组：

- 默认最多 25 张
- 右上角刷新按钮可以补充 1 张到期卡片
- 今日牌组最多 35 张
- 如果没有更多可补充卡片，刷新按钮只在今日牌组内循环切换
- 当天 24 小时内反复打开 app，仍然使用同一组今日牌组

今日统计：

- 已完成：今天牌组中已点过反馈的卡片数
- 待复习：当前所有到期 reviewCard 总数
- 已掌握：`mastered / 总词汇数`

同一天内重复评价同一张卡时，只更新当天最终结果，不会重复污染长期复习算法。

## 复习算法

每个词最多有两张卡：

- `ko_to_zh`：看到韩语想中文
- `zh_to_ko`：看到中文想韩语

新录入词默认创建 `ko_to_zh` 卡。

当 `ko_to_zh` 稳定通过后，系统会创建 `zh_to_ko` 卡。

历史补录词使用 `placementPending` 做一次性首轮快速分级：

- 忘了：进入 learning，1 天后复习
- 模糊：进入 learning，3 天后复习
- 认识：进入 review，14 天后复习
- 熟练：进入 review，30 天后复习

`placementPending` 只生效一次。未来新录入词默认为 `placementPending = false`。

mastered 是可逆状态：

- mastered 词点“忘了”：掉回 review，1 天后复习
- mastered 词点“模糊”：掉回 review，3 天后复习
- mastered 词点“认识/熟练”：继续保持 mastered，并按最长 90 天抽查

## 词库

词库页支持：

- 搜索词条
- 按录入时间升序/降序排序
- 编辑已有词条
- 删除词条
- 朗读韩语词条
- 导出/导入 JSON 备份

删除词条时：

- 已登录云端：本地删除后，同时对云端执行 soft delete
- 未登录云端：本地删除后，记录到 pending deletes，下次同步前先补删云端

云端恢复时会过滤 `deleted_at` 不为空的数据，所以已删除词不会被重新拉回。

## Supabase v2 云端同步

新版云端表是：

```text
korean_vocab_words_v2
```

旧表 `vocab_cards` 不再作为新版 app 的主同步表。旧表数据可以保留，不需要删除。

### 1. 准备 Supabase 表

进入 Supabase 项目：

1. 打开 SQL Editor
2. 新建 query
3. 复制 `supabase-schema-v2.sql` 的全部内容
4. 粘贴并点击 Run

这个脚本会创建或更新 `korean_vocab_words_v2`，并开启 Row Level Security。

### 2. 配置 URL 和 anon key

在 Supabase 项目里打开：

```text
Project Settings -> API
```

复制：

- Project URL
- anon public key

在 Otterly 的“同步”页打开“高级配置”，填入并保存。

### 3. 邮箱验证码登录

Otterly 当前使用 6 位邮箱验证码登录，比 magic link 更适合手机 PWA。

Supabase 邮件模板建议包含：

```html
<h2>Otterly 登录验证码</h2>
<p>你的验证码是：</p>
<h1>{{ .Token }}</h1>
<p>如果不是你本人操作，可以忽略这封邮件。</p>
```

使用流程：

1. 在 Otterly 同步页输入邮箱
2. 点击“发送验证码”
3. 去邮箱查看 6 位验证码
4. 回到 Otterly 输入验证码
5. 点击“用验证码登录”

### 4. 同步方式

- “同步到云端”：把当前本地新版词库 upsert 到 `korean_vocab_words_v2`
- “从云端下载”：从 `korean_vocab_words_v2` 读取当前用户未删除的数据并覆盖本地

同步到云端前，会先处理 `korean-vocab-v2-pending-deletes` 中的待删除词条。

## PWA

Otterly 已包含基础 PWA 文件：

- `manifest.webmanifest`
- `favicon.png`
- `apple-touch-icon.png`
- `assets/pwa-icon-192.png`
- `assets/pwa-icon-512.png`

部署到 GitHub Pages 后，可以在 iPhone Safari 中选择“添加到主屏幕”。

如果 PWA 没有立刻更新：

1. 在 Safari 打开 GitHub Pages 链接并刷新
2. 完全关闭主屏幕上的 Otterly
3. 重新打开 Otterly

## 部署到 GitHub Pages

上传整个项目文件夹中的内容，至少包括：

- `index.html`
- `app.js`
- `styles.css`
- `manifest.webmanifest`
- `favicon.png`
- `apple-touch-icon.png`
- `assets/`
- `server.mjs`
- `README.md`
- `supabase-schema-v2.sql`
- `supabase-schema.sql`

`.DS_Store` 可以不用上传。

## 备份建议

虽然 Otterly 支持 Supabase 云端同步，仍建议定期在词库页导出 JSON 备份。
