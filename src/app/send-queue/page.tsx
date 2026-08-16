import { redirect } from "next/navigation";
export default async function R({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  redirect(`/review?tab=ready${c ? `&c=${c}` : ""}`);
}
