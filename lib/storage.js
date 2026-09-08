import { createCloudStore, validateConnection } from './cloud.js';
const DB_NAME = 'dhsud-crls-workspace-v1';
const CONFIG_KEY = 'crls-cloudflare-connection-v1';
let connection;
let cloud, workspaceName = '', mode = 'local';
export function storageInfo() { return { shared: mode === 'shared', name: workspaceName, config: cloud?.config }; }
export function loadConnection() { const saved = localStorage.getItem(CONFIG_KEY); return saved ? validateConnection(JSON.parse(saved)) : null; }
export function activateShared(config, name) { const next = createCloudStore(config); localStorage.setItem(CONFIG_KEY, JSON.stringify(next.config)); cloud = next; workspaceName = name; mode = 'shared'; }
export function disconnectShared() { localStorage.removeItem(CONFIG_KEY); cloud = undefined; workspaceName = ''; mode = 'local'; }
export function sharedVersion() { return cloud.version(); }
export function sharedSnapshot() { return cloud.read(); }
export function acceptSharedSnapshot(snapshot) { workspaceName = snapshot.name; }
export async function openDatabase() {
  const config = loadConnection();
  if (config) { cloud = createCloudStore(config); mode = 'shared'; }
  // Local records remain separate and are only copied to shared storage when
  // the processor explicitly chooses to import/copy them.
  await openLocalDatabase();
}
function openLocalDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' });
    req.onsuccess = () => { connection = req.result; connection.onversionchange = () => connection.close(); resolve(); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other CRLS tabs and reload to finish opening storage.'));
  });
}
export async function readProjects() {
  if (mode === 'shared') { const data = await cloud.read(); workspaceName = data.name; return data.projects; }
  return readLocalProjects();
}
export function readLocalProjects() {
  return new Promise((resolve, reject) => {
    const req = connection.transaction('projects').objectStore('projects').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function writeProjects(projects, deletedIds = [], expected = new Map()) {
  if (mode === 'shared') return cloud.write(projects, deletedIds, expected);
  await writeLocalProjects(projects, deletedIds, expected);
  return projects;
}
function writeLocalProjects(projects, deletedIds = [], expected = new Map()) {
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    let conflict;
    const changes = new Map(projects.map(p => [p.id, p]));
    for (const id of new Set([...deletedIds, ...changes.keys()])) {
      const request = store.get(id);
      request.onsuccess = () => {
        if ((request.result?.updatedAt || null) !== (expected.get(id) || null)) {
          conflict = new Error('This record changed in another tab. Export your work if needed, then reload before saving.');
          tx.abort();
          return;
        }
        if (changes.has(id)) store.put(changes.get(id));
        else store.delete(id);
      };
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(conflict || tx.error || new Error('Save was interrupted.'));
  });
}
