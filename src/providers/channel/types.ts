/**
 * ChannelProvider — the Unipile seam, mirroring the mothership's interface
 * shape so the adapter lifts across unchanged at merge time. Mock ships first;
 * pasting UNIPILE_API_KEY + UNIPILE_DSN switches to the real adapter.
 */
export interface Relation {
  publicIdentifier: string | null;
  memberId: string | null;
  firstName: string;
  lastName: string;
  headline: string | null;
  location: string | null;
  profileUrl: string | null;
  connectedAt: string | null; // ISO when the provider exposes it
}

export interface FetchedProfile {
  headline: string | null;
  about: string | null;
  company: string | null;
  location: string | null;
  /** Provider-internal id (e.g. LinkedIn ACoAAA…) — required by the posts endpoint. */
  providerId: string | null;
}

export interface FetchedPost {
  id: string;
  text: string;
  postedAt: string | null;
  url: string | null;
}

export type AccountStatus = "operational" | "needs_reauth" | "disconnected";

export interface ChannelProvider {
  readonly name: string;

  createHostedAuthLink(input: {
    userRef: string;
    successRedirectUrl: string;
    failureRedirectUrl: string;
    notifyUrl: string;
  }): Promise<{ url: string }>;

  getAccountStatus(accountId: string): Promise<{ status: AccountStatus; displayName: string | null }>;

  /** Paginated 1st-degree connections of the connected account. */
  fetchRelations(input: {
    accountId: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ items: Relation[]; cursor: string | null }>;

  fetchProfile(input: {
    accountId: string;
    identifier: string; // public identifier, member id, or profile URL
  }): Promise<FetchedProfile | null>;

  fetchRecentPosts(input: {
    accountId: string;
    identifier: string;
    limit: number;
  }): Promise<FetchedPost[]>;
}
