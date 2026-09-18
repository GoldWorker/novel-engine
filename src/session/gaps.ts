import { PATHS } from "../store/paths.js";
import type { FoundationGap, PlanningInfo } from "./types.js";

interface GapTemplate {
  path: string;
  requiredFor: string;
  hint: string;
}

function outlineGap(planning: PlanningInfo): GapTemplate {
  if (planning.tier === "short") {
    return {
      path: PATHS.outline,
      requiredFor: "short",
      hint: "短篇需要非空扁平大纲 outline.json。 / Short books require a non-empty flat outline.json.",
    };
  }
  return {
    path: PATHS.layeredOutline,
    requiredFor: planning.tier,
    hint: "中长篇需要非空分层大纲 layered_outline.json（有效卷/弧结构）；扁平 outline.json 也可。 / Mid/long books need a valid layered_outline.json (or a flat outline.json).",
  };
}

function template(key: string, planning: PlanningInfo): GapTemplate {
  switch (key) {
    case "book":
      return {
        path: PATHS.book,
        requiredFor: "write",
        hint: "缺少作品信息 meta/book.json。调用 save_book 写入 title 与 synopsis。 / Missing book metadata (title + synopsis).",
      };
    case "premise":
      return {
        path: PATHS.premise,
        requiredFor: "write",
        hint: "缺少前提 premise.md。 / Missing premise.",
      };
    case "outline":
      return outlineGap(planning);
    case "characters":
      return {
        path: PATHS.characters,
        requiredFor: "write",
        hint: "缺少角色 characters.json（非空数组）。 / Missing characters.json (non-empty array).",
      };
    case "world_rules":
      return {
        path: PATHS.worldRules,
        requiredFor: "write",
        hint: "缺少世界规则 world_rules.json（非空数组）。 / Missing world_rules.json (non-empty array).",
      };
    case "foundation_audit":
      return {
        path: PATHS.foundationAudit,
        requiredFor: "write",
        hint: "基础设定未审查：仅剩本缺口时宿主可传 confirmAuditGap: true 继续；或调用 audit_foundation / 将 phase 设为 writing|complete。 / Foundation audit only: pass confirmAuditGap: true to proceed, or audit_foundation / phase writing|complete.",
      };
    default:
      return {
        path: key,
        requiredFor: "write",
        hint: `缺少基础设定：${key}。 / Missing foundation artifact: ${key}.`,
      };
  }
}

/** Map `foundationMissing` keys to Session gaps with bilingual hints. */
export function gapsFromMissing(missing: readonly string[], planning: PlanningInfo): FoundationGap[] {
  return missing.map((key) => {
    const row = template(key, planning);
    return {
      key,
      path: row.path,
      requiredFor: row.requiredFor,
      hint: row.hint,
      kind: key === "foundation_audit" ? "audit" : "artifact",
    };
  });
}

/** True when there is at least one gap and every gap is `foundation_audit`. */
export function isAuditOnlyGaps(gaps: readonly { key: string }[]): boolean {
  return gaps.length > 0 && gaps.every((gap) => gap.key === "foundation_audit");
}
