import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const ENCODINGS = ["position_only", "length_only", "position_color", "length_color"];
const VIEWINGS = ["normal", "obscured"];
const TASK_TYPES = ["value_comparison", "trend", "proportion"];

const LABELS = ["A", "B", "C", "D"];

let sessionId = null;
let trialQueue = [];
let trialIndex = 0;
let stimulusOnset = 0;
let currentTrial = null;
let pendingReactionMs = null;
let pendingSelectedAnswer = null;
let completedRows = [];

function showScreen(name) {
  document.querySelectorAll("#app .screen").forEach((el) => {
    el.classList.toggle("hidden", el.id !== `screen-${name}`);
  });
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(session, trialOrder, salt) {
  let h = 2166136261;
  const str = `${session}|${trialOrder}|${salt}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mulberry32(h >>> 0);
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function buildConditionList() {
  const list = [];
  for (const encoding of ENCODINGS) {
    for (const viewing of VIEWINGS) {
      list.push({
        encoding,
        viewing,
        condition_id: `${encoding}_${viewing}`,
      });
    }
  }
  return list;
}

function firstMaxLabel(cats, accessor) {
  let best = LABELS[0];
  let bestV = -Infinity;
  for (const id of LABELS) {
    const row = cats.find((c) => c.id === id);
    const v = accessor(row);
    if (v > bestV) {
      bestV = v;
      best = id;
    }
  }
  return best;
}

function generateTrialPayload(taskType, rng, seedStr) {
  if (taskType === "value_comparison") {
    const categories = LABELS.map((id) => ({
      id,
      value: randInt(rng, 18, 94),
    }));
    const correct = firstMaxLabel(categories, (r) => r.value);
    return {
      taskType,
      stimulusSeed: seedStr,
      mode: "snapshot",
      categories,
      correct,
      instruction: "Which category has the <strong>highest</strong> value?",
    };
  }

  if (taskType === "trend") {
    const categories = LABELS.map((id) => ({
      id,
      t0: randInt(rng, 20, 60),
      t1: randInt(rng, 25, 95),
    }));
    const correct = firstMaxLabel(categories, (r) => r.t1 - r.t0);
    return {
      taskType,
      stimulusSeed: seedStr,
      mode: "trend",
      categories,
      correct,
      instruction:
        "From the first observation to the last, which category shows the <strong>largest increase</strong>?",
    };
  }

  const pctOptions = [
    { label: "A", pct: 15 },
    { label: "B", pct: 35 },
    { label: "C", pct: 55 },
    { label: "D", pct: 75 },
  ];
  let categories;
  let truePct;
  let guard = 0;
  do {
    guard += 1;
    const vD = randInt(rng, 55, 100);
    const vA = randInt(rng, 8, vD - 1);
    categories = LABELS.map((id) => {
      if (id === "A") return { id, value: vA };
      if (id === "D") return { id, value: vD };
      return { id, value: randInt(rng, 15, 90) };
    });
    truePct = (categories.find((c) => c.id === "A").value / categories.find((c) => c.id === "D").value) * 100;
  } while (guard < 80 && pctOptions.every((o) => Math.abs(o.pct - truePct) < 4));

  let correct = pctOptions[0].label;
  let bestDiff = Infinity;
  for (const o of pctOptions) {
    const d = Math.abs(o.pct - truePct);
    if (d < bestDiff) {
      bestDiff = d;
      correct = o.label;
    }
  }

  return {
    taskType,
    stimulusSeed: seedStr,
    mode: "snapshot",
    categories,
    correct,
    proportionMeta: { truePct, pctOptions },
    instruction: `Consider categories <strong>A</strong> and <strong>D</strong>. About what percent of <strong>D</strong>'s value is <strong>A</strong>?<br><span class="sub-instruction">A) ~15% · B) ~35% · C) ~55% · D) ~75%</span>`,
  };
}

