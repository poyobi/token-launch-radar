// Token Launch Radar — the model. Everything the board claims is derived
// from the sealed snapshot's own figures; nothing is a hardcoded opinion
// about a named protocol.
//
// The implied value of a protocol that records no token is:
//
//   implied = TVL x category multiple x momentum x maturity x class factor
//
// - category multiple: the median market-cap/TVL ratio of the snapshot's
//   tokenised protocols in the same DefiLlama category, shrunk toward the
//   global median (0.205 across 129 tokenised protocols) by peer count, so a
//   category with two peers leans on the market as a whole and one with
//   twenty stands on its own. A multiple is what the market already pays for
//   a dollar of TVL in that business; it is the honest yardstick a launch
//   would be priced against.
// - momentum: the seven-day TVL change, clamped, worth -15% to +36%.
//   Protocols gathering assets into a launch are worth more than shrinking
//   ones; a week is noisy, so the factor stays modest.
// - maturity: how long DefiLlama has tracked the protocol with no token,
//   worth -12% to +12% over six years. Time live without a token means real
//   users who would have to be rewarded, and a team that has not rushed.
// - class factor: what a token of this product could actually claim.
//   A wrapper or staking product of an asset that already trades (a wrapped
//   BTC product, a staked-ETH product) could only ever tokenise its fees, so
//   it takes 3% of the naive figure; a bridge conduit's TVL is other
//   protocols' assets in transit, so it takes 15%; a versioned deployment
//   (a V2 beside its flagship) takes half. Everything else takes the full
//   figure. The tests read the product's form — its category and the shape
//   of its name — never a list of names.
//
// The board ranks every protocol that records no token and holds at least
// $10M of TVL: the 40-protocol watchlist is the floor of the board, never
// its ceiling. Protocols whose token already trades are set aside as the
// calibration set the multiples come from, and the dashboard shows them
// separately so the reader can see the model beside the market.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  category_multiple: number;
  category_peers: number;
  momentum_factor: number;
  maturity_factor: number;
  class_factor: number;
  product_class: string;
}

export interface RadarRow extends BoardRow {
  age_days: number | null;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  model_value_usd: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  stats: { protocols: number; pre_token: number; board_rows: number; watchlist: number; live: number };
  category_multiples: { category: string; multiple: number; peers: number }[];
  rows: RadarRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'launch-radar-2';
export const BOARD_MIN_TVL = 10_000_000;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot: protocols and watchlist must be arrays');
  return raw;
}

export const isPreToken = (p: SnapshotProtocol): boolean => p.gecko_id === null && p.symbol === null;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/** Median of a numeric list, on a sorted copy so runs are byte-identical. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The market's own yardsticks: median mcap/TVL per category, shrunk to the global median. */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, { multiple: number; peers: number }>; global: number } {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const global = ratios.length > 0 ? median(ratios) : 0.2;
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [category, list] of perCategory) {
    const own = median(list);
    const shrunk = (list.length * own + 4 * global) / (list.length + 4);
    byCategory.set(category, { multiple: clamp(shrunk, 0.02, 1.6), peers: list.length });
  }
  return { byCategory, global };
}

const ASSET_PRODUCT_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Canonical Bridge', 'Stablecoin Wrapper', 'Anchor BTC', 'Decentralized BTC']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** What a token of this product could actually claim on its TVL. */
export function productClass(p: SnapshotProtocol): { key: string; factor: number } {
  const nameWords = p.name.toLowerCase().split(/[^a-z0-9]+/);
  const wrapsAsset = (p.category !== null && ASSET_PRODUCT_CATEGORIES.has(p.category))
    || nameWords.includes('wrapped') || nameWords.includes('staked') || nameWords.includes('staking')
    || /^[A-Z0-9]{2,6}$/.test(p.name.trim());
  if (wrapsAsset) return { key: 'asset product', factor: 0.03 };
  if (p.category === 'Bridge' || p.category === 'Cross Chain Bridge') return { key: 'bridge conduit', factor: 0.15 };
  if (VERSIONED.test(p.name)) return { key: 'versioned', factor: 0.5 };
  if (p.category === 'CEX' || p.category === 'CeDeFi') return { key: 'exchange', factor: 1 };
  return { key: 'protocol', factor: 1 };
}

