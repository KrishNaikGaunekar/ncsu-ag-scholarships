// Publishes dist/ to the gh-pages branch of this repo's origin (GitHub Pages
// source: "Deploy from a branch" → gh-pages / root). Run via `npm run deploy`.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
const origin = execSync('git remote get-url origin').toString().trim();

writeFileSync('dist/.nojekyll', '');
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run('git commit -q -m "Deploy to GitHub Pages"', 'dist');
run(`git push -f "${origin}" gh-pages`, 'dist');
console.log('Deployed to gh-pages.');
