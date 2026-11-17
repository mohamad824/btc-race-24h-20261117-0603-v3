# btc-race-24h-20261117-0603 v3 — dip-recovery swing bot

Long-only cbBTC/USDC trading bot for make.fun's "Race a BTC trading bot live
for 24 hours" ($250, top 10 by net PnL on the 24h race window).

## Strategy

- **Main arm:** close >= 100 bps below the trailing-60-bar high AND two
  consecutive up closes -> buy 98% of cash.
- **Deep arm:** close >= 350 bps below the trailing-360-bar high AND an up
  close -> buy 100% of cash (race-window washout catcher).
- **Fallback:** if no fill has ever landed by bar 1300, buy 98% of cash
  unconditionally, so a zero-trade finish is impossible by construction.
- **Exits (whole position):** take-profit +160 bps, hard stop -100 bps, time
  stop 480 bars; past bar 1200 the time stop is lifted while >= 40 bps in
  profit (hold to the close). 60-bar cooldown after a sell.
- Pure integer math on closes/fills only: no clock, no environment, no
  randomness. Deterministic: two runs produce byte-identical action logs.

## Files

- `main.ts` — the bot (Node 22, no dependencies beyond the vendored shim).
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied byte-for-byte.

## Verification

Graded locally with the kit's `grade-local --driver process` on the dev
window; determinism confirmed by the L1 regrade (reproduced byte for byte).
See the submission record for the numbers.
