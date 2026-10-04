'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useCurrencyStore } from '@/store/currency';
import { formatARS, formatUSD, arsToUsd } from '@/lib/format';

const FALLBACK_RATE = 1200;

export function useFx() {
  const { showUSD, toggle } = useCurrencyStore();
  const supabase = createClient();

  const { data: fx } = useQuery({
    queryKey: ['fx-rate-blue'],
    queryFn: async () => {
      const { data } = await supabase
        .from('fx_rates')
        .select('ars_per_usd, date')
        .eq('source', 'blue')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    staleTime: 1000 * 60 * 60,
  });

  const arsPerUsd = fx?.ars_per_usd ?? FALLBACK_RATE;
  // The rate is "stale" if we fell back to the hardcoded default or the latest
  // stored rate is more than 3 days old (the cron refreshes it daily), so the UI
  // can warn that USD conversions are approximate.
  const fxDate = fx?.date ?? null;
  const [nowMs] = useState(() => Date.now());
  const rateStale = useMemo(() => {
    if (!fxDate) return true;
    const ageDays = (nowMs - new Date(fxDate + 'T00:00:00').getTime()) / 86400000;
    return ageDays > 3;
  }, [fxDate, nowMs]);

  // Stable across renders (only changes with the currency toggle or the rate),
  // so children memoized on these callbacks don't re-render needlessly.
  const format = useCallback(
    (ars: number): string => (showUSD ? formatUSD(arsToUsd(ars, arsPerUsd)) : formatARS(ars)),
    [showUSD, arsPerUsd],
  );

  const secondary = useCallback(
    (ars: number): string =>
      showUSD ? formatARS(ars) : `≈ ${formatUSD(arsToUsd(ars, arsPerUsd))}`,
    [showUSD, arsPerUsd],
  );

  return { arsPerUsd, rateStale, showUSD, toggle, format, secondary };
}
