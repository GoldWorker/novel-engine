import type { LlmCompletionRequest, LlmCompletionResult, LlmToolCall } from "../../src/index.js";
import type { Character, OutlineEntry, WorldRule } from "../../src/index.js";

export interface ShortBookFixture {
  prompt: string;
  book: { title: string; synopsis: string };
  premise: string;
  outline: OutlineEntry[];
  characters: Character[];
  world_rules: WorldRule[];
  chapters: Record<
    string,
    { title: string; goal: string; conflict: string; hook: string; content: string }
  >;
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

function chapterFromTask(task: string): number {
  const match = /第\s*(\d+)\s*章/u.exec(task);
  return match ? Number(match[1]) : 1;
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
 * Deterministic MockLlm handler that drives a short-book fixture to Phase=complete.
 * Architect / writer / editor each follow a fixed tool sequence; no real model.
 */
export function shortBookLlmHandler(book: ShortBookFixture) {
  return (request: LlmCompletionRequest): LlmCompletionResult => {
    const turn = toolCount(request);
    const agent = request.agent;
    const task = userTask(request);

    if (agent === "architect_short" || agent === "architect_long") {
      if (task.includes("complete_book") || task.includes("已写完")) {
        if (turn === 0) {
          return reply(
            [
              call(
                "save_foundation",
                { type: "complete_book", content: {}, reason: "三章短篇已收束" },
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
              { type: "premise", content: book.premise, scale: "short" },
              "arch-premise",
            ),
          ],
          "save premise",
        );
      }
      if (turn === 2) {
        return reply(
          [call("save_foundation", { type: "outline", content: book.outline }, "arch-outline")],
          "save outline",
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
                summary: "短篇基础设定一致，可以开始写作",
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
      const chapter = chapterFromTask(task);
      const chapterKey = String(chapter);
      const draft = book.chapters[chapterKey];
      if (!draft) {
        throw new Error(`short-book fixture missing chapter ${chapter}`);
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
      const chapter = chapterFromTask(task);
      if (turn === 0) {
        return reply(
          [
            call(
              "save_review",
              {
                chapter,
                scope: "global",
                summary: "节奏完整，无明显问题",
                issues: [],
              },
              `e-review-${chapter}`,
            ),
          ],
          "review",
        );
      }
      return done("review saved");
    }

    throw new Error(`short-book mock has no script for agent=${String(agent)}`);
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
