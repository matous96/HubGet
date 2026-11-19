/**
 * Spolehlivost verzí od komunity (store/reliability.ts): souhrn hlášení pro nabízené
 * aktualizace – po startu, po změně nabízených verzí a jednou za FETCH_INTERVAL.
 * Jen se zapnutým Nastavení → Aktualizace balíčků → Spolehlivost verzí od komunity.
 */
import { useEffect, useMemo } from "react";
import { useInstalled } from "@/hooks/usePackages";
import { useAutoUpdates } from "@/store/autoUpdates";
import { FETCH_INTERVAL, fetchReliability, reliabilityAvailable, useReliability } from "@/store/reliability";

/** Po chybě (bez sítě) zkusit znovu nejdřív za hodinu. */
const RETRY_MS = 60 * 60_000;
let failedAt = 0;

export function ReliabilityWatcher() {
  const enabled = useAutoUpdates((s) => s.communityReliability) && reliabilityAvailable();
  const { data } = useInstalled();
  const offered = useMemo(() => (data ?? []).filter((p) => p.availableVersion || p.heldVersion), [data]);
  const signature = useMemo(
    () => offered.map((p) => `${p.source}|${p.packageId}|${p.availableVersion ?? p.heldVersion}`).sort().join(","),
    [offered],
  );

  useEffect(() => {
    if (!enabled || !data) return;
    const run = () => {
      const { fetchedAt, signature: last } = useReliability.getState();
      const fresh = last === signature && fetchedAt && Date.now() - fetchedAt < FETCH_INTERVAL;
      if (fresh || Date.now() - failedAt < RETRY_MS) return;
      fetchReliability(offered, signature).catch(() => (failedAt = Date.now()));
    };
    run();
    const timer = setInterval(run, RETRY_MS);
    return () => clearInterval(timer);
  }, [enabled, data, offered, signature]);

  return null;
}
