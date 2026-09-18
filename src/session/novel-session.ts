import {
  AbortedError,
  attachAbort,
  isAbortError,
  throwIfAborted,
  toAbortedError,
} from "../abort.js";
import type { Progress } from "../domain/progress.js";
import {
  createEngine,
  EngineError,
  type Engine,
  type EngineDeps,
  type EngineLoopEvent,
} from "../engine/index.js";
import type { LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import type {
  BookMetadata,
  Character,
  FoundationAudit,
  OutlineEntry,
  VolumeOutline,
  WorldRule,
} from "../store/artifacts.js";
import { foundationMissing } from "../store/foundation.js";
import { readJson, readText } from "../store/io.js";
import { loadLayeredOutline } from "../store/layered.js";
import { listStorePaths } from "../store/list-paths.js";
import { PATHS } from "../store/paths.js";
import { exportBookSnapshot, importBookSnapshot } from "../store/snapshot.js";
import {
  FoundationIncompleteError,
  SessionBusyError,
  SessionClosedError,
  SessionLlmRequiredError,
} from "./errors.js";
import { writeFoundationPatch } from "./foundation-write.js";
import { gapsFromMissing, isAuditOnlyGaps } from "./gaps.js";
import {
  assertFoundationKeys,
  completeFoundationJson,
  keysToGenerate,
  missingKeysFromGaps,
  patchFromGeneratedJson,
} from "./generate.js";
import { createChapterRunner, runChapterWrite } from "./chapter.js";
import {
  assessProposedFoundation,
  defaultRewriteInstruction,
  listWrittenChapters,
  uniqueSorted,
} from "./impact.js";
import { resolveSessionPlanning } from "./planning.js";
import type {
  ApplyFoundationChangeOptions,
  ApplyFoundationChangeResult,
  AssessFoundationImpactOptions,
  AutoWriteResult,
  BookControlResult,
  ChapterRunner,
  ChapterWriteResult,
  CreateNovelSessionOptions,
  FoundationImpactAssessment,
  FoundationMeta,
  FoundationPatch,
  GenerateFoundationOptions,
  InspectResult,
  NovelSession,
  SessionEvent,
  SessionRunState,
  SessionUnsubscribe,
  StartAutoWriteOptions,
} from "./types.js";

function asArray<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
}

export class NovelSessionImpl implements NovelSession {
  readonly bookId: string;
  readonly store: StorePort;
  readonly llm: LlmPort | undefined;
  readonly chapter: ChapterRunner;
  private closed = false;
  private busy = false;
  /** Engine instance held only while `startAutoWrite` → `Engine.run` is in flight. */
  private runningEngine: Engine | null = null;
  /** Standalone `generateFoundation` (not busy-locked). */
  private generating = false;
  /** `startAutoWrite` after busy is taken, before `Engine.run`. */
  private autoWritePreEngine = false;
  private readonly abortCtls = new Set<AbortController>();
  private readonly listeners = new Set<(event: SessionEvent) => void>();

