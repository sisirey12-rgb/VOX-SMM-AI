import { useState } from "react";
import { db } from "./catalogue";
export function Reconcile({
  id,
  refresh,
}: {
  id: string;
  refresh: () => void;
}) {
  const [msg, tell] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const upstream = String(f.get("upstream")).trim();
        const absent = f.get("absent") === "on";
        if (
          !confirm(
            "Apply the verified upstream outcome to this order and its wallet record?",
          )
        )
          return;
        const r = await db!.rpc("voxx_resolve_order", {
          order_id: id,
          upstream_id: upstream || null,
          confirmed_absent: absent,
        });
        if (r.error) tell(r.error.message);
        else refresh();
      }}
    >
      <label>
        Confirmed upstream order ID
        <input name="upstream" inputMode="numeric" />
      </label>
      <label>
        <input type="checkbox" name="absent" /> Provider confirmed no order
        exists
      </label>
      <button>Record resolution</button>
      <p>{msg}</p>
    </form>
  );
}

export function OrderCredit({ id }: { id: string }) {
  const [message, tell] = useState("");
  return (
    <details>
      <summary>Settle order credit</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const paise = Math.round(Number(f.get("amount")) * 100);
          if (!confirm("Post this credit to the customer's live wallet?"))
            return;
          const r = await db!.rpc("voxx_credit_order", {
            order_id: id,
            amount_paise: paise,
            reason: String(f.get("reason")),
          });
          tell(r.error?.message ?? "Credit posted.");
        }}
      >
        <label>
          Credit (INR)
          <input required name="amount" type="number" step=".01" min=".01" />
        </label>
        <label>
          Settlement reason
          <input required minLength={4} name="reason" />
        </label>
        <button>Post credit</button>
        <p>{message}</p>
      </form>
    </details>
  );
}
