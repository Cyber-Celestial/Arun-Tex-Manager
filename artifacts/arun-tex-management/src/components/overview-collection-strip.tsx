import './overview-collection-strip.css';

type Amounts = { cash: number; upi: number; card: number };

const parts = [
  { key: 'cash', label: 'Cash', tone: 'strip-cash' },
  { key: 'upi', label: 'UPI', tone: 'strip-upi' },
  { key: 'card', label: 'Card', tone: 'strip-card' },
] as const;

export function OverviewCollectionStrip({ amounts, format }: { amounts: Amounts; format: (n: number) => string }) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, amounts[part.key]), 0);
  return <div className="collection-strip" aria-label="Collection by payment mode">
    <span className="collection-strip-title">COLLECTED BY MODE</span>
    <div className="collection-strip-bar" aria-hidden="true">
      {parts.map(part => <i key={part.key} className={part.tone}
        style={{ width: `${total ? Math.max(0, amounts[part.key]) / total * 100 : 0}%` }}/>)}
    </div>
    <div className="collection-strip-legend">
      {parts.map(part => <span key={part.key}><i className={part.tone}/>{part.label}<strong className="mono">{format(amounts[part.key])}</strong></span>)}
    </div>
  </div>;
}
