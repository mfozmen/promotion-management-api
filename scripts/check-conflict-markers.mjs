import { execFileSync } from 'node:child_process';
import process from 'node:process';

const PATTERNS = ['^<<<<<<< ', '^>>>>>>> ', '^=======$'];

function search(extra) {
  try {
    return execFileSync(
      'git',
      ['grep', '-n', ...extra, ...PATTERNS.flatMap((p) => ['-e', p]), '--', '.', ':!node_modules'],
      { encoding: 'utf8' },
    );
  } catch (error) {
    // git grep exits 1 when it matches nothing, which is the good case.
    if (error.status === 1) return '';
    throw error;
  }
}

const unmerged = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], {
  encoding: 'utf8',
}).trim();

// The index as well as the working tree: `git add -A` after a conflict stages the
// markers, and they then stop showing as unmerged anywhere (REVIEW.md 13.8).
const found = [search([]), search(['--cached'])].join('');

if (found || unmerged) {
  process.stderr.write(found);
  if (unmerged) process.stderr.write(`unmerged paths:\n${unmerged}\n`);
  process.exit(1);
}
