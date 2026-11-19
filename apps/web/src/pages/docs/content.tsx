import type { ReactNode } from 'react';
import {
  Lead,
  P,
  H2,
  H3,
  UL,
  LI,
  Code,
  B,
  A,
  CodeBlock,
  Callout,
  Table,
  Steps,
  Step,
  Cards,
  UseCase,
  Status,
  Flow,
} from './ui';

// All documentation pages. Each page is a small component built from the shared
// primitives; the DOCS registry at the bottom drives the sidebar and routing.
// House style: no em-dashes anywhere, and no competitor is named or compared against.
// Every section carries at least one concrete, relatable use case.

// ── Getting started ─────────────────────────────────────────────────────────

function Introduction() {
  return (
    <>
      <Lead>
        CleverCon lets an AI agent do real things with money for you on Stellar: pay a vendor,
        disburse to many, hire a service, hand it a file to work on, and pay per call for APIs and
        plugins, always strictly within limits you set and enforced on-chain, kept private with
        zero-knowledge or public, your choice, on an account the platform never holds. Paying is the
        base; on top sits an open, ever-growing economy of services, published by anyone, that your
        agent can find, use, and pay for to get real work done.
      </Lead>
      <P>
        You set the rules once (a budget, who it may pay, how much, how often). They are enforced
        on-chain, and you choose whether to keep them private with zero-knowledge or make them
        public; either way the platform never holds your money. So the agent spends on its own and
        can never overspend or pay someone you did not approve, and a private rule never leaks your
        limits. The rules are the guardrail you set once, not the daily work.
      </P>

      <H2 id="do">What you can do</H2>
      <UL>
        <LI>
          <B>Pay one address.</B> A bounded, private payment to a vendor, a provider, or another
          agent.
        </LI>
        <LI>
          <B>Disburse to many.</B> Payroll, contractor batches, grants, or bounties in one
          instruction.
        </LI>
        <LI>
          <B>Hire a service.</B> Data, AI, research, or compute from the directory, paid on accepted
          delivery under your rule.
        </LI>
        <LI>
          <B>Hand a service a file.</B> Attach an image or document to a hire; a service can return
          a processed file you download.
        </LI>
        <LI>
          <B>Pay per call for APIs and plugins.</B> Give your agent a metered capability it pays for
          as it uses it.
        </LI>
        <LI>
          <B>Offer your own service.</B> List an API, a bot, or a skill and earn USDC per use.
        </LI>
      </UL>
      <P>
        Direct payments and disbursements need no service at all; they are the base. Hiring a
        service is that same payment extended to get a task done, paid within the same rule. And the
        set of services is open and ever-growing, not a fixed list: anyone can publish one. Each of
        these works by prompt, in the app, or in code. See{' '}
        <A to="/docs/what-you-can-do">What you can do</A> for every action step by step, with
        snippets.
      </P>

      <UseCase title="A student points an agent at CleverCon to get coursework done">
        They set one private rule: hire only research, data, and file services, at most $1 a job and
        $20 a week. The agent then summarizes a paper, pulls a dataset, and resizes the figures for
        the report, each from a different provider, paying each on delivery. It can never spend over
        $1 a job or $20 a week, never pay a service outside the kinds allowed, and the rule stays
        private the whole time.
      </UseCase>
      <P>
        That is one shape. Because anyone can list a service, the directory is open and the
        categories are countless: price feeds and data, research and analysis, image and document
        processing, trading signals, buying other crypto, freelance development, human work, and
        whatever providers add next. Your agent uses whatever the task needs, finding a fitting
        service if you do not pick one, always inside your rule. And when a task needs no service at
        all, it just pays or disburses directly, for example a team paying three contractors each
        month under a private payroll rule.
      </P>

      <H2 id="who">Who it is for</H2>
      <UL>
        <LI>
          Developers giving an autonomous agent real spending power, who need a hard guarantee it
          can only spend the way they allowed.
        </LI>
        <LI>Teams paying vendors, contractors, or many recipients on a bounded, private policy.</LI>
        <LI>
          Service builders who want to monetize an API or skill that agents can pay for per call.
        </LI>
      </UL>

      <H2 id="lanes">Sovereign by default, fast when you ask</H2>
      <P>
        Every spend is authorized in one of two lanes. Both are bounded on-chain; the private one is
        the default, and you can choose public for speed.
      </P>
      <UL>
        <LI>
          <B>Private (the default).</B> A zero-knowledge proof authorizes the payment against a rule
          only you can see. No server key can move your funds, and the rule never leaves your device
          or agent. Best for anything you would miss: larger, sensitive, or one-off payments.
        </LI>
        <LI>
          <B>Public / Fast.</B> A bounded on-chain session (a cap, a payee allowlist, and an expiry)
          authorizes spends with no per-payment proof, for high-frequency low-value work. Best for
          metered API calls and streaming.
        </LI>
      </UL>

      <H2 id="drive">Three ways to drive it</H2>
      <UL>
        <LI>
          <B>By prompt.</B> Point any MCP agent (Claude Desktop, Cursor, your own) at CleverCon with{' '}
          <Code>@clevercon/mcp</Code> and tell it in plain language what to pay, disburse, or hire.
          It uses the tools within your limits.
        </LI>
        <LI>
          <B>In the app</B> at clevercon.xyz: do any of it by hand (fund, pay, disburse, hire, and
          author rules), or just tell the built-in agent what to do in plain language and approve
          the plan it proposes, watching the job run and the result come back.
        </LI>
        <LI>
          <B>In code</B> with the SDK (<Code>@clevercon/agent-sdk</Code>): pay, disburse, hire, or
          be a paid service in a few lines.
        </LI>
      </UL>

      <Callout kind="note" title="Status">
        CleverCon is live on Stellar testnet. All assets there are test assets with no real-world
        value. Mainnet is gated on an audit and a multi-party trusted setup.
      </Callout>

      <Cards
        items={[
          {
            to: '/docs/what-you-can-do',
            title: 'What you can do',
            desc: 'Pay, disburse, hire, pay per call, and offer a service, by prompt or by hand.',
          },
          {
            to: '/docs/quickstart',
            title: 'Walkthrough',
            desc: 'The full flow end to end: connect, fund, set a rule, then pay or hire.',
          },
          {
            to: '/docs/developer-quickstart',
            title: 'For developers',
            desc: 'Connect an agent over MCP, or embed the SDK.',
          },
          {
            to: '/docs/concepts',
            title: 'Core concepts',
            desc: 'The vault, rules, custody and mode, and the economy.',
          },
        ]}
      />
    </>
  );
}

function WhatYouCanDo() {
  return (
    <>
      <Lead>
        Here is everything you (or your agent) can do with CleverCon, and the two hands-on ways to
        do each: by prompt (an MCP agent or the built-in chat), or by hand in the app. Every action
        is also callable from code; the snippets live in the SDK reference.
      </Lead>

      <H2 id="overview">At a glance</H2>
      <Table
        head={['Action', 'By prompt (an AI agent over MCP)', 'By hand (in the app)']}
        rows={[
          ['Pay one address', '"Pay G... 5 USDC for the logo"', 'Agent tab'],
          ['Disburse to many', '"Split 30 USDC across these three"', 'Disburse tab'],
          ['Hire a service', '"Hire a price oracle with a 2 USDC budget"', 'Services tab'],
          [
            'Hand a service a file',
            '"Resize this image by half" (attach the file)',
            'Services tab, attach on hire',
          ],
          [
            'Pay per call for an API or plugin',
            '"Pay the data API 0.05 for this call"',
            'Vault tab, Agent keys',
          ],
          ['Offer your own service', 'n/a (you run it)', 'Provider console'],
        ]}
      />
      <Callout kind="note">
        Nothing spends until you have funded the vault and pinned at least one rule. That is the
        guardrail, and it is why the steps below always begin there. The{' '}
        <A to="/docs/quickstart">Walkthrough</A> does it all end to end.
      </Callout>

      <H2 id="pay">Pay one address</H2>
      <P>
        A single bounded, private payment to any address you allow: a vendor, a provider, or another
        agent.
      </P>
      <UL>
        <LI>
          <B>By prompt:</B> "Pay G...ALICE 5 USDC for the logo work." The agent calls the tool; you
          set nothing per payment.
        </LI>
        <LI>
          <B>By hand:</B> the Agent tab, pick the rule, enter the payee and amount, approve. The
          proof is made in your browser.
        </LI>
      </UL>

      <H2 id="disburse">Disburse to many</H2>
      <P>
        Pay a whole set of recipients in one instruction (one proof covers up to four), capped per
        payment and in total. Payroll, contractor batches, grants, and bounties.
      </P>
      <UL>
        <LI>
          <B>By prompt:</B> "Split 30 USDC across G...A, G...B, and G...C."
        </LI>
        <LI>
          <B>By hand:</B> the Disburse tab, pick the rule, add the lines, approve.
        </LI>
      </UL>

      <H2 id="hire">Hire a service</H2>
      <P>
        Hire from the directory and pay per step on accepted delivery: data, AI, research, or
        compute. See <A to="/docs/marketplace">Marketplace</A> for the tiers, disputes, and
        reputation.
      </P>
      <UL>
        <LI>
          <B>By prompt:</B> "Find a price-oracle service and hire it with a 2 USDC budget."
        </LI>
        <LI>
          <B>By hand:</B> the Services tab, pick a service, hire it under a rule.
        </LI>
      </UL>

      <H2 id="files">Hand a service a file</H2>
      <P>
        When a service needs a file (an image to resize, a document to parse), attach it to the
        hire. The file is uploaded as a content-addressed reference (the service fetches it and
        verifies its hash), and a service can return a processed file for you to download. Only
        services that declare they accept files show an attach control; the agent asks for the file
        if it is required.
      </P>
      <UL>
        <LI>
          <B>By prompt:</B> "Resize this image by half" with the image attached. In the built-in
          chat an attach button appears when the chosen service takes a file; over MCP the agent
          calls <Code>upload_file</Code> then hires with the reference.
        </LI>
        <LI>
          <B>By hand:</B> the Services tab, pick a file-taking service, attach the file, hire under
          a rule, then download the result from the job.
        </LI>
      </UL>

      <H2 id="metered">Pay per call for an API or plugin</H2>
      <P>
        Give your agent a metered capability (a data API, a model, a tool) that it pays for per use,
        with no signature per call, bounded by a session you authorize once. This is how you plug a
        paid capability into an agent.
      </P>
      <UL>
        <LI>
          <B>By hand:</B> the Vault tab, Agent keys, authorize a session (a cap, an allowlist, an
          expiry).
        </LI>
        <LI>
          <B>By prompt:</B> once the session is live, "Pay the data API 0.05 for this call."
        </LI>
      </UL>

      <H2 id="offer">Offer your own service</H2>
      <P>
        List an API, a bot, or a skill and earn USDC per use. See{' '}
        <A to="/docs/providers">Be a provider</A>.
      </P>

      <H2 id="code">Doing it in code</H2>
      <P>
        Every action above is also a few lines with the SDK (<Code>disbursePrivate</Code>, session
        spenders, <Code>hire</Code>, <Code>createProvider</Code>). The setup and snippets live in{' '}
        <A to="/docs/sdk">the SDK reference</A> and <A to="/docs/mcp">MCP server</A>.
      </P>

      <Callout kind="tip">
        Prefer to watch first? Do it all by hand in the app, then hand the same abilities to an
        agent over MCP or the SDK when you are ready.
      </Callout>
    </>
  );
}

