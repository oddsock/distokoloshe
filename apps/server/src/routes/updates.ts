import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

const UPDATES_DIR = path.resolve(process.env.DATA_DIR || './data', 'updates');

interface PlatformEntry {
  url: string;
  signature: string;
}

interface UpdateManifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, PlatformEntry>;
}

function loadManifest(): UpdateManifest | null {
  const manifestPath = path.join(UPDATES_DIR, 'latest.json');
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Simple semver comparison: returns true if a > b
function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

// GET /api/updates/:target/:arch/:current_version — Tauri-compatible update check
// Returns update manifest or 204 if up to date
router.get('/:target/:arch/:current_version', (req: Request, res: Response) => {
  const { target, arch, current_version } = req.params;
  const manifest = loadManifest();

  if (!manifest) {
    res.status(204).end();
    return;
  }

  if (!isNewer(manifest.version, current_version)) {
    res.status(204).end();
    return;
  }

  const platformKey = `${target}-${arch}`;
  const platform = manifest.platforms[platformKey];

  if (!platform) {
    res.status(204).end();
    return;
  }

  // Build absolute download URL based on request origin
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  const baseUrl = `${proto}://${host}`;
  const downloadUrl = platform.url.startsWith('http')
    ? platform.url
    : `${baseUrl}/api/updates/download/${platform.url}`;

  res.json({
    version: manifest.version,
    notes: manifest.notes || '',
    pub_date: manifest.pub_date || new Date().toISOString(),
    url: downloadUrl,
    signature: platform.signature,
  });
});

// GET /api/updates/download/:filename — Serve update binary
router.get('/download/:filename', (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filePath = path.join(UPDATES_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Update file not found' });
    return;
  }

  const stat = fs.statSync(filePath);
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Length', String(stat.size));
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('Cache-Control', 'public, max-age=86400, immutable');

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

// GET /api/updates/status — Check sync status (admin info)
router.get('/status', (_req: Request, res: Response) => {
  const manifest = loadManifest();
  const syncEnabled = !!process.env.GITHUB_REPO;

  res.json({
    currentVersion: manifest?.version || null,
    platforms: manifest ? Object.keys(manifest.platforms) : [],
    autoSync: syncEnabled,
    githubRepo: process.env.GITHUB_REPO || null,
  });
});

export default router;
