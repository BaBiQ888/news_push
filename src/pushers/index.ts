import type { DailyReport, Pusher, PushResult, PusherConfig } from '../types.js';
import { DingtalkBotPusher } from './dingtalk-bot.js';
import { FeishuBotPusher } from './feishu-bot.js';
import { FeishuDocPusher } from './feishu-doc.js';
import { GoogleDocsPusher } from './google-docs.js';
import { GoogleSheetsPusher } from './google-sheets.js';

export { DingtalkBotPusher } from './dingtalk-bot.js';
export { FeishuBotPusher } from './feishu-bot.js';
export { FeishuDocPusher } from './feishu-doc.js';
export { GoogleDocsPusher } from './google-docs.js';
export { GoogleSheetsPusher } from './google-sheets.js';

export function buildPushers(configs: PusherConfig[]): Pusher[] {
  const pushers: Pusher[] = [];
  for (const c of configs) {
    if (!c.enabled) continue;
    switch (c.type) {
      case 'feishu_bot':
        pushers.push(new FeishuBotPusher(c));
        break;
      case 'feishu_doc':
        pushers.push(new FeishuDocPusher(c));
        break;
      case 'dingtalk_bot':
        pushers.push(new DingtalkBotPusher(c));
        break;
      case 'google_sheets':
        pushers.push(new GoogleSheetsPusher(c));
        break;
      case 'google_docs':
        pushers.push(new GoogleDocsPusher(c));
        break;
    }
  }
  return pushers;
}

export async function pushAll(report: DailyReport, pushers: Pusher[]): Promise<PushResult[]> {
  const settled = await Promise.allSettled(
    pushers.map(async (p) => {
      try {
        return await p.push(report);
      } catch (err) {
        return {
          pusher: p.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies PushResult;
      }
    }),
  );
  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const name = pushers[i]?.name ?? `pusher[${i}]`;
    return { pusher: name, ok: false, error: String(r.reason) };
  });
}
