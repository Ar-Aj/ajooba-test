import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const DEV_PORTS = [3000, 3001, 4000];

function freePortsOnWindows(ports) {
  let netstatOutput = '';
  try {
    netstatOutput = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  } catch {
    return;
  }

  const pidsToKill = new Set();
  for (const line of netstatOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.includes('LISTENING')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const localAddr = parts[1] ?? '';
    const pidStr = parts[parts.length - 1] ?? '';
    const pid = Number.parseInt(pidStr, 10);
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;

    for (const port of ports) {
      if (localAddr.endsWith(`:${port}`)) {
        pidsToKill.add(pid);
      }
    }
  }

  for (const pid of pidsToKill) {
    try {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
      console.log(`[dev-ports] Freed port process PID ${pid}`);
    } catch {
      // Process already exited
    }
  }
}

function freePortsOnPosix(ports) {
  for (const port of ports) {
    try {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' }).trim();
      for (const pidStr of out.split(/\r?\n/)) {
        const pid = Number.parseInt(pidStr, 10);
        if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
          try {
            process.kill(pid, 'SIGKILL');
            console.log(`[dev-ports] Freed port ${port} (PID ${pid})`);
          } catch {
            // Process already exited
          }
        }
      }
    } catch {
      // No process listening on this port
    }
  }
}

if (process.platform === 'win32') {
  freePortsOnWindows(DEV_PORTS);
} else {
  freePortsOnPosix(DEV_PORTS);
}

for (const app of ['storefront', 'admin']) {
  const lockFile = path.join(rootDir, 'apps', app, '.next', 'dev', 'lock');
  if (fs.existsSync(lockFile)) {
    try {
      fs.rmSync(lockFile, { force: true });
      console.log(`[dev-ports] Removed stale lock ${lockFile}`);
    } catch {
      // Ignore
    }
  }
}
