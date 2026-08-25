/* Bac à sable UX hifago — données des écrans.
 *
 * C'EST CE FICHIER QUE TU ÉDITES pour ajouter/changer un écran — jamais app.js/wireframe.css.
 * Schéma complet + exemples : voir README.md à côté de ce fichier.
 *
 * Résumé rapide :
 *   window.SCREENS = { idÉcran: { name, route?, blocks: [ ...blocs ] } }
 *   Un bloc = { type, label?, variant?, onClick?, justify?, align?, gap?, wrap?, grow?,
 *               columns?, repeat?, item?, children? }
 *   Types disponibles : voir l'écran "catalog" ci-dessous (c'est lui-même la référence visuelle).
 *   onClick: "idÉcran" rend le bloc cliquable et navigue vers cet écran (comme un hotspot Figma).
 */

window.START_SCREEN = "catalog";

window.SCREENS = {

  /* ---------------------------------------------------------------------
   * Planche de référence — un exemple de chaque type de bloc disponible.
   * Sert de légende visuelle : nomme un bloc par ce que tu vois ici.
   * ------------------------------------------------------------------- */
  catalog: {
    name: "Catalogue de blocs",
    blocks: [
      { type: "text", variant: "title", label: "Catalogue de blocs — référence" },
      { type: "text", variant: "muted",
        label: "Chaque bloc ci-dessous existe dans screens.js. Décris un écran en nommant ces blocs (ex. \"une card avec une image et un prix\")." },
      { type: "divider" },

      { type: "text", variant: "subtitle", label: "Structure" },
      { type: "grid", columns: 3, children: [
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "row / col" },
          { type: "row", gap: "sm", children: [
            { type: "badge", label: "a" }, { type: "badge", label: "b" }, { type: "badge", label: "c" } ] } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "header" },
          { type: "header", children: [ { type: "text", variant: "subtitle", label: "Logo" }, { type: "badge", label: "profil" } ] } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "footer" },
          { type: "footer", children: [ { type: "text", variant: "muted", label: "© hifago" }, { type: "text", variant: "muted", label: "Contacto" } ] } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "nav" },
          { type: "nav", children: [ { type: "text", label: "Alojamiento" }, { type: "text", label: "Actividades" } ] } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "grid (columns: 2)" },
          { type: "grid", columns: 2, children: [ { type: "badge", label: "1" }, { type: "badge", label: "2" }, { type: "badge", label: "3" }, { type: "badge", label: "4" } ] } ] }
      ]},

      { type: "divider" },
      { type: "text", variant: "subtitle", label: "Contenu" },
      { type: "grid", columns: 4, children: [
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "text (title/subtitle/body/muted/price)" },
          { type: "col", gap: "sm", children: [
            { type: "text", variant: "title", label: "Titre" },
            { type: "text", variant: "subtitle", label: "Sous-titre" },
            { type: "text", variant: "body", label: "Corps de texte" },
            { type: "text", variant: "muted", label: "Texte atténué" },
            { type: "text", variant: "price", label: "$68.000" }
          ] } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "image" }, { type: "image", label: "photo" } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "avatar" }, { type: "avatar", label: "JR" } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "badge" }, { type: "badge", label: "Verificado" } ] }
      ]},

      { type: "divider" },
      { type: "text", variant: "subtitle", label: "Interaction" },
      { type: "grid", columns: 4, children: [
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "button (primary/secondary/ghost)" },
          { type: "row", gap: "sm", wrap: true, children: [
            { type: "button", variant: "primary", label: "Primaire" },
            { type: "button", variant: "secondary", label: "Secondaire" },
            { type: "button", variant: "ghost", label: "Lien" }
          ] } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "searchbar" }, { type: "searchbar", label: "Rechercher…" } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "select" }, { type: "select", label: "Tipo" } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "checkbox" }, { type: "checkbox", label: "J'accepte" } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "form-field" }, { type: "form-field", label: "Nombre completo" } ] }
      ]},

      { type: "divider" },
      { type: "text", variant: "subtitle", label: "Blocs composés" },
      { type: "grid", columns: 3, children: [
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "card" },
          { type: "card", children: [ { type: "image", label: "photo" }, { type: "text", variant: "subtitle", label: "Nom du produit" }, { type: "text", variant: "price", label: "$45.000" } ] } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "list-item" },
          { type: "list-item", children: [ { type: "avatar", label: "HC" }, { type: "col", gap: "sm", grow: true, children: [ { type: "text", label: "Élément de liste" }, { type: "text", variant: "muted", label: "Sous-texte" } ] } ] } ] },
        { type: "col", gap: "sm", children: [ { type: "text", variant: "label", label: "bloc cliquable (→ vers un écran)" },
          { type: "card", onClick: "home", children: [ { type: "text", label: "Clique-moi" }, { type: "text", variant: "muted", label: "→ va à l'écran \"Accueil\"" } ] } ] }
      ]},

      { type: "divider" },
      { type: "row", gap: "sm", children: [
        { type: "text", variant: "muted", label: "Voir le parcours réel :" },
        { type: "badge", onClick: "home", label: "→ Accueil" }
      ]}
    ]
  },

  /* ---------------------------------------------------------------------
   * Parcours réel, reconstitué depuis le code (CatalogBrowser.tsx,
   * ProductDetailView.tsx, CheckoutForm.tsx) — pas la version aspirationnelle
   * de l'Artifact de design, celui-ci reste ancré dans l'app telle qu'elle
   * existe aujourd'hui.
   * ------------------------------------------------------------------- */

  home: {
    name: "Accueil / recherche",
    route: "/",
    blocks: [
      { type: "header", children: [
        { type: "text", variant: "subtitle", label: "hifago" },
        { type: "searchbar", grow: true, label: "Buscar…" },
        { type: "avatar", label: "JR" }
      ]},
      { type: "row", gap: "sm", children: [
        { type: "select", label: "Tipo" }
      ]},
      { type: "grid", columns: 2, repeat: 4, item: {
        type: "card", onClick: "productDetail", children: [
          { type: "image", label: "foto del producto" },
          { type: "text", variant: "subtitle", label: "Hostal Casa Kayam" },
          { type: "text", variant: "muted", label: "Guatapé · Dormitorio compartido" },
          { type: "text", variant: "price", label: "$68.000 / noche" }
        ]
      }}
    ]
  },

  productDetail: {
    name: "Ficha de producto",
    route: "/products/[slug]",
    blocks: [
      { type: "button", variant: "ghost", label: "← Volver al catálogo", onClick: "home" },
      { type: "text", variant: "title", label: "Hostal Casa Kayam" },
      { type: "text", variant: "body", label: "Descripción del establecimiento y de la habitación…" },
      { type: "grid", columns: 3, children: [
        { type: "image", label: "foto 1" }, { type: "image", label: "foto 2" }, { type: "image", label: "foto 3" }
      ]},
      { type: "text", variant: "price", label: "$68.000 / noche" },
      { type: "card", children: [
        { type: "text", variant: "label", label: "Bloque de reserva (varía según el tipo de producto)" },
        { type: "text", variant: "muted", label: "Fechas, cantidad de personas…" },
        { type: "button", variant: "primary", label: "Reservar", onClick: "checkout" }
      ]},
      { type: "divider" },
      { type: "text", variant: "muted", label: "Una cancelación o una ausencia nunca es reembolsada." },
      { type: "divider" },
      { type: "text", variant: "subtitle", label: "Sobre el establecimiento" },
      { type: "list-item", children: [
        { type: "avatar", label: "CK" },
        { type: "col", gap: "sm", grow: true, children: [
          { type: "text", label: "Casa Kayam" },
          { type: "text", variant: "muted", label: "Guatapé, Antioquia" }
        ]}
      ]}
    ]
  },

  checkout: {
    name: "Checkout",
    route: "/checkout",
    blocks: [
      { type: "text", variant: "title", label: "Finalizar compra" },
      { type: "list-item", children: [
        { type: "col", gap: "sm", grow: true, children: [
          { type: "text", label: "Hostal Casa Kayam — 2 noches" },
          { type: "text", variant: "muted", label: "Guatapé" }
        ]},
        { type: "text", variant: "price", label: "$136.000" },
        { type: "button", variant: "ghost", label: "Quitar" }
      ]},
      { type: "list-item", children: [
        { type: "col", gap: "sm", grow: true, children: [
          { type: "text", label: "Tour Piedra del Peñol ×2" },
          { type: "text", variant: "muted", label: "Actividad" }
        ]},
        { type: "text", variant: "price", label: "$90.000" },
        { type: "button", variant: "ghost", label: "Quitar" }
      ]},
      { type: "row", justify: "space-between", children: [
        { type: "text", variant: "subtitle", label: "Total" },
        { type: "text", variant: "price", label: "$226.000" }
      ]},
      { type: "divider" },
      { type: "form-field", label: "Nombre completo" },
      { type: "form-field", label: "WhatsApp" },
      { type: "form-field", label: "Correo electrónico" },
      { type: "checkbox", label: "Acepto recibir novedades por correo" },
      { type: "divider" },
      { type: "text", variant: "muted", label: "Una cancelación o una ausencia nunca es reembolsada." },
      { type: "button", variant: "primary", label: "Validar pedido", onClick: "confirmation" }
    ]
  },

  confirmation: {
    name: "Confirmación",
    route: "/checkout (état final)",
    blocks: [
      { type: "badge", label: "✓ Confirmado" },
      { type: "text", variant: "title", label: "¡Pedido confirmado!" },
      { type: "text", variant: "muted", label: "Número de reserva: #A1B2C3 — te contactamos por WhatsApp." },
      { type: "divider" },
      { type: "button", variant: "secondary", label: "Volver al inicio", onClick: "home" },
      { type: "button", variant: "ghost", label: "Ver mis reservas" }
    ]
  }

};
