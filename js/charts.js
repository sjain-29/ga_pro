/** Chart.js wrapper: theme-aware colours, in-place updates, click-to-filter, graceful fallback. */
import { moneyShort, money } from './format.js';

export const PALETTE = ['#101D35', '#C62828', '#2563EB', '#16A34A', '#F59E0B', '#0D9488', '#7C3AED', '#64748B', '#DB2777', '#CA8A04'];
export const STATUS_COLORS = {
  Pending: '#C62828', Partial: '#F59E0B', Complete: '#16A34A', Overpaid: '#7C3AED', 'Amount Not Confirmed': '#94A3B8',
  'Settled with Deductions': '#0D9488', 'Closed by Deductions': '#14B8A6', 'Excess / Reconciliation Required': '#7C3AED', 'Not Configured': '#94A3B8',
  'Not Started': '#94A3B8', 'In Progress': '#2563EB', 'On Hold': '#F59E0B', Completed: '#16A34A', Cancelled: '#64748B',
};

const dark = () => document.documentElement.dataset.theme === 'dark';
const themed = () => ({ text: dark() ? '#A9B4CA' : '#475569', grid: dark() ? 'rgba(255,255,255,.07)' : 'rgba(15,23,42,.06)', navy: dark() ? '#8FA6D6' : '#101D35' });

/**
 * Render or update a chart inside `host` (a div).
 * spec: { type, labels, datasets:[{label,data,color?,colors?}], money?:bool, stacked?, horizontal?, onClick?(label, datasetIndex) }
 */
export function renderChart(host, spec) {
  if (!host) return null;
  if (!window.Chart) {
    host.innerHTML = '<div class="chart-fallback">Charts need an internet connection to load Chart.js.<br>Figures are still shown in the cards and reports.</div>';
    return null;
  }
  const t = themed();
  const isPie = spec.type === 'doughnut' || spec.type === 'pie';
  const fmt = (v) => (spec.money ? moneyShort(v) : (Number.isInteger(v) ? v : v?.toFixed?.(1)));
  const datasets = spec.datasets.map((d, i) => {
    const base = PALETTE[i % PALETTE.length];
    const c = d.colors || (isPie ? spec.labels.map((l, j) => STATUS_COLORS[l] || PALETTE[j % PALETTE.length]) : (d.color || (i === 0 ? t.navy : base)));
    return {
      label: d.label, data: d.data, backgroundColor: c, borderColor: spec.type === 'line' ? c : (isPie ? (dark() ? '#121C31' : '#fff') : c),
      borderWidth: isPie ? 2 : spec.type === 'line' ? 2.5 : 0, borderRadius: spec.type === 'bar' ? 6 : 0, maxBarThickness: 38,
      tension: 0.35, fill: false, pointRadius: spec.type === 'line' ? 3 : 0, pointHoverRadius: 6, ...(d.extra || {}),
    };
  });
  const config = {
    type: spec.type,
    data: { labels: spec.labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      indexAxis: spec.horizontal ? 'y' : 'x',
      cutout: spec.type === 'doughnut' ? '64%' : undefined,
      interaction: { mode: isPie ? 'nearest' : 'index', intersect: isPie },
      plugins: {
        legend: { display: isPie || datasets.length > 1, position: isPie ? 'right' : 'top', labels: { color: t.text, usePointStyle: true, boxWidth: 8, padding: 14, font: { family: 'Inter', size: 12 } } },
        tooltip: {
          backgroundColor: '#101D35', padding: 10, cornerRadius: 8, titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' },
          callbacks: { label: (ctx) => {
            const v = isPie ? ctx.parsed : (spec.horizontal ? ctx.parsed.x : ctx.parsed.y);
            return ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : (isPie ? ctx.label + ': ' : '')}${spec.money ? money(v) : v}`;
          } },
        },
      },
      scales: isPie ? {} : {
        x: { stacked: !!spec.stacked, grid: { display: !!spec.horizontal, color: t.grid }, ticks: { color: t.text, font: { family: 'Inter', size: 11 }, callback: spec.horizontal ? (v) => fmt(v) : undefined } },
        y: { stacked: !!spec.stacked, grid: { color: t.grid, display: !spec.horizontal }, ticks: { color: t.text, font: { family: 'Inter', size: 11 }, callback: spec.horizontal ? undefined : function (v) { return fmt(v); } }, beginAtZero: true },
      },
      onClick: (evt, els, chart) => {
        if (!spec.onClick) return;
        const hit = els[0] || chart.getElementsAtEventForMode(evt, isPie ? 'nearest' : 'index', { intersect: isPie }, false)[0];
        if (hit) spec.onClick(spec.labels[hit.index], hit.datasetIndex);
      },
      onHover: (evt, els) => { if (spec.onClick && evt.native?.target) evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    },
  };
  const existing = host._chart;
  if (existing && existing.config.type === spec.type && host._sig === signature(spec) && host.isConnected && existing.canvas.isConnected) {
    existing.data.labels = config.data.labels;
    existing.data.datasets.forEach((ds, i) => { if (datasets[i]) { ds.data = datasets[i].data; ds.backgroundColor = datasets[i].backgroundColor; } });
    existing.update('none');
    return existing;
  }
  if (existing) existing.destroy();
  host.innerHTML = '<canvas></canvas>';
  host._sig = signature(spec);
  host._chart = new window.Chart(host.querySelector('canvas'), config);
  return host._chart;
}
const signature = (s) => `${s.type}|${s.datasets.length}|${dark()}|${s.horizontal}|${s.stacked}`;

export function destroyCharts(root) {
  root?.querySelectorAll?.('[data-chart]').forEach((h) => { h._chart?.destroy(); h._chart = null; });
}
