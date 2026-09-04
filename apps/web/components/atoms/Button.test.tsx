import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Button } from "./Button";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
// (Il est bien présent dans node_modules, mais comme dépendance TRANSITIVE : apps/web ne déclare
// que @testing-library/dom et react. L'importer serait une dépendance fantôme, comme lucide-react.)
//
// Ce fichier teste ce que la surcouche AJOUTE à HeroUI : les deux axes séparés, l'état « en cours »
// qui remplace le couple isDisabled/libellé ternaire, et le nom accessible des icônes. Le
// comportement du bouton react-aria lui-même n'est pas retesté ici.
function bouton(element: React.ReactElement) {
  const { container } = render(element);
  return container.querySelector("button") as HTMLButtonElement;
}

describe("Button", () => {
  it("rend un <button> avec son libellé et son testId", () => {
    const el = bouton(<Button testId="reserver">Reservar</Button>);
    expect(el.tagName).toBe("BUTTON");
    expect(el.textContent).toBe("Reservar");
    expect(el.getAttribute("data-testid")).toBe("reserver");
  });

  it("déclenche onPress au clic", () => {
    const onPress = vi.fn();
    const el = bouton(<Button onPress={onPress}>Reservar</Button>);
    fireEvent.click(el);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // ⚠️ Le cœur de la surcouche : forme et couleur sont deux axes indépendants, ce que le `variant`
  // à 7 valeurs de HeroUI ne permet pas. On vérifie que les deux jeux de classes sont bien posés
  // ET qu'ils varient indépendamment — pas la couleur rendue, qui se mesure dans le navigateur.
  it("pose deux axes indépendants : la couleur ne dépend pas de la forme", () => {
    const solideAccent = bouton(<Button variant="solid" color="accent">A</Button>).className;
    const solideDanger = bouton(<Button variant="solid" color="danger">A</Button>).className;
    const ghostAccent = bouton(<Button variant="ghost" color="accent">A</Button>).className;

    // Même forme, couleurs différentes.
    expect(solideAccent).toContain("[--btn-fill:var(--accent)]");
    expect(solideDanger).toContain("[--btn-fill:var(--danger)]");
    // Même couleur, formes différentes — et la déclaration de couleur, elle, est identique.
    expect(ghostAccent).toContain("[--btn-fill:var(--accent)]");
    expect(solideAccent).toContain("[--button-bg:var(--btn-fill)]");
    expect(ghostAccent).toContain("[--button-bg:transparent]");
  });

  it("colore aussi la bordure de la variante outline", () => {
    const el = bouton(<Button variant="outline" color="danger">A</Button>);
    expect(el.className).toContain("[border-color:var(--btn-line)]");
    expect(el.className).toContain("[--btn-line:var(--danger)]");
    // La bordure elle-même vient de HeroUI, on ne la réimplémente pas.
    expect(el.className).toContain("button--outline");
  });

  it("prend la taille lg par défaut (44 px de cible tactile sur mobile)", () => {
    expect(bouton(<Button>A</Button>).className).toContain("button--lg");
    expect(bouton(<Button size="sm">A</Button>).className).toContain("button--sm");
  });

  // ⚠️ Le rayon dérive du thème, il n'est pas figé : `.button` de HeroUI porte `rounded-3xl`, que
  // HeroUI définit comme calc(var(--radius) * 3) — 24 px aujourd'hui, 36 px sur l'une des pistes
  // candidates. Le bouton reprend le jeton au facteur 1 (8 px avec les jetons actuels, mesuré),
  // demande de Jérôme du 2026-09-02.
  // ⚠️ Ce test ne vérifie QUE la moitié testable ici, et son titre le dit maintenant. Deux
  // assertions tautologiques se sont succédé à cet endroit avant celle-ci (2026-09-02) :
  // `toContain("button")` — que `button--lg` satisfait toujours — puis
  // `not.toContain("rounded-3xl")`, tout aussi creuse, parce que `rounded-3xl` vit dans le CSS de
  // `.button` et n'apparaît JAMAIS dans le className (mesuré : « button button--lg
  // button--primary […] rounded-[var(--radius)] »).
  // Que le rayon du composant l'emporte sur celui de HeroUI est un fait de CASCADE CSS, que jsdom
  // ne calcule pas : il se vérifie au rendu, dans la story `Rayon`, pas ici.
  it("pose la classe de rayon dérivée du thème", () => {
    const el = bouton(<Button>A</Button>);
    expect(el.className).toContain("rounded-[var(--radius)]");
  });

  // `shape="pill"` (2026-09-02, demande de Jérôme pour le bouton de `organisms/SearchBar`) : un
  // bouton logé dans une forme déjà arrondie doit pouvoir l'être aussi. Deux valeurs seulement —
  // un rayon libre serait une valeur en dur, qui cesserait de suivre la piste adoptée.
  it("arrondit complètement avec shape=pill, et suit le thème par défaut", () => {
    const pilule = bouton(<Button shape="pill">A</Button>).className;
    expect(pilule).toContain("rounded-full");
    expect(pilule).not.toContain("rounded-[var(--radius)]");
    expect(bouton(<Button shape="square">A</Button>).className).toContain("rounded-[var(--radius)]");
  });

  it("passe en pleine largeur avec width=full", () => {
    expect(bouton(<Button width="full">A</Button>).className).toContain("button--full-width");
    expect(bouton(<Button>A</Button>).className).not.toContain("button--full-width");
  });

  describe("état en cours", () => {
    it("affiche le libellé de remplacement et annonce l'état", () => {
      const el = bouton(
        <Button isPending pendingLabel="Enviando…">
          Pagar
        </Button>
      );
      expect(el.textContent).toContain("Enviando…");
      expect(el.textContent).not.toContain("Pagar");
      expect(el.getAttribute("data-pending")).toBe("true");
      // ⚠️ aria-disabled, PAS disabled : le bouton garde le focus et le lecteur d'écran est prévenu.
      expect(el.getAttribute("aria-disabled")).toBe("true");
      expect(el.hasAttribute("disabled")).toBe(false);
    });

    it("neutralise la soumission le temps de l'envoi", () => {
      const onPress = vi.fn();
      const el = bouton(
        <Button type="submit" isPending onPress={onPress}>
          Pagar
        </Button>
      );
      // react-aria force type="button" pendant l'attente : un double clic ne resoumet pas.
      expect(el.getAttribute("type")).toBe("button");
      fireEvent.click(el);
      expect(onPress).not.toHaveBeenCalled();
    });

    it("garde le libellé normal si aucun pendingLabel n'est fourni", () => {
      const el = bouton(<Button isPending>Pagar</Button>);
      expect(el.textContent).toContain("Pagar");
    });
  });

  it("désactive vraiment avec isDisabled", () => {
    const onPress = vi.fn();
    const el = bouton(
      <Button isDisabled onPress={onPress}>
        Pagar
      </Button>
    );
    expect(el.hasAttribute("disabled")).toBe(true);
    fireEvent.click(el);
    expect(onPress).not.toHaveBeenCalled();
  });

  // ⚠️ Une icône ne porte jamais l'information : elle accompagne un libellé, et reste invisible
  // pour un lecteur d'écran. Sans ce garde-fou, le nom accessible du bouton varierait selon que
  // l'icône expose un <title> ou non.
  it("rend les icônes décoratives inaccessibles au lecteur d'écran", () => {
    const { container } = render(
      <Button iconBefore={<svg data-testid="icone" />} iconAfter={<svg />}>
        Continuar
      </Button>
    );
    const caches = container.querySelectorAll('[aria-hidden="true"]');
    expect(caches.length).toBe(2);
    expect(caches[0].querySelector('[data-testid="icone"]')).not.toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("Continuar");
  });
});
