import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Flag, Loader2 } from 'lucide-react';
import {
  getServiceReviews,
  getMyReview,
  createReview,
  respondReview,
  flagReview,
  type Review,
} from '../lib/reviews';
import { getMyProfile } from '../lib/org';
import type { Owner } from '../lib/services';
import { Stars, StarInput } from './Stars';

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const d = Math.floor(diff / 86400000);
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  if (h >= 1) return `${h}h ago`;
  const m = Math.floor(diff / 60000);
  return m >= 1 ? `${m}m ago` : 'just now';
}

/** One review card: the rating, text, the provider's response, and manage actions. */
function ReviewCard({ review, canManage }: { review: Review; canManage: boolean }) {
  const qc = useQueryClient();
  const [responding, setResponding] = useState(false);
  const [text, setText] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['reviews', review.serviceId] });
  const respond = useMutation({
    mutationFn: () => respondReview(review.id, text.trim()),
    onSuccess: () => {
      setResponding(false);
      setText('');
      refresh();
    },
  });
  const flag = useMutation({ mutationFn: () => flagReview(review.id), onSuccess: refresh });

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stars value={review.rating} />
          <span className="text-xs text-slate-400">{review.author}</span>
        </div>
        <span className="text-[11px] text-slate-600">{timeAgo(review.createdAt)}</span>
      </div>
      {review.text && <p className="mt-1.5 text-sm text-slate-300">{review.text}</p>}

      {review.response ? (
        <div className="mt-2 rounded-lg border-l-2 border-violet-500/40 bg-white/[0.03] px-3 py-2">
          <div className="text-[11px] font-medium text-violet-300">Provider response</div>
          <p className="mt-0.5 text-xs text-slate-300">{review.response}</p>
        </div>
      ) : (
        canManage &&
        (responding ? (
          <div className="mt-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Respond to this review…"
              className="w-full rounded-lg bg-black/30 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-500/40"
            />
            <div className="mt-1.5 flex gap-2">
              <button
                onClick={() => respond.mutate()}
                disabled={respond.isPending || !text.trim()}
                className="rounded-lg border border-violet-500/30 bg-violet-500/15 px-2.5 py-1 text-xs text-violet-200 hover:bg-violet-500/25 disabled:opacity-50"
              >
                {respond.isPending ? 'Posting…' : 'Post response'}
              </button>
              <button
                onClick={() => setResponding(false)}
                className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-xs text-slate-400 hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex gap-3">
            <button
              onClick={() => setResponding(true)}
              className="inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200"
            >
              <MessageSquare size={11} /> Respond
            </button>
            <button
              onClick={() => flag.mutate()}
              disabled={flag.isPending}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-300 disabled:opacity-50"
            >
              <Flag size={11} /> Flag
            </button>
          </div>
        ))
      )}
    </div>
  );
}

/** A service's reviews on its detail page: average, count, and the list. */
export function ServiceReviews({ serviceId, owner }: { serviceId: string; owner?: Owner | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reviews', serviceId],
    queryFn: () => getServiceReviews(serviceId),
  });
  // Decide if the viewer owns this service (so they can respond/flag). Best-effort.
  const { data: profile } = useQuery({ queryKey: ['my-profile'], queryFn: getMyProfile });
  const canManage =
    !!owner?.handle &&
    (profile?.handle === owner.handle ||
      (profile?.orgs ?? []).some((o) => o.handle === owner.handle));

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={14} className="animate-spin" /> Loading reviews…
      </div>
    );
  }
  const reviews = data?.items ?? [];
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-medium text-slate-200">Reviews</h3>
        {data && data.total > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Stars value={data.avgRating} />
            {data.avgRating.toFixed(1)} · {data.total} review{data.total === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="text-xs text-slate-500">No reviews yet</span>
        )}
      </div>
      {reviews.length > 0 && (
        <div className="space-y-2">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The buyer's review for a settled hire, shown on the Job view. Lets them leave a
 * rating + note once (then shows what they left). Hidden until the hire can be reviewed;
 * the API is the authority, so a 400 ("not settled yet") just surfaces inline.
 */
export function LeaveReview({
  taskId,
  serviceId,
  serviceName,
}: {
  taskId: string;
  serviceId: string;
  serviceName?: string | null;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-review', taskId, serviceId],
    queryFn: () => getMyReview(taskId, serviceId),
  });
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const submit = useMutation({
    mutationFn: () => createReview({ serviceId, taskId, rating, text: text.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-review', taskId, serviceId] });
      qc.invalidateQueries({ queryKey: ['reviews', serviceId] });
    },
  });

  if (isLoading) return null;

  if (data) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Your review</span>
          <Stars value={data.rating} />
        </div>
        {data.text && <p className="mt-1 text-sm text-slate-300">{data.text}</p>}
        {data.response && (
          <div className="mt-2 rounded-lg border-l-2 border-violet-500/40 bg-white/[0.03] px-3 py-2">
            <div className="text-[11px] font-medium text-violet-300">Provider response</div>
            <p className="mt-0.5 text-xs text-slate-300">{data.response}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-sm font-medium text-slate-200">
        Rate {serviceName ? serviceName : 'this provider'}
      </div>
      <p className="text-xs text-slate-500">Your review helps other buyers hire with confidence.</p>
      <div className="mt-2">
        <StarInput value={rating} onChange={setRating} />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="What was the delivery like? (optional)"
        className="mt-2 w-full rounded-lg bg-black/30 px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-violet-500/40"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => submit.mutate()}
          disabled={submit.isPending || rating < 1}
          className="rounded-lg border border-violet-500/30 bg-violet-500/15 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/25 disabled:opacity-50"
        >
          {submit.isPending ? 'Submitting…' : 'Submit review'}
        </button>
        {submit.error && (
          <span className="text-[11px] text-amber-300">
            {(submit.error as Error).message || 'Could not submit.'}
          </span>
        )}
      </div>
    </div>
  );
}
