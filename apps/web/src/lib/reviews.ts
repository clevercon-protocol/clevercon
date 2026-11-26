import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';

/** One buyer review of a service (public shape; `taskId` only for the author). */
export interface Review {
  id: string;
  serviceId: string;
  taskId?: string;
  rating: number;
  text: string | null;
  response: string | null;
  respondedAt: string | null;
  author: string;
  createdAt: string;
}

export interface ReviewsPage {
  items: Review[];
  total: number;
  avgRating: number;
}

/** A service's public reviews (newest first), with the average + count. */
export async function getServiceReviews(
  serviceId: string,
  limit = 20,
  offset = 0,
): Promise<ReviewsPage> {
  if (isDemo()) return { items: [], total: 0, avgRating: 0 };
  return apiFetch<ReviewsPage>(`/services/${serviceId}/reviews?limit=${limit}&offset=${offset}`);
}

/** The caller's own review for a hire (null until they leave one). */
export async function getMyReview(taskId: string, serviceId: string): Promise<Review | null> {
  if (isDemo()) return null;
  const res = await apiFetch<{ review: Review | null }>(
    `/reviews/mine?taskId=${encodeURIComponent(taskId)}&serviceId=${encodeURIComponent(serviceId)}`,
  );
  return res.review;
}

/** Leave a review for a settled hire (one per hire). */
export async function createReview(input: {
  serviceId: string;
  taskId: string;
  rating: number;
  text?: string;
}): Promise<Review> {
  return apiPost<Review>('/reviews', input);
}

/** Provider posts a single response to a review of their service. */
export async function respondReview(id: string, response: string): Promise<Review> {
  return apiPost<Review>(`/reviews/${id}/respond`, { response });
}

/** Flag a review or its response as abusive (author or provider only). */
export async function flagReview(id: string, reason?: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/reviews/${id}/flag`, { reason });
}
