import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSecretText } from '../lib/secret-scan.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const excludedDirectories = new Set(['.git', 'node_modules', 'fixtures', 'validation']);
const findings = [];
let scannedFiles = 0;

function scanDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      findings.push({ path: path.relative(root, path.join(directory, entry.name)), reasons: ['SYMLINK_DENIED'] });
      continue;
    }
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) scanDirectory(path.join(directory, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    if (relative === 'bin/page-autodev-dataforseo-credential-scan.mjs') continue;
    const body = fs.readFileSync(absolute, 'utf8');
    scannedFiles += 1;
    const reasons = scanSecretText(body);
    if (reasons.length) findings.push({ path: relative, reasons });
  }
}

scanDirectory(root);
const result = { ok: findings.length === 0, scanned_files: scannedFiles, findings };
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
