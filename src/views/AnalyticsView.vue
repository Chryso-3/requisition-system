<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Chart, registerables } from 'chart.js'
import {
  subscribeAnalyticsSummary,
  seedAnalyticsSummary,
  getDateRangeForPreset,
  STATUS_LABELS,
  REQUISITION_STATUS,
  REQUISITION_LIST_LIMIT,
} from '@/services/requisitionService'
import { USER_ROLES } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import { Briefcase, Clock, CheckCircle, DollarSign, TrendingDown, RefreshCw } from 'lucide-vue-next'

Chart.register(...registerables)

const router = useRouter()
const authStore = useAuthStore()

const dateRangeOptions = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_3_months', label: 'Last 3 months' },
  { value: 'last_6_months', label: 'Last 6 months' },
  { value: 'all', label: 'All time' },
]

const dateRangePreset = ref('all')
const summaryData = ref(null)
const data = ref(null)
const loading = ref(true)
const error = ref(null)
const seeding = ref(false)
const confirmSyncOpen = ref(false)
const pipelinePhase = ref('requisition') // 'requisition' or 'po'
const bottleneckPhase = ref('requisition') // 'requisition' or 'po'
let unsubSummary = null
let chartPipeline = null
let chartDepartment = null
let chartApprovedRejected = null
let chartTrend = null
let chartPurchase = null
let chartBottlenecks = null
let chartFinancials = null

// These become simple lookups from the summary data
const pendingReqsCount = computed(
  () => summaryData.value?.byStatus?.[REQUISITION_STATUS.PENDING_APPROVAL] ?? 0,
)
const approvedCount = computed(
  () => summaryData.value?.byStatus?.[REQUISITION_STATUS.APPROVED] ?? 0,
)
const rejectedCount = computed(
  () => summaryData.value?.byStatus?.[REQUISITION_STATUS.REJECTED] ?? 0,
)

const isGM = computed(
  () =>
    authStore?.role === USER_ROLES.GENERAL_MANAGER ||
    authStore?.role === USER_ROLES.SUPER_ADMIN ||
    authStore?.role === USER_ROLES.INTERNAL_AUDITOR,
)