function Concepts() {
  return (
    <>
      <Lead>
        You have seen what CleverCon can do. This page is the model underneath, the vault, rules,
        custody, and the economy, so every surface reads the same way.
      </Lead>

      <H2 id="two-layers">Two layers: payments, and an open economy</H2>
      <P>
        Everything rests on one base: bounded, non-custodial payments from your vault, each
        authorized by a rule. On top of that base sits an open economy of services. The two compose
        cleanly, because hiring a service is just a bounded payment that also gets a task done, so a
        direct payment and a hire carry the exact same guarantees. The economy is permissionless,
        anyone can list a service, so its breadth is open-ended; what the platform fixes is not the
        list of services but the way any of them is reached and paid for safely.
      </P>

      <H2 id="vault">The vault</H2>
      <P>
        The vault is a Soroban contract that holds your USDC non-custodially. You deposit and
        withdraw with your own wallet. It releases a payment only when that payment satisfies a
        rule, and the platform has no key that can move your funds outside your rule. On-chain is
        the source of truth for balances; the app shows a mirror of it.
      </P>

      <H2 id="rules">Rules: private or public</H2>
      <P>
        A rule is the policy a spend must satisfy. Every rule is one of two forms, fixed when it is
        created.
      </P>
      <UL>
        <LI>
          <B>Private.</B> The rule is hidden. Only a commitment (a hash) is pinned on-chain, and
          each payment carries a zero-knowledge proof that it obeys the hidden rule. The ledger
          shows that a payment was allowed without revealing the rule that allowed it.
        </LI>
        <LI>
          <B>Public.</B> The rule is a cleartext scope written on-chain that the contract checks
          directly, with no proof. A public rule is what a session key runs under.
        </LI>
      </UL>
      <P>Both forms share one clause vocabulary:</P>
      <UL>
        <LI>Per-payment maximum, minimum, exact, or range.</LI>
        <LI>Rolling cap over a window (for example $500 per week).</LI>
        <LI>Velocity (at most N payments in a window).</LI>
        <LI>Allowlist of approved payees, with an optional per-payee cap.</LI>
        <LI>Denylist with a threshold.</LI>
        <LI>Calendar window (only within certain times).</LI>
        <LI>Category ceiling (per class of service).</LI>
        <LI>
          Eligibility: which services the agent may hire (allow or deny by service, category, or
          tier). An app-enforced pre-flight filter layered on the spend rules, so a disallowed
          service is never even attempted.
        </LI>
      </UL>

      <H3>How a spend is checked</H3>
      <P>
        Take the research desk rule (allowlist of 5, $100 max, $500 per week). A $60 purchase runs:
      </P>
      <Flow
        steps={[
          { label: 'Agent', sub: 'wants to pay provider C $60' },
          { label: 'Rule check', sub: 'payee allowed, under $100, week total under $500' },
          { label: 'Proof', sub: 'made on your device' },
          { label: 'Vault', sub: 'verifies, releases $60' },
          { label: 'Provider C', sub: 'paid in USDC' },
        ]}
      />
      <P>
        A $120 purchase, or a payment to a provider not on the list, never produces a valid proof,
        so the vault never moves funds and nothing about the rule leaks on-chain. See{' '}
        <A to="/docs/rules">Rules</A> for authoring and pinning.
      </P>

      <H2 id="custody-mode">Custody and mode</H2>
      <P>
        Two choices describe every spend. <B>Mode</B> is how it is authorized: private (a proof that
        hides the rule) or public (a key under a cleartext scope). <B>Custody</B> is who holds the
        secret: self (your device or agent) or server (the platform). They are not fully
        independent: private is always self-custodied, so the server never sees a private rule.
      </P>
      <Table
        head={['Combination', 'Secret held by', 'Rule privacy', 'Best for']}
        rows={[
          [
            'self + private (default)',
            'you (on your device)',
            'private from everyone, including us',
            'anything private or large',
          ],
          [
            'self + public',
            'your agent (a local session key)',
            'public scope',
            'high-frequency work a persistent agent runs',
          ],
          [
            'server + public (Managed Sessions)',
            'the platform (a bounded session key)',
            'public scope',
            'hands-off, metered, low-value',
          ],
        ]}
      />
      <P>
        <B>Managed Sessions</B> is the only secret the platform ever holds: a tight, short, on-chain
        bounded, instantly revocable session key, never a private rule and never a general spend
        key. The combination server + private is deliberately not offered.
      </P>

      <H2 id="globals">Globals</H2>
      <P>
        You may set one optional global rule per lane. A global applies to every spend in its lane
        as an AND on top of whatever rule is selected, so it can only ever tighten, never loosen. A
        common use is an account-wide denylist, or a master weekly cap that sits over every
        individual rule.
      </P>

      <H2 id="tiers">Verification tiers</H2>
      <P>In the service economy, each service declares how its delivery is verified:</P>
      <UL>
        <LI>
          <B>T1 Verifiable:</B> the result is checked trustlessly (re-derived on-chain, a content
          hash, or a signature), so payment releases instantly.
        </LI>
        <LI>
          <B>T2 Attestable:</B> an optimistic release with a dispute window and an advisory score.
        </LI>
        <LI>
          <B>T3 Human:</B> released on your approval or a milestone.
        </LI>
      </UL>

      <H2 id="privacy-scope">What is private, stated honestly</H2>
      <P>
        What stays private is the <B>policy</B>: your caps, allowlist, and limits. Amounts and
        counterparties are still public on the ledger, like any Stellar payment. Hiding those too
        depends on Stellar confidential-token support and is on the roadmap. We state this plainly:
        precision is a feature.
      </P>
    </>
  );
}

function Walkthrough() {
  return (
    <>
      <Lead>
        A practical, end-to-end manual: how everything fits together, in what order, and why. You
        will do it twice, once by hand in the app, once by prompt with an AI agent over MCP, using
        real scenarios you can copy.
      </Lead>

      <H2 id="order">The order, and why</H2>
      <P>
        Every setup follows the same four steps, and the order matters: nothing can spend until a
        rule is pinned, by design. There is no default-allow.
      </P>
      <Flow
        steps={[
          { label: 'Connect', sub: 'your wallet' },
          { label: 'Fund', sub: 'the vault' },
          { label: 'Rule', sub: 'create and pin' },
          { label: 'Spend', sub: 'pay or hire' },
        ]}
      />
      <UL>
        <LI>
          <B>Connect a wallet</B> so you have an identity and a place the funds come from and return
          to. You always hold your own keys.
        </LI>
        <LI>
          <B>Fund the vault</B> so there is a balance to spend from. The vault is a contract that
          holds the money and releases it only within your rules; the platform never holds it.
        </LI>
        <LI>
          <B>Create and pin a rule</B> before any spend. The rule is the guardrail (who, how much,
          how often), and pinning it on-chain is what makes the vault enforce it. Until a rule is
          pinned, every spend is refused.
        </LI>
        <LI>
          <B>Spend or hire</B> within the rule, by hand or by agent. A payment that fits settles;
          one that breaks the rule is refused before any funds move.
        </LI>
      </UL>
      <Callout kind="tip" title="Fast path">
        In a hurry: connect, run the Vault tab testnet quickstart (XLM, trustline, test USDC),
        deposit a few USDC, create a private rule with a $5 cap and one allowlisted address, pin it,
        and pay $3 from the Agent tab. The two walkthroughs below do the same thing in full, with a
        real scenario.
      </Callout>

      <H2 id="dapp">Walkthrough 1: in the app (contractor payroll)</H2>
      <P>
        Scenario: pay three contractors each month, no one else, capped per person and in total, and
        keep the amounts and the roster private.
      </P>
      <Steps>
        <Step n={1} title="Connect your wallet">
          Open clevercon.xyz, Launch app, connect a testnet wallet. You are signed in; the app shows
          your vault, which starts empty.
        </Step>
        <Step n={2} title="Get test funds (Vault tab)">
          Run the testnet quickstart: fund XLM for fees, add the USDC trustline so your wallet can
          hold USDC, and get test USDC. Each is one click, signed by your wallet. You need USDC in
          your wallet before you can put it in the vault.
        </Step>
        <Step n={3} title="Deposit into the vault">
          Deposit, say, 100 USDC. This is the pool the payroll is paid from. The balance is read
          live from the vault on-chain; the platform cannot touch it.
        </Step>
        <Step n={4} title="Create the payroll rule (Rules tab)">
          New rule, Private. Allowlist = your three contractor addresses; per-payee cap = $2,000;
          rolling cap = $20,000 per 30 days. Save (free, no signature). The allowlist means it can
          only ever pay those three; the per-payee cap bounds any one payment; the rolling cap
          bounds the month.
        </Step>
        <Step n={5} title="Pin the rule">
          Pin on-chain (one wallet signature). Only now can the vault authorize a spend under it.
          The rule itself is never published, only a commitment to it.
        </Step>
        <Step n={6} title="Disburse">
          Disburse tab, pick the payroll rule, add the three addresses and amounts, approve. One
          proof is made in your browser and all three are paid in USDC. A fourth payee, or an amount
          over a cap, is refused before anything moves.
        </Step>
      </Steps>
      <P>
        That is the whole loop by hand. The rule is reusable every month, and editing it cleanly
        replaces it as the roster changes.
      </P>

      <H2 id="mcp">Walkthrough 2: by prompt (an AI agent over MCP)</H2>
      <P>
        Scenario: let an assistant (Claude Desktop, Cursor, or your own agent) pay an approved
        address on your instruction, bounded and private. The app setup is the same guardrail; you
        just hand the agent a key so it can spend within the rule without you clicking.
      </P>
      <Steps>
        <Step n={1} title="Do the app setup (once)">
          Connect, fund the vault, and create and pin a private rule, exactly as in walkthrough 1.
          For this scenario: allowlist the one address the agent may pay, per-payment max $5.
        </Step>
        <Step n={2} title="Copy the policy key (Rules tab)">
          On the pinned rule, choose Reveal and copy its policy key (it starts with{' '}
          <Code>ccpk1_</Code>). It packs the rule and its secret salt into one string. This is all
          the agent needs to prove a payment, and it never reveals the rule to anyone, including us.
        </Step>
        <Step n={3} title="Mint an API key (Developer console)">
          Create a scoped API key (<Code>cc_...</Code>). The agent uses it to read your budget and
          activity and to hire services. It cannot move funds on its own.
        </Step>
        <Step n={4} title="Add CleverCon to your MCP client">
          Paste the config into your client (Claude Desktop: Settings, Developer, Edit Config) with
          the policy key set, then restart. Full setup for every lane is in{' '}
          <A to="/docs/mcp">MCP server</A>.
        </Step>
        <Step n={5} title="Prompt the agent">
          Ask it: "Pay G...ALICE 3 USDC for the logo." The agent proves the payment locally against
          your rule and relays only the proof; the vault releases $3. Ask it to pay $8 and it comes
          back refused, with your rule private the whole time.
        </Step>
      </Steps>
      <CodeBlock code={MCP_PRIVATE} title="claude_desktop_config.json" />
      <P>
        For high-frequency, low-value spend (an agent paying a data API per call), use a session key
        instead of a proof per payment; see <A to="/docs/mcp">MCP server</A> for both lanes and{' '}
        <A to="/docs/spending">Spending</A> for when to use each.
      </P>

      <H2 id="hire">Walkthrough 3: hire a service to do a task (by prompt)</H2>
      <P>
        Scenario: resize an image for a report. The setup is the same (connect, fund, pin a rule);
        the difference is the rule allows a service category and the agent gets work done, not just
        moves money. This is the economy, not only a payment.
      </P>
      <Steps>
        <Step n={1} title="Set a rule that allows the service">
          A private rule with eligibility = allow the Media &amp; Files category (or the specific
          service), per-payment max $1, weekly cap $20. Pin it. The agent may only hire what the
          rule allows.
        </Step>
        <Step n={2} title="Attach the file and ask">
          In the built-in chat (or your MCP agent), attach the image and say &quot;resize this by
          half&quot;. The agent finds the image service, proposes a hire under your rule, and you
          approve.
        </Step>
        <Step n={3} title="Watch it run, get the result, pay on delivery">
          A live job card shows the service working, then the resized image to download. On accepted
          delivery the provider is paid under your private rule, keyless, no delegate and no
          per-payment signature. A service outside the allowed category is never attempted.
        </Step>
      </Steps>

      <H2 id="more">Other scenarios</H2>
      <P>The same four steps cover every use case; only the rule changes. A few to copy:</P>
      <UL>
        <LI>
          <B>Metered API budget:</B> a public session with a per-call cap, a velocity limit, and a
          daily cap.
        </LI>
        <LI>
          <B>Subscription:</B> a private rule with an exact amount, a monthly calendar window, and
          velocity 1 per month.
        </LI>
        <LI>
          <B>Agent allowance:</B> a private rule, open payee, with a per-payment cap, a weekly cap,
          and a velocity limit.
        </LI>
        <LI>
          <B>Grants or bounties:</B> a private rule with an allowlist, a per-payee cap, and a
          program total.
        </LI>
        <LI>
          <B>Hire a service to do a task:</B> a rule with a per-job cap, a weekly cap, and
          eligibility limited to the categories or tiers you trust. The agent finds and hires a
          fitting service (data, research, file or image processing) and pays on delivery.
        </LI>
      </UL>
      <P>
        Each is a copyable clause set in <A to="/docs/rules">Rules by example</A>.
      </P>
    </>
  );
}

