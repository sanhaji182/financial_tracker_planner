import type { Asset } from '../services/assets';

export interface IndonesiaMarketPrices {
  goldAntamPerGramIdr: number;
  usdIdr: number;
  sgdIdr: number;
  sbnCouponPct: number;
  idxPrices: Record<string, number>;
  updatedAt: string;
  source: 'benchmark' | 'live' | 'manual';
}

export const MARKET_FEED_STORAGE_KEY = 'kb_id_market_feed_v1';

export const DEFAULT_INDONESIA_MARKET_PRICES: IndonesiaMarketPrices = {
  goldAntamPerGramIdr: 1_585_000,
  usdIdr: 15_850,
  sgdIdr: 11_820,
  sbnCouponPct: 6.4,
  idxPrices: {
    BBCA: 10_250,
    BMRI: 6_850,
    BBRI: 4_950,
    TLKM: 3_150,
    ASII: 5_100,
  },
  updatedAt: '2026-11-23T00:00:00Z',
  source: 'benchmark',
};

export function loadMarketPrices(): IndonesiaMarketPrices {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_INDONESIA_MARKET_PRICES };
    }
    const raw = window.localStorage.getItem(MARKET_FEED_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_INDONESIA_MARKET_PRICES };
    const parsed = JSON.parse(raw) as Partial<IndonesiaMarketPrices>;
    return {
      goldAntamPerGramIdr:
        typeof parsed.goldAntamPerGramIdr === 'number' && parsed.goldAntamPerGramIdr > 0
          ? parsed.goldAntamPerGramIdr
          : DEFAULT_INDONESIA_MARKET_PRICES.goldAntamPerGramIdr,
      usdIdr:
        typeof parsed.usdIdr === 'number' && parsed.usdIdr > 0
          ? parsed.usdIdr
          : DEFAULT_INDONESIA_MARKET_PRICES.usdIdr,
      sgdIdr:
        typeof parsed.sgdIdr === 'number' && parsed.sgdIdr > 0
          ? parsed.sgdIdr
          : DEFAULT_INDONESIA_MARKET_PRICES.sgdIdr,
      sbnCouponPct:
        typeof parsed.sbnCouponPct === 'number' && parsed.sbnCouponPct > 0
          ? parsed.sbnCouponPct
          : DEFAULT_INDONESIA_MARKET_PRICES.sbnCouponPct,
      idxPrices: {
        ...DEFAULT_INDONESIA_MARKET_PRICES.idxPrices,
        ...(parsed.idxPrices && typeof parsed.idxPrices === 'object' ? parsed.idxPrices : {}),
      },
      updatedAt: parsed.updatedAt || DEFAULT_INDONESIA_MARKET_PRICES.updatedAt,
      source: parsed.source || 'benchmark',
    };
  } catch {
    return { ...DEFAULT_INDONESIA_MARKET_PRICES };
  }
}

export function saveMarketPrices(prices: IndonesiaMarketPrices): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(MARKET_FEED_STORAGE_KEY, JSON.stringify(prices));
  } catch {
    // Ignore storage overflow
  }
}

/**
 * Refreshes USD/SGD->IDR FX rates from public exchange-rate feed with a 3.5s timeout,
 * falling back cleanly to cached benchmark values when offline or unreachable.
 */
export async function refreshMarketPricesLive(): Promise<IndonesiaMarketPrices> {
  const current = loadMarketPrices();
  if (typeof fetch !== 'function') {
    return current;
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 3500) : null;

  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller?.signal,
    });
    if (!resp.ok) {
      return current;
    }
    const json = (await resp.json()) as {
      rates?: Record<string, number>;
    };
    const idrPerUsd = json?.rates?.IDR;
    const sgdPerUsd = json?.rates?.SGD;
    if (typeof idrPerUsd === 'number' && idrPerUsd > 1000) {
      const updated: IndonesiaMarketPrices = {
        ...current,
        usdIdr: Math.round(idrPerUsd),
        sgdIdr:
          typeof sgdPerUsd === 'number' && sgdPerUsd > 0
            ? Math.round(idrPerUsd / sgdPerUsd)
            : current.sgdIdr,
        updatedAt: new Date().toISOString(),
        source: 'live',
      };
      saveMarketPrices(updated);
      return updated;
    }
  } catch {
    // Network unreachable or blocked in offline environment: return benchmark/cached safely
  } finally {
    if (timer) clearTimeout(timer);
  }

  return current;
}

/**
 * Matches Gold assets ("Emas Antam 15g") or IDX stocks ("Saham BBCA 20 lot")
 * and computes updated IDR valuation from live/benchmark prices.
 */
export function detectAssetMarketValuation(
  asset: Pick<Asset, 'name' | 'notes'>,
  prices: IndonesiaMarketPrices
): { estimatedValue: number; detailLabel: string } | null {
  const combined = `${asset.name || ''} ${asset.notes || ''}`;
  const lower = combined.toLowerCase();

  // 1. Gold asset match: "emas|antam|pegadaian|logam mulia" + "<N> g|gr|gram"
  if (/\b(emas|antam|pegadaian|logam\s*mulia)\b/i.test(lower)) {
    const mGram = combined.match(/(\d+(?:[.,]\d+)?)\s*(?:gram|gr|g)\b/i);
    if (mGram) {
      const grams = Number(mGram[1].replace(',', '.'));
      if (Number.isFinite(grams) && grams > 0) {
        return {
          estimatedValue: Math.round(grams * prices.goldAntamPerGramIdr),
          detailLabel: `${grams}g Emas @ Rp ${prices.goldAntamPerGramIdr.toLocaleString('id-ID')}/g`,
        };
      }
    }
  }

  // 2. IDX equity match: ticker in idxPrices + "<N> lot"
  for (const [ticker, sharePrice] of Object.entries(prices.idxPrices)) {
    if (sharePrice <= 0) continue;
    const tickerRegex = new RegExp(`\\b${ticker}\\b`, 'i');
    if (tickerRegex.test(combined)) {
      const mLot = combined.match(/(\d+(?:[.,]\d+)?)\s*lot\b/i);
      if (mLot) {
        const lots = Number(mLot[1].replace(',', '.'));
        if (Number.isFinite(lots) && lots > 0) {
          return {
            estimatedValue: Math.round(lots * 100 * sharePrice),
            detailLabel: `${lots} lot ${ticker} @ Rp ${sharePrice.toLocaleString('id-ID')}/lbr`,
          };
        }
      }
    }
  }

  return null;
}
