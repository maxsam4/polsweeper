import { useState } from 'react';

interface CreatePanelProps {
  currentCount: number;
  maxCount: number;
  loading: boolean;
  onCreate: (count: number) => void;
}

export default function CreatePanel({
  currentCount,
  maxCount,
  loading,
  onCreate,
}: CreatePanelProps) {
  const remaining = maxCount - currentCount;
  const atLimit = remaining <= 0;

  const availableCounts = Array.from(
    { length: Math.min(remaining, 5) },
    (_, i) => i + 1,
  );
  const [selected, setSelected] = useState(1);

  // Clamp selected if remaining shrinks
  const clampedSelected = Math.min(selected, remaining);

  function handleCreate() {
    if (!atLimit && !loading) {
      onCreate(clampedSelected);
    }
  }

  return (
    <div className="create-panel">
      <div className="create-panel__row">
        <span className="create-panel__usage">
          <strong>{currentCount}</strong> of {maxCount} accounts used
        </span>

        {!atLimit && (
          <div className="create-panel__controls">
            <div className="create-panel__count-btns">
              {availableCounts.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`count-btn${n === clampedSelected ? ' count-btn--active' : ''}`}
                  onClick={() => setSelected(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn--primary btn--small"
              disabled={loading}
              onClick={handleCreate}
            >
              {loading ? <span className="spinner" /> : 'Create'}
            </button>
          </div>
        )}
      </div>

      {atLimit && (
        <p className="create-panel__limit-msg">
          Account limit reached. Contact Polygon Labs for additional capacity.
        </p>
      )}
    </div>
  );
}
