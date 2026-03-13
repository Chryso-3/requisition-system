<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  subscribeArchivedRequisitions,
  loadMoreArchivedRequisitions,
  deleteRequisition,
  migrateLegacyArchivedRecords,
  REQUISITION_PAGE_SIZE,
} from '@/services/requisitionService'
import { REQUISITION_STATUS, USER_ROLES } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import PaginationComponent from '@/components/PaginationComponent.vue'
import { getDeptAbbreviation } from '@/utils/deptUtils'

const authStore = useAuthStore()
const isAdmin = computed(
  () =>
    authStore?.role === USER_ROLES.GENERAL_MANAGER ||
    authStore?.role === USER_ROLES.INTERNAL_AUDITOR ||
    authStore?.role === USER_ROLES.SUPER_ADMIN,
)

const router = useRouter()
const requisitions = ref([])
const moreRequisitions = ref([])
const tableContainer = ref(null)
const lastDoc = ref(null)
const hasMore = ref(false)
const loadingMore = ref(false)
const loading = ref(true)
const error = ref(null)
const startDate = ref('')
const endDate = ref('')
const datePreset = ref('all')
const prevDatePreset = ref('all')
const showCustomRange = ref(false)
const draftStartDate = ref('')
const draftEndDate = ref('')
const showDownloadConfirmModal = ref(false)
const deletingAll = ref(false)
const isRepairing = ref(false)
const repairCount = ref(0)
const deleteAllError = ref(null)
let unsubscribe = null

const CSV_COLS = [
  'RF Control No.',
  'Date',
  'Department',
  'Status',
  'Purpose',
  'Requested By',
  'Recommending Approval',
  'Inventory Checked',
  'Budget Approved',
  'Checked By (Auditor)',
  'Approved By (GM)',
  'Rejected By',
  'Rejection Remarks',
  'Purchase Status',
  'PO Number',
  'Ordered By',
  'Ordered At',
  'Received By',
  'Received At',
  'Items Count',
  'Item Details',
]

function requisitionToCsvRow(r) {
  const date = toDateValue(r.date)
  const dateIso = date ? date.toISOString().slice(0, 10) : ''
  const orderedAtVal = toDateValue(r.orderedAt)
  const receivedAtVal = toDateValue(r.receivedAt)
  const items = Array.isArray(r.items) ? r.items : []
  const itemDetails = items
    .map((it) => `${it.quantity ?? ''} ${it.unit ?? ''} ${it.description ?? ''}`.trim())
    .filter(Boolean)
    .join('; ')
  const purchaseStatus = r.purchaseStatus || (r.status === 'approved' ? 'pending' : '')
  return {
    'RF Control No.': r.rfControlNo || '',
    Date: dateIso,
    Department: r.department || '',
    Status: getResolutionLabel(r),
    Purpose: r.purpose || '',
    'Requested By': r.requestedBy?.name || '',
    'Recommending Approval': r.recommendingApproval?.name || '',
    'Inventory Checked': r.inventoryChecked?.name || '',
    'Budget Approved': r.budgetApproved?.name || '',
    'Checked By (Auditor)': r.checkedBy?.name || '',
    'Approved By (GM)': r.approvedBy?.name || '',
    'Rejected By': r.rejectedBy?.name || '',
    'Rejection Remarks': r.rejectedBy?.remarks || '',
    'Purchase Status': purchaseStatus
      ? String(purchaseStatus).charAt(0).toUpperCase() + String(purchaseStatus).slice(1)
      : '',
    'PO Number': r.poNumber || '',
    'Ordered By': r.orderedBy?.name || '',
    'Ordered At': orderedAtVal ? orderedAtVal.toISOString().slice(0, 10) : '',
    'Received By': r.receivedBy?.name || '',
    'Received At': receivedAtVal ? receivedAtVal.toISOString().slice(0, 10) : '',
    'Items Count': items.length,
    'Item Details': itemDetails,
  }
}