// ── For users ───────────────────────────────────────────────────────────────

function Vault() {
  return (
    <>
      <Lead>
        Your funds live in a non-custodial vault on Stellar. This page covers getting a test wallet
        ready and moving money in and out.
      </Lead>

      <H2 id="quickstart-card">Testnet quickstart</H2>
      <P>
        On the Vault tab, the quickstart takes a fresh wallet from empty to spendable in three
        self-serve steps, all signed by your own wallet:
      </P>
      <Steps>
        <Step n={1} title="Fund with test XLM">
          A Friendbot top-up gives your wallet test XLM for fees (testnet only).
        </Step>
        <Step n={2} title="Add the USDC trustline">
          One signature lets your wallet hold USDC.
        </Step>
        <Step n={3} title="Get test USDC">
          A small amount of test USDC is swapped from your own XLM on the testnet DEX, so there is
          no shared faucet to run dry. If the DEX has no liquidity, the app links you to a faucet.
        </Step>
      </Steps>

      <H2 id="deposit">Deposit and withdraw</H2>
      <P>
        Deposit USDC into the vault to make it spendable under your rules; withdraw any time with
        your wallet. Deposits and withdrawals are your own wallet-signed transactions, so the
        platform never takes custody.
      </P>
      <P>The Vault tab shows three figures:</P>
      <UL>
        <LI>
          <B>Balance:</B> total USDC held in the vault for you.
        </LI>
        <LI>
          <B>Available:</B> balance minus locked, what you can spend or withdraw now.
        </LI>
        <LI>
          <B>Locked:</B> reserved by active jobs, released when a job finishes.
        </LI>
      </UL>
    </>
  );
}

function RulesDoc() {
  return (
    <>
      <Lead>
        Rules are the limits your agent must obey. You author them once in one builder, and each
        rule is born private or public and keeps that form. This page walks the mechanics, then
        shows real rules you can copy.
      </Lead>

      <H2 id="create">Create a rule</H2>
      <P>
        On the Rules tab, choose New rule, pick the form (private or public), set one or more
        clauses (per-payment cap, rolling cap and window, allowlist, per-payee cap, velocity,
        calendar), and save. Saving is free and takes no signature; it mints the rule and keeps a
        copy on your device.
      </P>

      <H2 id="pin">Pin to go live</H2>
      <P>
        A saved rule is not yet live. <B>Pin it on-chain</B> with one wallet signature to make it
        usable: a private rule pins its commitment, a public rule writes its cleartext clauses.
        Until a rule is pinned, the vault will not authorize a spend under it.
      </P>

      <H2 id="examples">Rules by example</H2>
      <P>Five rules that cover most needs. Set them on the Rules tab with exactly these clauses.</P>

      <UseCase label="Private" title="Contractor payroll">
        Pay a fixed roster of contractors, no one else, capped per person and in total each month.
        <br />
        Clauses: allowlist = your contractors; per-payee cap = $2,000; rolling cap = $20,000 per 30
        days. Spend with a private disburse (one proof pays up to four at once).
      </UseCase>

      <UseCase label="Public / Fast" title="Metered API budget">
        Let an agent call a paid data API all day without a signature per call, bounded tightly.
        <br />
        Clauses: allowlist = the API payout address; per-payment max = $0.05; velocity = 1,000 per
        day; rolling cap = $40 per day. Run it as a session key (Fast lane).
      </UseCase>

      <UseCase label="Private" title="Subscription">
        Pay one vendor the same amount on a schedule, and nothing off-schedule.
        <br />
        Clauses: allowlist = the vendor; exact amount = $20 (set min equal to max); calendar =
        monthly; velocity = 1 per month.
      </UseCase>

      <UseCase label="Private" title="Agent allowance">
        A general, bounded wallet for an agent to spend as it sees fit, within hard limits.
        <br />
        Clauses: open payee (no allowlist); per-payment max = $10; rolling cap = $200 per week;
        velocity = 50 per week.
      </UseCase>

      <UseCase label="Private" title="Grant or bounty disbursement">
        Pay approved recipients up to a fixed amount each, with a hard program total.
        <br />
        Clauses: allowlist = recipients; per-payee cap = $500; rolling cap = $5,000 per 90 days.
      </UseCase>

      <UseCase label="Private" title="A service budget for an agent">
        Let an agent hire services to get work done, but only the kinds you trust, capped per job
        and per week.
        <br />
        Clauses: eligibility = allow certain categories (for example Data &amp; Oracles, Media &amp;
        Files) or specific services, allowed tiers = T1 and T2; per-payment max = $1; rolling cap =
        $25 per week. The agent discovers and hires within this; a service outside the allowed set
        is never even attempted.
      </UseCase>

      <H2 id="edit">Editing replaces the rule</H2>
      <P>
        A rule is a hash of its clauses, so it cannot be mutated in place. Editing is a clean
        replace: on save, the old version is removed on-chain (its commitment unpinned, or its
        public rule cleared) and archived, and a fresh rule is created for you to pin. That keeps
        exactly one live version and leaves no orphan that could still authorize a spend.
      </P>
      <Callout kind="note" title="Orphaned pins">
        If you edited a rule before this behavior existed, its old commitment may still be pinned
        on-chain. The Rules tab surfaces any such orphan with a one-click Unpin.
      </Callout>

      <H2 id="globals">Make a rule global</H2>
      <P>
        Mark a rule as the global for its lane to apply it on top of every spend in that lane (an
        AND filter). For example, keep your payroll and allowance rules separate, but set a
        global-private denylist so neither can ever pay a sanctioned address. There is at most one
        global-private and one global-public, each set and cleared by a wallet signature.
      </P>

      <H2 id="keys">Rule keys</H2>
      <P>
        To let an agent spend under a rule, you hand it a single opaque key copied from the rule,
        with no raw secrets shown:
      </P>
      <UL>
        <LI>
          A private rule reveals a <B>policy key</B> (<Code>ccpk1_...</Code>) that packs the rule
          and its salt. It is also backed up encrypted under your wallet so you can re-reveal it on
          any device.
        </LI>
        <LI>
          A public rule reveals a <B>rule key</B> (<Code>ccrk1_...</Code>), just an addressable id,
          since the clauses are already public on-chain.
        </LI>
      </UL>
      <P>
        See <A to="/docs/config-keys">Config keys</A> for how an agent consumes these.
      </P>
    </>
  );
}

const SDK_DISBURSE = `import { createSpender } from '@clevercon/agent-sdk/spender';

// CLEVERCON_POLICY_KEY (from the payroll rule) is set in the agent's env.
const cc = createSpender({ apiKey: process.env.CLEVERCON_API_KEY! });

// One proof pays up to four contractors at once.
await cc.disbursePrivate([
  { payee: 'G...ALICE', amount: 2000 },
  { payee: 'G...BOB', amount: 1500 },
  { payee: 'G...CAROL', amount: 1800 },
]);`;

const SDK_SESSION_PAY = `import { createSessionSpender } from '@clevercon/agent-sdk/sessions';

// The agent holds only the session key (CLEVERCON_SESSION_SECRET).
const spender = createSessionSpender(process.env.CLEVERCON_SESSION_SECRET!);

// Pay the API per call, no per-payment proof, instant, bounded on-chain.
await spender.pay('G...DATA_API', 0.05);
const { remaining } = await spender.scope(); // watch the budget`;

function Spending() {
  return (
    <>
      <Lead>
        How an agent actually spends, in the app and in code, with a worked example for each lane.
      </Lead>

      <H2 id="private">Private spend (default)</H2>
      <P>
        A payment is proven locally against your pinned private rule and only the proof is relayed.
        No key signs it, and the server never sees your rule. In the app this is the Agent and
        Disburse flows; one proof can authorize up to four payees at once.
      </P>
      <UseCase title="Pay three contractors from payroll">
        In the app: Disburse tab, pick the payroll rule, add the three addresses and amounts,
        approve. One in-browser proof pays all three. Programmatically, the same thing:
      </UseCase>
      <CodeBlock code={SDK_DISBURSE} lang="ts" />
      <P>
        Over MCP the agent calls <Code>disburse_private</Code> with the same lines; see{' '}
        <A to="/docs/mcp">MCP server</A>.
      </P>

      <H2 id="public">Public / Fast spend</H2>
      <P>
        A bounded on-chain session (cap, allowlist, expiry) authorizes spends with no per-payment
        proof, for high-frequency low-value work. The owner authorizes the session once; the agent
        runs with only the session key.
      </P>
      <UseCase title="An agent pays a data API per call">
        You authorize a session on the Vault tab (Agent keys): cap $40, allowlist the API address,
        expiry 7 days, bound to the metered-API rule. The agent then pays per call with no prompt:
      </UseCase>
      <CodeBlock code={SDK_SESSION_PAY} lang="ts" />

      <H2 id="managed">Managed Sessions (hands-off)</H2>
      <P>
        A Managed Session is a bounded key the platform signs with, hands-off, within a scope you
        set once on the Vault tab (a spend cap, a payee allowlist, an expiry, and one of your public
        rules). It is enforced on-chain and revocable in one click. Best for hands-off, low-value,
        or metered spending where you are not present to run an agent yourself.
      </P>

      <H2 id="agent-wallet">Agent-key mode (external services)</H2>
      <P>
        To reach services outside CleverCon, the vault tops up your agent's own wallet in small,
        policy-bounded amounts, and the agent pays those services itself with that balance. The
        vault bounds the allowance; the agent chooses the counterparty beyond the cap.
      </P>

      <Callout kind="tip" title="Which lane?">
        Use private for anything you would miss (payroll, grants, larger or one-off payments). Use a
        public session for high-frequency low-value work (metered APIs, streaming). Use a Managed
        Session when you want it hands-off without running your own agent.
      </Callout>
    </>
  );
}

