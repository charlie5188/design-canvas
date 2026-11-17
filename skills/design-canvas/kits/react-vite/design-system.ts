import type { DesignSystem } from "./canvas/inspect-read";

// The project's design system, for the Inspect tool. Leave this undefined when the app has
// none; the toolbar then shows no Inspect tool. Only `name` and `components` are needed: the
// canvas finds the tokens itself (colors and lengths by value, their kinds by common names).
// The rest fits it to a system whose names or files differ; references/making-a-kit.md says how.
//
//   import * as Aegis from "@legalforce/aegis-react";
//   export const designSystem: DesignSystem | undefined = {
//     name: "Aegis",
//     components: Aegis,
//     package: "@legalforce/aegis-react",
//     tokenPrefix: "--aegis-",
//     privateTokens: "-internal-",
//     tokenLabel: (property) => property.slice("--aegis-".length).replace(/-/g, "."),
//     tokenKinds: { text: /^aegis-color-foreground/, fill: /^aegis-color-background/, border: /^aegis-color-border/ },
//     typographyAttribute: "data-aegis-typography",
//   };
export const designSystem: DesignSystem | undefined = undefined;
