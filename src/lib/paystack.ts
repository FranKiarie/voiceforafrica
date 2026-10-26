// Paystack Inline checkout. With no public key set, the Pay page shows its own
// test checkout instead and no money moves.
//
// Before live payments: the server must create the transaction (Paystack
// "initialize" with the quote it computes itself) and return an access_code.
// The page should then call `new PaystackPop().resumeTransaction(access_code)`
// so the browser can't change the amount. The Paystack webhook, not this
// page's onSuccess, is what confirms the payment.

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

export async function payWithPaystack(opts: {
  email: string;
  amountKes: number;
  metadata: Record<string, unknown>;
  onSuccess(ref: string): void;
  onCancel(): void;
}): Promise<"opened" | "demo"> {
  const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
  if (!key) return "demo";
  await loadInline();
  const popup = new (window as any).PaystackPop();
  popup.newTransaction({
    key,
    email: opts.email,
    amount: Math.round(opts.amountKes * 100),
    currency: "KES",
    channels: ["mobile_money", "card"],
    metadata: opts.metadata,
    onSuccess: (t: { reference: string }) => opts.onSuccess(t.reference),
    onCancel: () => opts.onCancel(),
  });
  return "opened";
}
