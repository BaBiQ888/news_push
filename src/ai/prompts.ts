export const ALLOWED_CATEGORIES = [
  'AI/LLM',
  '工程实践',
  '工具',
  '创业商业',
  '学术研究',
  '其它',
] as const;

export const OUTPUT_SCHEMA_HINT = `{
  "items": [
    {
      "id": "string (must equal the input item id, e.g. \\"hn:12345\\")",
      "title": "string",
      "url": "string (optional)",
      "category": "string (one of: ${ALLOWED_CATEGORIES.join(' | ')})",
      "oneLineSummary": "string (<= 60 字, 解释为什么值得读)",
      "keyPoints": ["string", "..."]
    }
  ]
}`;

export function buildSystemPrompt(language: string): string {
  return [
    '你是资深科技日报编辑，目标读者是软件工程师与技术创业者。',
    '任务：为给定的 HackerNews 文章列表中的【每一条】生成结构化摘要。',
    '',
    '⚠️ 你只负责【摘要 + 分类】。输入有几条，输出就有几条。',
    '禁止删减、合并、跳过任何条目；候选筛选、低价值过滤、去重等工作已在代码侧完成。',
    '',
    '每条摘要的要求：',
    '- 不要只复述标题；用一句话说明【为什么值得读 / 它解决了什么问题 / 它带来什么洞见】。',
    '- 提炼 3-5 条 keyPoints，每条信息密度高，不灌水。',
    '- 分类必须从下列闭集中选择，禁止自由发挥：',
    `  ${ALLOWED_CATEGORIES.join(' | ')}`,
    '',
    `语言：${language}（标题如为英文可保留原文，摘要与要点用 ${language}）。`,
    '',
    '输出格式：严格的 JSON，不要任何 markdown 代码块包裹，不要前后多余文字。Schema：',
    OUTPUT_SCHEMA_HINT,
    '',
    '硬性约束：',
    '- output items 数量 == input items 数量（必须一一对应）。',
    '- oneLineSummary 控制在 60 个汉字以内。',
    '- keyPoints 提供 3-5 条，每条简短（<= 30 字）。',
    '- id 字段必须与输入 NewsItem.id 完全一致。',
    '- 仅输出 JSON 对象，根级字段为 items。',
  ].join('\n');
}

export function buildUserPrompt(date: string, itemsJson: string): string {
  return [
    `今日日期：${date}`,
    '',
    '以下是候选 HackerNews 文章（JSON 数组）：',
    itemsJson,
    '',
    '请按照 system 中的 schema 输出 JSON。',
  ].join('\n');
}
