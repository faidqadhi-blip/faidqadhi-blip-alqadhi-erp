
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const project = "uddoevymsrzceqoxpokn";
const url = `https://${project}.supabase.co`;
const tenant = process.env.TEST_TENANT_ID ||
  "10000000-0000-4000-8000-000000000001";
const key = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;

const accounts = {
  creator: "alqadhifccs@gmail.com",
  reviewer: "faidalwhatsup@gmail.com",
  approver: "faidqadhi@gmail.com",
  readonly: "faidaljabzy@gmail.com"
};

const passwords = {
  creator: process.env.TEST_PASSWORD_CREATOR,
  reviewer: process.env.TEST_PASSWORD_REVIEWER,
  approver: process.env.TEST_PASSWORD_APPROVER,
  readonly: process.env.TEST_PASSWORD_READONLY
};

if (
  !process.argv.includes("--provision-and-test") ||
  process.env.TEST_SUPABASE_PROJECT_ID !== project ||
  !key ||
  !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
  Object.values(passwords).some(p => !p)
) {
  throw Error("Missing test configuration");
}

const results = [];
function check(name, passed) {
  results.push({ name, result: passed ? "PASS" : "FAIL" });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) throw Error(`Failed: ${name}`);
}

async function api(path, token, body) {
  const response = await fetch(url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { data = text; }

  if (!response.ok) {
    const error = new Error(
      `HTTP ${response.status}: ${data?.message || data?.error_description || data?.code || "Request rejected"}`
    );
    error.status = response.status;
    error.code = data?.code || "";
    throw error;
  }
  return data;
}

const sessions = {};
const users = {};

for (const [role, email] of Object.entries(accounts)) {
  const login = await api(
    "/auth/v1/token?grant_type=password",
    null,
    { email, password: passwords[role] }
  );

  check(`login_${role}`, Boolean(login.access_token));

  const profile = await api("/auth/v1/user", login.access_token);
  check(`jwt_${role}`, profile.email?.toLowerCase() === email);

  sessions[role] = login.access_token;
  users[role] = profile.id;
}

check("distinct_users", new Set(Object.values(users)).size === 4);

async function rpc(role, action, data) {
  return api(`/rest/v1/rpc/${action}`, sessions[role], data);
}

async function denied(role, action, data, name) {
  let rejected = false;
  try {
    await rpc(role, action, data);
  } catch (error) {
    rejected = error.status === 400 ||
      error.status === 401 ||
      error.status === 403;
  }
  check(name, rejected);
}

const number = `REAL-AUTH-ACCEPT-${Date.now()}-${randomUUID().slice(0, 8)}`;

const invoice = await rpc("creator", "qadhi_test_invoice_create", {
  p_tenant_id: tenant,
  p_invoice_number: number,
  p_customer_name: "Disposable acceptance test"
});

check("creator_created", Boolean(invoice));

const request = { p_invoice_id: invoice };

check("creator_submitted",
  await rpc("creator", "qadhi_test_invoice_submit", request) === "submitted"
);

await denied(
  "creator", "qadhi_test_invoice_approve", request,
  "self_approval_blocked_before_review"
);

check("reviewer_reviewed",
  await rpc("reviewer", "qadhi_test_invoice_review", request) === "reviewed"
);

await denied(
  "creator", "qadhi_test_invoice_approve", request,
  "self_approval_blocked_after_review"
);

await denied(
  "reviewer", "qadhi_test_invoice_approve", request,
  "reviewer_approval_blocked"
);

await denied(
  "readonly", "qadhi_test_invoice_approve", request,
  "readonly_approval_blocked"
);

check("approver_approved",
  await rpc("approver", "qadhi_test_invoice_approve", request) === "approved"
);

const status = await rpc(
  "approver", "qadhi_test_invoice_get_status", request
);

check("final_approval_verified",
  status.invoice_status === "approved" &&
  status.workflow_stage === "approved" &&
  status.creator === users.creator &&
  status.reviewer === users.reviewer &&
  status.approver === users.approver
);

const evidence = {
  project,
  invoice,
  tests: results,
  completed_at: new Date().toISOString()
};

if (process.env.ACCEPTANCE_EVIDENCE_PATH) {
  await writeFile(
    process.env.ACCEPTANCE_EVIDENCE_PATH,
    JSON.stringify(evidence, null, 2)
  );
}

console.log("REAL AUTH ACCEPTANCE PASSED");
