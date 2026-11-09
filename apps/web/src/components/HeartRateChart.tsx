// Courbe de fréquence cardiaque (médical). SVG simple, sans bibliothèque de graphiques.

import type { MeasurementPointView } from '@project/shared-types';
import { chronological } from '../model/alerts';
import { formatWhen } from '../model/labels';

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

export function HeartRateChart({ points }: { points: readonly MeasurementPointView[] }) {
  if (points.length === 0) return <p className="muted">Aucune mesure sur les dernières 24 heures.</p>;
  const data = chronological(points);
  const first = data[0]!;
  const last = data[data.length - 1]!;
  const values = data.map((p) => p.value);
  const min = Math.min(40, ...values);
  const max = Math.max(120, ...values);
  const t0 = new Date(first.timestamp).getTime();
  const t1 = Math.max(new Date(last.timestamp).getTime(), t0 + 60_000);
  const x = (iso: string) => PAD.left + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
  const path = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.timestamp).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Fréquence cardiaque : ${data.length} mesures, dernière ${last.value} bpm`}>
        {[60, 100].map((v) => (
          <g key={v}>
            <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="chart-label" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <path className="chart-line" d={path} />
        {data.map((p) => (
          <circle key={p.timestamp} className="chart-dot" cx={x(p.timestamp)} cy={y(p.value)} r={3}>
            <title>{`${p.value} bpm à ${formatWhen(p.timestamp)}`}</title>
          </circle>
        ))}
        <text className="chart-label" x={PAD.left} y={H - 6}>
          {formatWhen(first.timestamp)}
        </text>
        <text className="chart-label" x={W - PAD.right} y={H - 6} textAnchor="end">
          {formatWhen(last.timestamp)}
        </text>
      </svg>
      <figcaption className="muted">
        bpm · dernière mesure {last.value} bpm · zone habituelle 60 à 100 bpm
      </figcaption>
    </figure>
  );
}
