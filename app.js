/* The AI sell-off: S&P 500 drawdowns from record closes since 1950.
   Renders window.CRASH (written by fetch_data.py) as a line chart of percent
   below record vs trading days since the record, plus KPIs and tables. */
"use strict";

const NS = "http://www.w3.org/2000/svg";
const D = window.CRASH;
const M = D.meta;
const EPS = D.episodes;
const MINUS = "\u2212";

const COLORS = {
  "1973 oil shock": "var(--c-1973)",
  "1987 crash": "var(--c-1987)",
  "Dot-com": "var(--c-dotcom)",
  "2008 crisis": "var(--c-2008)",
  "Covid": "var(--c-covid)",
  "2022": "var(--c-2022)",
  "April 2025": "var(--c-apr25)",
  "AI sell-off": "var(--accent)",
};
const colorOf = (ep) => COLORS[ep.name] || "var(--c-other)";
const isFeatured = (ep) => Object.prototype.hasOwnProperty.call(COLORS, ep.name);
const ongoing = EPS.find((e) => e.ongoing) || null;

/* ---------- formatting ---------- */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const MONTHS_S = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDM(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_S[m - 1]}` + (y !== new Date().getFullYear() ? ` ${y}` : "");
}
function fmtDMY(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_S[m - 1]} ${y}`;
}
function monthName(iso) {
  return MONTHS[Number(iso.split("-")[1]) - 1];
}
function pct(v, dec = 1) {
  const r = Math.round(Math.abs(v) * 10 ** dec) / 10 ** dec;
  if (r === 0) return "0%";
  return (v < 0 ? MINUS : "") + r.toFixed(dec).replace(/\.0+$/, "") + "%";
}
function el(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- masthead ---------- */
document.getElementById("asOf").textContent = `As of ${M.asOfWeekday}`;
document.getElementById("stamp").textContent =
  `Fetched ${M.builtOn}.`;
document.getElementById("recDate").textContent = fmtDMY(M.recordDate);
document.getElementById("chartStamp").textContent = `Daily closes to ${fmtDMY(M.asOfDate)}.`;

function buildLead() {
  if (!ongoing) {
    return `The S&P 500 closed at a record on ${fmtDMY(M.recordDate)}; no slide is running. ` +
      `Since 1950, ${M.slidesTo6} slides reached 6% and ${M.slidesPast15} went past 15%.`;
  }
  const wd = M.worstDay || {};
  const sinceTxt = wd.worstSince
    ? ` since ${monthName(wd.worstSince.date).split(" ")[0]} ${wd.worstSince.date.slice(0, 4)}` : "";
  const known = EPS.filter((e) => isFeatured(e) && !e.ongoing).map((e) => Math.round(Math.abs(e.depthPct)));
  const s1 = wd.pct != null
    ? `${wd.weekday}'s ${pct(Math.abs(wd.pct))} fall was the S&P 500's worst day${sinceTxt}. ` : "";
  const s2 = `The index last closed ${pct(Math.abs(M.pctBelowRecord))} below its ${fmtDM(M.recordDate)} record ` +
    `after ${M.daysSinceRecord} trading days, ${pct(Math.abs(ongoing.depthPct))} deep at its worst so far. `;
  const s3 = known.length
    ? `Since 1950, ${M.slidesTo6} slides reached 6% and ${M.slidesPast15} went past 15%; ` +
      `the best-known falls went ${Math.min(...known)}% to ${Math.max(...known)}% deep. `
    : `Since 1950, ${M.slidesTo6} slides reached 6% and ${M.slidesPast15} went past 15%. `;
  const s4 = `The tech-heavy Nasdaq is ${pct(Math.abs(M.ixic.pctBelowRecord))} off its ${monthName(M.ixic.recordDate)} high ` +
    `and US chip stocks ${pct(Math.abs(M.sox.pctBelowRecord))} off their ${monthName(M.sox.recordDate)} high.`;
  return s1 + s2 + s3 + s4;
}
document.getElementById("lead").textContent = buildLead();

function buildKpis() {
  const host = document.getElementById("kpis");
  const wd = M.worstDay;
  const items = [
    { label: "Below record", cls: "down",
      v: pct(M.pctBelowRecord, 0), sub: `from its ${fmtDM(M.recordDate)} close` },
  ];
  if (wd) {
    items.push({ label: `${wd.weekday} ${fmtDM(wd.date)}`, cls: "down",
      v: pct(wd.pct, 1), sub: `worst day since ${wd.worstSince ? monthName(wd.worstSince.date) + " " + wd.worstSince.date.slice(0, 4) : "\u2014"}` });
  }
  items.push({ label: "Trading days since record", v: String(M.daysSinceRecord),
    sub: `since ${fmtDMY(M.recordDate)}` });
  items.push({ label: "Slides that went past 15%", cls: "accent",
    v: `${M.slidesPast15} of ${M.slidesTo6}`, sub: "slides since 1950 that reached 6%" });
  for (const it of items) {
    const wrap = document.createElement("div");
    wrap.className = "kpi" + (it.cls ? " " + it.cls : "");
    const dt = document.createElement("dt");
    dt.textContent = it.label;
    const dd = document.createElement("dd");
    dd.textContent = it.v;
    const sm = document.createElement("small");
    sm.textContent = it.sub;
    dd.appendChild(sm);
    wrap.append(dt, dd);
    host.appendChild(wrap);
  }
}
buildKpis();

/* ---------- state ---------- */
const featured = EPS.filter(isFeatured);
const state = {
  preset: "best",
  visible: new Set(featured.map((e) => e.recordDate)),
  horizon: 250,
};

function applyPreset(id) {
  state.preset = id;
  if (id === "best") state.visible = new Set(featured.map((e) => e.recordDate));
  else if (id === "past15") state.visible = new Set(EPS.filter((e) => e.depthPct <= -15).map((e) => e.recordDate));
  else state.visible = new Set(EPS.map((e) => e.recordDate));
  for (const b of document.querySelectorAll("#presets button"))
    b.setAttribute("aria-checked", String(b.dataset.preset === id));
  syncChips();
  draw();
}

/* ---------- controls ---------- */
const presetsHost = document.getElementById("presets");
for (const [id, label] of [["best", "Best known falls"], ["past15", "All past 15%"], ["all", `All ${M.slidesTo6}`]]) {
  const b = document.createElement("button");
  b.textContent = label;
  b.dataset.preset = id;
  b.setAttribute("role", "radio");
  b.setAttribute("aria-checked", String(id === state.preset));
  b.addEventListener("click", () => applyPreset(id));
  presetsHost.appendChild(b);
}
const horHost = document.getElementById("horizon");
for (const [v, label] of [[50, "50 days"], [100, "100 days"], [250, "250 days"], [0, "full"]]) {
  const b = document.createElement("button");
  b.textContent = label;
  b.setAttribute("role", "radio");
  b.setAttribute("aria-checked", String(v === state.horizon));
  b.addEventListener("click", () => {
    state.horizon = v;
    for (const x of horHost.children) x.setAttribute("aria-checked", String(x === b));
    draw();
  });
  horHost.appendChild(b);
}

const chipsHost = document.getElementById("chips");
for (const e of featured) {
  const c = document.createElement("button");
  c.className = "chip";
  c.dataset.key = e.recordDate;
  c.style.color = colorOf(e);
  c.innerHTML = `<span class="sw"></span><span class="nm"></span> <span class="v"></span>`;
  c.querySelector(".nm").textContent = e.name;
  c.querySelector(".v").textContent = pct(e.depthPct, 0);
  c.setAttribute("aria-pressed", String(state.visible.has(e.recordDate)));
  c.addEventListener("click", () => {
    if (state.visible.has(e.recordDate)) state.visible.delete(e.recordDate);
    else state.visible.add(e.recordDate);
    syncChips();
    draw();
  });
  chipsHost.appendChild(c);
}
function syncChips() {
  for (const c of chipsHost.children) {
    const on = state.visible.has(c.dataset.key);
    c.setAttribute("aria-pressed", String(on));
  }
}

/* ---------- chart ---------- */
const chartHost = document.getElementById("chart");
const tipEl = document.getElementById("tooltip");

function draw() {
  chartHost.replaceChildren();
  const vis = EPS.filter((e) => state.visible.has(e.recordDate));
  if (!vis.length) {
    const w0 = Math.max(chartHost.clientWidth || 640, 560);
    const svg0 = el("svg", { viewBox: `0 0 ${w0} 120`, role: "img", "aria-label": "No lines selected" });
    svg0.appendChild(el("text", { x: 20, y: 60, fill: "var(--ink-faint)", "font-size": 14 },
      "No lines selected \u2014 pick a preset or toggle a chip above."));
    chartHost.appendChild(svg0);
    return;
  }

  const W = Math.max(chartHost.clientWidth || 640, 560);
  const H = 470;
  const L = 58, R = 178, T = 18, B = 42;
  const maxLen = Math.max(...vis.map((e) => e.series.length));
  const xMax = state.horizon === 0 ? Math.max(30, maxLen) : Math.min(state.horizon, maxLen);
  let yMin = 0;
  for (const e of vis) for (let d = 0; d <= Math.min(xMax, e.series.length - 1); d++)
    if (e.series[d] < yMin) yMin = e.series[d];
  yMin = Math.min(-5, Math.floor((yMin * 1.07) / 5) * 5);

  const px = (d) => L + (d / xMax) * (W - L - R);
  const py = (p) => T + (-p / -yMin) * (H - T - B);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "S&P 500 falls below record close, by trading day since the record" });

  // y grid
  const grid = el("g", { class: "grid" });
  for (let p = 0; p >= yMin; p -= 10) {
    grid.appendChild(el("line", { x1: L, x2: W - R + 8, y1: py(p), y2: py(p) }));
    if (p < 0) grid.appendChild(el("text", { class: "axis", x: L - 8, y: py(p) + 4,
      "text-anchor": "end", fill: "var(--ink-faint)", "font-size": 11.5 }, MINUS + -p + "%"));
  }
  svg.appendChild(grid);
  svg.appendChild(el("line", { class: "zero", x1: L, x2: W - R + 8, y1: py(0), y2: py(0) }));
  svg.appendChild(el("text", { class: "zeroLabel", x: L, y: py(0) - 6 }, "Record"));

  // x ticks
  const step = [10, 20, 25, 50, 100].find((s) => xMax / s <= 7) || 100;
  const ax = el("g", { class: "axis" });
  for (let d = step; d <= xMax; d += step) {
    ax.appendChild(el("line", { x1: px(d), x2: px(d), y1: H - B, y2: H - B + 4, stroke: "var(--line)" }));
    ax.appendChild(el("text", { x: px(d), y: H - B + 18, "text-anchor": "middle" }, String(d)));
  }
  ax.appendChild(el("text", { x: W - R, y: H - 6, "text-anchor": "end", class: "axisTitle" },
    "trading days since the record close"));
  svg.appendChild(ax);

  // lines: context first, featured next, ongoing last on top
  const order = [...vis].sort((a, b) => (rank(a) - rank(b)));
  const labelSlots = [];
  for (const e of order) {
    const pts = e.series.slice(0, Math.min(xMax, e.series.length - 1) + 1);
    if (!pts.length) continue;
    if (pts.length === 1) {
      if (isFeatured(e)) {
        svg.appendChild(el("circle", { class: "dot", cx: px(0), cy: py(pts[0]), r: 3.5, fill: colorOf(e) }));
        labelSlots.push({ x: 0, y: py(pts[0]), text: `${e.name}: ${pct(e.depthPct, 0)}`, color: colorOf(e) });
      }
      continue;
    }
    const path = pts.map((p, d) => `${d ? "L" : "M"}${px(d).toFixed(1)},${py(p).toFixed(1)}`).join("");
    const cls = e.ongoing ? "ongoing" : isFeatured(e) ? "featured" : "context";
    const ln = el("path", { class: `linePath ${cls}`, d: path,
      stroke: cls === "context" ? "var(--c-other)" : colorOf(e) });
    svg.appendChild(ln);
    if (isFeatured(e)) {
      const dy = e.daysToLow > xMax || e.ongoing;
      const label = `${e.name}: ${pct(e.ongoing ? M.pctBelowRecord : e.depthPct, 0)}` +
        (dy ? ` after ${e.ongoing ? M.daysSinceRecord : e.daysToLow} days` : "");
      labelSlots.push({ x: px(pts.length - 1) + 7, y: py(pts[pts.length - 1]), text: label,
        color: colorOf(e) });
    }
  }

  // end labels, nudged apart vertically
  labelSlots.sort((a, b) => a.y - b.y);
  for (let i = 0; i < labelSlots.length; i++) {
    const s = labelSlots[i];
    if (i > 0 && s.y < labelSlots[i - 1].y + 15) s.y = labelSlots[i - 1].y + 15;
    svg.appendChild(el("text", { class: "endLabel", x: W - R + 14, y: s.y + 4,
      fill: s.color }, s.text));
  }

  // hover crosshair + tooltip
  const cross = el("line", { class: "crosshair", y1: T, y2: H - B, x1: -9, x2: -9 });
  const dots = el("g", {});
  svg.append(cross, dots);
  chartHost.appendChild(svg);

  svg.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * W;
    let d = Math.round(((mx - L) / (W - L - R)) * xMax);
    d = Math.max(0, Math.min(xMax, d));
    cross.setAttribute("x1", px(d)); cross.setAttribute("x2", px(d));
    dots.replaceChildren();
    const rows = [];
    for (const e of vis) {
      if (d >= e.series.length) continue;
      rows.push({ name: e.name || `Slide since ${fmtDM(e.recordDate)}`, v: e.series[d],
        color: isFeatured(e) ? colorOf(e) : "var(--c-other)" });
      dots.appendChild(el("circle", { class: "dot", cx: px(d), cy: py(e.series[d]), r: 3.4,
        fill: isFeatured(e) ? colorOf(e) : "var(--c-other)" }));
    }
    rows.sort((a, b) => a.v - b.v);
    tipEl.hidden = false;
    tipEl.innerHTML = `<h3>day ${d} since record</h3>` + rows.map((r) =>
      `<div class="row"><span><span class="sw" style="background:${r.color}"></span>${r.name}</span><b>${pct(r.v)}</b></div>`).join("");
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let tx = ev.clientX + 16, ty = ev.clientY - th / 2;
    if (tx + tw > innerWidth - 8) tx = ev.clientX - tw - 16;
    tipEl.style.left = tx + "px";
    tipEl.style.top = Math.max(8, Math.min(innerHeight - th - 8, ty)) + "px";
  });
  svg.addEventListener("mouseleave", () => { tipEl.hidden = true; cross.setAttribute("x1", -9); cross.setAttribute("x2", -9); dots.replaceChildren(); });
}
function rank(e) { return e.ongoing ? 2 : isFeatured(e) ? 1 : 0; }

