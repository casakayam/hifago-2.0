"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, Input, Label, ListBox, Select, TextField } from "@hifago/ui";

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  descriptionSnippet: string | null;
  type: string;
  imageUrl: string | null;
};

// Types réels de products.type (supabase/migrations/20260817160000_calendar_tranche0_fixes.sql,
// dernière redéfinition du CHECK — 'tour' retiré) : ne pas resynchroniser depuis une migration
// plus ancienne.
const PRODUCT_TYPES = ["lodging", "activity", "transport", "camp", "evento", "hotel"] as const;

export function CatalogBrowser({ products }: { products: CatalogProduct[] }) {
  const t = useTranslations("HomePage");
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      if (selectedType && product.type !== selectedType) return false;
      if (query && !product.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [products, search, selectedType]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <TextField
          className="min-w-48 flex-1"
          name="q"
          value={search}
          onChange={setSearch}
          data-testid="catalog-search"
        >
          <Label>{t("searchLabel")}</Label>
          <Input type="search" placeholder={t("searchPlaceholder")} />
        </TextField>

        <div className="flex flex-col gap-1.5">
          <Select
            selectedKey={selectedType || null}
            onSelectionChange={(key) => setSelectedType(key ? String(key) : "")}
          >
            <Label>{t("typeFilterLabel")}</Label>
            <Select.Trigger data-testid="catalog-type-filter">
              <Select.Value>
                {selectedType ? t(`types.${selectedType}`) : t("typeFilterAllLabel")}
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="" textValue={t("typeFilterAllLabel")}>
                  {t("typeFilterAllLabel")}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {PRODUCT_TYPES.map((type) => (
                  <ListBox.Item key={type} id={type} textValue={t(`types.${type}`)}>
                    {t(`types.${type}`)}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted" data-testid="catalog-no-results">
          {t("noResults")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((product) => (
            <Link
              key={product.slug}
              href={`/products/${product.slug}`}
              data-testid={`catalog-link-${product.slug}`}
            >
              <Card className="h-full overflow-hidden">
                {product.imageUrl ? (
                  <div className="relative aspect-[4/3] w-full">
                    <Image
                      src={product.imageUrl}
                      alt={product.name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, 50vw"
                    />
                  </div>
                ) : null}
                <Card.Header>
                  <Card.Title>{product.name}</Card.Title>
                  {product.descriptionSnippet ? (
                    <Card.Description>{product.descriptionSnippet}</Card.Description>
                  ) : null}
                </Card.Header>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