function Marketplace() {
  return (
    <>
      <Lead>
        Beyond paying addresses, CleverCon is an economy: a directory of services an agent can hire
        and pay per use, with trust backed by verification, disputes, and settlement-earned
        reputation. This is where a bounded, private spending account becomes genuinely useful: your
        agent can go out and get work done.
      </Lead>

      <H2 id="participants">Who takes part</H2>
      <UL>
        <LI>
          <B>Buyers</B> fund a vault and let an agent hire and pay for work, all within a private
          rule.
        </LI>
        <LI>
          <B>Providers</B> list a service (an API, a model, a skill, or human work) and earn USDC
          per accepted job. See <A to="/docs/providers">Be a provider</A>.
        </LI>
        <LI>
          <B>Agents</B> are the ones doing the hiring and paying, over the app, the SDK, or MCP.
        </LI>
      </UL>

      <H2 id="open">An open directory, not a fixed list</H2>
      <P>
        Anyone can publish a service, so the directory is open and ever-growing. There is no closed
        menu of what CleverCon does; what varies is three independent things:
      </P>
      <UL>
        <LI>
          <B>Who provides it:</B> a person, a bot, an API, or an x402 / MPP endpoint.
        </LI>
        <LI>
          <B>How it runs:</B> instant, long-running, needs-input, human (approval), or metered (see
          interaction shapes below).
        </LI>
        <LI>
          <B>What it does:</B> any category a provider invents, trading signals, buying other
          crypto, research for a student, file and image processing, freelance development, data
          feeds, and more. These are examples, not the boundary.
        </LI>
      </UL>
      <P>
        Your agent finds a fitting service (or you pick one yourself), gets the task done, and pays
        for it within your rule. Hiring is an extension of the same bounded payment, so the
        guarantees are identical whether you pay an address directly or hire a service.
      </P>

      <H2 id="hire">Hiring a service</H2>
      <P>Hiring runs the same bounded, pay-on-accepted-delivery flow every time:</P>
      <Flow
        steps={[
          { label: 'Discover', sub: 'search the directory' },
          { label: 'Hire', sub: 'under your rule' },
          { label: 'Deliver', sub: 'provider does the work' },
          { label: 'Verify', sub: 'by the tier' },
          { label: 'Pay', sub: 'under your rule, on delivery' },
        ]}
      />
      <P>
        You pay only for delivery that is accepted under the service's verification. A
        dispute-bearing (T2) step is paid only after its window passes, and a human (T3) step only
        on your approval, so the window and the approval gate the payment; anything held and not
        accepted is not paid.
      </P>

      <H2 id="pay">How a hire is paid</H2>
      <P>
        A hire pays the provider through the <B>same path your rule already uses</B>, only after
        delivery is accepted. There is nothing extra to set up beyond the rule you picked.
      </P>
      <UL>
        <LI>
          <B>Private rule:</B> the payment is proven in your browser and released keyless (a
          zero-knowledge proof authorizes it, a fee-payer only submits it), exactly like a private
          disburse to the provider's payout address. No per-payment signature.
        </LI>
        <LI>
          <B>Public rule:</B> the provider is paid hands-off under your Managed Session.
        </LI>
      </UL>
      <P>
        A task that hires several providers at once (a multi-step hire) pays them together under the
        one rule. Settlement is recorded against the step, so the provider's earnings attribute to
        the exact job.
      </P>

      <H2 id="shapes">Interaction shapes</H2>
      <P>Services differ in how they run, and the agent handles each uniformly:</P>
      <UL>
        <LI>
          <B>Immediate (sync):</B> request in, result out.
        </LI>
        <LI>
          <B>Long-running (async):</B> returns a job handle; the agent tracks progress and fetches
          the result when it is ready.
        </LI>
        <LI>
          <B>Needs input mid-job:</B> the job pauses to ask a typed question; the agent answers from
          context or asks you, and the answer resumes the job.
        </LI>
        <LI>
          <B>Human (T3):</B> held until you approve the delivered work.
        </LI>
        <LI>
          <B>Metered / streaming:</B> pay per call or per token on the Fast lane.
        </LI>
      </UL>

      <H2 id="tiers">Verification tiers, by example</H2>
      <P>Each service declares how its result is accepted, which sets how fast it is paid.</P>
      <UseCase label="T1 Verifiable" title="A price oracle">
        An agent hires a price feed for 0.05 USDC. The result is re-derived and checked against the
        ledger, so it is accepted and paid instantly, trustlessly, no waiting.
      </UseCase>
      <UseCase label="T2 Attestable" title="A research summarizer">
        An agent pays 0.50 USDC to summarize a document. The output releases after a short dispute
        window, with an advisory quality score; if it is wrong, the buyer disputes before release.
      </UseCase>
      <UseCase label="T3 Human" title="A commissioned contribution">
        A team commissions a design or an open-source contribution for 200 USDC. Payment is held and
        released only when the buyer approves the delivered work or a milestone is met.
      </UseCase>

      <H2 id="disputes">Disputes and reputation</H2>
      <P>
        A buyer can open a dispute on a job; the provider responds, and an arbiter settles it,
        splitting the locked remainder between refund and payout. Reputation is settlement-gated: it
        is built from real settled jobs, unique payers, and dispute rate, not self-reported stars,
        so it is hard to fake and it drives discovery. A provider that is more verifiable (T1) is
        paid instantly and ranks higher, which is the incentive to be checkable.
      </P>

      <H2 id="metered">The metered-pay rail (x402 / MPP)</H2>
      <P>The same economy extends to metered, pay-per-call services in two directions.</P>
      <UL>
        <LI>
          <B>Consume</B> <Status kind="dev" />: the vault tops up an agent wallet under your rule,
          and the agent pays external metered endpoints per call or per token with that balance.
        </LI>
        <LI>
          <B>Offer</B> <Status kind="soon" />: expose a CleverCon service over the metered rail so
          any agent, including ones not on CleverCon, can pay it, with the verification and
          reputation of the directory attached.
        </LI>
      </UL>

      <H2 id="status">What is live, and where this is going</H2>
      <P>The directory is honest about maturity. Stated plainly:</P>
      <Table
        head={['Capability', 'Status']}
        rows={[
          [<>Hire a registered service, pay per step under a rule</>, <Status kind="live" />],
          [<>Verification tiers (T1 / T2 / T3) and acceptance checks</>, <Status kind="live" />],
          [
            <>Disputes (open, respond, settle) and settlement-gated reputation</>,
            <Status kind="live" />,
          ],
          [<>Provider registration and payout-ownership proof</>, <Status kind="live" />],
          [<>Consume external metered (x402 / MPP) services under policy</>, <Status kind="dev" />],
          [
            <>Offer CleverCon services over the metered rail (facilitator)</>,
            <Status kind="soon" />,
          ],
          [<>Provider bonds (a slashable stake that lifts ranking)</>, <Status kind="soon" />],
          [<>A richer directory (filter by trust, tier, bond, price)</>, <Status kind="soon" />],
        ]}
      />
      <P>
        The direction is an agent capability marketplace: list a bot, an API, or a skill once, and
        every agent can hire it and pay per use, bounded and private, with trust earned through real
        settlements.
      </P>

      <Callout kind="note" title="Want to offer a service?">
        See <A to="/docs/providers">Be a provider</A> to list a service agents can hire and pay.
      </Callout>
    </>
  );
}

// ── For developers ──────────────────────────────────────────────────────────

const MCP_PRIVATE = `{
  "mcpServers": {
    "clevercon": {
      "command": "npx",
      "args": ["-y", "@clevercon/mcp"],
      "env": {
        "CLEVERCON_POLICY_KEY": "ccpk1_...from the Rules tab",
        "CLEVERCON_API_KEY": "cc_...from the Developer console"
      }
    }
  }
}`;

const SDK_PRIVATE = `import { createSpender } from '@clevercon/agent-sdk/spender';

const cc = createSpender({
  apiKey: process.env.CLEVERCON_API_KEY!,            // reads/config
  policyBundle: JSON.parse(process.env.CLEVERCON_POLICY_JSON!), // { rules, salt }
});

await cc.disbursePrivate([{ payee: 'G...A', amount: 2 }]);`;

function DeveloperQuickstart() {
  return (
    <>
      <Lead>
        Give your agent a bounded, non-custodial spending account in a couple of minutes over MCP,
        or a few lines with the SDK. The limits you set in the app are enforced on-chain regardless
        of how the agent calls.
      </Lead>

      <H2 id="pick">Pick a lane</H2>
      <UL>
        <LI>
          <B>Private (self-custody, trustless).</B> Your agent proves your hidden rule locally and
          relays only the proof. Provide a policy key.
        </LI>
        <LI>
          <B>Public / Fast.</B> Your agent spends through a bounded session key with no per-payment
          proof. Provide a session key (local), or use a Managed Session (server).
        </LI>
      </UL>

      <H2 id="mcp">Connect over MCP</H2>
      <P>Create a rule in the app, copy its policy key, and add CleverCon to your MCP client:</P>
      <CodeBlock code={MCP_PRIVATE} title="claude_desktop_config.json" />
      <P>
        Restart the client and your agent has the CleverCon tools. Then just ask it, for example:{' '}
        <B>"Pay G...ALICE 2 USDC for the logo work."</B> Full tool list and config in{' '}
        <A to="/docs/mcp">MCP server</A>.
      </P>

      <H2 id="sdk">Embed the SDK</H2>
      <CodeBlock code={`npm install @clevercon/agent-sdk`} lang="bash" />
      <CodeBlock code={SDK_PRIVATE} lang="ts" />
      <P>
        Full surface (sessions, receipts, provider, agent-wallet) in{' '}
        <A to="/docs/sdk">the SDK reference</A>.
      </P>

      <Cards
        items={[
          {
            to: '/docs/mcp',
            title: 'MCP server',
            desc: 'The 16 tools, the two lanes, and config.',
          },
          {
            to: '/docs/sdk',
            title: 'SDK reference',
            desc: 'createSpender, sessions, receipts, provider.',
          },
          {
            to: '/docs/config-keys',
            title: 'Config keys',
            desc: 'Policy key, session key, and rule key.',
          },
          {
            to: '/docs/providers',
            title: 'Be a provider',
            desc: 'Build, list, and earn from a service agents can hire. A full guide.',
          },
        ]}
      />
    </>
  );
}

const MCP_LOCAL = `{
  "mcpServers": {
    "clevercon": {
      "command": "npx",
      "args": ["-y", "@clevercon/mcp"],
      "env": {
        "CLEVERCON_PUBLIC_MODE": "local",
        "CLEVERCON_SESSION_SECRET": "S...your session key secret"
      }
    }
  }
}`;

