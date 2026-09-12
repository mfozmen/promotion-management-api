// Fails when SonarCloud reports any unresolved issue on the pull request.
// The quality gate cannot do this on the free plan: its conditions are ratings
// and coverage, so CRITICAL code smells pass it. Silence a finding only through
// an approved sonar.issue.ignore entry in sonar-project.properties.
import { readFileSync } from 'node:fs';

const token = process.env.SONAR_TOKEN;
const pr = process.env.PR;
if (!token || !pr) {
  console.error('::error::SONAR_TOKEN and PR are required');
  process.exit(1);
}

// The scanner already reads the project key from here, so the gate reads the
// same line rather than carrying a second copy that can drift from it.
const properties = readFileSync('sonar-project.properties', 'utf8');
const project = /^sonar\.projectKey=(.+)$/m.exec(properties)?.[1]?.trim();
if (!project) {
  console.error('::error::sonar.projectKey is missing from sonar-project.properties');
  process.exit(1);
}

const url = `https://sonarcloud.io/api/issues/search?componentKeys=${project}&pullRequest=${pr}&resolved=false&ps=100`;
const auth = `Basic ${Buffer.from(`${token}:`).toString('base64')}`;

let payload;
for (let attempt = 1; attempt <= 10; attempt += 1) {
  const response = await fetch(url, {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.ok) {
    payload = await response.json();
    break;
  }
  // A rejected token or an unknown project key answers the same way on every
  // attempt, so retrying them only delays a failure that is already decided.
  if (response.status < 500 && response.status !== 429) {
    console.error(`::error::SonarCloud answered ${response.status}; not retrying`);
    process.exit(1);
  }
  console.log(`attempt ${attempt}: SonarCloud answered ${response.status}, retrying`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

if (!payload) {
  console.error('::error::could not read the SonarCloud issue list');
  process.exit(1);
}

// Only the first page is annotated. The verdict below reads the server-side
// total instead, so a list longer than one page still fails the build.
for (const issue of payload.issues ?? []) {
  const file = issue.component?.split(':').pop() ?? project;
  console.log(
    `::error file=${file},line=${issue.line ?? 1}::[${issue.severity}] ${issue.rule} ${issue.message}`,
  );
}

const total = payload.total ?? payload.paging?.total ?? payload.issues?.length ?? 0;
console.log(`unresolved SonarCloud issues: ${total}`);
process.exit(total === 0 ? 0 : 1);
