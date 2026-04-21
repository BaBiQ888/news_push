import { google } from 'googleapis';
import type { DailyReport, Pusher, PushResult, PusherConfig } from '../types.js';
import { failResult, okResult } from './base.js';

type GoogleDocsConfig = Extract<PusherConfig, { type: 'google_docs' }>;

export class GoogleDocsPusher implements Pusher {
  readonly name = 'google_docs';

  constructor(private readonly cfg: GoogleDocsConfig) {}

  async push(report: DailyReport): Promise<PushResult> {
    try {
      if (!this.cfg.documentId) {
        throw new Error('google_docs.documentId is required');
      }
      const keyFile = this.cfg.credentialsFile ?? process.env['GOOGLE_APPLICATION_CREDENTIALS'];
      if (!keyFile) {
        throw new Error('google_docs requires credentialsFile or GOOGLE_APPLICATION_CREDENTIALS');
      }
      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/documents'],
      });
      const docs = google.docs({ version: 'v1', auth });

      const doc = await docs.documents.get({ documentId: this.cfg.documentId });
      const body = doc.data.body;
      const content = body?.content ?? [];
      // Last segment endIndex is the end of the document body. The end-of-body
      // structural element occupies one index, so insertion must happen at endIndex - 1.
      let insertIndex = 1;
      if (content.length > 0) {
        const last = content[content.length - 1];
        if (last && typeof last.endIndex === 'number') {
          insertIndex = Math.max(1, last.endIndex - 1);
        }
      }

      const text = `\n\n---\n\n${report.title}\n${report.markdown ?? ''}\n`;
      const res = await docs.documents.batchUpdate({
        documentId: this.cfg.documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: insertIndex },
                text,
              },
            },
          ],
        },
      });
      return okResult(this.name, {
        appendedChars: text.length,
        replies: res.data.replies?.length ?? 0,
      });
    } catch (err) {
      return failResult(this.name, err);
    }
  }
}
