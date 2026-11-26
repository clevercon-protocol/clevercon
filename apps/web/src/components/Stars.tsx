import { useState } from 'react';
import { Star } from 'lucide-react';

/** Read-only star rating (supports halves), e.g. an average rating display. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <span className="inline-flex items-center" aria-label={`${value.toFixed(1)} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i < full;
        const isHalf = i === full && half;
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star size={size} className="absolute inset-0 text-slate-600" />
            {(filled || isHalf) && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: isHalf ? size / 2 : size }}
              >
                <Star size={size} className="text-amber-300" fill="currentColor" />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Interactive 1-5 star picker for leaving a review. */
export function StarInput({
  value,
  onChange,
  size = 22,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="inline-flex items-center gap-0.5" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className="p-0.5 text-slate-600 transition-colors hover:scale-110"
        >
          <Star
            size={size}
            className={n <= shown ? 'text-amber-300' : 'text-slate-600'}
            fill={n <= shown ? 'currentColor' : 'none'}
          />
        </button>
      ))}
    </div>
  );
}
