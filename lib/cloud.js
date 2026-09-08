export function validateConnection(input) {
  if (!input || typeof input !== 'object') throw new Error('Enter the shared workspace connection details.');
  let url;
  try { url = new URL(input.url); } catch { throw new Error('Enter a valid Cloudflare Worker URL.'); }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '8787';
  const hosted = url.protocol === 'https:' && /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) && !url.port;
  if ((!hosted && !local) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Use your Worker address: https://crls-api.your-account.workers.dev.');
  if (typeof input.workspaceKey !== 'string' || !/^[a-f0-9]{64}$/.test(input.workspaceKey)) throw new Error('Enter the 64-character workspace key generated during setup.');
  return { url: url.origin, workspaceKey: input.workspaceKey };
}
export function invitationLink(connection, siteUrl) {
  const url = new URL(siteUrl);
  url.search = '';
  url.hash = 'connect=' + new URLSearchParams(validateConnection(connection)).toString();
  return url.href;
}
export function parseInvitation(hash) {
  if (!hash.startsWith('#connect=')) return null;
  if (hash.length > 2000) throw new Error('Invalid workspace invitation.');
  return validateConnection(Object.fromEntries(new URLSearchParams(hash.slice(9))));
}
export function sharedRecord(project) {
  const p = structuredClone(project);
  delete p._revision;
  for (const review of Object.values(p.reviews)) delete review.files;
  return p;
}
export function createCloudStore(input, fetcher = globalThis.fetch) {
  const config = validateConnection(input);
  let pending;
  async function request(path, body) {
    let response;
    try {
      response = await fetcher(`${config.url}/api/${path}`, {
        method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
        headers: { Authorization: `Bearer ${config.workspaceKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000)
      });
    } catch { throw new Error('Cannot reach the shared database. Check your internet connection. An interrupted save may already have reached the server; retry the same save or refresh to check.'); }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 409) throw new Error('Another processor changed this project. Copy your unsaved remarks, then reload the latest records before saving again.');
      if (response.status === 401 || response.status === 403) throw new Error('Workspace access was denied. Check the key and allowed website address, or request a current workspace link.');
      if ([400, 413].includes(response.status)) throw new Error(result?.error || 'The shared database rejected the project data.');
      throw new Error('Shared storage is unavailable. Retry later or check the Cloudflare deployment and free-plan usage.');
    }
    return result;
  }
  function records(value) {
    if (!Array.isArray(value) || value.some(p => !p || typeof p._revision !== 'string')) throw new Error('Invalid shared database response.');
    return value;
  }
  return {
    config,
    async version() { const result = await request('version'); if (!Number.isInteger(result?.version)) throw new Error('Invalid workspace version.'); return result.version; },
    async read() {
      const result = await request('workspace');
      if (typeof result?.name !== 'string' || !Number.isInteger(result?.version)) throw new Error('Invalid shared workspace response.');
      return { name: result.name, version: result.version, projects: records(result.projects) };
    },
    async write(projects, deleted, expected) {
      const changes = projects.map(sharedRecord);
      const ids = [...new Set([...changes.map(p => p.id), ...deleted])].sort();
      const revisions = Object.fromEntries(ids.map(id => [id, expected.get(id) || null]));
      const fingerprintProjects = structuredClone(changes);
      for (const p of fingerprintProjects) { delete p.updatedAt; for (const r of Object.values(p.reviews)) delete r.updatedAt; }
      const fingerprint = JSON.stringify({ changes: fingerprintProjects, deleted, revisions });
      if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, body: { changes, deleted, expected: revisions, requestId: crypto.randomUUID() } };
      const result = await request('workspace', pending.body);
      const saved = records(result?.projects);
      pending = undefined;
      return saved;
    }
  };
}
