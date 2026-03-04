<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  subscribeRequisitions,
  loadMoreRequisitions,
  APPROVAL_WORKFLOW,
  REQUISITION_PAGE_SIZE,
} from '@/services/requisitionService'
import { REQUISITION_STATUS, USER_ROLES } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import PaginationComponent from '@/components/PaginationComponent.vue'
import { getDeptAbbreviation } from '@/utils/deptUtils'

const router = useRouter()
const authStore = useAuthStore()

const requisitions = ref([])
const moreRequisitions = ref([])
const lastDoc = ref(null)
const hasMore = ref(false)
const loadingMore = ref(false)
const loading = ref(true)
const error = ref(null)
const pageSize = ref(10)
const currentPage = ref(1)
const tableContainer = ref(null)
let unsubscribe = null

// Requester-only filter (approvers do inbox/history)
const filterStatus = ref('')

// Approver toggle: inbox vs "my history"
const showAll = ref(false)

const isRequester = computed(() => authStore.role === USER_ROLES.REQUESTER)
const isGM = computed(() => authStore.role === USER_ROLES.GENERAL_MANAGER)
const approverWorkflow = computed(() => APPROVAL_WORKFLOW[authStore.role])

const statusLabel = {
  [REQUISITION_STATUS.DRAFT]: 'Draft',
  [REQUISITION_STATUS.PENDING_RECOMMENDATION]: 'Pending Section Head',
  [REQUISITION_STATUS.PENDING_INVENTORY]: 'Pending Warehouse Head',
  [REQUISITION_STATUS.PENDING_BUDGET]: 'Pending Budget Officer',
  [REQUISITION_STATUS.PENDING_AUDIT]: 'Pending Internal Auditor',
  [REQUISITION_STATUS.PENDING_APPROVAL]: 'Pending General Manager',
  [REQUISITION_STATUS.APPROVED]: 'Approved',
  [REQUISITION_STATUS.REJECTED]: 'Rejected',
}

const combinedRequisitions = computed(() => [...requisitions.value, ...moreRequisitions.value])

const filteredRequisitions = computed(() => {
  const list = combinedRequisitions.value
  const w = approverWorkflow.value

  // Approver inbox: only items waiting for my approval
  if (w && !showAll.value) {
    return list.filter((r) => r.status === w.canApproveStatus)
  }

  // Approver "my history": only items I already processed (approved/declined)
  if (w && showAll.value) {
    const myId = authStore.user?.uid
    return list.filter((r) => {
      const approvedByMe = r?.[w.field]?.userId && r?.[w.field]?.userId === myId
      const declinedByMe = r?.rejectedBy?.userId && r?.rejectedBy?.userId === myId
      return !!(approvedByMe || declinedByMe)
    })
  }

  // Requester (or fallback): allow filtering (now mostly handled server-side)
  return list
})

const totalPages = computed(
  () => Math.ceil(filteredRequisitions.value.length / pageSize.value) || 1,
)

const paginatedRequisitions = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredRequisitions.value.slice(start, start + pageSize.value)
})

function handlePageChange(p) {
  currentPage.value = p

  // Smooth scroll back to top of table
  if (tableContainer.value) {
    tableContainer.value.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Buffered Load More
  const currentViewEnd = p * pageSize.value
  const bufferEnd = combinedRequisitions.value.length
  if (currentViewEnd > bufferEnd - 15 && hasMore.value && !loadingMore.value) {
    loadMore()
  }
}

watch([filterStatus, showAll, pageSize], () => {
  currentPage.value = 1
})

const inboxCount = computed(() => {
  const w = approverWorkflow.value
  if (!w) return 0
  return combinedRequisitions.value.filter((r) => r.status === w.canApproveStatus).length
})

const historyCount = computed(() => {
  const w = approverWorkflow.value
  if (!w) return 0
  const myId = authStore.user?.uid
  return combinedRequisitions.value.filter((r) => {
    const approvedByMe = r?.[w.field]?.userId && r?.[w.field]?.userId === myId
    const declinedByMe = r?.rejectedBy?.userId && r?.rejectedBy?.userId === myId
    return !!(approvedByMe || declinedByMe)
  }).length
})

const headerSubtitle = computed(() => {
  const w = approverWorkflow.value
  if (w) {
    return showAll.value
      ? 'History · Requisitions you already processed'
      : 'Inbox · Requisitions waiting for your approval'
  }
  return 'View every requisition in the system'
})

function needsMyApproval(r) {
  const w = approverWorkflow.value
  return w && r.status === w.canApproveStatus
}

function startRealtime() {
  if (unsubscribe) unsubscribe()

  // Only show full-page loading if we have no data at all
  if (requisitions.value.length === 0) {
    loading.value = true
  }

  error.value = null
  moreRequisitions.value = []
  lastDoc.value = null
  hasMore.value = false

  const filters = {}
  if (filterStatus.value) {
    filters.status = filterStatus.value
  }

  unsubscribe = subscribeRequisitions(
    filters,
    (results, lastDocSnapshot) => {
      requisitions.value = results
      lastDoc.value = lastDocSnapshot
      hasMore.value = results.length === REQUISITION_PAGE_SIZE
      error.value = null
      loading.value = false
    },
    (err) => {
      error.value = err?.message || 'Failed to load requisitions.'
      loading.value = false
    },
    { pageSize: REQUISITION_PAGE_SIZE },
  )
}

async function loadMore() {
  if (!lastDoc.value || loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const filters = {}
    if (filterStatus.value) {
      filters.status = filterStatus.value
    }
    const {
      requisitions: next,
      lastDoc: nextLastDoc,
      hasMore: nextHasMore,
    } = await loadMoreRequisitions(filters, lastDoc.value, REQUISITION_PAGE_SIZE)
    moreRequisitions.value = [...moreRequisitions.value, ...next]
    lastDoc.value = nextLastDoc
    hasMore.value = nextHasMore
  } catch (e) {
    error.value = e?.message || 'Failed to load more.'
  } finally {
    loadingMore.value = false
  }
}

function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString()
}

