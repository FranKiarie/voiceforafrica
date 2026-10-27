// Line icons drawn on a 24-unit grid, stroked in the current text colour.
export const ICONS = {
  mic: "M12 3 a3 3 0 0 1 3 3 v6 a3 3 0 0 1 -6 0 v-6 a3 3 0 0 1 3 -3 Z M5 11 a7 7 0 0 0 14 0 M12 18 v3",
  radio: "M4 9 h16 v11 h-16 Z M7 9 L17 4 M8 14.5 a1.5 1.5 0 1 0 0.01 0 M13 13 h4 M13 16 h4",
  phone: "M5 4 h4 l2 5 -2.5 1.5 a11 11 0 0 0 5 5 l1.5 -2.5 5 2 v4 a2 2 0 0 1 -2 2 A16 16 0 0 1 3 6 a2 2 0 0 1 2 -2 Z",
  book: "M4 5 a2 2 0 0 1 2 -2 h13 v16 h-13 a2 2 0 0 0 -2 2 Z M4 19 v2 M8 7 h7",
  chat: "M4 5 h11 v8 h-7 l-4 3 Z M9 16 v2 h7 l4 3 v-11 h-3",
  bell: "M6 16 v-5 a6 6 0 0 1 12 0 v5 l2 2 h-16 Z M10 20 a2 2 0 0 0 4 0",
  home: "M4 11 L12 4 L20 11 M6 9.5 V20 H10 V14 H14 V20 H18 V9.5",
  wave: "M4 10 v4 M8 7 v10 M12 4 v16 M16 8 v8 M20 10 v4",
  card: "M3 6 h18 v12 h-18 Z M3 10 h18 M7 15 h4",
  shield: "M12 3 L19 6 V11.5 C19 15.5 16 18.8 12 20.5 C8 18.8 5 15.5 5 11.5 V6 Z M9 12 L11.2 14.2 L15.2 10",
  plus: "M12 5 v14 M5 12 h14",
  menu: "M4 7 h16 M4 12 h16 M4 17 h16",
  close: "M6 6 L18 18 M18 6 L6 18",
  out: "M14 4 h5 v16 h-5 M10 8 l-4 4 4 4 M6 12 h10",
  tv: "M3 5 h18 v12 h-18 Z M8 21 h8 M12 17 v4",
  film: "M4 4 h16 v16 h-16 Z M8 4 v16 M16 4 v16 M4 8 h4 M4 12 h4 M4 16 h4 M16 8 h4 M16 12 h4 M16 16 h4",
  play: "M4 5 h16 v11 h-16 Z M10 8.5 L14.5 10.5 L10 12.5 Z M8 20 h8",
  arrow: "M5 12 h14 M13 6 l6 6 -6 6",
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none" }}>
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
