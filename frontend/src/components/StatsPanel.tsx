import { useState, useEffect, useCallback } from 'react';
import { getStats, type StatsResponse, type SweepEventResponse } from '../api/client';

function truncateAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function truncateHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}...${hash.slice(-4)}` : hash;
}

export default function StatsPanel() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="address-input__loading">
        <span className="spinner spinner--dark" />
      </div>
    );
  }

  if (error) {
    return <p className="error-msg">{error}</p>;
  }

  if (!stats) return null;

  return (
    <>
      <div className="stats-header">
        <p className="stats-header__title">System Overview</p>
        <button className="btn btn--ghost btn--small" onClick={fetchStats}>
          Refresh
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card__value">{stats.totalAccounts}</div>
          <div className="stat-card__label">Total Accounts</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">{stats.uniqueMasters}</div>
          <div className="stat-card__label">Unique Masters</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">{stats.deployedAccounts}</div>
          <div className="stat-card__label">Deployed</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">{stats.totalSweeps}</div>
          <div className="stat-card__label">Total Sweeps</div>
        </div>
      </div>

      <div className="recent-sweeps">
        <p className="recent-sweeps__title">Recent Sweeps</p>
        {stats.recentSweeps.length === 0 ? (
          <p className="recent-sweeps__empty">No sweeps recorded yet</p>
        ) : (
          stats.recentSweeps.map((sweep: SweepEventResponse) => (
            <div key={sweep.id} className="sweep-row">
              <span className="sweep-row__account">
                {truncateAddress(sweep.account_address)}
              </span>
              <span className="sweep-row__tokens">
                {sweep.tokens_swept.length} token{sweep.tokens_swept.length !== 1 ? 's' : ''}
              </span>
              <a
                className="sweep-row__tx"
                href={`https://polygonscan.com/tx/${sweep.tx_hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {truncateHash(sweep.tx_hash)}
              </a>
            </div>
          ))
        )}
      </div>
    </>
  );
}
