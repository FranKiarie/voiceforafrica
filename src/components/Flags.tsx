// Flags of the countries our accents come from, each gently waving. Still under
// reduced motion. Flag art: flag-icons (MIT).
import cd from "flag-icons/flags/4x3/cd.svg";
import ci from "flag-icons/flags/4x3/ci.svg";
import eg from "flag-icons/flags/4x3/eg.svg";
import et from "flag-icons/flags/4x3/et.svg";
import gh from "flag-icons/flags/4x3/gh.svg";
import ke from "flag-icons/flags/4x3/ke.svg";
import ma from "flag-icons/flags/4x3/ma.svg";
import ng from "flag-icons/flags/4x3/ng.svg";
import rw from "flag-icons/flags/4x3/rw.svg";
import sn from "flag-icons/flags/4x3/sn.svg";
import tz from "flag-icons/flags/4x3/tz.svg";
import ug from "flag-icons/flags/4x3/ug.svg";
import za from "flag-icons/flags/4x3/za.svg";
import zm from "flag-icons/flags/4x3/zm.svg";
import zw from "flag-icons/flags/4x3/zw.svg";
import { LIVE_ACCENTS } from "../data";
import "./Flags.css";

// Accent ids are country codes.
const COUNTRIES: Record<string, { name: string; src: string }> = {
  ke: { name: "Kenya", src: ke },
  ng: { name: "Nigeria", src: ng },
  za: { name: "South Africa", src: za },
  gh: { name: "Ghana", src: gh },
  tz: { name: "Tanzania", src: tz },
  ug: { name: "Uganda", src: ug },
  rw: { name: "Rwanda", src: rw },
  et: { name: "Ethiopia", src: et },
  zw: { name: "Zimbabwe", src: zw },
  zm: { name: "Zambia", src: zm },
  sn: { name: "Senegal", src: sn },
  ci: { name: "Côte d'Ivoire", src: ci },
  cd: { name: "DR Congo", src: cd },
  eg: { name: "Egypt", src: eg },
  ma: { name: "Morocco", src: ma },
};

export function Flags({ className }: { className?: string }) {
  const shown = LIVE_ACCENTS.filter((a) => COUNTRIES[a.id]);
  return (
    <ul className={["flags", className].filter(Boolean).join(" ")} aria-label="Countries our accents come from">
      {shown.map((a, i) => {
        const c = COUNTRIES[a.id];
        return (
          <li key={a.id} className="flag" title={c.name} style={{ ["--i" as string]: i }}>
            <img src={c.src} alt={c.name} width={40} height={30} decoding="async" />
          </li>
        );
      })}
    </ul>
  );
}
