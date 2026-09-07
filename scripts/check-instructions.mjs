#!/usr/bin/env node
/**
 * Garde-fou du corpus d'instructions hifago/ — ce que `docs_index.js` ne couvre pas (il ne
 * parcourt que `docs/` et garde sa seule mission : le manifeste).
 *
 *   node scripts/check-instructions.mjs   → exit 0 si tout est bon, exit 1 sinon (liste précise)
 *
 * Née de la régression du 2026-08-15 → 2026-09-07 : `CLAUDE.md` §12 avait déjà été vidé une fois
 * ("pour ne plus être chargé automatiquement") et avait regonflé à 569 lignes en trois semaines,
 * sans qu'aucun outil ne le signale. Doctrine du projet (`eslint.rules.mjs`) : « Une règle
 * documentée que rien ne vérifie n'est pas une règle : c'est un souhait. »
 *
 * Contrôles :
 *   1. `CLAUDE.md` ≤ 200 lignes.
 *   2. Chaque `.claude/rules/*.md` ≤ 100 lignes.
 *   3. `docs/backlog.md` ≤ 60 lignes.
 *   4. Tout `CLAUDE.md §N` (ou `§N.M` / `§N point M`) cité dans hifago/ (hors journal/prompts/
 *      archive/node_modules/build) désigne une section — et un sous-point — qui existe vraiment.
 *   5. Tout chemin `.md` cité entre backticks dans le corpus d'instructions (CLAUDE.md, règles,
 *      skills, backlog, AGENTS-PARALLELES.md) résout vers un fichier qui existe.
 *
 * Appelé par le hook PostToolUse (`scripts/hooks/post-edit-check-instructions.mjs`) après chaque
 * édition, et par le job `lint` de la CI comme second filet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LIMITES = {
  'CLAUDE.md': 200,
  'docs/backlog.md': 60,
  REGLE: 100,
};

// Dossiers/fichiers exclus du balayage §4 — build, dépendances, et le corpus explicitement non
// chargé automatiquement (journal, prompts livrés, skills archivés).
const EXCLUS = new Set([
  'node_modules', '.git', '.next', '.vercel', 'dist', 'build', 'coverage',
  'storybook-static', 'test-results', '.turbo',
]);
const EXCLUS_RACINE_RELATIFS = ['docs/journal', 'prompts', 'archive'];

const EXTENSIONS_SCANNEES = new Set([
  '.md', '.ts', '.tsx', '.js', '.mjs', '.sql', '.sh', '.yml', '.yaml',
]);

function marcher(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (EXCLUS_RACINE_RELATIFS.some((p) => rel === p || rel.startsWith(p + '/'))) continue;
    if (entry.isDirectory()) marcher(full, acc);
    else if (EXTENSIONS_SCANNEES.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

function compterLignes(fichier) {
  const texte = fs.readFileSync(fichier, 'utf8');
  return texte.split('\n').length - (texte.endsWith('\n') ? 1 : 0);
}

/** Découpe CLAUDE.md en sections `## N. ...` → { n: { titre, points: Set<number> } }. */
function parserSections(texteClaudeMd) {
  const sections = new Map();
  const lignes = texteClaudeMd.split('\n');
  let courante = null;
  for (const ligne of lignes) {
    const entete = /^## (\d+)\.\s*(.*)$/.exec(ligne);
    if (entete) {
      courante = { titre: entete[2], points: new Set() };
      sections.set(Number(entete[1]), courante);
      continue;
    }
    if (courante) {
      const point = /^(\d+)\.\s/.exec(ligne);
      if (point) courante.points.add(Number(point[1]));
    }
  }
  return sections;
}

/** Trouve chaque citation `CLAUDE.md §N`, `§N.M`, `§N point M`, `§ N` dans un texte. */
function extraireCitations(texte) {
  const citations = [];
  // §N.M ou §N point M ou § N point M ou §N (sans point) — capturé séparément pour ne pas
  // confondre un simple "§3" avec "§3.5" (la présence du point/mot "point" décide du sous-point).
  const re = /§\s*(\d+)(?:\s*[.\s]\s*(?:point\s*)?(\d+))?/g;
  let m;
  while ((m = re.exec(texte))) {
    citations.push({ section: Number(m[1]), point: m[2] ? Number(m[2]) : null, brut: m[0] });
  }
  return citations;
}

/** Chemins `` `xxx.md` `` cités dans un texte, résolus depuis `depuisDir`. */
function extraireCheminsMd(texte) {
  const chemins = [];
  const re = /`([A-Za-z0-9_.\-/]+\.md)`/g;
  let m;
  while ((m = re.exec(texte))) chemins.push(m[1]);
  return chemins;
}

