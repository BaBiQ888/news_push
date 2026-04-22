# news-push

把 HackerNews 双源数据 → Claude AI 摘要 → 推送到飞书 / Google 文档的最小可用项目。

```
HN Firebase API (top stories)  ┐
                               ├─→ 合并去重 ─→ Jina 抓正文 ─→ Claude 摘要 ─┐
HN Algolia API   (关键词筛选)  ┘                                          │
                                                                          ↓
                                                         ┌───────────────┴────────────────┐
                                                         ↓                                ↓
                                                  飞书群机器人 / 飞书文档        Google Sheets / Docs
```

## 快速开始

```bash
# 1. 装依赖（需要 Node 20+）
npm install

# 2. 复制配置模板
cp .env.example .env
cp config/pushers.config.example.yaml config/pushers.config.yaml

# 3. 填写 .env 中的密钥（至少需要 ANTHROPIC_API_KEY）

# 4. 编辑 config/pushers.config.yaml，开启你想用的 pusher

# 5. 干跑一次（生成报告但不推送）
npm run run-once -- --dry

# 6. 真跑
npm run run-once
```

## 项目结构

```
src/
  index.ts              # orchestrator：fetch → enrich → summarize → push → save state
  config.ts             # YAML 配置加载 + ${ENV} 展开
  types.ts              # 共享 interface（NewsItem / DailyReport / Pusher / Config…）
  sources/              # 数据源
    hn-firebase.ts      # HN 官方 Firebase API（top/best/new）
    hn-algolia.ts       # HN Algolia 搜索 API（按关键词 + 时间窗 + 分数）
    index.ts            # buildSources / fetchAll（合并去重 + 按分数排序）
  enrichment/
    jina-reader.ts      # https://r.jina.ai 抓正文为 markdown
  ai/
    summarizer.ts       # provider 无关，输出 DailyReport
    prompts.ts          # system prompt + 输出 JSON schema + 分类闭集
    providers/
      base.ts           # AIProvider 接口
      anthropic.ts      # Claude（含 prompt caching）
      gemini.ts         # Google Gemini（responseMimeType=application/json）
      index.ts          # buildProvider 工厂
  pushers/              # 推送适配器
    feishu-bot.ts       # 飞书自定义群机器人 webhook（支持签名）
    feishu-doc.ts       # 飞书云文档 / 多维表格（tenant_access_token 自动管理）
    google-sheets.ts    # Google Sheets 追加行（Service Account）
    google-docs.ts      # Google Docs 追加文本（Service Account）
    index.ts            # buildPushers / pushAll（失败隔离）
  state/
    dedup.ts            # 已推送 id 持久化到 data/seen.json，自动按 retentionDays 淘汰
config/
  pushers.config.example.yaml
scripts/
  run-once.ts           # 手动触发入口（支持 --dry / --ignore-dedup）
launchd/
  com.user.news-push.plist  # macOS 定时任务模板
data/                   # 运行时状态（git ignored）
creds/                  # 凭证（git ignored）
```

## AI 模型选择

支持 Anthropic Claude 与 Google Gemini，在 `config/pushers.config.yaml` 的 `ai` 段切换：

```yaml
ai:
  provider: gemini          # anthropic | gemini
  model: gemini-3-pro       # claude-sonnet-4-6 | claude-opus-4-7 | claude-haiku-4-5-20251001 | gemini-3-pro | gemini-2.5-pro | ...
  promptCaching: true       # Anthropic 生效；Gemini 忽略（用 generationConfig 强制 JSON）
  language: zh-CN
```

对应在 `.env` 里至少设置一个匹配的 key：

| Provider | 环境变量 | 申请入口 |
|---|---|---|
| anthropic | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| gemini | `GEMINI_API_KEY`（或 `GOOGLE_AI_API_KEY`） | https://aistudio.google.com/apikey |

加新的 provider：在 `src/ai/providers/` 新建实现 `AIProvider` 的文件，再在 `providers/index.ts` 的 `buildProvider` 加 case 即可。

