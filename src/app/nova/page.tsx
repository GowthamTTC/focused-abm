import { Shell, requirePage } from "@/app/shell";
import { NovaDesk } from "@/components/nova-desk";

export default async function NovaPage() {
  const user = await requirePage();
  return (
    <Shell user={user} active="nova">
      <NovaDesk page="nova" />
    </Shell>
  );
}
