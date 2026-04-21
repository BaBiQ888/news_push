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
    '任务：从给定的 HackerNews 文章列表中筛选有价值的条目，分类、提炼，输出一份结构化简报。',
    '',
    '判断价值的角度：',
    '- 是否带来新的技术洞见、可复用的工程经验、值得关注的产品/工具，或对行业有重要影响。',
    '- 不要只复述标题，要解释"为什么值得读"。',
    '- 没价值的条目（招聘贴、政治口水、纯八卦、内容空洞）可以剔除。',
    '',
    '分类标签必须从下列闭集中选择，禁止自由发挥：',
    `  ${ALLOWED_CATEGORIES.join(' | ')}`,
    '',
    `语言：${language}（标题如为英文可保留原文，摘要与要点用 ${language}）。`,
    '',
    '输出格式：严格的 JSON，不要任何 markdown 代码块包裹，不要前后多余文字。Schema：',
    OUTPUT_SCHEMA_HINT,
    '',
    '硬性约束：',
    '- oneLineSummary 控制在 60 个汉字以内。',
    '- keyPoints 提供 3-5 条，每条简短（<= 30 字），提炼信息密度，不灌水。',
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
