// v3: dip-recovery swing bot for btc-race-24h-20261117-0603.
//
// Long-only cbBTC/USDC, $1,000 paper. One position at most. Pure integer math
// on closes/fills only: no clock, no environment, no randomness.
//
// Entry arms (flat only, 60-bar cooldown after a sell):
//   MAIN: close >= 100 bps below the trailing-60-bar high AND two consecutive
//         up closes -> buy 98% of cash.
//   DEEP: close >= 350 bps below the trailing-360-bar high AND an up close
//         -> buy 100% of cash (race-window washout catcher).
//   FALLBACK: if no fill has ever landed by bar 1300 -> buy 98% of cash
//         unconditionally (a zero-trade finish is impossible by construction).
//         The fallback retries on every later bar while still flat and
//         fill-less, so a rejected first attempt cannot strand the entry.
// Exits (whole position): take-profit +160 bps, hard stop -100 bps, time stop
// 480 bars; past bar 1200 the time stop is lifted while >= 40 bps in profit
// (hold to the close). Entry price is the buy fill's own price; all thresholds
// are integer basis-point comparisons against it.

import { runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10000n;

// ---- parameters (basis points / bars) ----
const MAIN_WINDOW = 60;
const MAIN_DIP_BPS = 100n;
const MAIN_SIZE_BPS = 9800n;
const DEEP_WINDOW = 360;
const DEEP_DIP_BPS = 350n;
const TP_BPS = 160n;
const STOP_BPS = 100n;
const HOLD_BARS = 480;
const COOLDOWN_BARS = 60;
const FALLBACK_BAR = 1300;
const LATE_BAR = 1200;
const LATE_HOLD_PROFIT_BPS = 40n;
const MAX_SLIPPAGE_BPS = 10000;

const closes: bigint[] = [];
let entryPrice = 0n; // fill price of the buy that opened the position
let entrySeq = -1; // seq of the batch that reported the buy fill
let lastSellSeq = -1000000;
let fillsSeen = 0;

function trailingHigh(window: number): bigint {
  let m = 0n;
  const start = Math.max(0, closes.length - window);
  for (let i = start; i < closes.length; i++) if (closes[i]! > m) m = closes[i]!;
  return m;
}

function upCloses(n: number): boolean {
  const len = closes.length;
  if (len < n + 1) return false;
  for (let j = 0; j < n; j++) {
    if (closes[len - 1 - j]! <= closes[len - 2 - j]!) return false;
  }
  return true;
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar !== undefined) closes.push(BigInt(bar.c));

    // Learn entry price / fill count from this batch's fills.
    for (const f of batch.fills) {
      if (f.symbol !== SYMBOL || f.status !== 'filled') continue;
      fillsSeen++;
      if (f.side === 'buy') {
        entryPrice = BigInt(f.price);
        entrySeq = batch.seq;
      }
    }

    const pos = state.positions.get(SYMBOL);
    const qty = pos?.qty ?? 0n;
    const close = closes.length > 0 ? closes[closes.length - 1]! : 0n;
    if (close === 0n || state.warmingUp) return [];

    if (qty > 0n && entryPrice > 0n) {
      // ---- exits ----
      const profitBps = ((close - entryPrice) * BPS) / entryPrice;
      const held = batch.seq - entrySeq;
      if (profitBps >= TP_BPS || profitBps <= -STOP_BPS) {
        lastSellSeq = batch.seq;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      const lateHold = batch.seq >= LATE_BAR && profitBps >= LATE_HOLD_PROFIT_BPS;
      if (!lateHold && held >= HOLD_BARS) {
        lastSellSeq = batch.seq;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // ---- entries (flat) ----
    if (batch.seq - lastSellSeq < COOLDOWN_BARS) return [];
    if (batch.seq >= 1439) return []; // last batch: orders are rejected after_end

    const hi360 = trailingHigh(DEEP_WINDOW);
    if (hi360 > 0n && close * BPS <= hi360 * (BPS - DEEP_DIP_BPS) && upCloses(1)) {
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    const hi60 = trailingHigh(MAIN_WINDOW);
    if (hi60 > 0n && close * BPS <= hi60 * (BPS - MAIN_DIP_BPS) && upCloses(2)) {
      const notional = (state.cash * MAIN_SIZE_BPS) / BPS;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    if (fillsSeen === 0 && batch.seq >= FALLBACK_BAR) {
      const notional = (state.cash * MAIN_SIZE_BPS) / BPS;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