function updateData() {
  if (!summaryData.value) return

  const preset = dateRangePreset.value
  const s = summaryData.value
  const now = new Date()

  // All known workflow stages – used to guarantee Req + PO charts always render
  const ALL_STAGES = [
    'submission_to_recommend',
    'recommend_to_inventory',
    'inventory_to_budget',
    'budget_to_audit',
    'audit_to_gm',
    'gm_to_fulfillment',
    'req_appr_to_po_issue',
    'po_issue_to_po_budget',
    'po_budget_to_po_audit',
    'po_audit_to_po_gm',
  ]

  // ── 1. Build sorted, chronological filteredMonths list ───────────────────
  let filteredMonths = []
  if (preset === 'all') {
    filteredMonths = Object.keys(s.byMonth || {}).sort()
  } else {
    let lookBack = 1
    if (preset === 'last_3_months') lookBack = 3
    else if (preset === 'last_6_months') lookBack = 6
    for (let i = lookBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      filteredMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    // filteredMonths is already oldest → newest
  }

  // ── 2. Aggregate from monthly buckets ────────────────────────────────────
  const zeroDur = () => ({ totalMs: 0, count: 0, activeTotalMs: 0, activeCount: 0 })
  const agg = {
    count: 0,
    value: 0,
    approved: 0,
    rejected: 0,
    leadTimeMs: 0,
    leadTimeCount: 0,
    byStatus: {},
    byDepartment: {},
    poByStatus: {},
    durations: Object.fromEntries(ALL_STAGES.map((k) => [k, zeroDur()])),
    purchaseBreakdown: { pending: 0, ordered: 0, received: 0 },
    departmentalSpend: {},
  }

  filteredMonths.forEach((key) => {
    const b = s.byMonth?.[key]
    if (!b) return
    agg.count += b.count || 0
    agg.value += b.value || 0
    agg.approved += b.approved || 0
    agg.rejected += b.rejected || 0
    agg.leadTimeMs += b.leadTimeMs || 0
    agg.leadTimeCount += b.leadTimeCount || 0
    Object.entries(b.byStatus || {}).forEach(([k, v]) => {
      agg.byStatus[k] = (agg.byStatus[k] || 0) + v
    })
    Object.entries(b.byDepartment || {}).forEach(([k, v]) => {
      agg.byDepartment[k] = (agg.byDepartment[k] || 0) + v
    })
    Object.entries(b.poByStatus || {}).forEach(([k, v]) => {
      agg.poByStatus[k] = (agg.poByStatus[k] || 0) + v
    })
    Object.entries(b.durations || {}).forEach(([k, v]) => {
      if (!agg.durations[k]) agg.durations[k] = zeroDur()
      agg.durations[k].totalMs += v.totalMs || 0
      agg.durations[k].count += v.count || 0
      agg.durations[k].activeTotalMs += v.activeTotalMs || 0
      agg.durations[k].activeCount += v.activeCount || 0
    })
    Object.entries(b.purchaseBreakdown || {}).forEach(([k, v]) => {
      agg.purchaseBreakdown[k] = (agg.purchaseBreakdown[k] || 0) + v
    })
    Object.entries(b.departmentalSpend || {}).forEach(([k, v]) => {
      agg.departmentalSpend[k] = (agg.departmentalSpend[k] || 0) + v
    })
  })

  // ── 3. Fallback to global Firestore top-level fields when buckets are empty ─
  // Monthly buckets only have sub-fields after running Sync with the new schema.
  // Before that, the data lives at the top level of the analytics document.
  const hasSubData = Object.values(agg.byStatus).some((v) => v > 0)
  const byStatusSrc = hasSubData ? agg.byStatus : s.byStatus || {}
  const byDeptSrc = hasSubData ? agg.byDepartment : s.byDepartment || {}
  const poByStatusSrc = hasSubData ? agg.poByStatus : s.poByStatus || {}
  const deptSpendSrc = hasSubData ? agg.departmentalSpend : s.departmentalSpend || {}

  const effApproved =
    agg.approved > 0 ? agg.approved : s.byStatus?.[REQUISITION_STATUS.APPROVED] || 0
  const effRejected =
    agg.rejected > 0 ? agg.rejected : s.byStatus?.[REQUISITION_STATUS.REJECTED] || 0
  const effValue = agg.value > 0 ? agg.value : s.totalApprovedValue || 0

  const hasDurData = Object.values(agg.durations).some((d) => d.count > 0 || d.activeCount > 0)
  const durSrc = hasDurData
    ? agg.durations
    : (() => {
        const fallback = Object.fromEntries(ALL_STAGES.map((k) => [k, zeroDur()]))
        Object.entries(s.durations || {}).forEach(([k, v]) => {
          if (fallback[k]) {
            fallback[k] = {
              totalMs: v.totalMs || 0,
              count: v.count || 0,
              activeTotalMs: v.activeTotalMs || 0,
              activeCount: v.activeCount || 0,
            }
          }
        })
        return fallback
      })()

  // ── 4. Build chart-ready structures ──────────────────────────────────────

  const statusOrder = [
    'draft',
    'pending_recommendation',
    'pending_inventory',
    'pending_budget',
    'pending_audit',
    'pending_approval',
    'approved',
    'rejected',
  ]
  const pipelineTotal = Object.values(byStatusSrc).reduce((a, b) => a + b, 0)
  const pipelineWithPct = statusOrder.map((status) => ({
    status,
    count: byStatusSrc[status] || 0,
    pct: pipelineTotal > 0 ? Math.round(((byStatusSrc[status] || 0) / pipelineTotal) * 100) : 0,
  }))

  const byDepartment = Object.entries(byDeptSrc)
    .map(([department, count]) => ({
      department,
      count,
      pct: pipelineTotal > 0 ? Math.round((count / pipelineTotal) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const poStatusOrder = ['pending_budget', 'pending_audit', 'pending_gm', 'approved', 'rejected']
  const poTotal = Object.values(poByStatusSrc).reduce((a, b) => a + b, 0)
  const poPipelineWithPct = poStatusOrder.map((status) => ({
    status,
    count: poByStatusSrc[status] || 0,
    pct: poTotal > 0 ? Math.round(((poByStatusSrc[status] || 0) / poTotal) * 100) : 0,
  }))

  // Trend chart: ALWAYS show rolling 12 months for "Strategic" context, regardless of preset
  const rolling12Months = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    rolling12Months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const monthlyTrend = rolling12Months.map((key) => {
    const [y, m] = key.split('-')
    const d = new Date(parseInt(y), parseInt(m) - 1, 1)
    const b = s.byMonth?.[key] || {}
    return {
      monthLabel: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      total: b.count || 0,
      value: b.value || 0,
    }
  })

  // ── 4.5. Dynamic Live Aging for Bottlenecks ──────────────────────────────
  // The analytics summary document was updated at `s.lastUpdated`.
  // To show live aging, we add the elapsed time since `lastUpdated` to all active items.
  const lastUpdated = s.lastUpdated?.toDate
    ? s.lastUpdated.toDate()
    : s.lastUpdated
      ? new Date(s.lastUpdated)
      : now
  const elapsedMs = Math.max(0, now - lastUpdated)

  // Bottlenecks: MAP from full ALL_STAGES list (guarantees Req + PO always render)
  const bottlenecks = ALL_STAGES.map((stage) => {
    // For historical averages, we use the date-preset filtered durations (durSrc)
    const durFiltered = durSrc[stage] || zeroDur()
    // For "Current Active Aging", we ALWAYS use the global snapshot (s.durations)
    // because an item currently stuck in the pipeline is stuck regardless of when it was created.
    const globalDur = s.durations?.[stage] || zeroDur()

    const activeCount = globalDur.activeCount || 0
    // Live total MS = snapshot total MS + (number of active items * time elapsed since snapshot)
    const liveActiveTotalMs = (globalDur.activeTotalMs || 0) + activeCount * elapsedMs

    return {
      stage,
      avgDays: durFiltered.count > 0 ? (durFiltered.totalMs / durFiltered.count / 86400000).toFixed(2) : 0,
      activeCount,
      activeAvgDays: activeCount > 0 ? (liveActiveTotalMs / activeCount / 86400000).toFixed(2) : 0,
    }
  })

  const gApproved = s.byStatus?.[REQUISITION_STATUS.APPROVED] || 0
  const gRejected = s.byStatus?.[REQUISITION_STATUS.REJECTED] || 0
  const gTotal = gApproved + gRejected

  // ── 5. Set reactive data ──────────────────────────────────────────────────
  data.value = {
    summary: {
      pendingApproval: s.summary?.pendingApproval || 0,
      approvedThisMonth: effApproved,
      rejectedThisMonth: effRejected,
      approvedPct:
        effApproved + effRejected > 0
          ? Math.round((effApproved / (effApproved + effRejected)) * 100)
          : 0,
      rejectedPct:
        effApproved + effRejected > 0
          ? Math.round((effRejected / (effApproved + effRejected)) * 100)
          : 0,
      avgLeadTimeDays:
        agg.leadTimeCount > 0
          ? (agg.leadTimeMs / agg.leadTimeCount / 86400000).toFixed(2)
          : s.summary?.avgLeadTimeDays || '—',
      totalApprovedValue: effValue,
      avgOrderValue: effApproved > 0 ? effValue / effApproved : 0,
    },
    pipelineWithPct,
    poPipelineWithPct,
    byDepartment,
    monthlyTrend,
    approvedVsRejected: {
      approved: gApproved,
      rejected: gRejected,
      approvedPct: gTotal > 0 ? Math.round((gApproved / gTotal) * 100) : 0,
      rejectedPct: gTotal > 0 ? Math.round((gRejected / gTotal) * 100) : 0,
    },
    purchaseBreakdown: agg.purchaseBreakdown,
    productivity: { bottlenecks },
    financials: {
      departmentalSpend: Object.entries(deptSpendSrc)
        .map(([department, total]) => ({ department, total }))
        .sort((a, b) => b.total - a.total),
    },
  }
}

function startRealtime() {
  error.value = null
  loading.value = true

  unsubSummary = subscribeAnalyticsSummary(
    (results) => {
      summaryData.value = results
      loading.value = false
      updateData()
    },
    (err) => {
      error.value = err?.message || 'Connection error'
      loading.value = false
    },
  )
}

async function handleSeed() {
  confirmSyncOpen.value = true
}

async function executeSync() {
  confirmSyncOpen.value = false
  seeding.value = true
  error.value = null
  try {
    const count = await seedAnalyticsSummary()
    console.log(`Successfully seeded ${count} requisitions`)
  } catch (err) {
    error.value = 'Failed to seed analytics: ' + err.message
  } finally {
    seeding.value = false
  }
}

function destroyCharts() {
  if (chartPipeline) {
    chartPipeline.destroy()
    chartPipeline = null
  }
  if (chartDepartment) {
    chartDepartment.destroy()
    chartDepartment = null
  }
  if (chartApprovedRejected) {
    chartApprovedRejected.destroy()
    chartApprovedRejected = null
  }
  if (chartTrend) {
    chartTrend.destroy()
    chartTrend = null
  }
  if (chartPurchase) {
    chartPurchase.destroy()
    chartPurchase = null
  }
  if (chartBottlenecks) {
    chartBottlenecks.destroy()
    chartBottlenecks = null
  }
  if (chartFinancials) {
    chartFinancials.destroy()
    chartFinancials = null
  }
}

const chartColors = {
  draft: '#cbd5e1',
  pending_recommendation: '#fbbf24',
  pending_inventory: '#fb923c',
  pending_budget: '#facc15',
  pending_audit: '#a78bfa',
  pending_approval: '#0ea5e9',
  approved: '#10b981',
  rejected: '#ef4444',
  pending: '#fbbf24',
  ordered: '#3b82f6',
  received: '#10b981',
}

function formatPeso(val) {
  if (val == null) return '₱0.00'
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(val)
}

function safeAbbreviate(name) {
  if (!name || typeof name !== 'string') return '—'
  const DEPT_MAP_ABBR = {
    'OFFICE OF GENERAL MANAGER': 'OGM',
    'FINANCE SERVICES DEPARTMENT': 'FSD',
    'INSTITUTIONAL SERVICES DEPARTMENT': 'ISD',
    'TECHNICAL SERVICES DEPARTMENT': 'TSD',
  }
  const upper = name.trim().toUpperCase()
  return DEPT_MAP_ABBR[upper] || name
}

function formatLastUpdated(val) {
  if (!val) return 'Never'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function renderCharts() {
  if (!data.value) return
  destroyCharts()

  const defaultFont = 'Inter, system-ui, -apple-system, sans-serif'
  const gridColor = 'rgba(0, 0, 0, 0.05)'
  const tickColor = '#64748b' // slate-500
  const cardBgColor = '#ffffff'
  const tooltipBorder = 'rgba(0, 0, 0, 0.1)'

  const getStageColor = (status) => {
    const stageColors = {
      pending_recommendation: '#8b0000', // primary
      pending_inventory: '#cc0000', // chart-2
      pending_budget: '#f97316', // chart-3
      pending_audit: '#0d9488', // chart-4
      pending_approval: '#eab308', // chart-5
      approved: '#8b0000', // primary
      rejected: '#ef4444', // destructive
    }
    return stageColors[status] || '#94a3b8' // muted
  }

  // 1. Pipeline Chart (Phase Aware)
  const pipelineEl = document.getElementById('chart-pipeline')
  if (pipelineEl) {
    const isReq = pipelinePhase.value === 'requisition'
    const chartData = isReq ? data.value.pipelineWithPct || [] : data.value.poPipelineWithPct || []
    console.log('[Analytics] Rendering Pipeline Chart:', {
      phase: pipelinePhase.value,
      chartData: JSON.parse(JSON.stringify(chartData)),
    })

    const labels = chartData.map((p) => {
      if (isReq) return `${STATUS_LABELS[p.status] || p.status} — ${p.count} (${p.pct}%)`
      const poLabelMap = {
        pending_budget: 'Waiting for Budget',
        pending_audit: 'Waiting for Audit',
        pending_gm: 'Waiting for GM',
        approved: 'Fully Issued',
        rejected: 'PO Rejected',
      }
      return `${poLabelMap[p.status] || p.status} — ${p.count} (${p.pct}%)`
    })

    const chartColors = isReq
      ? chartData.map((p) => getStageColor(p.status))
      : ['#0d9488', '#0f766e', '#115e59', '#134e4a'] // Gradient of Teal for PO

    chartPipeline = new Chart(pipelineEl, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: isReq ? 'Requisitions' : 'Purchase Orders',
            data: chartData.map((p) => p.count),
            backgroundColor: chartColors,
            barThickness: 20,
            borderRadius: 20,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { left: -10, right: 10, top: 4, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: cardBgColor,
            titleColor: '#0f172a',
            bodyColor: '#0f172a',
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 8,
            cornerRadius: 8,
            titleFont: { family: defaultFont, size: 12 },
            bodyFont: { family: defaultFont, size: 12 },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11, family: defaultFont }, color: tickColor },
            grid: { color: gridColor, drawBorder: false, tickLength: 0 },
            border: { display: false },
          },
          y: {
            ticks: { font: { size: 11, family: defaultFont }, color: tickColor },
            grid: { display: false, drawBorder: false },
            border: { display: false },
          },
        },
      },
    })
  }

  const deptEl = document.getElementById('chart-department')
  if (deptEl && data.value.byDepartment?.length) {
    const dept = data.value.byDepartment
    chartDepartment = new Chart(deptEl, {
      type: 'bar',
      data: {
        labels: dept.map((d) => {
          const name = safeAbbreviate(d.department)
          return `${name} (${d.count})`
        }),
        datasets: [
          {
            label: 'Requisitions',
            data: dept.map((d) => d.count),
            backgroundColor: dept.map((_, i) => {
              const colors = ['#8b0000', '#cc0000', '#f97316', '#0d9488', '#eab308']
              return colors[i % colors.length]
            }),
            barThickness: 32,
            borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { left: 10, right: 10, top: 20, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: cardBgColor,
            titleColor: '#0f172a',
            bodyColor: '#0f172a',
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 8,
            cornerRadius: 8,
            titleFont: { family: defaultFont, size: 12 },
            bodyFont: { family: defaultFont, size: 12 },
            callbacks: {
              label: (ctx) => `Volume: ${ctx.parsed.y} (${dept[ctx.dataIndex].pct}%)`,
            },
          },
        },
        scales: {
          x: {
            ticks: { font: { size: 10, family: defaultFont }, color: tickColor },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11, family: defaultFont }, color: tickColor },
            grid: { color: gridColor, drawBorder: false, tickLength: 0 },
            border: { display: false },
          },
        },
      },
    })
  }

  const arEl = document.getElementById('chart-approved-rejected')
  if (arEl) {
    const ar = data.value.approvedVsRejected || {}
    const arLabels = [
      `Approved — ${ar.approved ?? 0} (${ar.approvedPct ?? 0}%)`,
      `Rejected — ${ar.rejected ?? 0} (${ar.rejectedPct ?? 0}%)`,
    ]
    chartApprovedRejected = new Chart(arEl, {
      type: 'doughnut',
      data: {
        labels: arLabels,
        datasets: [
          {
            data: [ar.approved || 0, ar.rejected || 0],
            backgroundColor: ['#10b981', '#ef4444'], // Emerald green (Approved), Standard red (Rejected)
            borderWidth: 0,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: 12 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { size: 12, family: defaultFont },
              color: '#0f172a',
              padding: 12,
              usePointStyle: true,
              boxWidth: 8,
            },
          },
          tooltip: {
            backgroundColor: cardBgColor,
            titleColor: '#0f172a',
            bodyColor: '#0f172a',
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 8,
            cornerRadius: 8,
            titleFont: { family: defaultFont, size: 12 },
            bodyFont: { family: defaultFont, size: 12 },
          },
        },
        cutout: '60%',
      },
    })
  }

  const trendEl = document.getElementById('chart-trend')
  if (trendEl && data.value.monthlyTrend?.length) {
    const trend = data.value.monthlyTrend
    chartTrend = new Chart(trendEl, {
      type: 'line',
      data: {
        labels: trend.map((t) => t.monthLabel),
        datasets: [
          {
            label: 'Volume (Requests)',
            data: trend.map((t) => t.total),
            borderColor: '#8b0000',
            borderWidth: 2.5,
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#8b0000',
            pointBorderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: 'Financial Burn (₱)',
            data: trend.map((t) => t.value),
            borderColor: '#f97316',
            borderWidth: 2.5,
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#f97316',
            pointBorderWidth: 0,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 5, right: 10, left: -10, bottom: 5 } },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'center',
            labels: {
              usePointStyle: false,
              boxWidth: 12,
              boxHeight: 2,
              font: { size: 12, family: defaultFont },
              color: '#0f172a',
            },
          },
          tooltip: {
            backgroundColor: cardBgColor,
            titleColor: '#0f172a',
            bodyColor: '#0f172a',
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 8,
            cornerRadius: 8,
            titleFont: { family: defaultFont, size: 12 },
            bodyFont: { family: defaultFont, size: 12 },
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed.y
                if (ctx.datasetIndex === 0) return `Volume : ${val}`
                return `Burn ($) : ${formatPeso(val)}`
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { font: { size: 11, family: defaultFont }, color: tickColor },
            grid: { color: gridColor, drawBorder: false, tickLength: 0 },
            border: { display: false },
          },
          y: {
            position: 'left',
            beginAtZero: true,
            ticks: { stepSize: 5, font: { size: 11, family: defaultFont }, color: tickColor },
            grid: { color: gridColor, drawBorder: false, tickLength: 0 },
            border: { display: false },
          },
          y1: {
            position: 'right',
            beginAtZero: true,
            ticks: {
              font: { size: 11, family: defaultFont },
              color: tickColor,
              callback: (v) => '₱' + (v >= 1000 ? v / 1000 + 'k' : v),
            },
            grid: { drawOnChartArea: false, drawBorder: false, tickLength: 0 },
            border: { display: false },
          },
        },
      },
    })
  }

  // 6. Bottleneck Analysis (Phase Aware)
  const bottleneckEl = document.getElementById('chart-bottlenecks')
  if (bottleneckEl && data.value.productivity?.bottlenecks?.length) {
    const isReq = bottleneckPhase.value === 'requisition'
    const allowed = isReq
      ? [
          'submission_to_recommend',
          'recommend_to_inventory',
          'inventory_to_budget',
          'budget_to_audit',
          'audit_to_gm',
          'gm_to_fulfillment',
        ]
      : [
          'req_appr_to_po_issue',
          'po_issue_to_po_budget',
          'po_budget_to_po_audit',
          'po_audit_to_po_gm',
        ]

    const bn = allowed.map((stage) => {
      const match = data.value.productivity.bottlenecks.find((b) => b.stage === stage)
      return match || { stage, avgDays: 0, activeCount: 0, activeAvgDays: 0 }
    })
    console.log('[Analytics] Rendering Bottlenecks Chart:', {
      phase: bottleneckPhase.value,
      bottlenecks: JSON.parse(JSON.stringify(bn)),
    })
    const bnLabels = isReq
      ? {
          submission_to_recommend: 'Subm → Rec',
          recommend_to_inventory: 'Rec → Inv',
          inventory_to_budget: 'Inv → Budg',
          budget_to_audit: 'Budg → Aud',
          audit_to_gm: 'Aud → GM',
          gm_to_fulfillment: 'Approved → Received',
        }
      : {
          req_appr_to_po_issue: 'Appr → Issued',
          po_issue_to_po_budget: 'Issued → Budget',
          po_budget_to_po_audit: 'Budget → Audit',
          po_audit_to_po_gm: 'Audit → GM Final',
        }

    const ctx = bottleneckEl.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 400, 0)
    if (isReq) {
      gradient.addColorStop(0, '#8b0000') // Deep Red
      gradient.addColorStop(1, '#ef4444') // Bright Red
    } else {
      gradient.addColorStop(0, '#0d9488') // Deep Teal
      gradient.addColorStop(1, '#2dd4bf') // Bright Teal
    }

    chartBottlenecks = new Chart(bottleneckEl, {
      type: 'bar',
      data: {
        labels: bn.map((b) => {
          const label = bnLabels[b.stage] || b.stage
          return b.activeCount > 0 ? `${label} (${b.activeCount} pending)` : label
        }),
        datasets: [
          {
            label: 'Historical Avg (days)',
            data: bn.map((b) => Math.max(0, parseFloat(b.avgDays) || 0)),
            backgroundColor: bn.map((b) => {
              const days = parseFloat(b.avgDays) || 0
              if (days >= 3) return '#ef4444' // Red
              if (days >= 1) return '#f59e0b' // Amber
              return '#10b981' // Emerald
            }),
            borderRadius: 5,
            barThickness: 12,
          },
          {
            label: 'Current Active Aging',
            data: bn.map((b) => Math.max(0, parseFloat(b.activeAvgDays) || 0)),
            backgroundColor: bn.map((b) => {
              const days = parseFloat(b.activeAvgDays) || 0
              if (days >= 3) return '#991b1b' // Dark Red
              if (days >= 1) return '#92400e' // Dark Amber
              return '#065f46' // Dark Emerald
            }),
            borderRadius: 5,
            barThickness: 12,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              boxWidth: 10,
              font: { size: 10, family: defaultFont },
              generateLabels: (chart) => {
                const labels = Chart.defaults.plugins.legend.labels.generateLabels(chart)
                return labels.map((label) => {
                  if (label.text.includes('Historical')) label.fillStyle = '#10b981'
                  if (label.text.includes('Current')) label.fillStyle = '#991b1b'
                  return label
                })
              },
            },
          },
          tooltip: {
            backgroundColor: cardBgColor,
            titleColor: '#0f172a',
            bodyColor: '#0f172a',
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 8,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => {
                const b = bn[ctx.dataIndex]
                if (ctx.datasetIndex === 0) return ` Historical Avg: ${b.avgDays} d`
                return ` Active Aging: ${b.activeAvgDays} d (${b.activeCount} items)`
              },
            },
          },
        },
        scales: {
          y: {
            position: 'left',
            ticks: { font: { size: 10, family: defaultFont }, color: tickColor },
            grid: { display: false },
            border: { display: false },
          },
          x: {
            beginAtZero: true,
            ticks: {
              font: { size: 10, family: defaultFont },
              color: tickColor,
              callback: (v) => v + ' d',
            },
            grid: { color: gridColor },
            border: { display: false },
          },
        },
      },
    })
  }

  const financialEl = document.getElementById('chart-financials')
  if (financialEl && data.value.financials?.departmentalSpend?.length) {
    const fs = data.value.financials.departmentalSpend
    chartFinancials = new Chart(financialEl, {
      type: 'bar',
      data: {
        labels: fs.map((f) => safeAbbreviate(f.department)),
        datasets: [
          {
            label: 'Total Spend (₱)',
            data: fs.map((f) => f.total),
            backgroundColor: '#8b0000',
            borderRadius: { topRight: 6, bottomRight: 6, topLeft: 0, bottomLeft: 0 },
            barThickness: 24,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { left: -10, right: 10, top: 4, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: cardBgColor,
            titleColor: 'hsl(var(--foreground))',
            bodyColor: 'hsl(var(--foreground))',
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 8,
            cornerRadius: 8,
            titleFont: { family: defaultFont, size: 12 },
            bodyFont: { family: defaultFont, size: 12 },
            callbacks: {
              label: (ctx) => formatPeso(ctx.parsed.x),
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              font: { size: 11, family: defaultFont },
              color: tickColor,
              callback: (v) => '₱' + (v >= 1000 ? v / 1000 + 'k' : v),
            },
            grid: { color: gridColor, drawBorder: false, tickLength: 0 },
            border: { display: false },
          },
          y: {
            ticks: { font: { size: 11, family: defaultFont }, color: tickColor },
            grid: { display: false, drawBorder: false },
            border: { display: false },
          },
        },
      },
    })
  }
}

