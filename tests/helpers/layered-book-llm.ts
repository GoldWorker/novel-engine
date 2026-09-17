import type { LlmCompletionRequest, LlmCompletionResult, LlmToolCall } from "../../src/index.js";
import type { Character, OutlineEntry, VolumeOutline, WorldRule } from "../../src/index.js";

export interface LayeredBookFixture {
  prompt: string;
  book: { title: string; synopsis: string };
  premise: string;
  layered_outline: VolumeOutline[];
  expansion: { title: string; goal: string; chapters: OutlineEntry[] };
  characters: Character[];
  world_rules: WorldRule[];
  chapters: Record<
    string,
    { title: string; goal: string; conflict: string; hook: string; content: string }
  >;
  arc_summaries: Record<string, { title: string; summary: string; key_events: string[] }>;
  volume_summary: { title: string; summary: string; key_events: string[] };
}

function toolCount(request: LlmCompletionRequest): number {
  return request.messages.filter((message) => message.role === "tool").length;
}

function lastToolPayload(request: LlmCompletionRequest): Record<string, unknown> | null {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const message = request.messages[i];
    if (message?.role === "tool") {
      try {
        return JSON.parse(message.content) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function userTask(request: LlmCompletionRequest): string {
  const user = request.messages.find((message) => message.role === "user");
  return user?.content ?? "";
}

function matchNumber(task: string, pattern: RegExp, fallback: number): number {
  const match = pattern.exec(task);
  return match?.[1] ? Number(match[1]) : fallback;
}

function call(name: string, args: Record<string, unknown>, id: string): LlmToolCall {
  return { id, name, arguments: args };
}

function reply(toolCalls: LlmToolCall[], text = ""): LlmCompletionResult {
  return { text, toolCalls };
}

function done(text: string): LlmCompletionResult {
  return { text };
}

/**
 * Deterministic MockLlm handler for a 1-volume / 2-arc layered book.
 * Exercises arc-end review → arc summary → expand_next_arc, then volume
 * summary → complete_book. No real model.
 */
export function layeredBookLlmHandler(book: LayeredBookFixture) {
  return (request: LlmCompletionRequest): LlmCompletionResult => {
    const turn = toolCount(request);
    const agent = request.agent;
    const task = userTask(request);

    if (agent === "architect_long" || agent === "architect_short") {
      if (task.includes("expand_next_arc")) {
        if (turn === 0) {
          return reply(
            [
              call(
                "expand_next_arc",
                {
                  title: book.expansion.title,
                  goal: book.expansion.goal,
                  chapters: book.expansion.chapters,
                },
                "arch-expand",
              ),
            ],
            "expand next arc",
          );
        }
        return done("arc expanded");
      }

      if (
        task.includes("complete_book") ||
        task.includes("创建下一卷") ||
        task.includes("append_volume")
      ) {
        if (turn === 0) {
          return reply(
            [
              call(
                "save_foundation",
                {
                  type: "complete_book",
                  content: {},
                  reason: "一卷两弧已经收束，不必再开新卷",
                },
                "arch-complete",
              ),
            ],
            "完结",
          );
        }
        return done("book complete");
      }

      if (turn === 0) {
        return reply(
          [call("save_book", { title: book.book.title, synopsis: book.book.synopsis }, "arch-book")],
          "save book",
        );
      }
      if (turn === 1) {
        return reply(
          [
            call(
              "save_foundation",
              { type: "premise", content: book.premise, scale: "mid" },
              "arch-premise",
            ),
          ],
          "save premise",
        );
      }
      if (turn === 2) {
        return reply(
          [
            call(
              "save_foundation",
              { type: "layered_outline", content: book.layered_outline },
              "arch-layered",
            ),
          ],
          "save layered outline",
        );
      }
      if (turn === 3) {
        return reply(
          [
            call(
              "save_foundation",
              { type: "characters", content: book.characters },
              "arch-characters",
            ),
          ],
          "save characters",
        );
      }
      if (turn === 4) {
        return reply(
          [
            call(
              "save_foundation",
              { type: "world_rules", content: book.world_rules },
              "arch-rules",
            ),
          ],
          "save world_rules",
        );
      }
      if (turn === 5) {
        return reply([call("novel_context", {}, "arch-ctx")], "read context");
      }
      if (turn === 6) {
        const payload = lastToolPayload(request);
        const status = asRecord(payload?.foundation_status);
        const fingerprint = typeof status.fingerprint === "string" ? status.fingerprint : "";
        return reply(
          [
            call(
              "audit_foundation",
              {
                fingerprint,
                ready: true,
                summary: "分层中篇基础设定一致，可以开始写作",
                issues: [],
              },
              "arch-audit",
            ),
          ],
          "audit",
        );
      }
      return done("foundation ready");
    }

    if (agent === "writer") {
      const chapter = matchNumber(task, /第\s*(\d+)\s*章/u, 1);
      const draft = book.chapters[String(chapter)];
      if (!draft) {
        throw new Error(`layered-book fixture missing chapter ${chapter}`);
      }
      if (turn === 0) {
        return reply(
          [
            call(
              "plan_chapter",
              {
                chapter,
                title: draft.title,
                goal: draft.goal,
                conflict: draft.conflict,
                hook: draft.hook,
              },
              `w-plan-${chapter}`,
            ),
          ],
          "plan",
        );
      }
      if (turn === 1) {
        return reply(
          [
            call(
              "draft_chapter",
              { chapter, content: draft.content, mode: "write" },
              `w-draft-${chapter}`,
            ),
          ],
          "draft",
        );
      }
      if (turn === 2) {
        return reply([call("commit_chapter", { chapter }, `w-commit-${chapter}`)], "commit");
      }
      return done(`chapter ${chapter} committed`);
    }

    if (agent === "editor") {
      const volume = matchNumber(task, /第\s*(\d+)\s*卷/u, 1);
      const arc = matchNumber(task, /第\s*(\d+)\s*弧/u, 1);
      const chapter = matchNumber(task, /chapter=(\d+)/u, matchNumber(task, /第\s*(\d+)\s*章/u, 0));

      if (task.includes("save_volume_summary") || task.includes("卷摘要")) {
        if (turn === 0) {
          return reply(
            [
              call(
                "save_volume_summary",
                {
                  volume,
                  title: book.volume_summary.title,
                  summary: book.volume_summary.summary,
                  key_events: book.volume_summary.key_events,
                },
                "e-vol-summary",
              ),
            ],
            "volume summary",
          );
        }
        return done("volume summary saved");
      }

      if (task.includes("save_arc_summary") || task.includes("弧摘要")) {
        const entry = book.arc_summaries[String(arc)] ?? book.arc_summaries["1"];
        if (!entry) {
          throw new Error(`layered-book fixture missing arc summary ${arc}`);
        }
        if (turn === 0) {
          return reply(
            [
              call(
                "save_arc_summary",
                {
                  volume,
                  arc,
                  title: entry.title,
                  summary: entry.summary,
                  key_events: entry.key_events,
                },
                `e-arc-summary-${arc}`,
              ),
            ],
            "arc summary",
          );
        }
        return done("arc summary saved");
      }

      if (turn === 0) {
        const target = chapter > 0 ? chapter : 2;
        return reply([call("novel_context", { chapter: target }, `e-ctx-${target}`)], "context");
      }
      if (turn === 1) {
        const target = chapter > 0 ? chapter : 2;
        return reply(
          [
            call(
              "save_review",
              {
                chapter: target,
                scope: "arc",
                summary: "弧内节奏完整，无明显问题",
                issues: [],
              },
              `e-review-${target}`,
            ),
          ],
          "review",
        );
      }
      return done("review saved");
    }

    throw new Error(`layered-book mock has no script for agent=${String(agent)}`);
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
