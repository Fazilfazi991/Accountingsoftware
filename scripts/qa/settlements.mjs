import { execFileSync } from "node:child_process";
const suites = ["settlements-credit-notes.mjs", "settlements-customer-receipts.mjs", "settlements-debit-notes.mjs", "settlements-supplier-payments.mjs"];
for (const suite of suites) {
  console.log(`Running ${suite}`);
  execFileSync(process.execPath, [`scripts/qa/${suite}`], { stdio: "inherit", env: process.env });
}
