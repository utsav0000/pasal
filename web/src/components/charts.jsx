import React, { useId, useMemo, useRef, useState } from 'react';

const COLORS = ['var(--accent)', 'var(--accent-2)', '#12C08A', '#F5A524', '#F0445F', '#D946EF'];
const niceMax = (v) => { if (v <= 5) return 5; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };
const shortDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Multi-series line/area chart with hover tooltip. data: [{x, ...series}] */
export function LineChart({ data, series, height = 240, area = true, xFormat = shortDate }) {
  const id = useId().replace(/:/g, '');
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 800, H = height, P = { l: 36, r: 12, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0))));
  const x = (i) => P.l + (i / Math.max(1, data.length - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - v / max) * (H - P.t - P.b);
  const paths = useMemo(() => series.map((s) => {
    const pts = data.map((d, i) => [x(i), y(d[s.key] || 0)]);
    let dPath = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; dPath += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
    return { d: dPath, area: `${dPath} L${pts[pts.length - 1][0]},${H - P.b} L${pts[0][0]},${H - P.b} Z` };
  }), [data, series, max]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data.length) return null;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const every = Math.ceil(data.length / 7);
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(data.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (data.length - 1))));
    setHover({ i, left: (x(i) / W) * r.width, top: (Math.min(...series.map((s) => y(data[i][s.key] || 0))) / H) * r.height });
  };
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" onMouseMove={onMove} role="img" aria-label={`Chart of ${series.map((s) => s.label).join(', ')}`}>
        <defs>{series.map((s, i) => <linearGradient key={i} id={`${id}a${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color || COLORS[i]} stopOpacity=".22" /><stop offset="1" stopColor={s.color || COLORS[i]} stopOpacity="0" /></linearGradient>)}</defs>
        {ticks.map((t) => <g key={t}><line className="grid-line" x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} /><text className="axis" x={P.l - 8} y={y(t) + 4} textAnchor="end">{t >= 1000 ? `${(t / 1000).toFixed(t >= 10000 ? 0 : 1)}k` : t}</text></g>)}
        {data.map((d, i) => (i % every === 0 || i === data.length - 1) && <text key={i} className="axis" x={x(i)} y={H - 6} textAnchor="middle">{xFormat(d.x)}</text>)}
        {area && paths.map((p, i) => <path key={`a${i}`} d={p.area} fill={`url(#${id}a${i})`} />)}
        {paths.map((p, i) => <path key={`l${i}`} className="line draw" d={p.d} stroke={series[i].color || COLORS[i]} style={{ '--len': 3000 }} vectorEffect="non-scaling-stroke" />)}
        {hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={P.t} y2={H - P.b} stroke="var(--border-2)" vectorEffect="non-scaling-stroke" />}
        {hover && series.map((s, i) => <circle key={i} cx={x(hover.i)} cy={y(data[hover.i][s.key] || 0)} r="4.5" fill="var(--surface)" stroke={s.color || COLORS[i]} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: hover.left, top: hover.top }}>
          <b>{xFormat(data[hover.i].x)}</b>
          {series.map((s, i) => <div key={s.key}><span style={{ color: s.color || COLORS[i] }}>●</span> {s.label}: <b>{(data[hover.i][s.key] || 0).toLocaleString('en-IN')}</b></div>)}
        </div>
      )}
    </div>
  );
}

export function Legend({ series }) {
  return <div className="chart-legend">{series.map((s, i) => <span key={s.key}><i style={{ background: s.color || COLORS[i] }} />{s.label}</span>)}</div>;
}

/** Horizontal bars for rankings. rows: [{label, value, sub}] */
export function BarList({ rows, format = (v) => v.toLocaleString('en-IN') }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="funnel">
      {rows.map((r, i) => (
        <div className="f" key={r.label} style={{ gridTemplateColumns: 'minmax(90px, 160px) 1fr 70px' }}>
          <span className="ellipsis small semibold">{r.label}</span>
          <span className="track" style={{ height: 22 }}><i style={{ width: `${(r.value / max) * 100}%`, animationDelay: `${i * 0.05}s` }} /></span>
          <span className="small muted" style={{ textAlign: 'right' }}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Donut({ parts, size = 150, label }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="row" style={{ '--gap': '20px' }}>
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={label}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="16" />
        {parts.map((p, i) => {
          const len = (p.value / total) * C;
          const el = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={p.color || COLORS[i]} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" strokeLinecap="butt" style={{ transition: 'stroke-dasharray .8s' }} />;
          off += len;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" fontSize="22" fontWeight="750" fill="var(--text)">{total.toLocaleString('en-IN')}</text>
        <text x="70" y="86" textAnchor="middle" fontSize="11" fill="var(--text-3)">{label}</text>
      </svg>
      <div className="stack" style={{ '--gap': '8px' }}>
        {parts.map((p, i) => <div key={p.label} className="row small" style={{ '--gap': '8px' }}><i style={{ width: 10, height: 10, borderRadius: 3, background: p.color || COLORS[i], display: 'inline-block' }} />{p.label}<b style={{ marginLeft: 'auto' }}>{Math.round((p.value / total) * 100)}%</b></div>)}
      </div>
    </div>
  );
}

export function Sparkline({ values, color = 'var(--accent)', w = 120, h = 36 }) {
  if (!values?.length) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ');
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
