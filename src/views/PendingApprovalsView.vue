<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  subscribeRequisitions,
  APPROVAL_WORKFLOW,
  REQUISITION_PAGE_SIZE,
} from '@/services/requisitionService'
import { getDeptAbbreviation } from '@/utils/deptUtils'
import { REQUISITION_STATUS, USER_ROLE_LABELS } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import PaginationComponent from '@/components/PaginationComponent.vue'

const router = useRouter()
const authStore = useAuthStore()
const requisitions = ref([])
const loading = ref(true)
const error = ref(null)

const pageSize = ref(10) // Standard page size for the UI
const currentPage = ref(1)
const tableContainer = ref(null)

let unsubscribe = null

const approverWorkflow = computed(() => APPROVAL_WORKFLOW[authStore.role])

const pendingRequisitions = computed(() => {
  if (!approverWorkflow.value) return []
  // Filter for items matching the approver's "canApprove" status
  return requisitions.value.filter((r) => r.status === approverWorkflow.value.canApproveStatus)
})

const totalRows = computed(() => pendingRequisitions.value.length)
const totalPages = computed(() => Math.ceil(totalRows.value / pageSize.value) || 1)

const paginatedRequisitions = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return pendingRequisitions.value.slice(start, start + pageSize.value)
})

function handlePageChange(p) {
  currentPage.value = p
  // Smooth scroll back to top of table
  if (tableContainer.value) {
    tableContainer.value.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function initSubscription() {
  const workflow = approverWorkflow.value
  if (!workflow) {
    loading.value = false
    return
  }

  loading.value = true
  error.value = null

  if (unsubscribe) unsubscribe()

  // We subscribe to a larger buffer (200) to allow numbered pagination across the inbox.
  unsubscribe = subscribeRequisitions(
    { status: workflow.canApproveStatus },
    (results) => {
      requisitions.value = results
      loading.value = false
    },
    (err) => {
      error.value = err.message || 'Failed to load requisitions.'
      loading.value = false
    },
    { pageSize: 200 },
  )
}

function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString()
}

function goToDetail(id) {
  router.push(`/requisitions/${id}`)
}

onMounted(initSubscription)

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

// Ensure currentPage stays valid if the list changes
watch(totalRows, (newTotal) => {
  const maxPage = Math.ceil(newTotal / pageSize.value) || 1
  if (currentPage.value > maxPage) {
    currentPage.value = maxPage
  }
})
</script>

<template>
  <div class="pending-approvals jinja">
    <div class="page-header">
      <h1 class="page-title">Pending your approval</h1>
      <p class="page-subtitle">
        Requisitions waiting for your review. Accept or decline each request.
      </p>
      <span v-if="pendingRequisitions.length > 0" class="count-badge"
        >{{ pendingRequisitions.length }} pending</span
      >
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="role-context">{{ USER_ROLE_LABELS[authStore.role] }}</span>

        <div v-if="pendingRequisitions.length > 0" class="header-tools">
          <label>View:</label>
          <select v-model.number="pageSize" class="page-size-select" @change="currentPage = 1">
            <option :value="10">10 per page</option>
            <option :value="25">25 per page</option>
            <option :value="50">50 per page</option>
          </select>
        </div>
      </div>

      <div class="panel-body">
        <div v-if="error" class="error-message">
          <span class="error-icon">⚠️</span>
          {{ error }}
        </div>

        <div v-else-if="loading" class="loading-inline">
          <div class="spinner small"></div>
          <span>Loading pending approvals…</span>
        </div>

        <div v-else-if="pendingRequisitions.length === 0" class="empty-state">
          <div class="empty-icon">✅</div>
          <h3>All caught up!</h3>
          <p>No requisitions need your approval right now.</p>
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
                  <th class="text-center">Items</th>
                  <th class="text-center">Action</th>
                </tr>
              </thead>
              <TransitionGroup tag="tbody" name="list-fade">
                <tr v-if="loading" class="loading-row" key="loading">
                  <td colspan="8" class="loading-cell">
                    <div class="spinner small"></div>
                    <span>Loading pending requisitions…</span>
                  </td>
                </tr>
                <tr v-else-if="pendingRequisitions.length === 0" class="empty-row" key="empty">
                  <td colspan="8" class="empty-cell">
                    <span>No pending requisitions for your review</span>
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
                      approverWorkflow.statusLabel || r.status
                    }}</span>
                  </td>
                  <td class="text-center">{{ (r.items || []).length }}</td>
                  <td class="workflow-cell action-buttons">
                    <button type="button" class="btn-workflow" @click.stop="goToDetail(r.id)">
                      Review
                    </button>
                  </td>
                </tr>
              </TransitionGroup>
            </table>
          </div>

          <PaginationComponent
            :current-page="currentPage"
            :total-pages="totalPages"
            :page-size="pageSize"
            :total-items="totalRows"
            :loading="loading"
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
  --jinja-border: #e2e8f0;
  --jinja-text: #0f172a;
  --jinja-muted: #64748b;
  --jinja-radius: 8px;
}

