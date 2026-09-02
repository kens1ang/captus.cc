// Stage 1 observability stopgap: no dashboard yet (that's Stage 4), but you
// need to see, per message, whether it was received, how it was processed,
// and whether the LLM/send step succeeded or why it failed.
//
// There are two queues in play, and they mean different things:
//   inbound-messages: "did we record/buffer this message?" (fast, near-instant)
//   reply-debounce:   "did the actual reply go out?" (fires ~7s after the last
//                      message, and is where Gemini/WhatsApp-send failures show up)
// A message can show COMPLETED on inbound-messages while its reply is still
// pending, retrying, or failed on reply-debounce — check both.
//
// Usage: npm run status [-- <count>]   (default: last 20 per queue, per state)
import { Queue } from "bullmq";
import { connection, INBOUND_MESSAGE_QUEUE, REPLY_DEBOUNCE_QUEUE } from "../lib/queue.js";

function fmtTime(ts: number | undefined): string {
  return ts ? new Date(ts).toISOString() : "-";
}

async function printQueue(name: string, description: string, count: number) {
  const queue = new Queue(name, { connection });
  const counts = await queue.getJobCounts();
  console.log(`=== ${name} — ${description} ===`);
  console.log("Queue counts:", counts);
  console.log("");

  const [active, delayed, failed, completed] = await Promise.all([
    queue.getActive(0, count),
    queue.getDelayed(0, count),
    queue.getFailed(0, count),
    queue.getCompleted(0, count),
  ]);

  const rows = [
    ...active.map((j) => ({ j, state: "ACTIVE (processing now)" })),
    ...delayed.map((j) => ({ j, state: "DELAYED (waiting on debounce/retry backoff)" })),
    ...failed.map((j) => ({ j, state: "FAILED (all retries exhausted)" })),
    ...completed.map((j) => ({ j, state: "COMPLETED" })),
  ].sort((a, b) => (a.j.timestamp ?? 0) - (b.j.timestamp ?? 0));

  for (const { j, state } of rows) {
    console.log(`--- job ${j.id} — ${state} ---`);
    if (j.data.tenantId) console.log(`  tenant: ${j.data.tenantId}`);
    console.log(`  from: ${j.data.from}`);
    if (j.data.text) console.log(`  text: ${j.data.text}`);
    if (j.data.receivedAt) console.log(`  received: ${j.data.receivedAt}`);
    console.log(`  attempts made: ${j.attemptsMade}`);
    if (j.failedReason) {
      console.log(`  failure reason: ${j.failedReason.split("\n")[0]}`);
    }
    if (j.finishedOn) {
      console.log(`  finished: ${fmtTime(j.finishedOn)}`);
    }
    console.log("");
  }

  if (rows.length === 0) {
    console.log("No jobs found (queue is empty or older jobs were pruned).");
  }
  console.log("");

  await queue.close();
}

async function main() {
  const count = Number(process.argv[2] ?? 20);
  await printQueue(INBOUND_MESSAGE_QUEUE, "recorded/buffered? (not the same as replied!)", count);
  await printQueue(REPLY_DEBOUNCE_QUEUE, "the actual reply — this is what tells you if it went out", count);
  await connection.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
