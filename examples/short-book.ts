/**
 * Scenario 1 — short book to complete.
 * 场景 1：短篇完结。Root README: Usage by scenario / 使用场景.
 *
 * Short-book host example — `createEngine` + `MemoryStore` + `MockLlm` to `phase=complete`.
 * 短篇宿主示例：脚本化 MockLlm 跑完整本（无真实模型、无 UI）。
 *
 * Copy into a host after `npm install novel-engine`.
 * 复制到宿主项目前请先安装 `novel-engine`。
 *
 * `ReplayLlm` is a fixed result list (see `replayLlmSketch` below). Prefer
 * `MockLlm.fromHandler` for a live book: `audit_foundation` needs the
 * fingerprint returned by `novel_context`.
 */

import {
  createEngine,
  MemoryStore,
  MockLlm,
  ReplayLlm,
  inferPlanningStub,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmToolCall,
} from "novel-engine";

const PROMPT = "写一本三章短篇：灯塔看守人在风暴后捡到一封没有寄信人的信。";

const BOOK = {
  title: "无主的信",
  synopsis: "灯塔看守人在风暴后捡到一封没有寄信人的信，决定按信上的地址走一遭。",
  premise:
    "孤僻的灯塔看守人林守在风暴后的礁石上捡到一封没有寄信人的信。他离开灯塔，找到一座空屋，把一生写进回信，放回海里。",
  outline: [
    { chapter: 1, title: "风暴之后", summary: "林守捡到那封信，第一次产生离开灯塔的念头。" },
    { chapter: 2, title: "岸边的地址", summary: "他按地址找到一座空屋，屋里只剩潮汐时刻表。" },
    { chapter: 3, title: "回信", summary: "他把自己的守夜写进回信，退潮时放回海里。" },
  ],
  characters: [{ name: "林守", role: "主角", bio: "孤僻的灯塔看守人。" }],
  worldRules: [
    { name: "信与潮", description: "涨潮时漂来的信只能由捡到的人拆阅，回信必须在退潮前送回海里。" },
  ],
  chapters: {
    1: {
      title: "风暴之后",
      goal: "捡到信，产生离塔念头",
      conflict: "职责要他留下，信要他离开",
      hook: "瓶子里只有一个岸边地址",
      content: "风暴停了。林守在礁石缝里捡到一只蜡封的瓶子，信上没有寄信人。",
    },
    2: {
      title: "岸边的地址",
      goal: "按地址走到空屋",
      conflict: "屋里没有人，只有冷掉的茶",
      hook: "潮汐时刻表停在他出发的那一格",
      content: "地址指向悬崖边的木屋。门没锁，桌上只有潮汐时刻表和一杯冷茶。",
    },
    3: {
      title: "回信",
      goal: "写下回信并送回海里",
      conflict: "他不知道该把信寄给谁",
      hook: "灯塔的灯重新亮起",
      content: "林守把守夜写进回信，退潮时放回海里。回到灯塔，他点燃灯盏。",
    },
  },
};

function toolCount(request: LlmCompletionRequest): number {
  return request.messages.filter((message) => message.role === "tool").length;
}

function userTask(request: LlmCompletionRequest): string {
  return request.messages.find((message) => message.role === "user")?.content ?? "";
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

function call(name: string, args: Record<string, unknown>, id: string): LlmToolCall {
  return { id, name, arguments: args };
}

function reply(toolCalls: LlmToolCall[], text = ""): LlmCompletionResult {
  return { text, toolCalls };
}

function done(text: string): LlmCompletionResult {
  return { text };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Deterministic architect / writer / editor tool sequence for a 3-chapter
 * non-layered book. Matches the repo fixture used by `npm run test:short`.
 */
export function shortBookHandler(request: LlmCompletionRequest): LlmCompletionResult {
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
        [call("save_book", { title: BOOK.title, synopsis: BOOK.synopsis }, "arch-book")],
        "save book",
      );
    }
    if (turn === 1) {
      return reply(
        [call("save_foundation", { type: "premise", content: BOOK.premise, scale: "short" }, "arch-premise")],
        "save premise",
      );
    }
    if (turn === 2) {
      return reply(
        [call("save_foundation", { type: "outline", content: BOOK.outline }, "arch-outline")],
        "save outline",
      );
    }
    if (turn === 3) {
      return reply(
        [call("save_foundation", { type: "characters", content: BOOK.characters }, "arch-characters")],
        "save characters",
      );
    }
    if (turn === 4) {
      return reply(
        [call("save_foundation", { type: "world_rules", content: BOOK.worldRules }, "arch-rules")],
        "save world_rules",
      );
    }
    if (turn === 5) {
      return reply([call("novel_context", {}, "arch-ctx")], "read context");
    }
    if (turn === 6) {
      const status = asRecord(lastToolPayload(request)?.foundation_status);
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
    const match = /第\s*(\d+)\s*章/u.exec(task);
    const chapter = match ? Number(match[1]) : 1;
    const draft = BOOK.chapters[chapter as keyof typeof BOOK.chapters];
    if (!draft) {
      throw new Error(`short-book example missing chapter ${chapter}`);
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
        [call("draft_chapter", { chapter, content: draft.content, mode: "write" }, `w-draft-${chapter}`)],
        "draft",
      );
    }
    if (turn === 2) {
      return reply([call("commit_chapter", { chapter }, `w-commit-${chapter}`)], "commit");
    }
    return done(`chapter ${chapter} committed`);
  }

  if (agent === "editor") {
    const match = /第\s*(\d+)\s*章/u.exec(task);
    const chapter = match ? Number(match[1]) : 1;
    if (turn === 0) {
      return reply(
        [
          call(
            "save_review",
            { chapter, scope: "global", summary: "节奏完整，无明显问题", issues: [] },
            `e-review-${chapter}`,
          ),
        ],
        "review",
      );
    }
    return done("review saved");
  }

  throw new Error(`short-book mock has no script for agent=${String(agent)}`);
}

/** `ReplayLlm` replays a pre-recorded completion list. It does not inspect the request. */
export function replayLlmSketch(): ReplayLlm {
  return new ReplayLlm([
    {
      text: "save book",
      toolCalls: [
        { id: "1", name: "save_book", arguments: { title: BOOK.title, synopsis: BOOK.synopsis } },
      ],
    },
    { text: "turn finished without tools" },
  ]);
}

export async function runShortBook(): Promise<void> {
  const planning = inferPlanningStub(PROMPT);
  // planning.tier === "short", planning.planner === "architect_short"
  void planning;

  const store = new MemoryStore();
  const llm = MockLlm.fromHandler(shortBookHandler);
  const engine = createEngine({
    store,
    llm,
    maxSteps: 20,
    onEvent: (event) => {
      if (event.type === "step") {
        console.log(`step ${event.step}: ${event.instruction.agent} — ${event.instruction.task}`);
      }
    },
  });

  const result = await engine.run({ prompt: PROMPT });
  // result.stoppedReason === "complete" | "idle" | "paused" | "max_steps"
  console.log(result.stoppedReason, result.phase, result.steps);
}

void runShortBook();
