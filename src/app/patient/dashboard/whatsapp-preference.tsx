"use client";

import { useState, useTransition } from "react";
import { updateWhatsAppOptInAction } from "@/lib/actions/auth";

function maskPhone(phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? `+91 ******${digits.slice(-4)}` : "an invalid phone number";
}

export function WhatsAppPreference({ phone, optedIn }: { phone?: string | null; optedIn: boolean }) {
  const [enabled, setEnabled] = useState(optedIn);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  return (
    <div className="mt-4 border-t border-border pt-4">
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked;
            setEnabled(next);
            setMessage("");
            startTransition(async () => {
              const result = await updateWhatsAppOptInAction({ whatsappOptIn: next });
              if (!result.success) {
                setEnabled(!next);
                setMessage(result.error ?? "Unable to update preference.");
              } else {
                setMessage("Preference saved.");
              }
            });
          }}
          className="mt-1"
        />
        <span>
          Send me appointment updates on WhatsApp (to this phone number)
          <span className="block text-xs text-muted-foreground mt-1">
            {maskPhone(phone)}
          </span>
        </span>
      </label>
      {message && <p className="text-xs text-muted-foreground mt-2">{message}</p>}
    </div>
  );
}
