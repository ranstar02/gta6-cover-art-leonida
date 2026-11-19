// Leonida Cover Co. — the hand-in program for gta6-cover-art-01.
// Leonida build stamp, written by this session: leonida-cover-co-v1.
// It runs on Node 22 with only the standard library. Given a destination
// folder (MAKEFUN_OUTPUT_DIR, or /output in the grader), it copies the
// finished app/ and screenshots/ beside this file into that folder and
// writes dossier.json there using the vendored make.fun library, so the
// judge can read the entry. Nothing here is random or time-dependent:
// run it twice and the two outputs are byte for byte the same.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

// Where this program lives, and where the hand-in goes.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const destination = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The caps the sealed scorer enforces: keep the hand-in inside them, and
// refuse (by letting buildDossier throw) rather than ship a bad dossier.
const dossierOptions = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
};

mkdirSync(destination, { recursive: true });
cpSync(join(repoRoot, 'app'), join(destination, 'app'), { recursive: true });
mkdirSync(join(destination, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(destination, 'screenshots'), { recursive: true });
}

writeFileSync(join(destination, 'dossier.json'), buildDossier(destination, dossierOptions));
