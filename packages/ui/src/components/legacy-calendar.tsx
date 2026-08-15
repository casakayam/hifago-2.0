"use client";

import * as React from "react";
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from "react-day-picker";
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "../lib/utils";

/**
 * Sélecteur de dates client (react-day-picker) — indépendant de HeroUI, gardé le temps de
 * trancher si le `DatePicker` natif HeroUI v3 (encore "in progress" à ce jour) le remplace un
 * jour (cf. hifago/CLAUDE.md, point ouvert). Autonome : ne dépend d'aucun composant Button, juste
 * de deux classes de bouton "ghost" locales.
 */

const navButtonClassName =
  "inline-flex items-center justify-center rounded-lg transition-colors select-none hover:bg-surface-secondary hover:text-foreground focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/50 disabled:pointer-events-none disabled:opacity-50 outline-none";

// getDefaultClassNames() est une fonction pure sans argument (itère des enums internes à chaque
// appel) — un seul calcul module-level, partagé par DayPickerCalendar et
// DayPickerCalendarDayButton, plutôt qu'un recalcul à chaque rendu de chaque cellule de jour.
const DEFAULT_CLASS_NAMES = getDefaultClassNames();

// La quasi-totalité des classNames de react-day-picker ne dépend d'aucune prop (seuls
// caption_label et day varient, cf. plus bas) — calculées une fois au chargement du module plutôt
// que reconstruites (≈25 appels `cn()`/`twMerge`) à chaque rendu du calendrier.
const BASE_CLASS_NAMES = {
  root: cn("w-fit", DEFAULT_CLASS_NAMES.root),
  months: cn("relative flex flex-col gap-4 md:flex-row", DEFAULT_CLASS_NAMES.months),
  month: cn("flex w-full flex-col gap-4", DEFAULT_CLASS_NAMES.month),
  nav: cn(
    "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
    DEFAULT_CLASS_NAMES.nav
  ),
  button_previous: cn(
    navButtonClassName,
    "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
    DEFAULT_CLASS_NAMES.button_previous
  ),
  button_next: cn(
    navButtonClassName,
    "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
    DEFAULT_CLASS_NAMES.button_next
  ),
  month_caption: cn(
    "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
    DEFAULT_CLASS_NAMES.month_caption
  ),
  dropdowns: cn(
    "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
    DEFAULT_CLASS_NAMES.dropdowns
  ),
  dropdown_root: cn("relative rounded-(--cell-radius)", DEFAULT_CLASS_NAMES.dropdown_root),
  dropdown: cn("absolute inset-0 bg-overlay opacity-0", DEFAULT_CLASS_NAMES.dropdown),
  month_grid: cn("w-full border-collapse", DEFAULT_CLASS_NAMES.month_grid),
  weekdays: cn("flex", DEFAULT_CLASS_NAMES.weekdays),
  weekday: cn(
    "flex-1 rounded-(--cell-radius) text-[0.8rem] font-normal text-muted select-none",
    DEFAULT_CLASS_NAMES.weekday
  ),
  week: cn("mt-2 flex w-full", DEFAULT_CLASS_NAMES.week),
  week_number_header: cn("w-(--cell-size) select-none", DEFAULT_CLASS_NAMES.week_number_header),
  week_number: cn("text-[0.8rem] text-muted select-none", DEFAULT_CLASS_NAMES.week_number),
  range_start: cn(
    "relative isolate z-0 rounded-l-(--cell-radius) bg-surface-secondary after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-surface-secondary",
    DEFAULT_CLASS_NAMES.range_start
  ),
  range_middle: cn("rounded-none", DEFAULT_CLASS_NAMES.range_middle),
  range_end: cn(
    "relative isolate z-0 rounded-r-(--cell-radius) bg-surface-secondary after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-surface-secondary",
    DEFAULT_CLASS_NAMES.range_end
  ),
  today: cn(
    "rounded-(--cell-radius) bg-surface-secondary text-foreground data-[selected=true]:rounded-none",
    DEFAULT_CLASS_NAMES.today
  ),
  outside: cn("text-muted aria-selected:text-muted", DEFAULT_CLASS_NAMES.outside),
  disabled: cn("text-muted opacity-50", DEFAULT_CLASS_NAMES.disabled),
  hidden: cn("invisible", DEFAULT_CLASS_NAMES.hidden),
};

