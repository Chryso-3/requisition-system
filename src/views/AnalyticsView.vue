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

  // Trend chart: ALWAYS show Jan-Dec of the current year for "Strategic" context
  const trendMonths = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), i, 1)
    trendMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const monthlyTrend = trendMonths.map((key) => {
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
      avgDays:
        durFiltered.count > 0 ? (durFiltered.totalMs / durFiltered.count / 86400000).toFixed(2) : 0,
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
  return (
    d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
}

function renderCharts() {
  if (!data.value) return
  destroyCharts()

  const defaultFont = '"DM Sans", "Inter", system-ui, -apple-system, sans-serif'
  const gridColor = 'rgba(15, 23, 42, 0.06)'
  const tickColor = '#94a3b8' // slate-400
  const cardBgColor = '#0f172a'
  const tooltipBorder = 'rgba(255,255,255,0.08)'

  // Premium tooltip config shared across all charts
  const premiumTooltip = {
    backgroundColor: '#0f172a',
    titleColor: '#f1f5f9',
    bodyColor: '#94a3b8',
    borderColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    padding: { x: 14, y: 10 },
    cornerRadius: 12,
    titleFont: { family: defaultFont, size: 12, weight: '600' },
    bodyFont: { family: defaultFont, size: 12 },
    displayColors: true,
    boxWidth: 8,
    boxHeight: 8,
    boxPadding: 4,
  }

  const getStageColor = (status) => {
    const stageColors = {
      pending_recommendation: '#818cf8', // indigo-400
      pending_inventory: '#818cf8', // indigo-400
      pending_budget: '#818cf8', // indigo-400
      pending_audit: '#818cf8', // indigo-400
      pending_approval: '#818cf8', // indigo-400
      approved: '#10b981', // emerald-500
      rejected: '#f43f5e', // rose-500
    }
    return stageColors[status] || '#cbd5e1' // slate-300
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
      : ['#5eead4', '#2dd4bf', '#14b8a6', '#0f766e'] // Subtle teal gradient for PO

    // Build gradient fills per bar
    const pipelineCtx = pipelineEl.getContext('2d')
    const gradientColors = chartColors.map((color) => {
      const g = pipelineCtx.createLinearGradient(0, 0, pipelineEl.width || 400, 0)
      g.addColorStop(0, color)
      g.addColorStop(1, color + 'bb')
      return g
    })

    chartPipeline = new Chart(pipelineEl, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: isReq ? 'Requisitions' : 'Purchase Orders',
            data: chartData.map((p) => p.count),
            backgroundColor: gradientColors,
            barThickness: 18,
            borderRadius: 99,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { left: 0, right: 16, top: 6, bottom: 6 } },
        plugins: {
          legend: { display: false },
          tooltip: { ...premiumTooltip },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11, family: defaultFont }, color: tickColor },
            grid: { color: gridColor, drawBorder: false, tickLength: 0 },
            border: { display: false },
          },
          y: {
            ticks: { font: { size: 11, family: defaultFont }, color: tickColor, padding: 4 },
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
    const deptCtx = deptEl.getContext('2d')
    const deptGradient = deptCtx.createLinearGradient(0, 0, 0, 280)
    deptGradient.addColorStop(0, '#6366f1')
    deptGradient.addColorStop(1, '#818cf8aa')
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
            backgroundColor: deptGradient,
            barThickness: 28,
            borderRadius: { topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 },
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
            ...premiumTooltip,
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
            backgroundColor: ['#10b981', '#f43f5e'],
            borderWidth: 3,
            borderColor: '#ffffff',
            hoverOffset: 8,
            hoverBorderColor: '#ffffff',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: 16 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { size: 12, family: defaultFont, weight: '500' },
              color: '#475569',
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
            },
          },
          tooltip: { ...premiumTooltip },
        },
        cutout: '68%',
      },
    })
  }

  const trendEl = document.getElementById('chart-trend')
  if (trendEl && data.value.monthlyTrend?.length) {
    const trend = data.value.monthlyTrend
    const trendCtx = trendEl.getContext('2d')
    const volumeGradient = trendCtx.createLinearGradient(0, 0, 0, 300)
    volumeGradient.addColorStop(0, 'rgba(99, 102, 241, 0.18)')
    volumeGradient.addColorStop(1, 'rgba(99, 102, 241, 0)')
    const burnGradient = trendCtx.createLinearGradient(0, 0, 0, 300)
    burnGradient.addColorStop(0, 'rgba(20, 184, 166, 0.15)')
    burnGradient.addColorStop(1, 'rgba(20, 184, 166, 0)')
    chartTrend = new Chart(trendEl, {
      type: 'line',
      data: {
        labels: trend.map((t) => t.monthLabel),
        datasets: [
          {
            label: 'Volume (Requests)',
            data: trend.map((t) => t.total),
            borderColor: '#6366f1',
            borderWidth: 2.5,
            backgroundColor: volumeGradient,
            fill: true,
            tension: 0.45,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: '#6366f1',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            yAxisID: 'y',
          },
          {
            label: 'Financial Burn (₱)',
            data: trend.map((t) => t.value),
            borderColor: '#14b8a6',
            borderWidth: 2.5,
            backgroundColor: burnGradient,
            fill: true,
            tension: 0.45,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: '#14b8a6',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 8, right: 16, left: 0, bottom: 5 } },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
              boxHeight: 8,
              font: { size: 12, family: defaultFont, weight: '500' },
              color: '#64748b',
              padding: 20,
            },
          },
          tooltip: {
            ...premiumTooltip,
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed.y
                if (ctx.datasetIndex === 0) return `  Volume : ${val}`
                return `  Burn ($) : ${formatPeso(val)}`
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
      gradient.addColorStop(0, '#f43f5e') // rose-500
      gradient.addColorStop(1, '#fb7185') // rose-400
    } else {
      gradient.addColorStop(0, '#14b8a6') // teal-500
      gradient.addColorStop(1, '#2dd4bf') // teal-400
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
              if (days >= 3) return '#f43f5e' // rose-500
              if (days >= 1) return '#fbbf24' // amber-400
              return '#34d399' // emerald-400
            }),
            borderRadius: 5,
            barThickness: 12,
          },
          {
            label: 'Current Active Aging',
            data: bn.map((b) => Math.max(0, parseFloat(b.activeAvgDays) || 0)),
            backgroundColor: bn.map((b) => {
              const days = parseFloat(b.activeAvgDays) || 0
              if (days >= 3) return '#e11d48' // rose-600
              if (days >= 1) return '#f59e0b' // amber-500
              return '#10b981' // emerald-500
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
            ...premiumTooltip,
            callbacks: {
              label: (ctx) => {
                const b = bn[ctx.dataIndex]
                if (ctx.datasetIndex === 0) return `  Historical Avg: ${b.avgDays} d`
                return `  Active Aging: ${b.activeAvgDays} d (${b.activeCount} items)`
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
    const finCtx = financialEl.getContext('2d')
    const finGradient = finCtx.createLinearGradient(400, 0, 0, 0)
    finGradient.addColorStop(0, '#14b8a6')
    finGradient.addColorStop(1, '#14b8a6aa')
    chartFinancials = new Chart(financialEl, {
      type: 'bar',
      data: {
        labels: fs.map((f) => safeAbbreviate(f.department)),
        datasets: [
          {
            label: 'Total Spend (₱)',
            data: fs.map((f) => f.total),
            backgroundColor: finGradient,
            borderRadius: { topRight: 8, bottomRight: 8, topLeft: 0, bottomLeft: 0 },
            barThickness: 22,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { left: 0, right: 16, top: 4, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...premiumTooltip,
            callbacks: {
              label: (ctx) => `  Spend: ${formatPeso(ctx.parsed.x)}`,
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
            ticks: { font: { size: 11, family: defaultFont }, color: tickColor, padding: 4 },
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
                    class="text-lg font-extrabold tracking-tight text-slate-900 mb-2"
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
                    class="text-lg font-extrabold tracking-tight text-slate-900 mb-2"
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
              <h3 class="text-lg font-extrabold tracking-tight text-slate-900 mb-2">
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
              <h3 class="text-lg font-extrabold tracking-tight text-slate-900 mb-2">
                By Department
              </h3>
              <p class="text-xs text-muted-foreground mb-5">
                Requisitions per department in selected period (realtime)
              </p>
              <div class="flex-1 w-full relative min-h-[250px]">
                <canvas id="chart-department"></canvas>
              </div>
            </div>

            <div class="glass-card animate-fade-in lg:col-span-2" style="animation-delay: 550ms">
              <h3 class="text-lg font-extrabold tracking-tight text-slate-900 mb-2">
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
                    class="text-lg font-extrabold tracking-tight text-slate-900 mb-2"
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
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');

/* ── Premium Design System ── */
.jinja {
  --background: 210 20% 98%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --primary: 0 100% 27%;
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

  --chart-1: 0 100% 27%;
  --chart-2: 0 80% 40%;
  --chart-3: 12 76% 61%;
  --chart-4: 173 58% 39%;
  --chart-5: 43 74% 66%;

  --glass-border: rgba(0, 0, 0, 0.07);
  --glass-bg: rgba(255, 255, 255, 0.72);
  --glass-shadow: 0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 4px rgba(0, 0, 0, 0.04);
  --card-radius: 18px;
  --font-main: 'DM Sans', system-ui, -apple-system, sans-serif;
}
.analytics-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background-color: hsl(var(--background));
  background-image:
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139, 0, 0, 0.04) 0%, transparent 60%),
    linear-gradient(180deg, hsl(210, 20%, 98%) 0%, hsl(214, 20%, 97%) 100%);
  color: hsl(var(--foreground));
  font-family: var(--font-main);
  overflow: hidden;
}

/* Mini Switcher for Cards */
.mini-switcher {
  display: inline-flex;
  background: rgba(0, 0, 0, 0.04);
  padding: 3px;
  border-radius: 10px;
  gap: 2px;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.mini-switcher button {
  padding: 4px 12px;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-main);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 7px;
  transition: all 0.2s ease;
}

.mini-switcher button.active {
  background: white;
  color: #8b0000;
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.1),
    0 1px 0 rgba(255, 255, 255, 0.9) inset;
}

/* Page Header */
.page-header {
  flex-shrink: 0;
  padding: 1.25rem 2rem;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9),
    0 2px 12px rgba(0, 0, 0, 0.04);
  position: relative;
  z-index: 10;
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
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: hsl(var(--foreground));
  font-family: var(--font-main);
}

.page-subtitle {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: hsl(var(--muted-foreground));
  font-weight: 400;
  letter-spacing: 0.01em;
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
  padding: 0.3rem 0.75rem;
  font-size: 0.7rem;
  font-weight: 700;
  font-family: var(--font-main);
  color: #059669;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.18);
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  box-shadow: 0 1px 4px rgba(16, 185, 129, 0.1);
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
  padding: 0.45rem 2.5rem 0.45rem 0.9rem;
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: var(--font-main);
  color: hsl(var(--foreground));
  background-color: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  cursor: pointer;
  min-width: 150px;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9' /%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1rem;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  transition: all 0.2s ease;
}

.filter-select:hover {
  border-color: rgba(0, 0, 0, 0.18);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.filter-select:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px rgba(139, 0, 0, 0.1);
}

/* Sync Button */
.sync-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 1.1rem;
  font-size: 0.8125rem;
  font-weight: 600;
  font-family: var(--font-main);
  color: white;
  background: linear-gradient(135deg, #8b0000 0%, #b91c1c 100%);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  letter-spacing: 0.01em;
  transition: all 0.2s ease;
  box-shadow:
    0 4px 14px rgba(139, 0, 0, 0.25),
    0 1px 0 rgba(255, 255, 255, 0.15) inset;
}

.sync-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 8px 20px rgba(139, 0, 0, 0.35),
    0 1px 0 rgba(255, 255, 255, 0.15) inset;
  filter: brightness(1.08);
}

.sync-button:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(139, 0, 0, 0.2);
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
  padding: 1.5rem 1.5rem;
}

.analytics-scroll::-webkit-scrollbar {
  width: 5px;
}
.analytics-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.analytics-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 99px;
}
.analytics-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
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
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(30px) saturate(200%);
  -webkit-backdrop-filter: blur(30px) saturate(200%);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 8px 32px rgba(0, 0, 0, 0.06),
    0 2px 8px rgba(0, 0, 0, 0.04);
  border-radius: var(--card-radius);
  padding: 1.5rem;
  position: relative;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.glass-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.95) 50%,
    transparent 100%
  );
  pointer-events: none;
}

.glass-card:hover {
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 20px 48px rgba(0, 0, 0, 0.1),
    0 4px 12px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.75);
}

