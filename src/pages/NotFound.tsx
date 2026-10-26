import { Shell } from "../components/Shell";
import { Link } from "../router";

export default function NotFound() {
  return (
    <Shell>
      <div className="narrow center" style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "center" }}>
        <p className="hand" style={{ fontSize: 56 }}>Pole sana.</p>
        <h1 style={{ fontSize: 32 }}>We couldn't find that page</h1>
        <p className="muted">The link may be old, or the page has moved.</p>
        <Link className="btn" href="/">
          Go to the home page
        </Link>
      </div>
    </Shell>
  );
}