// Root/Chevron/WeekNumber ne referment sur aucun état ni prop du composant parent — hoistés au
// module plutôt que redéfinis (donc remontés en tant que nouveau type de composant) à chaque
// rendu, ce qui forçait react-day-picker à démonter/remonter toute la grille de jours à chaque
// frappe dans un champ voisin (ex. le sélecteur de quantité de ReservationForm).
function CalendarRoot({
  className,
  rootRef,
  ...props
}: React.ComponentProps<"div"> & { rootRef?: React.Ref<HTMLDivElement> }) {
  return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
}

function CalendarChevron({
  className,
  orientation,
  ...props
}: {
  className?: string;
  style?: React.CSSProperties;
  size?: number;
  disabled?: boolean;
  orientation?: "up" | "down" | "left" | "right";
}) {
  if (orientation === "left") {
    return <ChevronLeftIcon className={cn("size-4", className)} {...props} />;
  }
  if (orientation === "right") {
    return <ChevronRightIcon className={cn("size-4", className)} {...props} />;
  }
  return <ChevronDownIcon className={cn("size-4", className)} {...props} />;
}

function CalendarWeekNumber({ children, ...props }: React.ComponentProps<"td">) {
  return (
    <td {...props}>
      <div className="flex size-(--cell-size) items-center justify-center text-center">
        {children}
      </div>
    </td>
  );
}

function DayPickerCalendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const mergedClassNames = React.useMemo(
    () => ({
      ...BASE_CLASS_NAMES,
      caption_label: cn(
        "font-medium select-none",
        captionLayout === "label"
          ? "text-sm"
          : "flex items-center gap-1 rounded-(--cell-radius) text-sm [&>svg]:size-3.5 [&>svg]:text-muted",
        DEFAULT_CLASS_NAMES.caption_label
      ),
      day: cn(
        "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
        props.showWeekNumber
          ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)"
          : "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
        DEFAULT_CLASS_NAMES.day
      ),
      ...classNames,
    }),
    [captionLayout, props.showWeekNumber, classNames]
  );

  const mergedComponents = React.useMemo(
    () => ({
      Root: CalendarRoot,
      Chevron: CalendarChevron,
      DayButton: ({ ...dayButtonProps }: React.ComponentProps<typeof DayButton>) => (
        <DayPickerCalendarDayButton locale={locale} {...dayButtonProps} />
      ),
      WeekNumber: CalendarWeekNumber,
      ...components,
    }),
    [locale, components]
  );

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar bg-background p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)]",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={mergedClassNames}
      components={mergedComponents}
      {...props}
    />
  );
}

// Classes statiques du bouton de jour (indépendantes de day/modifiers/className) — hoistées hors
// du corps de la fonction, appelée une fois par cellule (jusqu'à ~42×) à chaque rendu du mois.
const dayButtonBaseClassName = cn(
  navButtonClassName,
  "relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-focus group-data-[focused=true]/day:ring-3 group-data-[focused=true]/day:ring-focus/50 data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-accent data-[range-end=true]:text-accent-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-surface-secondary data-[range-middle=true]:text-foreground data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-accent data-[range-start=true]:text-accent-foreground data-[selected-single=true]:bg-accent data-[selected-single=true]:text-accent-foreground [&>span]:text-xs [&>span]:opacity-70",
  DEFAULT_CLASS_NAMES.day
);

function DayPickerCalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <button
      type="button"
      ref={ref}
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(dayButtonBaseClassName, className)}
      {...props}
    />
  );
}

export { DayPickerCalendar, DayPickerCalendarDayButton };