let raf = 0;
addEventListener("resize", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
draw();

/* ---------- tables ---------- */
function rowInto(tbody, e, opts = {}) {
  const tr = document.createElement("tr");
  if (e.ongoing) tr.className = "ongoing";
  const name = e.name || `${opts.longName ? "" : "Slide "}${fmtDMY(e.recordDate)}`;
  const nm = document.createElement("td");
  if (isFeatured(e) || e.ongoing) {
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.color = colorOf(e);
    nm.appendChild(sw);
  }
  nm.appendChild(document.createTextNode(name));
  const low = e.ongoing ? "So far" : fmtDMY(e.lowDate);
  const days = String(e.daysToLow);
  const recovery = e.recoveryDays == null ? "\u2014" : String(e.recoveryDays);
  for (const html of [null, fmtDMY(e.recordDate), low, pct(e.depthPct), days, recovery]) {
    if (html === null) { tr.appendChild(nm); continue; }
    const td = document.createElement("td");
    if (html === pct(e.depthPct)) td.className = "neg";
    td.textContent = html;
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

const known = featured.filter((e) => !e.ongoing).sort((a, b) => b.lowDate.localeCompare(a.lowDate));
const ftb = document.querySelector("#featuredTable tbody");
if (ongoing) rowInto(ftb, ongoing);
for (const e of known) rowInto(ftb, e);

const atb = document.querySelector("#allTable tbody");
for (const e of [...EPS].sort((a, b) => a.recordDate.localeCompare(b.recordDate)))
  rowInto(atb, e, { longName: true });