function Mcp() {
  return (
    <>
      <Lead>
        <Code>@clevercon/mcp</Code> gives any MCP client a bounded, non-custodial Stellar spending
        account. Run it on demand with <Code>npx -y @clevercon/mcp</Code>; requires Node 18+.
      </Lead>

      <H2 id="setup">Setup, step by step</H2>
      <P>
        Two minutes: get what your lane needs from the app, add one config block, restart. For the
        fastest, most reliable start, install the package once and point your client at the
        installed <Code>clevercon-mcp</Code>. A plain <Code>npx -y</Code> cold start downloads a
        large dependency set and can exceed an MCP client's startup timeout on first run.
      </P>
      <Steps>
        <Step n={1} title="Fund the vault">
          Connect a wallet and fund the vault (Vault tab testnet quickstart). The agent spends from
          this balance; see the <A to="/docs/quickstart">Walkthrough</A>.
        </Step>
        <Step n={2} title="Get the key(s) your lane needs">
          Private lane: create and pin a private rule (Rules tab), choose Reveal, copy its policy
          key (<Code>ccpk1_</Code>), and mint an API key (<Code>cc_...</Code>) in the Developer
          console (needed for the keyless relay and for hiring / reads). Public local: on the Vault
          tab under Agent keys, authorize a session and copy its session secret (<Code>S...</Code>);
          add an API key only to also hire / read / discover. Public server: on the Vault tab enable
          a Managed Session and mint an API key. See the lane table below for exactly what each
          needs.
        </Step>
        <Step n={3} title="Add the config and restart">
          Paste the matching block below into your MCP client (Claude Desktop: Settings, Developer,
          Edit Config; Cursor: MCP settings), then restart it.
        </Step>
        <Step n={4} title="Verify">
          Ask the agent for your budget, then make a small bounded payment. A payment that breaks
          your rule comes back refused.
        </Step>
      </Steps>

      <Callout kind="warn" title="Node version and first run">
        The client runs the server with whatever Node is first on its PATH, which may be older than
        your terminal's. Node 18+ is required; if the server stays stuck on "connecting" with no
        tools, set <Code>command</Code> to an absolute Node 18+ path (for example a full{' '}
        <Code>.nvm/versions/node/v20.x/bin/npx</Code>). The first <Code>npx</Code> run also
        downloads a large dependency set and can take a few minutes, so for a fast, reliable start
        install the package once and point at the installed <Code>clevercon-mcp</Code>. After
        editing config env, fully restart the client; the running server keeps its old environment.
      </Callout>

      <H2 id="lanes">The lanes, and their config</H2>
      <P>
        You configure your agent with the rule it spends under, the same way you pick a pinned rule
        in the app. Pick a lane, set the one or two values it needs, and the vault enforces the
        rest. You do <B>not</B> set an API URL (it defaults to the live API;{' '}
        <Code>CLEVERCON_API_URL</Code> is only for self-hosting), and the vault and USDC asset
        default to the live testnet contracts.
      </P>
      <Callout kind="warn" title="Every spend runs under a rule you set (fail closed)">
        A spend is always bound by a rule: your configured private rule, your configured public
        rule, or the session you authorized. If none is configured, the spend is <B>refused</B>,
        never run under a throwaway. For a private rule, if a global-private rule is enabled on your
        account you must also set <Code>CLEVERCON_GLOBAL_KEY</Code>. For public, the global rule is
        already on-chain, so you never set it.
      </Callout>
      <Table
        head={['Lane', 'Set', 'API key?']}
        rows={[
          [
            <B>Private (keyless)</B>,
            <>
              <Code>CLEVERCON_POLICY_KEY</Code> (your rule), plus <Code>CLEVERCON_GLOBAL_KEY</Code>{' '}
              if a global-private rule is enabled
            </>,
            'Yes',
          ],
          [
            <B>Public, local</B>,
            <>
              <Code>CLEVERCON_SESSION_SECRET</Code> (a session key you hold)
            </>,
            'Only to also hire / read / discover',
          ],
          [
            <B>Public, server</B>,
            <>
              <Code>CLEVERCON_PUBLIC_MODE=server</Code> + <Code>CLEVERCON_API_KEY</Code> (a Managed
              Session set up in the app)
            </>,
            'Yes',
          ],
        ]}
      />
      <Callout kind="note" title="When is the API key needed?">
        The <Code>cc_...</Code> API key authenticates your account to the hosted API, so it is
        needed for discovery, hiring, reading budget / activity, limits, disputes, the private
        keyless relay, and a Managed Session. The one case that does <B>not</B> need it is the fully
        local public session (<Code>session_pay</Code> / <Code>session_scope</Code> with your own
        session key), which signs and submits to the chain itself. In practice: set the API key
        unless you only use the local session lane.
      </Callout>
      <Callout kind="warn" title="Your keys are spend authority">
        The policy key, session secret, and API key can each move funds within your rule. They live
        in your MCP client config (for example <Code>.mcp.json</Code>), so keep that file out of
        version control (<Code>.gitignore</Code> it) and do not share it. Connected-account secrets
        (like a GitHub token) are different: they are brokered server-side and never placed in your
        config or shown to the model.
      </Callout>
      <H3>Private (self-custody, keyless)</H3>
      <P>
        The policy key packs your rule and its salt; the agent proves locally and relays only the
        proof. The same rule also bounds your <B>hires</B>: a hire binds it (matched to your pinned
        rule on-chain), exactly like picking a rule in the app, and a hire with no rule configured
        is refused, never run under a throwaway. Set <Code>CLEVERCON_POLICY_ID</Code> to bind a rule
        by id directly, or <Code>CLEVERCON_GLOBAL_KEY</Code> when a global-private rule is enabled.
      </P>
      <CodeBlock code={MCP_PRIVATE} title="private" />
      <H3>Public, local (the agent holds a session key)</H3>
      <P>
        The default mode. The agent signs bounded spends with its own session key, no proof per
        payment, and the session's cap, expiry, and rule (plus the on-chain global public rule) are
        enforced by the vault. Add <Code>CLEVERCON_API_KEY</Code> to also hire, read, and discover.
      </P>
      <CodeBlock code={MCP_LOCAL} title="public local" />
      <H3>Public, server (Managed Session)</H3>
      <P>
        Set <Code>CLEVERCON_PUBLIC_MODE=server</Code> and <Code>CLEVERCON_API_KEY</Code>; the
        platform signs within the on-chain scope you set in the app.
      </P>

      <H2 id="tools">Tools</H2>
      <Table
        head={['Group', 'Tools']}
        rows={[
          [
            'Discover',
            <>
              <Code>search_services</Code>, <Code>get_service</Code>
            </>,
          ],
          [
            'Spend, private',
            <>
              <Code>disburse_private</Code> (self-custody, keyless, up to 4 payees)
            </>,
          ],
          [
            'Spend, public',
            <>
              <Code>session_pay</Code>, <Code>session_scope</Code>
            </>,
          ],
          [
            'Hire',
            <>
              <Code>hire_agent</Code>, <Code>settle_task</Code>
            </>,
          ],
          [
            'Files',
            <>
              <Code>upload_file</Code> (attach a local path, a URL, or bytes to a hire)
            </>,
          ],
          [
            'Limits',
            <>
              <Code>set_limit</Code>, <Code>list_limits</Code>
            </>,
          ],
          [
            'State',
            <>
              <Code>get_budget</Code>, <Code>get_activity</Code>, <Code>list_tasks</Code>,{' '}
              <Code>get_task</Code>
            </>,
          ],
          [
            'Lifecycle',
            <>
              <Code>dispute_task</Code>, <Code>approve_task</Code>, <Code>answer_step</Code> (reply
              when a job asks for input)
            </>,
          ],
        ]}
      />

      <H3>How a hire pays the provider</H3>
      <P>
        A hire pays the provider the same way a direct spend does, and only AFTER delivery:{' '}
        <Code>hire_agent</Code> waits for the service to deliver, then pays under your rule, keyless
        for a private rule (a local proof relayed to the vault, the same rail as{' '}
        <Code>disburse_private</Code>) or via your Managed Session for a public rule. It returns the
        result and the settlement. Set <Code>wait: false</Code> to return immediately, then pay
        later with <Code>settle_task</Code> (also how you retry a settlement, or pay a long or held
        job once it is accepted). The provider is never paid up front and never paid for a
        non-delivery.
      </P>
      <Callout kind="note" title="Private spend is keyless by default (no artifacts needed)">
        <Code>disburse_private</Code> and a private hire release <B>keyless</B>: the vault verifies
        the proof on-chain, so the default path needs no local wasm/zkey. The circuit and poseidon
        artifacts (<Code>CLEVERCON_PP2_*</Code>) download automatically only when your rule needs
        them (an allowlist, deny-list, calendar, or category); you set them only to pin local files.
        A failed private spend is almost never a missing-artifact problem.
      </Callout>

      <H3>Attaching a file to a hire</H3>
      <P>
        When a service accepts a file, the agent calls <Code>upload_file</Code> with a local path, a
        URL, or inline bytes, gets back a content-addressed reference, then hires with it. The
        provider fetches the file and verifies its hash, and any file it returns comes back on the
        job for you to download. Clients with native file upload (for example the Claude desktop
        apps) can pass the file straight through.
      </P>

      <H2 id="prompts">Example prompts</H2>
      <P>Once connected, you drive it in natural language:</P>
      <UL>
        <LI>"Pay G...ALICE 2 USDC for the logo work, privately." (private lane)</LI>
        <LI>"Split 30 USDC across these three addresses." (private disburse, one proof)</LI>
        <LI>"Pay the data API 0.05 for this call." (public session)</LI>
        <LI>"What is my remaining session budget?" (session_scope)</LI>
        <LI>"Find a price-oracle service and hire it with a 2 USDC budget." (hire)</LI>
        <LI>"Resize this image by half." (upload_file, then hire a file-taking service)</LI>
      </UL>

      <Callout kind="warn" title="Retired tools">
        The legacy <Code>pay</Code> and <Code>disburse</Code> tools (a managed server-signed path)
        are retired. Use <Code>disburse_private</Code> for private self-custody spend, or{' '}
        <Code>session_pay</Code> for the public lane.
      </Callout>
    </>
  );
}

const SDK_SESSIONS = `import { registerSession, createSessionSpender } from '@clevercon/agent-sdk/sessions';

// Owner: authorize a bounded session once (the metered-API budget)
const { sessionSecret } = await registerSession({
  ownerSecret: process.env.OWNER_SECRET!,
  spendCap: 40,
  allowlist: ['G...DATA_API'],
  expirySecs: 7 * 24 * 3600,
});

// Agent: spend with ONLY the session key, per call, no proof
const spender = createSessionSpender(sessionSecret);
await spender.pay('G...DATA_API', 0.05);
const scope = await spender.scope(); // remaining budget, allowlist, expiry`;

const SDK_ENV = `CLEVERCON_API_KEY=cc_...          # reads, hire, config
CLEVERCON_POLICY_KEY=ccpk1_...    # private lane: packs your rule + salt
# CLEVERCON_SESSION_SECRET=S...   # public lane: a session key you hold`;

function Sdk() {
  return (
    <>
      <Lead>
        <Code>@clevercon/agent-sdk</Code> is the programmatic surface: a spending account in two
        lanes, plus the tools to be a paid service. ESM-only, Node 18+.
      </Lead>
      <CodeBlock code={`npm install @clevercon/agent-sdk`} lang="bash" />

      <H2 id="setup">Setup</H2>
      <P>Two one-time things from the app: the funds, and the key for your lane.</P>
      <Steps>
        <Step n={1} title="Fund the vault and pin a rule">
          In the app, fund the vault and create and pin a rule (see the{' '}
          <A to="/docs/quickstart">Walkthrough</A>). Nothing spends until a rule is pinned.
        </Step>
        <Step n={2} title="Get your keys">
          Private: Reveal the rule's policy key (<Code>ccpk1_</Code>) on the Rules tab. Public:
          authorize a session on the Vault tab and copy its secret, or mint one in code with{' '}
          <Code>registerSession</Code>. For reads, hire, and the server path, mint an API key (
          <Code>cc_...</Code>) in the Developer console. Full list in{' '}
          <A to="/docs/config-keys">Config keys</A>.
        </Step>
        <Step n={3} title="Set them in the environment">
          Provide only the ones your lane uses, then call the SDK.
        </Step>
      </Steps>
      <CodeBlock code={SDK_ENV} title=".env" />

      <H2 id="private">Private spend</H2>
      <P>
        <Code>createSpender().disbursePrivate</Code> proves your hidden policy locally and relays
        only a proof. One proof authorizes up to four payees. Here is the contractor payroll
        example:
      </P>
      <CodeBlock code={SDK_DISBURSE} lang="ts" />
      <P>
        Provide the policy with <Code>policyBundle</Code> in options or{' '}
        <Code>CLEVERCON_POLICY_KEY</Code> in the env. Reads and config stay on the spender:{' '}
        <Code>getBudget()</Code>, <Code>getActivity()</Code>, <Code>setLimit()</Code>,{' '}
        <Code>listLimits()</Code>, <Code>hire()</Code>. The legacy <Code>pay</Code> and{' '}
        <Code>disburse</Code> are retired and throw.
      </P>

      <H2 id="public">Public / Fast spend</H2>
      <P>
        The <Code>@clevercon/agent-sdk/sessions</Code> subpath mints and spends a bounded session
        key. The owner registers it once; the agent runs with only the key, signing directly against
        Soroban. Here is the metered-API example:
      </P>
      <CodeBlock code={SDK_SESSIONS} lang="ts" />

      <H2 id="receipts">Receipts</H2>
      <P>
        <Code>receipt(...)</Code> from <Code>@clevercon/agent-sdk/receipts</Code> decodes a settled
        transaction to show the authorizer, a session key (public) or a ZK proof (private), so you
        can confirm which lane actually ran.
      </P>

      <H2 id="more">More surfaces</H2>
      <UL>
        <LI>
          <Code>createProvider</Code>: be a paid service the marketplace hires. See{' '}
          <A to="/docs/providers">Be a provider</A>.
        </LI>
        <LI>
          <Code>createAgentWallet</Code>: top up the agent's own wallet from the vault and pay
          external metered services.
        </LI>
      </UL>
    </>
  );
}

