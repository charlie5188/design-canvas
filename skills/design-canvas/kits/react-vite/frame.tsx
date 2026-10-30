import { createRoot } from "react-dom/client";
import { FrameHost } from "./canvas/FrameHost";
import { theme } from "./canvas-theme";
import { Providers } from "./providers";
import { registry } from "./registry";

// One item alone at its real size: frame.html?item=<id>.
createRoot(document.getElementById("root")!).render(
  <Providers>
    <FrameHost items={registry} storageKey="design-canvas:__CANVAS_NAME__" theme={theme} />
  </Providers>,
);
