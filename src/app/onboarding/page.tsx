import { redirect } from "next/navigation";
import { requireSetupUser } from "./guard";
import { clampStep } from "./progress";

export default async function OnboardingEntry() {
  const user = await requireSetupUser();
  redirect(`/onboarding/${clampStep(user.onboardingStep + 1)}`);
}