function verifier() {
  const problemes = [];

  // 1-2. Tailles.
  const claudeMdPath = path.join(ROOT, 'CLAUDE.md');
  const nClaude = compterLignes(claudeMdPath);
  if (nClaude > LIMITES['CLAUDE.md']) {
    problemes.push(
      `CLAUDE.md fait ${nClaude} lignes (> ${LIMITES['CLAUDE.md']}) : l'état va au journal ` +
      `(docs/journal/<mois>.md), les points ouverts au backlog (docs/backlog.md), le savoir ` +
      `situationnel dans une règle .claude/rules/*.md — pas ici.`
    );
  }
  const backlogPath = path.join(ROOT, 'docs/backlog.md');
  if (fs.existsSync(backlogPath)) {
    const n = compterLignes(backlogPath);
    if (n > LIMITES['docs/backlog.md']) {
      problemes.push(
        `docs/backlog.md fait ${n} lignes (> ${LIMITES['docs/backlog.md']}) : un groupe entier ` +
        `doit partir en spec ou en ticket séparé plutôt que de rester ici.`
      );
    }
  }
  const reglesDir = path.join(ROOT, '.claude/rules');
  if (fs.existsSync(reglesDir)) {
    for (const f of fs.readdirSync(reglesDir)) {
      if (!f.endsWith('.md')) continue;
      const n = compterLignes(path.join(reglesDir, f));
      if (n > LIMITES.REGLE) {
        problemes.push(
          `.claude/rules/${f} fait ${n} lignes (> ${LIMITES.REGLE}) : le piège le plus ancien ` +
          `part au journal avec un lien depuis la règle.`
        );
      }
    }
  }

  // 3. Renvois `CLAUDE.md §N[.M]` — chaque section et sous-point cités doivent exister.
  const texteClaudeMd = fs.readFileSync(claudeMdPath, 'utf8');
  const sections = parserSections(texteClaudeMd);
  const fichiers = marcher(ROOT);
  const vusManquants = new Set();
  for (const fichier of fichiers) {
    if (fichier === claudeMdPath) continue;
    const rel = path.relative(ROOT, fichier).replace(/\\/g, '/');
    const texte = fs.readFileSync(fichier, 'utf8');
    if (!/CLAUDE\.md/.test(texte)) continue;
    // Ne considérer une citation `§N` que si `CLAUDE.md` apparaît dans les ~80 caractères qui
    // précèdent, pour ne pas confondre avec un `§N` de cahier des charges ou de spec.
    const re = /CLAUDE\.md[^\n]{0,80}?§\s*\d+(?:\s*[.\s]\s*(?:point\s*)?\d+)?/g;
    let m;
    while ((m = re.exec(texte))) {
      for (const c of extraireCitations(m[0])) {
        const cle = `${rel}::§${c.section}${c.point ? '.' + c.point : ''}`;
        if (vusManquants.has(cle)) continue;
        const section = sections.get(c.section);
        if (!section) {
          problemes.push(`${rel} cite CLAUDE.md §${c.section} — cette section n'existe plus.`);
          vusManquants.add(cle);
        } else if (c.point !== null && !section.points.has(c.point)) {
          problemes.push(
            `${rel} cite CLAUDE.md §${c.section}.${c.point} — ce sous-point n'existe plus dans ` +
            `« ${section.titre} » (points actuels : ${[...section.points].sort((a, b) => a - b).join(', ') || 'aucun'}).`
          );
          vusManquants.add(cle);
        }
      }
    }
  }

  // 4. Chemins `.md` cités dans le corpus d'instructions — doivent exister.
  const corpus = [
    'CLAUDE.md',
    'AGENTS-PARALLELES.md',
    'docs/backlog.md',
    ...(fs.existsSync(reglesDir) ? fs.readdirSync(reglesDir).filter((f) => f.endsWith('.md')).map((f) => `.claude/rules/${f}`) : []),
  ];
  const skillsDir = path.join(ROOT, '.claude/skills');
  if (fs.existsSync(skillsDir)) {
    for (const s of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (s.isDirectory() && fs.existsSync(path.join(skillsDir, s.name, 'SKILL.md'))) {
        corpus.push(`.claude/skills/${s.name}/SKILL.md`);
      }
    }
  }
  for (const relCorpus of corpus) {
    const p = path.join(ROOT, relCorpus);
    if (!fs.existsSync(p)) continue;
    const texte = fs.readFileSync(p, 'utf8');
    for (const cible of extraireCheminsMd(texte)) {
      // Résolution façon `@import` : depuis la racine, sinon depuis le dossier du fichier citant
      // (couvre les renvois courts entre fichiers voisins, ex. `.claude/rules/apps.md` → `ui.md`).
      const depuisRacine = path.join(ROOT, cible);
      const depuisDossier = path.join(path.dirname(p), cible);
      if (!fs.existsSync(depuisRacine) && !fs.existsSync(depuisDossier)) {
        problemes.push(`${relCorpus} cite \`${cible}\` — ce fichier n'existe pas.`);
      }
    }
  }

  return problemes;
}

const problemes = verifier();
if (problemes.length) {
  console.error('Corpus d\'instructions hifago/ — problèmes détectés :\n');
  for (const p of problemes) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}
console.log('Corpus d\'instructions hifago/ OK.');
