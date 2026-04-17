<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  listAuditLogEntries,
  getAuditLogsForRequisition,
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
const loadedHistories = ref({})
const loadingHistories = ref({})
const requisitionStatusMap = ref({})
const showHowToRead = ref(false)
const showDownloadConfirmModal = ref(false)
const deletingLogs = ref(false)
const downloadLogError = ref(null)
const isNextLoading = ref(false)

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
    authStore?.role === USER_ROLES.INTERNAL_AUDITOR ||
    authStore?.role === USER_ROLES.GENERAL_MANAGER ||
    authStore?.role === USER_ROLES.SUPER_ADMIN,
)
// Download (CSV) and delete-from-database is Internal Auditor only
const canDownloadAndDeleteLog = computed(
  () =>
    authStore?.role === USER_ROLES.INTERNAL_AUDITOR || authStore?.role === USER_ROLES.SUPER_ADMIN,
)

// Search by RF Control No. (partial, case-insensitive)
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
watch([rfSearchQuery, logDatePreset, logStartDate, logEndDate, pageSize], () => {
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
    return `${formatScopeDate(logStartDate.value)} – ${formatScopeDate(logEndDate.value)}`
  if (preset === 'today') return 'Today'
  if (preset === 'this_month') return 'This month'
  if (preset === 'custom') return 'Custom range'
  return 'Current filter'
})

const totalEntries = computed(() => filteredLogEntries.value.length)

