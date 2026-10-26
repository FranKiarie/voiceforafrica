import { usePath } from "./router";
import { useReveal } from "./reveal";
import Home from "./pages/Home";
import Pricing from "./pages/Pricing";
import Verify from "./pages/Verify";
import Studio from "./pages/Studio";
import Listen from "./pages/Listen";
import Pay from "./pages/Pay";
import Ready from "./pages/Ready";
import Legal from "./pages/Legal";
import Signin from "./pages/Signin";
import Clips from "./pages/Clips";
import Dashboard from "./pages/Dashboard";
import Subscribe from "./pages/Subscribe";
import NotFound from "./pages/NotFound";
import Signup from "./pages/Signup";
import ResetPassword from "./pages/ResetPassword";

// Routes: / home + voice library, /pricing, /verify, the try-before-you-pay flow
// /studio → /listen → /pay → /ready, /signin, /clips, /subscribe?plan=…, and
// /terms + /privacy (shared Legal page).
export default function App() {
  const path = usePath().replace(/\/+$/, "") || "/";
  useReveal(path);
  // A new key per page replays the page-rise animation on every navigation.
  return (
    <div className="route" key={path}>
      <Page path={path} />
    </div>
  );
}

function Page({ path }: { path: string }) {
  if (path === "/") return <Home />;
  if (path === "/pricing") return <Pricing />;
  if (path === "/verify" || path.startsWith("/verify/")) return <Verify />;
  if (path === "/studio") return <Studio />;
  if (path === "/listen") return <Listen />;
  if (path === "/pay") return <Pay />;
  if (path === "/ready") return <Ready />;
  if (path === "/signin") return <Signin />;
  if (path === "/signup") return <Signup />;
  if (path === "/reset-password") return <ResetPassword />;
  if (path === "/dashboard") return <Dashboard />;
  if (path === "/clips") return <Clips />;
  if (path === "/subscribe") return <Subscribe />;
  if (path === "/terms" || path === "/privacy") return <Legal />;
  return <NotFound />;
}
