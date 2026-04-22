import { createHmac } from 'node:crypto';
import type { DailyReport, Pusher, PushResult, PusherConfig } from '../types.js';
import { failResult, okResult, requestJson, truncateBytes } from './base.js';

type DingtalkBotConfig = Extract<PusherConfig, { type: 'dingtalk_bot' }>;

// DingTalk markdown body has a hard limit around 5000 chars; leave headroom for
// title + frontmatter + truncation suffix.
const MAX_MARKDOWN_BYTES = 4500;

interface DingtalkBotResponse {
  errcode?: number;
  errmsg?: string;
}

export class DingtalkBotPusher implements Pusher {
  readonly name = 'dingtalk_bot';

  constructor(private readonly cfg: DingtalkBotConfig) {}

  async push(report: DailyReport): Promise<PushResult> {
    try {
      if (!this.cfg.webhook) {
        throw new Error('dingtalk_bot.webhook is required');
      }

      const url = this.cfg.secret
        ? appendSign(this.cfg.webhook, this.cfg.secret)
        : this.cfg.webhook;

      const body = this.buildPayload(report);

      const res = await requestJson<DingtalkBotResponse>(url, {
        method: 'POST',
        body,
      });

      if (res?.errcode !== undefined && res.errcode !== 0) {
        return failResult(
          this.name,
          `dingtalk bot returned errcode=${res.errcode} errmsg=${res.errmsg ?? ''}`,
          res,
        );
      }
      return okResult(this.name, res);
    } catch (err) {
      return failResult(this.name, err);
    }
  }

  private buildPayload(report: DailyReport): Record<string, unknown> {
    const md = truncateBytes(report.markdown ?? '', MAX_MARKDOWN_BYTES);
    const payload: Record<string, unknown> = {
      msgtype: 'markdown',
      markdown: {
        title: report.title,
        text: md,
      },
    };
    if (this.cfg.atMobiles?.length || this.cfg.atAll) {
      payload['at'] = {
        atMobiles: this.cfg.atMobiles ?? [],
        isAtAll: !!this.cfg.atAll,
      };
    }
    return payload;
  }
}

/**
 * DingTalk signing: HMAC-SHA256 with key = secret, message = `${timestamp}\n${secret}`,
 * then base64 + URL encode. Append `&timestamp=...&sign=...` to webhook URL.
 * Note: this is DIFFERENT from Feishu (Feishu uses key = `${ts}\n${secret}`, empty message).
 */
export function signDingtalk(timestampMs: string, secret: string): string {
  const stringToSign = `${timestampMs}\n${secret}`;
  const hmac = createHmac('sha256', secret);
  hmac.update(stringToSign);
  return hmac.digest('base64');
}

function appendSign(webhook: string, secret: string): string {
  const timestamp = Date.now().toString();
  const sign = encodeURIComponent(signDingtalk(timestamp, secret));
  const sep = webhook.includes('?') ? '&' : '?';
  return `${webhook}${sep}timestamp=${timestamp}&sign=${sign}`;
}
