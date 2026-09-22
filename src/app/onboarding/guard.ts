import { redirect } from "next/navigation";
import { currentUser, type Ctx } from "@/auth/session";

/** Wizard-side counterpart to shell.tsx's requirePage(): same login and
 *  temp-password gates, but sends an already-finished user out to the app
 *  instead of pulling them back into setup. */
export async function requireSetupUser(): Promise<Ctx> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (user.onboardingCompletedAt) redirect("/dashboard");
  return user;
}
