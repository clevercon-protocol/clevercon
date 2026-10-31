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
        CleverCon gives an AI agent a spending account on Stellar that it cannot misuse, bounded by
        private rules only you can see, with an economy to use it in. Your agent can pay a vendor,
        disburse to many, hire a service, and pay per call for APIs and plugins, always within the
        limits you set, enforced on-chain and kept private.
      </Lead>
      <P>
        You set the rules once (a budget, who it may pay, how much, how often). They are enforced
        on-chain and kept private, and the platform never holds your money. So the agent spends on
        its own and can never overspend, pay someone you did not approve, or leak your limits. The
        rules are the guardrail you set once, not the daily work.
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
          <B>Hire a service.</B> Data, AI, research, or compute from the directory, paid per step on
          delivery.
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
        Each of these works by prompt, in the app, or in code. See{' '}
        <A to="/docs/what-you-can-do">What you can do</A> for every action step by step, with
        snippets.
      </P>

      <UseCase title="A research desk funds an agent to buy market data">
        The desk sets one rule: pay only five approved data providers, at most $100 per purchase,
        and no more than $500 per week. The agent buys data on its own all week. It can never pay a
        sixth provider, never spend $101, and never blow past $500, and the ledger shows that each
        payment was allowed without revealing the budget, the providers, or the weekly cap.
      </UseCase>

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
      <P>Every spend is authorized in one of two lanes, and the safe one is the default.</P>
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
          <B>In the app</B> at clevercon.xyz: do any of it by hand, fund, pay, disburse, hire, and
          author rules, all in the browser.
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
        CleverCon is a bounded, private spending account plus an economy. Here is everything you (or
        your agent) can do with it, and the two hands-on ways to do each: by prompt, or by hand in
        the app. Every action is also callable from code; the snippets live in the SDK reference.
      </Lead>

      <H2 id="overview">At a glance</H2>
      <Table
        head={['Action', 'By prompt (an AI agent over MCP)', 'By hand (in the app)']}
        rows={[
          ['Pay one address', '"Pay G... 5 USDC for the logo"', 'Agent tab'],
          ['Disburse to many', '"Split 30 USDC across these three"', 'Disburse tab'],
          ['Hire a service', '"Hire a price oracle with a 2 USDC budget"', 'Services tab'],
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

      <H2 id="hire">Hiring a service</H2>
      <P>Hiring runs the same bounded, pay-on-delivery flow every time:</P>
      <Flow
        steps={[
          { label: 'Discover', sub: 'search the directory' },
          { label: 'Hire', sub: 'under a rule' },
          { label: 'Vault locks', sub: 'the budget' },
          { label: 'Deliver', sub: 'provider does the work' },
          { label: 'Verify', sub: 'by the tier' },
          { label: 'Release', sub: 'paid per step' },
        ]}
      />
      <P>
        You pay only for delivery that passes the service's verification, and anything left is
        refunded to available.
      </P>

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
        A team commissions a design or an open-source contribution for 200 USDC. The budget is
        locked and released only when the buyer approves the delivered work or a milestone is met.
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
      "env": { "CLEVERCON_POLICY_KEY": "ccpk1_...from the Rules tab" }
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
            desc: 'List a service agents can hire and pay.',
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
        Two minutes: get what your lane needs from the app, add one config block, restart. There is
        nothing to install; the client runs it on demand with npx.
      </P>
      <Steps>
        <Step n={1} title="Fund the vault">
          Connect a wallet and fund the vault (Vault tab testnet quickstart). The agent spends from
          this balance; see the <A to="/docs/quickstart">Walkthrough</A>.
        </Step>
        <Step n={2} title="Get the key your lane needs">
          Private lane: create and pin a private rule (Rules tab), choose Reveal, and copy its
          policy key (<Code>ccpk1_</Code>). Public local: on the Vault tab under Agent keys,
          authorize a session and copy its session secret (<Code>S...</Code>). Public server: on the
          Vault tab enable a Managed Session, then mint an API key in the Developer console (
          <Code>cc_...</Code>
          ).
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
        Provide the keys for the lane you want. The vault and USDC asset default to the live testnet
        contracts, so most lanes need just one secret.
      </P>
      <H3>Private (self-custody, keyless)</H3>
      <P>
        The policy key packs your rule and its salt; the agent proves locally and relays only the
        proof. Add <Code>CLEVERCON_GLOBAL_KEY</Code> only if the account has a global-private rule.
      </P>
      <CodeBlock code={MCP_PRIVATE} title="private" />
      <H3>Public, local (the agent holds a session key)</H3>
      <P>
        The default mode. The agent signs bounded spends with its own session key, no proof per
        payment.
      </P>
      <CodeBlock code={MCP_LOCAL} title="public local" />
      <H3>Public, server (Managed Session)</H3>
      <P>
        Set <Code>CLEVERCON_PUBLIC_MODE=server</Code> and <Code>CLEVERCON_API_KEY</Code>; the
        platform signs within the on-chain scope you set in the app. Add{' '}
        <Code>CLEVERCON_API_KEY</Code> to any lane to also enable the directory, hire, read, and
        dispute tools.
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
          ['Hire', <Code>hire_agent</Code>],
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
              <Code>dispute_task</Code>, <Code>approve_task</Code>
            </>,
          ],
        ]}
      />

      <H2 id="prompts">Example prompts</H2>
      <P>Once connected, you drive it in natural language:</P>
      <UL>
        <LI>"Pay G...ALICE 2 USDC for the logo work, privately." (private lane)</LI>
        <LI>"Split 30 USDC across these three addresses." (private disburse, one proof)</LI>
        <LI>"Pay the data API 0.05 for this call." (public session)</LI>
        <LI>"What is my remaining session budget?" (session_scope)</LI>
        <LI>"Find a price-oracle service and hire it with a 2 USDC budget." (hire)</LI>
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
      <Callout kind="warn" title="Keep policy and session secrets private">
        A policy key carries your rule and its salt; a session secret can sign bounded spends. Put
        them in your agent's environment, never in client code or a public repo. They are bounded
        on-chain, so the worst case is still inside the limits you set, but treat them as secrets.
      </Callout>
    </>
  );
}

