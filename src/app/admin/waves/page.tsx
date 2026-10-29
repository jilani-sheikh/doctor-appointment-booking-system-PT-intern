import { redirect } from "next/navigation";

/**
 * Wave management is doctor-owned.
 * Admin waves route redirects to /admin/doctors.
 */
export default function AdminWavesRedirectPage() {
  redirect("/admin/doctors");
}
