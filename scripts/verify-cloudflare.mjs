import { readFile } from 'node:fs/promises';

const connection = JSON.parse(await readFile(new URL('../.wrangler/connection.json', import.meta.url), 'utf8'));
const response = await fetch(`${connection.url}/api/workspace`, {
  headers: { Authorization: `Bearer ${connection.workspaceKey}`, Origin: 'http://127.0.0.1:4173' },
});
const data = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(data.error || `Cloudflare returned HTTP ${response.status}.`);
if (!Number.isInteger(data.version) || !Array.isArray(data.projects)) throw new Error('Cloudflare returned an invalid workspace response.');
console.log(`Connected to ${data.name} at ${connection.url}`);
console.log(`Workspace version: ${data.version}; projects: ${data.projects.length}`);
