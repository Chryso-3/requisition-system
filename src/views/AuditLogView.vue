<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  listAuditLogEntries,
  getRequisition,
  deleteTransactionLogEntry,
} from '@/services/requisitionService'
import { USER_ROLES, REQUISITION_STATUS, USER_ROLE_LABELS } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import PaginationComponent from '@/components/PaginationComponent.vue'

const PAGE_SIZE = 50
const REQUEST_TIMEOUT = 10000

const router = useRouter()
const authStore = useAuthStore()
const logEntries = ref([])
const loading = ref(true)
const error = ref(null)
const pageSize = ref(10) // UI Journeys per page
const currentPage = ref(1)
const lastDoc = ref(null)
const hasMore = ref(true)
const tableContainer = ref(null)
const expandedRows = ref([])
const requisitionStatusMap = ref({})
const showHowToRead = ref(false)
const showDownloadConfirmModal = ref(false)
const deletingLogs = ref(false)
const downloadLogError = ref(null)

const statusLabel = {
  [REQUISITION_STATUS.DRAFT]: 'Draft',
  [REQUISITION_STATUS.PENDING_RECOMMENDATION]: 'Pending Section Head',
  [REQUISITION_STATUS.PENDING_INVENTORY]: 'Pending Warehouse',
  [REQUISITION_STATUS.PENDING_BUDGET]: 'Pending Budget',
  [REQUISITION_STATUS.PENDING_AUDIT]: 'Pending Audit',
  [REQUISITION_STATUS.PENDING_APPROVAL]: 'Pending GM',
  [REQUISITION_STATUS.APPROVED]: 'Approved',
  [REQUISITION_STATUS.REJECTED]: 'Rejected',
}

// Logs are view-only for both Internal Auditor and General Manager
const canViewLogs = computed(
  () =>
    authStore.role === USER_ROLES.INTERNAL_AUDITOR ||
    authStore.role === USER_ROLES.GENERAL_MANAGER ||
    authStore.role === USER_ROLES.SUPER_ADMIN,
)
// Download (CSV) and delete-from-database is Internal Auditor only
const canDownloadAndDeleteLog = computed(
  () => authStore.role === USER_ROLES.INTERNAL_AUDITOR || authStore.role === USER_ROLES.SUPER_ADMIN,
)

// Action filter: show all | approver actions | purchaser actions
const purchaseFilter = ref('all')
// Search by RF Control No. (partial, case-insensitive)
const rfSearchQuery = ref('')
// Date range for log: All time | Today | This month | Custom
const logDatePreset = ref('all')
const logStartDate = ref('')
const logEndDate = ref('')
const showLogCustomRange = ref(false)
const draftLogStart = ref('')
const draftLogEnd = ref('')

function setLogToday() {
  const now = new Date()
  const iso = now.toISOString().slice(0, 10)
  logStartDate.value = iso
  logEndDate.value = iso
}
function setLogThisMonth() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  logStartDate.value = new Date(y, m, 1).toISOString().slice(0, 10)
  logEndDate.value = new Date(y, m + 1, 0).toISOString().slice(0, 10)
}
function clearLogDates() {
  logStartDate.value = ''
  logEndDate.value = ''
}
watch(logDatePreset, (v) => {
  if (v === 'all') clearLogDates()
  else if (v === 'today') setLogToday()
  else if (v === 'this_month') setLogThisMonth()
  else if (v === 'custom') {
    setLogThisMonth()
    draftLogStart.value = logStartDate.value
    draftLogEnd.value = logEndDate.value
    showLogCustomRange.value = true
  }
})

function closeLogCustomRange() {
  showLogCustomRange.value = false
  if (logDatePreset.value === 'custom') logDatePreset.value = 'all'
}

function applyLogCustomRange() {
  logStartDate.value = draftLogStart.value || ''
  logEndDate.value = draftLogEnd.value || ''
  showLogCustomRange.value = false
  logDatePreset.value = 'custom'
}

// Reset to page 1 when filter or search changes
watch([purchaseFilter, rfSearchQuery, logDatePreset, logStartDate, logEndDate, pageSize], () => {
  currentPage.value = 1
})

