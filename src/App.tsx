import { usePath } from "./router";
import Home from "./pages/Home";
import Pricing from "./pages/Pricing";
import Verify from "./pages/Verify";
import Studio from "./pages/Studio";
import Listen from "./pages/Listen";
import Pay from "./pages/Pay";
import Ready from "./pages/Ready";
import Legal from "./pages/Legal";

// Routes: / home + voice library, /pricing, /verify, then the try-before-you-pay
// flow /studio → /listen → /pay → /ready. /terms and /privacy share Legal.
export default function App() {
  const path = usePath().replace(/\/+$/, "") || "/";
  if (path === "/pricing") return <Pricing />;
  if (path === "/verify" || path.startsWith("/verify/")) return <Verify />;
  if (path === "/studio") return <Studio />;
  if (path === "/listen") return <Listen />;
  if (path === "/pay") return <Pay />;
  if (path === "/ready") return <Ready />;
  if (path === "/terms" || path === "/privacy") return <Legal />;
  return <Home />;
}
