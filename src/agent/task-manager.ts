export type TaskStatus = "running" | "done" | "error";

export interface TaskRecord {
  id: string;
  label: string;
  status: TaskStatus;
  result?: string;
}

/**
 * Tracks background sub-agent tasks for a session. A background Task starts a runner and returns
 * immediately; task_status reports progress/results. Foreground tasks don't go through here.
 */
export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();
  private seq = 0;

  start(label: string, runner: () => Promise<{ text: string; isError: boolean }>): string {
    const id = `task_${++this.seq}`;
    this.tasks.set(id, { id, label, status: "running" });
    void runner().then(
      (r) => this.tasks.set(id, { id, label, status: r.isError ? "error" : "done", result: r.text }),
      (e) => this.tasks.set(id, { id, label, status: "error", result: e instanceof Error ? e.message : String(e) }),
    );
    return id;
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()];
  }
}
