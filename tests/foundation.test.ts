import { describe, expect, it } from "vitest";
import layeredBook from "../fixtures/layered-book.json" with { type: "json" };
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  MemoryStore,
  PATHS,
  assembleNovelContext,
  writeJson,
  writeText,
  type Progress,
} from "../src/index.js";
import {
  foundationFingerprint,
  foundationMissing,
} from "../src/store/foundation.js";
import { parseLayeredVolumes } from "../src/store/layered.js";

const short = shortBook as {
  book: { title: string; synopsis: string };
  premise: string;
  outline: unknown[];
  characters: unknown[];
  world_rules: unknown[];
};

const layered = layeredBook as {
  book: { title: string; synopsis: string };
  premise: string;
  layered_outline: unknown[];
  characters: unknown[];
  world_rules: unknown[];
};

const writingProgress = (layeredFlag: boolean): Progress => ({
  phase: "writing",
  flow: "writing",
  totalChapters: layeredFlag ? 4 : 3,
  completedChapters: [],
  pendingRewrites: [],
  layered: layeredFlag,
});

describe("foundationMissing (S0 layered outline)", () => {
  it("short still requires a non-empty flat outline.json", async () => {
    const store = new MemoryStore();
    await writeJson(store, PATHS.book, short.book);
    await writeText(store, PATHS.premise, short.premise);
    await writeJson(store, PATHS.characters, short.characters);
    await writeJson(store, PATHS.worldRules, short.world_rules);
    await writeJson(store, PATHS.runMeta, { planningTier: "short" });

    expect(await foundationMissing(store)).toContain("outline");
    expect(await foundationMissing(store, "short")).toContain("outline");

    await writeJson(store, PATHS.outline, short.outline);
    expect(await foundationMissing(store, "short")).not.toContain("outline");
    expect(await foundationMissing(store, "short")).toEqual(["foundation_audit"]);
  });

  it("mid/long with only a valid layered_outline.json does not require flat outline.json", async () => {
    const store = new MemoryStore();
    await writeJson(store, PATHS.book, layered.book);
    await writeText(store, PATHS.premise, layered.premise);
    await writeJson(store, PATHS.layeredOutline, layered.layered_outline);
    await writeJson(store, PATHS.characters, layered.characters);
    await writeJson(store, PATHS.worldRules, layered.world_rules);

    expect(await store.has(PATHS.outline)).toBe(false);
    expect(await foundationMissing(store, "mid")).not.toContain("outline");
    expect(await foundationMissing(store, "long")).not.toContain("outline");
    expect(await foundationMissing(store, "short")).toContain("outline");

    await writeJson(store, PATHS.runMeta, { planningTier: "mid" });
    expect(await foundationMissing(store)).not.toContain("outline");
    expect(await foundationMissing(store)).toEqual(["foundation_audit"]);
  });

  it("infers mid from progress.layered / planningTier when run_meta is empty", async () => {
    const store = new MemoryStore();
    await writeJson(store, PATHS.book, layered.book);
    await writeText(store, PATHS.premise, layered.premise);
    await writeJson(store, PATHS.layeredOutline, layered.layered_outline);
    await writeJson(store, PATHS.characters, layered.characters);
    await writeJson(store, PATHS.worldRules, layered.world_rules);
    await store.saveProgress({
      ...writingProgress(true),
      phase: "outline",
      planningTier: "long",
    });

    expect(await foundationMissing(store)).not.toContain("outline");
    expect(await foundationMissing(store)).toEqual(["foundation_audit"]);
  });

  it("still reports world_rules (and other) gaps when layered outline is present", async () => {
    const store = new MemoryStore();
    await writeJson(store, PATHS.book, layered.book);
    await writeText(store, PATHS.premise, layered.premise);
    await writeJson(store, PATHS.layeredOutline, layered.layered_outline);
    await writeJson(store, PATHS.characters, layered.characters);
    await writeJson(store, PATHS.runMeta, { planningTier: "mid" });

    const missing = await foundationMissing(store, "mid");
    expect(missing).toContain("world_rules");
    expect(missing).not.toContain("outline");
  });

  it("does not treat an empty or invalid layered_outline as satisfying outline", async () => {
    const store = new MemoryStore();
    await writeJson(store, PATHS.runMeta, { planningTier: "mid" });
    await writeJson(store, PATHS.layeredOutline, []);
    expect(await foundationMissing(store, "mid")).toContain("outline");

    await writeJson(store, PATHS.layeredOutline, [{ title: "no-arcs" }]);
    expect(await foundationMissing(store, "mid")).toContain("outline");
  });

  it("ready when writing/complete; foundation_audit when other artifacts exist but phase is not writing", async () => {
    const store = new MemoryStore();
    await writeJson(store, PATHS.book, layered.book);
    await writeText(store, PATHS.premise, layered.premise);
    await writeJson(store, PATHS.layeredOutline, layered.layered_outline);
    await writeJson(store, PATHS.characters, layered.characters);
    await writeJson(store, PATHS.worldRules, layered.world_rules);

    expect(await foundationMissing(store, "mid")).toEqual(["foundation_audit"]);

    await store.saveProgress(writingProgress(true));
    expect(await foundationMissing(store, "mid")).toEqual([]);

    await store.saveProgress({ ...writingProgress(true), phase: "complete" });
    expect(await foundationMissing(store, "mid")).toEqual([]);
  });

  it("fingerprints a layered-only book without throwing on missing outline.json", async () => {
    const store = new MemoryStore();
    await writeJson(store, PATHS.book, layered.book);
    await writeText(store, PATHS.premise, layered.premise);
    await writeJson(store, PATHS.layeredOutline, parseLayeredVolumes(layered.layered_outline));
    await writeJson(store, PATHS.characters, layered.characters);
    await writeJson(store, PATHS.worldRules, layered.world_rules);

    const hash = await foundationFingerprint(store);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);

    const context = await assembleNovelContext(store);
    const status = context.foundation_status as { missing: string[]; fingerprint: string | null };
    expect(status.missing).toEqual(["foundation_audit"]);
    expect(status.fingerprint).toBe(hash);
  });
});
