import { useSyncExternalStore } from "react";

// The project's own themes, switched from the canvas toolbar. The kit decides
// how a theme applies: a class or attribute on <html>, or a provider prop
// that reads the current id through `useThemeId`.

export type ThemeOption = { id: string; label: string };

export type ThemeStore = {
  options: readonly ThemeOption[];
  get(): string;
  set(id: string): void;
  subscribe(listener: () => void): () => void;
};

export function createThemeStore({
  options,
  initial,
  apply,
}: {
  options: readonly ThemeOption[];
  initial?: string;
  /** Applies a theme to the current document, for example `classTheme`. */
  apply?: (id: string) => void;
}): ThemeStore {
  const known = new Set(options.map((option) => option.id));
  const listeners = new Set<() => void>();
  let current = initial && known.has(initial) ? initial : (options[0]?.id ?? "");
  apply?.(current);
  return {
    options,
    get: () => current,
    set(id) {
      if (!known.has(id) || id === current) return;
      current = id;
      apply?.(id);
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Toggles one class per theme on <html>; `null` means no class, as for a default light theme. */
export const classTheme =
  (classes: Record<string, string | null>) =>
  (id: string): void => {
    const root = document.documentElement;
    for (const [theme, name] of Object.entries(classes)) {
      if (name) root.classList.toggle(name, theme === id);
    }
  };

/** Sets an attribute such as `data-theme` on <html> to the theme id. */
export const attributeTheme =
  (attribute: string) =>
  (id: string): void => {
    document.documentElement.setAttribute(attribute, id);
  };

/** The current theme id, for providers that take the theme as a prop. */
export function useThemeId(store: ThemeStore | undefined): string | undefined {
  return useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.get(),
  );
}
