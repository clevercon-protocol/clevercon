import type { JobResultEnvelope } from '@clevercon/agent-sdk';

/**
 * The GitHub tool: one hireable service with many independently-permissioned
 * functions, built for OS contributors and project maintainers. Read functions
 * (search, list issues, find good-first-issues) are open; write functions (comment,
 * open issue, open PR) need the buyer's GitHub token, which CleverCon stores encrypted
 * and passes to this endpoint as `credentials.github_token`, never to the LLM.
 *
 * Each function's key equals the `action` the CleverCon worker dispatches here.
 */

type Json = Record<string, unknown>;
export interface GithubCtx {
  input: Json;
  /** Satisfied usage-requirement values (e.g. github_token), decrypted server-side. */
  credentials: Record<string, string>;
}
type GithubHandler = (ctx: GithubCtx) => Promise<JobResultEnvelope>;

const GH_API = 'https://api.github.com';
const now = () => Math.floor(Date.now() / 1000);
const ok = (data: unknown): JobResultEnvelope => ({
  ok: true,
  status: 'completed',
  contentType: 'application/json',
  data,
  issuedAt: now(),
});
const fail = (error: string): JobResultEnvelope => ({
  ok: false,
  status: 'failed',
  contentType: 'application/json',
  error,
  issuedAt: now(),
});

