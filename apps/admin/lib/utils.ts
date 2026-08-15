// products.slug (et toute future colonne slug) est not null unique, jamais saisi manuellement par
// l'admin — dérivé du nom au moment de la création.
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
