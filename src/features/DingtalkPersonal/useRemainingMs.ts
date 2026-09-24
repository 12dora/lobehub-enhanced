'use client';

import { useEffect, useState } from 'react';

/** Milliseconds left until `expiresAt`, ticking every second; `undefined` without a deadline. */
export const useRemainingMs = (expiresAt: string | undefined): number | undefined => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (!expiresAt) return undefined;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) ? Math.max(0, expiry - now) : undefined;
};