watch(dateRangePreset, () => {
  updateData()
})
watch(
  [data, pipelinePhase, bottleneckPhase, dateRangePreset],
  async () => {
    if (data.value && !loading.value) {
      await nextTick()
      setTimeout(renderCharts, 80)
    }
  },
  { deep: true },
)

// Watch both loading and isGM to start data sync
watch(
  [() => authStore.loading, isGM],
  ([authLoading, gmReady]) => {
    if (!authLoading && gmReady && !unsubSummary) {
      startRealtime()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  destroyCharts()
  if (unsubSummary) {
    unsubSummary()
    unsubSummary = null
  }
})
</script>

<template>
  <div class="analytics-view jinja">
    <header class="page-header">
      <div class="header-inner">
        <div>
          <h1 class="page-title">Analytics</h1>
          <p class="page-subtitle">Requisition metrics and reports</p>
        </div>
        <div class="header-actions">
          <span class="live-badge" title="Data updates in real time">
            <span class="live-dot"></span>
            Live
          </span>
          <label class="filter-label">
            <span class="filter-label-text">Date range</span>
            <select v-model="dateRangePreset" class="filter-select">
              <option v-for="opt in dateRangeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <button
            @click="handleSeed"
            :disabled="seeding || loading"
            class="sync-button"
            title="Re-calculate all analytics from scratch"
          >
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': seeding }" />
            <span>{{ seeding ? 'Syncing...' : 'Sync' }}</span>
          </button>
        </div>
      </div>
    </header>

    <div v-if="!isGM" class="access-denied">
      <p>This page is available to the General Manager and Super Administrator roles.</p>
    </div>

    <template v-else>
      <div v-if="error" class="error-banner">
        {{ error }}
      </div>

      <div v-else class="analytics-scroll">
        <div class="analytics-content">
          <!-- Key metrics -->
          <section class="section metrics-section">
            <div class="metrics-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <!-- Pending -->
              <div
                class="glass-card kpi-card p-4 animate-fade-in"
                style="--card-theme-color: hsl(var(--primary)); animation-delay: 0ms"
              >
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                    >Pending</span
                  >
                  <Briefcase class="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p class="text-xl font-bold tracking-tight text-primary">
                    {{ loading ? '—' : (data?.summary?.pendingApproval ?? 0) }}
                  </p>
                  <router-link
                    to="/all-requisitions"
                    class="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-primary transition-colors mt-2 inline-block"
                    >View list →</router-link
                  >
                </div>
              </div>

              <!-- Approved -->
              <div
                class="glass-card kpi-card p-4 animate-fade-in"
                style="--card-theme-color: hsl(var(--primary)); animation-delay: 80ms"
              >
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                    >Approved</span
                  >
                  <CheckCircle class="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p class="text-xl font-bold tracking-tight text-primary">
                    {{ loading ? '—' : (data?.summary?.approvedThisMonth ?? 0) }}
                    <span
                      class="text-muted-foreground text-xs font-normal ml-1"
                      v-if="!loading && data?.summary?.approvedPct != null"
                      >({{ data.summary.approvedPct }}%)</span
                    >
                  </p>
                  <router-link
                    to="/archive"
                    class="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-primary transition-colors mt-2 inline-block"
                    >Archive →</router-link
                  >
                </div>
              </div>

              <!-- Rejected -->
              <div
                class="glass-card kpi-card p-4 animate-fade-in"
                style="--card-theme-color: hsl(var(--primary)); animation-delay: 160ms"
              >
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                    >Rejected</span
                  >
                  <Briefcase class="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p class="text-xl font-bold tracking-tight text-primary">
                    {{ loading ? '—' : (data?.summary?.rejectedThisMonth ?? 0) }}
                    <span
                      class="text-muted-foreground text-xs font-normal ml-1"
                      v-if="!loading && data?.summary?.rejectedPct != null"
                      >({{ data.summary.rejectedPct }}%)</span
                    >
                  </p>
                  <router-link
                    to="/archive"
                    class="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-primary transition-colors mt-2 inline-block"
                    >Archive →</router-link
                  >
                </div>
              </div>

              <!-- Lead Time -->
              <div
                class="glass-card kpi-card p-4 animate-fade-in"
                style="--card-theme-color: hsl(var(--primary)); animation-delay: 240ms"
              >
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                    >Lead Time</span
                  >
                  <Clock class="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p class="text-xl font-bold tracking-tight text-primary">
                    {{ loading ? '—' : data?.summary?.avgLeadTimeDays }}
                    <span class="text-muted-foreground text-xs font-normal ml-1">days</span>
                  </p>
                  <p
                    class="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mt-2"
                  >
                    Target: &lt; 1 Day
                  </p>
                </div>
              </div>

              <!-- Total Approved -->
              <div
                class="glass-card kpi-card p-4 animate-fade-in"
                style="--card-theme-color: hsl(var(--primary)); animation-delay: 320ms"
              >
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                    >Approved Value</span
                  >
                  <DollarSign class="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p class="text-xl font-bold tracking-tight text-primary">
                    {{ loading ? '—' : formatPeso(data?.summary?.totalApprovedValue) }}
                  </p>
                  <span
                    class="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block mt-2"
                    v-if="!loading"
                  >
                    Avg: {{ formatPeso(data?.summary?.avgOrderValue) }} / req
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- High Value Alerts -->
          <section
            v-if="!loading && data?.financials?.highValueReqs?.length"
            class="section alerts-section"
          >
            <div class="high-value-banner">
              <div class="banner-header">
                <span class="banner-icon">⚠️</span>
                <div>
                  <h3 class="banner-title">High-Value Requisitions</h3>
                  <p class="banner-desc">Significant expenditures in the current period (₱50k+)</p>
                </div>
              </div>
              <div class="banner-items">
                <div v-for="h in data.financials.highValueReqs" :key="h.id" class="hv-item">
                  <span class="hv-rf">{{ h.rfControlNo }}</span>
                  <span class="hv-dept">{{ safeAbbreviate(h.department) }}</span>
                  <span class="hv-amount">{{ formatPeso(h.total) }}</span>
                  <router-link :to="'/requisitions/' + h.id" class="hv-link">Review</router-link>
                </div>
              </div>
            </div>
          </section>

          <!-- Reports / Charts -->
          <section v-if="data && !loading" class="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-8">
            <div
              class="glass-card animate-fade-in lg:col-span-2 animate-staggered"
              style="--order: 1; animation-delay: 200ms"
            >
              <div class="flex items-center justify-between mb-5">
                <div>
                  <h3
                    class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1"
                  >
                    {{
                      pipelinePhase === 'requisition'
                        ? 'Requisition Pipeline'
                        : 'PO Approval Pipeline'
                    }}
                  </h3>
                  <p class="text-xs text-muted-foreground">
                    {{
                      pipelinePhase === 'requisition'
                        ? 'Status of initial requisition requests'
                        : 'Tracking Purchase Orders through Budget, Audit, and GM approval'
                    }}
                  </p>
                </div>
                <div class="mini-switcher">
                  <button
                    :class="{ active: pipelinePhase === 'requisition' }"
                    @click="pipelinePhase = 'requisition'"
                  >
                    Req
                  </button>
                  <button :class="{ active: pipelinePhase === 'po' }" @click="pipelinePhase = 'po'">
                    PO
                  </button>
                </div>
              </div>
              <div class="h-[240px]">
                <canvas id="chart-pipeline"></canvas>
              </div>
            </div>

            <div
              class="glass-card animate-fade-in animate-staggered"
              style="--order: 2; animation-delay: 400ms"
            >
              <div class="flex items-center justify-between mb-5">
                <div>
                  <h3
                    class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1"
                  >
                    {{
                      bottleneckPhase === 'requisition'
                        ? 'Requisition Bottlenecks'
                        : 'PO Approval Bottlenecks'
                    }}
                  </h3>
                  <p class="text-xs text-muted-foreground">
                    {{
                      bottleneckPhase === 'requisition'
                        ? 'Historical averages vs. current aging for requisition stages'
                        : 'Historical averages vs. current aging for PO approval steps'
                    }}
                  </p>
                </div>
                <div class="mini-switcher">
                  <button
                    :class="{ active: bottleneckPhase === 'requisition' }"
                    @click="bottleneckPhase = 'requisition'"
                  >
                    Req
                  </button>
                  <button
                    :class="{ active: bottleneckPhase === 'po' }"
                    @click="bottleneckPhase = 'po'"
                  >
                    PO
                  </button>
                </div>
              </div>
              <div class="h-[240px]">
                <canvas id="chart-bottlenecks"></canvas>
              </div>
            </div>

            <div class="glass-card animate-fade-in" style="animation-delay: 300ms">
              <h3 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Decision Period
              </h3>
              <p class="text-xs text-muted-foreground mb-3">Approved vs rejected</p>
              <p v-if="data?.approvedVsRejected" class="text-sm font-medium mb-5">
                <span
                  >Approved
                  <strong class="text-accent"
                    >{{ data.approvedVsRejected.approvedPct ?? 0 }}%</strong
                  ></span
                >
                <span class="text-muted-foreground mx-2">·</span>
                <span
                  >Rejected
                  <strong class="text-destructive"
                    >{{ data.approvedVsRejected.rejectedPct ?? 0 }}%</strong
                  ></span
                >
              </p>
              <div class="h-[280px]">
                <canvas id="chart-approved-rejected"></canvas>
              </div>
            </div>

            <div class="glass-card animate-fade-in lg:col-span-2" style="animation-delay: 500ms">
              <h3 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                By Department
              </h3>
              <p class="text-xs text-muted-foreground mb-5">
                Requisitions per department in selected period (realtime)
              </p>
              <div class="h-[280px]">
                <canvas id="chart-department"></canvas>
              </div>
            </div>

            <div class="glass-card animate-fade-in lg:col-span-2" style="animation-delay: 550ms">
              <h3 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Spend by Department
              </h3>
              <p class="text-xs text-muted-foreground mb-5">
                Financial allocation across cost centers (Approved Only)
              </p>
              <div class="h-[280px]">
                <canvas id="chart-financials"></canvas>
              </div>
            </div>

            <div class="glass-card animate-fade-in lg:col-span-2" style="animation-delay: 600ms">
              <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-5">
                <div>
                  <h3
                    class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1"
                  >
                    Strategic Burn & Volume Trend
                  </h3>
                  <p class="text-xs text-muted-foreground">
                    Trajectory of monthly activity (Volume) vs financial expenditure (Burn)
                  </p>
                </div>
                <!-- Indicators on the right -->
              </div>
              <div class="h-[300px]">
                <canvas id="chart-trend"></canvas>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- Premium Sync Confirmation Modal -->
    <Transition name="modal-fade">
      <div v-if="confirmSyncOpen" class="sync-modal-overlay" @click.self="confirmSyncOpen = false">
        <div class="sync-modal-card animate-modal-enter">
          <!-- Decorative gradient orb -->
          <div class="sync-modal-orb"></div>

          <!-- Side-by-side layout -->
          <div class="sync-modal-inner">
            <!-- Left: Icon -->
            <div class="sync-modal-icon">
              <RefreshCw class="sync-modal-icon-svg" />
            </div>

            <!-- Right: Content -->
            <div class="sync-modal-right">
              <p class="sync-modal-eyebrow">Analytics Engine</p>
              <h2 class="sync-modal-title">Recalculate All Data?</h2>
              <p class="sync-modal-desc">
                This will scan up to <strong>5,000 requisitions</strong> and rebuild every chart,
                metric, and pipeline from scratch. Usually completes in a few seconds.
              </p>

              <!-- Divider -->
              <div class="sync-modal-divider"></div>

              <!-- Actions -->
              <div class="sync-modal-actions">
                <button class="sync-btn-cancel" @click="confirmSyncOpen = false">Cancel</button>
                <button class="sync-btn-confirm" @click="executeSync">
                  <RefreshCw class="sync-btn-icon" />
                  Sync Now
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Glassmorphism Elite Theme Variables (Light Mode) */
.jinja {
  --background: 0 0% 100%; /* White background */
  --foreground: 222.2 84% 4.9%; /* Very dark slate for text */
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --primary: 0 100% 27%; /* Brand Red #8b0000 -> hsl(0 100% 27%) */
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;

  /* Chart Colors */
  --chart-1: 0 100% 27%; /* Brand Red */
  --chart-2: 0 80% 40%; /* Lighter Red */
  --chart-3: 12 76% 61%; /* Coral/Orange */
  --chart-4: 173 58% 39%; /* Teal contrast */
  --chart-5: 43 74% 66%; /* Gold/Yellow contrast */

  /* Extra Elite vars */
  --glass-border: rgba(0, 0, 0, 0.08); /* Darker border for light mode */
  --glass-bg: rgba(255, 255, 255, 0.7); /* White glass */
  --glass-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); /* Lighter shadow */
}

