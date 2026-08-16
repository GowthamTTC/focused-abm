import { redirect } from "next/navigation";
export default async function R({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/offers/${slug}`);
}