## 各 pusher 凭证说明

### 飞书群机器人（最简单）

1. 群设置 → 群机器人 → 添加 → 自定义机器人
2. 把 webhook URL 填到 `.env` 的 `FEISHU_BOT_WEBHOOK`
3. 如果你勾了"签名校验"，把 secret 填到 `FEISHU_BOT_SECRET`
4. config 里把 `feishu_bot.enabled` 设为 `true`

### 钉钉群机器人

1. 群设置 → 智能群助手 → 添加机器人 → 自定义
2. 安全设置至少选一项：**加签**（推荐）/ 关键词 / IP 白名单
3. 把 webhook URL（含 `?access_token=...`）填到 `.env` 的 `DINGTALK_BOT_WEBHOOK`
4. 加签的 secret 填到 `DINGTALK_BOT_SECRET`
5. config 里 `dingtalk_bot.enabled` 设为 `true`，可选 `atMobiles` / `atAll`

注意：钉钉 markdown 消息单条上限约 5000 字符，本项目已自动截断到 4500，长内容请配合云文档归档使用。

### 飞书云文档 / 多维表格

1. https://open.feishu.cn 创建"自建应用"
2. 拿到 `App ID` / `App Secret`，填到 `.env`
3. 给应用授权：
   - 多维表格：`bitable:app` 读写权限
   - 云文档：`docx:document` 读写权限
4. **把目标表格 / 文档共享给应用**（关键步骤，否则 403）
5. config 里 `target.kind` 选 `bitable` 或 `doc`，填 `appToken`/`tableId` 或 `documentId`

**多维表格列名约定**（必须精确匹配）：
| 列名 | 类型 |
|---|---|
| 日期 | 文本 |
| 标题 | 文本 |
| 分类 | 单选/文本 |
| 摘要 | 文本 |
| 关键点 | 多行文本 |
| 链接 | URL |
| 分数 | 数字 |

### Google Sheets / Docs

1. https://console.cloud.google.com 创建项目
2. 启用 `Google Sheets API` 和 / 或 `Google Docs API`
3. IAM → 创建服务账号 → 生成 JSON 密钥
4. 把 JSON 文件放到 `creds/gcp-sa.json`（git 已忽略）
5. **共享你的目标 Sheet / Doc 给该服务账号的邮箱地址**（关键步骤）
6. config 里填 `spreadsheetId` 或 `documentId`

Sheets 第一行建议手动写表头：`Date | Category | Title | Summary | KeyPoints | URL | Score`

## 定时运行（macOS launchd）

1. 复制并改 `launchd/com.user.news-push.plist` 中的所有 `YOUR_USER` 占位符为你的用户名
2. 用 `which node` 确认 node 路径
3. 安装：

```bash
mkdir -p logs
cp launchd/com.user.news-push.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.user.news-push.plist

# 立即触发一次测试
launchctl start com.user.news-push

# 查看日志
tail -f logs/news-push.out.log
```

默认每天 08:00 触发。修改 `StartCalendarInterval` 调整时间。

## 加新的推送平台

1. 在 `src/types.ts` 的 `PusherConfig` union 里加分支
2. 在 `src/pushers/` 新建 `xxx.ts`，实现 `Pusher` interface
3. 在 `src/pushers/index.ts` 的 `buildPushers` switch 里加 case
4. 在 `config/pushers.config.example.yaml` 加配置示例

## 加新的数据源

1. 实现 `SourceFetcher` interface（`name` + `fetch(): Promise<NewsItem[]>`），id 用 `{source}:{native_id}`
2. 在 `src/sources/index.ts` 的 `buildSources` 里 push 进来
3. 在 `SourcesConfig` 加配置类型

## 常用命令

```bash
npm run typecheck       # tsc --noEmit
npm run run-once        # 手动跑一次
npm run run-once -- --dry           # 干跑（不推送，打印 markdown）
npm run run-once -- --ignore-dedup  # 忽略去重（重新摘要所有条目）
```
