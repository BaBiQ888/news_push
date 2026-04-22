# news-push

把 HackerNews 双源数据通过 LLM 整合，每日推送到聊天群和文档归档。

```
HN Firebase API (top/best/new)  ┐
                                ├─→ 合并去重 ─→ Jina 抓正文 ─→ AI 摘要 ─┐
HN Algolia API   (关键词筛选)   ┘                                       │
                                                                        ↓
                                  ┌──────────────────────┬──────────────┴──────────────┐
                                  ↓                      ↓                             ↓
                          飞书 / 钉钉群机器人      飞书云文档/多维表格         Google Sheets / Docs
```

**特性**

- 多 AI provider：Anthropic Claude（含 prompt caching） / Google Gemini（JSON 模式 + 自动重试）
- 多推送通道：飞书机器人、钉钉机器人、飞书云文档/多维表格、Google Sheets、Google Docs；并行下发，单点失败隔离
- 双源去重：HN Firebase + Algolia 合并，按 `hn:{id}` 去重，已推送 ID 持久化
- 部署灵活：本地 launchd / GitHub Actions cron 任选

---

## 快速开始

```bash
git clone https://github.com/BaBiQ888/news_push.git
cd news_push
npm install                                                  # Node 20+

cp .env.example .env                                         # 填密钥
cp config/pushers.config.example.yaml config/pushers.config.yaml

npm run run-once -- --dry                                    # 干跑（生成报告，不推送）
npm run run-once                                             # 真跑
```

最少需要：
- 一个 LLM API Key（`GEMINI_API_KEY` 或 `ANTHROPIC_API_KEY`）
- 一个推送目标（最简单：飞书或钉钉群机器人 webhook）

---

## AI Provider

切换模型只改 `config/pushers.config.yaml` 的 `ai` 段：

```yaml
ai:
  provider: gemini                  # anthropic | gemini
  model: gemini-3-flash-preview     # 见下表
  promptCaching: true               # 仅 Anthropic 生效，Gemini 忽略
  language: zh-CN
  maxTokens: 16384                  # 大批量条目建议 >= 16384，避免 JSON 截断
```

| Provider | 环境变量 | 申请 | 推荐 model |
|---|---|---|---|
| anthropic | `ANTHROPIC_API_KEY` | https://console.anthropic.com | `claude-sonnet-4-6` / `claude-opus-4-7` / `claude-haiku-4-5-20251001` |
| gemini | `GEMINI_API_KEY`（或 `GOOGLE_AI_API_KEY`） | https://aistudio.google.com/apikey | `gemini-3-flash-preview` / `gemini-2.5-pro` / `gemini-2.5-flash` |

> Gemini 模型名称如 404，用以下命令查当前可用列表：
> ```bash
> curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
>   | jq '.models[] | select(.supportedGenerationMethods[] | contains("generateContent")) | .name'
> ```

---

## 推送通道

### 群机器人（最快上线）

#### 飞书

1. 群设置 → 群机器人 → 添加 → 自定义机器人；勾"签名校验"（推荐）
2. `.env`：
   ```
   FEISHU_BOT_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
   FEISHU_BOT_SECRET=xxxxx          # 没勾签名留空
   ```
3. config 里 `feishu_bot.enabled: true`

#### 钉钉

1. 群设置 → 智能群助手 → 添加机器人 → 自定义；安全设置至少选一项（**推荐加签**）
2. `.env`：
   ```
   DINGTALK_BOT_WEBHOOK=https://oapi.dingtalk.com/robot/send?access_token=xxx
   DINGTALK_BOT_SECRET=SECxxx
   ```
3. config 里 `dingtalk_bot.enabled: true`，可选 `atMobiles` / `atAll`

> 钉钉单条 markdown ≈ 5000 字符上限，本项目自动截断到 4500。长内容请配合云文档归档。

### 云文档 / 表格（适合归档）

#### 飞书云文档 / 多维表格

1. https://open.feishu.cn 创建"自建应用"
2. `.env` 填 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
3. 给应用授权对应权限：
   - 多维表格：`bitable:app`（读写）
   - 云文档：`docx:document`（读写）
4. **把目标表格 / 文档共享给应用**（不做这步会 403）
5. config 里 `feishu_doc.enabled: true`，`target.kind` 选 `bitable` 或 `doc`

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

#### Google Sheets / Docs

1. https://console.cloud.google.com 启用 `Google Sheets API` 和 / 或 `Google Docs API`
2. IAM → 服务账号 → 生成 JSON 密钥，放到 `creds/gcp-sa.json`（已 gitignored）
3. **把目标 Sheet / Doc 共享给该服务账号的邮箱**（关键步骤，否则 403）
4. config 里填 `spreadsheetId` 或 `documentId`

Sheets 建议手动写表头：`Date | Category | Title | Summary | KeyPoints | URL | Score`

