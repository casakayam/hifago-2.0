# Grille bêta-test Hifago 2.0 vs prototype mobile v2

Instantané de l'artefact interactif utilisé pour le check manuel de la préprod (Human check).

- **Artefact d'origine** : https://claude.ai/artifact/1bWeCkEGjYUhRKfrdKvY5U (privé, version de travail)
- **Référence** : `Prototype-Hifago-Mobile-v2-wireframe.html` (36 écrans) · **code analysé** : `main` @ 9711c01
- **Dernier check enregistré** : 2026-09-15 13:04 UTC
- **Avancement** : 69/100 lignes vérifiées — 34 validées · 25 invalidées · 10 à revoir

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | La grille interactive, avec les checks de cet instantané embarqués. S'ouvre directement dans un navigateur ; les modifications faites hors de claude.ai restent dans ce navigateur. |
| `review.json` | Les checks bruts : `s` = statut (`ok` validé, `ko` invalidé, `rev` à revoir, vide = non tranché), `c` = commentaire, `t` = horodatage (ms). |
| `README.md` | Ce résumé. |

Verdicts de l'analyse : **Structurant** manque de parcours · **Notable** écart notable · **Détail** cosmétique · **Équivalent** · **En plus** l'app fait plus · **À arbitrer** divergence de principe.

## 1. Squelette de navigation

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `nav-1` | Proto : App bar : « ← Volver » global + HIFAGO + bouton « Mi viaje (N) » | **Notable** Pas de « Volver » global (retour navigateur seulement). Sur une fiche, « ← Volver al catálogo » renvoie toujours à l'accueil, jamais au listing d'origine (FichaProducto.tsx:98) | ❌ Invalidé |  |
| `nav-2` | Proto : Nav basse 4 onglets Descubrir / Mi viaje / Reservas / Cuenta, toujours visible | **Structurant** Pas de nav basse | 🔁 À revoir | lorsque l'on descent dans de la page surtout sur mobile aucun moyen rapide de revenir. Doute sur la decision de remove la barre. Trouver unee solution alternative ou la remetre |
| `nav-3` | Proto : Pas de fil d'Ariane (logique app) | **En plus** Fil d'Ariane et sélecteur de type<br>**Notable** Le fil est en liens natifs → rechargement complet à chaque clic (dette connue, dette-technique.md) | — | si option pas coché c'est que j'ai pas compris |
| `nav-4` | Proto : Pas de footer | **Équivalent** Footer présent<br>**Détail** Liens légaux vides | ✅ Validé | le footer existe. on voit plus tard ce qu'on met dedans |

