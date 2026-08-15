import { Card } from "@hifago/ui";

export type RecentListItem = {
  id: string;
  label: string;
  sublabel?: string | null;
  href: string;
};

export type RecentListProps = {
  title: string;
  href: string;
  items: RecentListItem[];
  emptyHint?: string;
};

// Aperçu « top-N + voir tout » (spec §5.2) — jamais une table complète sur la home, un raccourci
// vers la liste paginée correspondante.
export function RecentList({ title, href, items, emptyHint }: RecentListProps) {
  return (
    <Card data-testid={`recent-list-${title}`}>
      <Card.Header className="flex flex-row items-center justify-between">
        <Card.Title>{title}</Card.Title>
        <a href={href} className="text-xs text-muted hover:underline">
          Ver todo →
        </a>
      </Card.Header>
      <Card.Content className="flex flex-col gap-1">
        {items.length === 0 ? (
          <p className="text-sm text-muted">{emptyHint ?? "Nada todavía."}</p>
        ) : (
          items.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className="flex flex-col rounded-md px-2 py-1.5 text-sm hover:bg-surface-secondary"
            >
              <span>{item.label}</span>
              {item.sublabel ? <span className="text-xs text-muted">{item.sublabel}</span> : null}
            </a>
          ))
        )}
      </Card.Content>
    </Card>
  );
}
