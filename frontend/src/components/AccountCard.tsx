import { useState } from 'react';
import { Account } from '../types';
import SweepButton from './SweepButton';

interface AccountCardProps {
  account: Account;
  animationDelay: number;
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatBalance(raw: string): string {
  const wei = BigInt(raw);
  const whole = wei / BigInt(10 ** 18);
  const fractional = wei % BigInt(10 ** 18);
  const fracStr = fractional.toString().padStart(18, '0').slice(0, 4);
  return `${whole.toLocaleString()}.${fracStr}`;
}

function truncateToken(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function AccountCard({ account, animationDelay }: AccountCardProps) {
  const [copied, setCopied] = useState(false);

  const hasBalances = account.balances && account.balances.length > 0;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(account.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may fail in non-secure contexts
    }
  }

  return (
    <article
      className="account-card"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="account-card__header">
        <span className="account-card__index">#{account.index}</span>

        <div className="account-card__address-row">
          <span className="account-card__address">
            {account.address}
          </span>
          <button
            type="button"
            className={`account-card__copy-btn${copied ? ' account-card__copy-btn--copied' : ''}`}
            onClick={handleCopy}
            title="Copy address"
            aria-label="Copy address"
          >
            {copied ? '✓' : 'Copy'}
          </button>
        </div>

        <span
          className={`account-card__status ${
            account.deployed
              ? 'account-card__status--deployed'
              : 'account-card__status--pending'
          }`}
        >
          {account.deployed ? 'Deployed' : 'Pending'}
        </span>
      </div>

      {/* Balances */}
      <div className="account-card__balances">
        <p className="account-card__balances-title">Balances</p>
        {hasBalances ? (
          account.balances.map((b) => (
            <div key={b.contractAddress} className="balance-row">
              <span className="balance-row__token" title={b.contractAddress}>
                {truncateToken(b.contractAddress)}
              </span>
              <span className="balance-row__amount">
                {formatBalance(b.balance)}
              </span>
            </div>
          ))
        ) : (
          <p className="account-card__no-balances">No token balances</p>
        )}
      </div>

      {/* Footer with sweep */}
      <div className="account-card__footer">
        <SweepButton address={account.address} disabled={!hasBalances} />
      </div>
    </article>
  );
}
