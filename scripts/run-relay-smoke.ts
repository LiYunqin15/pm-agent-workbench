import { relaySmokeLog, runRelaySmokeTest } from "@/lib/agent/relay-smoke";

async function main() {
  const result = await runRelaySmokeTest();
  console.log(relaySmokeLog(result));
  if (!result.skipped && result.errorCode) process.exitCode = 1;
}

void main();