/** A single GitHub REST call with the standard headers; returns the parsed JSON. */
async function gh(
  path: string,
  opts: { token?: string; method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; json: Json; message: string }> {
  const res = await fetch(`${GH_API}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'User-Agent': 'clevercon-github-tool',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    json = { raw: text };
  }
  const message = typeof json.message === 'string' ? json.message : res.statusText;
  return { ok: res.ok, status: res.status, json, message };
}

/** Parse "owner/name" into its parts, or null when malformed. */
function splitRepo(v: unknown): { owner: string; repo: string } | null {
  const m = String(v ?? '')
    .trim()
    .match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function clampLimit(v: unknown, dflt: number, max = 30): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(n, max);
}

const tokenOf = (ctx: GithubCtx): string | undefined =>
  ctx.credentials.github_token?.trim() || undefined;
const NEEDS_TOKEN =
  'This action needs your GitHub token. Set up the "GitHub access token" requirement on the service page, then hire again.';

// The issues endpoint also returns PRs; keep only true issues.
const onlyIssues = (arr: Json[]): Json[] => arr.filter((i) => !i.pull_request);
const issueView = (i: Json): Json => ({
  number: i.number,
  title: i.title,
  state: i.state,
  labels: Array.isArray(i.labels) ? i.labels.map((l) => (l as Json).name) : [],
  comments: i.comments,
  url: i.html_url,
  updatedAt: i.updated_at,
});

// ── Read functions (open; use the token when present for private repos + rate limits) ─

const searchRepos: GithubHandler = async ({ input, credentials }) => {
  const query = String(input.query ?? '').trim();
  if (!query) return fail('Provide a `query` to search repositories for.');
  const limit = clampLimit(input.limit, 10);
  const r = await gh(
    `/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}&sort=stars&order=desc`,
    { token: credentials.github_token?.trim() || undefined },
  );
  if (!r.ok) return fail(`GitHub search failed: ${r.message}`);
  const items = Array.isArray(r.json.items) ? (r.json.items as Json[]) : [];
  return ok({
    query,
    count: items.length,
    repos: items.map((x) => ({
      fullName: x.full_name,
      description: x.description,
      stars: x.stargazers_count,
      language: x.language,
      openIssues: x.open_issues_count,
      url: x.html_url,
    })),
  });
};

const getRepo: GithubHandler = async ({ input, credentials }) => {
  const r = splitRepo(input.repo);
  if (!r) return fail('Provide `repo` as "owner/name".');
  const res = await gh(`/repos/${r.owner}/${r.repo}`, {
    token: credentials.github_token?.trim() || undefined,
  });
  if (!res.ok) return fail(`Could not read ${r.owner}/${r.repo}: ${res.message}`);
  const x = res.json;
  return ok({
    fullName: x.full_name,
    description: x.description,
    stars: x.stargazers_count,
    forks: x.forks_count,
    openIssues: x.open_issues_count,
    language: x.language,
    topics: x.topics ?? [],
    defaultBranch: x.default_branch,
    license: (x.license as Json | null)?.spdx_id ?? null,
    url: x.html_url,
  });
};

const listIssues: GithubHandler = async ({ input, credentials }) => {
  const r = splitRepo(input.repo);
  if (!r) return fail('Provide `repo` as "owner/name".');
  const state = ['open', 'closed', 'all'].includes(String(input.state)) ? String(input.state) : 'open';
  const limit = clampLimit(input.limit, 15);
  const labels = input.labels ? `&labels=${encodeURIComponent(String(input.labels))}` : '';
  const res = await gh(
    `/repos/${r.owner}/${r.repo}/issues?state=${state}${labels}&per_page=${limit}`,
    { token: credentials.github_token?.trim() || undefined },
  );
  if (!res.ok) return fail(`Could not list issues for ${r.owner}/${r.repo}: ${res.message}`);
  const arr = Array.isArray(res.json) ? (res.json as unknown as Json[]) : [];
  return ok({ repo: `${r.owner}/${r.repo}`, issues: onlyIssues(arr).map(issueView) });
};

const findGoodFirstIssues: GithubHandler = async ({ input, credentials }) => {
  const limit = clampLimit(input.limit, 15);
  const token = credentials.github_token?.trim() || undefined;
  const r = splitRepo(input.repo);
  // Scoped to one repo when given, else a GitHub-wide search of open issues.
  if (r) {
    const res = await gh(
      `/repos/${r.owner}/${r.repo}/issues?state=open&labels=${encodeURIComponent('good first issue')}&per_page=${limit}`,
      { token },
    );
    if (!res.ok) return fail(`Could not search ${r.owner}/${r.repo}: ${res.message}`);
    const arr = Array.isArray(res.json) ? (res.json as unknown as Json[]) : [];
    return ok({ scope: `${r.owner}/${r.repo}`, issues: onlyIssues(arr).map(issueView) });
  }
  const lang = input.language ? ` language:${String(input.language)}` : '';
  const q = `label:"good first issue" state:open is:issue${lang}`;
  const res = await gh(
    `/search/issues?q=${encodeURIComponent(q)}&per_page=${limit}&sort=updated`,
    { token },
  );
  if (!res.ok) return fail(`Search failed: ${res.message}`);
  const items = Array.isArray(res.json.items) ? (res.json.items as Json[]) : [];
  return ok({
    scope: 'github',
    issues: items.map((i) => ({
      repo: String(i.repository_url ?? '').replace(`${GH_API}/repos/`, ''),
      number: i.number,
      title: i.title,
      labels: Array.isArray(i.labels) ? i.labels.map((l) => (l as Json).name) : [],
      url: i.html_url,
    })),
  });
};

const readPr: GithubHandler = async ({ input, credentials }) => {
  const r = splitRepo(input.repo);
  if (!r) return fail('Provide `repo` as "owner/name".');
  const num = Math.floor(Number(input.number));
  if (!Number.isFinite(num) || num <= 0) return fail('Provide the PR `number`.');
  const res = await gh(`/repos/${r.owner}/${r.repo}/pulls/${num}`, {
    token: credentials.github_token?.trim() || undefined,
  });
  if (!res.ok) return fail(`Could not read PR #${num}: ${res.message}`);
  const x = res.json;
  return ok({
    number: x.number,
    title: x.title,
    state: x.state,
    merged: x.merged,
    author: (x.user as Json | null)?.login ?? null,
    base: (x.base as Json | null)?.ref ?? null,
    head: (x.head as Json | null)?.ref ?? null,
    additions: x.additions,
    deletions: x.deletions,
    changedFiles: x.changed_files,
    url: x.html_url,
  });
};

const me: GithubHandler = async (ctx) => {
  const token = tokenOf(ctx);
  if (!token) return fail(NEEDS_TOKEN);
  const res = await gh('/user', { token });
  if (!res.ok) return fail(`Token check failed: ${res.message}`);
  const x = res.json;
  return ok({ login: x.login, name: x.name, publicRepos: x.public_repos, url: x.html_url });
};

// ── Write functions (need the buyer's token) ──────────────────────────────────

const commentIssue: GithubHandler = async (ctx) => {
  const token = tokenOf(ctx);
  if (!token) return fail(NEEDS_TOKEN);
  const r = splitRepo(ctx.input.repo);
  if (!r) return fail('Provide `repo` as "owner/name".');
  const num = Math.floor(Number(ctx.input.number));
  if (!Number.isFinite(num) || num <= 0) return fail('Provide the issue `number`.');
  const body = String(ctx.input.body ?? '').trim();
  if (!body) return fail('Provide the comment `body`.');
  const res = await gh(`/repos/${r.owner}/${r.repo}/issues/${num}/comments`, {
    token,
    method: 'POST',
    body: { body },
  });
  if (!res.ok) return fail(`Could not comment: ${res.message}`);
  return ok({ commentUrl: res.json.html_url, issue: `${r.owner}/${r.repo}#${num}` });
};

const openIssue: GithubHandler = async (ctx) => {
  const token = tokenOf(ctx);
  if (!token) return fail(NEEDS_TOKEN);
  const r = splitRepo(ctx.input.repo);
  if (!r) return fail('Provide `repo` as "owner/name".');
  const title = String(ctx.input.title ?? '').trim();
  if (!title) return fail('Provide the issue `title`.');
  const labels = Array.isArray(ctx.input.labels)
    ? (ctx.input.labels as unknown[]).map(String)
    : typeof ctx.input.labels === 'string'
      ? String(ctx.input.labels)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  const res = await gh(`/repos/${r.owner}/${r.repo}/issues`, {
    token,
    method: 'POST',
    body: {
      title,
      ...(ctx.input.body ? { body: String(ctx.input.body) } : {}),
      ...(labels?.length ? { labels } : {}),
    },
  });
  if (!res.ok) return fail(`Could not open the issue: ${res.message}`);
  return ok({ number: res.json.number, url: res.json.html_url });
};

const openPr: GithubHandler = async (ctx) => {
  const token = tokenOf(ctx);
  if (!token) return fail(NEEDS_TOKEN);
  const r = splitRepo(ctx.input.repo);
  if (!r) return fail('Provide `repo` as "owner/name".');
  const title = String(ctx.input.title ?? '').trim();
  const head = String(ctx.input.head ?? '').trim();
  const base = String(ctx.input.base ?? '').trim();
  if (!title || !head || !base)
    return fail('Provide `title`, `head` (your branch), and `base` (the target branch).');
  const res = await gh(`/repos/${r.owner}/${r.repo}/pulls`, {
    token,
    method: 'POST',
    body: { title, head, base, ...(ctx.input.body ? { body: String(ctx.input.body) } : {}) },
  });
  if (!res.ok) return fail(`Could not open the PR: ${res.message}`);
  return ok({ number: res.json.number, url: res.json.html_url });
};

/** Action -> handler. Keys match the registered function keys. */
export const GITHUB_HANDLERS: Record<string, GithubHandler> = {
  'github.search_repos': searchRepos,
  'github.get_repo': getRepo,
  'github.list_issues': listIssues,
  'github.find_good_first_issues': findGoodFirstIssues,
  'github.read_pr': readPr,
  'github.me': me,
  'github.comment_issue': commentIssue,
  'github.open_issue': openIssue,
  'github.open_pr': openPr,
};

// ── The registerable manifest (functions carry their own io, requirements, pricing) ──

const repoProp = {
  type: 'string',
  description: 'Target repository as "owner/name", e.g. "stellar/stellar-core".',
};
const schema = (required: string[], properties: Json): Json => ({
  type: 'object',
  ...(required.length ? { required } : {}),
  properties,
});
const perCall = (amount: number) => ({ model: 'per_call' as const, amount, currency: 'USDC' as const });

/** The GitHub connection; write functions reference it by key. Primary path is OAuth
 *  (connect via GitHub's consent screen for a scoped, revocable token); the buyer can
 *  also paste a personal access token as a fallback. Either way it is stored encrypted
 *  and sent only to the GitHub tool, never to the model. */
export const GITHUB_REQUIREMENTS = [
  {
    kind: 'oauth' as const,
    key: 'github_token',
    label: 'GitHub account',
    instructions:
      'Connect your GitHub account so the tool can act on your behalf (read, and with your ' +
      'approval comment and open issues/PRs on public repos). You grant a scoped token through ' +
      'GitHub and can revoke it any time in GitHub settings. No token is ever shown to the AI.',
    secret: true,
  },
];

export const GITHUB_FUNCTIONS = [
  {
    key: 'github.search_repos',
    label: 'Search repositories',
    description: 'Search public repositories by keyword, ranked by stars.',
    input: schema(['query'], {
      query: { type: 'string', description: 'Search terms, e.g. "soroban sdk".' },
      limit: { type: 'number', description: 'Max results (default 10).' },
    }),
    output: schema(['repos'], { repos: { type: 'array' } }),
    pricing: perCall(0.005),
    tier: 'T2' as const,
  },
  {
    key: 'github.get_repo',
    label: 'Get repository',
    description: 'Stars, language, topics, license, and open-issue count for a repository.',
    input: schema(['repo'], { repo: repoProp }),
    output: schema(['fullName'], { fullName: { type: 'string' } }),
    pricing: perCall(0.005),
    tier: 'T2' as const,
  },
  {
    key: 'github.list_issues',
    label: 'List issues',
    description: 'Open (or closed) issues for a repository, optionally filtered by label.',
    input: schema(['repo'], {
      repo: repoProp,
      state: { type: 'string', enum: ['open', 'closed', 'all'] },
      labels: { type: 'string', description: 'Comma-separated labels to filter by.' },
      limit: { type: 'number', description: 'Max results (default 15).' },
    }),
    output: schema(['issues'], { issues: { type: 'array' } }),
    pricing: perCall(0.005),
    tier: 'T2' as const,
  },
  {
    key: 'github.find_good_first_issues',
    label: 'Find good first issues',
    description:
      'Open issues labeled "good first issue", scoped to a repo or searched across GitHub.',
    input: schema([], {
      repo: { type: 'string', description: 'Optional "owner/name" to scope to one repo.' },
      language: { type: 'string', description: 'Optional language filter for the GitHub-wide search.' },
      limit: { type: 'number', description: 'Max results (default 15).' },
    }),
    output: schema(['issues'], { issues: { type: 'array' } }),
    pricing: perCall(0.005),
    tier: 'T2' as const,
  },
  {
    key: 'github.read_pr',
    label: 'Read pull request',
    description: 'State, merge status, diff size, and branches for a pull request.',
    input: schema(['repo', 'number'], {
      repo: repoProp,
      number: { type: 'number', description: 'The PR number.' },
    }),
    output: schema(['number'], { number: { type: 'number' } }),
    pricing: perCall(0.005),
    tier: 'T2' as const,
  },
  {
    key: 'github.me',
    label: 'Verify connection',
    description: 'Confirm the connected GitHub account (checks the token works).',
    input: schema([], {}),
    output: schema(['login'], { login: { type: 'string' } }),
    requires: ['github_token'],
    pricing: perCall(0.005),
    tier: 'T2' as const,
  },
  {
    key: 'github.comment_issue',
    label: 'Comment on an issue',
    description: 'Post a comment on an issue or pull request as you.',
    input: schema(['repo', 'number', 'body'], {
      repo: repoProp,
      number: { type: 'number', description: 'The issue or PR number.' },
      body: { type: 'string', description: 'The comment text (Markdown).' },
    }),
    output: schema(['commentUrl'], { commentUrl: { type: 'string' } }),
    requires: ['github_token'],
    pricing: perCall(0.01),
    tier: 'T2' as const,
  },
  {
    key: 'github.open_issue',
    label: 'Open an issue',
    description: 'Create a new issue in a repository.',
    input: schema(['repo', 'title'], {
      repo: repoProp,
      title: { type: 'string', description: 'The issue title.' },
      body: { type: 'string', description: 'The issue body (Markdown).' },
      labels: { type: 'string', description: 'Comma-separated labels to apply.' },
    }),
    output: schema(['url'], { number: { type: 'number' }, url: { type: 'string' } }),
    requires: ['github_token'],
    pricing: perCall(0.01),
    tier: 'T2' as const,
  },
  {
    key: 'github.open_pr',
    label: 'Open a pull request',
    description: 'Open a pull request from your branch into a base branch.',
    input: schema(['repo', 'title', 'head', 'base'], {
      repo: repoProp,
      title: { type: 'string', description: 'The PR title.' },
      head: { type: 'string', description: 'The branch with your changes.' },
      base: { type: 'string', description: 'The branch to merge into, e.g. "main".' },
      body: { type: 'string', description: 'The PR description (Markdown).' },
    }),
    output: schema(['url'], { number: { type: 'number' }, url: { type: 'string' } }),
    requires: ['github_token'],
    pricing: perCall(0.02),
    tier: 'T2' as const,
  },
];

/** The service-level manifest (endpoint + payout are filled in at registration). */
export const GITHUB_SERVICE = {
  name: 'GitHub Tool',
  description:
    'A GitHub toolbelt for contributors and maintainers: search repos, triage and read ' +
    'issues and PRs, find good-first-issues, and (with your token) comment, open issues, and ' +
    'open pull requests. Each function is priced and permissioned on its own.',
  category: 'Developer Tools',
  capabilities: GITHUB_FUNCTIONS.map((f) => f.key),
  tier: 'T2' as const,
  pricingModel: 'X402' as const,
  pricePerCall: 0.005,
  interaction: 'sync' as const,
  paymentModel: 'escrow' as const,
  verification: { method: 'attest' as const },
  prerequisites: GITHUB_REQUIREMENTS,
  functions: GITHUB_FUNCTIONS,
  contactLinks: {
    github: 'https://github.com/clevercon-protocol/clevercon',
    docs: 'https://clevercon.xyz/docs',
  },
};
