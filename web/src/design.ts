// Visual variants shared by reusable components and page-level mappings.
export type BadgeTone =
  | "neutral"
  | "teal"
  | "yellow"
  | "orange"
  | "red"
  | "slate"
  | "status-neutral"
  | "status-active"
  | "status-warning";

export type AccountSessionStatus = "neutral" | "active" | "warning";

export const accountSessionStatusTone: Record<AccountSessionStatus, BadgeTone> = {
  neutral: "status-neutral",
  active: "status-active",
  warning: "status-warning",
};