.analytics-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family:
    'Inter',
    system-ui,
    -apple-system,
    sans-serif;
  overflow: hidden;
}

/* Mini Switcher for Cards */
.mini-switcher {
  display: inline-flex;
  background: rgba(0, 0, 0, 0.05);
  padding: 2px;
  border-radius: 6px;
  gap: 2px;
}

.mini-switcher button {
  padding: 3px 10px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.mini-switcher button.active {
  background: white;
  color: #8b0000;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* Page Header */
.page-header {
  flex-shrink: 0;
  padding: 1.5rem 2rem;
  background: transparent;
  border-bottom: 1px solid hsl(var(--border));
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  max-width: 1400px;
  margin: 0 auto;
}

.page-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: hsl(var(--foreground));
}

.page-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

/* Live Badge */
.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #10b981; /* Emerald-500 */
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  animation: live-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* Filters */
.filter-label {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.filter-label-text {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: hsl(var(--muted-foreground));
}

.filter-select {
  padding: 0.5rem 2.5rem 0.5rem 1rem;
  font-size: 0.875rem;
  color: hsl(var(--foreground));
  background-color: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  cursor: pointer;
  min-width: 160px;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9' /%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1rem;
  transition: border-color 0.2s;
}

.filter-select:hover {
  border-color: hsl(var(--muted-foreground));
}

.filter-select:focus {
  outline: none;
  border-color: hsl(var(--ring));
}

/* Sync Button */
.sync-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: white;
  background: hsl(var(--primary));
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(139, 0, 0, 0.2);
}

.sync-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(139, 0, 0, 0.3);
  filter: brightness(1.1);
}

