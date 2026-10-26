# Mikaka Voice

Voice-overs in your accent. African-accent text-to-speech, served at **voice.mikaka.io**.

You paste a script and hear at least 45 seconds free. Then a Paystack popup charges the projected length, by M-Pesa or card, and you download the full clip with a licence.

## Stack

- **Frontend:** this repo. Vite + React + TypeScript, deployed on Vercel (project `voiceforafrica`).
- **Backend:** Mikaka's shared backend on its own Fly project, with its own API keys (Gemini TTS, Paystack).

## Develop

```bash
npm install
npm run dev
```

## Status

A coming-soon page. The full app (voice library, studio, preview, Paystack checkout, licences) is built after the wireframes are approved.
