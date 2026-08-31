import { Shell, requirePage } from "@/app/shell";
import { NovaThread } from "@/components/agent-rail";

export default async function NovaPage() {
  const user = await requirePage();
  return (
    <Shell user={user} active="nova">
      <div className="relative mx-auto flex min-h-[calc(100vh-140px)] max-w-3xl flex-col">
        <NovaThread page="nova" />
      </div>
    </Shell>
  );
}