function entrySignedAt(entry) {
  const v = entry.signedAt
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const filteredLogEntries = computed(() => {
  let list = logEntries.value
  if (purchaseFilter.value === 'purchaser') {
    list = list.filter((e) => {
      const step = (e.step || '').toLowerCase()
      const action = (e.action || '').toLowerCase()
      return (
        e.purchaseStatus ||
        e.poStatus ||
        step === 'purchaser' ||
        step.startsWith('po_') ||
        action.startsWith('po_')
      )
    })
  } else if (purchaseFilter.value === 'approver') {
    list = list.filter((e) => {
      const step = (e.step || '').toLowerCase()
      const action = (e.action || '').toLowerCase()
      const isProcurement =
        e.purchaseStatus ||
        e.poStatus ||
        step === 'purchaser' ||
        step.startsWith('po_') ||
        action.startsWith('po_')
      return !isProcurement
    })
  }
  const q = (rfSearchQuery.value || '').trim().toLowerCase()
  if (q) {
    list = list.filter((e) => {
      const rf = (e.rfControlNo ?? '').toString().toLowerCase()
      const id = (e.requisitionId ?? '').toString().toLowerCase()
      return rf.includes(q) || id.includes(q)
    })
  }
  const start = logStartDate.value ? new Date(logStartDate.value + 'T00:00:00') : null
  const end = logEndDate.value ? new Date(logEndDate.value + 'T23:59:59.999') : null
  if (!start || !end) return list
  return list.filter((e) => {
    const d = entrySignedAt(e)
    if (!d) return false
    if (d < start) return false
    if (d > end) return false
    return true
  })
})

function formatScopeDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}
function formatScopeMonth(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}
const downloadScopeLabel = computed(() => {
  const preset = logDatePreset.value
  if (preset === 'all') return 'All time'
  if (preset === 'today' && logStartDate.value)
    return `Today (${formatScopeDate(logStartDate.value)})`
  if (preset === 'this_month' && logStartDate.value)
    return `This month (${formatScopeMonth(logStartDate.value)})`
  if (preset === 'custom' && logStartDate.value && logEndDate.value)
    return `${formatScopeDate(logStartDate.value)} â€“ ${formatScopeDate(logEndDate.value)}`
  if (preset === 'today') return 'Today'
  if (preset === 'this_month') return 'This month'
  if (preset === 'custom') return 'Custom range'
  return 'Current filter'
})

const totalEntries = computed(() => filteredLogEntries.value.length)

// Requisition-First Journaling Logic: Grouping entries by Requisition ID
const journaledJourneys = computed(() => {
  const journeys = []

  // 1. Group FILTERED entries by requisitionId to find full journeys
  const map = {}
  filteredLogEntries.value.forEach((entry) => {
    if (!map[entry.requisitionId]) {
      map[entry.requisitionId] = {
        requisitionId: entry.requisitionId,
        rfControlNo: entry.rfControlNo,
        purpose: entry.purpose,
        latestAt: entry.signedAt,
        entries: [],
      }
    }
    map[entry.requisitionId].entries.push(entry)
    // Update latest timestamp if needed (though they are usually sorted desc)
    if (new Date(entry.signedAt) > new Date(map[entry.requisitionId].latestAt)) {
      map[entry.requisitionId].latestAt = entry.signedAt
    }
  })

  // 2. Convert map to list and sort by latest action
  return Object.values(map).sort((a, b) => new Date(b.latestAt) - new Date(a.latestAt))
})

const totalJourneys = computed(() => journaledJourneys.value.length)
const totalJournalPages = computed(() => Math.ceil(totalJourneys.value / pageSize.value) || 1)

const paginatedJourneys = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return journaledJourneys.value.slice(start, start + pageSize.value)
})

function handlePageChange(p) {
  currentPage.value = p

  // Smooth scroll back to top of table
  if (tableContainer.value) {
    tableContainer.value.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // If we are reaching the end of the buffered log entries, load more from Firestore
  if (p * pageSize.value > journaledJourneys.value.length - 15 && hasMore.value && !loading.value) {
    loadMore()
  }
}

const groupedJourneys = computed(() => {
  const groups = []
  paginatedJourneys.value.forEach((journey) => {
    const d = new Date(journey.latestAt)
    const dateStr = d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    let group = groups.find((g) => g.date === dateStr)
    if (!group) {
      group = { date: dateStr, label: getDateLabel(d), journeys: [] }
      groups.push(group)
    }
    group.journeys.push(journey)
  })
  return groups
})

// Watchers handled by handlePageChange and reset logic

function getDateLabel(date) {
  const now = new Date()
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  now.setHours(0, 0, 0, 0)
  const diff = (now - d) / (1000 * 60 * 60 * 24)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Journey Trail Helpers
function getJourneyTrail(journey) {
  const status = journey.entries[0]?.statusAfter || 'draft'
  const steps = [
    { label: 'Dept', status: 'pending_recommendation' },
    { label: 'Whse', status: 'pending_inventory' },
    { label: 'Budget', status: 'pending_budget' },
    { label: 'Audit', status: 'pending_audit' },
    { label: 'GM', status: 'pending_approval' },
    { label: 'Approved', status: 'approved' },
  ]

  const currentIndex = steps.findIndex((s) => s.status === status)
  return steps.map((s, idx) => ({
    ...s,
    active: idx === currentIndex,
    done: idx < currentIndex || status === 'approved',
    failed: status === 'rejected' && idx === currentIndex,
  }))
}

function timeSince(date, relativeTo) {
  const d = new Date(date)
  const rel = relativeTo ? new Date(relativeTo) : new Date()
  const diffMs = Math.abs(rel - d)
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins}m`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h`
  return `${Math.floor(diffHours / 24)}d`
}

function getVelocity(journey) {
  if (journey.entries.length < 2) return null
  const first = new Date(journey.entries[journey.entries.length - 1].signedAt)
  const latest = new Date(journey.latestAt)
  const diff = Math.floor((latest - first) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Processing'
  return `${diff} day turn-around`
}

// UTILITY FUNCTIONS - No more code duplication!
function withTimeout(promise, ms = REQUEST_TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
  ])
}

