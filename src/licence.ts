import { formatDuration, formatKes, LANGUAGES } from "./data";

export function languageLabel(code: string): string {
  const lang = LANGUAGES.find((item) => item.code === code);
  if (!lang) return code;
  return lang.en ? `${lang.own} (${lang.en})` : lang.own;
}

export function licenceDocument(input: {
  id: string;
  voice: string;
  language: string;
  seconds: number;
  paidKes?: number;
  email?: string;
  issued: string;
}): string {
  const lines = [
    "MIKAKA VOICE",
    "Commercial licence",
    "",
    `Licence ID: ${input.id}`,
    `Voice: ${input.voice}`,
    `Language: ${languageLabel(input.language)}`,
    `File length: ${formatDuration(input.seconds)}`,
  ];
  if (input.paidKes) lines.push(`Paid: ${formatKes(input.paidKes)}`);
  lines.push(`Issued: ${input.issued}`);
  if (input.email) lines.push(`Email: ${input.email}`);
  lines.push(
    "",
    "This licence is non-exclusive and lasts for this one clip.",
    "You may use the clip in your own videos, adverts, courses, podcasts and announcements.",
    "You may not resell the voice itself, offer it as an API, or present the clip as a real person's recording in order to deceive.",
    "You must own the rights to the script you pasted, and you must be 18 or older.",
    "The free preview is for listening only and is not covered by this licence.",
    "Payments are processed by Paystack. Mikaka Voice does not see your M-Pesa PIN or full card number.",
    "",
    "Full terms: https://voice.mikaka.io/terms",
    `Check this licence: https://voice.mikaka.io/verify/${input.id}`,
    "",
    "Mikaka Voice · voice.mikaka.io",
  );
  return lines.join("\n");
}
