import { useState } from "react";
import { db } from "./catalogue";
export function Security({ signedIn }: { signedIn: boolean }) {
  const [msg, tell] = useState(""),
    [qr, setQr] = useState(""),
    [factor, setFactor] = useState("");
  if (!db) return null;
  return (
    <details className="catalog">
      <summary>
        {signedIn ? "Password and two-step verification" : "Forgot password?"}
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          const r = signedIn
            ? await db!.auth.updateUser({ password: String(f.get("password")) })
            : await db!.auth.resetPasswordForEmail(String(f.get("email")), {
                redirectTo: location.origin + "/?account=recovery",
              });
          tell(
            r.error?.message ??
              (signedIn
                ? "Password updated."
                : "Check your email for the reset link."),
          );
          form.reset();
        }}
      >
        {signedIn ? (
          <label>
            New password
            <input
              autoComplete="new-password"
              type="password"
              name="password"
              minLength={10}
              required
            />
          </label>
        ) : (
          <label>
            Account email
            <input type="email" name="email" required />
          </label>
        )}
        <button>{signedIn ? "Update password" : "Send reset link"}</button>
      </form>
      {signedIn && (
        <>
          <button
            onClick={async () => {
              const list = await db!.auth.mfa.listFactors();
              if (list.error) {
                tell(list.error.message);
                return;
              }
              const existing = list.data.totp[0];
              if (existing) {
                setFactor(existing.id);
                tell("Enter your authenticator code.");
                return;
              }
              const r = await db!.auth.mfa.enroll({
                factorType: "totp",
                friendlyName: "VOXX " + Date.now(),
              });
              if (r.error) {
                tell(r.error.message);
                return;
              }
              setQr(r.data.totp.qr_code);
              setFactor(r.data.id);
            }}
          >
            Set up or verify authenticator
          </button>
          {qr && (
            <img
              src={qr}
              width="180"
              alt="Scan this QR code with your authenticator"
            />
          )}
          {factor && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const code = String(new FormData(e.currentTarget).get("code"));
                const r = await db!.auth.mfa.challengeAndVerify({
                  factorId: factor,
                  code,
                });
                tell(r.error?.message ?? "Two-step verification complete.");
                if (!r.error) {
                  setFactor("");
                  setQr("");
                }
              }}
            >
              <label>
                Six-digit code
                <input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  required
                />
              </label>
              <button>Verify code</button>
            </form>
          )}
        </>
      )}
      <p role="status">{msg}</p>
    </details>
  );
}
