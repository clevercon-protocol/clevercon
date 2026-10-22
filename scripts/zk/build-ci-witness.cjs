// Build a satisfiable witness for policy_batch.circom (N=4, C=4, W=2) that
// exercises ALL of R1-R8 at once: three active releases to an allowlisted payee
// plus one null slot, within budget, within a calendar window, under the velocity
// cap. Uses the compiled poseidon2/3/4 circuits as hash oracles so the allowlist
// tree (leaf = H(payee, cap, category)) and the R6 windows root match the
// in-circuit Poseidon exactly. Writes build/policy-input.json.
const fs = require('fs');
const path = require('path');

const DEPTH = 16;
const N = 4;
const PAYEE_FIELD = 12345678901234567890n;
const PAYEE_CAP = 80n; // R5
const PAYEE_CATEGORY = 0n; // R8 category index
const CEILING = 100n; // R1
const CAT_CEILING = ['1000', '0', '0', '0']; // R8 (category 0 ceiling)

// R2 (rolling cap): running_spend + batch_total (100) <= cap.
const RUNNING_SPEND = 50n;
const R2_CAP = 200n;
// R7 (velocity): prior_count + active_count (3) <= max_count.
const PRIOR_COUNT = 2n;
const R7_MAX_COUNT = 10n;
// R6 (calendar): the validity window [valid_after, valid_before] sits inside
// calendar window 0 ([1000, 2000]).
const VALID_AFTER = 1200n;
const VALID_BEFORE = 1800n;
const WIN_START = [1000n, 5000n];
const WIN_END = [2000n, 6000n];
// R4 (deny-list): entries, none equal to the payee; threshold below amount.
const DENY = ['111', '222', '333', '444'];
const R4_THRESHOLD = 50n;

const ACTIVE = [1n, 1n, 1n, 0n];
const AMOUNTS = [60n, 30n, 10n, 0n];
const COUNTERS = [0n, 1n, 2n, 0n];

async function loadOracle(name) {
  const builder = require(path.resolve(`build/${name}_js/witness_calculator.js`));
  const wasm = fs.readFileSync(path.resolve(`build/${name}_js/${name}.wasm`));
  return builder(wasm);
}

async function main() {
  const wc2 = await loadOracle('poseidon2');
  const wc3 = await loadOracle('poseidon3');
  const wc4 = await loadOracle('poseidon4');
  const P2 = async (a, b) =>
    BigInt((await wc2.calculateWitness({ a: a.toString(), b: b.toString() }, 0))[1]);
  const P3 = async (a, b, c) =>
    BigInt(
      (await wc3.calculateWitness({ a: a.toString(), b: b.toString(), c: c.toString() }, 0))[1],
    );
  const P4 = async (a, b, c, d) =>
    BigInt(
      (
        await wc4.calculateWitness(
          { a: a.toString(), b: b.toString(), c: c.toString(), d: d.toString() },
          0,
        )
      )[1],
    );

  // One real membership path (all-zero co-path), reused for every active release.
  const leaf = await P3(PAYEE_FIELD, PAYEE_CAP, PAYEE_CATEGORY);
  const zeroPath = [];
  const zeroIndex = [];
  let cur = leaf;
  for (let i = 0; i < DEPTH; i++) {
    zeroPath.push('0');
    zeroIndex.push('0');
    cur = await P2(cur, 0n);
  }
  const r3Root = cur;

  // R6 windows root = H(start0, end0, start1, end1).
  const windowsRoot = await P4(WIN_START[0], WIN_END[0], WIN_START[1], WIN_END[1]);

  const payee_field = [];
  const amount = [];
  const active = [];
  const spend_counter = [];
  const payee_cap = [];
  const payee_category = [];
  const r3_path = [];
  const r3_index = [];
  for (let k = 0; k < N; k++) {
    const isActive = ACTIVE[k] === 1n;
    payee_field.push(isActive ? PAYEE_FIELD.toString() : '0');
    amount.push(AMOUNTS[k].toString());
    active.push(ACTIVE[k].toString());
    spend_counter.push(COUNTERS[k].toString());
    payee_cap.push(isActive ? PAYEE_CAP.toString() : '0');
    payee_category.push(PAYEE_CATEGORY.toString());
    r3_path.push([...zeroPath]);
    r3_index.push([...zeroIndex]);
  }

  const input = {
    payee_field,
    amount,
    valid_after: VALID_AFTER.toString(),
    valid_before: VALID_BEFORE.toString(),
    running_spend: RUNNING_SPEND.toString(),
    prior_count: PRIOR_COUNT.toString(),
    // Window anchors = valid_after => elapsed 0 => no tumbling-window reset, so the
    // existing running_spend/prior_count R2/R7 checks apply unchanged.
    anchor_r2: VALID_AFTER.toString(),
    anchor_r7: VALID_AFTER.toString(),
    en: ['1', '1', '1', '1', '1', '1', '1', '1'], // all R1-R8 enabled
    r1_ceiling: CEILING.toString(),
    r2_cap: R2_CAP.toString(),
    r2_window: '86400',
    r2_delegate: '0',
    r3_root: r3Root.toString(),
    r3_depth: DEPTH.toString(),
    r4_entries: DENY,
    r4_threshold: R4_THRESHOLD.toString(),
    r6_windows_root: windowsRoot.toString(),
    r7_max_count: R7_MAX_COUNT.toString(),
    r7_window: '86400',
    r8_cat_ceiling: CAT_CEILING,
    disclosure_tag: '0',
    salt: '88442211556677',
    r6_win_start: WIN_START.map((x) => x.toString()),
    r6_win_end: WIN_END.map((x) => x.toString()),
    active,
    spend_counter,
    r3_path,
    r3_index,
    payee_cap,
    payee_category,
  };

  fs.writeFileSync('build/policy-input.json', JSON.stringify(input, null, 2));
  console.log('r3_root =', r3Root.toString());
  console.log('windows_root =', windowsRoot.toString());
  console.log(`wrote build/policy-input.json (batch N=${N}: ALL R1-R8, 3 active + 1 null)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