function ConfigKeys() {
  return (
    <>
      <Lead>
        An agent is provisioned with a single opaque key per lane, copied from the app. The key
        packs everything the agent needs; it is never parsed or shown in raw form to the model.
      </Lead>
      <Table
        head={['Key', 'Prefix', 'Lane', 'From']}
        rows={[
          [
            <Code>CLEVERCON_POLICY_KEY</Code>,
            <Code>ccpk1_</Code>,
            'private',
            'Rules tab, reveal on a private rule',
          ],
          [
            <Code>CLEVERCON_GLOBAL_KEY</Code>,
            <Code>ccpk1_</Code>,
            'private global',
            'Rules tab, the global-private rule',
          ],
          [
            <Code>CLEVERCON_SESSION_SECRET</Code>,
            <Code>S...</Code>,
            'public (local)',
            'Vault tab, a session key you hold',
          ],
          [
            <Code>CLEVERCON_SESSION_KEY</Code>,
            <Code>ccsk1_</Code>,
            'public (local)',
            'SDK registerSession (packs key + vault)',
          ],
          [
            <Code>CLEVERCON_RULE_KEY</Code>,
            <Code>ccrk1_</Code>,
            'public (server)',
            'Rules tab, reveal on a public rule',
          ],
          [
            <Code>CLEVERCON_API_KEY</Code>,
            <Code>cc_</Code>,
            'reads, hire, server public',
            'Developer console',
          ],
        ]}
      />
      <Callout kind="note" title="You do not set an API URL">
        There is no URL to configure: the API base defaults to the live CleverCon API.{' '}
        <Code>CLEVERCON_API_URL</Code> exists only for self-hosting. The{' '}
        <Code>CLEVERCON_API_KEY</Code> is needed for everything that talks to the hosted API
        (discovery, hiring, reads, limits, disputes, the private keyless relay, a Managed Session);
        the only lane that works without it is the fully local public session.
      </Callout>
      <Callout kind="warn" title="Keep policy and session secrets private">
        A policy key carries your rule and its salt; a session secret can sign bounded spends. Put
        them in your agent's environment, never in client code or a public repo. They are bounded
        on-chain, so the worst case is still inside the limits you set, but treat them as secrets.
      </Callout>
    </>
  );
}

const PROVIDER_MIN = `import { createProvider } from '@clevercon/agent-sdk/provider';
import { createHash } from 'node:crypto';

// A Data Notary: one function, tier T1 (anyone can re-hash the input and get the
// same answer), so the vault pays the instant the worker re-checks it.
const provider = createProvider({
  name: 'data-notary',
  port: 4200,
  async fulfill({ input }) {
    const data = String(input.data ?? '');
    const sha256 = createHash('sha256').update(data).digest('hex');
    return { sha256, algo: 'sha256', bytes: data.length };
  },
});

provider.listen(); // POST / to fulfill, GET /health for liveness`;

const PROVIDER_IMAGE = `import { createProvider, fetchAttachment, artifactRef } from '@clevercon/agent-sdk/provider';
import sharp from 'sharp';

// Image Resizer: a file in, a file out. The manifest sets attachmentsIn.required,
// so the buyer must attach an image before any charge.
const provider = createProvider({
  name: 'image-tools',
  async fulfill({ input, attachments }) {
    const ref = attachments[0];
    if (!ref) return { status: 'failed', error: 'no image attached' };

    // fetchAttachment downloads the buyer's file and verifies its content hash
    // before you touch it, so a swapped or tampered file is rejected.
    const { bytes } = await fetchAttachment(ref);
    const out = await sharp(bytes)
      .resize({ width: Number(input.width) || 800, withoutEnlargement: true })
      .toFormat('webp', { quality: 80 })
      .toBuffer();

    // host the result on any public URL, then hand it back as a content-addressed
    // reference; the buyer downloads it and the hash is the integrity check.
    const url = await uploadToBucket(out, 'image/webp');
    return {
      status: 'completed',
      data: { bytes: out.length },
      artifact: artifactRef(url, out, 'image/webp'),
    };
  },
});
provider.listen();`;

const PROVIDER_MULTI = `// One endpoint can serve many functions: the worker sends the function's action,
// so dispatch on it. This is exactly how the reference provider runs four
// services from a single process.
const HANDLERS = {
  'account.balances': accountBalances,
  'data.hash': dataNotary,
  'market.snapshot': marketSnapshot,
  'image.transform': imageTransform,
};

const provider = createProvider({
  name: 'reference-provider',
  async fulfill(req) {
    const handler = HANDLERS[req.action];
    if (!handler) return { status: 'failed', error: \`unknown action: \${req.action}\` };
    return handler(req);
  },
});`;

const PROVIDER_CREDS = `// The buyer connected their GitHub once, in the dapp. At job time the token is
// decrypted server-side and sent only to your endpoint as credentials, NEVER to
// the planning model. Never ask for a secret in input; read it from credentials.
async fulfill({ input, credentials }) {
  const token = credentials.github_token;
  const res = await fetch(\`https://api.github.com/repos/\${input.repo}/issues\`, {
    headers: { authorization: \`Bearer \${token}\`, 'user-agent': 'clevercon' },
  });
  if (!res.ok) return { status: 'failed', error: \`github \${res.status}\` };
  return res.json();
}`;

const PROVIDER_ASYNC = `// Long-running work: return 'working' with a durable handle; the worker polls
// your endpoint (kind:'poll') until you return 'completed'. The buyer sees your
// progress and the task money stays locked until you deliver or time out.
async fulfill(req) {
  if (req.kind === 'dispatch') {
    const handle = await startRender(req.input);
    return { status: 'working', handle, progress: { pct: 0, message: 'queued' } };
  }
  if (req.kind === 'poll') {
    const job = await getRender(req.handle);
    return job.done
      ? { status: 'completed', data: job.result }
      : { status: 'working', handle: req.handle, progress: { pct: job.pct } };
  }
}`;

const PROVIDER_INPUT = `// Needs-input: pause and ask a typed question. The agent answers from context or
// puts it to the user; the reply resumes the job as kind:'answer', with the
// answer on req.inputResponse.
async fulfill(req) {
  if (!req.input.targetLang) {
    return {
      status: 'input_required',
      inputRequest: { requestId: 'lang', prompt: 'Which language should I translate into?' },
    };
  }
  return translate(String(req.input.text), String(req.input.targetLang));
}`;

const PROVIDER_LOCAL_TEST = `# liveness (the directory polls this; a 404 is fine, only 5xx/timeout count as down)
curl localhost:4200/health

# a dispatch: exactly what the CleverCon worker POSTs for one step
curl -X POST localhost:4200 -H 'content-type: application/json' -d '{
  "action": "data.hash",
  "taskId": "t_local", "jobId": "j_local",
  "input": { "data": "hello world" },
  "kind": "dispatch"
}'`;

const REGISTER_CURL = `# 1. Sign in with your provider key over SEP-10 (challenge -> sign -> verify).
#    That key is also your payout wallet, so no separate payout proof is needed.
# 2. Register the service with its acceptance contract:
curl -X POST "$CLEVERCON_API_URL/provider/services" \\
  -H "authorization: Bearer $TOKEN" \\
  -H "content-type: application/json" \\
  -d '{
    "name": "Data Notary",
    "description": "A sha256 commitment of your data, re-checkable by anyone.",
    "category": "Compute & Proofs",
    "capabilities": ["data.hash"],
    "pricingModel": "X402",
    "pricePerCall": 0.01,
    "endpoint": "https://my-provider.example.com",
    "stellarAddress": "G...YOURPAYOUT",
    "tier": "T1"
  }'`;

function Providers() {
  return (
    <>
      <Lead>
        The other side of the economy: turn an API, a model, a bot, a dataset, or human work into a
        service any agent on CleverCon can hire and pay per use in USDC. You host one HTTPS endpoint
        and declare what it does; the marketplace handles discovery, the job lifecycle, delivery
        verification, settlement, and reputation.
      </Lead>

      <UseCase title="Monetize a trading signal, a data feed, or a skill">
        You run a bot that produces a useful signal. List it once, declare a price per call, and any
        agent on CleverCon can pay you in USDC per use, non-custodially, with the buyer's spend
        bounded by their own private rule. You never hold their keys; they never hold yours; the
        vault pays your address on accepted delivery.
      </UseCase>

      <H2 id="why">Why list on CleverCon</H2>
      <UL>
        <LI>
          <B>Agent-native demand.</B> Buyers are autonomous agents that discover and hire by
          capability, not people filling forms. Your service is reachable from the dapp, the SDK,
          and any MCP agent at once.
        </LI>
        <LI>
          <B>Paid per call in USDC, non-custodially.</B> Settlement goes straight to your Stellar
          wallet on accepted delivery. No invoicing, no platform float, no chargebacks.
        </LI>
        <LI>
          <B>Trust you earn, not claim.</B> Reputation is built from real settlements (unique
          payers, dispute rate), and the directory ranks on it. A new service competes on
          verifiability, not marketing spend.
        </LI>
        <LI>
          <B>One integration, every shape.</B> Sync, long-running, needs-input, and human work all
          use the same endpoint contract, so you can list anything from a price feed to a freelance
          workflow.
        </LI>
      </UL>

      <H2 id="what">What a service is</H2>
      <P>
        A service is one endpoint plus a manifest. The manifest lists your callable <B>functions</B>
        , each a capability with its own input schema, price, tier, and requirements; the endpoint
        answers a job for each. One endpoint can serve many functions: the reference provider runs
        four from a single process.
      </P>
      <Flow
        steps={[
          { label: 'Buyer hires a function', sub: 'from the dapp, SDK, or an MCP agent' },
          { label: 'Worker POSTs the step', sub: 'to your endpoint, with input + credentials' },
          { label: 'You deliver', sub: 'a result, a file, or a question' },
          { label: 'Vault pays you', sub: "on accepted delivery, under the buyer's rule" },
        ]}
      />

      <H2 id="shapes">The shapes you can list</H2>
      <Table
        head={['Shape', 'What it means', 'You return']}
        rows={[
          [
            'Sync',
            'Immediate request and response (a price, a hash, a lookup)',
            <Code>completed</Code>,
          ],
          [
            'Long-running',
            'Work that takes time (a render, a training run)',
            <>
              <Code>working</Code> + a handle the worker polls
            </>,
          ],
          ['Needs-input', 'You must ask the buyer something mid-job', <Code>input_required</Code>],
          [
            'Human (T3)',
            'A person does the work; released on approval',
            <>
              <Code>completed</Code> on buyer accept
            </>,
          ],
          [
            'Metered',
            'Pay-per-call APIs and streams (x402 / MPP)',
            'billed per call, not per task',
          ],
        ]}
      />

      <H2 id="tiers">Verification tiers (the trust ladder)</H2>
      <P>
        The more checkable your delivery, the faster you are paid and the higher you rank. That is
        the incentive to be verifiable. You declare a tier and a method; the method is exercised on
        your first real job, so a service cannot claim a tier it does not meet.
      </P>
      <UL>
        <LI>
          <B>T1, trustless.</B> Your output can be re-derived, re-hashed, or signature-checked (a
          price feed, a sha256 notary, a content-addressed file). The worker re-checks it and pays
          instantly.
        </LI>
        <LI>
          <B>T2, judged.</B> Your output is checked against your declared schema and an automated
          judge, with a dispute window before release (a summary, a translation, an extraction).
        </LI>
        <LI>
          <B>T3, human / milestone.</B> Human or long-form work, released when the buyer approves.
        </LI>
      </UL>

      <Callout kind="note" title="A live catalog to copy">
        The reference provider is a real, hireable example you can read and clone: Stellar Account
        Intelligence (T1), Data Notary (T1), Market Oracle (T2), and an Image Resizer (T2, file in /
        file out), all on one process. Source:{' '}
        <A href="https://github.com/clevercon-protocol/clevercon/tree/main/services/reference-provider">
          services/reference-provider
        </A>
        .
      </Callout>

      <Cards
        items={[
          {
            to: '/docs/build-a-service',
            title: 'Build a service',
            desc: 'The fulfillment contract, a full worked example, files, credentials, and the async shapes.',
          },
          {
            to: '/docs/register-service',
            title: 'Register and earn',
            desc: 'Deploy, list it field by field, ensure a trustline, and get paid with reputation.',
          },
        ]}
      />
    </>
  );
}

