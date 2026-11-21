/**
 * Komunita v HubGetu (Supabase – supabase/migrations/20261122120000_community.sql):
 * návrhy aplikací s hlasováním, odpovědi vývojářů na recenze a počty instalací jedné
 * aplikace. Bez Supabase (webová ukázka bez klíčů) nic nedělají – UI je pak skryje.
 */
import { supabase } from "./supabase";

export const communityAvailable = () => !!supabase;

export interface AppRequest {
  id: string;
  name: string;
  url: string | null;
  note: string | null;
  status: "open" | "added" | "rejected";
  votes: number;
  voted: boolean;
  createdAt: string;
}

interface AppRequestRow {
  id: string;
  name: string;
  url: string | null;
  note: string | null;
  status: AppRequest["status"];
  votes: number;
  voted: boolean;
  created_at: string;
}

function client() {
  if (!supabase) throw new Error("Supabase není nastavený");
  return supabase;
}

export async function topRequests(): Promise<AppRequest[]> {
  const { data, error } = await client().rpc("app_requests_top", { p_limit: 50 });
  if (error) throw error;
  return ((data ?? []) as AppRequestRow[]).map((r) => ({ ...r, createdAt: r.created_at }));
}

export async function requestApp(name: string, url: string, note: string): Promise<string> {
  const { data, error } = await client().rpc("request_app", { p_name: name, p_url: url || null, p_note: note || null });
  if (error) throw error;
  return data as string;
}

export async function toggleRequestVote(id: string): Promise<boolean> {
  const { data, error } = await client().rpc("toggle_app_request_vote", { p_request_id: id });
  if (error) throw error;
  return data as boolean;
}

/** Odpověď vývojáře u recenze. */
export interface ReviewReply {
  body: string;
  /** GitHub login vývojáře. */
  author: string;
  updatedAt: string;
}

export async function reviewReplies(appId: string): Promise<Map<string, ReviewReply>> {
  const { data, error } = await client().rpc("review_replies_of", { p_app_id: appId });
  if (error) throw error;
  return new Map(
    ((data ?? []) as { review_id: string; body: string; author: string; updated_at: string }[]).map((r) => [
      r.review_id,
      { body: r.body, author: r.author, updatedAt: r.updated_at },
    ]),
  );
}

export type MaintainerStatus = "none" | "pending" | "approved";

export async function maintainerStatus(appId: string): Promise<MaintainerStatus> {
  const { data, error } = await client().rpc("my_maintainer_status", { p_app_id: appId });
  if (error) throw error;
  return (data as MaintainerStatus) ?? "none";
}

export async function requestMaintainer(appId: string, repo: string): Promise<MaintainerStatus> {
  const { data, error } = await client().rpc("request_maintainer", { p_app_id: appId, p_repo: repo || null });
  if (error) throw error;
  return data as MaintainerStatus;
}

/** Odpověď na recenzi (prázdný text odpověď smaže). */
export async function replyToReview(reviewId: string, body: string): Promise<void> {
  const { error } = await client().rpc("reply_to_review", { p_review_id: reviewId, p_body: body });
  if (error) throw error;
}

/** Instalace aplikace za 30, 90 a 365 dní (null = méně než 3). */
export async function installStats(appId: string): Promise<{ days: number; installs: number | null }[]> {
  const { data, error } = await client().rpc("app_install_stats", { p_app_id: appId });
  if (error) throw error;
  return (data ?? []) as { days: number; installs: number | null }[];
}

/** Repozitář na GitHubu z adresy („https://github.com/owner/repo“ → „owner/repo“). */
export function githubRepo(url: string | null | undefined): string | null {
  const match = url?.match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}
