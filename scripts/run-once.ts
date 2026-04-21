// Manual one-shot runner. Usage:
//   npm run run-once
//   npm run run-once -- --dry        # generate report only, skip push
//   npm run run-once -- --ignore-dedup
import { run } from '../src/index.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry') || args.has('--dry-run');
const ignoreDedup = args.has('--ignore-dedup');

run({ dryRun, ignoreDedup })
  .then((res) => {
    console.log('\n[run-once] done', res);
  })
  .catch((err) => {
    console.error('[run-once] error', err);
    process.exit(1);
  });
