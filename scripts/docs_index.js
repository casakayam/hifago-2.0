#!/usr/bin/env node
/**
 * Manifeste documentaire pour les agents IA — hifago/ (nouveau stack, dépôt séparé).
 *
 *   node scripts/docs_index.js --build   → (re)génère docs/ai-index.json
 *   node scripts/docs_index.js --check   → vérifie la cohérence, sort en erreur si dérive
 *
 * Même mécanisme que le manifeste du dépôt racine (`scripts/docs_index.js` à la racine du repo
 * Casa Kayam) — dupliqué ici plutôt que partagé car `hifago/` est un dépôt git séparé, cloné
 * indépendamment. Le manifeste est la porte d'entrée d'une IA travaillant dans `hifago/` : elle
 * le lit UNE fois puis ouvre un seul document. Il est dérivé de l'en-tête `---` de chaque fichier
 * de `docs/`, donc il ne peut pas mentir : si un document change de résumé, on régénère.
 *
 * Règle : tout nouveau document de `docs/` doit avoir un en-tête, et `npm run docs:check`
 * doit rester vert avant un commit.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, 'ai-index.json');

/** Table de routage sujet → document. Éditée à la main, préservée à chaque régénération. */
const ROUTAGE = {
  'stack technique, architecture cible, décisions déjà tranchées à ne pas rouvrir': 'docs/04-architecture-cible.md',
  'squelette RPC anti-survente, test de concurrence, recherche géo+JSONB à copier': 'docs/05-reference-technique.md',
  'modèle de données cible : entités, champs, établissement/chambre/produit/compte': 'docs/00-modele-de-donnees.md',
  'cahier des charges portail client (marketplace, réservation)': 'docs/01-cahier-des-charges-client.md',
  'cahier des charges portail socio (référent, prestador)': 'docs/02-cahier-des-charges-socio.md',
  'cahier des charges back-office admin': 'docs/03-cahier-des-charges-admin.md',
  'sommaire des specs de feature, gabarit réutilisable': 'docs/specs/README.md',
  'gabarit à copier pour spécifier une nouvelle feature': 'docs/specs/_modele.md',
  'comment poser les bonnes questions à Jérôme avant d\'écrire une spec, clarifier une ambiguïté': 'docs/specs/avant-la-spec.md',
  "historique complet d'une feature déjà livrée (jamais chargé automatiquement)": 'docs/journal/',
};

/** Fiabilité d'un thème : ce qu'une IA a le droit d'en déduire. */
const THEMES = {
  cadrage: { dossier: 'docs/', fiabilite: 'cible', note: "Cahiers des charges et architecture cible de la refonte. Décrit ce qui doit exister, pas forcément déjà codé — croiser avec le statut de la section." },
  specs: { dossier: 'docs/specs/', fiabilite: 'cible', note: "⚠️ Spec d'une feature précise, prête à coder. Vérifier le statut (`implemente`/`brouillon`) avant de citer comme déjà livré." },
  journal: { dossier: 'docs/journal/', fiabilite: 'vivant', note: "Historique chronologique, jamais élagué. Jamais chargé automatiquement en session — à ouvrir seulement pour comprendre une décision passée." },
};

const PROTOCOLE = [
  "Lire `routage` (sujet → chemin) : il est en tête de ce fichier et couvre les cas courants. Si le sujet y figure, s'arrêter là.",
  "Sinon seulement, lire `documents` et croiser `cles` et `questions`.",
  "N'ouvrir qu'UN document. Son en-tête `---` répète ces métadonnées : les 20 premières lignes confirment le bon choix.",
  "Vérifier `themes[<theme>].fiabilite` avant de citer : `cible` ne décrit pas forcément un comportement déjà livré.",
  "En cas de contradiction entre deux documents, le code fait foi, puis `hifago/docs/04-architecture-cible.md`.",
  "Ne jamais parcourir docs/ en entier ni ouvrir plusieurs gros fichiers « pour voir ».",
];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

