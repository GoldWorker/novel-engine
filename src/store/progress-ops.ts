import type { Phase } from "../domain/phase.js";
import type { Progress } from "../domain/progress.js";
import {
  canTransitionPhase,
  validatePhaseTransition,
} from "../domain/phase.js";
import type { StorePort } from "../ports/store.js";

export async function advancePhase(store: StorePort, to: Phase): Promise<void> {
  const progress = await store.loadProgress();
  if (progress == null) {
    throw new Error("progress 未初始化");
  }
  if (canTransitionPhase(to, progress.phase)) {
    return;
  }
  validatePhaseTransition(progress.phase, to);
  await store.saveProgress({ ...progress, phase: to });
}

export async function requireProgress(store: StorePort): Promise<Progress> {
  const progress = await store.loadProgress();
  if (progress == null) {
    throw new Error("progress 未初始化");
  }
  return progress;
}