  constructor(options: CreateNovelSessionOptions) {
    this.bookId = options.bookId;
    this.store = options.store;
    this.llm = options.llm;
    this.chapter = createChapterRunner({
      store: this.store,
      requireOpen: () => this.assertOpen(),
      requireLlm: () => this.requireLlm(),
      withBusy: (fn, external) => this.withBusy(fn, external),
      emit: (event) => this.emit(event),
      upsertFoundation: (patch) => this.upsertFoundation(patch),
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  subscribe(listener: (event: SessionEvent) => void): SessionUnsubscribe {
    this.assertOpen();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getFoundation(): Promise<FoundationMeta> {
    this.assertOpen();
    return this.readFoundation();
  }

  async getProgress(): Promise<Progress | null> {
    this.assertOpen();
    return this.store.loadProgress();
  }

  async getRunState(): Promise<SessionRunState> {
    this.assertOpen();
    const engine = this.runningEngine;
    if (engine) {
      return engine.isPaused ? "paused" : "running";
    }
    if (this.generating || this.autoWritePreEngine) {
      return "generating_missing";
    }
    if (this.busy) {
      return "busy";
    }
    return "idle";
  }

  async inspectFoundation(options: { prompt?: string } = {}): Promise<InspectResult> {
    this.assertOpen();
    const planning = await resolveSessionPlanning(this.store, options.prompt);
    const missing = await foundationMissing(this.store, planning.tier);
    const gaps = gapsFromMissing(missing, planning);
    return {
      meta: await this.readFoundation(),
      gaps,
      readyToWrite: gaps.length === 0,
      planning,
      auditOnly: isAuditOnlyGaps(gaps),
    };
  }

  async assertReadyToWrite(options: { prompt?: string } = {}): Promise<void> {
    const inspected = await this.inspectFoundation(options);
    if (!inspected.readyToWrite) {
      throw new FoundationIncompleteError(inspected.gaps);
    }
  }

  async listArtifacts(prefix?: string): Promise<string[]> {
    this.assertOpen();
    return listStorePaths(this.store, prefix ?? "");
  }

  async exportSnapshot(): Promise<Uint8Array> {
    this.assertOpen();
    return exportBookSnapshot(this.store);
  }

  async importSnapshot(bytes: Uint8Array): Promise<void> {
    this.assertOpen();
    await importBookSnapshot(this.store, bytes);
  }

  async upsertFoundation(patch: FoundationPatch): Promise<FoundationMeta> {
    this.assertOpen();
    const wrote = await writeFoundationPatch(this.store, patch);
    const meta = await this.readFoundation();
    if (wrote) {
      this.emit({ type: "foundation_updated", meta });
    }
    return meta;
  }

  async assessFoundationImpact(
    patch: FoundationPatch,
    options: AssessFoundationImpactOptions = {},
  ): Promise<FoundationImpactAssessment> {
    this.assertOpen();
    const current = await this.readFoundation();
    return assessProposedFoundation(this.store, current, patch, this.llm, options);
  }

  async applyFoundationChange(
    options: ApplyFoundationChangeOptions,
  ): Promise<ApplyFoundationChangeResult> {
    this.assertOpen();
    return this.withBusy((signal) => this.runApplyFoundationChange(options, signal));
  }

  async generateFoundation(options: GenerateFoundationOptions): Promise<FoundationMeta> {
    this.assertOpen();
    const llm = this.requireLlm();
    return this.withAbort(options.signal, async (signal) => {
      this.generating = true;
      try {
        return await this.runGenerateFoundation(options, llm, signal);
      } finally {
        this.generating = false;
      }
    });
  }

  async startAutoWrite(options: StartAutoWriteOptions): Promise<AutoWriteResult> {
    this.assertOpen();
    return this.withBusy((signal) => this.runAutoWrite(options, signal), options.signal);
  }

  async pause(): Promise<BookControlResult> {
    this.assertOpen();
    const engine = this.runningEngine;
    if (!engine) {
      return { status: "idle" };
    }
    engine.pause();
    return { status: "ok" };
  }

  async resume(): Promise<BookControlResult> {
    this.assertOpen();
    const engine = this.runningEngine;
    if (!engine) {
      return { status: "idle" };
    }
    await engine.resume();
    return { status: "ok" };
  }

  async steer(note: string): Promise<BookControlResult> {
    this.assertOpen();
    const trimmed = note.trim();
    if (trimmed === "") {
      throw new EngineError("steer note must be non-empty");
    }
    const engine = this.runningEngine;
    if (!engine) {
      return { status: "idle" };
    }
    await engine.steer(trimmed);
    return { status: "ok" };
  }

  async cancel(): Promise<BookControlResult> {
    this.assertOpen();
    const engine = this.runningEngine;
    if (!engine && this.abortCtls.size === 0) {
      return { status: "idle" };
    }
    engine?.cancel();
    for (const controller of this.abortCtls) {
      controller.abort();
    }
    return { status: "ok" };
  }

  private async runGenerateFoundation(
    options: GenerateFoundationOptions,
    llm: LlmPort,
    signal: AbortSignal,
  ): Promise<FoundationMeta> {
    const requested = assertFoundationKeys(options.keys);
    const mode = options.mode ?? "fill_missing";
    const selected = await keysToGenerate(
      requested,
      mode,
      (inspectOpts) => this.inspectFoundation(inspectOpts),
      options.prompt,
    );
    throwIfAborted(signal);
    if (selected.length === 0) {
      return this.readFoundation();
    }
    const parsed = await completeFoundationJson(
      llm,
      this.store,
      options.prompt,
      selected,
      await this.readFoundation(),
      signal,
    );
    throwIfAborted(signal);
    const patch = patchFromGeneratedJson(parsed, selected);
    return this.upsertFoundation(patch);
  }

  private async runApplyFoundationChange(
    options: ApplyFoundationChangeOptions,
    signal: AbortSignal,
  ): Promise<ApplyFoundationChangeResult> {
    const assessOpts: AssessFoundationImpactOptions = {};
    if (options.refineWithLlm !== undefined) {
      assessOpts.refineWithLlm = options.refineWithLlm;
    }
    throwIfAborted(signal);
    const assessment = await this.assessFoundationImpact(options.patch, assessOpts);
    const requireConfirm = options.requireConfirmRewrite !== false;
    if (
      assessment.severity === "rewrite_needed" &&
      requireConfirm &&
      options.confirmRewrite !== true
    ) {
      return { status: "needs_confirm", assessment };
    }

    const writes: ChapterWriteResult[] = [];
    let writePlan: { mode: "rewrite" | "polish"; chapters: number[] } | null = null;
    if (options.rewriteChapters === true) {
      const mode = options.mode ?? assessment.suggestedMode;
      if (mode === "rewrite" || mode === "polish") {
        const written = new Set(await listWrittenChapters(this.store));
        const requested = options.chapters ?? assessment.suggestedChapters;
        const chapters = uniqueSorted(requested).filter((chapter) => written.has(chapter));
        if (chapters.length > 0) {
          this.requireLlm();
          writePlan = { mode, chapters };
        }
      }
    }

    throwIfAborted(signal);
    const meta = await this.upsertFoundation(options.patch);
    if (writePlan) {
      const llm = this.requireLlm();
      const instruction = options.instruction ?? defaultRewriteInstruction(assessment);
      for (const chapter of writePlan.chapters) {
        throwIfAborted(signal);
        writes.push(
          await runChapterWrite(
            this.store,
            llm,
            { chapter, mode: writePlan.mode, instruction },
            (event) => this.emit(event),
            signal,
          ),
        );
      }
    }
    return { status: "applied", assessment, meta, writes };
  }

  private async runAutoWrite(
    options: StartAutoWriteOptions,
    signal: AbortSignal,
  ): Promise<AutoWriteResult> {
    this.autoWritePreEngine = true;
    try {
      throwIfAborted(signal);
      if (options.foundation !== undefined) {
        await this.upsertFoundation(options.foundation);
      }
      if (options.generateMissing === true) {
        this.requireLlm();
        const inspected = await this.inspectFoundation({ prompt: options.prompt });
        const keys = missingKeysFromGaps(inspected.gaps, inspected.planning.tier);
        if (keys.length > 0) {
          await this.runGenerateFoundation(
            { prompt: options.prompt, keys, mode: "fill_missing" },
            this.requireLlm(),
            signal,
          );
        }
      }

      const inspected = await this.inspectFoundation({ prompt: options.prompt });
      const requireConfirm = options.requireConfirmGaps !== false;
      const auditOnly = isAuditOnlyGaps(inspected.gaps);
      const proceedDespiteAudit = auditOnly && options.confirmAuditGap === true;
      if (requireConfirm && inspected.gaps.length > 0 && !proceedDespiteAudit) {
        const result: AutoWriteResult = {
          status: "needs_foundation",
          gaps: inspected.gaps,
          meta: inspected.meta,
          auditOnly,
        };
        this.emit({ type: "stopped", result });
        return result;
      }

      throwIfAborted(signal);
      const llm = this.requireLlm();
      const deps: EngineDeps = {
        store: this.store,
        llm,
        onEvent: this.onEngineEvent,
      };
      if (options.maxSteps !== undefined) {
        deps.maxSteps = options.maxSteps;
      }
      const engine = createEngine(deps);
      const runInput: { prompt: string; maxSteps?: number; signal: AbortSignal } = {
        prompt: options.prompt,
        signal,
      };
      if (options.maxSteps !== undefined) {
        runInput.maxSteps = options.maxSteps;
      }
      this.runningEngine = engine;
      this.autoWritePreEngine = false;
      try {
        const engineResult = await engine.run(runInput);
        const meta = await this.readFoundation();
        const status = engineResult.stoppedReason === "complete" ? "completed" : "stopped";
        const result: AutoWriteResult = { status, result: engineResult, meta };
        this.emit({ type: "stopped", result });
        return result;
      } finally {
        this.runningEngine = null;
      }
    } finally {
      this.autoWritePreEngine = false;
    }
  }

  private async withBusy<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
  ): Promise<T> {
    if (this.busy) {
      throw new SessionBusyError();
    }
    if (external?.aborted) {
      throw new AbortedError();
    }
    this.busy = true;
    try {
      return await this.withAbort(external, fn);
    } finally {
      this.busy = false;
    }
  }

  private async withAbort<T>(
    external: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    this.abortCtls.add(controller);
    const detach = attachAbort(external, () => {
      controller.abort();
    });
    try {
      throwIfAborted(controller.signal);
      return await fn(controller.signal);
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        throw toAbortedError(err);
      }
      throw err;
    } finally {
      detach();
      this.abortCtls.delete(controller);
    }
  }

  private readonly onEngineEvent = (event: EngineLoopEvent): void => {
    if (event.type === "step") {
      this.emit({
        type: "auto_write_step",
        step: event.step,
        instruction: event.instruction,
      });
      return;
    }
    if (event.type === "paused") {
      this.emit({ type: "paused" });
      return;
    }
    if (event.type === "resumed") {
      this.emit({ type: "resumed" });
      return;
    }
    if (event.type === "steered") {
      this.emit({ type: "steered", note: event.note });
    }
  };

  private async readFoundation(): Promise<FoundationMeta> {
    const book = await readJson<BookMetadata>(this.store, PATHS.book);
    const premise = await readText(this.store, PATHS.premise);
    const outline = asArray<OutlineEntry>(await readJson<unknown>(this.store, PATHS.outline));
    const layeredOutline = await loadLayeredOutline(this.store);
    const characters = asArray<Character>(await readJson<unknown>(this.store, PATHS.characters));
    const worldRules = asArray<WorldRule>(await readJson<unknown>(this.store, PATHS.worldRules));
    const audit = await readJson<FoundationAudit>(this.store, PATHS.foundationAudit);
    const progress = await this.store.loadProgress();
    return {
      book,
      premise,
      outline,
      layeredOutline,
      characters,
      worldRules,
      audit,
      progress,
    };
  }

  private requireLlm(): LlmPort {
    if (this.llm === undefined) {
      throw new SessionLlmRequiredError();
    }
    return this.llm;
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new SessionClosedError();
    }
  }
}

export async function createNovelSession(
  options: CreateNovelSessionOptions,
): Promise<NovelSession> {
  const bookId = options.bookId.trim();
  if (bookId === "") {
    throw new Error("bookId must be a non-empty string");
  }
  const next: CreateNovelSessionOptions = { store: options.store, bookId };
  if (options.llm !== undefined) {
    next.llm = options.llm;
  }
  return new NovelSessionImpl(next);
}
