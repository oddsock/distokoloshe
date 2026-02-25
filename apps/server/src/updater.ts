import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const UPDATES_DIR = path.resolve(process.env.DATA_DIR || './data', 'updates');
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface UpdateManifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { url: string; signature: string }>;
}

function loadCurrentManifest(): UpdateManifest | null {
  const manifestPath = path.join(UPDATES_DIR, 'latest.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function fetchJSON(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'disTokoloshe-updater',
        Accept: 'application/vnd.github+json',
        ...headers,
      },
    }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJSON(res.headers.location, headers).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url: string, dest: string, headers: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'disTokoloshe-updater',
        Accept: 'application/octet-stream',
        ...headers,
      },
    }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, dest, headers).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
    }).on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
  });
}

// Download the text content of a signature file
function downloadText(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'disTokoloshe-updater',
        ...headers,
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadText(res.headers.location, headers).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data.trim()));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Detect platform from asset filename
function detectPlatform(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.includes('x64') || lower.includes('x86_64') || lower.includes('amd64')) {
    if (lower.endsWith('.exe') || lower.endsWith('.msi') || lower.includes('nsis')) {
      return 'windows-x86_64';
    }
    if (lower.endsWith('.appimage') || lower.endsWith('.deb')) {
      return 'linux-x86_64';
    }
    if (lower.endsWith('.dmg') || lower.endsWith('.app.tar.gz')) {
      return 'darwin-x86_64';
    }
  }
  if (lower.includes('aarch64') || lower.includes('arm64')) {
    if (lower.endsWith('.dmg') || lower.endsWith('.app.tar.gz')) {
      return 'darwin-aarch64';
    }
    if (lower.endsWith('.appimage') || lower.endsWith('.deb')) {
      return 'linux-aarch64';
    }
  }
  return null;
}

async function syncFromGitHub(): Promise<void> {
  const repo = process.env.GITHUB_REPO;
  if (!repo) return;

  const headers: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const release = await fetchJSON(
      `https://api.github.com/repos/${repo}/releases/latest`,
      headers,
    ) as GitHubRelease;

    const version = release.tag_name.replace(/^v/, '');
    const current = loadCurrentManifest();

    if (current && !isNewer(version, current.version)) {
      return; // Already up to date
    }

    console.log(`[updater] New release found: v${version}`);

    // Ensure updates directory exists
    fs.mkdirSync(UPDATES_DIR, { recursive: true });

    // Find installer + signature pairs
    const platforms: Record<string, { url: string; signature: string }> = {};

    for (const asset of release.assets) {
      // Skip signature files — they're paired with their binary
      if (asset.name.endsWith('.sig')) continue;

      const platform = detectPlatform(asset.name);
      if (!platform) continue;

      // Look for matching .sig file
      const sigAsset = release.assets.find((a) => a.name === `${asset.name}.sig`);
      if (!sigAsset) {
        console.log(`[updater] Skipping ${asset.name} — no matching .sig file`);
        continue;
      }

      console.log(`[updater] Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)}MB)...`);
      const destPath = path.join(UPDATES_DIR, asset.name);
      await downloadFile(asset.browser_download_url, destPath, headers);

      console.log(`[updater] Downloading ${sigAsset.name}...`);
      const signature = await downloadText(sigAsset.browser_download_url, headers);

      platforms[platform] = {
        url: asset.name, // Relative filename — route builds absolute URL
        signature,
      };

      console.log(`[updater] ${platform} ready: ${asset.name}`);
    }

    if (Object.keys(platforms).length === 0) {
      console.log('[updater] No valid platform assets found in release');
      return;
    }

    // Write manifest
    const manifest: UpdateManifest = {
      version,
      notes: release.body || release.name || '',
      pub_date: release.published_at,
      platforms,
    };

    fs.writeFileSync(
      path.join(UPDATES_DIR, 'latest.json'),
      JSON.stringify(manifest, null, 2),
    );

    console.log(`[updater] Manifest updated to v${version} with platforms: ${Object.keys(platforms).join(', ')}`);

    // Clean up old version files (keep only current version's files)
    const currentFiles = new Set<string>();
    currentFiles.add('latest.json');
    for (const p of Object.values(platforms)) {
      currentFiles.add(p.url);
    }
    for (const file of fs.readdirSync(UPDATES_DIR)) {
      if (!currentFiles.has(file)) {
        fs.unlinkSync(path.join(UPDATES_DIR, file));
        console.log(`[updater] Cleaned up old file: ${file}`);
      }
    }
  } catch (err) {
    console.error('[updater] Sync failed:', (err as Error).message);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startUpdateSync(): void {
  if (!process.env.GITHUB_REPO) {
    console.log('[updater] GITHUB_REPO not set — auto-sync disabled');
    return;
  }

  console.log(`[updater] Auto-sync enabled for ${process.env.GITHUB_REPO} (checking every 60 min)`);

  // Initial check after 5 seconds (let server finish starting)
  setTimeout(() => syncFromGitHub(), 5_000);

  // Periodic check
  intervalId = setInterval(() => syncFromGitHub(), CHECK_INTERVAL_MS);
}

export function stopUpdateSync(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
