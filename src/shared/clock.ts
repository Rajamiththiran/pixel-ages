// Real-time clock for pacing the worker loop (§9). Lives outside src/sim on purpose:
// the simulation must never read the clock (§16.2), only the loop that decides how
// many ticks to run. Speed never changes results because ticks are identical either way.
export const nowMs = (): number => performance.now();
