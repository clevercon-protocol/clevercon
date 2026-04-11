import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { Keypair } from '@stellar/stellar-sdk';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { getBlockchainNews, getTechNews, getAINews } from './news.js';
import { scrapeUrl } from './scraper.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.WEB_INTEL_PORT || process.env.PORT || '4002');
const SECRET_KEY = process.env.WEB_INTEL_SECRET_KEY!;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://www.x402.org/facilitator';
const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SECRET_KEY) {
  console.error('[WebIntelligence] WEB_INTEL_SECRET_KEY not set');
  process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET_KEY);
const PAY_TO = keypair.publicKey();

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ── x402 setup ────────────────────────────────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactStellarScheme());

const app = express();
app.use(cors());
app.use(express.json());

// ── Unpaid endpoints ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'WebIntelligence', address: PAY_TO });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'WebIntelligence',
    description: 'Real news across blockchain, tech, and AI from xlm402.com',
    capabilities: ['news', 'web-search', 'web-scraping', 'information-retrieval', 'blockchain-news', 'tech-news'],
    pricing: { model: 'x402', price_per_call: 0.02, currency: 'USDC' },
    stellar_address: PAY_TO,
  });
});

// ── x402 payment middleware ───────────────────────────────────────
app.use(
  paymentMiddleware(
    {
      'POST /query': {
        accepts: { scheme: 'exact', price: '$0.02', network: NETWORK, payTo: PAY_TO },
        description: 'Real news articles from blockchain, tech, and AI sources',
      },
    },
    resourceServer,
    undefined, undefined, true,
  )
);

// ── Paid endpoint ─────────────────────────────────────────────────
app.post('/query', async (req, res) => {
  try {
    const { query = '', context = '' } = req.body;
    const q = query.toLowerCase();

    // Determine which news categories to fetch
    const wantsBlockchain = q.includes('blockchain') || q.includes('crypto') || q.includes('stellar') || q.includes('xlm') || q === '';
    const wantsTech = q.includes('tech') || q.includes('technology') || q === '';
    const wantsAI = q.includes('ai') || q.includes('artificial intelligence') || q === '';
    const wantsScrape = q.includes('scrape') || q.includes('extract') || q.includes('http');

    // Fetch relevant news categories in parallel
    const fetches: Promise<any>[] = [];
    if (wantsBlockchain) fetches.push(getBlockchainNews().catch(e => ({ error: e.message })));
    if (wantsTech) fetches.push(getTechNews().catch(e => ({ error: e.message })));
    if (wantsAI) fetches.push(getAINews().catch(e => ({ error: e.message })));

    const newsResults = await Promise.all(fetches);
    const allArticles: any[] = [];

    for (const r of newsResults) {
      if (r.error) continue;
      const inner = r.data?.data;
      if (!inner) continue;
      // xlm402 news uses "stories" key
      const items = inner.stories || inner.articles || (Array.isArray(inner) ? inner : []);
      allArticles.push(...items);
    }

    // Optionally scrape a URL if requested
    let scraped = null;
    if (wantsScrape) {
      const urlMatch = query.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        scraped = await scrapeUrl(urlMatch[0]).catch(e => ({ error: e.message }));
      }
    }

    // Use Claude to extract key points if available
    let summary = null;
    if (anthropic && allArticles.length > 0) {
      const articlesText = allArticles.slice(0, 10).map((a: any) =>
        `- ${a.title || a.headline || 'Untitled'}: ${a.description || a.summary || a.content || ''}`.slice(0, 200)
      ).join('\n');

      const claudeRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Extract 3-5 key insights from these news articles relevant to: "${query}"\n\n${articlesText}\n\nReturn a brief bullet-point summary.`,
        }],
      }).catch(() => null);

      if (claudeRes?.content[0]?.type === 'text') {
        summary = claudeRes.content[0].text;
      }
    }

    res.json({
      result: {
        articles: allArticles.slice(0, 15),
        article_count: allArticles.length,
        summary,
        scraped: scraped?.data || null,
        categories_fetched: [
          wantsBlockchain ? 'blockchain' : null,
          wantsTech ? 'tech' : null,
          wantsAI ? 'ai' : null,
        ].filter(Boolean),
      },
      agent: 'WebIntelligence',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[WebIntelligence] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[WebIntelligence] Running on port ${PORT} | Wallet: ${PAY_TO}`);
  registerSelf();
});
