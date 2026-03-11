import { useState } from 'react';
import { Account } from '../types';
import SweepButton from './SweepButton';

interface AccountCardProps {
  account: Account;
  animationDelay: number;
}

function formatBalance(raw: string, decimals = 18): string {
  const wei = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = wei / divisor;
  const fractional = wei % divisor;
  const fracStr = fractional.toString().padStart(decimals, '0').slice(0, 4);
  return `${whole.toLocaleString()}.${fracStr}`;
}

function truncateToken(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function AccountCard({ account, animationDelay }: AccountCardProps) {
  const [copied, setCopied] = useState(false);

  const hasBalances = account.balances && account.balances.length > 0;

  function handleCopy() {
    try {
      // Try modern API first
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(account.address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    } catch {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    const textarea = document.createElement('textarea');
    textarea.value = account.address;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <article
      className="account-card"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="account-card__header">
        <span className="account-card__index">#{account.index}</span>

        <div className="account-card__address-row">
          <a
            className="account-card__address"
            href={`https://polygonscan.com/address/${account.address}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {account.address}
          </a>
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
                {b.symbol ?? truncateToken(b.contractAddress)}
              </span>
              <span className="balance-row__amount">
                {formatBalance(b.balance, b.decimals ?? 18)}
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
