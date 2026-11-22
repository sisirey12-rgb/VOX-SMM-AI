export type Stage =
  | "pending"
  | "submitting"
  | "accepted"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "uncertain";
export type Observation = {
  batch: string;
  time: string;
  stage: Stage;
  submitted: number;
  accepted: number;
  completed: number;
  status: string;
  legacy: boolean;
};
export type History = {
  requested: number;
  created: string;
  batches: number;
  campaignState: string | null;
  events: Observation[];
};
export type Point = {
  time: number;
  submitted: number;
  accepted: number;
  completed: number;
};
export function summarize(history: History) {
  const latest = new Map<string, Observation>();
  const points: Point[] = [
    {
      time: Date.parse(history.created),
      submitted: 0,
      accepted: 0,
      completed: 0,
    },
  ];
  for (const event of history.events) {
    const prev = latest.get(event.batch),
      last = points[points.length - 1];
    const next = {
      time: Date.parse(event.time),
      submitted: last.submitted + event.submitted - (prev?.submitted ?? 0),
      accepted: last.accepted + event.accepted - (prev?.accepted ?? 0),
      completed: last.completed + event.completed - (prev?.completed ?? 0),
    };
    latest.set(event.batch, event);
    points.push(next);
  }
  const counts: Record<Stage, number> = {
    pending: 0,
    submitting: 0,
    accepted: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    cancelled: 0,
    uncertain: 0,
  };
  let accepted = 0,
    failedSubmissions = 0,
    terminal = 0;
  for (const row of latest.values()) {
    counts[row.stage]++;
    if (row.accepted > 0) {
      accepted++;
      if (["completed", "partial", "failed", "cancelled"].includes(row.stage))
        terminal++;
    } else if (row.stage === "failed") failedSubmissions++;
  }
  counts.pending += Math.max(history.batches - latest.size, 0);
  const last = points[points.length - 1];
  return {
    points,
    counts,
    last,
    accepted,
    failedSubmissions,
    terminal,
    acceptanceRate:
      accepted + failedSubmissions
        ? (100 * accepted) / (accepted + failedSubmissions)
        : null,
    completionRate: terminal ? (100 * counts.completed) / terminal : null,
    fulfilledPercent: (100 * last.completed) / history.requested,
    status:
      history.campaignState ??
      history.events[history.events.length - 1]?.status ??
      "Confirmed",
  };
}
