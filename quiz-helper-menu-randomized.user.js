// ==UserScript==
// @name         Quiz Helper Menu (RANDOMIZED)
// @namespace    https://github.com/eliaspc2/quiz-helper-menu-randomized
// @version      20.4.5
// @homepageURL  https://github.com/eliaspc2/quiz-helper-menu-randomized
// @downloadURL  https://raw.githubusercontent.com/eliaspc2/quiz-helper-menu-randomized/main/quiz-helper-menu-randomized.user.js
// @updateURL    https://raw.githubusercontent.com/eliaspc2/quiz-helper-menu-randomized/main/quiz-helper-menu-randomized.user.js
// @license      MIT
// @description  Ler perguntas, responder e limpar cache com tempos aleatorios.
// @match        https://ava.tecnisign.pt/*
// @match        https://ava.multiformactiva.pt/*
// @run-at       document-end
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
  'use strict';

  const MENU_ID = "quiz-helper-menu";

  const KDATA = "quiz_full_data";
  const KRUN = "quiz_reading_active";

  const KA = "quiz_answers";
  const KS = "quiz_done";
  const KARUN = "quiz_answering_active";
  const KPHASE = "quiz_answer_phase";
  const KFAST = "quiz_quick_mode";
  const KDURATION = "quiz_procedure_minutes";

  const KPOS = "quiz_menu_pos";
  const KSTART = "quiz_started";
  const KPLAN = "quiz_submission_timing_plan";

  const STATE_KEYS = [KDATA, KRUN, KA, KS, KARUN, KPHASE, KSTART, KPLAN];

  const DELAY = {
    autoRead: [700, 2200],
  };

  const FINAL_TEXT_RE =
    /tentativa\s+(terminada|submetida|finalizada)|terminada\s+em|submetid[ao]|submissao|resultado|finished|submitted|attempt\s+finished/;

  const FINISH_BUTTON_RE =
    /submeter\s+tudo|terminar\s+tentativa|enviar|submit\s+all|finish\s+attempt/;

  let wakeLock = null;
  let responderTimer = null;

  // ======================
  // UTIL
  // ======================
  const get = (k, d) => {
    try {
      return JSON.parse(localStorage.getItem(k)) || d;
    } catch {
      return d;
    }
  };

  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function randomMs(range) {
    const [min, max] = range;
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function later(range, fn) {
    return setTimeout(fn, randomMs(range));
  }

  function laterMs(ms, fn) {
    return setTimeout(fn, Math.max(0, Math.round(ms)));
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function elementText(el) {
    return normalizeText(el?.innerText || el?.value || el?.textContent || "");
  }

  function pageText() {
    return normalizeText(document.body ? document.body.innerText : "");
  }

  function click(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center" });
    } catch {}
    el.click();
  }

  function delayedClickMs(el, ms) {
    if (!el) return;
    laterMs(ms, () => click(el));
  }

  function copyToClipboard(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text);
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function quickModeEnabled() {
    return localStorage.getItem(KFAST) !== "0";
  }

  function setQuickModeEnabled(enabled) {
    localStorage.setItem(KFAST, enabled ? "1" : "0");
  }

  function procedureMinutes() {
    const parsed = Number.parseInt(localStorage.getItem(KDURATION) || "5", 10);
    return clamp(Number.isFinite(parsed) ? parsed : 5, 1, 15);
  }

  function setProcedureMinutes(value) {
    const minutes = clamp(Number.parseInt(String(value), 10) || 5, 1, 15);
    localStorage.setItem(KDURATION, String(minutes));
    return minutes;
  }

  function procedureLabel() {
    return `${procedureMinutes()} min`;
  }

  function modeLabel() {
    return quickModeEnabled() ? "Rapido" : "Normal";
  }

  function ensureMenuStyles() {
    if (document.getElementById("quiz-helper-menu-style")) return;

    const style = document.createElement("style");
    style.id = "quiz-helper-menu-style";
    style.textContent = `
      #${MENU_ID} {
        box-sizing: border-box;
        position: fixed;
        width: 300px;
        max-width: calc(100vw - 24px);
        color: #0f172a;
        background: rgba(248, 250, 252, 0.98);
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-top: 4px solid #0f766e;
        border-radius: 14px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
        backdrop-filter: blur(10px);
        overflow: hidden;
        font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        user-select: none;
      }

      #${MENU_ID} * {
        box-sizing: border-box;
      }

      #${MENU_ID} .qh-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 12px 10px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
        cursor: move;
      }

      #${MENU_ID} .qh-title {
        font-size: 14px;
        font-weight: 700;
        color: #0f172a;
      }

      #${MENU_ID} .qh-meta {
        margin-top: 2px;
        color: #475569;
        font-size: 12px;
        font-weight: 600;
      }

      #${MENU_ID} .qh-close {
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: #64748b;
        font: inherit;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }

      #${MENU_ID} .qh-close:hover {
        background: rgba(15, 23, 42, 0.06);
        color: #0f172a;
      }

      #${MENU_ID} .qh-body {
        display: grid;
        gap: 10px;
        padding: 12px;
      }

      #${MENU_ID} .qh-panel {
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 12px;
        background: #ffffff;
        padding: 10px;
      }

      #${MENU_ID} .qh-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      #${MENU_ID} .qh-label {
        font-size: 12px;
        font-weight: 700;
        color: #334155;
      }

      #${MENU_ID} .qh-value {
        font-size: 12px;
        font-weight: 700;
        color: #0f172a;
      }

      #${MENU_ID} .qh-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        cursor: pointer;
      }

      #${MENU_ID} .qh-toggle input {
        width: 18px;
        height: 18px;
        accent-color: #0f766e;
      }

      #${MENU_ID} .qh-range {
        margin-top: 10px;
        display: grid;
        gap: 8px;
      }

      #${MENU_ID} .qh-range input[type="range"] {
        width: 100%;
        accent-color: #2563eb;
      }

      #${MENU_ID} .qh-scale {
        display: flex;
        justify-content: space-between;
        color: #64748b;
        font-size: 11px;
      }

      #${MENU_ID} .qh-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      #${MENU_ID} .qh-btn {
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 9px 10px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        color: #0f172a;
        background: #e2e8f0;
        transition: transform 0.08s ease, background 0.12s ease, box-shadow 0.12s ease;
      }

      #${MENU_ID} .qh-btn:hover {
        background: #cbd5e1;
      }

      #${MENU_ID} .qh-btn:active {
        transform: translateY(1px);
      }

      #${MENU_ID} .qh-btn--primary {
        background: #2563eb;
        color: #fff;
      }

      #${MENU_ID} .qh-btn--primary:hover {
        background: #1d4ed8;
      }

      #${MENU_ID} .qh-btn--accent {
        background: #0f766e;
        color: #fff;
      }

      #${MENU_ID} .qh-btn--accent:hover {
        background: #115e59;
      }

      #${MENU_ID} .qh-btn--danger {
        background: #dc2626;
        color: #fff;
      }

      #${MENU_ID} .qh-btn--danger:hover {
        background: #b91c1c;
      }

      #${MENU_ID} .qh-btn--ghost {
        background: #f8fafc;
        color: #334155;
        border: 1px solid rgba(15, 23, 42, 0.08);
      }

      #${MENU_ID} .qh-btn--ghost:hover {
        background: #e2e8f0;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function clearResponderTimer() {
    if (!responderTimer) return;
    clearTimeout(responderTimer);
    responderTimer = null;
  }

  function scheduleResponderMs(ms) {
    clearResponderTimer();
    responderTimer = laterMs(ms, () => {
      responderTimer = null;
      responder();
    });
  }

  function findBtn(r) {
    return [...document.querySelectorAll("button,input[type=submit],a")]
      .find((b) => r.test(elementText(b)));
  }

  function hasFinishButton() {
    return Boolean(findBtn(FINISH_BUTTON_RE));
  }

  function hasQuestions() {
    return Boolean(document.querySelector(".que"));
  }

  function hasRunningState() {
    return localStorage.getItem(KRUN) === "1" || localStorage.getItem(KARUN) === "1";
  }

  async function keepAwake() {
    if (wakeLock || !("wakeLock" in navigator)) return;

    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
      console.log("[QuizHelper] wake lock ativo durante a submissao");
    } catch (err) {
      console.warn("[QuizHelper] nao foi possivel ativar wake lock", err);
    }
  }

  function releaseAwake() {
    if (!wakeLock) return;

    const lock = wakeLock;
    wakeLock = null;
    lock.release().catch(() => {});
  }

  function qNum(q) {
    const raw = [
      q.querySelector(".rui-qno"),
      q.querySelector(".qno"),
      q.querySelector(".info .no"),
    ]
      .map((el) => textOf(el))
      .find(Boolean) || "";

    return raw.replace(/\D/g, "");
  }

  function qKey(q) {
    const n = qNum(q);
    return n ? "Q" + n : null;
  }

  function radios(q) {
    return [...q.querySelectorAll("input[type=radio],input[type=checkbox]")]
      .filter((i) => i.value != "-1");
  }

  function submitBtn(q) {
    return q.querySelector('button.submit[id$="-submit"],input.submit[id$="-submit"]');
  }

  function textOf(el) {
    return String(el?.innerText || el?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanOptionText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^[a-z]\.\s*/i, "")
      .trim();
  }

  function queryLabelForInput(input) {
    if (!input.id) return null;

    try {
      return document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    } catch {
      return null;
    }
  }

  function optionTextFromInput(input) {
    const labelledBy = String(input.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);

    for (const id of labelledBy) {
      const el = document.getElementById(id);
      const text = textOf(el?.querySelector?.(".flex-fill")) || textOf(el);
      if (text) return cleanOptionText(text);
    }

    const directLabel = input.closest("label") || queryLabelForInput(input);
    const directText = cleanOptionText(textOf(directLabel));
    if (directText) return directText;

    const row = input.closest(".r0,.r1,.answer div,.form-check,.d-flex,.fitem");
    const rowText = cleanOptionText(textOf(row));
    if (rowText) return rowText;

    return "";
  }

  // ======================
  // DETECAO FINAL
  // ======================
  function isFinalPage() {
    const path = location.pathname.toLowerCase();

    if (path.endsWith("/mod/quiz/review.php")) return true;

    if (path.endsWith("/mod/quiz/summary.php")) {
      return !hasFinishButton() && FINAL_TEXT_RE.test(pageText());
    }

    if (path.endsWith("/mod/quiz/view.php")) {
      return !hasQuestions() && FINAL_TEXT_RE.test(pageText());
    }

    return !hasQuestions() && FINAL_TEXT_RE.test(pageText());
  }

  function limpar() {
    clearResponderTimer();
    STATE_KEYS.forEach((key) => localStorage.removeItem(key));
    releaseAwake();
  }

  function limparSeFinal() {
    if (!isFinalPage()) return false;
    limpar();
    console.log("[QuizHelper] estado limpo na pagina final");
    return true;
  }

  // ======================
  // IR PARA PERGUNTA 1
  // ======================
  function answerPhase() {
    return localStorage.getItem(KPHASE) || "fill";
  }

  function setAnswerPhase(phase) {
    localStorage.setItem(KPHASE, phase);
  }

  function questionNavButtons() {
    return [...document.querySelectorAll(".qnbutton")];
  }

  function isQuestion1Page() {
    const navButtons = questionNavButtons();
    if (navButtons.length) {
      return navButtons[0].classList.contains("thispage");
    }

    return [...document.querySelectorAll(".que")].some((q) => qKey(q) === "Q1");
  }

  function goTo1(phase) {
    if (localStorage.getItem(KSTART) === phase) return true;

    if (isQuestion1Page()) {
      localStorage.setItem(KSTART, phase);
      return true;
    }

    const btn = questionNavButtons()[0];
    if (btn) {
      click(btn);
      return false;
    }

    return true;
  }

  // ======================
  // PLANO DE TEMPOS
  // ======================
  function answerKeys(r) {
    return Object.keys(r || {})
      .filter((key) => /^Q\d+$/i.test(key))
      .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
  }

  function distributeBudget(totalMs, count) {
    if (count <= 0) return [];

    // Normalized weights vary each question without changing the total budget.
    const weights = Array.from({ length: count }, () => 0.7 + Math.random() * 0.6);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let cumulativeWeight = 0;
    let allocated = 0;

    return weights.map((weight) => {
      cumulativeWeight += weight;
      const cumulativeMs = Math.round(totalMs * cumulativeWeight / totalWeight);
      const delay = cumulativeMs - allocated;
      allocated = cumulativeMs;
      return delay;
    });
  }

  function createTimingPlan(r) {
    const keys = answerKeys(r);
    const totalMs = procedureMinutes() * 60 * 1000;
    const fillShare = quickModeEnabled() ? 0.14 : 0.22;
    const finishDelay = Math.round(totalMs * 0.01);
    const fillBudget = Math.round((totalMs - finishDelay) * fillShare);
    const submitBudget = totalMs - finishDelay - fillBudget;
    const fillDelays = distributeBudget(fillBudget, keys.length);
    const submitDelays = distributeBudget(submitBudget, keys.length);
    const questions = {};

    keys.forEach((key, index) => {
      const confirmDelay = Math.round(submitDelays[index] * 0.03);
      questions[key] = {
        fill: fillDelays[index],
        submit: submitDelays[index] - confirmDelay,
        confirm: confirmDelay,
      };
    });

    const plan = {
      version: 2,
      createdAt: Date.now(),
      targetTotalMs: totalMs,
      questions,
      finishDelay,
      waits: {},
    };

    set(KPLAN, plan);
    return plan;
  }

  function timingPlan(r) {
    const plan = get(KPLAN, null);
    return plan?.version === 2 ? plan : createTimingPlan(r);
  }

  function remainingWaitMs(id, delay, r) {
    const plan = timingPlan(r);
    if (plan.waits[id] === undefined) {
      plan.waits[id] = Date.now() + delay;
      set(KPLAN, plan);
    }
    return Math.max(0, plan.waits[id] - Date.now());
  }

  function scheduleAnswerStep(r) {
    const phase = answerPhase();
    if (!goTo1(phase)) return;
    const plan = timingPlan(r);
    const done = get(KS, {});
    const keys = [...document.querySelectorAll(".que")]
      .filter((q) => {
        const key = qKey(q);
        const index = String(r[key] || "").toLowerCase().charCodeAt(0) - 97;
        return plan.questions[key] && radios(q)[index]
          && (phase === "fill" || (!done[key] && submitBtn(q)));
      })
      .map(qKey);
    // Fill handles a whole page; submit handles one question at a time.
    const pending = phase === "fill" ? keys : keys.slice(0, 1);
    const delay = pending.reduce((sum, key) => sum + plan.questions[key][phase], 0);
    const wait = pending.length
      ? remainingWaitMs(`${phase}:${pending.join(",")}`, delay, r)
      : 0;
    scheduleResponderMs(wait);
  }

  function switchToSubmitPhase(r) {
    setAnswerPhase("submit");
    localStorage.removeItem(KSTART);
    if (!goTo1("submit")) return;

    scheduleAnswerStep(r);
  }

  function fillAnswers(r) {
    const questions = [...document.querySelectorAll(".que")];
    if (!questions.length) {
      switchToSubmitPhase(r);
      return;
    }

    for (const q of questions) {
      const k = qKey(q);
      const resp = r[k];
      if (!k || !resp) continue;

      const idx = resp.toLowerCase().charCodeAt(0) - 97;
      const rds = radios(q);
      if (!rds[idx]) continue;

      if (!rds[idx].checked) {
        click(rds[idx]);
      }
    }

    const next = findBtn(/seguinte|next/i);
    if (next) {
      click(next);
      return;
    }

    switchToSubmitPhase(r);
  }

  function submitAnswers(r) {
    let done = get(KS, {});

    for (const q of document.querySelectorAll(".que")) {
      const k = qKey(q);
      if (!k || done[k]) continue;

      const resp = r[k];
      if (!resp) continue;

      const idx = resp.toLowerCase().charCodeAt(0) - 97;
      const rds = radios(q);
      const btn = submitBtn(q);

      if (!rds[idx] || !btn) continue;

      if (!rds[idx].checked) {
        click(rds[idx]);
      }

      laterMs(remainingWaitMs(`confirm:${k}`, timingPlan(r).questions[k].confirm, r), () => {
        done[k] = true;
        set(KS, done);
        click(btn);
        scheduleAnswerStep(r);
      });

      return;
    }

    const next = findBtn(/seguinte|next/i);
    if (next) {
      click(next);
      return;
    }

    const finish = findBtn(FINISH_BUTTON_RE);
    if (finish) {
      delayedClickMs(finish, remainingWaitMs("finish", timingPlan(r).finishDelay, r));
      return;
    }

    limpar();
    alert("Fim");
  }

  // ======================
  // LER PERGUNTAS
  // ======================
  function ler() {
    if (localStorage.getItem(KRUN) !== "1") return;
    if (limparSeFinal()) return;
    if (!goTo1("read")) return;

    let d = get(KDATA, []);

    document.querySelectorAll(".que").forEach((q) => {
      const n = parseInt(qNum(q)) || d.length + 1;
      if (d.find((x) => x.numero === n)) return;

      const p = textOf(q.querySelector(".qtext"));

      const o = [];
      radios(q).forEach((r, i) => {
        const t = optionTextFromInput(r);
        if (t) o.push({ letra: String.fromCharCode(97 + i), texto: t });
      });

      d.push({ numero: n, pergunta: p, opcoes: o });
    });

    set(KDATA, d);

    const next = findBtn(/seguinte|next/i);
    if (next) {
      click(next);
      return;
    }

    const out = JSON.stringify(d.sort((a, b) => a.numero - b.numero), null, 2)
      + '\n\n### FORMATO\n{\n  "Q1": "a",\n  "Q2": "b"\n}';
    copyToClipboard(out);
    limpar();
    alert("Perguntas copiadas");
  }

  // ======================
  // RESPONDER
  // ======================
  function responder() {
    if (localStorage.getItem(KARUN) !== "1") return;
    if (limparSeFinal()) return;
    keepAwake();

    const r = get(KA, null);
    if (!r) return;

    const phase = answerPhase();

    if (phase === "fill") {
      if (!goTo1("fill")) return;
      fillAnswers(r);
      return;
    }

    if (!goTo1("submit")) return;
    submitAnswers(r);
  }

  // ======================
  // MENU + DRAG
  // ======================
  function menu() {
    if (document.getElementById(MENU_ID)) return;

    ensureMenuStyles();

    const pos = get(KPOS, {});
    const widthGuess = 300;
    const startLeft = clamp(
      typeof pos.left === "number" ? pos.left : window.innerWidth - widthGuess - 24,
      12,
      Math.max(12, window.innerWidth - widthGuess - 12)
    );
    const startTop = clamp(
      typeof pos.top === "number" ? pos.top : 20,
      12,
      Math.max(12, window.innerHeight - 80)
    );

    const d = document.createElement("div");
    d.id = MENU_ID;
    d.style.top = `${startTop}px`;
    d.style.left = `${startLeft}px`;
    d.style.zIndex = "999999";

    const head = document.createElement("div");
    head.className = "qh-header";

    const headText = document.createElement("div");
    const title = document.createElement("div");
    title.className = "qh-title";
    title.textContent = "Quiz Helper";

    const meta = document.createElement("div");
    meta.className = "qh-meta";
    const updateMeta = () => {
      meta.textContent = `${modeLabel()} | ${procedureLabel()}`;
    };
    updateMeta();

    headText.appendChild(title);
    headText.appendChild(meta);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "qh-close";
    close.textContent = "x";
    close.title = "Fechar";
    close.onclick = () => d.remove();

    head.appendChild(headText);
    head.appendChild(close);

    const cont = document.createElement("div");
    cont.className = "qh-body";

    const mk = (t, f, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      b.className = `qh-btn ${cls}`.trim();
      b.onclick = f;
      return b;
    };

    const settings = document.createElement("div");
    settings.className = "qh-panel";

    const quickRow = document.createElement("label");
    quickRow.className = "qh-toggle";

    const quickLabel = document.createElement("span");
    quickLabel.className = "qh-label";
    quickLabel.textContent = "Modo rapido";

    const quickInput = document.createElement("input");
    quickInput.type = "checkbox";
    quickInput.checked = quickModeEnabled();
    quickInput.addEventListener("change", () => {
      setQuickModeEnabled(quickInput.checked);
      updateMeta();
    });

    quickRow.appendChild(quickLabel);
    quickRow.appendChild(quickInput);

    const rangeWrap = document.createElement("div");
    rangeWrap.className = "qh-range";

    const rangeTop = document.createElement("div");
    rangeTop.className = "qh-row";

    const rangeLabel = document.createElement("span");
    rangeLabel.className = "qh-label";
    rangeLabel.textContent = "Duracao total aproximada";

    const rangeValue = document.createElement("span");
    rangeValue.className = "qh-value";
    rangeValue.textContent = procedureLabel();

    rangeTop.appendChild(rangeLabel);
    rangeTop.appendChild(rangeValue);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "1";
    slider.max = "15";
    slider.step = "1";
    slider.value = String(procedureMinutes());
    slider.addEventListener("input", () => {
      const minutes = setProcedureMinutes(slider.value);
      rangeValue.textContent = `${minutes} min`;
      updateMeta();
    });

    const scale = document.createElement("div");
    scale.className = "qh-scale";
    scale.innerHTML = "<span>1</span><span>15</span>";

    rangeWrap.appendChild(rangeTop);
    rangeWrap.appendChild(slider);
    rangeWrap.appendChild(scale);

    settings.appendChild(quickRow);
    settings.appendChild(rangeWrap);

    const actions = document.createElement("div");
    actions.className = "qh-actions";

    actions.appendChild(mk("Ler perguntas", () => {
      limpar();
      localStorage.setItem(KRUN, "1");
      later(DELAY.autoRead, ler);
    }, "qh-btn--ghost"));

    actions.appendChild(mk("Responder", () => {
      let r = get(KA, null);

      if (!r) {
        const i = prompt("Cola JSON");
        if (!i) return;
        r = JSON.parse(i);
        set(KA, r);
      }

      createTimingPlan(r);
      localStorage.removeItem(KS);
      localStorage.removeItem(KPHASE);
      localStorage.removeItem(KSTART);
      localStorage.setItem(KARUN, "1");
      setAnswerPhase("fill");
      keepAwake();

      scheduleAnswerStep(r);
    }, "qh-btn--primary"));

    actions.appendChild(mk("Avancar ja", () => {
      clearResponderTimer();

      if (localStorage.getItem(KARUN) === "1") {
        responder();
        return;
      }

      if (localStorage.getItem(KRUN) === "1") {
        ler();
      }
    }, "qh-btn--accent"));

    actions.appendChild(mk("Limpar cache", () => {
      limpar();
      alert("Cache limpa");
    }, "qh-btn--danger"));

    cont.appendChild(settings);
    cont.appendChild(actions);

    d.appendChild(head);
    d.appendChild(cont);
    document.body.appendChild(d);

    let down = false;
    let ox = 0;
    let oy = 0;

    head.onmousedown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      down = true;
      ox = e.clientX - d.offsetLeft;
      oy = e.clientY - d.offsetTop;
    };

    document.onmousemove = (e) => {
      if (!down) return;
      d.style.left = (e.clientX - ox) + "px";
      d.style.top = (e.clientY - oy) + "px";
    };

    document.onmouseup = () => {
      if (!down) return;
      down = false;
      set(KPOS, { top: d.offsetTop, left: d.offsetLeft });
    };
  }

  // ======================
  // AUTO
  // ======================
  function auto() {
    if (localStorage.getItem(KRUN) === "1") {
      later(DELAY.autoRead, ler);
    }

    if (localStorage.getItem(KARUN) === "1") {
      keepAwake();
      scheduleAnswerStep(get(KA, {}));
    }
  }

  // ======================
  // INIT
  // ======================
  function init() {
    if (limparSeFinal()) return;

    if (hasQuestions()) {
      menu();
    }

    if (hasRunningState()) {
      auto();
    }

    new MutationObserver(() => {
      if (limparSeFinal()) return;
      if (hasQuestions()) menu();
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && hasRunningState()) keepAwake();
  });
})();
