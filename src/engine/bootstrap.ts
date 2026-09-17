import type { Progress } from "../domain/progress.js";
import type { StorePort } from "../ports/store.js";
import type { RunMeta } from "../store/artifacts.js";
import { readJson, writeJson } from "../store/io.js";
import { PATHS } from "../store/paths.js";

const emptyProgress = (): Progress => ({
  phase: "init",
  flow: "writing",
  totalChapters: 0,
  completedChapters: [],
  pendingRewrites: [],
  layered: false,
});

/** Ensure Progress exists and optionally record the start prompt. */
export async function bootstrap(store: StorePort, prompt?: string): Promise<void> {
  const progress = await store.loadProgress();
  if (progress == null) {
    await store.saveProgress(emptyProgress());
  }
  if (prompt === undefined) {
    return;
  }
  const trimmed = prompt.trim();
  if (trimmed === "") {
    return;
  }
  const meta = (await readJson<RunMeta>(store, PATHS.runMeta)) ?? {};
  await writeJson(store, PATHS.runMeta, { ...meta, startPrompt: trimmed });
}
