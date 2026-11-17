import type { DesignSystem } from "./canvas/inspect-read";

// The project's design system, for the Inspect tool. Leave this undefined when the
// app has none; the toolbar then shows no Inspect tool. For example:
//   import * as Aegis from "@legalforce/aegis-react";
//   export const designSystem: DesignSystem | undefined = {
//     name: "Aegis",
//     components: Aegis,
//     tokenPrefix: "--aegis-",
//     privateTokens: "-internal-",
//     typographyAttribute: "data-aegis-typography",
//     package: "@legalforce/aegis-react",
//   };
export const designSystem: DesignSystem | undefined = undefined;
