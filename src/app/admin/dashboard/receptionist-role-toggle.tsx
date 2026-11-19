"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateReceptionistRoleAction } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, UserPlus, UserMinus } from "lucide-react";

interface ReceptionistRoleToggleProps {
  userId: string;
  currentRole: string | null;
}

export function ReceptionistRoleToggle({
  userId,
  currentRole,
}: ReceptionistRoleToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (currentRole !== null && currentRole !== "RECEPTIONIST") {
    return null;
  }

  const isReceptionist = currentRole === "RECEPTIONIST";

  const handleToggle = () => {
    startTransition(async () => {
      const res = await updateReceptionistRoleAction(userId, !isReceptionist);
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error || "Unable to update user role.");
      }
    });
  };

  return (
    <Button
      type="button"
      size="xs"
      variant={isReceptionist ? "outline" : "secondary"}
      disabled={isPending}
      onClick={handleToggle}
      className="h-6 px-2 text-[11px] gap-1"
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isReceptionist ? (
        <UserMinus className="h-3 w-3" />
      ) : (
        <UserPlus className="h-3 w-3" />
      )}
      {isReceptionist ? "Revoke" : "Assign Receptionist"}
    </Button>
  );
}

