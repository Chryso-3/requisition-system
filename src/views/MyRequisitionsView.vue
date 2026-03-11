<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  subscribeRequisitions,
  loadMoreRequisitions,
  getRequisitionCurrentStep,
  REQUISITION_PAGE_SIZE,
  getUserRequisitionStats,
  subscribeAnalyticsSummary,
} from '@/services/requisitionService'
import { REQUISITION_STATUS, USER_ROLES } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import RequisitionForm from '@/components/RequisitionForm.vue'
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
const filterStatus = ref('')
const searchKeywords = ref('')
const showNewReqModal = ref(false)
const pageSize = ref(10)
const currentPage = ref(1)
const tableContainer = ref(null)
let unsubscribe = null
let unsubscribeStats = null

const userStats = ref({
  total: 0,
  draft: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
})

const globalStats = ref(null)

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

const isGlobalRole = computed(() =>
  [USER_ROLES.GENERAL_MANAGER, USER_ROLES.SUPER_ADMIN].includes(authStore.role),
)

const combinedRequisitions = computed(() => [...requisitions.value, ...moreRequisitions.value])

const myRequisitions = computed(() => {
  if (!authStore?.user) return []
  if (isGlobalRole.value) return combinedRequisitions.value
  // Everyone else (Managers/Requestors) sees only their own personal records in this view
  return combinedRequisitions.value.filter((r) => r.requestedBy?.userId === authStore?.user?.uid)
})

const filteredRequisitions = computed(() => {
  let list = myRequisitions.value

  // Client-side status filter
  if (filterStatus.value) {
    if (filterStatus.value === 'pending') {
      // 'pending' is a sentinel meaning any pending_* status
      list = list.filter((r) => (r.status || '').startsWith('pending_'))
    } else if (filterStatus.value !== 'received') {
      // 'received' is handled by purchaseStatus on the Firestore side; skip client filter
      list = list.filter((r) => r.status === filterStatus.value)
    }
  }

  if (searchKeywords.value) {
    const kw = searchKeywords.value.toLowerCase()
    list = list.filter(
      (r) =>
        (r.rfControlNo || '').toLowerCase().includes(kw) ||
        (r.purpose || '').toLowerCase().includes(kw) ||
        (r.department || '').toLowerCase().includes(kw),
    )
  }
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

// Reset pagination on filter or search
watch([filterStatus, searchKeywords, pageSize], () => {
  currentPage.value = 1
})

const stats = computed(() => {
  if (isGlobalRole.value && globalStats.value) {
    const s = globalStats.value
    // Global role sees global summary
    const pendingTotal = Object.entries(s.byStatus || {})
      .filter(([status]) => status.startsWith('pending_'))
      .reduce((sum, [, count]) => sum + count, 0)

    return {
      total: s.total || 0,
      draft: s.byStatus?.[REQUISITION_STATUS.DRAFT] || 0,
      pending: pendingTotal,
      approved: s.byStatus?.[REQUISITION_STATUS.APPROVED] || 0,
    }
  }

  // Regular user/manager sees their specific personal stats
  return {
    total: userStats.value.total,
    draft: userStats.value.draft,
    pending: userStats.value.pending,
    approved: userStats.value.approved,
  }
})

async function refreshUserStats() {
  if (isGlobalRole.value || !authStore?.user) return
  try {
    // Everyone except GM/Admin sees their OWN stats
    import('@/services/requisitionService').then(async (m) => {
      const data = await m.getUserRequisitionStats(authStore.user.uid)
      if (data) userStats.value = data
    })
  } catch (e) {
    console.warn('Failed to fetch user stats:', e)
  }
}

function getCurrentStep(r) {
  return getRequisitionCurrentStep(r).label
}

function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString()
}

function goToDetail(id) {
  router.push({ path: `/requisitions/${id}`, query: { from: 'my-requisitions' } })
}

function createNew() {
  showNewReqModal.value = true
}

function handleFormCreated(doc) {
  showNewReqModal.value = false
  if (doc?.id) {
    router.push({ path: `/requisitions/${doc.id}`, query: { from: 'my-requisitions' } })
  }
}

function handleFormUpdated() {
  showNewReqModal.value = false
}

function handleFormCancel() {
  showNewReqModal.value = false
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

  // Filters: Strictly personal for everyone except GM/Admin
  const filters = isGlobalRole.value ? {} : { requestedBy: authStore?.user?.uid }

  if (filterStatus.value) {
    if (filterStatus.value === 'received') {
      filters.purchaseStatus = 'received'
    } else if (filterStatus.value !== 'pending') {
      filters.status = filterStatus.value
    }
  }

  // Refresh user-specific aggregated counts
  refreshUserStats()

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
      error.value = err?.message || 'Unable to load requisitions.'
      loading.value = false
    },
    { pageSize: REQUISITION_PAGE_SIZE },
  )
}

