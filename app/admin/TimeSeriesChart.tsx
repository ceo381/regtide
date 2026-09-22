"use client";
import { useId, useMemo, useState } from "react";

/**
 * 시계열 선 그래프 (외부 라이브러리 없음, 인라인 SVG)
 *  - x: 날짜(KST), y: 건수. 모든 시리즈가 같은 단위(건수)일 때만 한 축에 올린다
 *  - 마우스를 올리면 세로 기준선 + 그 날짜의 모든 값 툴팁
 *  - 범례 항상 표시, 선 끝에 이름 직접 표기, 표(기존 일별 표)가 접근성 대체 수단
 */
export interface Series { key: string; label: string; color: string; values: number[]; dashed?: boolean }

const PAD = { top: 16, right: 124, bottom: 28, left: 36 };

export default function TimeSeriesChart({ title, sub, days, series, height = 220 }: { title: string; sub?: string; days: string[]; series: Series[]; height?: number }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;
  const w = width - PAD.left - PAD.right, h = height - PAD.top - PAD.bottom;
  const n = days.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const yTicks = useMemo(() => niceTicks(max), [max]);
  const yMax = yTicks[yTicks.length - 1];
  const x = (i: number) => PAD.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => PAD.top + h - (v / yMax) * h;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  // 선 끝 이름표가 겹치지 않게 y 위치를 최소 14px 간격으로 벌린다
  const endLabels = useMemo(() => {
    const items = series.map((s) => ({ s, y: y(s.values[n - 1] ?? 0) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, n, yMax]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - PAD.left) / w) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="ts-chart">
      <div className="ts-head">
        <div>
          <h3>{title}</h3>
          {sub && <p className="sub" style={{ margin: 0 }}>{sub}</p>}
        </div>
        <ul className="ts-legend" aria-label="범례">
          {series.map((s) => <li key={s.key}><span className="sw" style={{ background: s.color, ...(s.dashed ? { backgroundImage: `repeating-linear-gradient(90deg,${s.color} 0 4px,transparent 4px 7px)`, background: "none" } : {}) }} />{s.label}</li>)}
        </ul>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-t`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ width: "100%", height: "auto", display: "block" }}>
        <title id={`${id}-t`}>{title}</title>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + w} y1={y(t)} y2={y(t)} stroke="#eaecf0" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#667085">{t}</text>
          </g>
        ))}
        {days.map((d, i) => (i % 2 === (n - 1) % 2 ? <text key={d} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="#667085">{d.slice(5)}</text> : null))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + h} stroke="#98a2b3" strokeWidth={1} strokeDasharray="3 3" />}
        {series.map((s) => (
          <g key={s.key}>
            <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
            {s.values.map((v, i) => (v > 0 || i === hover) && (
              <circle key={i} cx={x(i)} cy={y(v)} r={i === hover ? 5 : 3} fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        ))}
        {endLabels.map(({ s, y: ly }) => (
          <text key={s.key} x={PAD.left + w + 8} y={ly + 4} fontSize={11.5} fill="#344054" fontWeight={600}>{s.label}</text>
        ))}
        {hover != null && (() => {
          const rows = series.map((s) => ({ label: s.label, v: s.values[hover] ?? 0, color: s.color }));
          const bw = 150, bh = 20 + rows.length * 16;
          const bx = x(hover) + 12 + bw > PAD.left + w ? x(hover) - 12 - bw : x(hover) + 12;
          return (
            <g pointerEvents="none">
              <rect x={bx} y={PAD.top} width={bw} height={bh} rx={6} fill="#101828" opacity={0.92} />
              <text x={bx + 10} y={PAD.top + 14} fontSize={11} fill="#d0d5dd">{days[hover]}</text>
              {rows.map((r, k) => (
                <g key={k}>
                  <circle cx={bx + 14} cy={PAD.top + 28 + k * 16} r={4} fill={r.color} />
                  <text x={bx + 24} y={PAD.top + 32 + k * 16} fontSize={11.5} fill="#fff">{r.label} {r.v}</text>
                </g>
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

function niceTicks(max: number): number[] {
  // 건수 데이터이므로 눈금은 정수 단위 이상
  const raw = Math.max(1, max / 4);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10);
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top; v += step) out.push(v);
  return out;
}
