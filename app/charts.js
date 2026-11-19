// Small hand-rolled SVG charts plus the shared hover tooltip.
(function (root) {
  'use strict';

  const tipEl = () => document.getElementById('tip');

  function showTip(html, x, y) {
    const t = tipEl();
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    t.style.left = `${Math.max(8, left)}px`;
    t.style.top = `${Math.max(8, top)}px`;
  }

  function hideTip() {
    tipEl().hidden = true;
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  const tidy = (v) => Number(v.toFixed(6));
  const ticksOf = (min, max, step) => {
    const out = [];
    for (let i = 0; min + i * step <= max + step * 1e-6; i++) out.push(tidy(min + i * step));
    return out;
  };

  /**
   * "Full" Y range: from zero (or the lowest value, if negative) up to the max
   * and every reference line, with 8% headroom. The chart's original behavior.
   */
  function fullRange(values, refs = []) {
    const vals = values.concat(refs);
    const maxV = Math.max(1, ...vals);
    const minV = Math.min(0, ...vals);
    const step = niceStep((maxV - minV) / 4);
    const max = tidy(Math.ceil((maxV * 1.08) / step) * step);
    const min = tidy(Math.floor(minV / step) * step);
    return { min, max, step, ticks: ticksOf(min, max, step) };
  }

  /**
   * "Fit" Y range: zoomed to every value shown, with nothing left off. The
   * bottom is the lowest value rounded down to a multiple of 5. The top is the
   * next multiple of 5 above the best, plus 5 of headroom (best 92 → 100, best
   * 95 → 105), so the best always has more than 5 points of room above it.
   * Ticks fall every 5 when the span is 40 or less, otherwise every 10, and
   * land on both ends: when a span of 10s comes out 5 over, the bottom drops
   * another 5 (the top rises instead when the bottom would go under zero).
   * One game, or several equal ones, still gets a span of 10, and it never
   * dips below zero when nothing is negative. Reference lines (the goal) never
   * stretch it; refIn flags, one per ref, which of them fall inside.
   * Returns { min, max, step, ticks, refIn }.
   */
  function fitRange(values, { refs = [] } = {}) {
    const U = 5;
    let lowest = Infinity;
    let best = -Infinity;
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < lowest) lowest = v;
      if (v > best) best = v;
    }
    if (best === -Infinity) return { ...fullRange([], []), refIn: refs.map(() => false) };
    let min = Math.floor(lowest / U) * U;
    let max = (Math.floor(best / U) + 2) * U;
    const step = max - min <= 40 ? 5 : 10;
    if ((max - min) % step) {
      if (min - U >= 0 || lowest < 0) min -= U;
      else max += U;
    }
    min = tidy(min);
    max = tidy(max);
    const refIn = refs.map((r) => Number.isFinite(r) && r >= min && r <= max);
    return { min, max, step, ticks: ticksOf(min, max, step), refIn };
  }

  function xTickIndices(n, max = 7) {
    if (n <= max) return [...Array(n).keys()];
    const step = Math.ceil((n - 1) / (max - 1));
    const out = [];
    for (let i = 0; i < n - 1; i += step) out.push(i);
    if (n - 1 - out[out.length - 1] < step / 2) out.pop();
    out.push(n - 1);
    return out;
  }

  /**
   * One-series line chart. pts: [{ value, label }]; tipHtml(pt) builds the
   * hover text. The last point and the best point get direct labels. Values
   * may go below zero (net scores); `ref` draws one labeled reference line.
   * scale: 'full' (default) runs the Y axis from zero; 'fit' zooms it to the
   * values (see fitRange), every one of them in view, and draws a reference
   * line out of view as a note at the edge it's beyond. Tick labels thin out
   * (from the top) only if they'd crowd; every tick keeps its gridline.
   */
  function lineChart(el, pts, { height = 230, tipHtml, xLabel = (p) => p.label, ref = null, scale = 'full', label = 'Score per game' } = {}) {
    const refs = ref ? [].concat(ref) : [];
    const fit = scale === 'fit';
    const w = Math.max(320, el.clientWidth);
    const h = height;
    const m = { l: 40, r: 44, t: 22, b: 28 };
    const iw = w - m.l - m.r;
    const ih = h - m.t - m.b;
    const values = pts.map((p) => p.value);
    const range = fit ? fitRange(values, { refs: refs.map((r) => r.value) }) : fullRange(values, refs.map((r) => r.value));
    const { min: yMin, max: yMax } = range;
    const x = (i) => (pts.length === 1 ? m.l + iw / 2 : m.l + (i / (pts.length - 1)) * iw);
    const y = (v) => m.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
    const bottom = y(yMin);
    const tickText = (v) => (v < 0 ? `−${-v}` : String(v));
    const zeroIn = yMin <= 0 && yMax >= 0;
    const axisV = zeroIn ? 0 : yMin;
    const nt = range.ticks.length;
    const labelEvery = nt > 1 ? Math.max(1, Math.ceil(16 / (ih / (nt - 1)))) : 1;

    let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}${fit ? ', zoomed to fit' : ''}" data-scale="${fit ? 'fit' : 'full'}">`;
    range.ticks.forEach((v, i) => {
      if (v !== axisV) s += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      if ((nt - 1 - i) % labelEvery === 0) s += `<text class="tick" x="${m.l - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${tickText(v)}</text>`;
    });
    s += `<line class="axis" x1="${m.l}" x2="${w - m.r}" y1="${y(axisV)}" y2="${y(axisV)}"/>`;
    for (const r of refs) {
      if (r.value >= yMin && r.value <= yMax) {
        s += `<line class="ref${r.goal ? ' goal' : ''}" x1="${m.l}" x2="${w - m.r}" y1="${y(r.value)}" y2="${y(r.value)}"/>`;
        s += `<text class="ref-label" x="${m.l + 6}" y="${y(r.value) - 6}">${r.label}</text>`;
      } else {
        // Out of a fitted view: say where it is instead of stretching the axis.
        const up = r.value > yMax;
        s += `<text class="ref-label off${r.goal ? ' goal' : ''}" x="${m.l + 6}" y="${up ? m.t - 8 : bottom - 6}">${r.label} ${up ? '↑' : '↓'}</text>`;
      }
    }
    for (const i of xTickIndices(pts.length)) {
      s += `<text class="tick" x="${x(i)}" y="${h - 6}" text-anchor="middle">${xLabel(pts[i])}</text>`;
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    s += `<path class="line" d="${d}"/>`;
    if (pts.length <= 45) {
      pts.forEach((p, i) => { s += `<circle class="dot" cx="${x(i)}" cy="${y(p.value)}" r="4"/>`; });
    }
    const last = pts.length - 1;
    let best = 0;
    pts.forEach((p, i) => { if (p.value > pts[best].value) best = i; });
    s += `<text class="end-label" x="${x(last) + 10}" y="${y(pts[last].value)}" dominant-baseline="middle">${tickText(pts[last].value)}</text>`;
    if (best !== last && pts.length > 1) {
      s += `<text class="note-label" x="${x(best)}" y="${y(pts[best].value) - 12}" text-anchor="middle">best ${tickText(pts[best].value)}</text>`;
    }
    s += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${bottom}" visibility="hidden"/>`;
    s += `<circle class="hover-dot" r="5" cx="0" cy="0" visibility="hidden"/>`;
    s += `<rect class="hit" x="${m.l - 12}" y="${m.t - 10}" width="${iw + 24}" height="${ih + 10}" fill="transparent"/>`;
    s += '</svg>';
    el.innerHTML = s;

    const svg = el.querySelector('svg');
    const cross = svg.querySelector('.crosshair');
    const dot = svg.querySelector('.hover-dot');
    const hit = svg.querySelector('.hit');
    hit.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const i = pts.length === 1 ? 0 : Math.max(0, Math.min(last, Math.round(((mx - m.l) / iw) * last)));
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i));
      dot.setAttribute('cy', y(pts[i].value));
      dot.setAttribute('visibility', 'visible');
      if (tipHtml) showTip(tipHtml(pts[i]), e.clientX, e.clientY);
    });
    hit.addEventListener('mouseleave', () => {
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      hideTip();
    });
  }

  /**
   * A small trend line. With `tips` (one string per value), hovering shows a dot
   * for every value and each dot's tip; each value gets a full-height hover strip
   * so the dots are easy to hit.
   */
  function sparkline(el, values, { width = 300, height = 46, tips = null } = {}) {
    if (values.length < 2) {
      // One value has no line; with tips it's still a dot you can hover.
      el.innerHTML = tips && values.length
        ? `<span class="spark-pt single" data-tip="${String(tips[0]).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="left:0;width:100%"><i style="top:${height / 2 - 3}px"></i></span>`
        : '';
      el.style.position = 'relative';
      return;
    }
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = 5;
    const x = (i) => pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = (v) => (hi === lo ? height / 2 : pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2));
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const li = values.length - 1;
    el.innerHTML = `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
    // End dot drawn as HTML so preserveAspectRatio="none" can't squash it.
    const dotEl = document.createElement('span');
    dotEl.style.cssText = `position:absolute;width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 2px var(--surface);left:calc(${(x(li) / width) * 100}% - 4px);top:${y(values[li]) - 4}px;pointer-events:none`;
    el.style.position = 'relative';
    if (tips) {
      const step = (width - pad * 2) / li;
      el.classList.add('has-points');
      el.insertAdjacentHTML('beforeend', values.map((v, i) => {
        const left = ((x(i) - step / 2) / width) * 100;
        return `<span class="spark-pt" data-tip="${String(tips[i]).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="left:${left}%;width:${(step / width) * 100}%">`
          + `<i style="top:${y(v) - 3}px"></i></span>`;
      }).join(''));
    }
    el.appendChild(dotEl);
  }

  // Sequential blue, 100 → 700 (light). Dark mode runs it the other way so
  // "near zero" recedes into the dark surface and big values glow.
  const BLUES = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
    '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

  function heatColor(t, dark) {
    const n = BLUES.length - 1;
    const idx = Math.max(0, Math.min(n, Math.round(t * n)));
    const step = dark ? n - idx : idx;
    return { bg: BLUES[step], fg: step >= 7 ? '#ffffff' : '#0b0b0b' };
  }

  function rampGradient(dark) {
    const stops = dark ? BLUES.slice().reverse() : BLUES;
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  root.Charts = { lineChart, sparkline, showTip, hideTip, heatColor, rampGradient, fullRange, fitRange };
})(this);