function mapLogEntry(entry, index) {
  return {
    id: entry.id,
    requisitionId: entry.requisitionId,
    rfControlNo: entry.rfControlNo ?? entry.requisitionId ?? 'â€”',
    purpose:
      (entry.purpose ?? '').slice(0, 50) + ((entry.purpose ?? '').length > 50 ? 'â€¦' : '') ||
      'â€”',
    action: entry.action,
    step: entry.step ?? '',
    name: entry.name ?? 'â€”',
    title: entry.title ?? '',
    email: entry.email ?? '',
    purchaseStatus: entry.purchaseStatus ?? '',
    poNumber: entry.poNumber ?? '',
    signedAt: entry.signedAt,
    statusBefore: entry.statusBefore ?? '',
    statusAfter: entry.statusAfter ?? '',
    title: entry.title ?? '',
    remarks: entry.remarks ?? '',
    displayKey: `${index}-${entry.requisitionId ?? entry.rfControlNo ?? 'log'}`,
  }
}

/* Handled by PaginationComponent */

const UI_ROLE_LABELS = {
  ...USER_ROLE_LABELS,
  po_audit: 'Internal Auditor (PO)',
  po_budget: 'Budget Officer (PO)',
  po_gm: 'General Manager (PO)',
  purchase_order: 'Purchaser / BAC',
  purchaser_canvass: 'Purchaser (Canvass)',
}

function statusText(code) {
  return statusLabel[code] || code || 'â€”'
}

function stepLabel(entry) {
  if (entry.title) return entry.title
  return UI_ROLE_LABELS[entry.step] || entry.step || '—'
}

async function load() {
  loading.value = true
  error.value = null
  currentPage.value = 1
  lastDoc.value = null
  hasMore.value = true
  try {
    const logResult = await withTimeout(listAuditLogEntries({ pageSize: PAGE_SIZE }))
    logEntries.value = logResult.entries.map(mapLogEntry)
    lastDoc.value = logResult.lastDoc
    hasMore.value = logResult.hasMore
    // Show table immediately; fetch purchase details in background (non-blocking)
    loading.value = false
    updateRequisitionStatusMap()
  } catch (e) {
    error.value = e.message || 'Failed to load audit log.'
    loading.value = false
  }
}

async function loadMore() {
  if (!hasMore.value || loading.value) return

  loading.value = true
  error.value = null
  try {
    const result = await withTimeout(
      listAuditLogEntries({
        pageSize: PAGE_SIZE,
        startAfter: lastDoc.value,
      }),
    )

    const offset = logEntries.value.length
    const newEntries = result.entries.map((e, i) => mapLogEntry(e, offset + i))

    logEntries.value = [...logEntries.value, ...newEntries]
    lastDoc.value = result.lastDoc
    hasMore.value = result.hasMore
    loading.value = false
    // Fill purchase details in background
    updateRequisitionStatusMap()
  } catch (e) {
    error.value = e.message || 'Failed to load more entries.'
    loading.value = false
  }
}

