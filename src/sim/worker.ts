import { runBatchLocal, type BatchSpec } from "./runner.js";
const spec = JSON.parse(process.argv[2]!) as BatchSpec;
process.stdout.write(JSON.stringify(runBatchLocal(spec)));