async function loadMore() {
  if (!lastDoc.value || loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const filters = isGlobalRole.value ? {} : { requestedBy: authStore?.user?.uid }
    if (filterStatus.value) {
      if (filterStatus.value === 'received') {
        filters.purchaseStatus = 'received'
      } else if (filterStatus.value !== 'pending') {
        filters.status = filterStatus.value
      }
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

// Handle authentication and initial data flow
watch(
  [() => authStore.loading, () => authStore.user],
  ([loadingAuth, user]) => {
    if (loadingAuth) return

    // Clean up if user logged out
    if (!user) {
      if (unsubscribe) unsubscribe()
      if (unsubscribeStats) unsubscribeStats()
      return
    }

    // Start data flows
    startRealtime()

    // Handle stats based on role
    if (unsubscribeStats) unsubscribeStats()
    if (isGlobalRole.value) {
      unsubscribeStats = subscribeAnalyticsSummary((data) => {
        globalStats.value = data
      })
    } else {
      // Regular user: fetch initial aggregated counts
      refreshUserStats()
    }
  },
  { immediate: true },
)

// Watch filters or role changes to restart subscription
watch([filterStatus, isGlobalRole], (newVal, oldVal) => {
  if (authStore.loading || !authStore.user) return

  currentPage.value = 1
  startRealtime()

  // Handle GM role switch for stats listeners
  const [newFilter, newRole] = newVal
  const [, oldRole] = oldVal || []

  if (newRole !== oldRole) {
    if (unsubscribeStats) unsubscribeStats()
    if (newRole) {
      unsubscribeStats = subscribeAnalyticsSummary((data) => {
        globalStats.value = data
      })
    } else {
      // Switched away from GM, refresh user stats
      refreshUserStats()
    }
  }
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (unsubscribeStats) unsubscribeStats()
})
</script>

<template>
  <div class="my-requisitions jinja">
    <div class="page-header">
      <h1 class="page-title">My requisitions</h1>
      <p v-if="isGlobalRole" class="page-subtitle">
        View only — you can open requisitions to see details and approve when pending your approval.
      </p>
    </div>
    <div class="stats-hero">
      <div class="stat-card" @click="filterStatus = ''">
        <div class="stat-visual total">
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
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.total }}</span>
          <span class="stat-label">Total Volume</span>
        </div>
      </div>
      <div class="stat-card" @click="filterStatus = 'draft'">
        <div class="stat-visual draft">
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
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.draft }}</span>
          <span class="stat-label">Saved Drafts</span>
        </div>
      </div>
      <div class="stat-card yellow" @click="filterStatus = 'pending'">
        <div class="stat-visual pending">
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
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="M4.93 4.93l2.83 2.83" />
            <path d="M16.24 16.24l2.83 2.83" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
            <path d="M4.93 19.07l2.83-2.83" />
            <path d="M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.pending }}</span>
          <span class="stat-label">Active Approval</span>
        </div>
      </div>
      <div class="stat-card green" @click="filterStatus = 'approved'">
        <div class="stat-visual approved">
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
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.approved }}</span>
          <span class="stat-label">Approved</span>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div class="panel-title-container">
          <div class="panel-pill">Active Records</div>
          <h2 class="panel-title-text">
            Recent Requisitions <span class="count-chip">{{ filteredRequisitions.length }}</span>
          </h2>
        </div>
        <div class="panel-controls">
          <div class="search-box">
            <svg
              class="search-icon"
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
              v-model="searchKeywords"
              type="text"
              placeholder="Search purpose, ID..."
              class="search-input"
            />
          </div>
          <div class="filter-group">
            <select v-model="filterStatus" class="premium-select">
              <option value="">All Workflow Status</option>
              <option value="received">✅ Received (Finished Product)</option>
              <option v-for="(label, key) in statusLabel" :key="key" :value="key">
                {{ label }}
              </option>
            </select>
          </div>
          <button v-if="!isGlobalRole" class="btn-primary glint" @click="createNew">
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
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Purchase</th>
                  <th>Currently at</th>
                  <th>Items</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="loading" class="loading-row" key="loading">
                  <td colspan="9" class="loading-cell">
                    <div class="spinner small"></div>
                    <span>Loading your requisitions…</span>
                  </td>
                </tr>
                <tr v-else-if="filteredRequisitions.length === 0" class="empty-row" key="empty">
                  <td colspan="9" class="empty-cell">
                    <span v-if="!searchKeywords && !filterStatus"
                      >No requisitions match your filter. Create your first to get started.</span
                    >
                    <span v-else>No requisitions match your filter.</span>
                    <button
                      v-if="!isGlobalRole"
                      class="btn-primary inline-btn"
                      @click.stop="createNew"
                    >
                      <span class="btn-icon">+</span>
                      Create Requisition
                    </button>
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
                  <td class="purpose-cell" :title="r.purpose">
                    {{ r.purpose || '—' }}
                  </td>
                  <td>
                    <span :class="['status-badge', r.status]">{{
                      statusLabel[r.status] || r.status
                    }}</span>
                  </td>
                  <td>
                    <template v-if="r.status === REQUISITION_STATUS.APPROVED">
                      <span :class="['purchase-badge', r.purchaseStatus || 'pending']">
                        {{
                          (r.purchaseStatus || 'pending').charAt(0).toUpperCase() +
                          (r.purchaseStatus || 'pending').slice(1)
                        }}
                      </span>
                    </template>
                    <span v-else class="text-muted small">—</span>
                  </td>
                  <td class="current-step-cell">{{ getCurrentStep(r) }}</td>
                  <td class="text-center">{{ (r.items || []).length }}</td>
                  <td class="workflow-cell action-buttons">
                    <button type="button" class="btn-workflow" @click.stop="goToDetail(r.id)">
                      Workflow
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

    <!-- NEW REQUISITION MODAL -->
    <Transition name="modal-fade">
      <div v-if="showNewReqModal" class="modal-overlay" @click.self="handleFormCancel">
        <div class="modal-container">
          <div class="modal-header">
            <h2 class="modal-title">New Requisition</h2>
            <button class="modal-close" @click="handleFormCancel">✕</button>
          </div>
          <div class="modal-body-form">
            <RequisitionForm
              @created="handleFormCreated"
              @updated="handleFormUpdated"
              @cancel="handleFormCancel"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* PREMIUM REDESIGN STYLES */
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
.my-requisitions {
  width: 100%;
  padding: 0.75rem 1.5rem 1.25rem; /* Added slight top padding for breathing room */
  background: #f8fafc;
  height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.025em;
  margin-top: 0;
  margin-bottom: 1rem;
}