export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return round4(1 + clamp(change7d, -25, 60) * 0.006);
}

export function maturityFactor(asOf: string, listedAt: string | null): number {
  const days = ageDays(asOf, listedAt);
  if (days === null) return 1;
  const years = days / 365.25;
  return round4(0.88 + 0.24 * (Math.min(years, 6) / 6));
}

export interface Scored {
  implied: number;
  multiple: number;
  peers: number;
  momentum: number;
  maturity: number;
  classKey: string;
  classFactor: number;
}

export function impliedValue(p: SnapshotProtocol, snapshot: Snapshot, multiples: ReturnType<typeof categoryMultiples>): Scored {
  const entry = multiples.byCategory.get(p.category ?? 'Uncategorised');
  const multiple = entry?.multiple ?? multiples.global;
  const peers = entry?.peers ?? 0;
  const momentum = momentumFactor(p.change_7d);
  const maturity = maturityFactor(snapshot.as_of, p.listed_at);
  const cls = productClass(p);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * cls.factor));
  return { implied, multiple: round4(multiple), peers, momentum, maturity, classKey: cls.key, classFactor: cls.factor };
}

/** Rough per-transaction network cost by chain, for honest farm-plan budgets. */
const CHAIN_GAS: Record<string, number> = {
  Ethereum: 6, Solana: 0.05, Bitcoin: 2, Binance: 0.4, Arbitrum: 0.3, Base: 0.25, Avalanche: 0.6,
  Optimism: 0.3, Polygon: 0.05, 'Hyperliquid L1': 0.1, Tron: 1.2, Monad: 0.05, Sui: 0.05, Aptos: 0.05,
  'BNB Chain': 0.4, Gnosis: 0.05, Linea: 0.3, Scroll: 0.3, Mantle: 0.2, Sonic: 0.05, Berachain: 0.2,
};

export function cheapestChain(chains: string[]): { chain: string; gas: number } {
  let best: { chain: string; gas: number } | null = null;
  for (const chain of chains) {
    const gas = CHAIN_GAS[chain] ?? 1;
    if (best === null || gas < best.gas) best = { chain, gas };
  }
  return best ?? { chain: 'Ethereum', gas: 6 };
}

function sizeTier(tvl: number): string {
  if (tvl >= 1_000_000_000) return '$5,000-$25,000';
  if (tvl >= 100_000_000) return '$2,500-$10,000';
  if (tvl >= 25_000_000) return '$1,000-$5,000';
  return '$250-$2,000';
}

function holdWindow(asOf: string, listedAt: string | null): string {
  const days = ageDays(asOf, listedAt);
  if (days === null) return '8-12 weeks';
  if (days < 365) return '10-14 weeks';
  if (days < 365 * 3) return '8-12 weeks';
  return '6-10 weeks';
}

interface PlanContext {
  name: string;
  category: string;
  home: string;
  cheap: string;
  gas: string;
  size: string;
  weeks: string;
  chains: number;
}

