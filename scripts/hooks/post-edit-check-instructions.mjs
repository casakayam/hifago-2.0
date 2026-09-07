#!/usr/bin/env node
/**
 * Hook PostToolUse (Edit|Write) — relaie `check-instructions.mjs` à l'agent immédiatement après
 * chaque édition, sans attendre un commit ni la CI. Voir scripts/check-instructions.mjs pour le
 * pourquoi : la régression du 2026-08-15 → 2026-09-07 n'aurait pas duré 3 semaines si ce contrôle
 * avait existé au moment de l'écriture.
 *
 * exit 2 ici NE bloque PAS l'édition (elle a déjà eu lieu) : « Shows stderr to Claude » — l'agent
 * voit le message dans la foulée et peut corriger avant de continuer. C'est délibéré : le point
 * qu'on vérifie (taille d'un fichier, cohérence des renvois) est une propriété du contenu APRÈS
 * édition, pas quelque chose de bloquable AVANT.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/check-instructions.mjs')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.exit(0);
} catch (err) {
  const sortie = (err.stdout || '').toString() + (err.stderr || '').toString();
  process.stderr.write(sortie || 'check-instructions.mjs a échoué sans message.\n');
  process.exit(2);
}
