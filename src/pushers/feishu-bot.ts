import { createHmac } from 'node:crypto';
import type { DailyReport, Pusher, PushResult, PusherConfig } from '../types.js';
import { failResult, okResult, requestJson, truncateBytes } from './base.js';

type FeishuBotConfig = Extract<PusherConfig, { type: 'feishu_bot' }>;

const MAX_MARKDOWN_BYTES = 28 * 1024;

interface FeishuBotResponse {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
  data?: unknown;
}

export class FeishuBotPusher implements Pusher {
  readonly name = 'feishu_bot';

  constructor(private readonly cfg: FeishuBotConfig) {}

  async push(report: DailyReport): Promise<PushResult> {
    try {
      if (!this.cfg.webhook) {
        throw new Error('feishu_bot.webhook is required');
      }

      const body: Record<string, unknown> = this.buildPayload(report);

      if (this.cfg.secret) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const sign = signFeishu(timestamp, this.cfg.secret);
        body['timestamp'] = timestamp;
        body['sign'] = sign;
      }

      const res = await requestJson<FeishuBotResponse>(this.cfg.webhook, {
        method: 'POST',
        body,
      });

      const code = res?.code ?? res?.StatusCode;
      if (code !== undefined && code !== 0) {
        return failResult(this.name, `feishu bot returned code=${code} msg=${res?.msg ?? res?.StatusMessage ?? ''}`, res);
      }
      return okResult(this.name, res);
    } catch (err) {
      return failResult(this.name, err);
    }
  }

  private buildPayload(report: DailyReport): Record<string, unknown> {
    const md = truncateBytes(report.markdown ?? '', MAX_MARKDOWN_BYTES);
    return {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: report.title },
          template: 'blue',
        },
        elements: [
          {
            tag: 'div',
            text: { tag: 'lark_md', content: md },
          },
          { tag: 'hr' },
          {
            tag: 'note',
            elements: [
              {
                tag: 'plain_text',
                content: `date=${report.date} · items=${report.meta?.itemCount ?? report.items.length} · sources=${report.meta?.sourceCount ?? '?'}`,
              },
            ],
          },
        ],
      },
    };
  }
}

export function signFeishu(timestamp: string, secret: string): string {
  // Feishu signing: HMAC-SHA256 with key = `${timestamp}\n${secret}`, message = empty bytes,
  // then base64 of the resulting digest.
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = createHmac('sha256', stringToSign);
  hmac.update('');
  return hmac.digest('base64');
}
