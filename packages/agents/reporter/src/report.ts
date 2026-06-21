import Anthropic from '@anthropic-ai/sdk';

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

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
    // Detect if all upstream steps failed — refuse to invent content
    const allFailed =
      input.trim().length === 0 ||
      (input.includes('[Step') && input.includes('failed:') && !input.match(/[A-Z].*\n/));

    if (allFailed || input.trim().length === 0) {
      return '**Report unavailable** — upstream data collection failed. No data was returned by the previous steps to report on.';
    }

    prompt = `You are a professional report writer. Format the following data into a clear, structured report.
Some steps may have failed — note any gaps clearly rather than inventing data for them.

Data:
${input}

Requirements:
- Use clear markdown headings and sections
- Include an executive summary at the top
- Report only on data that was actually provided — do not invent or template missing sections
- If a data source failed, mention it briefly and continue with what is available
- Highlight key findings and actionable insights from the available data
- Format numbers clearly

Produce a well-formatted markdown report now:`;
  } else {
    const sectionsText = input.sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n');

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

  const response = await getClient().messages.create({
    model: process.env.LLM_REPORTER_MODEL ?? process.env.LLM_MODEL ?? 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].type === 'text'
    ? response.content[0].text
    : 'Report generation unavailable';
}
