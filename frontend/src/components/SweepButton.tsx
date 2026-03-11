import { useState } from 'react';
import { sweepAccount } from '../api/client';

interface SweepButtonProps {
  address: string;
  disabled: boolean;
}

type SweepState = 'idle' | 'loading' | 'success' | 'error';

export default function SweepButton({ address, disabled }: SweepButtonProps) {
  const [state, setState] = useState<SweepState>('idle');

  async function handleSweep() {
    if (disabled || state === 'loading') return;
    setState('loading');
    try {
      await sweepAccount(address);
      setState('success');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2500);
    }
  }

  const label = {
    idle: 'Sweep',
    loading: '',
    success: '\u2713',
    error: 'Failed',
  }[state];

  const extraClass = state === 'success' ? ' btn--success' : '';

  return (
    <button
      type="button"
      className={`btn btn--sweep${extraClass}`}
      disabled={disabled || state === 'loading'}
      onClick={handleSweep}
    >
      {state === 'loading' ? <span className="spinner" /> : label}
    </button>
  );
}
