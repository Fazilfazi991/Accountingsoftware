const flag = process.env.LEDGERLY_QA_ALLOW_MUTATION;
const expectedRef = process.env.LEDGERLY_QA_EXPECTED_PROJECT_REF;
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (flag !== "true") {
  throw new Error(
    "QA mutation blocked: set LEDGERLY_QA_ALLOW_MUTATION=true only for an isolated synthetic QA project.",
  );
}

if (!expectedRef) {
  throw new Error(
    "QA mutation blocked: LEDGERLY_QA_EXPECTED_PROJECT_REF must explicitly allowlist the target project.",
  );
}

let actualRef;
try {
  const host = new URL(rawUrl).hostname;
  actualRef = host.endsWith(".supabase.co")
    ? host.slice(0, -".supabase.co".length)
    : ["127.0.0.1", "localhost"].includes(host)
      ? "local"
      : null;
} catch {
  actualRef = null;
}

if (!actualRef || actualRef !== expectedRef) {
  throw new Error("QA mutation blocked: configured Supabase project does not match the explicit allowlist.");
}

for (const key of ["LEDGERLY_QA_USER_A_EMAIL", "LEDGERLY_QA_USER_B_EMAIL"]) {
  if (!process.env[key]?.endsWith("@ledgerly.test")) {
    throw new Error(`QA mutation blocked: ${key} is not a synthetic Ledgerly test identity.`);
  }
}

console.log(`QA target guard accepted isolated project ${actualRef}.`);

