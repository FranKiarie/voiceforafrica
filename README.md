# Mikaka Voice

Voice-overs in your accent. African-accent text-to-speech at **voice.mikaka.io**.

You paste a script and hear about 45 seconds free. Paystack then charges the projected length in Kenyan shillings, by M-Pesa or card, and you download the full clip with a licence.

## Price

**KES 195 per minute** of projected audio, one minute minimum, rounded up to the next minute. Change `KES_PER_MINUTE` in `src/pricing.ts`. The studio, the pay screen, and the Paystack charge all use that number.

## Stack

- **This repo:** Vite + React + TypeScript, plus Vercel serverless functions in `api/` and `server/`.
- **Gemini 3.8 Flash TTS** makes the audio (`gemini-3.8-flash-tts`).
- **Paystack** takes M-Pesa and card payments in KES. The server verifies the transaction before it will generate the full clip.

There is no separate Fly backend for this product. `FranKiarie/Mivoicefinal` is not available, so payments and speech live here.

## Develop

```bash
npm install
cp .env.example .env
# fill in GEMINI_API_KEY and PAYSTACK_SECRET_KEY
npm run dev
```

`npm run dev` serves the site and the `/api` routes together. Set `VITE_API_MODE=demo` in `.env` if you only want the screens, with no audio and no charges.

```bash
npm run check
npm run build
```

## Go live

See the pull request description for the Vercel env vars, the Paystack webhook, and the DNS record for voice.mikaka.io.

Accounts, monthly plans, and email delivery are not on sale yet. Pay as you go is the path that takes money.