function renderChart(encoding, viewing, payload) {
  const wrap = d3.select("#viz-chart-wrap");
  wrap.selectAll("*").remove();

  const margin = { top: 16, right: 16, bottom: 44, left: 48 };
  const outerW = 500;
  const outerH = 350;
  const width = outerW - margin.left - margin.right;
  const height = outerH - margin.top - margin.bottom;

  const svg = wrap
    .append("svg")
    .attr("viewBox", `0 0 ${outerW} ${outerH}`)
    .attr("width", "100%")
    .attr("height", "100%")
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const xBand = d3.scaleBand().domain(LABELS).range([0, width]).padding(0.25);
  const colorScale = d3.scaleSequential(d3.interpolateBlues).domain([0, 100]);
  const neutral = "#5c5c5c";

  const applyObscured = viewing === "obscured";
  d3.select("#viz-chart-wrap").classed("obscured-vision", applyObscured);

  if (payload.mode === "snapshot") {
    const maxV = d3.max(payload.categories, (d) => d.value) * 1.1 || 100;
    const y = d3.scaleLinear().domain([0, maxV]).nice().range([height, 0]);

    svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(xBand));
    svg.append("g").call(d3.axisLeft(y).ticks(5));

    if (encoding === "position_only" || encoding === "position_color") {
      svg
        .selectAll(".dot")
        .data(payload.categories)
        .enter()
        .append("circle")
        .attr("class", "dot")
        .attr("cx", (d) => xBand(d.id) + xBand.bandwidth() / 2)
        .attr("cy", (d) => y(d.value))
        .attr("r", 8)
        .attr("fill", (d) =>
          encoding === "position_color" ? colorScale(d.value) : neutral
        );
    } else {
      svg
        .selectAll(".bar")
        .data(payload.categories)
        .enter()
        .append("rect")
        .attr("class", "bar")
        .attr("x", (d) => xBand(d.id))
        .attr("y", (d) => y(d.value))
        .attr("width", xBand.bandwidth())
        .attr("height", (d) => height - y(d.value))
        .attr("fill", (d) =>
          encoding === "length_color" ? colorScale(d.value) : neutral
        );
    }
    return;
  }

  if (payload.mode === "trend") {
    const maxV =
      d3.max(payload.categories, (d) => Math.max(d.t0, d.t1)) * 1.08 || 100;
    const y = d3.scaleLinear().domain([0, maxV]).nice().range([height, 0]);
    const innerPadding = 0.35;
    const step = xBand.bandwidth() / 2;
    const x0 = (id) => xBand(id) + (xBand.bandwidth() * innerPadding) / 2;
    const x1 = (id) => xBand(id) + xBand.bandwidth() - (xBand.bandwidth() * innerPadding) / 2;

    svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(xBand));
    svg.append("g").call(d3.axisLeft(y).ticks(5));

    const line = d3
      .line()
      .x((d) => d.x)
      .y((d) => d.y);

    for (const d of payload.categories) {
      const pts = [
        { x: x0(d.id), y: y(d.t0) },
        { x: x1(d.id), y: y(d.t1) },
      ];
      const stroke = encoding.includes("color")
        ? colorScale((d.t0 + d.t1) / 2)
        : neutral;
      const fillDot = encoding.includes("color")
        ? colorScale((d.t0 + d.t1) / 2)
        : neutral;

      if (encoding === "position_only" || encoding === "position_color") {
        svg
          .append("path")
          .datum(pts)
          .attr("fill", "none")
          .attr("stroke", stroke)
          .attr("stroke-width", 2)
          .attr("d", line);
        svg
          .selectAll(`.trend-dot-${d.id}`)
          .data(pts)
          .enter()
          .append("circle")
          .attr("cx", (p) => p.x)
          .attr("cy", (p) => p.y)
          .attr("r", 7)
          .attr("fill", fillDot);
      } else {
        const bw = (x1(d.id) - x0(d.id)) / 2.2;
        svg
          .append("rect")
          .attr("x", x0(d.id) - bw / 2)
          .attr("y", y(d.t0))
          .attr("width", bw)
          .attr("height", height - y(d.t0))
          .attr("fill", encoding === "length_color" ? colorScale(d.t0) : neutral);
        svg
          .append("rect")
          .attr("x", x1(d.id) - bw / 2)
          .attr("y", y(d.t1))
          .attr("width", bw)
          .attr("height", height - y(d.t1))
          .attr("fill", encoding === "length_color" ? colorScale(d.t1) : neutral);
      }
    }
  }
}

function wireAnswerButtons() {
  const box = document.getElementById("answers");
  box.innerHTML = "";
  for (const label of LABELS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", () => onSelectAnswer(label));
    box.appendChild(btn);
  }
}

function onSelectAnswer(label) {
  if (!currentTrial) return;
  pendingReactionMs = Math.round(performance.now() - stimulusOnset);
  pendingSelectedAnswer = label;
  document.getElementById("answers").classList.add("hidden");
  document.getElementById("likert").classList.remove("hidden");
  document.getElementById("likert-error").classList.add("hidden");
}

function resetLikert() {
  document.querySelectorAll('input[name="difficulty"]').forEach((r) => {
    r.checked = false;
  });
}

function startTrial() {
  const slot = trialQueue[trialIndex];
  const taskType = TASK_TYPES[trialIndex % TASK_TYPES.length];
  const seedStr = `${sessionId}|${trialIndex + 1}|${slot.condition_id}|${taskType}`;
  const rng = makeRng(sessionId, trialIndex, `${slot.condition_id}|${taskType}`);
  const payload = generateTrialPayload(taskType, rng, seedStr);

  currentTrial = {
    condition: slot,
    taskType,
    payload,
    correct: payload.correct,
  };

  document.getElementById("task-instructions").innerHTML = payload.instruction;
  document.getElementById("answers").classList.remove("hidden");
  document.getElementById("likert").classList.add("hidden");
  resetLikert();

  renderChart(slot.encoding, slot.viewing, payload);
  stimulusOnset = performance.now();
  pendingReactionMs = null;
  pendingSelectedAnswer = null;
}

