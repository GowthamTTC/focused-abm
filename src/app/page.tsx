import { redirect } from "next/navigation";
import { currentUser } from "@/auth/session";

export default async function Home() {
  const user = await currentUser();
  redirect(user ? "/connections" : "/login");
}
