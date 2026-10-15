const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'quiz-helper-menu-randomized.user.js'), 'utf8')
  .replace('  // INIT\n', `  // INIT
  globalThis.api = { createTimingPlan, timingPlan, distributeBudget, remainingWaitMs,
    scheduleAnswerStep, responder, auto, limpar, setProcedureMinutes, setQuickModeEnabled };
`);

function harness() {
  const storage = new Map();
  let now = 0;
  let questions = [];
  let buttons = [];
  let nav = [];
  let timers = [];
  let timerId = 0;
  const context = vm.createContext({
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      readyState: 'loading', addEventListener() {},
      querySelector: () => questions[0] || null,
      querySelectorAll: (selector) => selector === '.que' ? questions
        : selector === '.qnbutton' ? nav : buttons,
    },
    navigator: {}, location: { pathname: '/mod/quiz/attempt.php' },
    Date: { now: () => now }, console,
    setTimeout(fn, delay) { timers.push({ id: ++timerId, at: now + delay, fn }); return timerId; },
    clearTimeout(id) { timers = timers.filter((timer) => timer.id !== id); },
    alert() {},
  });
  vm.runInContext(source, context);
  return {
    api: context.api, storage,
    page(qs, bs = []) { questions = qs; buttons = bs; },
    nav(items) { nav = items; },
    advance(ms) { now += ms; },
    reload() { timers = []; vm.runInContext(source, context); return context.api; },
    run() {
      let steps = 0;
      while (timers.length) {
        assert.ok(++steps < 1000, 'flow must finish');
        timers.sort((a, b) => a.at - b.at);
        const timer = timers.shift();
        now = timer.at;
        timer.fn();
      }
      return now;
    },
  };
}

const answers = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`Q${i + 1}`, 'a']));
const sum = (values) => values.reduce((a, b) => a + b, 0);

test('randomized question budgets sum to the slider total in both modes', () => {
  for (const quick of [true, false]) {
    for (const minutes of [1, 5, 15]) {
      for (const count of [1, 10, 50, 200]) {
        const { api } = harness();
        api.setProcedureMinutes(minutes);
        api.setQuickModeEnabled(quick);
        const plan = api.createTimingPlan(answers(count));
        const delays = Object.values(plan.questions).flatMap((q) => [q.fill, q.submit, q.confirm]);
        assert.equal(sum(delays) + plan.finishDelay, minutes * 60000);
        assert.ok(delays.every((delay) => Number.isInteger(delay) && delay >= 0));
        if (count > 1) assert.ok(new Set(Object.values(plan.questions).map((q) => q.submit)).size > 1);
      }
    }
  }
});

test('settings changes apply to the next plan', () => {
  const { api } = harness();
  const r = answers(10);
  api.setProcedureMinutes(5);
  const plan = api.createTimingPlan(r);
  api.setProcedureMinutes(15);
  assert.equal(api.timingPlan(r).targetTotalMs, plan.targetTotalMs);
  assert.equal(api.remainingWaitMs('submit:Q1', 20000, r), 20000);
});

test('remaining waits use a persisted deadline and cache cleanup preserves preferences', () => {
  const h = harness();
  const r = answers(3);
  h.api.setProcedureMinutes(12);
  h.api.setQuickModeEnabled(false);
  h.api.createTimingPlan(r);
  assert.equal(h.api.remainingWaitMs('submit:Q1', 10000, r), 10000);
  h.advance(4000);
  h.api = h.reload();
  assert.equal(h.api.remainingWaitMs('submit:Q1', 10000, r), 6000);
  h.advance(8000);
  assert.equal(h.api.remainingWaitMs('submit:Q1', 10000, r), 0);
  h.api.limpar();
  assert.equal(h.storage.get('quiz_procedure_minutes'), '12');
  assert.equal(h.storage.get('quiz_quick_mode'), '0');
  assert.equal(h.storage.has('quiz_submission_timing_plan'), false);
});

for (const pageSize of [1, 3, 10]) {
  test(`complete quiz flow respects the total with ${pageSize} questions per page`, () => {
    const h = harness();
    const r = answers(10);
    const submitted = [];
    const qs = Object.keys(r).map((key) => {
      const radio = { checked: false, click() { this.checked = true; } };
      const submit = { click() { submitted.push(key); } };
      return {
        querySelector: (selector) => selector.includes('submit') ? submit : { innerText: key.slice(1) },
        querySelectorAll: () => [radio],
      };
    });
    let page = 0;
    const loadPage = () => {
      h.page(qs.slice(page * pageSize, (page + 1) * pageSize), [{
        innerText: (page + 1) * pageSize < qs.length ? 'Seguinte' : 'Terminar tentativa',
        click() {
          if ((page + 1) * pageSize < qs.length) {
            page++;
          } else if (h.storage.get('quiz_answer_phase') === 'submit') {
            h.api.limpar();
            return;
          }
          loadPage();
          h.api.auto();
        },
      }]);
    };
    h.nav([{
      classList: { contains: () => page === 0 },
      click() { page = 0; loadPage(); h.api.auto(); },
    }]);
    loadPage();
    h.api.setProcedureMinutes(5);
    h.api.createTimingPlan(r);
    h.storage.set('quiz_answers', JSON.stringify(r));
    h.storage.set('quiz_answering_active', '1');
    h.storage.set('quiz_answer_phase', 'fill');
    h.api.scheduleAnswerStep(r);
    const elapsed = h.run();
    assert.equal(elapsed, 300000);
    assert.equal(submitted.length, 10);
    assert.equal(new Set(submitted).size, 10);
  });
}
