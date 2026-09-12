import { describe, expect, it, vi } from 'vitest';
import { checkSonar } from '../scripts/sonar-issues.mjs';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

// Answers each of the three calls by the endpoint in its URL.
const stub = ({ issues = [], silenced = [], hotspots = [] }) =>
  vi.fn(async (url) => {
    if (url.includes('/api/hotspots/search')) return ok({ hotspots });
    if (url.includes('issueStatuses=')) return ok({ total: silenced.length, issues: silenced });
    return ok({ total: issues.length, issues });
  });

const run = (fetchImpl) =>
  checkSonar({ token: 't', pr: '56', project: 'p', fetchImpl, sleep: async () => {} });

describe('checkSonar', () => {
  it('retries ten times when fetch rejects, then reports the job should be re-run', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { name: 'TypeError' });
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(run(fetchImpl)).resolves.toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
    error.mockRestore();
  });

  it('does not retry a 401', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(run(fetchImpl)).resolves.toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('passes when all three answers are empty', async () => {
    await expect(run(stub({}))).resolves.toBe(0);
  });

  it('fails on an unresolved issue', async () => {
    const fetchImpl = stub({
      issues: [{ component: 'p:src/a.ts', line: 3, severity: 'MAJOR', rule: 'S1', message: 'm' }],
    });

    await expect(run(fetchImpl)).resolves.toBe(1);
  });

  it('fails on an issue silenced in the SonarCloud UI', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = stub({ silenced: [{ component: 'p:src/a.ts', rule: 'S1', message: 'm' }] });

    await expect(run(fetchImpl)).resolves.toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('sonar-project.properties'));
    log.mockRestore();
  });

  it('fails on a security hotspot to review', async () => {
    const fetchImpl = stub({ hotspots: [{ component: 'p:docker-compose.yml', message: 'creds' }] });

    await expect(run(fetchImpl)).resolves.toBe(1);
  });
});