function formatDate(val) {
  if (!val) return 'â€”'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function goToDetail(id) {
  router.push({ path: `/requisitions/${id}`, query: { from: 'audit-log' } })
}

function csvEscape(val) {
  const s = String(val ?? '')
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r'))
    return `"${s.replaceAll('"', '""')}"`
  return s
}

function buildAndDownloadLogCsv(entries) {
  if (!entries.length) return
  const cols = [
    'What happened',
    'RF Control No.',
    'Purpose',
    'Purchase',
    'Step',
    'Action',
    'By',
    'Email',
    'Status (from â†’ to)',
    'Date & time',
    'Remarks',
  ]
  const rows = entries.map((e) => {
    const from = statusText(e.statusBefore)
    const to = statusText(e.statusAfter)
    const statusChange = `${from} â†’ ${to}`
    const purchase =
      (
        e.purchaseStatus ||
        requisitionStatusMap.value[e.requisitionId]?.purchaseStatus ||
        ''
      ).replace(/^./, (c) => c.toUpperCase()) || 'â€”'
    return [
      whatHappened(e),
      e.rfControlNo ?? 'â€”',
      (e.purpose ?? 'â€”').replace(/\s+/g, ' ').trim(),
      purchase,
      stepLabel(e.step),
      badgeText(e),
      e.name ?? 'â€”',
      e.email ?? 'â€”',
      statusChange,
      formatDate(e.signedAt),
      (e.remarks ?? 'â€”').replace(/\s+/g, ' ').trim(),
    ]
  })
  const header = cols.map(csvEscape).join(',')
  const lines = rows.map((row) => row.map(csvEscape).join(','))
  const csv = `\uFEFF${header}\n${lines.join('\n')}\n`
  const scopeSlug = downloadScopeLabel.value.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
  const filename = `transaction_log_${scopeSlug || 'export'}_${new Date().toISOString().slice(0, 10)}.csv`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function openDownloadConfirmModal() {
  if (totalEntries.value === 0) return
  downloadLogError.value = null
  showDownloadConfirmModal.value = true
}

function closeDownloadConfirmModal() {
  if (!deletingLogs.value) {
    showDownloadConfirmModal.value = false
    downloadLogError.value = null
  }
}

async function executeDownloadThenDeleteLogs() {
  if (!canDownloadAndDeleteLog.value) return
  const entries = filteredLogEntries.value
  const withIds = entries.filter((e) => e.id)
  if (!withIds.length) {
    closeDownloadConfirmModal()
    return
  }
  deletingLogs.value = true
  downloadLogError.value = null
  try {
    buildAndDownloadLogCsv(entries)
    const idsToRemove = new Set(withIds.map((e) => e.id))
    for (const e of withIds) {
      await deleteTransactionLogEntry(e.id)
    }
    logEntries.value = logEntries.value.filter((e) => !idsToRemove.has(e.id))
    closeDownloadConfirmModal()
    showDownloadConfirmModal.value = false
  } catch (e) {
    downloadLogError.value = e?.message || 'Failed to delete log entries.'
  } finally {
    deletingLogs.value = false
  }
}

function isExpanded(key) {
  return expandedRows.value.includes(key)
}

function toggleExpand(key) {
  const i = expandedRows.value.indexOf(key)
  if (i === -1) expandedRows.value.push(key)
  else expandedRows.value.splice(i, 1)
}

// Purchase/action badge helpers
function badgeKey(entry) {
  const ps = (
    entry.purchaseStatus ||
    requisitionStatusMap.value[entry.requisitionId]?.purchaseStatus ||
    ''
  ).toLowerCase()
  if (ps === 'ordered' || ps === 'received') return ps
  if (ps === 'approved') return 'approved'
  if (ps === 'declined' || ps === 'rejected') return 'declined'

  const action = (entry.action || '').toLowerCase()
  if (
    action === 'approved' ||
    action === 'ordered' ||
    action === 'po_issued' ||
    action === 'received' ||
    action === 'declined'
  )
    return action === 'po_issued' ? 'ordered' : action
  return 'default'
}

function badgeText(entry) {
  const ps =
    entry.purchaseStatus || requisitionStatusMap.value[entry.requisitionId]?.purchaseStatus || ''
  if (ps) return ps.charAt(0).toUpperCase() + ps.slice(1)
  if ((entry.step === 'purchaser' || entry.step === 'purchase_order') && entry.action) {
    if (entry.action === 'ordered') return 'Ordered'
    if (entry.action === 'po_issued') return 'PO Issued'
    if (entry.action === 'received') return 'Received'
    if (entry.action === 'approved') return 'Approved'
    return entry.action.charAt(0).toUpperCase() + entry.action.slice(1)
  }
  if (entry.action) {
    if (entry.action === 'approved') return 'Approved'
    if (entry.action === 'declined' || entry.action === 'rejected') return 'Declined'
    if (entry.action === 'po_issued') return 'PO Issued'
    return entry.action.charAt(0).toUpperCase() + entry.action.slice(1)
  }
  return 'â€”'
}

/** One plain-language sentence: what happened in this log entry */
function whatHappened(entry) {
  const action = (entry.action || '').toLowerCase()
  const step = (entry.step || '').toLowerCase()
  const statusBefore = (entry.statusBefore || '').toLowerCase()
  const statusTo = (entry.statusAfter || '').toLowerCase()

  // Detection for the very first step (Draft -> Pending Recommendation)
  if (
    (statusBefore === 'draft' || !statusBefore) &&
    statusTo === REQUISITION_STATUS.PENDING_RECOMMENDATION.toLowerCase()
  ) {
    return 'Requisition Created'
  }

  if (step === 'purchaser' || step.includes('purchaser_') || step === 'purchase_order') {
    if (action === 'ordered' || action === 'po_issued') return 'PO Issued'
    if (action === 'received') return 'Items Received'
    if (action === 'declined') return 'Cancelled'
    return 'Purchaser Process'
  }

  if (action === 'po_approved') {
    if (step === 'po_budget') return 'PO Funds Certified'
    if (step === 'po_audit') return 'PO Pre-Audited'
    if (step === 'po_gm') return 'PO GM Approved'
    return 'PO Approved'
  }

  if (action === 'po_rejected') return 'Purchase Order Rejected'

  if (action === 'approved') {
    if (statusTo === REQUISITION_STATUS.APPROVED.toLowerCase()) return 'Requisition Fully Approved'
    return 'Phase Approval Granted'
  }

  if (action === 'declined') return 'Requisition Declined'

  if (action === 'ordered') return 'Purchase Order Issued'
  if (action === 'received') return 'Items Received & Logged'

  return 'Workflow Stage Updated'
}

async function updateRequisitionStatusMap() {
  const ids = Array.from(new Set(logEntries.value.map((e) => e.requisitionId).filter(Boolean)))
  const toFetch = ids.filter((id) => !requisitionStatusMap.value[id])
  if (toFetch.length === 0) return
  // Fetch in parallel for speed (table already visible; this fills Purchase column / details)
  const results = await Promise.all(toFetch.map((id) => getRequisition(id).catch(() => null)))
  toFetch.forEach((id, i) => {
    const r = results[i]
    requisitionStatusMap.value[id] = {
      purchaseStatus: r?.purchaseStatus ?? '',
      poNumber: r?.poNumber ?? '',
    }
  })
}

onMounted(load)
</script>

<template>
  <div class="audit-log-view jinja">
    <div v-if="!canViewLogs" class="access-denied">
      <p>This page is available to Internal Auditor, General Manager, and Super Administrator.</p>
    </div>

    <template v-else>
      <div class="page-header">
        <div class="header-main">
          <h1 class="page-title">Transaction Log</h1>
          <p class="page-subtitle">Digital accountability and tampering detection trail.</p>
        </div>
      </div>

      <div class="panel elite-panel animate-staggered" style="--order: 0">
        <div class="panel-header">
          <div class="panel-title-container">
            <div class="panel-pill">Security Trail</div>
            <h2 class="panel-title-text">
              Audit Journal <span class="count-chip">{{ totalJourneys }}</span>
            </h2>
          </div>

          <div class="panel-controls">
            <div class="toolbar-group-search">
              <svg
                class="search-icon-svg"
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                id="audit-log-rf-search"
                v-model.trim="rfSearchQuery"
                type="search"
                class="search-input"
                placeholder="Find RF-..."
                autocomplete="off"
              />
            </div>
            <select v-model="purchaseFilter" class="premium-select">
              <option value="all">All Journal Entries</option>
              <option value="approver">Approval Workflow</option>
              <option value="purchaser">Procurement & PO Flow</option>
            </select>
            <select v-model="logDatePreset" class="premium-select">
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="this_month">This month</option>
              <option value="custom">Custom...</option>
            </select>
            <button
              type="button"
              class="legend-toggle"
              :class="{ active: showHowToRead }"
              @click="showHowToRead = !showHowToRead"
            >
              <span class="legend-icon">ⓘ</span> Legend
            </button>

            <button
              v-if="canDownloadAndDeleteLog"
              type="button"
              class="btn-primary"
              @click="openDownloadConfirmModal"
            >
              Export
            </button>
          </div>

          <Transition name="legend-fade">
            <div v-if="showHowToRead" class="legend-popover" @click.stop>
              <h4 class="legend-title">How to Read the Log</h4>
              <div class="legend-section">
                <strong>Progress Trail</strong>
                <p>
                  The small bar under "Workflow Progress" shows how far along the Requisition is.
                  Red indicates a decline at that step.
                </p>
              </div>
              <div class="legend-section">
                <strong>Action Markers</strong>
                <div class="legend-row">
                  <span class="status-dot approved"></span> Success / Approval
                </div>
                <div class="legend-row"><span class="status-dot ordered"></span> PO Processing</div>
                <div class="legend-row">
                  <span class="status-dot received"></span> Items Received
                </div>
                <div class="legend-row"><span class="status-dot declined"></span> Declined</div>
                <div class="legend-row">
                  <span class="status-dot"></span> Initial Submission / Step
                </div>
              </div>
              <div class="legend-section">
                <strong>Detailed History</strong>
                <p>
                  Click on any row (▼) to expand and see the exact timestamps and comments for every
                  single action on that Requisition.
                </p>
              </div>
            </div>
          </Transition>
        </div>

        <div class="panel-body">
          <div v-if="error" class="error-message">{{ error }}</div>
          <div v-else-if="loading" class="loading-state">
            <div class="spinner"></div>
            <span>Syncing data...</span>
          </div>
          <div v-else-if="logEntries.length === 0" class="empty-state">No transactions yet.</div>

          <div v-else class="table-section" ref="tableContainer">
            <div class="table-container">
              <div
                v-if="showLogCustomRange"
                class="log-modal-overlay"
                @click.self="closeLogCustomRange"
              >
                <div class="log-modal-card">
                  <h3 class="log-modal-title">Custom Date Range</h3>
                  <div class="log-modal-fields">
                    <label><span>From</span><input v-model="draftLogStart" type="date" /></label>
                    <label><span>To</span><input v-model="draftLogEnd" type="date" /></label>
                  </div>
                  <div class="log-modal-actions">
                    <button type="button" class="btn-cancel" @click="closeLogCustomRange">
                      Cancel
                    </button>
                    <button type="button" class="btn-primary" @click="applyLogCustomRange">
                      Apply
                    </button>
                  </div>
                </div>
              </div>

              <!-- Download Modal -->
              <div
                v-if="showDownloadConfirmModal"
                class="log-modal-overlay"
                @click.self="closeDownloadConfirmModal"
              >
                <div class="log-modal-card">
                  <h3 class="log-modal-title">Export Log</h3>
                  <p class="log-modal-desc">
                    Exporting {{ totalEntries }} entries in current view.
                  </p>
                  <div class="log-modal-actions">
                    <button type="button" class="btn-cancel" @click="closeDownloadConfirmModal">
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="btn-primary"
                      @click="executeDownloadThenDeleteLogs"
                    >
                      Export & Delete
                    </button>
                  </div>
                </div>
              </div>

              <table class="data-table">
                <thead>
                  <tr class="glass-header">
                    <th style="width: 140px">RF Number</th>
                    <th style="width: 200px">Latest Action</th>
                    <th>Purpose</th>
                    <th style="width: 250px">Workflow Progress</th>
                    <th style="width: 140px; text-align: right">Date & Time</th>
                    <th style="width: 50px"></th>
                  </tr>
                </thead>
                <tbody v-for="group in groupedJourneys" :key="group.date">
                  <tr class="date-divider">
                    <td colspan="6">{{ group.label }}</td>
                  </tr>
                  <template v-for="journey in group.journeys" :key="journey.requisitionId">
                    <tr
                      class="journey-row"
                      :class="{ 'is-expanded': isExpanded(journey.requisitionId) }"
                      @click="toggleExpand(journey.requisitionId)"
                    >
                      <td class="rf-cell" @click.stop="goToDetail(journey.requisitionId)">
                        {{ journey.rfControlNo }}
                        <span class="velocity-tag" v-if="getVelocity(journey)"
                          >{{ getVelocity(journey).split(' ')[0] }}d</span
                        >
                      </td>
                      <td class="action-cell">
                        <span class="status-dot" :class="badgeKey(journey.entries[0])"></span>
                        {{ whatHappened(journey.entries[0]) }}
                      </td>
                      <td class="purpose-cell">{{ journey.purpose }}</td>
                      <td class="trail-cell">
                        <div class="mini-trail">
                          <div
                            v-for="(step, idx) in getJourneyTrail(journey)"
                            :key="idx"
                            class="mini-step"
                            :class="{ done: step.done, active: step.active, failed: step.failed }"
                            :title="step.label"
                          ></div>
                        </div>
                      </td>
                      <td class="time-cell">
                        <div class="time-cell-date">
                          {{ formatDate(journey.latestAt).split(',')[0] }}
                        </div>
                        <div>{{ formatDate(journey.latestAt).split(',')[1] }}</div>
                      </td>
                      <td class="toggle-cell">
                        <span class="chevron" :class="{ open: isExpanded(journey.requisitionId) }"
                          >▼</span
                        >
                      </td>
                    </tr>
                    <tr v-if="isExpanded(journey.requisitionId)" class="history-row">
                      <td colspan="6" class="history-cell">
                        <div class="compact-history">
                          <table class="sub-table">
                            <tr v-for="entry in journey.entries" :key="entry.displayKey">
                              <td style="width: 20px">
                                <div class="history-dot" :class="badgeKey(entry)"></div>
                              </td>
                              <td style="width: 150px">
                                <strong>{{ entry.name }}</strong>
                              </td>
                              <td style="width: 150px" class="muted">
                                {{ stepLabel(entry) }}
                              </td>
                              <td style="width: 120px" class="action-text" :class="badgeKey(entry)">
                                {{ badgeText(entry) }}
                              </td>
                              <td class="remarks-text">{{ entry.remarks || '-' }}</td>
                              <td style="width: 100px; text-align: right" class="muted">
                                {{ timeSince(entry.signedAt) }} ago
                              </td>
                            </tr>
                          </table>
                        </div>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>

              <div v-if="totalEntries === 0 && rfSearchQuery.trim()" class="empty-search">
                No results found for “{{ rfSearchQuery }}”.
              </div>
            </div>

            <PaginationComponent
              :current-page="currentPage"
              :total-pages="totalJournalPages"
              :page-size="pageSize"
              :total-items="totalJourneys"
              :loading="loading"
              @page-change="handlePageChange"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.jinja {
  --jinja-bg: #f8fafc;
  --jinja-surface: #ffffff;
  --jinja-border: #f1f5f9;
  --jinja-text: #0f172a;
  --jinja-muted: #64748b;
  --jinja-radius: 12px;
  --jinja-accent: #0ea5e9;
}

.audit-log-view {
  width: 100%;
  padding: 0.75rem 1.5rem 1.25rem;
  background: var(--jinja-bg);
  height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.page-header {
  margin-bottom: 1rem;
  flex-shrink: 0;
}

.page-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.025em;
}

.page-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: #64748b;
  font-weight: 500;
}

/* Panel Styling */
.panel {
  flex: 1;
  background: var(--jinja-surface);
  border: 1px solid var(--jinja-border);
  border-radius: var(--jinja-radius);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.panel-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--jinja-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  flex-shrink: 0;
  position: relative;
}

.panel-title-container {
  display: flex;
  flex-direction: column;
}

.panel-pill {
  display: inline-block;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #0ea5e9;
  background: #f0f9ff;
  padding: 0.25rem 0.625rem;
  border-radius: 9999px;
  margin-bottom: 0.5rem;
  width: fit-content;
}

.panel-title-text {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 800;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.count-chip {
  font-size: 0.75rem;
  background: #f1f5f9;
  color: #64748b;
  padding: 0.125rem 0.625rem;
  border-radius: 9999px;
  font-weight: 600;
}

.panel-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.toolbar-group-search {
  position: relative;
  width: 240px;
}

.search-icon-svg {
  position: absolute;
  left: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 0.5rem 0.75rem 0.5rem 2.25rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.875rem;
  background: #f8fafc;
  transition: all 0.2s;
}

.search-input:focus {
  outline: none;
  border-color: var(--jinja-accent);
  background: #fff;
}

.premium-select {
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.875rem;
  background: #fff;
  color: #1e293b;
  font-weight: 700;
  cursor: pointer;
}

.btn-primary {
  padding: 0.5rem 1rem;
  background: var(--jinja-accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s;
  cursor: pointer;
}

.btn-primary:hover {
  background: #0284c7;
  transform: translateY(-2px);
}

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.table-section {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-container {
  flex: 1;
  overflow-y: auto;
  position: relative;
  scrollbar-gutter: stable;
}

/* Custom Scrollbar */
.table-container::-webkit-scrollbar {
  width: 8px;
}
.table-container::-webkit-scrollbar-track {
  background: transparent;
}
.table-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 10px;
  border: 2px solid white;
}
.table-container::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/* Data Table */
.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.data-table th {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(249, 250, 251, 0.9);
  backdrop-filter: blur(8px);
  padding: 0.875rem 1rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 700;
  color: #4b5563;
  border-bottom: 2px solid #f3f4f6;
  white-space: nowrap;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

/* Date Divider */
.date-divider td {
  background: #f9fafb;
  padding: 0.5rem 1rem;
  font-size: 0.7rem;
  font-weight: 800;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #f3f4f6;
}

/* Journey Row */
.journey-row {
  cursor: pointer;
  transition: all 0.15s ease;
}

.journey-row td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: middle;
}

.journey-row:hover {
  background: #f9fafb;
}

.journey-row.is-expanded {
  background: #f0f9ff;
}

/* Cell Styles */
.rf-cell {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  color: var(--jinja-accent);
  display: flex;
  align-items: center;
  gap: 8px;
}

.velocity-tag {
  font-size: 0.65rem;
  background: #ecfdf5;
  color: #059669;
  padding: 2px 6px;
  border-radius: 4px;
}

.action-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #374151;
}

.purpose-cell {
  color: #6b7280;
  max-width: 250px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Mini Trail */
.mini-trail {
  display: flex;
  gap: 4px;
}

.mini-step {
  height: 6px;
  width: 24px;
  background: #e5e7eb;
  border-radius: 3px;
}

.mini-step.done {
  background: #10b981;
}

.mini-step.active {
  background: #3b82f6;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
}

.mini-step.failed {
  background: #ef4444;
}

.time-cell {
  text-align: right;
  font-size: 0.75rem;
  color: #9ca3af;
}

.time-cell-date {
  font-weight: 700;
  color: #4b5563;
}

.toggle-cell {
  color: #d1d5db;
  text-align: center;
}

.chevron {
  display: inline-block;
  transition: transform 0.2s;
}

.chevron.open {
  transform: rotate(180deg);
  color: var(--jinja-accent);
}

/* Status Dots */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d1d5db;
  flex-shrink: 0;
}

.status-dot.approved {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
}

.status-dot.ordered {
  background: #3b82f6;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.4);
}

.status-dot.received {
  background: #8b5cf6;
  box-shadow: 0 0 6px rgba(139, 92, 246, 0.4);
}

.status-dot.declined {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
}

/* History Row */
.history-row td {
  padding: 0;
  border-bottom: 2px solid #e5e7eb;
}

.history-cell {
  background: #f8fafc;
}

.compact-history {
  padding: 1.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.sub-table {
  width: 100%;
  border-collapse: collapse;
}

.sub-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #f1f5f9;
}

.history-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #d1d5db;
}

.history-dot.approved {
  background: #10b981;
}
.history-dot.ordered {
  background: #3b82f6;
}
.history-dot.received {
  background: #8b5cf6;
}
.history-dot.declined {
  background: #ef4444;
}

.action-text {
  font-weight: 700;
  font-size: 0.8125rem;
}

.action-text.approved {
  color: #10b981;
}
.action-text.ordered {
  color: #3b82f6;
}
.action-text.received {
  color: #8b5cf6;
}
.action-text.declined {
  color: #ef4444;
}

.remarks-text {
  font-size: 0.8125rem;
  color: #64748b;
  font-style: italic;
}

.muted {
  color: #94a3b8;
  font-size: 0.75rem;
  font-weight: 500;
}

/* Elite Glassmorphism for Audit Log */
.elite-panel {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(25px) saturate(180%);
  -webkit-backdrop-filter: blur(25px) saturate(180%);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

.animate-staggered {
  opacity: 0;
  animation: slideUpElite 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  animation-delay: calc(var(--order) * 0.1s);
}

@keyframes slideUpElite {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.journal-group-elite {
  opacity: 0;
  animation: slideUpElite 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
/* Legend Popover */
.legend-popover {
  position: absolute;
  top: 100%;
  right: 1.5rem;
  width: 300px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
  padding: 1.25rem;
  z-index: 100;
}

.legend-title {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  font-weight: 800;
  color: #111827;
  text-transform: uppercase;
}

.legend-section {
  margin-bottom: 1.25rem;
}

.legend-section strong {
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  color: #111827;
  margin-bottom: 0.25rem;
}

.legend-section p {
  margin: 0;
  font-size: 0.8rem;
  color: #6b7280;
  line-height: 1.4;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 0.8rem;
  color: #4b5563;
}

.legend-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #fff;
  border: 1px solid #e2e8f0;
  padding: 0.5rem 0.875rem;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
}

.legend-toggle:hover,
.legend-toggle.active {
  background: #f1f5f9;
  color: var(--jinja-accent);
  border-color: var(--jinja-accent);
}

/* Pagination */
.load-more-wrap {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--jinja-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.btn-load-more {
  background: #fff;
  border: 1px solid #e2e8f0;
  padding: 0.35rem 1rem;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
}

.btn-load-more:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-load-more:not(:disabled):hover {
  color: #0f172a;
  border-color: #cbd5e1;
}

.page-num {
  font-size: 0.8rem;
  color: #64748b;
  font-weight: 600;
}

/* Modals */
.log-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.log-modal-card {
  background: #fff;
  border-radius: 16px;
  padding: 1.5rem;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.log-modal-title {
  margin: 0 0 1rem;
  font-size: 1.125rem;
  font-weight: 800;
  color: #111827;
}

.log-modal-desc {
  font-size: 0.9rem;
  color: #6b7280;
  margin-bottom: 1.5rem;
}

.log-modal-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.log-modal-fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.log-modal-fields label span {
  font-size: 0.75rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
}

.log-modal-fields input {
  padding: 0.625rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.9rem;
}

.log-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn-cancel {
  padding: 0.5rem 1rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
}

/* Animations */
.legend-fade-enter-active,
.legend-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.legend-fade-enter-from,
.legend-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.loading-state,
.empty-state {
  padding: 4rem 2rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  color: #94a3b8;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #f1f5f9;
  border-top-color: var(--jinja-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-message {
  padding: 1rem 1.5rem;
  background: #fef2f2;
  border-left: 4px solid #ef4444;
  margin: 1.5rem;
  color: #991b1b;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: 8px;
}

.access-denied {
  padding: 3rem;
  background: #fff;
  border-radius: var(--jinja-radius);
  text-align: center;
  color: #ef4444;
  font-weight: 700;
  border: 1px solid #fee2e2;
  margin: 2rem;
}
</style>
