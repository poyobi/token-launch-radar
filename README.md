# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/poyobi/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/poyobi/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Token Launch Radar** ranks every protocol in the sealed DefiLlama snapshot that records no token yet — 273 of them at $10M of TVL and up, the 40-protocol house watchlist included and starred — by the implied value of the token it could one day issue, and gives each one a concrete farm plan. The model is computed from the snapshot's own figures, never from a hardcoded list: implied value = TVL × a category multiple (the median market-cap/TVL of the snapshot's tokenised protocols in the same category, shrunk toward the global median) × a momentum factor from the seven-day TVL change × a maturity factor for years tracked with no token × a class factor that cuts wrappers of already-trading assets to 3%, because their token could only ever claim the fees. The dashboard is sortable and filterable (search, category, chain, minimum value, watchlist-only), every row opens a detail view showing the model's arithmetic for that protocol, and a calibration panel sets the model beside the protocols whose tokens already trade.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

then serve `out/` with any static file server and open `out/dashboard/index.html` — the page reads `out/data.js` and renders entirely offline. The program is deterministic: two runs write the same bytes.

---
<sub>Entered on [make.fun](https://make.fun/?ref=sfcm9bvc&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
