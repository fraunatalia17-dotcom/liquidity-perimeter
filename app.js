(() => {
  "use strict";

  const STORAGE_KEY = "contractor-liquidity-model-v1";
  const COLORS = ["#b44b45", "#0f6b5d", "#426ca6"];
  const FLOW_TYPES = {
    gc_receipt: { label: "Поступление от генподрядчика", sign: "in", hint: "Фактическая сумма и дата зависят от сценария. Поступление ограничивается чистой суммой к получению после взаимозачёта." },
    other_receipt: { label: "Прочее поступление", sign: "in", hint: "Обычный денежный приток без сценарной корректировки." },
    material_payment: { label: "Оплата материалов", sign: "out", hint: "После возобновления авансов часть суммы оплатит генподрядчик напрямую поставщику. Эта часть не проходит через банк подрядчика и увеличивает встречный долг перед ГП." },
    supplier_payment: { label: "Оплата поставщику", sign: "out", hint: "Денежная выплата уменьшает остаток и задолженность поставщикам." },
    payroll: { label: "Заработная плата", sign: "out", hint: "Денежная выплата по календарю." },
    tax: { label: "Налоги и взносы", sign: "out", hint: "Денежная выплата по календарю." },
    subcontractor: { label: "Оплата субподрядчику", sign: "out", hint: "Денежная выплата по календарю." },
    other_payment: { label: "Прочая выплата", sign: "out", hint: "Денежная выплата по календарю." },
    ks2_accrual: { label: "КС-2: новая задолженность ГП", sign: "noncash", hint: "Недежная операция: увеличивает задолженность генподрядчика перед подрядчиком и доступную сумму к получению." },
    gc_direct_pay: { label: "Прямая оплата ГП поставщику", sign: "noncash", hint: "Недежная операция: генподрядчик оплачивает поставщика за подрядчика; встречный долг перед ГП растёт, долг поставщику уменьшается." }
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const el = id => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const sum = values => values.reduce((acc, value) => acc + Number(value || 0), 0);
  const uid = prefix => `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date, days) => { const copy = new Date(date); copy.setDate(copy.getDate() + Number(days)); return copy; };
  const toIso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const fromIso = value => { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); };
  const formatDate = value => value ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(typeof value === "string" ? fromIso(value) : value) : "—";
  const formatDateLong = value => value ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(typeof value === "string" ? fromIso(value) : value) : "—";
  const money = value => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(Number(value || 0)))} ₽`;
  const moneyCompact = value => {
    const number = Number(value || 0);
    const abs = Math.abs(number);
    if (abs >= 1_000_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(number / 1_000_000)} млн ₽`;
    if (abs >= 1_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(number / 1_000)} тыс. ₽`;
    return money(number);
  };
  const numberValue = value => Math.max(0, Number(value) || 0);

  function createDefaultState() {
    const start = startOfDay(new Date());
    const date = days => toIso(addDays(start, days));
    return {
      version: 1,
      settings: { startDate: date(0), horizonDays: 56, openingCash: 3_200_000, buffer: 1_000_000 },
      activeScenario: "base",
      projects: [
        { id: "p1387", name: "Договор 1387 · Корпус А", gcDebt: 6_200_000, counterDebt: 2_150_000, supplierDebt: 3_400_000 },
        { id: "p241", name: "Проект 241 · Паркинг", gcDebt: 4_100_000, counterDebt: 2_800_000, supplierDebt: 3_100_000 },
        { id: "p56", name: "Проект 56 · Благоустройство", gcDebt: 2_700_000, counterDebt: 1_550_000, supplierDebt: 3_300_000 }
      ],
      flows: [
        { id: uid("f"), date: date(3), project: "p1387", type: "material_payment", amount: 2_100_000, comment: "Поставка металлоконструкций" },
        { id: uid("f"), date: date(5), project: "p241", type: "supplier_payment", amount: 1_600_000, comment: "Просроченная партия бетона" },
        { id: uid("f"), date: date(7), project: "p1387", type: "gc_receipt", amount: 4_000_000, comment: "Оплата КС-2 по графику" },
        { id: uid("f"), date: date(9), project: "all", type: "payroll", amount: 1_900_000, comment: "Зарплата, первая часть" },
        { id: uid("f"), date: date(12), project: "p241", type: "material_payment", amount: 3_200_000, comment: "Материалы по заявке" },
        { id: uid("f"), date: date(15), project: "all", type: "tax", amount: 1_250_000, comment: "НДС и страховые взносы" },
        { id: uid("f"), date: date(17), project: "p56", type: "ks2_accrual", amount: 4_500_000, comment: "Плановое подписание КС-2" },
        { id: uid("f"), date: date(18), project: "p56", type: "subcontractor", amount: 2_400_000, comment: "Монтажные работы" },
        { id: uid("f"), date: date(21), project: "p241", type: "gc_receipt", amount: 3_500_000, comment: "Оплата закрытых работ" },
        { id: uid("f"), date: date(24), project: "p1387", type: "material_payment", amount: 2_800_000, comment: "Инженерное оборудование" },
        { id: uid("f"), date: date(25), project: "all", type: "payroll", amount: 2_100_000, comment: "Зарплата, окончательный расчёт" },
        { id: uid("f"), date: date(30), project: "all", type: "other_receipt", amount: 1_800_000, comment: "Возврат обеспечительного платежа" },
        { id: uid("f"), date: date(34), project: "p56", type: "gc_receipt", amount: 4_000_000, comment: "Оплата после КС-2" },
        { id: uid("f"), date: date(38), project: "p241", type: "supplier_payment", amount: 2_300_000, comment: "Погашение задолженности" },
        { id: uid("f"), date: date(43), project: "all", type: "tax", amount: 1_100_000, comment: "Налоги и взносы" },
        { id: uid("f"), date: date(47), project: "p1387", type: "gc_receipt", amount: 2_000_000, comment: "Окончательный платёж этапа" }
      ],
      scenarios: [
        { id: "stress", name: "Стресс", color: COLORS[0], advanceResumeDate: "", advanceCoverage: 0, gcReceiptFactor: 65, gcReceiptDelay: 14 },
        { id: "base", name: "Базовый", color: COLORS[1], advanceResumeDate: date(20), advanceCoverage: 50, gcReceiptFactor: 85, gcReceiptDelay: 7 },
        { id: "recovery", name: "Возобновление", color: COLORS[2], advanceResumeDate: date(7), advanceCoverage: 90, gcReceiptFactor: 100, gcReceiptDelay: 0 }
      ]
    };
  }

  function normalizeState(raw) {
    const fallback = createDefaultState();
    if (!raw || typeof raw !== "object") return fallback;
    return {
      version: 1,
      settings: { ...fallback.settings, ...(raw.settings || {}) },
      activeScenario: raw.activeScenario || fallback.activeScenario,
      projects: Array.isArray(raw.projects) && raw.projects.length ? raw.projects : fallback.projects,
      flows: Array.isArray(raw.flows) ? raw.flows : fallback.flows,
      scenarios: Array.isArray(raw.scenarios) && raw.scenarios.length ? raw.scenarios.map((scenario, index) => ({ ...fallback.scenarios[index % fallback.scenarios.length], ...scenario })) : fallback.scenarios
    };
  }

  function loadState() {
    try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch { return createDefaultState(); }
  }

  let state = loadState();
  let results = new Map();
  let cashChartGeometry = null;
  let toastTimer = null;

  function persist(message) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const saveState = el("saveState");
    saveState.innerHTML = '<span class="save-dot"></span> Данные сохранены';
    if (message) showToast(message);
  }

  function showToast(message) {
    const toast = el("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function projectTotals() {
    return {
      gcDebt: sum(state.projects.map(project => project.gcDebt)),
      counterDebt: sum(state.projects.map(project => project.counterDebt)),
      supplierDebt: sum(state.projects.map(project => project.supplierDebt))
    };
  }

  function scenarioById(id) { return state.scenarios.find(item => item.id === id) || state.scenarios[0]; }
  function projectName(id) { return id === "all" ? "Общие расходы" : (state.projects.find(project => project.id === id)?.name || "Без проекта"); }

  function buildForecast(scenario) {
    const settings = state.settings;
    const start = fromIso(settings.startDate);
    const end = addDays(start, Number(settings.horizonDays) - 1);
    const totals = projectTotals();
    let cash = Number(settings.openingCash);
    let gcDebt = totals.gcDebt;
    let counterDebt = totals.counterDebt;
    let supplierDebt = totals.supplierDebt;
    let directPayTotal = 0;
    let plannedGcReceipts = 0;
    let actualGcReceipts = 0;
    const buckets = new Map();

    const addEvent = (dateValue, event) => {
      if (!buckets.has(dateValue)) buckets.set(dateValue, []);
      buckets.get(dateValue).push(event);
    };

    state.flows.forEach(flow => {
      if (!FLOW_TYPES[flow.type]) return;
      let effectiveDate = flow.date;
      let effectiveAmount = Number(flow.amount || 0);
      if (flow.type === "gc_receipt") {
        effectiveDate = toIso(addDays(fromIso(flow.date), Number(scenario.gcReceiptDelay || 0)));
        effectiveAmount *= clamp(Number(scenario.gcReceiptFactor || 0), 0, 100) / 100;
        plannedGcReceipts += Number(flow.amount || 0);
      }
      addEvent(effectiveDate, { ...flow, effectiveAmount });
    });

    const points = [];
    const dailyDetails = [];
    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
      const dateValue = toIso(cursor);
      const events = buckets.get(dateValue) || [];
      let inflow = 0;
      let outflow = 0;
      let noncash = 0;

      events.filter(event => ["ks2_accrual", "gc_direct_pay", "material_payment"].includes(event.type)).forEach(event => {
        const amount = Number(event.effectiveAmount || event.amount || 0);
        if (event.type === "ks2_accrual") {
          gcDebt += amount;
          noncash += amount;
        } else if (event.type === "gc_direct_pay") {
          counterDebt += amount;
          supplierDebt = Math.max(0, supplierDebt - amount);
          directPayTotal += amount;
          noncash += amount;
        } else if (event.type === "material_payment") {
          const active = Boolean(scenario.advanceResumeDate) && dateValue >= scenario.advanceResumeDate;
          const coverage = active ? clamp(Number(scenario.advanceCoverage || 0), 0, 100) / 100 : 0;
          const covered = amount * coverage;
          const cashPart = amount - covered;
          counterDebt += covered;
          supplierDebt = Math.max(0, supplierDebt - amount);
          directPayTotal += covered;
          outflow += cashPart;
        }
      });

      events.filter(event => !["ks2_accrual", "gc_direct_pay", "material_payment"].includes(event.type)).forEach(event => {
        const amount = Number(event.effectiveAmount || event.amount || 0);
        if (event.type === "gc_receipt") {
          const collectible = Math.max(0, gcDebt - counterDebt);
          const collected = Math.min(amount, collectible);
          inflow += collected;
          actualGcReceipts += collected;
          gcDebt = Math.max(0, gcDebt - collected);
        } else if (event.type === "other_receipt") {
          inflow += amount;
        } else {
          outflow += amount;
          if (event.type === "supplier_payment") supplierDebt = Math.max(0, supplierDebt - amount);
        }
      });

      cash += inflow - outflow;
      const netPosition = gcDebt - counterDebt;
      points.push({ date: dateValue, cash, inflow, outflow, netPosition });
      dailyDetails.push({ date: dateValue, inflow, outflow, noncash, cash, gcDebt, counterDebt, supplierDebt, netPosition });
    }

    const minimum = points.reduce((best, point) => point.cash < best.cash ? point : best, points[0] || { cash, date: settings.startDate });
    const gaps = [];
    let openGap = null;
    points.forEach((point, index) => {
      if (point.cash < 0) {
        if (!openGap) openGap = { start: point.date, end: point.date, minCash: point.cash, minDate: point.date };
        openGap.end = point.date;
        if (point.cash < openGap.minCash) { openGap.minCash = point.cash; openGap.minDate = point.date; }
      } else if (openGap) {
        gaps.push(openGap);
        openGap = null;
      }
      if (index === points.length - 1 && openGap) gaps.push(openGap);
    });

    return {
      scenario,
      points,
      dailyDetails,
      minCash: minimum.cash,
      minDate: minimum.date,
      firstGap: gaps[0] || null,
      gaps,
      maxGap: Math.max(0, -minimum.cash),
      fundingNeed: Math.max(0, Number(settings.buffer) - minimum.cash),
      endCash: points.at(-1)?.cash ?? cash,
      endNetPosition: points.at(-1)?.netPosition ?? (gcDebt - counterDebt),
      directPayTotal,
      plannedGcReceipts,
      actualGcReceipts
    };
  }

  function recalculate() {
    results = new Map(state.scenarios.map(scenario => [scenario.id, buildForecast(scenario)]));
  }

  function renderControls() {
    el("startDate").value = state.settings.startDate;
    el("horizonDays").value = String(state.settings.horizonDays);
    el("activeScenario").innerHTML = state.scenarios.map(scenario => `<option value="${escapeHtml(scenario.id)}">${escapeHtml(scenario.name)}</option>`).join("");
    el("activeScenario").value = state.activeScenario;
  }

  function renderKpis() {
    const result = results.get(state.activeScenario) || results.values().next().value;
    const totals = projectTotals();
    const net = totals.gcDebt - totals.counterDebt;
    el("kpiMinCash").textContent = moneyCompact(result.minCash);
    el("kpiMinCash").className = result.minCash < 0 ? "negative-number" : "";
    el("kpiMinCashDate").textContent = `минимум ${formatDateLong(result.minDate)}`;
    el("kpiFirstGap").textContent = result.firstGap ? formatDateLong(result.firstGap.start) : "Разрыва нет";
    el("kpiGapDetail").textContent = result.firstGap ? `до ${moneyCompact(Math.abs(result.firstGap.minCash))}` : "остаток не опускается ниже нуля";
    el("kpiFunding").textContent = moneyCompact(result.fundingNeed);
    el("kpiNetPosition").textContent = moneyCompact(net);
    el("kpiNetPosition").className = net >= 0 ? "positive-number" : "negative-number";
    el("kpiNetCaption").textContent = net >= 0 ? "к получению после взаимозачёта" : "к погашению после взаимозачёта";
  }

  function renderBalances() {
    const totals = projectTotals();
    const net = totals.gcDebt - totals.counterDebt;
    el("balanceCash").textContent = money(state.settings.openingCash);
    el("balanceGcDebt").textContent = money(totals.gcDebt);
    el("balanceCounterDebt").textContent = money(totals.counterDebt);
    el("balanceSuppliers").textContent = money(totals.supplierDebt);
    el("balanceBuffer").textContent = money(state.settings.buffer);
    el("balanceNet").textContent = money(Math.abs(net));
    const block = el("netPositionBlock");
    block.classList.toggle("negative", net < 0);
    block.querySelector("span").textContent = net >= 0 ? "Чисто к получению от ГП" : "Чисто к погашению в пользу ГП";
    el("balanceCallout").textContent = net >= 0
      ? `Кредиторская задолженность генподрядчика перед подрядчиком превышает встречную задолженность на ${money(net)}. Эту сумму можно планировать к получению — с учётом срока и процента оплаты в сценарии.`
      : `Встречная задолженность подрядчика превышает долг генподрядчика на ${money(Math.abs(net))}. Денежные поступления от ГП временно не планируются до появления положительной чистой позиции.`;
  }

  function renderScenarioCards() {
    el("scenarioCards").innerHTML = state.scenarios.map(scenario => `
      <article class="scenario-card ${scenario.id === state.activeScenario ? "active" : ""}" data-scenario="${escapeHtml(scenario.id)}">
        <div class="scenario-title"><strong>${escapeHtml(scenario.name)}</strong>${scenario.id === state.activeScenario ? '<span class="scenario-badge">в прогнозе</span>' : ""}</div>
        <div class="scenario-fields">
          <label>Возобновление прямых оплат<input data-field="advanceResumeDate" type="date" value="${escapeHtml(scenario.advanceResumeDate || "")}"></label>
          <label>Доля материалов за счёт ГП, %<input data-field="advanceCoverage" type="number" min="0" max="100" step="5" value="${Number(scenario.advanceCoverage || 0)}"></label>
          <label>Оплата графика ГП, %<input data-field="gcReceiptFactor" type="number" min="0" max="100" step="5" value="${Number(scenario.gcReceiptFactor || 0)}"></label>
          <label>Задержка оплаты ГП, дней<input data-field="gcReceiptDelay" type="number" min="0" max="180" step="1" value="${Number(scenario.gcReceiptDelay || 0)}"></label>
        </div>
        <button class="scenario-select" type="button" data-action="activate-scenario">Показать как основной →</button>
      </article>`).join("");

    el("scenarioComparisonBody").innerHTML = state.scenarios.map(scenario => {
      const result = results.get(scenario.id);
      return `<tr>
        <td><span class="scenario-name-cell"><span class="scenario-dot" style="background:${scenario.color}"></span>${escapeHtml(scenario.name)}</span></td>
        <td class="${result.minCash < 0 ? "negative-number" : "positive-number"}">${moneyCompact(result.minCash)}</td>
        <td>${result.firstGap ? formatDate(result.firstGap.start) : "нет"}</td>
        <td class="${result.maxGap > 0 ? "negative-number" : ""}">${moneyCompact(result.maxGap)}</td>
        <td>${moneyCompact(result.fundingNeed)}</td>
        <td class="${result.endCash < 0 ? "negative-number" : ""}">${moneyCompact(result.endCash)}</td>
      </tr>`;
    }).join("");
  }

  function renderFlows() {
    const sorted = [...state.flows].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
    el("flowsBody").innerHTML = sorted.map(flow => {
      const meta = FLOW_TYPES[flow.type];
      const amountClass = meta.sign === "in" ? "amount-in" : meta.sign === "out" ? "amount-out" : "amount-noncash";
      const prefix = meta.sign === "in" ? "+" : meta.sign === "out" ? "−" : "◇ ";
      return `<tr>
        <td>${formatDateLong(flow.date)}</td>
        <td>${escapeHtml(projectName(flow.project))}</td>
        <td><span class="type-chip">${escapeHtml(meta.label)}</span></td>
        <td class="${amountClass}">${prefix}${money(flow.amount)}</td>
        <td>${escapeHtml(flow.comment || "—")}</td>
        <td><button class="row-menu" type="button" data-edit-flow="${escapeHtml(flow.id)}" title="Изменить">⋯</button></td>
      </tr>`;
    }).join("") || '<tr><td colspan="6">Операций пока нет</td></tr>';

    const inflow = sum(state.flows.filter(flow => FLOW_TYPES[flow.type]?.sign === "in").map(flow => flow.amount));
    const outflow = sum(state.flows.filter(flow => FLOW_TYPES[flow.type]?.sign === "out").map(flow => flow.amount));
    const noncash = sum(state.flows.filter(flow => FLOW_TYPES[flow.type]?.sign === "noncash").map(flow => flow.amount));
    el("calendarSummary").innerHTML = `
      <span class="summary-chip">План поступлений <strong>${moneyCompact(inflow)}</strong></span>
      <span class="summary-chip">План выплат <strong>${moneyCompact(outflow)}</strong></span>
      <span class="summary-chip">Недежные операции <strong>${moneyCompact(noncash)}</strong></span>
      <span class="summary-chip">Операций <strong>${state.flows.length}</strong></span>`;
  }

  function renderProjects() {
    el("projectsBody").innerHTML = state.projects.map(project => {
      const net = Number(project.gcDebt) - Number(project.counterDebt);
      return `<tr>
        <td><strong>${escapeHtml(project.name)}</strong></td>
        <td>${money(project.gcDebt)}</td>
        <td>${money(project.counterDebt)}</td>
        <td class="${net >= 0 ? "positive-number" : "negative-number"}">${net >= 0 ? "+" : "−"}${money(Math.abs(net))}</td>
        <td>${money(project.supplierDebt)}</td>
        <td><button class="row-menu" type="button" data-edit-project="${escapeHtml(project.id)}" title="Изменить">⋯</button></td>
      </tr>`;
    }).join("");
    const totals = projectTotals();
    const net = totals.gcDebt - totals.counterDebt;
    el("projectsFoot").innerHTML = `<tr><td>Итого</td><td>${money(totals.gcDebt)}</td><td>${money(totals.counterDebt)}</td><td class="${net >= 0 ? "positive-number" : "negative-number"}">${net >= 0 ? "+" : "−"}${money(Math.abs(net))}</td><td>${money(totals.supplierDebt)}</td><td></td></tr>`;
  }

  function setupCanvas(canvas, cssHeight) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, rect.width);
    const height = cssHeight || Math.max(220, rect.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
  }

  function niceBounds(min, max) {
    if (min === max) return { min: min - 1, max: max + 1 };
    const pad = (max - min) * .12;
    const lower = min - pad;
    const upper = max + pad;
    const rough = (upper - lower) / 5;
    const power = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
    const normalized = rough / power;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
    return { min: Math.floor(lower / step) * step, max: Math.ceil(upper / step) * step, step };
  }

  function drawCashChart() {
    const canvas = el("cashChart");
    const { context: ctx, width, height } = setupCanvas(canvas, window.innerWidth < 760 ? 270 : 330);
    const margin = { left: 66, right: 18, top: 18, bottom: 36 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const series = state.scenarios.map(scenario => results.get(scenario.id));
    const allValues = series.flatMap(result => result.points.map(point => point.cash));
    allValues.push(0, Number(state.settings.buffer));
    const bounds = niceBounds(Math.min(...allValues), Math.max(...allValues));
    const x = index => margin.left + (index / Math.max(1, series[0].points.length - 1)) * plotW;
    const y = value => margin.top + (bounds.max - value) / (bounds.max - bounds.min) * plotH;
    ctx.clearRect(0, 0, width, height);

    if (bounds.min < 0) {
      ctx.fillStyle = "rgba(180,75,69,.065)";
      ctx.fillRect(margin.left, y(0), plotW, Math.max(0, margin.top + plotH - y(0)));
    }
    ctx.strokeStyle = "#e3e0d8";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#78827f";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let tick = bounds.min; tick <= bounds.max + 1; tick += bounds.step) {
      const py = y(tick);
      ctx.beginPath(); ctx.moveTo(margin.left, py); ctx.lineTo(width - margin.right, py); ctx.stroke();
      ctx.fillText(`${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(tick / 1_000_000)} млн`, margin.left - 9, py);
    }
    if (state.settings.buffer >= bounds.min && state.settings.buffer <= bounds.max) {
      ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = "#d99a36"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(margin.left, y(state.settings.buffer)); ctx.lineTo(width - margin.right, y(state.settings.buffer)); ctx.stroke(); ctx.restore();
    }
    if (0 >= bounds.min && 0 <= bounds.max) {
      ctx.strokeStyle = "rgba(180,75,69,.65)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(margin.left, y(0)); ctx.lineTo(width - margin.right, y(0)); ctx.stroke();
    }

    const labelEvery = Math.max(1, Math.ceil(series[0].points.length / (width < 600 ? 5 : 8)));
    ctx.fillStyle = "#78827f"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    series[0].points.forEach((point, index) => {
      if (index % labelEvery === 0 || index === series[0].points.length - 1) ctx.fillText(formatDate(point.date), x(index), height - margin.bottom + 11);
    });

    series.forEach(result => {
      ctx.strokeStyle = result.scenario.color;
      ctx.lineWidth = result.scenario.id === state.activeScenario ? 3 : 2;
      ctx.globalAlpha = result.scenario.id === state.activeScenario ? 1 : .7;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath();
      result.points.forEach((point, index) => index ? ctx.lineTo(x(index), y(point.cash)) : ctx.moveTo(x(index), y(point.cash)));
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    cashChartGeometry = { margin, plotW, points: series[0].points, x, y, series, width, height };
    el("cashLegend").innerHTML = state.scenarios.map(scenario => `<span class="legend-item"><span class="legend-line" style="background:${scenario.color}"></span>${escapeHtml(scenario.name)}</span>`).join("");
  }

  function drawFundingChart() {
    const canvas = el("fundingChart");
    const { context: ctx, width, height } = setupCanvas(canvas, 230);
    const margin = { left: 88, right: 28, top: 18, bottom: 28 };
    const plotW = width - margin.left - margin.right;
    const values = state.scenarios.map(scenario => results.get(scenario.id).fundingNeed);
    const maxValue = Math.max(...values, 1);
    ctx.clearRect(0, 0, width, height);
    ctx.font = "11px Inter, system-ui, sans-serif";
    state.scenarios.forEach((scenario, index) => {
      const rowH = (height - margin.top - margin.bottom) / state.scenarios.length;
      const cy = margin.top + index * rowH + rowH / 2;
      const barH = Math.min(24, rowH * .48);
      ctx.fillStyle = "#eef0eb";
      ctx.fillRect(margin.left, cy - barH / 2, plotW, barH);
      ctx.fillStyle = scenario.color;
      ctx.fillRect(margin.left, cy - barH / 2, (values[index] / maxValue) * plotW, barH);
      ctx.textBaseline = "middle"; ctx.textAlign = "right"; ctx.fillStyle = "#5e6a67";
      ctx.fillText(scenario.name, margin.left - 10, cy);
      ctx.textAlign = "left"; ctx.fillStyle = "#172527"; ctx.font = "700 11px Inter, system-ui, sans-serif";
      const valueX = Math.min(width - 70, margin.left + (values[index] / maxValue) * plotW + 7);
      ctx.fillText(moneyCompact(values[index]), valueX, cy);
      ctx.font = "11px Inter, system-ui, sans-serif";
    });
  }

  function renderCharts() { drawCashChart(); drawFundingChart(); }

  function renderAll({ save = false } = {}) {
    recalculate();
    renderControls();
    renderKpis();
    renderBalances();
    renderScenarioCards();
    renderFlows();
    renderProjects();
    requestAnimationFrame(renderCharts);
    if (save) persist();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function populateFlowSelects() {
    const form = el("flowForm");
    form.elements.project.innerHTML = ['<option value="all">Общие расходы</option>', ...state.projects.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`)].join("");
    form.elements.type.innerHTML = Object.entries(FLOW_TYPES).map(([key, meta]) => `<option value="${key}">${escapeHtml(meta.label)}</option>`).join("");
  }

  function openFlowDialog(flow = null, presetType = null) {
    populateFlowSelects();
    const form = el("flowForm");
    const data = flow || { id: "", date: state.settings.startDate, project: state.projects[0]?.id || "all", type: presetType || "other_payment", amount: "", comment: "" };
    form.elements.flowId.value = data.id || "";
    form.elements.date.value = data.date;
    form.elements.project.value = data.project;
    form.elements.type.value = presetType || data.type;
    form.elements.amount.value = data.amount || "";
    form.elements.comment.value = data.comment || "";
    el("flowDialogTitle").textContent = flow ? "Изменить операцию" : (presetType === "ks2_accrual" ? "Новая КС-2" : "Новая операция");
    updateFlowHint();
    el("flowDialog").showModal();
  }

  function updateFlowHint() {
    const type = el("flowForm").elements.type.value;
    el("flowHint").textContent = FLOW_TYPES[type]?.hint || "";
  }

  function openProjectDialog(project = null) {
    const form = el("projectForm");
    form.elements.projectId.value = project?.id || "";
    form.elements.name.value = project?.name || "";
    form.elements.gcDebt.value = project?.gcDebt || 0;
    form.elements.counterDebt.value = project?.counterDebt || 0;
    form.elements.supplierDebt.value = project?.supplierDebt || 0;
    el("projectDialog").showModal();
  }

  function openBalancesDialog() {
    const form = el("balanceForm");
    const totals = projectTotals();
    form.elements.openingCash.value = state.settings.openingCash;
    form.elements.buffer.value = state.settings.buffer;
    form.elements.gcDebt.value = totals.gcDebt;
    form.elements.counterDebt.value = totals.counterDebt;
    form.elements.supplierDebt.value = totals.supplierDebt;
    el("balanceDialog").showModal();
  }

  function distributeTotal(field, target) {
    if (!state.projects.length) return;
    const current = sum(state.projects.map(project => project[field]));
    if (current <= 0) {
      state.projects.forEach((project, index) => project[field] = index === 0 ? target : 0);
      return;
    }
    let assigned = 0;
    state.projects.forEach((project, index) => {
      const next = index === state.projects.length - 1 ? target - assigned : Math.round(target * Number(project[field] || 0) / current);
      project[field] = Math.max(0, next);
      assigned += project[field];
    });
  }

  function bindEvents() {
    el("startDate").addEventListener("change", event => { state.settings.startDate = event.target.value; renderAll({ save: true }); });
    el("horizonDays").addEventListener("change", event => { state.settings.horizonDays = Number(event.target.value); renderAll({ save: true }); });
    el("activeScenario").addEventListener("change", event => { state.activeScenario = event.target.value; renderAll({ save: true }); });
    el("editBalancesButton").addEventListener("click", openBalancesDialog);
    el("addFlowButton").addEventListener("click", () => openFlowDialog());
    el("addKs2Button").addEventListener("click", () => openFlowDialog(null, "ks2_accrual"));
    el("addProjectButton").addEventListener("click", () => openProjectDialog());
    el("flowForm").elements.type.addEventListener("change", updateFlowHint);

    el("scenarioCards").addEventListener("change", event => {
      const field = event.target.dataset.field;
      if (!field) return;
      const card = event.target.closest("[data-scenario]");
      const scenario = scenarioById(card.dataset.scenario);
      scenario[field] = event.target.type === "number" ? Number(event.target.value) : event.target.value;
      recalculate(); renderKpis(); renderBalances(); renderScenarioCards(); requestAnimationFrame(renderCharts); persist();
    });
    el("scenarioCards").addEventListener("click", event => {
      if (event.target.dataset.action !== "activate-scenario") return;
      state.activeScenario = event.target.closest("[data-scenario]").dataset.scenario;
      renderAll({ save: true });
    });

    el("flowsBody").addEventListener("click", event => {
      const id = event.target.dataset.editFlow;
      if (!id) return;
      const flow = state.flows.find(item => item.id === id);
      if (flow) openFlowDialog(flow);
    });
    el("projectsBody").addEventListener("click", event => {
      const id = event.target.dataset.editProject;
      if (!id) return;
      const project = state.projects.find(item => item.id === id);
      if (project) openProjectDialog(project);
    });

    el("balanceForm").addEventListener("submit", event => {
      event.preventDefault();
      if (event.submitter?.value === "cancel") { el("balanceDialog").close(); return; }
      const form = event.currentTarget;
      state.settings.openingCash = numberValue(form.elements.openingCash.value);
      state.settings.buffer = numberValue(form.elements.buffer.value);
      distributeTotal("gcDebt", numberValue(form.elements.gcDebt.value));
      distributeTotal("counterDebt", numberValue(form.elements.counterDebt.value));
      distributeTotal("supplierDebt", numberValue(form.elements.supplierDebt.value));
      el("balanceDialog").close(); renderAll({ save: true }); showToast("Стартовые остатки обновлены");
    });

    el("flowForm").addEventListener("submit", event => {
      event.preventDefault();
      if (event.submitter?.value === "cancel") { el("flowDialog").close(); return; }
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const id = form.elements.flowId.value;
      const data = {
        id: id || uid("f"),
        date: form.elements.date.value,
        project: form.elements.project.value,
        type: form.elements.type.value,
        amount: numberValue(form.elements.amount.value),
        comment: form.elements.comment.value.trim()
      };
      if (id) state.flows = state.flows.map(flow => flow.id === id ? data : flow); else state.flows.push(data);
      el("flowDialog").close(); renderAll({ save: true }); showToast(id ? "Операция обновлена" : "Операция добавлена");
    });

    el("projectForm").addEventListener("submit", event => {
      event.preventDefault();
      if (event.submitter?.value === "cancel") { el("projectDialog").close(); return; }
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const id = form.elements.projectId.value;
      const data = { id: id || uid("p"), name: form.elements.name.value.trim(), gcDebt: numberValue(form.elements.gcDebt.value), counterDebt: numberValue(form.elements.counterDebt.value), supplierDebt: numberValue(form.elements.supplierDebt.value) };
      if (id) state.projects = state.projects.map(project => project.id === id ? data : project); else state.projects.push(data);
      el("projectDialog").close(); renderAll({ save: true }); showToast(id ? "Проект обновлён" : "Проект добавлен");
    });

    el("exportButton").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `liquidity-model-${state.settings.startDate}.json`; link.click();
      URL.revokeObjectURL(url); showToast("Данные экспортированы");
    });

    el("importInput").addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        state = normalizeState(JSON.parse(await file.text()));
        renderAll({ save: true }); showToast("Данные импортированы");
      } catch { showToast("Не удалось прочитать файл"); }
      event.target.value = "";
    });

    el("cashChart").addEventListener("mousemove", event => {
      if (!cashChartGeometry) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const { margin, plotW, points, series, x } = cashChartGeometry;
      if (mouseX < margin.left || mouseX > margin.left + plotW) { el("chartTooltip").hidden = true; return; }
      const index = clamp(Math.round(((mouseX - margin.left) / plotW) * (points.length - 1)), 0, points.length - 1);
      const tooltip = el("chartTooltip");
      tooltip.innerHTML = `<strong>${formatDateLong(points[index].date)}</strong><br>${series.map(result => `<span style="color:${result.scenario.color}">●</span> ${escapeHtml(result.scenario.name)}: ${moneyCompact(result.points[index].cash)}`).join("<br>")}`;
      tooltip.style.left = `${x(index)}px`;
      tooltip.style.top = `${clamp(event.clientY - rect.top, 45, rect.height - 45)}px`;
      tooltip.hidden = false;
    });
    el("cashChart").addEventListener("mouseleave", () => el("chartTooltip").hidden = true);

    let resizeTimer;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderCharts, 120); });
  }

  bindEvents();
  renderAll();
})();
