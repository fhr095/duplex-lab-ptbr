import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  compareVadControlCandidate
} from "../src/eval/vad-control-comparison.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function json(path) {
  return JSON.parse(
    await readFile(resolve(PROJECT_ROOT, path), "utf8")
  );
}

const baselinePath = option(
  "--baseline",
  "eval/reports/browser-shadow-10min.json"
);
const candidatePath = option(
  "--candidate",
  "eval/reports/browser-silero-control-085x1-10min.json"
);
const offlinePath = option(
  "--offline",
  "eval/reports/vad-candidate-ptbr-latest.json"
);
const campaignPath = option("--campaign", null);
const liveCampaignPath = option("--live-campaign", null);
const threshold = Number.parseFloat(option("--threshold", "0.85"));
const onsetWindows = Number.parseInt(
  option("--onset-windows", "1"),
  10
);
const outPath = resolve(
  PROJECT_ROOT,
  option(
    "--out",
    "eval/reports/vad-control-comparison-latest.json"
  )
);

const report = compareVadControlCandidate({
  baseline: await json(baselinePath),
  candidate: await json(candidatePath),
  liveCampaign:
    liveCampaignPath ? await json(liveCampaignPath) : null,
  offline: await json(offlinePath),
  onsetWindows,
  threshold,
  browserCampaign: campaignPath ? await json(campaignPath) : null
});
report.inputs = {
  baseline: baselinePath,
  browserCampaign: campaignPath,
  candidate: candidatePath,
  liveCampaign: liveCampaignPath,
  offline: offlinePath,
  onsetWindows,
  threshold
};
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  decision: report.decision,
  checks: report.checks,
  out: outPath
}));
if (!report.pass) {
  process.exitCode = 1;
}
