/**
 * Scenario 2 — layered mid / long book.
 * 场景 2：分层中长篇。Host guide: docs/guide.md §2 / docs/guide.zh-CN.md.
 *
 * Layered mid-book host example — `architect_long` tools to `phase=complete`.
 * 分层中篇示例：一卷两弧，弧末审阅 → 弧摘要 → `expand_next_arc`，卷末完结。
 *
 * Prompt keywords `中篇` / `分层` select `architect_long` / `mid` via the
 * `plan_start` stub (`inferPlanningStub`). `长篇` selects `long`.
 *
 * Same wiring as the short-book example: inject `MemoryStore` + `MockLlm`.
 * Full golden path in-repo: `npm run test:layered` + `fixtures/layered-book.json`.
 */

import {
  createEngine,
  MemoryStore,
  MockLlm,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmToolCall,
} from "novel-engine";

const PROMPT = "写一本分层中篇：一座海上灯塔里住着守塔人林守。一卷两弧，先写接灯，再写离岸归来。";

const BOOK = {
  title: "两弧灯塔",
  synopsis: "林守接过灯塔后经历第一场风暴，又在离岸远航后把灯重新点亮。",
  premise: "林守从父亲手里接过灯塔。第一弧写他独自守夜；第二弧写他离岸寻找寄信人。",
  layeredOutline: [
    {
      title: "守夜",
      theme: "灯塔与离岸",
      arcs: [
        {
          title: "初夜",
          goal: "林守接灯并挺过第一场风暴",
          chapters: [
            { title: "交接", core_event: "父亲把钥匙交给林守。", hook: "潮水送来一封没有署名的信" },
            { title: "风暴", core_event: "林守独自扛过整夜风暴。", hook: "退潮后礁石上多了一只空瓶" },
          ],
        },
        {
          title: "远航",
          goal: "离开灯塔又带着答案归来",
          estimated_chapters: 2,
        },
      ],
    },
  ],
  expansion: {
    title: "远航",
    goal: "林守离岸寻找寄信人，把灯重新点亮",
    chapters: [
      { title: "离岸", core_event: "林守按信上的地址走进渔村。", hook: "桌上的潮汐表停在他出发的那一格" },
      { title: "回灯", core_event: "他把答案写进回信，灯塔重新亮起。", hook: "光扫过海面" },
    ],
  },
  characters: [{ name: "林守", role: "主角", bio: "新任灯塔看守人。" }],
  worldRules: [{ name: "信与潮", description: "涨潮漂来的信只能由捡到的人拆阅。" }],
  chapters: {
    1: {
      title: "交接",
      goal: "完成交接，第一次独自点灯",
      conflict: "他不确定自己配不配守一整夜",
      hook: "潮水送来一封没有署名的信",
      content: "父亲把铜钥匙放进林守掌心。灯塔还在转。",
    },
    2: {
      title: "风暴",
      goal: "独自扛过风暴，灯不熄",
      conflict: "风要掀开灯罩",
      hook: "退潮后多了一只空瓶",
      content: "风暴停在黎明。林守提着灯走下礁石。",
    },
    3: {
      title: "离岸",
      goal: "抵达空屋",
      conflict: "空屋没有留下名字",
      hook: "潮汐表停在他出发的那一格",
      content: "地址指向悬崖边的木屋。门没锁，屋里没有人。",
    },
    4: {
      title: "回灯",
      goal: "写下回信并送回海里",
      conflict: "他不知道该把信寄给谁",
      hook: "灯塔重新亮起",
      content: "林守把回信连同空瓶推向航道。回到灯塔，他点燃灯盏。",
    },
  },
  arcSummaries: {
    1: { title: "初夜", summary: "林守接过灯塔，独自扛过第一场风暴。", key_events: ["交接点灯", "风暴未熄"] },
    2: { title: "远航", summary: "林守离岸找到空屋，灯重新亮起。", key_events: ["离岸寻人", "回信入海"] },
  },
  volumeSummary: {
    title: "守夜",
    summary: "一卷写完接灯与归来。",
    key_events: ["接灯", "风暴", "离岸", "回灯"],
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

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * architect_long: save_foundation(type=layered_outline|complete_book), expand_next_arc.
 * editor: save_review (arc), save_arc_summary, save_volume_summary.
 */
export function layeredBookHandler(request: LlmCompletionRequest): LlmCompletionResult {
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
                title: BOOK.expansion.title,
                goal: BOOK.expansion.goal,
                chapters: BOOK.expansion.chapters,
              },
              "arch-expand",
            ),
          ],
          "expand next arc",
        );
      }
      return done("arc expanded");
    }
    if (task.includes("complete_book") || task.includes("创建下一卷") || task.includes("append_volume")) {
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
        [call("save_book", { title: BOOK.title, synopsis: BOOK.synopsis }, "arch-book")],
        "save book",
      );
    }
    if (turn === 1) {
      return reply(
        [call("save_foundation", { type: "premise", content: BOOK.premise, scale: "mid" }, "arch-premise")],
        "save premise",
      );
    }
    if (turn === 2) {
      return reply(
        [call("save_foundation", { type: "layered_outline", content: BOOK.layeredOutline }, "arch-layered")],
        "save layered outline",
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
    const draft = BOOK.chapters[chapter as keyof typeof BOOK.chapters];
    if (!draft) {
      throw new Error(`layered-book example missing chapter ${chapter}`);
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
                title: BOOK.volumeSummary.title,
                summary: BOOK.volumeSummary.summary,
                key_events: BOOK.volumeSummary.key_events,
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
      const entry = BOOK.arcSummaries[arc as keyof typeof BOOK.arcSummaries] ?? BOOK.arcSummaries[1];
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
            { chapter: target, scope: "arc", summary: "弧内节奏完整，无明显问题", issues: [] },
            `e-review-${target}`,
          ),
        ],
        "review",
      );
    }
    return done("review saved");
  }

  throw new Error(`layered-book mock has no script for agent=${String(agent)}`);
}

export async function runLayeredBook(): Promise<void> {
  const store = new MemoryStore();
  const llm = MockLlm.fromHandler(layeredBookHandler);
  const engine = createEngine({ store, llm, maxSteps: 40 });
  const result = await engine.run({ prompt: PROMPT });
  console.log(result.stoppedReason, result.phase, result.steps);
}

void runLayeredBook();
