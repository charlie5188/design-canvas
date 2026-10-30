import type { ReactNode } from "react";
// @global-css: the installer replaces this line with the app's global stylesheet.
import "./theme.css";

// What previews need around them: the app's stylesheet above, plus any
// providers its components read, such as theme, i18n, or a data client.
// Synthetic data only; nothing here may reach a real backend.
export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