function goToDetail(id) {
  router.push(`/requisitions/${id}`)
}

watch(
  () => authStore.role,
  () => {
    // Approvers default to inbox; requesters keep their filter
    if (approverWorkflow.value) {
      showAll.value = false
      filterStatus.value = ''
    }
  },
  { immediate: true },
)

watch(filterStatus, () => {
  currentPage.value = 1
  startRealtime()
})

onMounted(startRealtime)

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <div class="all-requisitions jinja">
    <div class="page-header">
      <div class="page-header-row">
        <div class="page-title-block">
          <h1 class="page-title">All requisitions</h1>
          <p class="page-subtitle">{{ headerSubtitle }}</p>
        </div>

        <div v-if="approverWorkflow" class="workflow-switcher">
          <button class="switcher-item" :class="{ active: !showAll }" @click="showAll = false">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="switcher-icon"
            >
              <path
                d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
              />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <span class="switcher-label">For my approval</span>
            <span class="switcher-count" :class="{ highlight: inboxCount > 0 }">{{
              inboxCount
            }}</span>
          </button>
          <button class="switcher-item" :class="{ active: showAll }" @click="showAll = true">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="switcher-icon"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span class="switcher-label">My history</span>
            <span class="switcher-count">{{ historyCount }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div class="panel-title-container">
          <div class="panel-pill">{{ showAll ? 'Processed' : 'Action Required' }}</div>
          <h2 class="panel-title-text">
            {{ showAll ? 'Approval History' : 'Pending Review' }}
            <span class="count-chip">{{ filteredRequisitions.length }}</span>
          </h2>
        </div>
        <div class="panel-controls">
          <div v-if="isRequester" class="filter-group">
            <select v-model="filterStatus" class="premium-select">
              <option value="">All Status</option>
              <option v-for="(label, key) in statusLabel" :key="key" :value="key">
                {{ label }}
              </option>
            </select>
          </div>
          <button
            v-if="!isGM && !approverWorkflow"
            class="btn-primary glint"
            @click="router.push('/requisitions/new')"
          >
            <span class="btn-icon">＋</span>
            New Request
          </button>
        </div>
      </div>

      <div class="panel-body">
        <div v-if="error" class="error-message">
          <span class="error-icon">⚠️</span>
          {{ error }}
        </div>

        <div v-else class="table-section">
          <div class="table-container" ref="tableContainer">
            <table class="data-table">
              <thead>
                <tr>
                  <th>RF Control No.</th>
                  <th>Date</th>
                  <th>Department</th>
                  <th>Requested By</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Items</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="loading" class="loading-row" key="loading">
                  <td colspan="8" class="loading-cell">
                    <div class="spinner small"></div>
                    <span>Loading requisitions…</span>
                  </td>
                </tr>
                <tr v-else-if="filteredRequisitions.length === 0" class="empty-row" key="empty">
                  <td colspan="8" class="empty-cell">
                    <span>No requisitions match your criteria</span>
                  </td>
                </tr>
                <tr
                  v-else
                  v-for="r in paginatedRequisitions"
                  :key="r.id"
                  @click="goToDetail(r.id)"
                  class="row-item"
                >
                  <td class="font-medium">{{ r.rfControlNo || '—' }}</td>
                  <td>{{ formatDate(r.date) }}</td>
                  <td>{{ getDeptAbbreviation(r.department) }}</td>
                  <td>{{ r.requestedBy?.name || '—' }}</td>
                  <td class="purpose-cell">
                    {{ (r.purpose || '').slice(0, 30)
                    }}{{ (r.purpose || '').length > 30 ? '…' : '' }}
                  </td>
                  <td>
                    <span :class="['status-badge', r.status]">{{
                      statusLabel[r.status] || r.status
                    }}</span>
                  </td>
                  <td class="text-center">{{ (r.items || []).length }}</td>
                  <td class="workflow-cell">
                    <button
                      v-if="needsMyApproval(r)"
                      type="button"
                      class="btn-workflow"
                      @click.stop="goToDetail(r.id)"
                    >
                      Review
                    </button>
                    <button
                      v-else
                      type="button"
                      class="btn-workflow-outline"
                      @click.stop="goToDetail(r.id)"
                    >
                      View
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <PaginationComponent
            :current-page="currentPage"
            :total-pages="totalPages"
            :page-size="pageSize"
            :total-items="filteredRequisitions.length"
            :loading="loading || loadingMore"
            @page-change="handlePageChange"
          />
        </div>
      </div>
    </div>
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

.all-requisitions {
  width: 100%;
  padding: 0.75rem 1.5rem 1.25rem;
  background: var(--jinja-bg);
  height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.page-header {
  margin-bottom: 1rem;
  flex-shrink: 0;
}

.page-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.page-title-block {
  display: flex;
  flex-direction: column;
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

.metrics-row {
  display: none; /* Replaced by workflow-switcher */
}

.workflow-switcher {
  display: flex;
  background: #f1f5f9;
  padding: 0.25rem;
  border-radius: 12px;
  gap: 0.25rem;
  border: 1px solid #e2e8f0;
}

.switcher-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 1rem;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  color: #64748b;
}

.switcher-item:hover {
  color: #1e293b;
  background: rgba(255, 255, 255, 0.5);
}

.switcher-item.active {
  background: #fff;
  color: #0ea5e9;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06);
}

.switcher-icon {
  flex-shrink: 0;
}

.switcher-label {
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
}

.switcher-count {
  font-size: 0.75rem;
  font-weight: 800;
  background: #e2e8f0;
  color: #475569;
  padding: 0.125rem 0.5rem;
  border-radius: 6px;
  min-width: 1.5rem;
  text-align: center;
  transition: all 0.2s;
}

.switcher-item.active .switcher-count {
  background: #0ea5e9;
  color: #fff;
}

.switcher-count.highlight {
  background: #ef4444;
  color: #fff;
}

.switcher-item.active .switcher-count.highlight {
  background: #ef4444;
}

.header-metric {
  display: none; /* Cleanup */
}

.panel {
  flex: 1;
  background: #fff;
  border: 1px solid #f1f5f9;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.panel-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  flex-shrink: 0;
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
  background: #0ea5e9;
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
  box-shadow: 0 4px 6px -1px rgba(14, 165, 233, 0.3);
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
  overflow-y: scroll;
  scrollbar-gutter: stable;
  min-height: 0;
  max-height: calc(100vh - 360px);
}

/* Custom Scrollbar */
.table-container::-webkit-scrollbar {
  width: 10px;
}
.table-container::-webkit-scrollbar-track {
  background: #f1f5f9;
}
.table-container::-webkit-scrollbar-thumb {
  background: #64748b;
  border-radius: 10px;
  border: 2px solid #f1f5f9;
}
.table-container::-webkit-scrollbar-thumb:hover {
  background: #475569;
}

.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.data-table th {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #f8fafc;
  padding: 0.875rem 1.25rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #475569;
  border-bottom: 2px solid #f1f5f9;
}

.data-table td {
  padding: 0.875rem 1.25rem;
  font-size: 0.9375rem;
  color: #1e293b;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.data-table tbody tr:hover {
  background: #f8fafc;
}

.font-medium {
  font-weight: 700;
  color: #0f172a;
}

.purpose-cell {
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.text-center {
  text-align: center;
}

.workflow-cell {
  text-align: right;
  padding-right: 1.5rem;
}

.btn-workflow {
  padding: 0.45rem 0.9rem;
  background: #0ea5e9;
  border: none;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 700;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(14, 165, 233, 0.2);
}

.btn-workflow:hover {
  background: #0284c7;
  transform: translateY(-1px);
}

.btn-workflow-outline {
  padding: 0.45rem 0.9rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 700;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-workflow-outline:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #1e293b;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.625rem;
  border-radius: 6px;
  font-size: 0.6875rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.status-badge.draft {
  background: #f1f5f9;
  color: #475569;
}

.status-badge.pending_recommendation,
.status-badge.pending_inventory,
.status-badge.pending_budget,
.status-badge.pending_audit,
.status-badge.pending_approval {
  background: #fffbeb;
  color: #854d0e;
}

.status-badge.approved {
  background: #f0fdf4;
  color: #166534;
}

.status-badge.rejected {
  background: #fef2f2;
  color: #991b1b;
}

.load-more-wrap {
  padding: 1.25rem;
  text-align: center;
  border-top: 1px solid #f1f5f9;
}

.btn-load-more {
  background: #fff;
  border: 1px solid #e2e8f0;
  padding: 0.4rem 1.25rem;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-load-more:hover:not(:disabled) {
  color: #0f172a;
  border-color: #cbd5e1;
  background: #f8fafc;
}

.error-message {
  padding: 1rem 1.5rem;
  background: #fef2f2;
  border-left: 4px solid #ef4444;
  margin: 1.5rem;
  color: #991b1b;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 8px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #e2e8f0;
  border-top-color: #0ea5e9;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
