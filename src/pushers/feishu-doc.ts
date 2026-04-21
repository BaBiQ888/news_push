import type { AISummaryItem, DailyReport, Pusher, PushResult, PusherConfig } from '../types.js';
import { failResult, okResult, PushError, requestJson } from './base.js';

type FeishuDocConfig = Extract<PusherConfig, { type: 'feishu_doc' }>;

interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuApiResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const cacheKey = `${appId}:${appSecret}`;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }
  const res = await requestJson<TenantTokenResponse>(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      body: { app_id: appId, app_secret: appSecret },
    },
  );
  if (res.code !== 0 || !res.tenant_access_token) {
    throw new PushError(`failed to acquire tenant_access_token: code=${res.code} msg=${res.msg}`, res);
  }
  const expireSeconds = typeof res.expire === 'number' && res.expire > 0 ? res.expire : 7200;
  tokenCache.set(cacheKey, {
    token: res.tenant_access_token,
    expiresAt: now + expireSeconds * 1000,
  });
  return res.tenant_access_token;
}

export class FeishuDocPusher implements Pusher {
  readonly name: string;

  constructor(private readonly cfg: FeishuDocConfig) {
    this.name = `feishu_doc:${cfg.target.kind}`;
  }

  async push(report: DailyReport): Promise<PushResult> {
    try {
      if (!this.cfg.appId || !this.cfg.appSecret) {
        throw new Error('feishu_doc.appId and appSecret are required');
      }
      const token = await getTenantAccessToken(this.cfg.appId, this.cfg.appSecret);
      if (this.cfg.target.kind === 'bitable') {
        return await this.pushBitable(token, this.cfg.target, report);
      }
      return await this.pushDoc(token, this.cfg.target, report);
    } catch (err) {
      return failResult(this.name, err);
    }
  }

  private async pushBitable(
    token: string,
    target: Extract<FeishuDocConfig['target'], { kind: 'bitable' }>,
    report: DailyReport,
  ): Promise<PushResult> {
    if (!target.appToken || !target.tableId) {
      throw new Error('feishu_doc bitable target requires appToken and tableId');
    }
    const records = report.items.map((item) => ({ fields: itemToBitableFields(report.date, item) }));
    if (records.length === 0) {
      return okResult(this.name, { skipped: 'no items' });
    }
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(target.appToken)}/tables/${encodeURIComponent(target.tableId)}/records/batch_create`;
    const res = await requestJson<FeishuApiResponse>(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { records },
    });
    if (res.code !== 0) {
      throw new PushError(`bitable batch_create failed: code=${res.code} msg=${res.msg}`, res);
    }
    return okResult(this.name, { inserted: records.length });
  }

  private async pushDoc(
    token: string,
    target: Extract<FeishuDocConfig['target'], { kind: 'doc' }>,
    report: DailyReport,
  ): Promise<PushResult> {
    if (!target.documentId) {
      throw new Error('feishu_doc doc target requires documentId');
    }
    const blocks = markdownToDocxBlocks(report);
    const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${encodeURIComponent(target.documentId)}/blocks/${encodeURIComponent(target.documentId)}/children`;
    const res = await requestJson<FeishuApiResponse>(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { children: blocks, index: -1 },
    });
    if (res.code !== 0) {
      throw new PushError(`docx append blocks failed: code=${res.code} msg=${res.msg}`, res);
    }
    return okResult(this.name, { appendedBlocks: blocks.length });
  }
}

function itemToBitableFields(date: string, item: AISummaryItem): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    日期: date,
    标题: item.title,
    分类: item.category,
    摘要: item.oneLineSummary,
    关键点: (item.keyPoints ?? []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
  };
  if (item.url) fields['链接'] = item.url;
  if (typeof item.score === 'number') fields['分数'] = item.score;
  return fields;
}

interface DocxBlock {
  block_type: number;
  [key: string]: unknown;
}

/**
 * Build a small set of Feishu docx blocks from the report.
 * We don't render full markdown — instead we emit:
 *   - one heading1 with the report title
 *   - one text block with date / generatedAt / counts
 *   - per item: heading2 (title) + text (one-line summary) + text (key points joined)
 *   - one divider at the end
 * Block type ids per Feishu docx v1: 2=text, 3=heading1, 4=heading2, 22=divider.
 */
function markdownToDocxBlocks(report: DailyReport): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  blocks.push(headingBlock(3, report.title));
  blocks.push(
    textBlock(
      `date=${report.date} · generatedAt=${report.generatedAt} · items=${report.meta?.itemCount ?? report.items.length} · sources=${report.meta?.sourceCount ?? '?'}`,
    ),
  );
  for (const item of report.items) {
    const headingText = item.url ? `[${item.category}] ${item.title} (${item.url})` : `[${item.category}] ${item.title}`;
    blocks.push(headingBlock(4, headingText));
    blocks.push(textBlock(item.oneLineSummary));
    if (item.keyPoints && item.keyPoints.length > 0) {
      blocks.push(textBlock(item.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')));
    }
  }
  blocks.push({ block_type: 22, divider: {} });
  return blocks;
}

function textBlock(content: string): DocxBlock {
  return {
    block_type: 2,
    text: {
      elements: [
        {
          text_run: { content, text_element_style: {} },
        },
      ],
      style: {},
    },
  };
}

function headingBlock(level: 3 | 4, content: string): DocxBlock {
  // Feishu docx: heading1 = block_type 3 with field name `heading1`,
  // heading2 = block_type 4 with field name `heading2`.
  const fieldName = level === 3 ? 'heading1' : 'heading2';
  return {
    block_type: level,
    [fieldName]: {
      elements: [
        {
          text_run: { content, text_element_style: {} },
        },
      ],
      style: {},
    },
  };
}