const PROVIDER_CODE = `import { createProvider } from '@clevercon/agent-sdk/provider';

const provider = createProvider({
  name: 'price-oracle',
  port: 4200,
  async fulfill({ action, taskId }) {
    const price = await lookupPrice(action);
    return { action, price, at: new Date().toISOString() };
  },
});

provider.listen(); // POST / to fulfill, GET /health for liveness`;

function Providers() {
  return (
    <>
      <Lead>
        The other side of the economy: turn a function, an API, a model, or a skill into a service
        the marketplace can hire and pay per use. The SDK implements the fulfillment contract, so a
        provider is a single file with no framework.
      </Lead>

      <UseCase title="Monetize a trading signal or a data feed">
        You run a bot that produces a useful signal. List it once, declare a price per call, and any
        agent on CleverCon can pay you in USDC per use, non-custodially, with the buyer's spend
        bounded by their own rule. You never hold their keys; they never hold yours.
      </UseCase>

      <H2 id="build">Build a provider</H2>
      <CodeBlock code={PROVIDER_CODE} lang="ts" />

      <H3>The fulfillment contract</H3>
      <Table
        head={['Exchange', 'Detail']}
        rows={[
          [
            <Code>POST /</Code>,
            'request body { action, taskId }; a 2xx body is the step output the buyer sees',
          ],
          [
            'output',
            'a string sent verbatim, or an object JSON-encoded; truncated to a sane maximum',
          ],
          ['failure', 'a non-2xx or a timeout fails the step, so the vault does not pay for it'],
          [<Code>GET /health</Code>, 'liveness'],
        ]}
      />

      <H2 id="tier">Pick a verification tier</H2>
      <P>
        Higher verifiability means instant pay and higher trust, which is the incentive to be
        checkable.
      </P>
      <UL>
        <LI>
          <B>T1</B>: your output can be re-derived, hashed, or signature-checked (a price feed, a
          VRF, a content-addressed fetch). Paid instantly.
        </LI>
        <LI>
          <B>T2</B>: your output is judged against a schema with a dispute window (a summary, a
          translation, an extraction).
        </LI>
        <LI>
          <B>T3</B>: human or milestone work, released on buyer approval.
        </LI>
      </UL>

      <H2 id="register">Register and get paid</H2>
      <Steps>
        <Step n={1} title="Run your provider">
          Host the endpoint anywhere reachable over HTTPS.
        </Step>
        <Step n={2} title="Register it in the Provider console">
          Declare its category, tier, price per call, and payout address. A verification method you
          declare is exercised on the first real job, so a service cannot claim a tier it does not
          meet.
        </Step>
        <Step n={3} title="Ensure a USDC trustline">
          The portal flags a missing trustline so you are never silently unpayable.
        </Step>
      </Steps>
      <P>
        Payment settles to your payout address per accepted step, and settlement builds your
        reputation, which drives discovery.
      </P>

      <H2 id="monetize">Monetization and the verified mark</H2>
      <P>How a service earns trust and revenue is growing in this order:</P>
      <Table
        head={['Capability', 'Status']}
        rows={[
          [<>Per-call pricing in USDC, settled on accepted delivery</>, <Status kind="live" />],
          [
            <>Reputation from real settlements (unique payers, dispute rate)</>,
            <Status kind="live" />,
          ],
          [<>Free and subscription pricing models</>, <Status kind="dev" />],
          [
            <>A verified mark (passes its own check, N settlements, payout proof)</>,
            <Status kind="dev" />,
          ],
          [<>Provider bonds (a slashable stake that lifts ranking)</>, <Status kind="soon" />],
          [<>Provider analytics (volume, revenue, top capabilities)</>, <Status kind="soon" />],
        ]}
      />
      <Callout kind="note">
        See <A to="/docs/marketplace">Marketplace</A> for the buyer side, the tiers, and disputes.
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

export const DOC_GROUPS = ['Getting started', 'For users', 'For developers', 'Reference'] as const;

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
    group: 'For developers',
    title: 'Be a provider',
    description: 'List a service agents can hire and pay, and earn.',
    Body: Providers,
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