/** Parseur d'en-tête minimal : suffisant pour le sous-ensemble YAML qu'on s'autorise. */
function parseFrontMatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(4, end);
  const out = {};
  let key = null;
  let mode = null;
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m && !line.startsWith(' ')) {
      key = m[1];
      const val = m[2].trim();
      if (val === '>' || val === '|') { out[key] = ''; mode = 'bloc'; }
      else if (val === '') { out[key] = []; mode = 'liste'; }
      else if (val.startsWith('[')) {
        out[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
        mode = null;
      } else { out[key] = val.replace(/^"|"$/g, ''); mode = null; }
      continue;
    }
    const t = line.trim();
    if (mode === 'bloc') out[key] += (out[key] ? ' ' : '') + t;
    else if (mode === 'liste' && t.startsWith('- ')) {
      out[key].push(t.slice(2).trim().replace(/^"|"$/g, ''));
    }
  }
  return out;
}

function collect() {
  const docs = [];
  const problemes = [];
  for (const file of walk(DOCS).sort()) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    const fm = parseFrontMatter(text);
    if (!fm) { problemes.push(`${rel} — en-tête \`---\` absent ou illisible`); continue; }
    for (const champ of ['id', 'titre', 'theme', 'statut', 'resume']) {
      if (!fm[champ]) problemes.push(`${rel} — champ « ${champ} » manquant`);
    }
    if (fm.theme && !THEMES[fm.theme]) problemes.push(`${rel} — thème inconnu « ${fm.theme} »`);
    const resume = fm.resume.length > 125 ? fm.resume.slice(0, 122).replace(/\s+\S*$/, '') + '…' : fm.resume;
    docs.push({
      chemin: rel,
      theme: fm.theme,
      statut: fm.statut,
      langue: fm.langue || 'fr',
      ko: Math.round(Buffer.byteLength(text, 'utf8') / 1024),
      resume,
      cles: (fm.mots_cles || []).join(', '),
      questions: (fm.repond_a || []).slice(0, 3).join(' | '),
      _id: fm.id,
    });
  }
  const ids = docs.map((d) => d._id);
  for (const id of new Set(ids)) {
    if (ids.filter((x) => x === id).length > 1) problemes.push(`id « ${id} » utilisé par plusieurs documents`);
  }
  for (const cible of new Set(Object.values(ROUTAGE))) {
    if (cible.endsWith('/')) continue; // pointeur vers un dossier (ex. docs/journal/), pas un fichier
    if (!fs.existsSync(path.join(ROOT, cible))) problemes.push(`routage → ${cible} : fichier introuvable`);
  }
  return { docs, problemes };
}

function build(docs) {
  return {
    _lisez_moi: "Manifeste de la base documentaire hifago/. Généré par `npm run docs:index`. Ne pas éditer à la main : éditer l'en-tête `---` des documents, puis régénérer.",
    version: 1,
    maj: new Date().toISOString().slice(0, 10),
    protocole_ia: PROTOCOLE,
    routage: ROUTAGE,
    themes: THEMES,
    documents: docs.map(({ _id, ...reste }) => reste),
  };
}

/** Sérialisation compacte : un document par ligne, le reste lisible. */
function serialiser(manifeste) {
  const { documents, ...tete } = manifeste;
  const head = JSON.stringify(tete, null, 2).replace(/\n?}$/, '');
  const lignes = documents.map((d) => '    ' + JSON.stringify(d)).join(',\n');
  return `${head},\n  "documents": [\n${lignes}\n  ]\n}\n`;
}

const mode = process.argv.includes('--check') ? 'check' : 'build';
const { docs, problemes } = collect();

if (mode === 'check') {
  let ecart = null;
  if (!fs.existsSync(OUT)) ecart = 'docs/ai-index.json est absent';
  else {
    const actuel = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const a = JSON.stringify(actuel.documents);
    const b = JSON.stringify(build(docs).documents);
    if (a !== b) ecart = 'docs/ai-index.json ne correspond plus aux documents';
  }
  const tout = [...problemes, ...(ecart ? [ecart] : [])];
  if (tout.length) {
    console.error('Base documentaire hifago/ — problèmes détectés :\n');
    for (const p of tout) console.error(`  ✗ ${p}`);
    console.error('\nCorriger, puis lancer : npm run docs:index');
    process.exit(1);
  }
  console.log(`Base documentaire hifago/ OK — ${docs.length} documents indexés, manifeste à jour.`);
} else {
  if (problemes.length) {
    console.error('Problèmes détectés :\n');
    for (const p of problemes) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  fs.writeFileSync(OUT, serialiser(build(docs)), 'utf8');
  const ko = Math.round((fs.statSync(OUT).size / 1024) * 10) / 10;
  console.log(`docs/ai-index.json généré — ${docs.length} documents, ${ko} Ko.`);
}