## 2. Accueil (« Descubrir »)

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `acc-1` | Proto : Kicker « Guatapé, a tu manera » + titre « Todo Guatapé en un solo lugar » + accroche | **Détail** Décision cahier §2a « rien au-dessus de la recherche » | — |  |
| `acc-2` | Proto : Bouton « Hazme soñar » → compose un voyage de 3 jours dans Mi viaje | **Structurant** « Hazme soñar » absent | ✅ Validé | on garde pour plus tard |
| `acc-3` | Proto : Cartes « Fechas » / « Viajeros » = contexte de voyage dépliable en place (Llegada/Salida, Adultos 13+/Niños 2-12, Salida desde) appliqué partout : totaux des fiches, nuits, titre de Mi viaje, dates du camp | **Structurant** Pas de contexte de voyage<br>**Notable** Filtres non propagés (écart code ↔ cahier) | 🔁 À revoir | ninos... on as dis plus tard mais texte intro si |
| `acc-4` | Proto : Variante B : un carrousel horizontal par catégorie avec lien « Ver todo » ; variante A : grille 3 colonnes de 6 catégories + « Explorar toda la oferta · Ver todo » | **Structurant** Pas de carrousels (jusqu'à 40 cartes empilées sur mobile)<br>**Notable** « Ver todo » absent sur les sections courtes | ✅ Validé |  |
| `acc-5` | Proto : 6 catégories dont Tours | **Notable** Tours absent | ✅ Validé |  |
| `acc-6` | Proto : Bloc « Próximamente en Guatapé » (événements + camps datés, calendrier) → « Qué hacer en tus fechas » quand des dates sont posées | **Notable** « Próximamente » absent | ❌ Invalidé |  |
| `acc-7` | Proto : Camps visibles seulement à partir de 3 camps ; Eventos seulement s'il y a un événement actif ; accroche adaptée | **Détail** Seuil d'affichage différent | 🔁 À revoir | ok pour afichage meme si 1 camp |
| `acc-8` | Proto : Carte : photo, titre, meta horaire/durée (« Sáb. 10:00 · 2 h », « 12–15 sept. · 4 días »), prix, badge (« Camp », « 6 cupos ») | **Notable** Cartes sans date, durée, horaire ni badge | ✅ Validé |  |
| `acc-9` | App : Après un ajout au panier, les sections des types déjà au panier passent en dernier | **En plus** Réordonnancement après ajout | ✅ Validé | cool |

## 3. Recherche

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `rech-1` | Proto : La frappe remplace le corps de page sans changer d'écran ; chips « Todo / Con fechas / Disponible hoy » ; liste mixte « Resultados para «…» · Sugeridos » ; « Borrar la búsqueda » ; grille « Por categoría » desso… | **Équivalent** Principe équivalent<br>**Notable** Pas de chips, pas de « Borrar la búsqueda » (vider le champ + revalider), pas de « Sugeridos »<br>**Détail** Sur mobile, aucun bouton de recherche visible (touche clavier seulement)<br>**En plus** Suggestions | ✅ Validé |  |

## 4. Catalogues par type

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `cat-1` | Proto : Onglets « Actividades / Alojamientos / Transporte / Más ▾ (Camps, Eventos, Tours) » | **Équivalent** Équivalent (Tours absent) | ❌ Invalidé | je veux les onglets sur mobile |
| `cat-2` | Proto : Un carrousel par sous-catégorie avec titre + aside : Alojamientos par tranche de prix (« Económico · Hasta $200.000 », « Precio medio », « Alta gama »), Actividades (« En el agua · Embalse », « Deportes extremos… | **Notable** Pas de tranches de prix pour les hébergements, pas de carrousels ; photo/texte de catégorie visibles seulement sur la page dédiée (backlog) | ❌ Invalidé |  |
| `cat-3` | Proto : Camps : chips « Próximos / Aventura / Bienestar », badge « 6 cupos », meta « 12–15 sept. · 4 días » ; état vide « Aún no hay camps abiertos a reserva… cuando al menos 3 estén listos » + CTA « Ver actividades dis… | **Structurant** Un camp n'affiche pas ses dates avant d'ouvrir la fiche<br>**Notable** Pas de CTA de repli | ❌ Invalidé |  |
| `cat-4` | Proto : Eventos : « Calendario » trié par date, chips « Todos / Este mes / Gratis », badges « Reserva externa » / « Reserva Hifago », meta « 12 oct. · 16:00–23:00 » | **Structurant** Événements sans date, badge ni tri chronologique | ❌ Invalidé | Trié par date |
| `cat-5` | Proto : Alojamientos : une carte par couchage | **Notable** Un clic de plus avant le calendrier (conforme au cahier §2b.4) | ❌ Invalidé | dates num de personnes preremplis si noté dans home |

## 5. Fiches produit (hors camp / événement)

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `fic-1` | Proto : Hero + badge horaire (« Sábado · 10:00 ») + sous-titre (« 2 horas · guía local · equipo incluido ») | **Détail** Pas de badge horaire/durée ; les horaires n'apparaissent qu'après choix d'une date (chips « 10:00–12:00 ») | ✅ Validé |  |
| `fic-2` | Proto : Bloc prix calculé sur les voyageurs : « 2 adultos · $90.000 total », « $45.000 /pers. », « 4 cupos » | **Notable** Pas de total avant le panier (hors hébergement) | ✅ Validé |  |
| `fic-3` | Proto : « Añadir a Mi viaje » + « Ver otras actividades » ; « No se cruza con tu itinerario actual » | **Notable** Pas de « Ver otros », pas de contrôle de conflit d'horaires | ✅ Validé |  |
| `fic-4` | Proto : Hébergement : « $420.000 · 3 noches / $140.000/noche », liste « Incluye » | **Équivalent** Prix et nuits<br>**Détail** Pas de bloc « Incluye » | ❌ Invalidé | ma version ne consulte pas lobby pour la disponibilité. peut etre due au ip fixe. |
| `fic-5` | Proto : Transport : « Ida y vuelta flexible », timeline Ida / Regreso avec lieux, horaires et dates | **Notable** Transport sans aller/retour, lieux ni horaires | 🔁 À revoir | ida y vuelta doivent etre selectionable separement |
| `fic-6` | App : Fiche vitrine : bouton « Reservar » externe à la place du calendrier ; politique d'annulation affichée sur chaque fiche | **En plus** Mode vitrine + politique d'annulation<br>**À arbitrer** Un événement sans URL = cul-de-sac connu | — |  |

## 6. Ajout au panier et feedback

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `ajo-1` | Proto : 1er ajout : écran pédagogique « Añadido · Ya aparece en tu calendario de Mi viaje… » + « Ver Mi viaje » / « Seguir explorando » | **Notable** Pas de pédagogie ; la fiche disparaît (retour accueil, pas au listing) | ✅ Validé | pour le moment |
| `ajo-2` | Proto : Ajouts suivants : retour au catalogue d'origine + toast avec action contextuelle (« Añadir una noche » si pas d'hébergement, « Ver Mi viaje », « Añadir actividades ») | **Notable** Toast sans action contextuelle | ✅ Validé |  |

## 7. Camps — le parcours le plus divergent

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `cmp-1` | Proto : Fiche camp : stepper « 1 Programa — 2 Alojamiento », hero « Camp · 12–15 sept. », « Total para 2 adultos · $960.000 / $480.000 /pers. », note « El alojamiento se elige en el paso 2, para las 3 noches obligatoria… | **Structurant** Fiche camp sans étapes, durée, hébergement ni programme | ❌ Invalidé |  |
| `cmp-2` | Proto : Choix de l'édition : liste « 12–15 septiembre · 3 noches obligatorias · $960.000 · 6 cupos » ; les dates du camp remplacent celles du voyage | **Notable** Pas de liste d'éditions | ❌ Invalidé | si plusieurs camps ouvert alors listes. si pas de camp dejas avec resa. Le camp s'ouvre grace a la 1ere resa dependant du calendrier du presta |
| `cmp-3` | Proto : Après « Elegir » : écran « Paso 2 de 2 — Ahora elige dónde dormir » → « Ver alojamientos compatibles » (liste filtrée sur les nuits du camp, stepper, fiche hébergement « Elegir para el camp · Cubre las 3 noches … | **Structurant** Exemple n°1 : étape hébergement absente de bout en bout | ❌ Invalidé |  |
| `cmp-4` | Proto : Mi viaje : ligne rouge « Alojamiento obligatorio del camp · Pendiente · Falta », note « El camp está incompleto », suggestion « Obligatorio » ; « Reservar » → écran Conflit bloquant (« No se realiza ninguna rese… | **Structurant** Exemple n°2 : aucun blocage, ni UI ni serveur | ❌ Invalidé |  |
| `cmp-5` | App : Le cahier client (§1, §3a, §3d) ne mentionne pas non plus d'hébergement obligatoire : la règle n'existe que dans le prototype | **À arbitrer** À écrire en spec avant tout code | ❌ Invalidé |  |

## 8. Événements

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `evt-1` | Proto : Fiche : avis « Tus fechas actuales no cubren la noche del evento », « Añadir a mi viaje » → écran « Adapter les dates » (voyage actuel vs proposition « Recomendado », « Prolongar hasta el 13 » / « Mantener mis f… | **Structurant** Événement jamais ajoutable au voyage | ❌ Invalidé | c'est une des resons qui fait que le panier s'appell mi viaje et non panier |
| `evt-2` | Proto : Interstitiel « Vas a salir de Hifago » + « Ya reservé · guardar evento » | **Notable** Pas d'interstitiel de sortie | 🔁 À revoir |  |
| `evt-3` | Proto : Événement réservable Hifago (« Cine bajo las estrellas », entrées × voyageurs, 12 cupos) | **Structurant** Réservation en ligne d'événement non câblée | ❌ Invalidé |  |
| `evt-4` | Proto : « Alrededor del evento » (dormir la nuit du 12, kayak avant, retour dimanche) | **Notable** « Alrededor del evento » absent | ❌ Invalidé |  |

## 9. « Mi viaje » vs « Tu carrito »

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `mv-1` | Proto : Titre = dates du voyage ou « Tu estancia se construye aquí » | **Détail** Titre générique | ❌ Invalidé |  |
| `mv-2` | Proto : Timeline chronologique ; chaque ligne : vignette, date lisible (« Sáb. 13 · 10:00 », « 12–15 sept. »), titre, meta (« 2 h · 2 adultos »), badge Obligatorio/Falta, lien « Más opciones » vers le catalogue de sa ca… | **Notable** Pas de tri par date, pas de photo, dates ISO brutes (dette connue), pas de « Más opciones »<br>**En plus** Indisponibilité signalée | ❌ Invalidé |  |
| `mv-3` | Proto : « Sugerencias para tu viaje » (max 3, contextuelles : nuit manquante, journées vides, transport, autour de l'événement) | **Notable** Pas de suggestions | ❌ Invalidé |  |
| `mv-4` | Proto : « Reservar » (vide → toast « Tu viaje está vacío · Explorar » ; camp incomplet → conflit) + « Añadir algo más » | **Détail** Panier vide sans CTA<br>**En plus** Reprise des commandes impayées | ❌ Invalidé | Reprise des commandes impayées . Pas testé mais je pense que c'est cool |
| `mv-5` | Proto : Total | **Notable** À vérifier en manuel<br>**À arbitrer** Bug connu sur le total multi-nuits | 🔁 À revoir |  |

## 10. Résumé, conditions, paiement

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `pay-1` | Proto : Écran « Resumen · Todo listo para reservar » : lignes, « Precio total », carte « Pagas hoy · 17% : X / Saldo con los prestadores : Y », 3 conditions clés + « Ver condiciones completas » | **Notable** L'acompte de 17 % et le solde ne sont pas annoncés avant de valider : le client les découvre sur /reserva/<jeton>, une fois la commande créée<br>**Détail** Conditions réduites à une phrase | ❌ Invalidé | La loi dis au final que le client a 5 jours de retractation |
| `pay-2` | Proto : Paiement par formulaire carte intégré ; échec → « Pago rechazado · No se realizó ningún cobro · Tu viaje… siguen guardados » + « Intentar de nuevo » | **Équivalent** Échec géré<br>**Notable** Le second temps n'est annoncé nulle part avant de cliquer « Validar pedido »<br>**À arbitrer** Régression connue : refus PMS après validation ⇒ panier déjà vidé, tout à ressaisir | ✅ Validé |  |
| `pay-3` | Proto : Connexion exigée avant paiement (bottom-sheet « Tu viaje está guardado · Conéctate para reservar », Google / lien par courriel) | **À arbitrer** Divergence de principe (cahier §1 : compte optionnel) | ✅ Validé |  |

## 11. Authentification et compte

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `aut-1` | Proto : Google + « Recibir un enlace por correo » (lien magique) | **Notable** Pas de mot de passe oublié<br>**Détail** Pas de lien magique | ❌ Invalidé | pas sur de l'utilité du lien magique. recuperation mot de passe oublié obligatoire |
| `aut-2` | Proto : Cuenta : « Hola, Jérôme », Mis reservas / Datos personales / Métodos de pago / Cerrar sesión | **Équivalent** Équivalent (« Métodos de pago » sans objet avec Mercado Pago)<br>**En plus** Suppression de compte | ✅ Validé |  |
| `aut-3` | App : Panier anonyme fusionné à la connexion (mot de passe et Google) | **En plus** Fusion du panier | ✅ Validé |  |

## 12. Confirmation et après-vente

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `apv-1` | Proto : « Reserva HFG-2841 · Tu viaje está confirmado · Pagaste $X » → « Ver el viaje día por día » / « Ver la reserva » | **Équivalent** Confirmation équivalente<br>**Notable** Pas d'itinéraire jour par jour | 🔁 À revoir | Itineraire avec contact whats app des diferents prestataire de la resa |
| `apv-2` | Proto : Reservas : cartes « Guatapé · 11–16 septiembre · Reserva HFG-2841 · 5 prestaciones · Confirmada » | **Détail** Pas de synthèse dates / nb de prestations | ✅ Validé |  |
| `apv-3` | Proto : Détail : « Pagado a Hifago / Saldo total pendiente » + Ver itinerario / Modificar líneas / Cancelar toda la reserva | **Notable** Pas d'annulation depuis le détail, pas de modification | 🔁 À revoir |  |
| `apv-4` | Proto : Itinéraire réservé (timeline avec solde par ligne, « Modificar mi viaje ») | **Notable** Itinéraire réservé absent | ❌ Invalidé | le client ne reserve pas un panier mais un voyage sur mesure |
| `apv-5` | Proto : Annulation de toute la commande, saisie « CANCELAR », écran « Reserva cancelada » | **À arbitrer** Tranché le 2026-09-11 (spec 34) — granularité différente, à confirmer | 🔁 À revoir | loi des 5 jours de retractation |
| `apv-6` | Proto : Voucher / QR | **Équivalent** Ouvert des deux côtés | 🔁 À revoir |  |

## 13. Textes, formats, détails

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `txt-1` | Dates : « Sáb. 13 · 10:00 » / « 12–15 sept. » (proto) vs 2026-11-01 → 2026-11-03 (panier, résultat, compte — formatLineSchedule.ts) | **Notable** Dates ISO brutes | ✅ Validé |  |
| `txt-2` | Prix « $90.000 » vs « 90.000 COP » | **Détail** Format de prix | ✅ Validé |  |
| `txt-3` | Vocabulaire : Mi viaje / Reservar / Añadir a Mi viaje / Descubrir vs Tu carrito / Ir a pagar / Añadir al carrito / Inicio | **Détail** Vocabulaire | ❌ Invalidé |  |
| `txt-4` | Chaque écran du proto a kicker + accroche ; l'app a des titres nus (« Camps », « Tu carrito », « Finalizar compra ») | **Détail** Titres nus | ❌ Invalidé |  |
| `txt-5` | Compteur de places : proto et app l'affichent (« 4 cupos » / « N cupos disponibles »), mais le cahier §2b.5 l'a retiré — incohérence doc ↔ code, pas proto ↔ code | **À arbitrer** Incohérence doc ↔ code | ✅ Validé | ne pas tenir compte |

## 14. Ce que l'app fait en plus (à ne pas perdre)

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `plus-1` | Suggestions de recherche | **En plus** À conserver | ✅ Validé |  |
| `plus-2` | Recherche sur tous les listings | **En plus** À conserver | ✅ Validé |  |
| `plus-3` | Pages catégorie indexables | **En plus** À conserver | ✅ Validé |  |
| `plus-4` | ES/EN | **En plus** À conserver | ✅ Validé |  |
| `plus-5` | Fiche établissement avec chambres | **En plus** À conserver | ✅ Validé |  |
| `plus-6` | Disponibilité PMS en direct et nuits barrées selon la quantité | **En plus** À conserver | ✅ Validé |  |
| `plus-7` | Remise de groupe camp | **En plus** À conserver | ✅ Validé |  |
| `plus-8` | Consentement marketing | **En plus** À conserver | ✅ Validé |  |
| `plus-9` | Reprise des commandes impayées | **En plus** À conserver | ✅ Validé |  |
| `plus-10` | Indisponibilité signalée dans le panier | **En plus** À conserver | ✅ Validé |  |
| `plus-11` | Fusion du panier à la connexion | **En plus** À conserver | ✅ Validé |  |
| `plus-12` | Suppression de compte | **En plus** À conserver | ✅ Validé |  |
| `plus-13` | Annulation par ligne | **En plus** À conserver | ✅ Validé |  |
| `plus-14` | WhatsApp établissement pré-rempli avec le n° de réservation | **En plus** À conserver | ✅ Validé |  |

## S. Synthèse — les 10 écarts à trancher en priorité

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `syn-1` | Parcours camp : étape 2 hébergement, liste filtrée « compatible », blocage du checkout — absent en UI, en serveur et dans le cahier | **Structurant** Priorité | — |  |
| `syn-2` | Contexte de voyage (dates + adultes/enfants) partagé entre recherche, fiches, panier — inexistant ; les filtres ne se propagent même pas aux calendriers | **Structurant** Priorité | — |  |
| `syn-3` | Accueil : carrousels par catégorie + « Ver todo » systématique ; « Próximamente en Guatapé » ; « Hazme soñar » | **Structurant** Priorité | — |  |
| `syn-4` | Événements : ajout au voyage, adaptation des dates, réservation en ligne, interstitiel de sortie | **Structurant** Priorité | — |  |
| `syn-5` | Cartes sans date / durée / horaire (camps, événements, activités) | **Notable** Priorité | — |  |
| `syn-6` | Mi viaje : timeline chronologique, suggestions contextuelles, « Más opciones » par ligne | **Notable** Priorité | — |  |
| `syn-7` | Acompte 17 % et solde annoncés avant « Validar pedido » ; expliquer les deux temps et les 30 minutes | **Notable** Priorité | — |  |
| `syn-8` | Nav basse Descubrir / Mi viaje / Reservas / Cuenta + « Volver » contextuel | **Structurant** Priorité | — |  |
| `syn-9` | Après-vente : itinéraire jour par jour, annulation depuis le détail, modification | **Notable** Priorité | — |  |
| `syn-10` | Formats et types : dates lisibles, total sur fiche pour la quantité choisie, transport aller/retour, catégorie Tours | **Notable** Priorité | — |  |

## B. Bugs et dettes connus à croiser pendant le check

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `bug-1` | Total du panier faux pour un hébergement de plusieurs nuits | **À arbitrer** Bug connu | — |  |
| `bug-2` | Refus LobbyPMS après « Validar pedido » ⇒ panier vidé | **À arbitrer** Bug connu | — |  |
| `bug-3` | Fil d'Ariane = rechargement complet de page | **À arbitrer** Dette connue | — |  |
| `bug-4` | Événement sans URL externe = fiche sans aucune action | **À arbitrer** Dette connue | — |  |
| `bug-5` | alojamiento-pms-backed-demo vendable en préprod mais invendable ; caminata-mirador-penon sans date ouverte — utiliser kayak-embalse-guatape | **À arbitrer** Données préprod | — |  |

## C. Checklist du check manuel (préprod)

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `chk-1` | Accueil : https://hifago-web-env-staging-hifago.vercel.app/es — carrousels ? « Ver más » sur Alojamientos/Camps ? nav basse ? à 390 px | **Notable** À observer | — |  |
| `chk-2` | Camp : /es/productos/campamento-de-musica — durée écrite ? mention hébergement ? total pour N personnes ? puis /es/carrito → « Ir a pagar » sans nuit | **Notable** À observer | — |  |
| `chk-3` | Événement : /es/productos/media-maraton-de-guatape-3-version — « Reservar » sort direct ? ajout au panier possible ? | **Notable** À observer | — |  |
| `chk-4` | Listings : /es/camps, /es/eventos — dates sur les cartes ? tri ? | **Notable** À observer | — |  |
| `chk-5` | Hébergement : /es/establecimientos/casa-kayam → /es/productos/audo — dates de la recherche pré-remplies ? total 2 nuits sur /es/carrito ? | **Notable** À observer | — |  |
| `chk-6` | Tunnel : /es/pago — acompte visible avant « Validar pedido » ? puis /es/reserva/<jeton> → « Pagar el anticipo » → simulateur → rejet | **Notable** À observer | — |  |
| `chk-7` | Compte : /es/cuenta/reservas — « Anular » par ligne ; /es/reserva/<jeton> — pas d'annulation ; /es/entrar — pas de mot de passe oublié | **Notable** À observer | — |  |

## N. Non vérifié par l'analyse (à observer toi-même)

| Ligne | Point | Verdict de l'analyse | Human check | Commentaire |
| --- | --- | --- | --- | --- |
| `nv-1` | Rendu réel à 390×844 | **À arbitrer** Non observé | — |  |
| `nv-2` | Popovers Fechas / Personas | **À arbitrer** Non observé | — |  |
| `nv-3` | Toasts et calendriers (PMS compris) | **À arbitrer** Non observé | — |  |
| `nv-4` | Paiement réel Mercado Pago | **À arbitrer** Non observé | — |  |
| `nv-5` | Comportement du menu compact de types | **À arbitrer** Non observé | — |  |
| `nv-6` | Fusion du panier à la connexion Google | **À arbitrer** Non observé | — |  |
