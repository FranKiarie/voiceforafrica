import { RiseWords } from "../components/Motion";
import { Shell } from "../components/Shell";
import { BeadSettle } from "./Signin";

const TERMS = [
  "Your licence is non-exclusive and lasts forever. It covers one clip, at the tier you held when the clip was made.",
  "Resale means selling the clip inside your own product. You may never resell the voices themselves or an API.",
  "You must be 18 or older to use Mikaka Voice.",
  "Do not impersonate real people, run scams, deceive voters, or pass the audio off as a human recording to fool anyone.",
  "You must own the rights to the scripts you paste.",
  "We give no warranty on intellectual property. Similar audio may exist for others, and our liability is capped.",
  "Do not strip the SynthID watermark or the file tags. Make any AI disclosures the law requires.",
  "Previews are for listening only and carry no licence.",
];

const PRIVACY = [
  "We keep your script and email to make and deliver your clip.",
  "Scripts are sent to Google to generate the audio.",
  "Payments are handled by Paystack. We never see your card details or M-Pesa PIN.",
  "We keep your history for as long as your plan allows: 7 days on pay as you go.",
];

export default function Legal() {
  const isTerms = window.location.pathname === "/terms";

  return (
    <Shell>
      <div className="narrow">
        <BeadSettle style={{ marginBottom: 14 }} />
        <h1 style={{ fontSize: 40, marginBottom: 24 }}>
          <RiseWords text={isTerms ? "Terms" : "Privacy"} />
        </h1>
        {isTerms ? (
          <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            {TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            {PRIVACY.map((t) => (
              <li key={t}>{t}</li>
            ))}
            <li>
              Questions? Write to <a href="mailto:support@mikaka.io">support@mikaka.io</a>.
            </li>
          </ul>
        )}
        <p className="faint" style={{ marginTop: 32, fontSize: 15 }}>
          Draft — final wording after legal review.
        </p>
      </div>
    </Shell>
  );
}
