import { pollRefills } from "../server/aftercare.ts";
import { Queue, Worker } from "bullmq";
import {
  database,
  syncCatalogue,
  poll,
  dueCampaigns,
} from "../server/operations.ts";
const url = new URL(process.env.REDIS_URL!);
if (!["redis:", "rediss:"].includes(url.protocol))
  throw Error("Invalid Redis URL");
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  db: Number(url.pathname.slice(1) || 0),
  username: decodeURIComponent(url.username) || undefined,
  password: decodeURIComponent(url.password) || undefined,
  ...(url.protocol === "rediss:" ? { tls: {} } : {}),
};
const name = "voxx-maintenance",
  queue = new Queue(name, { connection });
for (const [task, minutes] of [
  ["catalogue", 60],
  ["statuses", 5],
  ["campaigns", 1],
] as const) {
  await queue.upsertJobScheduler(
    task,
    { every: minutes * 60000 },
    {
      name: task,
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    },
  );
}
const worker = new Worker(
  name,
  async (job) => {
    const health = await database()
      .from("voxx_worker_health")
      .upsert({ name: "maintenance", created_at: new Date().toISOString() });
    if (health.error) throw Error("Heartbeat unavailable");
    if (job.name === "catalogue") return await syncCatalogue();
    if (job.name === "campaigns") return await dueCampaigns();
    await pollRefills();
    return await poll();
  },
  { connection, concurrency: 1 },
);
worker.on("failed", (job) =>
  console.error("Maintenance failed", job?.name, job?.id),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await worker.close();
    await queue.close();
  });
