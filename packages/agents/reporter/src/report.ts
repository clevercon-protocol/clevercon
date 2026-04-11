import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ReportSection {
  title: string;
  content: string;
}

export interface ReportInput {
  title: string;
  sections: ReportSection[];
}

export async function generateReport(input: ReportInput | string): Promise<string> {
  let prompt: string;

  if (typeof input === 'string') {
    prompt = `You are a professional report writer. Format the following data into a clear, structured report.

Data:
${input}

Requirements:
- Use clear markdown headings and sections
- Include an executive summary at the top
- Highlight key findings and actionable insights
- Format numbers and percentages clearly
- Add a brief recommendations section at the end

Produce a well-formatted markdown report now:`;
  } else {
    const sectionsText = input.sections
      .map(s => `## ${s.title}\n${s.content}`)
      .join('\n\n');

    prompt = `You are a professional report writer. Compile the following sections into a polished ${input.title} report.

${sectionsText}

Requirements:
- Begin with an executive summary synthesizing all sections
- Preserve and organize all key data points from each section
- Add clear markdown formatting with tables where appropriate
- Include a risk assessment and key recommendations at the end
- Be concise but comprehensive

Produce the final formatted report now:`;
  }

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : 'Report generation unavailable';
}
