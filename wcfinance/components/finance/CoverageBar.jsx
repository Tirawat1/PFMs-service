import { formatTHB } from '@/lib/money';

/**
 * Reimbursed-against-projected bar. `projected` and `reimbursed` are BigInt
 * satang. A department with no projection renders as an empty track, not 0%.
 */
export default function CoverageBar({ projected, reimbursed, showValues = true }) {
  const has = projected > 0n;
  const pct = has ? Math.min(100, Math.round((Number(reimbursed) / Number(projected)) * 100)) : 0;
  const tone = !has ? '#9aa8bd' : pct >= 100 ? '#0f9d6b' : pct >= 60 ? '#0e7490' : '#d18700';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 132 }}>
      <div style={{ flex: 1, height: 7, borderRadius: 6, background: 'rgba(15,42,74,.09)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 6, background: tone }} />
      </div>
      {showValues && (
        <span style={{ fontSize: 12.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>
          {has ? `${pct}%` : '—'}
        </span>
      )}
      {showValues && has && (
        <span style={{ fontSize: 11, color: '#6b7a90' }}>
          {formatTHB(reimbursed)} / {formatTHB(projected)}
        </span>
      )}
    </div>
  );
}