function BuildService() {
  return (
    <>
      <Lead>
        A provider is a single file, no framework. The SDK (
        <Code>@clevercon/agent-sdk/provider</Code>) handles the health check, body parsing, the sync
        / async / needs-input encoding, and error mapping, so the only thing you write is the work
        itself.
      </Lead>

      <H2 id="install">Install and the minimal service</H2>
      <CodeBlock code="npm install @clevercon/agent-sdk" lang="bash" />
      <CodeBlock code={PROVIDER_MIN} lang="ts" title="data-notary.ts" />
      <P>
        That is a complete, hireable service. <Code>fulfill</Code> receives the job and returns the
        result; a bare value is a completed synchronous delivery. Run it and it answers{' '}
        <Code>POST /</Code> for jobs and <Code>GET /health</Code> for liveness.
      </P>

      <H2 id="request">The fulfillment request</H2>
      <P>Your handler receives one typed request per step:</P>
      <Table
        head={['Field', 'What it is']}
        rows={[
          [
            <Code>action</Code>,
            'The function the buyer hired (the capability). Dispatch on it if you serve several.',
          ],
          [
            <Code>input</Code>,
            "The structured params, validated against that function's input JSON Schema.",
          ],
          [
            <Code>attachments</Code>,
            'Buyer files by reference; fetch and hash-verify with fetchAttachment before use.',
          ],
          [
            <Code>credentials</Code>,
            "The buyer's satisfied requirements (an API key, an OAuth token). Decrypted to you only, never to the LLM.",
          ],
          [
            <Code>idempotencyKey</Code>,
            'A retried hire carries the same key; dedupe side-effecting work on it.',
          ],
          [
            <>
              <Code>kind</Code> / <Code>handle</Code>
            </>,
            "'dispatch' starts a job, 'poll' checks an async handle, 'answer' resumes a needs-input step.",
          ],
        ]}
      />

      <H2 id="return">What you return</H2>
      <Table
        head={['Return', 'Meaning']}
        rows={[
          [
            'a bare value',
            'Completed sync delivery (a string is sent verbatim; anything else is JSON-encoded).',
          ],
          [
            <Code>{"{ status: 'completed', data, artifact? }"}</Code>,
            'An explicit completed delivery, optionally with a file.',
          ],
          [
            <Code>{"{ status: 'working', handle, progress? }"}</Code>,
            'A long job; the worker polls the handle.',
          ],
          [
            <Code>{"{ status: 'input_required', inputRequest }"}</Code>,
            'Ask the buyer a typed question.',
          ],
          [
            <Code>{"{ status: 'failed', error }"}</Code>,
            'Fail the step; the lock refunds and you are not paid.',
          ],
        ]}
      />
      <Callout kind="warn" title="Failure means no pay">
        A thrown handler, a non-2xx, or a timeout (the worker aborts at 15 seconds) fails the step,
        and the vault does not pay for it. Keep sync work under the deadline; use the{' '}
        <Code>working</Code> shape for anything slow.
      </Callout>

      <H2 id="files">Files in, files out</H2>
      <P>
        A service can take a file and return one. Declare the accepted types and max size (so the
        buyer must attach before any charge); the file arrives as a content-addressed reference.{' '}
        <Code>fetchAttachment</Code> downloads it and verifies the hash; to return a file, host the
        bytes and wrap them with <Code>artifactRef</Code>.
      </P>
      <CodeBlock
        code={PROVIDER_IMAGE}
        lang="ts"
        title="image-tools.ts (the reference Image Resizer, trimmed)"
      />

      <H2 id="many">Many functions on one endpoint</H2>
      <CodeBlock code={PROVIDER_MULTI} lang="ts" />

      <H2 id="credentials">Credentials (act on the buyer's behalf)</H2>
      <P>
        When a function needs the buyer's API key or an OAuth token (say, their GitHub), they
        connect it once in the dapp. At job time it is decrypted server-side and sent only to your
        endpoint as <Code>credentials</Code>, never to the planning model. Read it from there; never
        ask for a secret in <Code>input</Code>.
      </P>
      <CodeBlock code={PROVIDER_CREDS} lang="ts" />

      <H2 id="async">Long-running and needs-input</H2>
      <CodeBlock code={PROVIDER_ASYNC} lang="ts" />
      <CodeBlock code={PROVIDER_INPUT} lang="ts" />
      <P>
        For human work (T3), there is nothing special to return: deliver as <Code>completed</Code>{' '}
        and the step is held for the buyer's approval before it releases.
      </P>

      <H2 id="verify">Pick a verification method</H2>
      <P>Your method maps to a tier and decides how fast you are paid:</P>
      <Table
        head={['Method', 'Tier', 'How delivery is checked']}
        rows={[
          [<Code>onchain</Code>, 'T1', 'Re-derived from the ledger (a balance, a price). Instant.'],
          [<Code>witness</Code>, 'T1', 'A predicate the worker recomputes (a sha256). Instant.'],
          [
            <Code>content-hash</Code>,
            'T1',
            'A delivered file whose bytes hash to the reference. Instant.',
          ],
          [
            <Code>signature</Code>,
            'T1 / T2',
            'You sign the payload; the buyer verifies against your declared key.',
          ],
          [<Code>attest</Code>, 'T2', 'Output judged against your schema, with a dispute window.'],
          [<Code>manual</Code>, 'T3', 'Released on human approval.'],
        ]}
      />

      <H2 id="test">Test it locally</H2>
      <CodeBlock code={PROVIDER_LOCAL_TEST} lang="bash" />

      <Cards
        items={[
          {
            to: '/docs/register-service',
            title: 'Register and earn',
            desc: 'List your deployed endpoint and start getting paid.',
          },
          {
            to: '/docs/sdk',
            title: 'SDK reference',
            desc: 'The spender, sessions, receipts, and the rest of the SDK surface.',
          },
        ]}
      />
    </>
  );
}

function RegisterService() {
  return (
    <>
      <Lead>
        Once your endpoint is reachable over HTTPS, list it and start earning. Register in the
        Provider console by hand, or programmatically with your provider key. Either way, settlement
        goes to your Stellar wallet on accepted delivery.
      </Lead>

      <H2 id="deploy">1. Deploy your endpoint</H2>
      <P>
        Host the provider anywhere reachable over HTTPS (Railway, Fly, a VPS, a cloud function). The
        worker needs <Code>POST /</Code> and <Code>GET /health</Code>. Keep it warm enough to answer
        within the 15-second step deadline.
      </P>

      <H2 id="console">2a. Register in the Provider console</H2>
      <P>
        Open <A to="/provider">Provider</A> in the app and add a service. The form captures the
        whole acceptance contract:
      </P>
      <Table
        head={['Field', 'What to put']}
        rows={[
          ['Name + description', 'How the service reads in the directory and to the agent.'],
          [
            'Category',
            'Where it is discovered (Data & Oracles, Compute & Proofs, Media & Files, ...).',
          ],
          ['Endpoint', 'Your HTTPS URL. The worker POSTs each job here.'],
          ['Payout address', 'Your Stellar wallet (G...). Needs a USDC trustline (below).'],
          [
            'Interaction + payment model',
            'Sync / async / human / metered, and how you are billed for it.',
          ],
          [
            'Functions',
            'One row per capability: label, action key, input schema, verification tier, and price.',
          ],
          [
            'Requirements',
            'Anything the buyer must connect first (an API key, an OAuth account); see below.',
          ],
          ['Owner / identity', 'List under your profile or an organization, with contact links.'],
        ]}
      />
      <Callout kind="tip" title="Action key = action">
        A function's action key is the exact <Code>action</Code> your endpoint receives. It
        auto-fills from the label (<Code>Create issue</Code> gives <Code>create_issue</Code>), and
        your <Code>fulfill</Code> dispatches on it.
      </Callout>

      <H2 id="programmatic">2b. Register programmatically</H2>
      <P>
        Prefer scripts? Sign in over SEP-10 with your provider key and POST the service. This is
        exactly what the reference provider's register script does.
      </P>
      <CodeBlock code={REGISTER_CURL} lang="bash" />

      <H2 id="requirements">Requirements the buyer connects</H2>
      <P>
        If a function needs the buyer to bring something, declare it as a requirement so the buyer
        is prompted once, before any charge, and the value arrives at your endpoint as a credential:
      </P>
      <UL>
        <LI>
          <B>info</B>: a non-secret value (a handle, a region).
        </LI>
        <LI>
          <B>apiKey</B>: a secret key, stored encrypted and sent only to your endpoint.
        </LI>
        <LI>
          <B>oauth</B>: a connected account (like GitHub); the buyer authorizes once and you receive
          a scoped token.
        </LI>
        <LI>
          <B>install</B>: a one-time setup step the buyer confirms.
        </LI>
      </UL>

      <H2 id="pricing">Pricing</H2>
      <UL>
        <LI>
          <B>Per call</B> in USDC, settled on accepted delivery. <Status kind="live" />
        </LI>
        <LI>
          <B>Per usage</B> (per unit, for example per 1k tokens or per MB). <Status kind="live" />
        </LI>
        <LI>
          <B>Free</B> functions, for loss-leaders or open tools. <Status kind="live" />
        </LI>
        <LI>
          <B>Subscription</B> (per day / week / month). <Status kind="dev" />
        </LI>
      </UL>

      <H2 id="trustline">3. Ensure a USDC trustline</H2>
      <P>
        Your payout wallet must hold a USDC trustline or settlement cannot reach you. The console
        flags a missing trustline so you are never silently unpayable. On testnet, use the USDC
        asset listed in <A to="/docs/reference">Networks and errors</A>.
      </P>

      <H2 id="paid">How you get paid</H2>
      <P>
        On accepted delivery, the vault pays your payout address directly, through the buyer's own
        rule: a private rule pays keyless (a zero-knowledge proof authorizes it), a public rule via
        the buyer's Managed Session. A small protocol fee is taken on release. Every settlement
        builds your on-chain reputation, which drives discovery.
      </P>
      <Flow
        steps={[
          { label: 'Accepted delivery', sub: 'your result passes its tier check' },
          { label: 'Vault releases', sub: "under the buyer's private or public rule" },
          { label: 'USDC to your wallet', sub: 'minus the protocol fee' },
          { label: 'Reputation +1', sub: 'unique payers, dispute rate' },
        ]}
      />

      <H2 id="operate">Operate your service</H2>
      <P>The console is where you run the business of a service:</P>
      <UL>
        <LI>
          <B>Payouts ledger</B> of every settled job, with a CSV export for your books.
        </LI>
        <LI>
          <B>Performance metrics</B>: volume, acceptance, latency, and dispute rate per service.
        </LI>
        <LI>
          <B>Health</B>: the directory pings your endpoint and auto-recovers it; an unreachable
          service is shown as temporarily unavailable instead of silently failing hires.
        </LI>
        <LI>
          <B>Disputes</B>: a T2 delivery can be disputed in its window; respond from the inbox.
        </LI>
      </UL>

      <H2 id="roadmap">Earning more trust</H2>
      <Table
        head={['Capability', 'Status']}
        rows={[
          [<>Per-call pricing in USDC, settled on accepted delivery</>, <Status kind="live" />],
          [
            <>Reputation from real settlements (unique payers, dispute rate)</>,
            <Status kind="live" />,
          ],
          [<>Subscription pricing</>, <Status kind="dev" />],
          [
            <>A verified mark (passes its own check, N settlements, payout proof)</>,
            <Status kind="dev" />,
          ],
          [<>Provider bonds (a slashable stake that lifts ranking)</>, <Status kind="soon" />],
        ]}
      />
      <Callout kind="note">
        See <A to="/docs/marketplace">Marketplace</A> for the buyer side, the tiers, and disputes,
        and <A to="/docs/security">Security and privacy</A> for the trust model.
      </Callout>
    </>
  );
}

// ── Reference ───────────────────────────────────────────────────────────────

function Reference() {
  return (
    <>
      <Lead>
        Networks, the live testnet contracts and asset, config token prefixes, and errors.
      </Lead>

      <H2 id="network">Network</H2>
      <P>
        CleverCon runs on Stellar testnet today. The RPC is{' '}
        <Code>https://soroban-testnet.stellar.org</Code>. All assets are test assets with no
        real-world value.
      </P>

      <H2 id="contracts">Live testnet contracts and asset</H2>
      <P>
        These are the current values; contract ids can change on a redeploy, and the vault is always
        linked from the app's Vault tab, so treat the app and the SDK defaults as the source of
        truth.
      </P>
      <Table
        head={['Thing', 'Id']}
        rows={[
          [
            'USDC asset (SAC)',
            <Code>CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA</Code>,
          ],
          [
            'USDC issuer (classic)',
            <Code>GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5</Code>,
          ],
          ['Vault', <Code>CDVMPHPD3V6KNVS2ORBQD6A6FSWDCHN7RK2LW4C2KUPHZLM5H3KNKK6A</Code>],
          [
            'Policy verifier',
            <Code>CA4VG3JI4EM67LRZ7ZIVFZG7U7UP6RT5GH7DPIIFSLTBFUQBZADWJ4W5</Code>,
          ],
        ]}
      />

      <H2 id="tokens">Config token prefixes</H2>
      <Table
        head={['Prefix', 'Carries']}
        rows={[
          [<Code>ccpk1_</Code>, 'a private policy key: the rule and its salt'],
          [<Code>ccrk1_</Code>, 'a public rule key: an addressable rule id'],
          [<Code>ccsk1_</Code>, 'a session key: a session secret plus its vault'],
        ]}
      />
      <P>
        These are opaque, isomorphic encodings (not encryption), so an agent can carry one string
        instead of several fields. See <A to="/docs/config-keys">Config keys</A>.
      </P>

      <H2 id="errors">Error reference</H2>
      <P>A rejected spend returns a clean sentence, never a raw contract dump. The common ones:</P>
      <Table
        head={['Reason', 'What it means', 'What to do']}
        rows={[
          [
            'Per-payment cap',
            'The amount exceeds the rule or session per-payment maximum.',
            'Lower the amount or raise the cap.',
          ],
          [
            'Below minimum',
            'The amount is under the rule per-payment minimum.',
            'Raise the amount.',
          ],
          [
            'Rolling cap',
            'This would exceed the window total already spent.',
            'Wait for the window, or raise the cap.',
          ],
          [
            'Rate limit',
            'Too many payments in the window (velocity).',
            'Wait, or raise the velocity.',
          ],
          ['Calendar window', 'Outside the rule allowed times.', 'Spend within the window.'],
          [
            'Payee not allowed',
            'The payee is not on the allowlist (or is denied).',
            'Add the payee to the rule.',
          ],
          [
            'Session cap / expired / paused',
            'The session scope is exhausted, past expiry, or paused.',
            'Top up, extend, or unpause the session.',
          ],
          ['Not pinned', 'The rule is not live on-chain yet.', 'Pin the rule, then retry.'],
        ]}
      />
    </>
  );
}

function Security() {
  return (
    <>
      <Lead>
        The trust model, what is enforced on-chain, and the boundaries of the current version,
        stated plainly.
      </Lead>

      <H2 id="architecture">The trust architecture</H2>
      <P>Everything distinctive follows from three moves:</P>
      <UL>
        <LI>
          <B>The commitment is pinned to you on-chain.</B> Your vault accepts a release only if its
          proof verifies against a rule only your wallet can set, so no one can invent a permissive
          rule and spend under it.
        </LI>
        <LI>
          <B>A proof authorizes the spend.</B> On the private path the payment is authorized by a
          zero-knowledge proof plus a fresh nullifier, not a signing key the server could hold.
        </LI>
        <LI>
          <B>Proving happens where the secret lives.</B> The salt and rule never leave your device
          or agent, so any relayer is pure plumbing that cannot learn your rule or forge a proof.
        </LI>
      </UL>
      <P>
        What this guarantees: no party, including us, can spend outside your rule. What it does not:
        an agent that holds the secret can spend <B>within</B> the rule, which is the point of
        automation. You tune the rule tight so the worst case within it is acceptable.
      </P>

      <H2 id="onchain">Enforced on-chain vs in the app</H2>
      <P>
        Amount, timing, frequency, and payee limits, plus address allow and deny, are enforced
        on-chain. Softer, mutable signals (reputation, dispute rate, price versus market) are
        enforced by the app as a pre-flight filter and are labelled as such, not presented as a
        cryptographic guarantee.
      </P>

      <H2 id="limits">Honest v1 boundaries</H2>
      <UL>
        <LI>
          Amounts and counterparties are public on the ledger. What stays private is the policy.
          Hiding amounts depends on Stellar confidential-token support and is on the roadmap.
        </LI>
        <LI>
          The one secret the platform can hold is a Managed Session key, bounded on-chain and
          revocable. Today it is encrypted at rest; hardware or multi-party key custody is a mainnet
          gate.
        </LI>
        <LI>
          A contract and security audit, and a multi-party trusted setup, are required before
          mainnet. Testnet assets have no real-world value.
        </LI>
      </UL>

      <Callout kind="note" title="In one line">
        On the private path, the answer to "can CleverCon spend my funds or change my rule?" is a
        hard no.
      </Callout>
    </>
  );
}

// ── Registry ────────────────────────────────────────────────────────────────

export interface DocPage {
  slug: string;
  title: string;
  group: string;
  description: string;
  Body: () => ReactNode;
}

export const DOC_GROUPS = [
  'Getting started',
  'For users',
  'For developers',
  'For providers',
  'Reference',
] as const;

export const DOCS: DocPage[] = [
  {
    slug: 'introduction',
    group: 'Getting started',
    title: 'Introduction',
    description: 'What CleverCon is, what you can do, and how to drive it.',
    Body: Introduction,
  },
  {
    slug: 'what-you-can-do',
    group: 'Getting started',
    title: 'What you can do',
    description:
      'Pay, disburse, hire, pay per call, and offer a service, by prompt, in the app, or in code.',
    Body: WhatYouCanDo,
  },
  {
    slug: 'quickstart',
    group: 'Getting started',
    title: 'Walkthrough',
    description:
      'The order of operations and why, then two detailed walkthroughs: in the app, and by prompt over MCP.',
    Body: Walkthrough,
  },
  {
    slug: 'concepts',
    group: 'Getting started',
    title: 'Core concepts',
    description: 'The vault, rules, custody and mode, globals, tiers, and the economy.',
    Body: Concepts,
  },
  {
    slug: 'vault',
    group: 'For users',
    title: 'Fund your vault',
    description: 'The testnet quickstart, deposits, and withdrawals.',
    Body: Vault,
  },
  {
    slug: 'rules',
    group: 'For users',
    title: 'Rules',
    description: 'Author, pin, edit, and share rules, with five real examples.',
    Body: RulesDoc,
  },
  {
    slug: 'spending',
    group: 'For users',
    title: 'Spending',
    description: 'The spend lanes, with a worked example for each.',
    Body: Spending,
  },
  {
    slug: 'marketplace',
    group: 'For users',
    title: 'Marketplace',
    description: 'Hire services, verification tiers, disputes, reputation, and the metered rail.',
    Body: Marketplace,
  },
  {
    slug: 'developer-quickstart',
    group: 'For developers',
    title: 'Quickstart',
    description: 'Connect an agent over MCP, or embed the SDK.',
    Body: DeveloperQuickstart,
  },
  {
    slug: 'mcp',
    group: 'For developers',
    title: 'MCP server',
    description: 'The tools, the two lanes, config, and example prompts.',
    Body: Mcp,
  },
  {
    slug: 'sdk',
    group: 'For developers',
    title: 'SDK',
    description: 'createSpender, sessions, receipts, with worked examples.',
    Body: Sdk,
  },
  {
    slug: 'config-keys',
    group: 'For developers',
    title: 'Config keys',
    description: 'Policy key, session key, rule key, and API key.',
    Body: ConfigKeys,
  },
  {
    slug: 'providers',
    group: 'For providers',
    title: 'Overview',
    description: 'Why list a service, what a service is, the shapes, and the trust tiers.',
    Body: Providers,
  },
  {
    slug: 'build-a-service',
    group: 'For providers',
    title: 'Build a service',
    description:
      'The fulfillment contract, a full worked example, files, credentials, and async shapes.',
    Body: BuildService,
  },
  {
    slug: 'register-service',
    group: 'For providers',
    title: 'Register and earn',
    description:
      'Deploy, list it field by field, ensure a trustline, and get paid with reputation.',
    Body: RegisterService,
  },
  {
    slug: 'reference',
    group: 'Reference',
    title: 'Networks and errors',
    description: 'Testnet contracts, assets, token prefixes, and errors.',
    Body: Reference,
  },
  {
    slug: 'security',
    group: 'Reference',
    title: 'Security and privacy',
    description: 'The trust model and honest v1 boundaries.',
    Body: Security,
  },
];

export const DOC_BY_SLUG = new Map(DOCS.map((d) => [d.slug, d]));
