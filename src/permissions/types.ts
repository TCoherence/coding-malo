export type PermissionMode = "plan" | "default" | "acceptEdits" | "bypass";
export type SandboxTier = "read-only" | "workspace-write" | "danger-full-access";
export type PermissionEffect = "read" | "write" | "execute" | "network";

export interface ApprovalRequest {
  toolName: string;
  resource: string;
  effects: PermissionEffect[];
  danger: "low" | "high";
  input: unknown;
  agentId: string;
}

export type Decision =
  | { allow: true; remember?: "session" | "persist" }
  | { allow: false; reason: string };

export interface Prompter {
  prompt(req: ApprovalRequest): Promise<Decision>;
}

export function allow(remember?: "session" | "persist"): Decision {
  return remember ? { allow: true, remember } : { allow: true };
}
export function deny(reason: string): Decision {
  return { allow: false, reason };
}
