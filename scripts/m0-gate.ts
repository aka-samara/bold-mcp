// M0 gate: the test key works against the configured base URL.
// Calls the free Credit Usage endpoint and prints status and pool balances.
// Run: npm run gate:m0   (needs BOLD_TEST_API_KEY; BOLD_API_BASE_URL optional)
import { liveContext, readBalances } from "./live.ts";

const ctx = liveContext();
console.log(`Base URL: ${ctx.baseUrl}`);
console.log(`Key fingerprint: ${ctx.fingerprint}`);

try {
  const res = await ctx.post("credit-usage", {});
  console.log(`credit-usage: HTTP ${res.status} in ${res.ms} ms`);
  const balances = readBalances(res.body);
  if (res.status !== 200 || !balances) {
    console.error("Unexpected response:", JSON.stringify(res.body, null, 2).slice(0, 2000));
    console.error(res.status === 401 ? "FAIL: key not recognised by this base URL." : "FAIL: credit-usage did not return balances.");
    process.exit(1);
  }
  console.table(balances);
  const logs = await ctx.post("credit-usage-logs", { page_size: 5, page_no: 1 });
  console.log(`credit-usage-logs: HTTP ${logs.status} in ${logs.ms} ms`);
  console.log(JSON.stringify(logs.body, null, 2).slice(0, 2000));
  const zero = Object.values(balances).every((p) => p.total === 0);
  console.log(zero ? "PASS (warning: all balances are zero)" : "PASS: test key works against the base URL.");
} catch (err) {
  console.error(`FAIL: ${err instanceof Error ? err.name + ": " + err.message : "request failed"}`);
  process.exit(1);
}