.sync-button:active:not(:disabled) {
  transform: translateY(0);
}

.sync-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Scroll Area */
.analytics-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 1rem 1rem;
}

.analytics-scroll::-webkit-scrollbar {
  width: 6px;
}
.analytics-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.analytics-scroll::-webkit-scrollbar-thumb {
  background: hsl(var(--muted));
  border-radius: 3px;
}

.analytics-content {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Typography Utilities */
.text-sm {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
.text-xs {
  font-size: 0.75rem;
  line-height: 1rem;
}
.text-3xl {
  font-size: 1.875rem;
  line-height: 2.25rem;
}
.text-2xl {
  font-size: 1.5rem;
  line-height: 2rem;
}
.text-base {
  font-size: 0.9375rem;
  line-height: 1.375rem;
}

.font-semibold {
  font-weight: 600;
}
.font-bold {
  font-weight: 700;
}
.font-normal {
  font-weight: 400;
}
.font-medium {
  font-weight: 500;
}
.uppercase {
  text-transform: uppercase;
}
.tracking-wider {
  letter-spacing: 0.05em;
}
.tracking-tight {
  letter-spacing: -0.025em;
}
.text-muted-foreground {
  color: hsl(var(--muted-foreground));
}
.text-primary {
  color: hsl(var(--primary));
}
.text-warning {
  color: hsl(var(--chart-5));
}
.text-accent {
  color: hsl(var(--chart-4));
}
.text-destructive {
  color: hsl(var(--destructive));
}
.mb-1 {
  margin-bottom: 0.25rem;
}
.mb-3 {
  margin-bottom: 0.75rem;
}
.mb-4 {
  margin-bottom: 1rem;
}
.mb-5 {
  margin-bottom: 1.25rem;
}
.flex {
  display: flex;
}
.items-center {
  align-items: center;
}
.items-start {
  align-items: flex-start;
}
.justify-between {
  justify-content: space-between;
}
.mt-1 {
  margin-top: 0.25rem;
}
.mt-2 {
  margin-top: 0.5rem;
}
.mt-3 {
  margin-top: 0.75rem;
}
.mt-4 {
  margin-top: 1rem;
}
.ml-1 {
  margin-left: 0.25rem;
}
.metrics-grid {
  width: 100%;
}

.metrics-section {
  max-width: 1400px; /* Aligned with .analytics-content */
  width: 100%;
}

.grid {
  display: grid;
}
.gap-2 {
  gap: 0.5rem;
}
.gap-3 {
  gap: 0.75rem;
}
.gap-4 {
  gap: 1rem;
}
.gap-6 {
  gap: 1.5rem;
}
.h-4 {
  height: 1rem;
}
.w-4 {
  width: 1rem;
}

@media (min-width: 640px) {
  .sm\:grid-cols-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 768px) {
  .md\:grid-cols-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 1024px) {
  .lg\:grid-cols-5 {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .lg\:grid-cols-4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .lg\:grid-cols-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* Glass Card Component */
.glass-card {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(25px) saturate(180%);
  -webkit-backdrop-filter: blur(25px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 1.5rem;
  position: relative;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.kpi-card {
  border-left: 4px solid transparent;
}

.kpi-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  border-left-color: var(--card-theme-color);
  background: rgba(255, 255, 255, 0.6);
}

.glass-card .lucide {
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.glass-card:hover .lucide {
  transform: scale(1.1);
}

.text-xl {
  font-size: 1.25rem;
  line-height: 1.75rem;
}
.icon-badge {
  display: none;
}

.glass-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.8), transparent);
}

.kpi-card-padding {
  padding: 1.25rem;
  width: 100%;
}

/* Animations */
.animate-fade-in {
  animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-staggered {
  opacity: 0;
  animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.stat-glow {
  position: relative;
}
.stat-glow::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100%;
  background: linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.02) 100%);
  z-index: -1;
  pointer-events: none;
}

/* Chart Containers Container */
.h-\[280px\] {
  height: 280px;
}
.h-\[300px\] {
  height: 300px;
}

canvas {
  /* Ensure canvas fits perfectly */
  display: block;
  width: 100% !important;
  height: 100% !important;
}

/* Error/Loading States */
.error-banner {
  margin: 2rem auto;
  max-width: 800px;
  padding: 1rem 1.5rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 0.5rem;
  color: #f87171;
  text-align: center;
}

.access-denied {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  color: hsl(var(--muted-foreground));
}

/* High Value Alerts */
.alerts-section {
  display: block;
}
.high-value-banner {
  background: linear-gradient(145deg, rgba(139, 0, 0, 0.05) 0%, rgba(255, 255, 255, 0.7) 100%);
  border: 1px solid rgba(139, 0, 0, 0.1);
  border-radius: 0.75rem;
  padding: 1.5rem;
}
.banner-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.banner-icon {
  font-size: 1.5rem;
}
.banner-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: hsl(var(--foreground));
}
.banner-desc {
  margin: 0;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}
.banner-items {
  display: grid;
  gap: 0.75rem;
}
@media (min-width: 768px) {
  .banner-items {
    grid-template-columns: repeat(2, 1fr);
  }
}
.hv-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 0.5rem;
}
.hv-rf {
  font-family: monospace;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
}
.hv-dept {
  color: hsl(var(--foreground));
  font-size: 0.875rem;
  font-weight: 500;
}
.hv-amount {
  font-weight: 700;
  color: hsl(var(--primary));
}
.hv-link {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
  text-decoration: none;
}
.hv-link:hover {
  color: hsl(var(--foreground));
}