/* Stats Hero Section */
.stats-hero {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  background: #fff;
  padding: 1rem 1.25rem;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 1rem;
  border: 1px solid #f1f5f9;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  transition: all 0.2s;
  cursor: pointer;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.08);
  border-color: #e2e8f0;
}

.stat-visual {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f9ff;
  color: #0369a1;
}
.stat-visual svg {
  width: 20px;
  height: 20px;
}

.stat-visual.draft {
  background: #f8fafc;
  color: #475569;
}
.stat-visual.pending {
  background: #fffbeb;
  color: #b45309;
}
.stat-visual.approved {
  background: #f0fdf4;
  color: #15803d;
}

.stat-info {
  display: flex;
  flex-direction: column;
}
.stat-value {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  line-height: 1;
  margin-bottom: 0.15rem;
}
.stat-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Main Panel */
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
  color: #10b981;
  background: #ecfdf5;
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

.search-box {
  position: relative;
  width: 240px;
}

.search-icon {
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
  border-color: #0ea5e9;
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
}

.btn-primary.glint {
  position: relative;
  overflow: hidden;
  box-shadow: 0 8px 15px rgba(14, 165, 233, 0.3);
}

.btn-primary:hover {
  background: #0284c7;
  transform: translateY(-2px);
}

/* Table Styling */
.table-section {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.table-container {
  flex: 1;
  overflow-y: scroll; /* Force show to prove scrollability */
  scrollbar-gutter: stable;
  min-height: 0;
  max-height: calc(100vh - 380px); /* Strict boundary to force scroll */
}

/* Custom Scrollbar - High Visibility */
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
  font-size: 0.9375rem; /* ~15px Standard */
  color: #1e293b;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.data-table tbody tr:hover {
  background: #f1f5f9/30;
}