.kpi-card {
  border-left: 3px solid transparent;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.kpi-card:hover {
  transform: translateY(-4px);
  border-left-color: var(--card-theme-color, hsl(var(--primary)));
  background: rgba(255, 255, 255, 0.85);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 16px 40px rgba(0, 0, 0, 0.1),
    0 4px 12px rgba(0, 0, 0, 0.06);
}

.glass-card .lucide {
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.glass-card:hover .lucide {
  transform: scale(1.15) rotate(-4deg);
}

.text-xl {
  font-size: 1.35rem;
  line-height: 1.75rem;
  font-family: var(--font-main);
}

.icon-badge {
  display: none;
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

/* Chart Containers */
.h-\[280px\] {
  height: 280px;
  flex: none;
}
.h-\[300px\] {
  height: 300px;
  flex: none;
}
.h-\[240px\] {
  height: 240px;
  flex: none;
}

canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

/* Chart card label upgrades */
.glass-card h3 {
  font-family: var(--font-main);
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #0f172a;
  margin: 0 0 0.4rem;
}

/* KPI stat numbers — monospaced for data clarity */
.kpi-card .text-xl {
  font-family: 'DM Mono', 'Fira Code', monospace;
  font-size: 1.6rem !important;
  line-height: 1.2;
  letter-spacing: -0.03em;
  font-weight: 500;
}

/* Section gap */
.section {
  gap: 1.25rem;
}

/* Error/Loading States */
.error-banner {
  margin: 2rem auto;
  max-width: 800px;
  padding: 1rem 1.5rem;
  background: rgba(239, 68, 68, 0.07);
  border: 1px solid rgba(239, 68, 68, 0.18);
  border-radius: 12px;
  color: #dc2626;
  text-align: center;
  font-family: var(--font-main);
  font-size: 0.875rem;
}

.access-denied {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  color: hsl(var(--muted-foreground));
  font-family: var(--font-main);
}

/* High Value Alerts */
.alerts-section {
  display: block;
}
.high-value-banner {
  background: linear-gradient(145deg, rgba(139, 0, 0, 0.04) 0%, rgba(255, 255, 255, 0.72) 100%);
  border: 1px solid rgba(139, 0, 0, 0.09);
  border-radius: var(--card-radius);
  padding: 1.5rem;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
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
