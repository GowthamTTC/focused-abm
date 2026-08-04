import { unipileConfigured } from "@/lib/env";
import type { ChannelProvider } from "./types";
import { MockChannelProvider } from "./mock";
import { UnipileChannelProvider } from "./unipile";

let cached: ChannelProvider | null = null;
export function getChannelProvider(): ChannelProvider {
  if (!cached) cached = unipileConfigured ? new UnipileChannelProvider() : new MockChannelProvider();
  return cached;
}
export * from "./types";
