import { useEffect, useState } from 'react';

import { displayTimeZone, formatClock } from '../../timezone';

export default function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <p className="text-sm font-semibold text-slate-600">
      {displayTimeZone.replace('_', ' ')}{' '}
      <span className="font-mono text-base text-slate-900">{formatClock(now)}</span>
    </p>
  );
}
