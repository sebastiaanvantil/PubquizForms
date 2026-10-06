// Run the tests with Node: node tests/run.mjs
import { getResults } from './tests.js';

const results = getResults();
const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  console.error(`FAIL [${r.suite}] ${r.label}: expected ${r.expected}, got ${r.actual}`);
}
console.log(`${results.length - failed.length}/${results.length} tests passed`);
process.exit(failed.length ? 1 : 0);
