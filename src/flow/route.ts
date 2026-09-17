import { plannerForTier } from "../domain/planning-tier.js";
import { nextChapter } from "../domain/progress.js";
import { shouldReview } from "../domain/review.js";
import type { Instruction } from "./instruction.js";
import type { State } from "./state.js";

function instruction(
  agent: Instruction["agent"],
  task: string,
  reason: string,
  chapter?: number,
): Instruction {
  if (chapter === undefined || chapter === 0) {
    return { agent, task, reason };
  }
  return { agent, task, reason, chapter };
}

/**
 * Pure lookup-table router. Input is an explicit fact snapshot; output is the next
 * Worker instruction or `null` when the Engine / Arbiter / user must decide.
 *
 * Priority (first match wins), aligned with ainovel-cli `internal/flow/router.go`:
 *  1. Phase=complete → null
 *  2. Foundation missing (and planner identity known) → architect
 *  3. Pending rewrites → writer
 *  4. Flow=reviewing → null
 *  5. Flow=steering → null
 *  6. Aggregate refresh → editor
 *  7. Immediate external feedback → architect
 *  8. Layered arc-end: review / summary / expand / new volume
 *  9. Non-layered global review due → editor
 * 10. Non-layered outline exhausted → architect
 * 11. Else → writer next chapter
 */
export function route(s: State): Instruction | null {
  const p = s.progress;
  if (p == null) {
    return null;
  }

  if (p.phase === "complete") {
    return null;
  }

  if (p.phase !== "writing") {
    const missing = s.foundationMissing ?? [];
    if (missing.length > 0 && s.planningTier) {
      let task = `补齐基础设定与作品信息缺项：${missing.join("、")}；book 使用 save_book，其余基础设定使用 save_foundation 落盘`;
      if (missing.length === 1 && missing[0] === "foundation_audit") {
        task =
          "基础设定已齐全：重新调用 novel_context 读取全部已落盘工件与 foundation_status.fingerprint，审查跨文件语义一致性后调用 audit_foundation；有问题先修正并重新审查";
      }
      return instruction(
        plannerForTier(s.planningTier),
        task,
        "基础设定缺项未齐，照缺项续派同一规划师",
      );
    }
    return null;
  }

  const pending = p.pendingRewrites;
  if (pending.length > 0) {
    const ch = pending[0];
    if (ch === undefined) {
      return null;
    }
    const verb = p.flow === "polishing" ? "打磨" : "重写";
    return instruction(
      "writer",
      `${verb}第 ${ch} 章`,
      `PendingRewrites 队列剩余 ${pending.length} 章`,
      ch,
    );
  }

  if (p.flow === "reviewing") {
    return null;
  }

  if (p.flow === "steering") {
    return null;
  }

  const refresh = s.aggregateRefresh;
  if (refresh) {
    switch (refresh.kind) {
      case "arc_review":
        return instruction(
          "editor",
          `审阅第 ${refresh.volume} 卷第 ${refresh.arc} 弧（第 ${refresh.startChapter}-${refresh.endChapter} 章）：调用 novel_context(chapter=${refresh.endChapter})，save_review 使用 scope=arc、chapter=${refresh.endChapter}`,
          "弧级审阅缺失",
        );
      case "arc_summary":
        return instruction(
          "editor",
          `生成第 ${refresh.volume} 卷第 ${refresh.arc} 弧摘要、角色快照与写作规则（save_arc_summary）`,
          "弧级摘要缺失",
        );
      case "volume_summary":
        return instruction(
          "editor",
          `生成第 ${refresh.volume} 卷卷摘要（save_volume_summary）`,
          "卷摘要缺失",
        );
      case "global_review":
        return instruction(
          "editor",
          `审阅前 ${refresh.endChapter} 章：调用 novel_context(chapter=${refresh.endChapter})，save_review 使用 scope=global、chapter=${refresh.endChapter}`,
          "全局审阅缺失",
        );
    }
  }

  if ((s.immediateFeedbackCount ?? 0) > 0) {
    return instruction(
      plannerForTier(s.planningTier),
      "仅处理 novel_context 中的外部修订 writer_feedback：核对已发生剧情与后续计划，需要调整时调用 revise_outline 或相应结构工具，无需调整时调用 resolve_outline_feedback；不得处理 foundation_status 或其它规划，落盘后用一句话结束",
      `有 ${s.immediateFeedbackCount} 条外部修订影响尚未传播到后续规划`,
    );
  }

  const boundary = s.arcBoundary;
  if (p.layered && boundary != null && boundary.isArcEnd) {
    if (!s.hasArcReview) {
      return instruction(
        "editor",
        `对第 ${boundary.volume} 卷第 ${boundary.arc} 弧（第 ${boundary.startChapter}-${boundary.endChapter} 章）做弧级评审：调用 novel_context(chapter=${boundary.endChapter})，save_review 使用 scope=arc、chapter=${boundary.endChapter}；issues[].chapters 只能落在该区间`,
        "弧末评审未完成",
      );
    }
    if (!s.hasArcSummary) {
      return instruction(
        "editor",
        `生成第 ${boundary.volume} 卷第 ${boundary.arc} 弧摘要、角色快照与写作规则（save_arc_summary）`,
        "弧摘要未完成",
      );
    }
    if (boundary.isVolumeEnd && !s.hasVolumeSummary) {
      return instruction(
        "editor",
        `生成第 ${boundary.volume} 卷卷摘要（save_volume_summary）`,
        "卷摘要未完成",
      );
    }
    if (boundary.needsExpansion && boundary.nextArc > 0) {
      return instruction(
        "architect_long",
        `展开第 ${boundary.nextVolume} 卷第 ${boundary.nextArc} 弧（expand_next_arc）`,
        "下一弧骨架待展开",
      );
    }
    if (boundary.needsNewVolume) {
      return instruction(
        "architect_long",
        "创建下一卷：按完结判定清单评估后调用 save_foundation——故事继续 → type=append_volume；故事接近终点 → type=append_volume 且卷 JSON 顶层带 \"final\": true（收官卷，整卷收线，写完自动完结）；全部完结条件当下已满足 → type=complete_book。三选一均须附 reason 参数写明判定理由",
        "卷末需决定追加新卷、收官卷或结束全书",
      );
    }
  }

  if (!p.layered && (s.lastCompleted ?? 0) > 0) {
    const review = shouldReview(p.completedChapters.length);
    if (review.due && !s.hasGlobalReview) {
      return instruction(
        "editor",
        `对前 ${s.lastCompleted} 章做全局审阅（save_review scope=global, chapter=${s.lastCompleted}）`,
        review.reason,
      );
    }
  }

  const next = nextChapter(p);
  if (next <= 0) {
    return null;
  }
  if (!p.layered && p.totalChapters > 0 && next > p.totalChapters) {
    return instruction(
      plannerForTier(s.planningTier),
      `非分层大纲已写完（已完成 ${p.completedChapters.length} 章，共 ${p.totalChapters} 章）：若故事已收束，调用 save_foundation(type=complete_book)；若仍需继续，用 revise_outline 从第 ${next} 章续接后续计划`,
      "非分层大纲已耗尽，需决定完结或续接",
    );
  }

  return instruction("writer", `写第 ${next} 章`, "续写下一章", next);
}