/** One playbook per line of business; each step carries a cost and a duration. */
const PLAYBOOKS: Record<string, (c: PlanContext) => string[]> = {
  lending: (c) => [
    `Open an account position on ${c.name} through its ${c.home} deployment and supply ${c.size} of a blue-chip asset (ETH or a major stablecoin) as collateral; funding and the first supply cost about ${c.gas} in network fees on ${c.cheap}, and the position starts earning supply yield the same day.`,
    `Borrow 30-45% against the collateral and re-supply the borrowed asset to build a genuine two-sided history; keep the health factor above 1.6 at all times, expect about ${c.gas} per adjustment on ${c.cheap}, and never let the loop run unattended through volatile weeks.`,
    `Hold the position open for ${c.weeks}, repaying and re-borrowing at least twice a month so the activity reads as use rather than a parked deposit; total network fees over the window run roughly 6-10 times ${c.gas}, plus the borrow interest spread.`,
    `Vote in any ${c.name} governance or risk-parameter polls that open to depositors and keep a record of the wallet's supply, borrow and repayment history; if a points or season page appears, register the same wallet rather than starting a fresh one.`,
    `Review the position every two weeks: if TVL or the seven-day trend turns down for a month, unwind to a plain supply position but keep the wallet's history intact, because retroactive launches reward the full record, not the final balance.`,
  ],
  trading: (c) => [
    `Fund a ${c.name} account on ${c.cheap} with ${c.size} of trading capital; the deposit and first trades cost about ${c.gas} in network fees, and maker orders usually carry the lowest fee tier while the account is new.`,
    `Trade two or three liquid pairs every week for ${c.weeks}, mixing maker and taker orders and keeping individual trades between $200 and $2,000 so volume and trade count both grow; budget 0.05-0.15% of volume in trading fees across the window.`,
    `Use one advanced feature properly rather than skimming everything: a limit-order strategy, a vault, or the API; depth of use is the signal most launch snapshots weight above raw volume, and it costs nothing beyond the trades themselves.`,
    `Join the ${c.name} community channels, vote on fee or listing polls when they open, and link the same wallet to any points, season or leaderboard page the moment one appears; late registration is the most common way farmers lose a season.`,
    `Keep a simple log of weekly volume, fees paid and open positions; if a launch or snapshot is announced, stop wash-like patterns immediately, hold a natural position, and let the recorded history speak for itself.`,
  ],
  yield: (c) => [
    `Deposit ${c.size} into ${c.name}'s flagship vault or pool on ${c.cheap}; entry costs about ${c.gas} in network fees, and choosing the vault holding the largest share of the protocol's TVL puts the wallet in the cohort a launch would reward first.`,
    `Stay deposited for ${c.weeks} without round-tripping: harvest or compound the yield at most once a week (about ${c.gas} per claim on ${c.cheap}), because holding duration, not deposit count, is what separates farmers from tourists.`,
    `Split a second, smaller deposit across one newer vault or chain deployment of ${c.name}; breadth across the protocol's ${c.chains} chain footprint is cheap insurance if the launch weights early adopters of new markets.`,
    `Read the strategy behind the vault before adding size: know which lending market, basis trade or liquidity pool the yield comes from, and cap total exposure at an amount whose full loss would be acceptable if the strategy breaks.`,
    `Track the vault's share price and the protocol's TVL trend monthly; if yield falls below a plain lending rate for a month, rotate out slowly rather than exiting in one transaction, and keep the historical deposit record untouched.`,
  ],
  allocator: (c) => [
    `Allocate ${c.size} through ${c.name} on ${c.cheap}, choosing the vault or market whose curator strategy is easiest to explain in one sentence; entry costs about ${c.gas}, and clarity about where the money sits matters more than chasing the highest quoted APY.`,
    `Keep the allocation live for ${c.weeks}, adding a small top-up monthly rather than depositing once; a steady balance curve is the pattern curators and protocols cite when they design loyalty or launch rewards.`,
    `Diversify across two strategies inside ${c.name} if it offers them, so the wallet appears in more than one risk book; rebalancing costs about ${c.gas} per move on ${c.cheap} and should happen at most once a month.`,
    `Follow the curator's published risk reports and governance posts, and vote where depositors are polled; allocators launching tokens have historically weighted depositors who stayed through a drawdown, so avoid panic exits on red weeks.`,
    `Keep a written note of entry dates, amounts and strategy names; if a points program or token is announced, that record is what lets you verify eligibility quickly instead of reconstructing it from an explorer under deadline.`,
  ],
  bridge: (c) => [
    `Make ${c.name} your default route for real transfers: bridge $500-$2,000 at a time between two of its ${c.chains} supported chains, starting on ${c.cheap} where a transfer costs about ${c.gas} plus the bridge's own fee of roughly 0.05-0.3%.`,
    `Bridge in both directions at least twice a month for ${c.weeks}; round trips with genuine purpose (funding an account, moving to a cheaper chain) build the volume and route diversity that bridge launches have rewarded.`,
    `Vary the asset as well as the route: move a stablecoin one month and ETH or a chain's native asset the next, since several past bridge tokens weighted distinct routes and assets, not just total dollars moved.`,
    `Hold a small balance on the destination chain for a few days after each transfer instead of bridging straight back; instant round trips read as farming, and the gas saving from patience is real on ${c.cheap}.`,
    `Watch for a ${c.name} points, quests or integrator program and connect the same wallet the week it opens; bridges often backdate the first season to prior transfers, which is exactly the history these steps create.`,
  ],
  exchange: (c) => [
    `Complete full KYC on ${c.name} and enable every account-security step; exchange launches and loyalty drops have consistently required verified accounts, and an unverified balance earns nothing in any of their programs.`,
    `Hold a working balance of ${c.size} on the exchange and route your ordinary spot trades through it for ${c.weeks}; ordinary fee spend, not balance size alone, is what exchange loyalty tiers and launchpool allocations are calculated from.`,
    `Join each launchpool, launchpad or rewards campaign as it opens and stake the minimum that reaches the middle allocation tier; campaigns typically run 5-10 days, and missing one costs more than the staking lockup does.`,
    `Use one product beyond spot trading - earn, margin with strict limits, or the exchange's card if offered - and keep the activity modest and explainable; breadth across products is a published factor in several exchange token distributions.`,
    `Keep monthly statements and a note of campaign participation; if ${c.name} ever issues a token of its own, eligibility will be checked against exactly this record, and disputes are only winnable with documentation.`,
  ],
  rwa: (c) => [
    `Pass ${c.name}'s onboarding and accreditation checks if the product requires them, then make a first allocation of ${c.size} to its shortest-duration asset; onboarding is free but can take 3-10 business days, so start it before funding anything.`,
    `Hold the position for at least ${c.weeks}: real-world-asset launches reward duration because the underlying loans and bills run for months, and early redemption usually forfeits any loyalty or points accrual entirely.`,
    `Reinvest distributions rather than withdrawing them, and add a second, smaller allocation to a different asset on the platform if one is offered; two product lines held to term is a stronger record than one large deposit.`,
    `Read the monthly attestation or reserve report for the asset you hold and keep copies; RWA risk sits off-chain, and the discipline of checking reports is what keeps a farm from becoming an unmonitored loan.`,
    `Calendar the maturity dates and decide a month ahead whether to roll or exit; if a token or points program is announced mid-hold, staying to maturity has historically been the behaviour these protocols design rewards around.`,
  ],
  infra: (c) => [
    `Become a real user of ${c.name} on ${c.cheap}: complete its core action (a payment, a policy, a deployment or a transaction, depending on the product) with ${c.size} at stake, costing about ${c.gas} in network fees per action.`,
    `Repeat the core action on a natural cadence - weekly or monthly, never in bursts - for ${c.weeks}; infrastructure launches measure retained usage over time, and a steady twelve-week record outweighs a single large day.`,
    `Bring one piece of genuine feedback to the ${c.name} community channel or governance forum: a bug report, a documentation fix or a reasoned vote; small teams remember the wallets that helped before any token existed.`,
    `If the protocol runs testnets, quests or an ambassador program, join with the same wallet and finish the published tasks; these lists are the cheapest eligibility a launch team can snapshot, and they are used.`,
    `Keep the wallet's activity consistent after any announcement: sudden changes in pattern in the final weeks are the first thing sybil filters remove, so the best endgame is to keep doing exactly what built the record.`,
  ],
};

