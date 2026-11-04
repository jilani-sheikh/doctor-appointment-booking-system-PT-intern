"use client";

import { useState, useTransition } from "react";
import { deleteAccountAction } from "@/lib/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

export function DeleteProfileDialog({ email }: { email?: string | null }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await deleteAccountAction({
        confirmation,
        email: accountEmail || undefined,
        currentPassword: currentPassword || undefined,
      });
      if (result?.success === false) {
        toast.error(result.error);
        return;
      }
      toast.success("Your profile has been deleted.");
      setOpen(false);
    });
  };

  return (
    <>
      <button
        type="button"
        role="menuitem"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-md cursor-pointer transition-colors text-left"
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        Delete profile
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your profile?</DialogTitle>
            <DialogDescription>
              This permanently removes your personal profile and operational history without payment records.
              Financial-linked appointment, payment, and refund rows are retained as an anonymized ledger.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="delete-confirmation" className="text-sm font-medium">Type DELETE</label>
              <Input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="delete-email" className="text-sm font-medium">Account email (Google confirmation)</label>
              <Input id="delete-email" type="email" placeholder={email ?? ""} value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="delete-password" className="text-sm font-medium">Current password (credentials confirmation)</label>
              <Input id="delete-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={isPending || confirmation !== "DELETE"}>
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Delete profile
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
