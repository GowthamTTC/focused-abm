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
  connectedAt: string | null;
}

export interface FetchedProfile {
  headline: string | null;
  about: string | null;
  company: string | null;
  location: string | null;
  providerId: string | null;
}

export interface FetchedPost {
  id: string;
  text: string;
  postedAt: string | null;
  url: string | null;
}

/** People found via LinkedIn search (2nd / 3rd+), not the relations list. */
export interface SearchPost {
  text: string;
  postedAt: string | null;
  author: SearchHit;
  isCompany: boolean;
}

export interface SearchHit {
  publicIdentifier: string | null;
  memberId: string | null;
  firstName: string;
  lastName: string;
  headline: string | null;
  location: string | null;
  profileUrl: string | null;
  networkDistance: "2" | "3";
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

  /** All seats on the Unipile workspace (for post-connect claim). */
  listAccounts(): Promise<{ id: string; name: string | null; displayName: string | null }[]>;

  fetchRelations(input: {
    accountId: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ items: Relation[]; cursor: string | null }>;

  fetchProfile(input: {
    accountId: string;
    identifier: string;
  }): Promise<FetchedProfile | null>;

  fetchRecentPosts(input: {
    accountId: string;
    identifier: string;
    limit: number;
  }): Promise<FetchedPost[]>;

  searchPosts(input: {
    accountId: string;
    keywords: string;
    datePosted?: "past_day" | "past_week" | "past_month";
    cursor?: string | null;
    limit?: number;
  }): Promise<{ items: SearchPost[]; cursor: string | null }>;

  searchPeople(input: {
    accountId: string;
    keywords: string;
    networkDistance: Array<2 | 3>;
    locationIds?: number[];
    locationQuery?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<{ items: SearchHit[]; cursor: string | null }>;
}