/* Transitions */
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
  background-color: #f1f5f9;
}

.pending-approvals {
  width: 100%;
  padding: 1.5rem 1.75rem;
  background: var(--jinja-bg);
  height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

.page-header {
  margin-bottom: 1.25rem;
  flex-shrink: 0;
}
.page-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--jinja-text);
  letter-spacing: -0.02em;
}
.page-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--jinja-muted);
}
.count-badge {
  display: inline-block;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #c2410c;
  background: #fff7ed;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.role-context {
  font-size: 0.75rem;
  color: var(--jinja-muted);
}

.panel {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--jinja-surface);
  border: 1px solid var(--jinja-border);
  border-radius: var(--jinja-radius);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.panel-header {
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--jinja-border);
  background: var(--jinja-surface);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--jinja-muted);
}

.page-size-select {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--jinja-border);
  border-radius: 6px;
  font-size: 0.75rem;
  background: white;
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s;
}

.page-size-select:focus {
  border-color: #0ea5e9;
}

.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.table-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.table-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
  scrollbar-gutter: stable;
}
/* Premium Scrollbar — Jinja Standard */
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

/* Removed .pagination-bar as it's replaced by PaginationComponent */

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.table-container .data-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--jinja-bg);
}
.data-table th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--jinja-muted);
  background: var(--jinja-bg);
  border-bottom: 1px solid var(--jinja-border);
}

.data-table td {
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  color: var(--jinja-text);
  border-bottom: 1px solid var(--jinja-border);
}

.data-table tbody tr {
  cursor: pointer;
  transition: background 0.12s;
}
.data-table tbody tr:hover {
  background: var(--jinja-bg);
}
.data-table tbody tr:last-child td {
  border-bottom: none;
}

.font-medium {
  font-weight: 600;
  color: var(--jinja-text);
}
.text-center {
  text-align: center;
}
.purpose-cell {
  max-width: 180px;
}
.action-cell {
  text-align: center;
}

.btn-review {
  padding: 0.35rem 0.75rem;
  background: var(--jinja-text);
  color: #fff;
  border: 1px solid var(--jinja-text);
  border-radius: var(--jinja-radius);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.btn-review:hover {
  background: #1e293b;
  border-color: #1e293b;
}

.loading-state,
.empty-state {
  padding: 4rem 2rem;
  text-align: center;
  color: #64748b;
}

.loading-inline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem;
  color: #64748b;
  font-size: 0.9375rem;
}

.loading-inline .spinner.small {
  width: 20px;
  height: 20px;
  border-width: 2px;
  margin: 0;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e7eb;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 1rem;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-state .empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}
.empty-state h3 {
  margin: 0 0 0.5rem;
  color: #1e293b;
  font-size: 1.125rem;
}
.empty-state p {
  margin: 0;
  font-size: 0.875rem;
}

.error-message {
  margin: 1rem;
  padding: 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #dc2626;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
