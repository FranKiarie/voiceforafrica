// Paystack Inline checkout.
//
// The server creates the transaction (Paystack "initialize" with the price it
// computes itself) and hands back an access_code. The browser only resumes that
// transaction, so it can never change the amount. The Paystack webhook, not the
// onSuccess callback here, is what confirms the payment on the server.
//
// In demo mode there is no access code and the Pay page shows its own test
// checkout instead; no money moves.

const INLINE_SRC = "https://js.paystack.co/v2/inline.js";

let loading: Promise<void> | null = null;

function loadInline(): Promise<void> {
  if ((window as any).PaystackPop) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = INLINE_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("Could not load Paystack"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Opens Paystack's checkout for a transaction the server already created. */
export async function resumeWithPaystack(
  accessCode: string,
  opts: { onSuccess(ref: string): void; onCancel(): void },
): Promise<void> {
  await loadInline();
  const popup = new (window as any).PaystackPop();
  popup.resumeTransaction(accessCode, {
    onSuccess: (t: { reference: string }) => opts.onSuccess(t.reference),
    onCancel: () => opts.onCancel(),
  });
}