const statusLabel = {
  [REQUISITION_STATUS.APPROVED]: 'Approved',
  [REQUISITION_STATUS.REJECTED]: 'Rejected',
}

const ARCHIVE_RETENTION_DAYS = 30

function isOverRetentionDays(r) {
  const d = toDateValue(r.archivedAt ?? r.date)
  if (!d) return false
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - ARCHIVE_RETENTION_DAYS)
  cutoff.setHours(0, 0, 0, 0)
  return d < cutoff
}

const hasOverRetentionRequisitions = computed(() =>
  archivedRequisitions.value.some((r) => isOverRetentionDays(r)),
)
const overRetentionCount = computed(
  () => archivedRequisitions.value.filter((r) => isOverRetentionDays(r)).length,
)

function getResolutionLabel(r) {
  if (r.status === 'rejected') return 'Rejected'
  if (r.poStatus === 'rejected') return 'PO Rejected'
  if (r.status === 'approved' && (r.purchaseStatus === 'received' || r.isArchived))
    return 'Fulfilled'
  return statusLabel[r.status] || r.status
}

function getResolutionClass(r) {
  if (r.status === 'rejected' || r.poStatus === 'rejected') return 'status-rejected'
  if (r.status === 'approved' && (r.purchaseStatus === 'received' || r.isArchived))
    return 'status-fulfilled'
  return 'status-default'
}

function toDateValue(val) {
  if (!val) return null
  if (val?.toDate) return val.toDate()
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return new Date(val + 'T00:00:00')
  const d = new Date(val)
  return Number.isNaN(d.getTime()) ? null : d
}

function setToday() {
  const now = new Date()
  const iso = now.toISOString().slice(0, 10)
  startDate.value = iso
  endDate.value = iso
}

function setThisMonth() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const first = new Date(y, m, 1)
  const last = new Date(y, m + 1, 0)
  startDate.value = first.toISOString().slice(0, 10)
  endDate.value = last.toISOString().slice(0, 10)
}

function clearDates() {
  startDate.value = ''
  endDate.value = ''
}

watch(datePreset, (v, old) => {
  if (v === 'all') clearDates()
  if (v === 'today') setToday()
  if (v === 'this_month') setThisMonth()
  if (v === 'custom') {
    prevDatePreset.value = old || 'all'
    draftStartDate.value = startDate.value
    draftEndDate.value = endDate.value
    showCustomRange.value = true
  }
})

watch([startDate, endDate], ([s, e]) => {
  if (!s || !e) return
  if (s > e) {
    startDate.value = e
    endDate.value = s
  }
})

function closeCustomRange() {
  showCustomRange.value = false
  if (datePreset.value === 'custom') datePreset.value = prevDatePreset.value || 'all'
}

function applyCustomRange() {
  startDate.value = draftStartDate.value || ''
  endDate.value = draftEndDate.value || ''
  showCustomRange.value = false
  datePreset.value = 'custom'
}

const combinedRequisitions = computed(() => [...requisitions.value, ...moreRequisitions.value])

const archivedRequisitions = computed(() => {
  const list = combinedRequisitions.value.filter(
    (r) => r.status === REQUISITION_STATUS.APPROVED || r.status === REQUISITION_STATUS.REJECTED,
  )

  if (!startDate.value && !endDate.value) return list
  const start = startDate.value ? new Date(startDate.value + 'T00:00:00') : null
  const end = endDate.value ? new Date(endDate.value + 'T23:59:59.999') : null

  return list.filter((r) => {
    const d = toDateValue(r.archivedAt ?? r.date)
    if (!d) return false
    if (start && d < start) return false
    if (end && d > end) return false
    return true
  })
})

const pageSize = ref(10)
const currentPage = ref(1)

const totalFiltered = computed(() => archivedRequisitions.value.length)
const totalPages = computed(() => Math.ceil(totalFiltered.value / pageSize.value) || 1)

const paginatedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return archivedRequisitions.value.slice(start, start + pageSize.value)
})

function handlePageChange(p) {
  currentPage.value = p

  // Scroll the window back to the top of the table smoothly
  window.scrollTo({ top: 0, behavior: 'smooth' })

  // Buffered Load More
  const currentViewEnd = p * pageSize.value
  const bufferEnd = combinedRequisitions.value.length
  if (currentViewEnd > bufferEnd - 15 && hasMore.value && !loadingMore.value) {
    loadMore()
  }
}

/* Handled by PaginationComponent */

function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString()
}

function goToDetail(id) {
  router.push({ path: `/requisitions/${id}`, query: { from: 'archive' } })
}

function openDownloadConfirmModal() {
  deleteAllError.value = null
  showDownloadConfirmModal.value = true
}

function closeDownloadConfirmModal() {
  if (!deletingAll.value) {
    showDownloadConfirmModal.value = false
    deleteAllError.value = null
  }
}

function csvEscape(value) {
  const s = String(value ?? '')
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""')}"`
  }
  return s
}

function downloadAllCsv() {
  const list = archivedRequisitions.value
  if (!list.length) return
  const header = CSV_COLS.map(csvEscape).join(',')
  const lines = list.map((r) => CSV_COLS.map((c) => csvEscape(requisitionToCsvRow(r)[c])).join(','))
  const csv = `\uFEFF${header}\n${lines.join('\n')}\n`
  const filename = `archive_requisitions_${new Date().toISOString().slice(0, 10)}.csv`
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

async function executeSafeDownload() {
  downloadAllCsv()
  closeDownloadConfirmModal()
}

async function executeDownloadThenDeleteAll() {
  const list = archivedRequisitions.value
  if (!list.length) return
  deletingAll.value = true
  deleteAllError.value = null
  try {
    downloadAllCsv()
    // ONLY delete records older than the retention policy!
    const itemsToDelete = list.filter((r) => isOverRetentionDays(r))
    for (const r of itemsToDelete) {
      await deleteRequisition(r.id)
    }
    error.value = null
    showDownloadConfirmModal.value = false
    deleteAllError.value = null
    if (itemsToDelete.length > 0) {
      alert(`Export successful. Purged ${itemsToDelete.length} ancient record(s).`)
    }
  } catch (e) {
    const msg = e?.message || 'Failed to delete some items.'
    error.value = msg
    deleteAllError.value = msg
  } finally {
    deletingAll.value = false
  }
}

async function loadMore() {
  if (!lastDoc.value || loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const {
      requisitions: next,
      lastDoc: nextLastDoc,
      hasMore: nextHasMore,
    } = await loadMoreArchivedRequisitions(lastDoc.value, REQUISITION_PAGE_SIZE)
    moreRequisitions.value = [...moreRequisitions.value, ...next]
    lastDoc.value = nextLastDoc
    hasMore.value = nextHasMore
  } catch (e) {
    error.value = e?.message || 'Failed to load more.'
  } finally {
    loadingMore.value = false
  }
}

async function handleRepair() {
  if (isRepairing.value) return
  isRepairing.value = true
  try {
    const count = await migrateLegacyArchivedRecords()
    repairCount.value = count
    alert(`Archive Repaired! ${count} legacy record(s) migrated to the new system.`)
  } catch (e) {
    alert('Failed to repair archive: ' + e.message)
  } finally {
    isRepairing.value = false
  }
}

onMounted(() => {
  loading.value = true
  error.value = null
  moreRequisitions.value = []
  lastDoc.value = null
  hasMore.value = false
  unsubscribe = subscribeArchivedRequisitions(
    (results, lastDocSnapshot) => {
      requisitions.value = results
      lastDoc.value = lastDocSnapshot
      hasMore.value = results.length === REQUISITION_PAGE_SIZE
      loading.value = false
      error.value = null
    },
    (err) => {
      error.value = err?.message || 'Failed to load archive.'
      loading.value = false
    },
    { pageSize: REQUISITION_PAGE_SIZE },
  )
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <div class="archive-view">
    <header class="log-header">
      <div class="header-main">
        <h1 class="log-title">Archive</h1>
        <p class="log-desc">
          Closed requisitions (approved and rejected) for record-keeping and cleanup.
        </p>
      </div>

      <div class="header-actions">
        <button
          v-if="isAdmin"
          type="button"
          class="toolbar-btn-download repair"
          :disabled="isRepairing"
          @click="handleRepair"
        >
          <span class="btn-icon">{{ isRepairing ? '⏳' : '🔧' }}</span>
          {{ isRepairing ? 'Repairing Archive...' : 'Repair Archive' }}
        </button>

        <select v-model="datePreset" class="toolbar-select">
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="this_month">This month</option>
          <option value="custom">Custom...</option>
        </select>

        <button
          type="button"
          class="toolbar-btn-download"
          :disabled="loading || archivedRequisitions.length === 0"
          title="Download CSV; data will be deleted afterward"
          @click="openDownloadConfirmModal"
        >
          Export (CSV)
        </button>
      </div>
    </header>

    <div class="log-panel">
      <div v-if="error" class="error-message">⚠️ {{ error }}</div>

      <div v-if="!loading && hasOverRetentionRequisitions" class="archive-retention-banner">
        <span class="archive-retention-icon" aria-hidden="true">ℹ️</span>
        <p class="archive-retention-text">
          <strong>Policy:</strong> {{ overRetentionCount }} requisition(s) are older than
          {{ ARCHIVE_RETENTION_DAYS }} days.
        </p>
      </div>

      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span>Syncing archive...</span>
      </div>
      <div v-else-if="archivedRequisitions.length === 0" class="empty-state">
        No closed requisitions yet.
      </div>

      <div v-else class="log-table-container" ref="tableContainer">
        <table class="compact-table">
          <thead>
            <tr>
              <th style="width: 140px">RF Number</th>
              <th style="width: 120px">Resolution Date</th>
              <th style="width: 150px">Department</th>
              <th style="width: 100px">Total Items</th>
              <th style="width: 150px">Final Resolution</th>
              <th>Detail</th>
              <th style="width: 100px; text-align: center">Action</th>
            </tr>
          </thead>
          <TransitionGroup tag="tbody" name="list-fade">
            <tr
              v-for="r in paginatedList"
              :key="r.id"
              class="table-row row-item"
              @click="goToDetail(r.id)"
            >
              <td class="rf-cell">
                <span class="rf-number">{{ r.rfControlNo || '—' }}</span>
              </td>
              <td class="date-cell">
                {{ formatDate(r.archivedAt || r.date) }}
              </td>
              <td class="dept-cell">{{ getDeptAbbreviation(r.department) }}</td>
              <td class="items-cell">{{ r.items?.length || 0 }} items</td>
              <td>
                <span class="resolution-badge" :class="getResolutionClass(r)">
                  {{ getResolutionLabel(r) }}
                </span>
              </td>
              <td
                class="outcome-cell"
                :title="
                  r.status === 'rejected'
                    ? r.rejectedBy?.remarks
                    : r.poNumber
                      ? 'PO: ' + r.poNumber
                      : ''
                "
              >
                <div class="outcome-text">
                  {{
                    r.status === 'rejected'
                      ? r.rejectedBy?.remarks || 'Rejected during workflow.'
                      : r.poNumber
                        ? 'PO: ' + r.poNumber
                        : 'Completed Delivery'
                  }}
                </div>
              </td>
              <td class="action-cell">
                <span class="view-btn">
                  View
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </span>
              </td>
            </tr>
          </TransitionGroup>
        </table>
      </div>

      <!-- Pagination sits OUTSIDE the scrollable table area so it's always visible -->
      <PaginationComponent
        v-if="archivedRequisitions.length > 0"
        :current-page="currentPage"
        :total-pages="totalPages"
        :page-size="pageSize"
        :total-items="totalFiltered"
        :loading="loading || loadingMore"
        @page-change="handlePageChange"
      />
    </div>

    <!-- Premium Export Modal (Moved to top-level to avoid backdrop-filter issues) -->
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
                Exporting <strong>{{ archivedRequisitions.length }}</strong> entries in current
                view.
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
                <strong style="color: #b91c1c">{{ ARCHIVE_RETENTION_DAYS }} days</strong> to
                maintain fast database speeds.
              </p>
            </div>
            <p v-if="deleteAllError" class="export-error">{{ deleteAllError }}</p>
          </div>

          <div class="export-modal-actions">
            <button
              type="button"
              class="export-btn export-btn-cancel"
              :disabled="deletingAll"
              @click="closeDownloadConfirmModal"
            >
              Cancel
            </button>
            <div class="export-primary-group">
              <button
                type="button"
                class="export-btn export-btn-safe"
                :disabled="deletingAll"
                @click="executeSafeDownload"
              >
                {{ deletingAll ? 'Downloading...' : 'Download CSV' }}
              </button>
              <button
                type="button"
                class="export-btn export-btn-purge"
                :disabled="deletingAll"
                @click="executeDownloadThenDeleteAll"
                title="Only deletes records older than 30 days"
              >
                {{ deletingAll ? 'Purging...' : 'Export & Purge (30+ Days)' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <div v-if="showCustomRange" class="modal-overlay" @click.self="closeCustomRange">
      <div class="modal">
        <div class="modal-title">Select dates</div>
        <div class="modal-desc">Filter archive by start and end date.</div>
        <div class="modal-fields">
          <label class="date-field">
            <span>From</span>
            <input v-model="draftStartDate" type="date" />
          </label>
          <label class="date-field">
            <span>To</span>
            <input v-model="draftEndDate" type="date" />
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="closeCustomRange">Cancel</button>
          <button type="button" class="btn-primary" @click="applyCustomRange">Apply</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* PREMIUM Transitions */
.list-fade-enter-active,
.list-fade-leave-active {
  transition: all 0.3s ease;
}
.list-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.list-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
.row-item {
  transition: background-color 0.2s;
}
.row-item:hover {
  background-color: #f8fafc;
}

.archive-view {
  padding: 0.75rem 2rem 2rem;
  background: #f1f5f9;
  min-height: 100vh;
  font-family: 'Inter', system-ui, sans-serif;
  color: #0f172a;
  display: flex;
  flex-direction: column;
}

/* Compact Header */
.log-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 1rem;
  position: relative;
}
.log-title {
  margin: 0;
  font-size: 1.5rem;
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  color: #8b0000;
  letter-spacing: -0.01em;
  text-transform: uppercase;
}
.log-desc {
  margin: 0;
  font-size: 0.875rem;
  color: #64748b;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.toolbar-select,
.toolbar-btn-download {
  height: 32px;
  padding: 0 0.75rem;
  font-size: 0.8125rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  outline: none;
}
.toolbar-select {
  width: 130px;
}
.toolbar-select:focus {
  border-color: #8b0000;
  box-shadow: 0 0 0 2px rgba(139, 0, 0, 0.1);
}
.toolbar-btn-download {
  background: #8b0000;
  color: #fff;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: background 0.2s;
}
.toolbar-btn-download:hover:not(:disabled) {
  background: #7a0000;
}
.toolbar-btn-download:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Modals */
.modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.4);
  backdrop-filter: blur(2px);
  z-index: 100;
}
.modal {
  position: relative;
  background: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2);
  max-width: 400px;
  width: 100%;
}
.modal-title {
  margin: 0 0 0.5rem;
  font-size: 1.125rem;
  font-weight: 700;
  color: #8b0000;
}
.modal-desc {
  margin: 0 0 1.25rem;
  font-size: 0.875rem;
  color: #6b7280;
  line-height: 1.5;
}
.modal-fields {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.date-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8125rem;
  color: #374151;
}
.date-field input {
  padding: 0.4rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.8125rem;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.btn-cancel,
.btn-primary {
  padding: 0.4rem 0.75rem;
  border-radius: 4px;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
}
.btn-cancel {
  background: #f3f4f6;
  color: #374151;
}
.btn-primary {
  background: #8b0000;
  color: #fff;
}
.btn-primary:hover:not(:disabled) {
  background: #7a0000;
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

/* Panel & Table */
.log-panel {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
}

.log-table-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  max-height: calc(100vh - 290px);
}

.compact-table {
  width: 100%;
  border-collapse: collapse;
}

.compact-table th {
  position: sticky;
  top: 0;
  background: linear-gradient(to bottom, #f8fafc, #f1f5f9);
  padding: 0.875rem 1rem;
  text-align: left;
  font-size: 0.72rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 2px solid #e2e8f0;
  z-index: 10;
  white-space: nowrap;
}

.table-row {
  cursor: pointer;
  border-bottom: 1px solid #f1f5f9;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.table-row:hover {
  background-color: #f8fafc;
  z-index: 1;
  position: relative;
}

.table-row td {
  padding: 0.75rem 1rem;
  vertical-align: middle;
}

.rf-number {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  color: #8b0000;
  background: #fff5f5;
  padding: 2px 8px;
  border-radius: 6px;
  letter-spacing: 0.02em;
  font-size: 0.875rem;
}

.date-cell {
  color: #64748b;
  font-weight: 500;
}

.dept-cell {
  font-weight: 600;
  color: #1e293b;
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.items-cell {
  color: #94a3b8;
  font-style: italic;
  font-size: 0.8rem;
}

/* Resolution Badges */
.resolution-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.05);
}

.status-fulfilled {
  background: #ecfdf5;
  color: #059669;
}

.status-rejected {
  background: #fff1f2;
  color: #be123c;
}

.status-default {
  background: #f1f5f9;
  color: #475569;
}

.outcome-text {
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.4;
  max-width: 300px;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* View Button */
.view-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 6px 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #8b0000;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  transition: all 0.2s;
}

.table-row:hover .view-btn {
  background: #8b0000;
  color: #fff;
  border-color: #8b0000;
  box-shadow: 0 4px 8px rgba(139, 0, 0, 0.2);
}

.action-cell {
  text-align: center;
}

/* Load More */
.load-more-wrap {
  text-align: center;
  padding: 0.75rem;
  border-top: 1px solid #f3f4f6;
  background: #fdfdfd;
}
.btn-load-more {
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 0.4rem 1rem;
  border-radius: 20px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #374151;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-load-more:hover {
  background: #f3f4f6;
}

/* Bottom Pagination */
.pagination-tight {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  font-size: 0.8125rem;
}
.page-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.page-controls button {
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 0.75rem;
  font-family: inherit;
}
.page-controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* States */
.archive-retention-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0.5rem 1rem;
  background: #fef2f2;
  border-bottom: 1px solid #fecaca;
  color: #8b0000;
  font-size: 0.8125rem;
}
.archive-retention-banner p {
  margin: 0;
}
.error-message {
  padding: 0.75rem 1rem;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.875rem;
  font-weight: 500;
  border-bottom: 1px solid #fecaca;
}
.empty-state,
.loading-state,
.empty-search {
  text-align: center;
  padding: 2rem;
  color: #6b7280;
  font-size: 0.875rem;
}
.spinner {
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-left-color: #8b0000;
  border-radius: 50%;
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
  display: inline-block;
  vertical-align: middle;
  margin-right: 8px;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* Animations */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.toolbar-btn-download.repair {
  background: #f8fafc;
  color: #475569;
  border-color: #e2e8f0;
  margin-right: 0.75rem;
}
.toolbar-btn-download.repair:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #cbd5e1;
  color: #1e293b;
}
</style>