function playbookFor(category: string | null, cls: string): (c: PlanContext) => string[] {
  if (cls === 'exchange') return PLAYBOOKS.exchange!;
  if (cls === 'asset product') return PLAYBOOKS.yield!;
  switch (category) {
    case 'Lending': case 'CDP': case 'CDP Manager': case 'Uncollateralized Lending': case 'Collateral Markets': return PLAYBOOKS.lending!;
    case 'Dexs': case 'Derivatives': case 'Options Vault': case 'Prediction Market': case 'OTC Marketplace': return PLAYBOOKS.trading!;
    case 'Yield': case 'Yield Aggregator': case 'Farm': case 'Leveraged Farming': case 'Liquidity Manager': case 'Indexes': case 'Staking Pool': return PLAYBOOKS.yield!;
    case 'Risk Curators': case 'Onchain Capital Allocator': case 'Basis Trading': return PLAYBOOKS.allocator!;
    case 'Bridge': case 'Cross Chain Bridge': return PLAYBOOKS.bridge!;
    case 'RWA': return PLAYBOOKS.rwa!;
    default: return PLAYBOOKS.infra!;
  }
}

const money = (v: number): string => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);

export function farmSteps(p: SnapshotProtocol, snapshot: Snapshot, cls: string): string[] {
  const cheap = cheapestChain(p.chains);
  const ctx: PlanContext = {
    name: p.name,
    category: p.category ?? 'protocol',
    home: p.chains[0] ?? 'Ethereum',
    cheap: cheap.chain,
    gas: money(cheap.gas),
    size: sizeTier(p.tvl_usd),
    weeks: holdWindow(snapshot.as_of, p.listed_at),
    chains: p.chains.length,
  };
  return playbookFor(p.category, cls)(ctx).map((step) => step.trim());
}

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const multiples = categoryMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => isPreToken(p) && p.tvl_usd >= BOARD_MIN_TVL)
    .map((p) => ({ p, score: impliedValue(p, snapshot, multiples) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, score }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: score.implied,
    farm_steps: farmSteps(p, snapshot, score.classKey),
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    watchlist: watchlist.has(p.slug),
    category_multiple: score.multiple,
    category_peers: score.peers,
    momentum_factor: score.momentum,
    maturity_factor: score.maturity,
    class_factor: score.classFactor,
    product_class: score.classKey,
  }));
}

