import { sweepExpiredCodes } from "@/lib/verification";

const SWEEP_INTERVAL_MS = 60 * 1000;

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const run = () => {
    sweepExpiredCodes().catch(() => {});
  };

  run();
  const interval = setInterval(run, SWEEP_INTERVAL_MS);
  if (typeof interval.unref === "function") interval.unref();
}