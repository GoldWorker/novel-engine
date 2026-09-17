export const AGENTS = [
  "architect_short",
  "architect_long",
  "writer",
  "editor",
] as const;

export type AgentId = (typeof AGENTS)[number];
