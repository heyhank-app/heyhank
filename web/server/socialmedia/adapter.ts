// Social Media Adapter interface
import type { SocialProfile, CreatePostInput, PostAnalytics, AccountAnalytics, SocialComment, SocialPlatform } from "./types.js";

export interface SocialMediaAdapter {
  testConnection(): Promise<{ ok: boolean; error?: string; data?: unknown }>;
  getProfiles(): Promise<SocialProfile[]>;
  supportedPlatforms(): SocialPlatform[];
  createPost(input: CreatePostInput): Promise<{ id: string | null; status: string; backendData?: unknown }>;
  listPosts(opts?: { limit?: number }): Promise<Array<{ id: string; text: string; status: string; platforms: string[]; createdAt?: string | null; scheduledAt?: string | null }>>;
  deletePost(postId: string): Promise<boolean>;
  getAnalytics(postId: string): Promise<PostAnalytics>;
  getAccountAnalytics(profileId: string): Promise<AccountAnalytics>;
  getComments(postId: string): Promise<SocialComment[]>;
  replyToComment(postId: string, commentId: string | null, text: string): Promise<{ ok: boolean; error?: string }>;
}
