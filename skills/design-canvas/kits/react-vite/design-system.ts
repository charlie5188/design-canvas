import type { DesignSystem } from "./canvas/inspect-read";

// The project's design system, for the Inspect tool. Leave this undefined when the app has
// none; the toolbar then shows no Inspect tool. Usually `name`, `components`, and `package` are
// enough: the canvas finds the tokens itself (colors and lengths by value, their kinds by common
// names), and each prop's values in the package's types.
//
//   import * as Mui from "@mui/material";
//   export const designSystem = { name: "MUI", components: Mui, package: "@mui/material" };
//
// A theme without CSS variables (MUI's default) gives its tokens as an object:
//
//   tokens: { palette: theme.palette, shape: theme.shape, spacing: theme.spacing(1) },
//
// Components copied into the app (shadcn/ui) have no package: their props are read from the
// `cva(...)` in their source.
//
//   import { Button } from "../../src/components/ui/button";
//   export const designSystem = { name: "shadcn/ui", components: { Button } };
//
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
