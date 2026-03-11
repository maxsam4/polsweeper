import { useState, useEffect, useRef } from 'react';
import { sweepAccount } from '../api/client';

interface SweepButtonProps {
  address: string;
  disabled: boolean;
}

type SweepState = 'idle' | 'loading' | 'success' | 'error';

export default function SweepButton({ address, disabled }: SweepButtonProps) {
  const [state, setState] = useState<SweepState>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function resetAfter(ms: number) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setState('idle'); setTxHash(null); }, ms);
  }

  async function handleSweep() {
    if (disabled || state === 'loading') return;
    setState('loading');
    setTxHash(null);
    try {
      const result = await sweepAccount(address);
      setState('success');
      if (result.txHash) {
        setTxHash(result.txHash);
        resetAfter(5000);
      } else {
        resetAfter(2000);
      }
    } catch {
      setState('error');
      resetAfter(2500);
    }
  }

  if (state === 'success' && txHash) {
    return (
      <a
        className="sweep-tx-link"
        href={`https://polygonscan.com/tx/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        View Tx
      </a>
    );
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
