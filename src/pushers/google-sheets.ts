import { google } from 'googleapis';
import type { DailyReport, Pusher, PushResult, PusherConfig } from '../types.js';
import { failResult, okResult } from './base.js';

type GoogleSheetsConfig = Extract<PusherConfig, { type: 'google_sheets' }>;

export class GoogleSheetsPusher implements Pusher {
  readonly name = 'google_sheets';

  constructor(private readonly cfg: GoogleSheetsConfig) {}

  async push(report: DailyReport): Promise<PushResult> {
    try {
      if (!this.cfg.spreadsheetId) {
        throw new Error('google_sheets.spreadsheetId is required');
      }
      const keyFile = this.cfg.credentialsFile ?? process.env['GOOGLE_APPLICATION_CREDENTIALS'];
      if (!keyFile) {
        throw new Error('google_sheets requires credentialsFile or GOOGLE_APPLICATION_CREDENTIALS');
      }
      if (report.items.length === 0) {
        return okResult(this.name, { skipped: 'no items' });
      }
      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const sheets = google.sheets({ version: 'v4', auth });
      const sheetName = this.cfg.sheetName ?? 'Sheet1';
      const range = `${sheetName}!A:Z`;
      const values = report.items.map((item) => [
        report.date,
        item.category,
        item.title,
        item.oneLineSummary,
        (item.keyPoints ?? []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
        item.url ?? '',
        typeof item.score === 'number' ? item.score : '',
      ]);
      const res = await sheets.spreadsheets.values.append({
        spreadsheetId: this.cfg.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      });
      return okResult(this.name, {
        appended: values.length,
        updatedRange: res.data.updates?.updatedRange,
      });
    } catch (err) {
      return failResult(this.name, err);
    }
  }
}
