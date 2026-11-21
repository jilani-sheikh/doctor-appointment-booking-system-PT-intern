import { Role } from "@/generated/prisma/enums";

export interface RoleProfileState {
  role?: Role | null;
  patient?: unknown;
  doctor?: unknown;
}

/**
 * Checks whether a user's role and required sub-profile are complete.
 * ADMIN and RECEPTIONIST accounts do not require Patient/Doctor sub-profiles.
 */
export function isProfileCompleteForUser(user: RoleProfileState | null): boolean {
  if (!user || !user.role) return false;
  if (user.role === Role.ADMIN || user.role === Role.RECEPTIONIST) return true;
  if (user.role === Role.PATIENT) return Boolean(user.patient);
  if (user.role === Role.DOCTOR) return Boolean(user.doctor);
  return false;
}

/**
 * Resolves the canonical dashboard route for a completed user role.
 */
export function getRoleDashboardPath(role: Role | null | undefined): string {
  switch (role) {
    case Role.PATIENT:
      return "/patient/dashboard";
    case Role.DOCTOR:
      return "/doctor/dashboard";
    case Role.ADMIN:
      return "/admin/dashboard";
    case Role.RECEPTIONIST:
      return "/receptionist";
    default:
      return "/onboarding";
  }
}

/**
 * Resolves the post-login redirect target or fallback onboarding route.
 */
export function getPostLoginRedirectForUser(user: RoleProfileState | null): string {
  if (!user) return "/sign-in";
  if (!user.role || !isProfileCompleteForUser(user)) return "/onboarding";
  return getRoleDashboardPath(user.role);
}

/**
 * Evaluates strict route/role access decision matching `requireRole(...allowedRoles)`.
 */
export function evaluateRoleRouteAccess(
  user: RoleProfileState | null,
  allowedRoles: readonly Role[]
): { allowed: true } | { allowed: false; redirectTo: string } {
  if (!user) {
    return { allowed: false, redirectTo: "/sign-in" };
  }
  if (!user.role || !isProfileCompleteForUser(user)) {
    return { allowed: false, redirectTo: "/onboarding" };
  }
  if (!allowedRoles.includes(user.role)) {
    return { allowed: false, redirectTo: getPostLoginRedirectForUser(user) };
  }
  return { allowed: true };
}

