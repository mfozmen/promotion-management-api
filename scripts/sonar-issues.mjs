// Fails when SonarCloud reports any unresolved issue on the pull request.
// The quality gate cannot do this on the free plan: its conditions are ratings
// and coverage, so CRITICAL code smells pass it. Silence a finding only through
// an approved sonar.issue.ignore entry in sonar-project.properties.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ATTEMPTS = 10;

/**
 * Three questions, one verdict: issues still open, issues silenced from the
 * SonarCloud web interface (REVIEW.md 13.6 allows only an approved entry in
 * sonar-project.properties), and security hotspots, which the issue search
 * never returns. Returns the exit code.
 */
export async function checkSonar({
  token,
  pr,
  project,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const auth = `Basic ${Buffer.from(`${token}:`).toString('base64')}`;

  async function get(url) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          headers: { authorization: auth },
          signal: AbortSignal.timeout(20_000),
        });
        if (response.ok) return await response.json();
        // A rejected token or an unknown project key answers the same way on
        // every attempt, so retrying them only delays a decided failure.
        if (response.status < 500 && response.status !== 429) {
          console.error(`::error::SonarCloud answered ${response.status}; not retrying`);
          return null;
        }
        console.log(`attempt ${attempt}: SonarCloud answered ${response.status}, retrying`);
      } catch (error) {
        // fetch throws instead of answering when the host is unreachable
        // (TypeError) or the 20 s abort fires (TimeoutError), and a truncated
        // body throws out of json(). All three are transient, so all retry.
        console.log(`attempt ${attempt}: ${error.name}: ${error.message}, retrying`);
      }
      await sleep(10_000);
    }
    console.error(`::error::SonarCloud unreachable after ${ATTEMPTS} attempts — re-run the job`);
    return null;
  }

  const search = (path, query) =>
    get(`https://sonarcloud.io/api/${path}?${new URLSearchParams({ ...query, ps: '100' })}`);

  const file = (component) => component?.split(':').pop() ?? project;
  // Only the first page is annotated. The counts read the server-side total
  // instead, so a list longer than one page still fails the build.
  const count = (payload, key) =>
    payload.total ?? payload.paging?.total ?? payload[key]?.length ?? 0;

  const open = await search('issues/search', {
    componentKeys: project,
    pullRequest: pr,
    resolved: 'false',
  });
  if (!open) return 1;
  for (const issue of open.issues ?? []) {
    console.log(
      `::error file=${file(issue.component)},line=${issue.line ?? 1}::[${issue.severity}] ${issue.rule} ${issue.message}`,
    );
  }

  // Accept / Won't fix / False positive in the web interface sets a resolution,
  // which drops the issue out of the query above and turns this gate green with
  // nothing in the diff. ACCEPTED and FALSE_POSITIVE are the current names of
  // the deprecated WONTFIX and FALSE-POSITIVE resolutions; sending both
  // parameters would intersect the two sets rather than widen them.
  const silenced = await search('issues/search', {
    componentKeys: project,
    pullRequest: pr,
    issueStatuses: 'ACCEPTED,FALSE_POSITIVE',
  });
  if (!silenced) return 1;
  for (const issue of silenced.issues ?? []) {
    console.log(
      `::error file=${file(issue.component)},line=${issue.line ?? 1}::${issue.rule} ${issue.message} — silenced in the SonarCloud UI. Move it into sonar-project.properties with the owner's approval, or fix it.`,
    );
  }

  // Hotspots are not issues: the search above never returns them, so without
  // this call one sits behind the green badge this gate exists to remove.
  const hotspots = await search('hotspots/search', {
    projectKey: project,
    pullRequest: pr,
    status: 'TO_REVIEW',
  });
  if (!hotspots) return 1;
  for (const hotspot of hotspots.hotspots ?? []) {
    console.log(
      `::error file=${file(hotspot.component)},line=${hotspot.line ?? 1}::security hotspot to review: ${hotspot.message}`,
    );
  }

  const totals = [count(open, 'issues'), count(silenced, 'issues'), count(hotspots, 'hotspots')];
  console.log(
    `unresolved issues: ${totals[0]}, silenced in the UI: ${totals[1]}, hotspots to review: ${totals[2]}`,
  );
  return totals.reduce((sum, value) => sum + value, 0) === 0 ? 0 : 1;
}

// CI runs the file, the test imports it; only the former should do any work.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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

  process.exit(await checkSonar({ token, pr, project }));
}