// Requisition-First Journaling Logic: Grouping uniquely by Requisition ID
const journaledJourneys = computed(() => {
  const map = {}

  filteredLogEntries.value.forEach((entry) => {
    const entryDate = entrySignedAt(entry)
    if (!entryDate) return
    
    // Group strictly by Requisition ID if available, otherwise fallback to RF or a synthetic key
    const id = entry.requisitionId || entry.rfControlNo || entry.id
    if (!id) return

    if (!map[id]) {
      map[id] = {
        segmentId: id,
        requisitionId: entry.requisitionId,
        rfControlNo: entry.rfControlNo || '—',
        purpose: entry.purpose,
        latestAt: entry.signedAt,
        entries: [],
      }
    }

    const journey = map[id]
    journey.entries.push(entry)
    
    // If the group didn't have a requisitionId yet but this entry has one, update it
    if (!journey.requisitionId && entry.requisitionId) {
      journey.requisitionId = entry.requisitionId
    }
    // Update RF number if it was missing
    if ((!journey.rfControlNo || journey.rfControlNo === '—') && entry.rfControlNo) {
      journey.rfControlNo = entry.rfControlNo
    }

    const d = entrySignedAt(entry)
    const currentLatest = entrySignedAt({ signedAt: journey.latestAt })
    if (d && currentLatest && d > currentLatest) {
      journey.latestAt = entry.signedAt
      if (entry.statusAfter) {
        journey.status = entry.statusAfter
      }
    }
    
    if (!journey.status && entry.statusAfter) {
      journey.status = entry.statusAfter
    }
  })

  // Sort journeys descending by their overall latest action
  // Tie-breaker: use requisitionId/segmentId for stability across pages
  return Object.values(map).sort((a, b) => {
    const dA = entrySignedAt({ signedAt: a.latestAt })
    const dB = entrySignedAt({ signedAt: b.latestAt })
    
    if (dA?.getTime() === dB?.getTime()) {
      return (b.segmentId || '').localeCompare(a.segmentId || '')
    }
    return (dB || 0) - (dA || 0)
  })
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
}

const groupedJourneys = computed(() => {
  const groups = []
  paginatedJourneys.value.forEach((journey) => {
    const d = entrySignedAt({ signedAt: journey.latestAt })
    if (!d) return
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
  const dateStr = d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  d.setHours(0, 0, 0, 0)
  now.setHours(0, 0, 0, 0)
  const diff = Math.round((now - d) / (1000 * 60 * 60 * 24))
  if (diff === 0) return `Today · ${dateStr}`
  if (diff === 1) return `Yesterday · ${dateStr}`
  return dateStr
}

// Journey Trail Helpers
// Journey Trail Helpers
function getJourneyTrail(journey) {
  if (!journey || !journey.entries) return []
  
  const reqId = journey.requisitionId
  const rMap = requisitionStatusMap.value[reqId] || {}
  const rMapStatus = (rMap.status || '').toLowerCase()

  const anyApprovedInHistory = journey.entries.some((e) => {
    const a = (e.action || '').toLowerCase()
    const s = (e.statusAfter || '').toLowerCase()
    return a === 'approved' || s === 'approved'
  })

  const approvedStatuses = ['approved']
  const isPostApproved = approvedStatuses.includes(rMapStatus) || anyApprovedInHistory

  const requisitionStatus =
    rMapStatus ||
    (isPostApproved ? 'approved' : (journey.entries[0]?.statusAfter || 'draft').toLowerCase())

  const steps = [
    { label: 'Dept', status: 'pending_recommendation' },
    { label: 'Whse', status: 'pending_inventory' },
    { label: 'Budget', status: 'pending_budget' },
    { label: 'Audit', status: 'pending_audit' },
    { label: 'GM', status: 'pending_approval' },
  ]

  const requisitionStatusMapIndices = {
    draft: -1,
    pending_recommendation: 0,
    pending_inventory: 1,
    pending_budget: 2,
    pending_audit: 3,
    pending_approval: 4,
    approved: 5,
  }

  const reqIndex = requisitionStatusMapIndices[requisitionStatus] ?? (isPostApproved ? 5 : -1)

  return steps.map((s, idx) => {
    let isDone = false
    let isActive = false
    let isFailed = false

    isDone = idx < reqIndex || isPostApproved || requisitionStatus === 'approved'
    isActive = !isPostApproved && idx === reqIndex
    
    if (requisitionStatus === 'rejected') {
      const rejectedEntry = journey.entries.find((e) => {
        const act = (e.action || '').toLowerCase()
        return (act === 'declined' || act === 'rejected')
      })
      const rejectedAt = rejectedEntry?.step || ''
      const failIdx = steps.findIndex(step => 
        step.status.includes(rejectedAt) || rejectedAt.includes(step.label.toLowerCase())
      )
      if (idx === failIdx) isFailed = true
      if (idx < failIdx) isDone = true
    }

    return {
      ...s,
      active: isActive,
      done: isDone,
      failed: isFailed,
    }
  })
}

function timeSince(date, relativeTo) {
  const d = entrySignedAt({ signedAt: date })
  if (!d) return '—'
  const rel = relativeTo ? entrySignedAt({ signedAt: relativeTo }) : new Date()
  if (!rel) return '—'
  const diffMs = Math.abs(rel - d)
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins}m`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h`
  return `${Math.floor(diffHours / 24)}d`
}

function getVelocity(journey) {
  const first = entrySignedAt(journey.entries[journey.entries.length - 1])
  const latest = entrySignedAt({ signedAt: journey.latestAt })
  if (!first || !latest) return null
  const diff = Math.floor((latest - first) / (1000 * 60 * 60 * 24))
  if (diff <= 0) return null
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
    id: entry.id || `synth-${index}-${entry.requisitionId || 'log'}-${entry.step || 'step'}`,
    requisitionId: entry.requisitionId,
    rfControlNo: entry.rfControlNo ?? entry.requisitionId ?? '—',
    purpose: entry.purpose || '—',
    action: entry.action,
    step: entry.step ?? '',
    name: entry.name ?? '—',
    title: entry.title ?? '',
    email: entry.email ?? '',
    signedAt: entry.signedAt,
    statusBefore: entry.statusBefore ?? '',
    statusAfter: entry.statusAfter ?? '',
    remarks: entry.remarks ?? '',
    displayKey: `entry-${index}-${entry.signedAt?.valueOf ? entry.signedAt.valueOf() : entry.signedAt}-${entry.userId || 'anon'}`,
  }
}

/* Handled by PaginationComponent */

const UI_ROLE_LABELS = {
  ...USER_ROLE_LABELS,
}

function statusText(code) {
  return statusLabel[code] || code || '—'
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
  logEntries.value = []
  
  try {
    let batchCount = 0
    // Fetch up to 300 raw logs (6 batches of 50) to build a solid, stable journey count for the UI.
    // This stops "moving goalposts" during the session.
    while (hasMore.value && logEntries.value.length < 300 && batchCount < 6) {
      const result = await withTimeout(
        listAuditLogEntries({
          pageSize: PAGE_SIZE,
          startAfter: lastDoc.value
        })
      )
      
      const offset = logEntries.value.length
      const newEntries = result.entries.map((e, i) => mapLogEntry(e, offset + i))
      
      logEntries.value = [...logEntries.value, ...newEntries]
      lastDoc.value = result.lastDoc
      hasMore.value = result.hasMore
      batchCount++
      
      if (!result.hasMore || result.entries.length === 0) break
    }

    loading.value = false
    updateRequisitionStatusMap()
  } catch (e) {
    error.value = e.message || 'Failed to load audit log.'
    loading.value = false
  }
}

async function loadMore() {
  // We've moved to a stable buffer model for UX consistency.
  // One-time load of 300 is usually plenty for a single audit session.
  return
}

function formatDate(val) {
  if (!val) return '—'
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
    'Step',
    'Action',
    'By',
    'Email',
    'Status (from → to)',
    'Date & time',
    'Remarks',
  ]
  const rows = entries.map((e) => {
    const from = statusText(e.statusBefore)
    const to = statusText(e.statusAfter)
    const statusChange = `${from} → ${to}`
    return [
      whatHappened(e),
      e.rfControlNo ?? '—',
      (e.purpose ?? '—').replace(/\s+/g, ' ').trim(),
      stepLabel(e.step),
      badgeText(e),
      e.name ?? '—',
      e.email ?? '—',
      statusChange,
      formatDate(e.signedAt),
      (e.remarks ?? '—').replace(/\s+/g, ' ').trim(),
    ]
  })
  const header = cols.map(csvEscape).join(',')
  const lines = rows.map((row) => row.map(csvEscape).join(','))
  const csv = `\uFEFF${header}\n\n${lines.join('\n')}\n`
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

/**
 * Downloads the CSV only. Does NOT delete any records.
 */
function executeDownloadOnly() {
  if (totalEntries.value === 0) return
  const entries = filteredLogEntries.value
  buildAndDownloadLogCsv(entries)
  closeDownloadConfirmModal()
}

/**
 * Downloads the CSV and purges ONLY records older than 30 days.
 */
async function executeDownloadThenDeleteLogs() {
  if (!canDownloadAndDeleteLog.value) return
  const entries = filteredLogEntries.value
  const withIds = entries.filter((e) => e.id)

  if (!withIds.length) {
    closeDownloadConfirmModal()
    return
  }

  // 30-Day Retention Filter
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const purgeableEntries = withIds.filter((e) => {
    if (!e.signedAt) return false
    const d = e.signedAt?.toDate ? e.signedAt.toDate() : new Date(e.signedAt)
    return d < thirtyDaysAgo
  })

  // We ALWAYS download the full current view
  deletingLogs.value = true
  downloadLogError.value = null
  try {
    buildAndDownloadLogCsv(entries) // Download all visible

    if (purgeableEntries.length === 0) {
      // Nothing old enough to delete
      downloadLogError.value = 'Data exported. No records older than 30 days were found to purge.'
      // Leave modal open to show this message, user can click close
      deletingLogs.value = false
      return
    }

    // Clear current selection and UI state before starting deletions
    const idsToRemove = new Set(purgeableEntries.map((e) => e.id))
    const journeyIdsToRemove = new Set(purgeableEntries.map((e) => e.requisitionId).filter(Boolean))

    for (const e of purgeableEntries) {
      await deleteTransactionLogEntry(e.id)
    }

    // Update local state IMMEDIATELY after all deletions succeed
    logEntries.value = logEntries.value.filter((e) => !idsToRemove.has(e.id))
    // Clear expanded rows for these journeys so they don't linger
    expandedRows.value = expandedRows.value.filter((id) => !journeyIdsToRemove.has(id))

    // Close on success
    showDownloadConfirmModal.value = false
    downloadLogError.value = null
  } catch (e) {
    downloadLogError.value = e?.message || 'Failed to delete log entries.'
  } finally {
    deletingLogs.value = false
  }
}

function isExpanded(key) {
  return expandedRows.value.includes(key)
}

async function toggleExpand(segment) {
  const i = expandedRows.value.indexOf(segment.segmentId)
  if (i === -1) {
    expandedRows.value.push(segment.segmentId)
    
    // Fetch full history using the requisitionId if not already loaded into this segmentId bucket
    if (!loadedHistories.value[segment.segmentId] && !loadingHistories.value[segment.segmentId]) {
      loadingHistories.value[segment.segmentId] = true
      try {
        // Use dual-query search (ID + RF) for maximum history retrieval
        const fullLogs = await getAuditLogsForRequisition(segment.requisitionId, segment.rfControlNo)
        let mapped = fullLogs.map((e, index) => mapLogEntry(e, index))

        // Get the current requisition document for synthesis
        const req = await getRequisition(segment.requisitionId)
        if (req) {
          const synth = []
          
          // 1. Scan the "internalAuditorLog" array (often holds early approvals)
          if (Array.isArray(req.internalAuditorLog)) {
            req.internalAuditorLog.forEach(l => {
              synth.push({ ...l, requisitionId: req.id, rfControlNo: req.rfControlNo })
            })
          }

          // 2. Comprehensive Workflow Scan (Detects any footprint in the document)
          const signatureFields = [
            { f: 'requestedBy', s: 'submission', t: 'Requestor', a: 'submitted' },
            { f: 'recommendingApproval', s: 'section_head', t: 'Section Head', a: 'approved' },
            { f: 'inventoryChecked', s: 'warehouse_head', t: 'Warehouse Section Head', a: 'approved' },
            { f: 'budgetApproved', s: 'budget_officer', t: 'Budget Officer', a: 'approved' },
            { f: 'checkedBy', s: 'internal_auditor', t: 'Internal Auditor', a: 'approved' },
            { f: 'approvedBy', s: 'general_manager', t: 'General Manager', a: 'approved' },
            { f: 'rejectedBy', s: 'rejected', t: 'Approver', a: 'declined' },
            { f: 'voidedBy', s: 'voided_admin', t: 'Super Admin', a: 'voided' },
          ]

          signatureFields.forEach((wf) => {
            const data = req[wf.f]
            if (data?.signedAt) {
              const item = {
                ...data,
                action: data.action || wf.a || 'approved',
                step: data.step || wf.s,
                title: data.title || wf.t,
                requisitionId: req.id,
                rfControlNo: req.rfControlNo,
                remarks: data.remarks || '',
              }
              // Basic dedupe: if action + date exists, skip it
              const exists = synth.some(s => s.action === item.action && s.signedAt === item.signedAt)
              if (!exists) synth.push(item)
            }
          })

          if (synth.length > 0) {
            // Aggressive Content-Based Deduplication
            // Treat entries as identical if they have the same action and happen within a narrow time window.
            const getContentKey = (e) => {
              const action = (e.action || '').toLowerCase()
              const d = entrySignedAt(e)
              const timeBucket = d ? Math.floor(d.getTime() / 600000) : '' // 10 minute buckets
              // We intentionally omit userId/name here because legacy fields vs logs might differ in how they store user info
              // but the action + time effectively identifies the unique event.
              return `${action}-${timeBucket}`
            }

            const seenActions = new Set(mapped.map(getContentKey))
            
            const filteredSynth = synth.filter(s => {
              const key = getContentKey(s)
              if (seenActions.has(key)) return false
              seenActions.add(key)
              return true
            })

            if (filteredSynth.length > 0) {
              const mappedSynth = filteredSynth.map((s, idx) => mapLogEntry(s, 8000 + idx))
              mapped = [...mapped, ...mappedSynth].sort((a, b) => {
                const dateA = entrySignedAt(a)
                const dateB = entrySignedAt(b)
                return (dateB || 0) - (dateA || 0)
              })
            }
          }
          
          // Final safety: deduplicate the merged list one more time 
          // (in case the original logs themselves had duplicates)
          const finalMap = new Map()
          mapped.forEach(m => {
            const date = entrySignedAt(m)
            const key = `${(m.action || '').toLowerCase()}-${date ? date.getTime() : ''}-${m.userId || ''}`
            if (!finalMap.has(key)) {
              finalMap.set(key, m)
            }
          })
          mapped = Array.from(finalMap.values())
        }

        loadedHistories.value[segment.segmentId] = mapped
      } catch (err) {
        console.error('Failed to load full history:', err)
      } finally {
        loadingHistories.value[segment.segmentId] = false
      }
    }
  } else {
    expandedRows.value.splice(i, 1)
  }
}

// Status/action badge helpers
function badgeKey(entry) {
  const action = (entry.action || '').toLowerCase()
  
  if (action === 'created' || action === 'submitted') return 'default'
  if (action === 'approved') return 'approved'
  if (action === 'declined' || action === 'rejected' || action === 'voided') return 'declined'

  const status = (entry.statusAfter || '').toLowerCase()
  if (status === 'approved') return 'approved'
  if (status === 'rejected' || status === 'voided') return 'declined'
  
  return 'default'
}

function badgeText(entry) {
  const action = (entry.action || '').toLowerCase()
  if (action) {
    if (action === 'created') return 'Created'
    if (action === 'submitted') return 'Submitted'
    if (action === 'approved') return 'Approved'
    if (action === 'declined' || action === 'rejected') return 'Declined'
    if (action === 'force_advance') return 'Overridden'
    return action.charAt(0).toUpperCase() + action.slice(1)
  }

  const status = (entry.statusAfter || '').toLowerCase()
  if (status) return status.charAt(0).toUpperCase() + status.slice(1)

  return '—'
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

  if (action === 'approved') {
    if (statusTo === REQUISITION_STATUS.APPROVED.toLowerCase()) return 'Requisition Fully Approved'
    return 'Phase Approval Granted'
  }

  if (action === 'declined') return 'Requisition Declined'

  if (action === 'submitted') return 'Requisition Submitted for Approval'

  if (action === 'force_advance') return '[ADMIN OVERRIDE] Stage Passed'

  return 'Workflow Stage Updated'
}

async function updateRequisitionStatusMap() {
  const ids = Array.from(new Set(logEntries.value.map((e) => e.requisitionId).filter(Boolean)))
  const toFetch = ids.filter((id) => !requisitionStatusMap.value[id])
  if (toFetch.length === 0) return
  // Fetch in parallel for speed (table already visible; this fills details)
  const results = await Promise.all(toFetch.map((id) => getRequisition(id).catch(() => null)))
  toFetch.forEach((id, i) => {
    const r = results[i]
    requisitionStatusMap.value[id] = {
      status: r?.status ?? '',
      requestedByName: r?.requestedBy?.name ?? '—',
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
        </div>
      </div>

      <div class="panel elite-panel animate-staggered" style="--order: 0">
        <div class="panel-header">
          <div class="panel-title-container">
            <div class="panel-pill">Security Trail</div>
            <h2 class="panel-title-text">
              Audit Journal <span class="count-chip">{{ totalJourneys }}{{ hasMore ? '+' : '' }}</span>
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
                <div class="legend-row"><span class="status-dot declined"></span> Declined</div>
                <div class="legend-row">
                  <span class="status-dot"></span> Initial Submission / Draft
                </div>
              </div>
              <div class="legend-section">
                <strong>Navigation & Detail</strong>
                <p>
                  <strong>Click:</strong> Expand row (▼) to see detailed timestamps and comments.
                </p>
                <p>
                  <strong>Double-Click:</strong> Navigate directly to the Requisition record.
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

          <div v-else class="table-section" :class="{ 'is-loading-discovery': isNextLoading }" ref="tableContainer">
            <div v-if="isNextLoading" class="discovery-overlay">
              <div class="spinner spinner-sm"></div>
              <span>Discovering more records...</span>
            </div>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr class="glass-header">
                    <th style="width: 130px">RF Number</th>
                    <th style="width: 180px; text-align: left">Requestor</th>
                    <th style="width: 160px">Latest Action</th>
                    <th class="purpose-header" style="text-align: left">Purpose</th>
                    <th style="width: 200px; text-align: center">Workflow Progress</th>
                    <th style="width: 150px; text-align: right">Date & Time</th>
                    <th style="width: 50px"></th>
                  </tr>
                </thead>
                <tbody v-for="group in groupedJourneys" :key="group.date">
                  <tr class="date-divider">
                    <td colspan="7">{{ group.label }}</td>
                  </tr>
                  <template v-for="journey in group.journeys" :key="journey.requisitionId">
                    <tr
                      class="journey-row"
                      :class="{ 'is-expanded': isExpanded(journey.segmentId) }"
                      title="Double-click to view record"
                      @click="toggleExpand(journey)"
                      @dblclick="goToDetail(journey.requisitionId)"
                    >
                      <td class="rf-cell" @click.stop="goToDetail(journey.requisitionId)">
                        <span class="rf-number">{{ journey.rfControlNo }}</span>
                        <span class="velocity-tag" v-if="getVelocity(journey)"
                          >{{ getVelocity(journey).split(' ')[0] }}d</span
                        >
                      </td>
                      <td class="requestor-cell">
                        <span class="requestor-name text-truncate" :title="requisitionStatusMap[journey.requisitionId]?.requestedByName">
                          {{ requisitionStatusMap[journey.requisitionId]?.requestedByName || '—' }}
                        </span>
                      </td>
                      <td class="action-cell">
                        <span class="badge-pill" :class="badgeKey(journey.entries[0])">
                          {{ badgeText(journey.entries[0]) }}
                        </span>
                      </td>
                      <td class="purpose-cell" :title="journey.purpose">
                        {{ journey.purpose || '—' }}
                      </td>
                      <td class="trail-cell">
                        <div class="mini-trail">
                          <div
                            v-for="(step, idx) in getJourneyTrail(journey)"
                            :key="idx"
                            class="mini-step"
                              :class="{ 
                                done: step.done, 
                                active: step.active, 
                                failed: step.failed
                              }"
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
                        <div class="d-flex align-items-center">
                          <button 
                            v-if="journey.status === 'DRAFT' || journey.status === 'PENDING_RECOMMENDATION'"
                            class="btn btn-sm btn-outline-primary mr-2"
                            style="padding: 2px 8px; font-size: 0.75rem;"
                            @click.stop="$router.push(`/requisitions/${journey.requisitionId}/edit`)"
                          >
                            <i class="feather icon-edit-2"></i> Edit
                          </button>
                          <span class="chevron" :class="{ open: isExpanded(journey.segmentId) }"
                            >▼</span
                          >
                        </div>
                      </td>
                    </tr>
                    <tr v-if="isExpanded(journey.segmentId)" class="history-row">
                      <td colspan="7" class="history-cell">
                        <div class="compact-history">
                          <table class="sub-table">
                            <tr v-if="loadingHistories[journey.segmentId]">
                              <td colspan="6" style="text-align: center; padding: 1rem" class="muted">
                                Loading complete history...
                              </td>
                            </tr>
                            <tr
                              v-else
                              v-for="entry in (loadedHistories[journey.segmentId] || journey.entries)"
                              :key="entry.displayKey"
                              :class="{
                                'override-entry':
                                  (entry.action || '').toLowerCase() === 'force_advance',
                              }"
                            >
                              <td style="width: 20px">
                                <div class="history-dot" :class="badgeKey(entry)"></div>
                              </td>
                              <td style="width: 140px">
                                <div class="user-name">{{ entry.name }}</div>
                              </td>
                              <td style="width: 150px" class="muted role-cell">
                                {{ stepLabel(entry) }}
                              </td>
                              <td style="width: 110px" class="action-text-cell">
                                <span class="badge-pill" :class="badgeKey(entry)">
                                  {{ badgeText(entry) }}
                                </span>
                              </td>
                              <td class="remarks-text">{{ entry.remarks || '-' }}</td>
                              <td style="width: 140px; text-align: right" class="muted time-ago">
                                {{ formatDate(entry.signedAt) }}
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
              :has-more="hasMore"
              @page-change="handlePageChange"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- Modals moved to top-level to avoid layering bugs with backdrop-filter -->
    <div v-if="showLogCustomRange" class="log-modal-overlay" @click.self="closeLogCustomRange">
      <div class="log-modal-card">
        <h3 class="log-modal-title">Custom Date Range</h3>
        <div class="log-modal-fields">
          <label><span>From</span><input v-model="draftLogStart" type="date" /></label>
          <label><span>To</span><input v-model="draftLogEnd" type="date" /></label>
        </div>
        <div class="log-modal-actions">
          <button type="button" class="btn-cancel" @click="closeLogCustomRange">Cancel</button>
          <button type="button" class="btn-primary" @click="applyLogCustomRange">Apply</button>
        </div>
      </div>
    </div>

    <!-- Premium Export Modal -->
    <Transition name="modal-fade">
      <div
        v-if="showDownloadConfirmModal"
        class="export-modal-overlay premium-glass"
        @click.self="closeDownloadConfirmModal"
      >
        <div
          class="export-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-modal-title"
        >
          <div class="export-modal-header">
            <div class="export-icon-box">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
            </div>
            <div>
              <h2 id="export-modal-title" class="export-modal-title">Export Log</h2>
              <p class="export-modal-subtitle">
                Exporting <strong>{{ totalEntries }}</strong> entries in current view.
              </p>
            </div>
          </div>

          <div class="export-modal-body">
            <div class="retention-policy-box">
              <div class="policy-header">
                <span class="policy-icon">ℹ️</span>
                <strong>Retention Policy</strong>
              </div>
              <p class="policy-text">
                You can download your logs safely without deleting them. If you choose to Purge, the
                system will export your data but only permanently delete records older than
                <strong style="color: #b91c1c">30 days</strong> to maintain fast database speeds.
              </p>
            </div>
            <p v-if="downloadLogError" class="export-error">{{ downloadLogError }}</p>
          </div>

          <div class="export-modal-actions">
            <button
              type="button"
              class="export-btn export-btn-cancel"
              :disabled="deletingLogs"
              @click="closeDownloadConfirmModal"
            >
              Cancel
            </button>
            <div class="export-primary-group">
              <button
                type="button"
                class="export-btn export-btn-safe"
                :disabled="deletingLogs"
                @click="executeDownloadOnly"
              >
                {{ deletingLogs ? 'Downloading...' : 'Download CSV' }}
              </button>
              <button
                v-if="canDownloadAndDeleteLog"
                type="button"
                class="export-btn export-btn-purge"
                :disabled="deletingLogs"
                @click="executeDownloadThenDeleteLogs"
                title="Only deletes records older than 30 days"
              >
                {{ deletingLogs ? 'Purging...' : 'Export & Purge (30+ Days)' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
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
  flex: 1; min-height: 0;
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
  padding: 1rem 1.25rem;
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
  user-select: none;
}

.journey-row td {
  padding: 1rem 1.25rem;
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
  display: flex;
  align-items: center;
  gap: 10px;
}

.rf-number {
  color: var(--jinja-accent);
  min-width: 110px;
}

.velocity-tag {
  font-size: 0.65rem;
  background: #f1f5f9;
  color: #64748b;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
}

.velocity-tag.processing {
  background: #ecfdf5;
  color: #059669;
}

.purpose-header {
  min-width: 200px;
}

.requestor-cell {
  padding: 1rem 0.5rem;
}

.requestor-name {
  display: block;
  font-size: 0.9rem;
  color: #334155;
  font-weight: 500;
  max-width: 170px;
}

.purpose-cell {
  color: #6b7280;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
  word-break: break-word;
}

/* Mini Trail */
.trail-cell {
  text-align: center;
}

.mini-trail {
  display: flex;
  gap: 4px;
  justify-content: center;
}

.mini-step {
  height: 6px;
  width: 32px;
  background: #cbd5e1; /* Even darker off-state for high-fidelity visibility */
  border-radius: 3px;
  transition: all 0.3s ease;
}

.mini-step.done {
  background: #10b981;
  box-shadow: 0 1px 2px rgba(16, 185, 129, 0.2);
}

.mini-step.active {
  background: #3b82f6;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
}

.mini-step.failed {
  background: #ef4444;
  box-shadow: 0 1px 2px rgba(239, 68, 68, 0.2);
}

.time-cell {
  text-align: right;
  font-size: 0.75rem;
  color: #94a3b8;
  white-space: nowrap;
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

.status-dot.declined {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
}

.history-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #cbd5e1;
  flex-shrink: 0;
  margin-top: 4px;
}
.history-dot.approved { background: #10b981; }
.history-dot.declined { background: #ef4444; }
.history-dot.default { background: #cbd5e1; }

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
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid #f1f5f9;
}

.user-name {
  font-weight: 700;
  font-size: 0.8125rem;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
}

.badge-pill {
  display: inline-block;
  font-size: 0.625rem;
  font-weight: 800;
  text-transform: uppercase;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  background: #f1f5f9;
  color: #64748b;
  letter-spacing: 0.025em;
}

.identifier-subtext {
  font-size: 0.65rem;
  color: #64748b;
  font-weight: 600;
  margin-top: 2px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.badge-pill.approved {
  background: #ecfdf5;
  color: #059669;
}
.badge-pill.declined {
  background: #fef2f2;
  color: #dc2626;
}

.override-entry {
  background: #fffbeb;
}

.role-cell {
  font-size: 0.7rem;
}

.time-ago {
  font-size: 0.7rem;
}

.muted {
  color: #94a3b8;
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

.spinner.small {
  width: 20px;
  height: 20px;
  border-width: 2px;
}

.modal-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 1rem;
  font-size: 0.875rem;
  color: #64748b;
  font-weight: 600;
}

.error-message.mini {
  margin: 0 0 1rem 0;
  padding: 0.75rem;
  font-size: 0.8rem;
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
/* ==============================
   PREMIUM EXPORT MODAL STYLES
   ============================== */
.export-modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.7);
  backdrop-filter: blur(8px);
  z-index: 1000;
  padding: 1rem;
}

.export-modal-card {
  background: linear-gradient(to bottom, #ffffff, #f8fafc);
  border-radius: 16px;
  width: 100%;
  max-width: 520px;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.25),
    0 0 0 1px rgba(226, 232, 240, 0.5);
  overflow: hidden;
  animation: modal-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modal-pop {
  0% {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.export-modal-header {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 1.5rem 1.5rem 0.5rem;
}

.export-icon-box {
  background: #f1f5f9;
  color: #1e293b;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.8);
  border: 1px solid #e2e8f0;
}

.export-modal-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.01em;
}

.export-modal-subtitle {
  margin: 0.15rem 0 0;
  font-size: 0.875rem;
  color: #64748b;
}

.export-modal-body {
  padding: 1rem 1.5rem;
}

.retention-policy-box {
  background: rgba(241, 245, 249, 0.7);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1rem 1.25rem;
}

.policy-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  color: #1e293b;
  font-size: 0.85rem;
  font-weight: 700;
}

.policy-text {
  margin: 0;
  font-size: 0.8125rem;
  color: #475569;
  line-height: 1.5;
}

.export-error {
  margin: 1rem 0 0;
  padding: 0.75rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #b91c1c;
  font-size: 0.8125rem;
}

.export-modal-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: #f8fafc;
  border-top: 1px solid #f1f5f9;
}

.export-primary-group {
  display: flex;
  gap: 0.75rem;
}

.export-btn {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.export-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

.export-btn-cancel {
  background: transparent;
  color: #64748b;
  border-color: #e2e8f0;
}
.export-btn-cancel:hover:not(:disabled) {
  background: #f1f5f9;
  color: #0f172a;
}

.export-btn-safe {
  background: #1e293b;
  color: #fff;
  box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.2);
}
.export-btn-safe:hover:not(:disabled) {
  background: #0f172a;
  transform: translateY(-1px);
}

.export-btn-purge {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #fca5a5;
}
.export-btn-purge:hover:not(:disabled) {
  background: #b91c1c;
  color: #fff;
}

/* Discovery Overlay */
.table-section {
  position: relative;
}
.discovery-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(2px);
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  animation: fade-in 0.2s ease-out;
}
.discovery-overlay span {
  font-size: 0.75rem;
  font-weight: 700;
  color: #0ea5e9;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.spinner-sm {
  width: 24px;
  height: 24px;
  border-width: 2px;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