/** The calibration set: protocols whose token already trades, model beside market. */
export function liveRows(snapshot: Snapshot, limit = 24): LiveRow[] {
  const multiples = categoryMultiples(snapshot);
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      model_value_usd: impliedValue(p, snapshot, multiples).implied,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const multiples = categoryMultiples(snapshot);
  const board = buildBoard(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: round4(multiples.global),
    stats: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      board_rows: board.length,
      watchlist: snapshot.watchlist.length,
      live: snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length,
    },
    category_multiples: [...multiples.byCategory.entries()]
      .map(([category, v]) => ({ category, multiple: round4(v.multiple), peers: v.peers }))
      .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1)),
    rows: board.map((row) => ({ ...row, age_days: ageDays(snapshot.as_of, row.listed_at) })),
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The gate's shape, checked before anything is written: refuse early, in plain words. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (const [i, row] of board.entries()) {
    if (!slugs.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i + 1}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${i + 1}: implied value is not a positive whole number`;
    if (row.implied_value_usd > previous) return `row ${i + 1}: implied value rises as rank ascends`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1}: ${row.farm_steps.length} farm steps, outside 3-12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters, outside 20-600`;
    }
  }
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  if (board.every((row) => row.implied_value_usd === board[0]!.implied_value_usd)) return 'every implied value is the same: the board ranks nothing';
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