/* ===========================
   Premium Sync Modal
   =========================== */
.sync-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.sync-modal-card {
  position: relative;
  width: 100%;
  max-width: 26rem;
  background: #ffffff;
  border-radius: 1.5rem;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow:
    0 32px 64px -12px rgba(0, 0, 0, 0.2),
    0 0 0 1px rgba(255, 255, 255, 0.6) inset;
  overflow: hidden;
  padding: 2.25rem 2rem 2rem;
}

.sync-modal-orb {
  position: absolute;
  top: -60px;
  right: -60px;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(139, 0, 0, 0.08) 0%, transparent 70%);
  pointer-events: none;
}

.sync-modal-inner {
  display: flex;
  align-items: flex-start;
  gap: 1.25rem;
}

.sync-modal-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 3rem;
  height: 3rem;
  border-radius: 0.875rem;
  background: linear-gradient(135deg, rgba(139, 0, 0, 0.12) 0%, rgba(139, 0, 0, 0.04) 100%);
  border: 1px solid rgba(139, 0, 0, 0.15);
  margin-top: 0.125rem;
}

.sync-modal-icon-svg {
  width: 1.25rem;
  height: 1.25rem;
  color: #8b0000;
  stroke-width: 2;
}

.sync-modal-right {
  flex: 1;
  min-width: 0;
}

