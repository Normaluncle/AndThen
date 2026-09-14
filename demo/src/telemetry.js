import { useEffect } from 'react';
import { api } from './api.js';

export function usePageView(route) {
  useEffect(() => {
    const id = crypto.randomUUID();
    const started = Date.now();
    const page = `/${location.search || '?screen=01'}`;
    const payload = (dwell) => ({
      client_event_id: id,
      page,
      dwell_ms: Math.min(1_800_000, Math.max(0, dwell)),
      ...(route.source ? { source_id: route.source } : {}),
      ...(route.followup ? { followup_id: route.followup } : {}),
    });
    api('/telemetry/page-view', 'POST', payload(0)).catch(() => {});
    const ping = () => api('/telemetry/page-view', 'POST', payload(Date.now() - started)).catch(() => {});
    const onHidden = () => { if (document.visibilityState === 'hidden') ping(); };
    window.addEventListener('pagehide', ping);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      ping();
      window.removeEventListener('pagehide', ping);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [route.screen, route.source, route.followup, route.candidate, route.tab]);
}
