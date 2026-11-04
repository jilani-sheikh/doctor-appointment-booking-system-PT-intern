import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <div className="container mx-auto flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-4">
        <ResetPasswordForm token={token ?? ""} />
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/sign-in" className="text-primary font-semibold hover:underline">Return to sign in</Link>
        </p>
      </div>
    </div>
  );
}
