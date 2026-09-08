import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'worker/wrangler.jsonc');
const privateDir = resolve(root, '.wrangler');
const keyPath = resolve(privateDir, 'workspace-key.txt');
const connectionPath = resolve(privateDir, 'connection.json');
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const env = { ...process.env, XDG_CONFIG_HOME: privateDir };

if (!existsSync(wrangler)) {
  throw new Error('Wrangler is not installed. Run npm install, then run this command again.');
}

await mkdir(privateDir, { recursive: true });

function run(args, { input, inherit = false, allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    input,
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (!inherit && output.trim()) process.stdout.write(output);
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`Wrangler failed: wrangler ${args.join(' ')}`);
  }
  return { ...result, output };
}

const identity = run(['whoami'], { allowFailure: true });
if (identity.status !== 0 || /not authenticated/i.test(identity.output)) {
  console.log('\nCloudflare sign-in is required. A browser window will open.');
  run(['login'], { inherit: true });
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
let siteOrigin;
let pagesPending = false;
let workspaceName;
try {
  while (!siteOrigin && !pagesPending) {
    const answer = (await prompt.question('\nGitHub Pages URL (leave blank if it is not published yet): ')).trim();
    if (!answer) { pagesPending = true; break; }
    try {
      const parsed = new URL(answer);
      if (parsed.protocol !== 'https:') throw new Error();
      siteOrigin = parsed.origin;
    } catch {
      console.log('Enter the published HTTPS address for the checklist app.');
    }
  }
  workspaceName = (await prompt.question('Shared workspace name [DHSUD CRLS]: ')).trim() || 'DHSUD CRLS';
  if (workspaceName.length > 100) throw new Error('Workspace name must be 100 characters or fewer.');
} finally {
  prompt.close();
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
let databaseId = config.d1_databases?.[0]?.database_id;

if (!databaseId || databaseId.startsWith('REPLACE_')) {
  console.log('\nCreating the D1 database in the Asia-Pacific region...');
  const created = run(['d1', 'create', 'crls-records', '--location', 'apac'], { allowFailure: true });
  databaseId = created.output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
  if (!databaseId) {
    const listed = run(['d1', 'list', '--json']);
    const jsonStart = listed.output.indexOf('[');
    const databases = JSON.parse(listed.output.slice(jsonStart));
    databaseId = databases.find((database) => database.name === 'crls-records')?.uuid;
  }
  if (!databaseId) throw new Error('Could not determine the D1 database ID.');
  config.d1_databases[0].database_id = databaseId;
}

const existingOrigins = String(config.vars?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(value => value.startsWith('https://'));
config.vars = {
  ...(config.vars || {}),
  WORKSPACE_NAME: workspaceName,
  ALLOWED_ORIGINS: [...new Set([...(siteOrigin ? [siteOrigin] : existingOrigins), 'http://127.0.0.1:4173', 'http://localhost:4173'])].join(','),
};
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

console.log('\nApplying the database schema...');
run(['d1', 'execute', 'DB', '--remote', '--file', 'worker/schema.sql', '--yes', '--config', 'worker/wrangler.jsonc']);

let workspaceKey;
if (existsSync(keyPath)) {
  workspaceKey = (await readFile(keyPath, 'utf8')).trim();
}
if (!/^[0-9a-f]{64}$/.test(workspaceKey || '')) {
  workspaceKey = randomBytes(32).toString('hex');
  await writeFile(keyPath, `${workspaceKey}\n`, 'utf8');
  await chmod(keyPath, 0o600).catch(() => {});
}

console.log('Saving the private workspace key as an encrypted Worker secret...');
run(['secret', 'put', 'WORKSPACE_KEY', '--config', 'worker/wrangler.jsonc'], { input: `${workspaceKey}\n` });

console.log('\nDeploying the Worker API...');
const deployed = run(['deploy', '--config', 'worker/wrangler.jsonc']);
const workerUrl = deployed.output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/gi)?.at(-1)?.replace(/\/$/, '');
if (!workerUrl) throw new Error('Deployment completed, but the Worker URL could not be read from Wrangler output.');

const connection = { url: workerUrl, workspaceKey };
await writeFile(connectionPath, `${JSON.stringify(connection, null, 2)}\n`, 'utf8');
await chmod(connectionPath, 0o600).catch(() => {});

console.log('\nCloudflare shared storage is ready.');
console.log(`Worker URL: ${workerUrl}`);
console.log('Workspace key: saved privately (64-character hexadecimal key)');
console.log(`Private copy: ${connectionPath}`);
console.log('\nOpen the checklist, choose Shared workspace, and enter the URL and key.');
console.log('These private files are ignored by Git. Do not commit or publish the workspace key.');
if (pagesPending) console.log('After GitHub Pages is published, rerun this command and enter its final URL to allow that website.');