.sync-modal-eyebrow {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #8b0000;
  margin: 0 0 0.5rem;
}

.sync-modal-title {
  font-size: 1.3rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #0f172a;
  margin: 0 0 0.75rem;
  line-height: 1.2;
}

.sync-modal-desc {
  font-size: 0.85rem;
  line-height: 1.65;
  color: #64748b;
  margin: 0;
}

.sync-modal-desc strong {
  color: #0f172a;
  font-weight: 600;
}

.sync-modal-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.07), transparent);
  margin-bottom: 1.5rem;
}

.sync-modal-actions {
  display: flex;
  gap: 0.75rem;
}

.sync-btn-cancel {
  flex: 1;
  padding: 0.7rem 1rem;
  border-radius: 0.75rem;
  border: 1.5px solid #e2e8f0;
  background: transparent;
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
}

.sync-btn-cancel:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #0f172a;
}

.sync-btn-confirm {
  flex: 1.5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
  border-radius: 0.75rem;
  border: none;
  background: linear-gradient(135deg, #8b0000 0%, #c0392b 100%);
  font-size: 0.875rem;
  font-weight: 700;
  color: white;
  cursor: pointer;
  letter-spacing: 0.01em;
  box-shadow:
    0 4px 14px rgba(139, 0, 0, 0.35),
    0 0 0 1px rgba(255, 255, 255, 0.15) inset;
  transition: all 0.2s ease;
  font-family: inherit;
}

.sync-btn-confirm:hover {
  transform: translateY(-1px);
  box-shadow:
    0 8px 20px rgba(139, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.2) inset;
  filter: brightness(1.05);
}

.sync-btn-confirm:active {
  transform: translateY(0);
}

.sync-btn-icon {
  width: 0.875rem;
  height: 0.875rem;
  stroke-width: 2.5;
}

/* Modal Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.25s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.animate-modal-enter {
  animation: modalEnter 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes modalEnter {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(16px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
