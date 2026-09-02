import { redirect } from "next/navigation";
import { Shell, requirePage } from "@/app/shell";
import { NovaDesk } from "@/components/nova-desk";
import { novaHidden } from "@/lib/nova-access";

export default async function NovaPage() {
  const user = await requirePage();
  if (novaHidden(user)) redirect("/dashboard");
  return (
    <Shell user={user} active="nova">
      <NovaDesk page="nova" />
    </Shell>
  );
}