function onNextTrial() {
  const checked = document.querySelector('input[name="difficulty"]:checked');
  if (!checked) {
    document.getElementById("likert-error").classList.remove("hidden");
    return;
  }
  const difficulty = parseInt(checked.value, 10);
  const row = {
    trial_index: trialIndex + 1,
    condition_id: currentTrial.condition.condition_id,
    encoding: currentTrial.condition.encoding,
    viewing_condition: currentTrial.condition.viewing,
    task_type: currentTrial.taskType,
    is_correct: pendingSelectedAnswer === currentTrial.correct,
    reaction_time_ms: pendingReactionMs,
    perceived_difficulty: difficulty,
    correct_answer: currentTrial.correct,
    selected_answer: pendingSelectedAnswer,
    stimulus_seed: currentTrial.payload.stimulusSeed,
  };
  completedRows.push(row);

  trialIndex += 1;
  if (trialIndex < trialQueue.length) {
    startTrial();
  } else {
    void finishStudy();
  }
}

async function finishStudy() {
  showScreen("thanks");
  const statusEl = document.getElementById("submit-status");

  // #region agent log
  const _dbg = (hypothesisId, location, message, data) => {
    fetch("http://127.0.0.1:7398/ingest/4b8dde08-513d-4314-a6cf-99c94534d9e5", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79fe00" },
      body: JSON.stringify({
        sessionId: "79fe00",
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  };
  // #endregion

  if (!SUPABASE_ANON_KEY || !SUPABASE_URL) {
    statusEl.textContent =
      "Note: Supabase is not configured in config.js, so results were not uploaded.";
    statusEl.classList.remove("hidden", "muted");
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

  const { data: sessionRow, error: sessionErr } = await supabase
    .from("study_sessions")
    .insert({
      id: sessionId,
      participant_key: null,
      user_agent: ua,
      completed_at: null,
    })
    .select("user_number")
    .single();

  const rawUserNumber = sessionRow?.user_number;
  const userNumber =
    typeof rawUserNumber === "number"
      ? rawUserNumber
      : typeof rawUserNumber === "string"
        ? parseInt(rawUserNumber, 10)
        : NaN;

  // #region agent log
  _dbg("H1", "script.js:finishStudy", "after session insert", {
    completedRowsLen: completedRows.length,
    sessionErrCode: sessionErr?.code ?? null,
    sessionErrMessage: sessionErr?.message ?? null,
    sessionRowKeys: sessionRow ? Object.keys(sessionRow) : null,
    userNumberRaw: rawUserNumber,
    userNumberType: sessionRow != null ? typeof rawUserNumber : null,
    userNumberCoerced: userNumber,
    coercedOk: Number.isFinite(userNumber),
  });
  // #endregion

  if (sessionErr || sessionRow == null || !Number.isFinite(userNumber)) {
    statusEl.textContent =
      "We could not save your session. If you are the researcher, check the database and config.";
    statusEl.classList.remove("hidden");
    console.error(sessionErr ?? new Error("Missing user_number after insert"));
    return;
  }

  const trialPayload = completedRows.map((r) => ({
    session_id: sessionId,
    user_number: userNumber,
    trial_index: r.trial_index,
    condition_id: r.condition_id,
    encoding: r.encoding,
    viewing_condition: r.viewing_condition,
    task_type: r.task_type,
    is_correct: r.is_correct,
    reaction_time_ms: r.reaction_time_ms,
    perceived_difficulty: r.perceived_difficulty,
    correct_answer: r.correct_answer,
    selected_answer: r.selected_answer,
    stimulus_seed: r.stimulus_seed,
  }));

  const { error: trialsErr } = await supabase.from("study_trials").insert(trialPayload);

  // #region agent log
  _dbg("H2", "script.js:finishStudy", "after trials insert", {
    trialPayloadLen: trialPayload.length,
    trialKeysSample: trialPayload[0] ? Object.keys(trialPayload[0]) : [],
    trialsErrCode: trialsErr?.code ?? null,
    trialsErrMessage: trialsErr?.message ?? null,
    trialsErrDetails: trialsErr?.details ?? null,
    trialsErrHint: trialsErr?.hint ?? null,
  });
  // #endregion

  if (trialsErr) {
    statusEl.textContent =
      "Session started but trials failed to save. The researcher should check RLS and table columns.";
    statusEl.classList.remove("hidden");
    console.error(trialsErr);
    return;
  }

  const { error: updateErr } = await supabase
    .from("study_sessions")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (updateErr) {
    console.warn(updateErr);
  }

  statusEl.textContent = "";
  statusEl.classList.add("hidden");
}

function onStart() {
  sessionId = crypto.randomUUID();
  trialQueue = shuffle(buildConditionList());
  trialIndex = 0;
  completedRows = [];
  showScreen("task");
  wireAnswerButtons();
  startTrial();
}

document.getElementById("btn-start").addEventListener("click", onStart);
document.getElementById("btn-next-trial").addEventListener("click", onNextTrial);
