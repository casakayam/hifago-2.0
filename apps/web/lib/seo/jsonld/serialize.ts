/**
 * Sérialise un nœud JSON-LD pour insertion dans une balise `<script>`.
 *
 * ⚠️ L'échappement de `<` est LOAD-BEARING, pas décoratif. Noms et descriptions sont saisis par
 * des PARTENAIRES : c'est du contenu non maîtrisé qui finit dans un `<script>`. Une description
 * contenant `</script>` fermerait la balise et casserait la page — et pire, ouvrirait une
 * injection.
 *
 * ⚠️ La doc officielle Next montre cette ligne sous deux formes, dont une INERTE : remplacer `<`
 * par le caractère `<` lui-même ne fait rien du tout. La forme correcte le remplace par la
 * SÉQUENCE D'ÉCHAPPEMENT JSON (barre oblique inversée, `u`, `003c`) — légale dans une chaîne
 * JSON, donc le document reparse toujours, et elle neutralise aussi `<!--`.
 *
 * Ce piège s'est refermé trois fois pendant l'écriture de ce lot, dont deux fois dans les textes
 * censés l'expliquer : les deux formes sont visuellement identiques une fois rendues. C'est
 * pourquoi scripts/check-seo.sh cherche la séquence littérale dans le code, et pourquoi le test
 * unitaire fait passer une description contenant `</script>` plutôt que de relire la ligne.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