---

## 部署

### GitHub Actions（推荐，免费 + 跨设备）

仓库已自带 `.github/workflows/daily.yml`：每天 00:15 UTC（08:15 Asia/Shanghai）自动跑，使用 `actions/cache` 跨次保留 dedup 状态。

**启用步骤**

1. Fork / clone 后推到自己的仓库
2. **Settings → Secrets and variables → Actions** 添加：
   - `GEMINI_API_KEY`（或 `ANTHROPIC_API_KEY`）
   - `DINGTALK_BOT_WEBHOOK` + `DINGTALK_BOT_SECRET`（或飞书的）
3. workflow 默认读 `config/pushers.config.ci.yaml`，按需修改源/分类/maxTokens
4. **Actions 标签 → Daily HN Push → Run workflow** 手动触发一次验证（可勾 `dry_run`）

切换 CI 用的推送渠道，改两处：
- `.github/workflows/daily.yml` 的 `env:` 里换对应 secret 名
- `config/pushers.config.ci.yaml` 的 `pushers:` 段切到目标 pusher

### macOS launchd（本地常驻方案）

```bash
mkdir -p logs
sed -i '' "s/YOUR_USER/$USER/g" launchd/com.user.news-push.plist  # 替换占位符
cp launchd/com.user.news-push.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.user.news-push.plist

launchctl start com.user.news-push     # 立即触发一次
tail -f logs/news-push.out.log         # 看日志
```

默认每天 08:00 触发；改 plist 的 `StartCalendarInterval` 调整时间。

---

## 扩展

### 加 AI provider

1. `src/ai/providers/<name>.ts` 实现 `AIProvider` interface
2. `src/ai/providers/index.ts` 的 `buildProvider` switch 加 case
3. `src/types.ts` 的 `AIProviderName` 加分支

### 加推送平台

1. `src/types.ts` 的 `PusherConfig` union 加分支
2. `src/pushers/<name>.ts` 实现 `Pusher` interface（`name` + `push(report)`，**不能抛**，错误包成 `PushResult`）
3. `src/pushers/index.ts` 的 `buildPushers` switch 加 case
4. `config/pushers.config.example.yaml` 加配置示例 + `.env.example` 加新 env 名

### 加数据源

1. `src/sources/<name>.ts` 实现 `SourceFetcher` interface，`id` 用 `"{source}:{native_id}"`（用于跨源去重）
2. `src/sources/index.ts` 的 `buildSources` 里 push 进来
3. `src/types.ts` 的 `SourcesConfig` 加配置类型

---

## 常用命令

```bash
npm run typecheck                    # tsc --noEmit
npm run run-once                     # 手动跑一次（含推送）
npm run run-once -- --dry            # 干跑：生成 markdown 不推送
npm run run-once -- --ignore-dedup   # 忽略去重，重摘所有条目（调试用）
```

---

## 项目结构

```
src/
  index.ts                  # orchestrator: fetch → enrich → summarize → push → save state
  config.ts                 # YAML 加载 + ${ENV} 展开
  types.ts                  # 共享 interface（NewsItem / DailyReport / Pusher / Config…）
  sources/
    hn-firebase.ts          # HN 官方 Firebase API（top/best/new）
    hn-algolia.ts           # HN Algolia 搜索 API（关键词 + 时间窗 + 分数）
    index.ts                # buildSources / fetchAll（合并去重 + 按分数排序）
  enrichment/
    jina-reader.ts          # https://r.jina.ai 抓正文为 markdown，best-effort
  ai/
    summarizer.ts           # provider 无关，输出 DailyReport
    prompts.ts              # system prompt + JSON schema + 分类闭集
    providers/
      base.ts               # AIProvider 接口
      anthropic.ts          # Claude（prompt caching）
      gemini.ts             # Gemini（JSON 模式 + 指数退避重试）
      index.ts              # buildProvider 工厂
  pushers/
    feishu-bot.ts           # 飞书群机器人（含签名）
    feishu-doc.ts           # 飞书云文档/多维表格
    dingtalk-bot.ts         # 钉钉群机器人（含签名）
    google-sheets.ts        # Google Sheets append
    google-docs.ts          # Google Docs append
    index.ts                # buildPushers / pushAll（Promise.allSettled 失败隔离）
  state/
    dedup.ts                # data/seen.json 持久化已推送 ID
config/
  pushers.config.example.yaml  # 模板
  pushers.config.ci.yaml       # GitHub Actions 用
scripts/
  run-once.ts               # 手动入口（--dry / --ignore-dedup）
launchd/
  com.user.news-push.plist  # macOS 定时任务模板
.github/workflows/
  daily.yml                 # GitHub Actions cron + manual dispatch
data/                       # 运行时状态（gitignored）
creds/                      # 凭证（gitignored）
```