.font-medium {
  font-weight: 700;
  color: #0f172a;
}

.purpose-cell {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
  word-break: break-word;
}

/* Status Badges */
.status-badge,
.purchase-badge {
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

.purchase-badge.pending {
  background: #fff7ed;
  color: #9a3412;
}
.purchase-badge.ordered {
  background: #eff6ff;
  color: #1e40af;
}
.purchase-badge.received {
  background: #f0fdf4;
  color: #166534;
  border: 1px solid rgba(22, 101, 52, 0.1);
}

.btn-workflow {
  padding: 0.45rem 0.9rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 700;
  color: #0ea5e9;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-workflow:hover {
  background: #f0f9ff;
  border-color: #0ea5e9;
}

.load-more-wrap {
  padding: 1.5rem;
  text-align: center;
  border-top: 1px solid #f1f5f9;
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
.btn-load-more:hover {
  color: #0f172a;
  border-color: #cbd5e1;
}

/* MODAL STYLES */
.modal-overlay {
  position: fixed;
  inset: 0; /* Cover everything */
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5000;
  padding: 2rem;
  transition: opacity 0.3s ease;
}

.modal-container {
  background: #fff;
  width: 100%;
  max-width: 900px;
  height: 90vh; /* Standard professional height */
  border-radius: 24px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 5001;
}

.modal-header {
  padding: 1.25rem 1.75rem;
  background: #fff;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 800;
  color: #0f172a;
}

.btn-delete-draft {
  background: rgba(239, 68, 68, 0.04);
  border: 1px solid rgba(239, 68, 68, 0.1);
  color: #f87171;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-delete-draft:hover:not(:disabled) {
  background: #dc2626;
  border-color: #dc2626;
  color: #fff;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(220, 38, 38, 0.25);
}

.btn-delete-draft:active:not(:disabled) {
  transform: translateY(0);
}
.modal-close {
  background: #f1f5f9;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.875rem;
}

.modal-close:hover {
  background: #fee2e2;
  color: #ef4444;
}

.modal-body-form {
  flex: 1;
  overflow-y: auto;
  padding: 0; /* Let RequisitionForm handle internal padding */
  background: #f8fafc;
}

/* Modal Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

@keyframes modal-slide-up {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* Custom Scrollbar for Modal Body */
.modal-body-form::-webkit-scrollbar {
  width: 8px;
}
.modal-body-form::-webkit-scrollbar-track {
  background: #f1f5f9;
}
.modal-body-form::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 10px;
}
.modal-body-form::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
