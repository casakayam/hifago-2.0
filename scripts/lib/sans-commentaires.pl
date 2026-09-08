# Retire les COMMENTAIRES d'un fichier TS/TSX en conservant les numéros de ligne.
#
# Pourquoi ce fichier existe : trois des contrôles de ce dossier cherchent des motifs (`next/link`,
# `<a href="/`, une couleur en dur) que les commentaires du dépôt CITENT abondamment — précisément
# pour expliquer pourquoi il ne faut pas les écrire. Une recherche naïve remonte donc les fichiers
# les plus soigneux, et un contrôle qui crie à tort est un contrôle qu'on désactive (spec 27 §8).
#
# Conserver les numéros de ligne est la contrainte qui décide de la forme : on ne SUPPRIME pas le
# commentaire, on le remplace par du vide en gardant ses retours à la ligne. Un `grep -n` sur la
# sortie pointe donc la vraie ligne du fichier.
#
# Couvre `/* … */` (donc aussi les commentaires JSX `{/* … */}`, dont les lignes de CONTINUATION
# n'ont aucun préfixe et échappaient à tous les filtres écrits jusqu'ici) et `// …`.
#
# ⚠️ Le `(?<!:)` devant `//` protège les URL (`https://…`), qui resteraient sinon tronquées au
# premier `//`. Aucun autre cas de `//` non-commentaire n'existe dans ce dépôt.
#
#   perl -0777 -p scripts/lib/sans-commentaires.pl <fichier>
BEGIN { $/ = undef }
s{/\*.*?\*/}{ (my $t = $&) =~ s![^\n]!!g; $t }gse;
s{(?<!:)//[^\n]*}{}g;
