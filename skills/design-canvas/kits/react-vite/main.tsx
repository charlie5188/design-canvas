import { createRoot } from "react-dom/client";
import { Canvas } from "./canvas/Canvas";
import { theme } from "./canvas-theme";
import { Providers } from "./providers";
import { notes, registry, sections } from "./registry";

// A standalone design canvas: the app's real components with synthetic data
// and no backend. Nothing here ships in the app.
createRoot(document.getElementById("root")!).render(
  <Providers>
    <Canvas items={registry} notes={notes} sections={sections} storageKey="design-canvas:__CANVAS_NAME__" theme={theme} />
  </Providers>,
);
