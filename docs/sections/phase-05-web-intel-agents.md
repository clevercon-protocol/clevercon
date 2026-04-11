# Phase 5: Web Intelligence Agents (v1 + v2)

## What Was Built

Two competing news agents, both consuming xlm402.com news endpoints via x402.

### Web Intelligence v1 (`packages/agents/web-intel`, port 4002)
- `src/news.ts` — pays xlm402.com for blockchain, tech, and AI news (3 categories, parallel)
- `src/scraper.ts` — pays xlm402.com to scrape arbitrary URLs ($0.03/call)
- `src/server.ts` — x402-protected `POST /query` at $0.02/call, uses Claude Haiku to extract key insights
- `src/register.ts` — registers as `web-intel-v1` with 6 capabilities

### Web Intelligence v2 (`packages/agents/web-intel-v2`, port 4003)  
- `src/news.ts` — pays xlm402.com for blockchain news only (1 category)
- `src/server.ts` — x402-protected `POST /query` at $0.015/call, raw data no post-processing
- Registers as `web-intel-v2` with 3 capabilities — cheaper but lower quality

## Key Fix
xlm402.com news response uses `data.stories` (not `data.articles`). Updated both servers to handle the correct key.

## Verification Results

| Check | Result |
|---|---|
| `GET /health` (v1 + v2) | 200 OK with wallet addresses |
| `POST /query` without payment (v1 + v2) | HTTP 402 |
| Registry after startup | 4 agents registered (Oracle + WebIntel + WebIntelV2 + PersistBot) |
| Real news fetch | 12 stories returned — "Where Next for Bitcoin After Worst Quarter Since 2018?" from Decrypt |
| Story structure | Title, source name/URL, article URL all present |
| xlm402.com payment | Web Intel wallet paid $0.01 USDC per news category |

## Competitive Dynamic
- v1: $0.02, 6 capabilities, Claude post-processing → higher quality, higher score
- v2: $0.015, 3 capabilities, raw data → cheaper, lower reputation → selection algorithm picks v1
