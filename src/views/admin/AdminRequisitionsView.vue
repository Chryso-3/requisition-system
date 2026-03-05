<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import {
  subscribeRequisitions,
  forceAdvanceStep,
  voidRequisition,
  getRequisitionCurrentStep,
  clearAllTestingData,
  getRequisitionCount,
  REQUISITION_PAGE_SIZE,
} from '@/services/requisitionService'
import { getDeptAbbreviation } from '@/utils/deptUtils'
import { REQUISITION_STATUS, USER_ROLE_LABELS, USER_ROLES } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import PaginationComponent from '@/components/PaginationComponent.vue'
import {
  Search,
  Filter,
  ChevronRight,
  XOctagon,
  ArrowRightCircle,
  MessageSquare,
  AlertCircle,
  Clock,
  Building2,
  FileText,
  Trash2,
  Database,
} from 'lucide-vue-next'

const authStore = useAuthStore()
const requisitions = ref([])
const loading = ref(true)
const searchQuery = ref('')
const statusFilter = ref('all')
const processingId = ref(null)
let unsubscribe = null

// Pagination State
const currentPage = ref(1)
const totalItems = ref(0)
const pageSize = ref(REQUISITION_PAGE_SIZE)
const totalPages = computed(() => Math.ceil(totalItems.value / pageSize.value) || 1)
const lastDocs = ref([]) // To keep track of cursors for each page

const statusFilterOptions = computed(() => {
  const workflowOrder = [
    REQUISITION_STATUS.DRAFT,
    REQUISITION_STATUS.PENDING_RECOMMENDATION,
    REQUISITION_STATUS.PENDING_INVENTORY,
    REQUISITION_STATUS.PENDING_BUDGET,
    REQUISITION_STATUS.PENDING_AUDIT,
    REQUISITION_STATUS.PENDING_APPROVAL,
    REQUISITION_STATUS.APPROVED,
    REQUISITION_STATUS.REJECTED,
  ]

  return workflowOrder.map((status) => ({
    value: status,
    label: getStatusLabel(status),
  }))
})

// Override Modal State
const showModal = ref(false)
const selectedReq = ref(null)
const overrideAction = ref('') // 'advance' or 'void'
const overrideReason = ref('')

// Reset Database State
const showResetModal = ref(false)
const resetStep = ref(1) // 1: confirm, 2: processing, 3: success
const isResetting = ref(false)
const resetCount = ref(0)

const filteredRequisitions = computed(() => {
  let filtered = requisitions.value

  if (statusFilter.value !== 'all') {
    filtered = filtered.filter((r) => r.status === statusFilter.value)
  }

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    filtered = filtered.filter(
      (r) =>
        r.rfControlNo?.toLowerCase().includes(q) ||
        r.department?.toLowerCase().includes(q) ||
        r.purpose?.toLowerCase().includes(q),
    )
  }

  return filtered
})

const duplicateRfMap = computed(() => {
  const counts = {}
  requisitions.value.forEach((r) => {
    const rf = r.rfControlNo
    if (rf && rf !== 'DRAFT') {
      counts[rf] = (counts[rf] || 0) + 1
    }
  })
  return counts
})

function openOverrideModal(req, action) {
  selectedReq.value = req
  overrideAction.value = action
  overrideReason.value = ''
  showModal.value = true
}

async function handleOverride() {
  if (!selectedReq.value) {
    alert('No requisition selected.')
    return
  }

  if (!overrideReason.value.trim()) {
    alert('Please provide a reason for the override.')
    return
  }

  processingId.value = selectedReq.value.id
  const reqId = selectedReq.value.id
  const action = overrideAction.value
  const reason = overrideReason.value

  showModal.value = false

  try {
    if (action === 'advance') {
      await forceAdvanceStep(reqId, authStore?.user, reason)
    } else if (action === 'void') {
      await voidRequisition(reqId, authStore?.user, reason)
    }
  } catch (err) {
    console.error('Override failed:', err)
    alert(`Failed to ${action} requisition: ` + err.message)
  } finally {
    processingId.value = null
  }
}

async function handleResetDatabase() {
  if (resetStep.value === 1) {
    resetStep.value = 2
    isResetting.value = true
    try {
      if (!authStore?.userProfile) {
        throw new Error('User profile not initialized. Please refresh the page.')
      }
      const count = await clearAllTestingData(authStore.userProfile)
      resetCount.value = count
      resetStep.value = 3
    } catch (err) {
      console.error('Reset failed:', err)
      alert('Database reset failed: ' + err.message)
      showResetModal.value = false
      resetStep.value = 1
    } finally {
      isResetting.value = false
    }
  } else {
    showResetModal.value = false
    resetStep.value = 1
  }
}

async function refreshData() {
  loading.value = true
  try {
    const filters = {}
    if (statusFilter.value !== 'all') filters.status = statusFilter.value

    // Get total count for pagination
    totalItems.value = await getRequisitionCount(filters)

    // Current simple approach for Admin: Page 1 is realtime, others can be static or navigated.
    // However, to keep it simple and consistent with the elite UI, we'll use listRequisitions for paginated jumps.
    // Actually, let's stick to the subscription for the visible page if we want to stay "live".
    if (unsubscribe) unsubscribe()

    // Page-to-cursor logic for Firestore
    const startAfter = currentPage.value > 1 ? lastDocs.value[currentPage.value - 2] : null

    unsubscribe = subscribeRequisitions(
      filters,
      (data, lastDoc) => {
        requisitions.value = data
        if (lastDoc) {
          lastDocs.value[currentPage.value - 1] = lastDoc
        }
        loading.value = false
      },
      (err) => {
        console.error('Error fetching requisitions:', err)
        loading.value = false
      },
      { pageSize: pageSize.value, startAfter },
    )
  } catch (err) {
    console.error('Failed to refresh data:', err)
    loading.value = false
  }
}

function handlePageChange(p) {
  currentPage.value = p
  refreshData()
}

// Re-fetch on filter change
watch([statusFilter], () => {
  currentPage.value = 1
  lastDocs.value = []
  refreshData()
})

onMounted(() => {
  refreshData()
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

function getStatusLabel(status) {
  const step = getRequisitionCurrentStep({ status })
  return step.label
}

function getCondensedStatusLabel(status) {
  const label = getStatusLabel(status)
  // Professional condensing for high-density table view
  if (label.includes('Section Head')) return 'Head Approval'
  if (label.includes('Warehouse')) return 'Warehouse'
  if (label.includes('Budget')) return 'Budget Check'
  if (label.includes('Auditor')) return 'Audit'
  if (label.includes('General Manager')) return 'GM Approval'
  return label
}

function getStatusClass(status) {
  if (status === REQUISITION_STATUS.APPROVED) return 'status-approved'
  if (status === REQUISITION_STATUS.REJECTED) return 'status-rejected'
  if (status === REQUISITION_STATUS.DRAFT) return 'status-draft'
  return 'status-pending'
}

function formatDate(date) {
  if (!date) return 'N/A'
  const d = date.toDate ? date.toDate() : new Date(date)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div class="admin-page">
    <header class="page-header">
      <div class="header-content">
        <h1 class="page-title">All Requisitions</h1>
        <p class="page-subtitle">Administrative overview and workflow control center</p>
      </div>
      <div class="header-actions">
        <button
          v-if="authStore?.role === USER_ROLES.SUPER_ADMIN"
          @click="showResetModal = true"
          class="btn-reset-db"
          title="Reset Database for Testing"
        >
          <Database :size="18" />
          <span>Reset Database</span>
        </button>
        <div class="search-box">
          <Search :size="18" class="search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search RF No, Department, Purpose..."
            class="search-input"
          />
        </div>
        <div class="filter-box">
          <select v-model="statusFilter" class="glass-select">
            <option value="all">All Statuses</option>
            <option v-for="opt in statusFilterOptions" :key="opt.value" :value="opt.value">
              {{ getCondensedStatusLabel(opt.value).toUpperCase() }}
            </option>
          </select>
        </div>
      </div>
    </header>

    <div v-if="loading" class="loading-state">
      <div class="glass-loader"></div>
      <p>Fetching requisition database...</p>
    </div>

    <div v-else class="glass-container elite-card">
      <div class="table-wrapper custom-scrollbar">
        <table class="req-table elite-table">
          <thead>
            <tr>
              <th class="col-rf">Control No.</th>
              <th class="col-origin">Origin / Dept</th>
              <th class="col-step">Current Step</th>
              <th class="col-status">Status</th>
              <th class="col-date">Created</th>
              <th class="col-actions text-right">Admin Actions</th>
            </tr>
          </thead>
          <transition-group name="list" tag="tbody">
            <tr v-for="req in filteredRequisitions" :key="req.id">
              <td class="col-rf">
                <div class="rf-cell">
                  <div class="rf-num-wrap">
                    <span class="rf-number-elite">#{{ req.rfControlNo || 'DRAFT' }}</span>
                    <span
                      v-if="req.rfControlNo && duplicateRfMap[req.rfControlNo] > 1"
                      class="duplicate-badge"
                      title="Multiple records share this RF Number"
                    >
                      DUPLICATE
                    </span>
                  </div>
                  <div class="purpose-preview-elite">{{ req.purpose }}</div>
                </div>
              </td>
              <td class="col-origin">
                <div class="origin-cell-elite">
                  <span class="dept-name-elite">{{ getDeptAbbreviation(req.department) }}</span>
                  <span class="requestor-name-elite">{{
                    req.requestedBy?.name || 'In Draft'
                  }}</span>
                </div>
              </td>
              <td class="col-step">
                <div class="step-info-elite">
                  {{ getStatusLabel(req.status) }}
                </div>
              </td>
              <td class="col-status">
                <span class="elite-badge" :class="getStatusClass(req.status)">
                  <span class="badge-dot"></span>
                  {{ getCondensedStatusLabel(req.status) }}
                </span>
              </td>
              <td class="col-date">
                <div class="date-text-elite">{{ formatDate(req.createdAt || req.date) }}</div>
              </td>
              <td class="col-actions text-right">
                <div class="action-buttons-elite">
                  <button
                    v-if="
                      req.status !== REQUISITION_STATUS.APPROVED &&
                      req.status !== REQUISITION_STATUS.REJECTED
                    "
                    @click="openOverrideModal(req, 'advance')"
                    class="btn-elite-action btn-advance"
                    title="Force Advance"
                    :disabled="processingId === req.id"
                  >
                    <ArrowRightCircle :size="16" />
                  </button>
                  <button
                    v-if="req.status !== REQUISITION_STATUS.REJECTED"
                    @click="openOverrideModal(req, 'void')"
                    class="btn-elite-action btn-void"
                    title="Void"
                    :disabled="processingId === req.id"
                  >
                    <XOctagon :size="16" />
                  </button>
                  <router-link
                    :to="`/requisitions/${req.id}?from=admin-requisitions`"
                    class="btn-elite-action btn-view"
                    title="View"
                  >
                    <ChevronRight :size="16" />
                  </router-link>
                </div>
              </td>
            </tr>
          </transition-group>
        </table>

        <div v-if="filteredRequisitions.length === 0" class="empty-state">
          <FileText :size="48" />
          <p>No requisitions found matching your criteria.</p>
        </div>

        <PaginationComponent
          v-if="!loading && totalItems > 0"
          :current-page="currentPage"
          :total-pages="totalPages"
          :page-size="pageSize"
          :total-items="totalItems"
          :loading="loading"
          @page-change="handlePageChange"
        />
      </div>
    </div>

    <!-- Override Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-content glass-card premium-modal">
        <div
          class="modal-header-elite"
          :class="overrideAction === 'void' ? 'danger-theme' : 'warning-theme'"
        >
          <div class="header-icon-ring">
            <div class="header-icon-box">
              <AlertCircle v-if="overrideAction === 'advance'" :size="32" />
              <XOctagon v-else :size="32" />
            </div>
          </div>
          <div class="header-text-box">
            <h3 class="modal-title-elite">Administrative Override</h3>
            <p class="modal-subtitle-elite">Security Protocol Level: Restricted</p>
          </div>
        </div>

        <div class="modal-body-elite">
          <div
            class="override-notice"
            :class="overrideAction === 'void' ? 'notice-danger' : 'notice-warning'"
          >
            <div v-if="overrideAction === 'advance'" class="notice-content">
              <p>You are initiating a <strong>Force Advance</strong> protocol for requisition:</p>
              <div class="req-id-badge">#{{ selectedReq.rfControlNo || 'DRAFT' }}</div>
              <p class="warning-text">
                This will bypass the current approval stage and advance it to the next step. This
                action is logged for internal audit.
              </p>
            </div>
            <div v-else class="notice-content">
              <p>You are initiating a <strong>Permanent Void</strong> protocol for requisition:</p>
              <div class="req-id-badge">#{{ selectedReq.rfControlNo || 'DRAFT' }}</div>
              <p class="danger-text">
                This will permanently retire this control number and cancel the request. This action
                <strong>cannot be undone</strong>.
              </p>
            </div>
          </div>

          <div class="reason-group-elite">
            <label class="reason-label">
              <MessageSquare :size="16" />
              Audit Justification Required
            </label>
            <div class="textarea-wrapper">
              <textarea
                v-model="overrideReason"
                placeholder="Briefly explain the administrative necessity for this override..."
                rows="4"
                class="elite-textarea"
                autofocus
              ></textarea>
              <div class="textarea-focus-ring"></div>
            </div>
          </div>
        </div>

        <div class="modal-footer-elite">
          <button @click="showModal = false" class="btn-cancel-elite">Cancel</button>
          <button
            @click="handleOverride"
            class="btn-confirm-elite"
            :class="overrideAction === 'void' ? 'btn-danger-elite' : 'btn-primary-elite'"
            :disabled="!overrideReason.trim()"
          >
            Authorize {{ overrideAction === 'void' ? 'Void' : 'Advance' }}
            <ArrowRightCircle :size="18" />
          </button>
        </div>
      </div>
    </div>

    <!-- Reset Database Modal -->
    <div
      v-if="showResetModal"
      class="modal-overlay"
      @click.self="resetStep !== 2 ? (showResetModal = false) : null"
    >
      <div class="modal-content glass-card premium-modal reset-modal">
        <div class="modal-header-elite danger-theme">
          <div class="header-icon-ring">
            <div class="header-icon-box">
              <Trash2 :size="32" />
            </div>
          </div>
          <div class="header-text-box">
            <h3 class="modal-title-elite">Destroy All Testing Data</h3>
            <p class="modal-subtitle-elite">Security Level: Maximum Clearance Required</p>
          </div>
        </div>

        <div class="modal-body-elite">
          <div v-if="resetStep === 1" class="reset-confirm-step">
            <div class="override-notice notice-danger">
              <p><strong>Warning:</strong> You are about to permanently delete all:</p>
              <ul class="reset-list">
                <li>Active and Archived Requisitions</li>
                <li>Transaction & Audit Logs</li>
                <li>Digital Signatures</li>
                <li>Analytics Summaries</li>
              </ul>
              <p class="danger-highlight">
                This action is IRREVERSIBLE. User accounts and system configuration will be
                preserved.
              </p>
            </div>
            <p class="confirmation-check">Type <strong>CONFIRM</strong> to proceed:</p>
            <input
              type="text"
              placeholder="CONFIRM"
              class="reset-input"
              v-on:keyup.enter="overrideReason === 'CONFIRM' ? handleResetDatabase() : null"
              v-model="overrideReason"
            />
          </div>

          <div v-if="resetStep === 2" class="reset-processing-step">
            <div class="glass-loader large"></div>
            <p class="processing-text">Purging Database Clusters...</p>
            <p class="sub-text">Please do not close this window.</p>
          </div>

          <div v-if="resetStep === 3" class="reset-success-step">
            <div class="success-icon-box">✨</div>
            <h4 class="success-title">Database Purged Successfully</h4>
            <p class="success-desc">
              Total records destroyed: <strong>{{ resetCount }}</strong>
            </p>
            <p class="success-desc">Counters have been reset to 000000.</p>
          </div>
        </div>

        <div class="modal-footer-elite">
          <button v-if="resetStep === 1" @click="showResetModal = false" class="btn-cancel-elite">
            Abort Mission
          </button>
          <button
            v-if="resetStep === 1"
            @click="handleResetDatabase"
            class="btn-confirm-elite btn-danger-elite"
            :disabled="overrideReason !== 'CONFIRM'"
          >
            Execute Purge
          </button>
          <button
            v-if="resetStep === 3"
            @click="handleResetDatabase"
            class="btn-primary-elite w-full"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-page {
  padding: 0.5rem 2rem 2rem; /* Balanced horizontal padding */
  max-width: 1700px; /* Optimized breadth for symmetry */
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 1.5rem;
  gap: 2rem;
}

.page-title {
  font-size: 2rem;
  font-weight: 800;
  color: #1e293b;
  margin: 0;
  letter-spacing: -0.02em;
}

.page-subtitle {
  color: #64748b;
  margin: 0.25rem 0 0;
}

.header-actions {
  display: flex;
  gap: 1rem;
}

.search-box {
  position: relative;
  width: 300px; /* Reduced for Compact Elite */
}

.search-icon {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
}

.search-input {
  width: 100%;
  padding: 0.6rem 1rem 0.6rem 2.75rem; /* Tighter padding */
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px; /* Smoother, smaller radius */
  font-size: 0.875rem; /* Downscaled font */
  color: #1e293b;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.search-input:focus {
  outline: none;
  background: rgba(255, 255, 255, 0.8);
  border-color: #0ea5e9;
  box-shadow:
    0 0 0 4px rgba(14, 165, 233, 0.1),
    0 8px 20px rgba(0, 0, 0, 0.05);
}

.glass-select {
  padding: 0.6rem 2.5rem 0.6rem 1rem; /* Tighter padding */
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23334155'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2.5' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 1rem center;
  background-size: 0.875rem;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}

.glass-select:hover {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.8);
}

.glass-select:focus {
  outline: none;
  border-color: #0ea5e9;
  box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.1);
}

.glass-container.elite-card {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(25px) saturate(180%);
  -webkit-backdrop-filter: blur(25px) saturate(180%);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  overflow: hidden;
}

.table-wrapper {
  width: 100%;
  max-height: 72vh;
  overflow: auto;
  min-height: 400px; /* Stabilizes container during filtering */
  position: relative;
}

.elite-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  min-width: 1100px; /* Locked width to prevent column collapse */
}

/* Locked Column Widths for Superior Stability */
.col-rf {
  width: 140px;
}
.col-origin {
  width: 210px;
}
.col-step {
  width: 230px;
}
.col-status {
  width: 170px;
}
.col-date {
  width: 150px;
}
.col-actions {
  width: 180px;
}

.elite-table th {
  padding: 1rem 1.25rem;
  text-align: left;
  background: rgba(248, 250, 252, 0.6);
  font-size: 0.75rem;
  font-weight: 800;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 2px solid rgba(226, 232, 240, 0.8);
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(12px);
  vertical-align: middle;
}

.elite-table td {
  padding: 0.75rem 1.25rem; /* Synced with th horizontal padding */
  border-bottom: 1px solid rgba(226, 232, 240, 0.5);
  vertical-align: middle;
  transition: background 0.2s;
}

.elite-table tr:hover td {
  background: rgba(14, 165, 233, 0.04);
}

.rf-number-elite {
  font-weight: 800;
  color: #0f172a;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  display: block;
}

.purpose-preview-elite {
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.origin-cell-elite {
  display: flex;
  flex-direction: column;
}

.dept-name-elite {
  font-weight: 700;
  color: #1e293b;
  font-size: 0.85rem;
}

.requestor-name-elite {
  font-size: 0.725rem;
  color: #94a3b8;
}

.step-info-elite {
  font-size: 0.8125rem;
  color: #475569;
  font-weight: 600;
}

.elite-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.875rem;
  border-radius: 9999px;
  font-size: 0.725rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-pending {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
}
.status-pending .badge-dot {
  background: #3b82f6;
}

.status-approved {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}
.status-approved .badge-dot {
  background: #10b981;
}

.status-rejected {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}
.status-rejected .badge-dot {
  background: #ef4444;
}

.status-draft {
  background: rgba(148, 163, 184, 0.1);
  color: #475569;
}
.status-draft .badge-dot {
  background: #94a3b8;
}

.date-text-elite {
  font-size: 0.8125rem;
  color: #64748b;
}

.rf-num-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.duplicate-badge {
  background: #fff1f2;
  color: #e11d48;
  border: 1px solid #fda4af;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.05em;
}

.action-buttons-elite {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.btn-elite-action {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: white;
  color: #334155;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.btn-elite-action:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.1);
}

.btn-advance:hover {
  background: #f0f9ff;
  color: #0284c7;
  border-color: #0ea5e9;
}
.btn-void:hover {
  background: #fff1f2;
  color: #e11d48;
  border-color: #fb7185;
}
.btn-view:hover {
  background: #f8fafc;
  color: #0f172a;
  border-color: #94a3b8;
}

.btn-reset-db {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 12px;
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-reset-db:hover {
  background: #dc2626;
  color: white;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(220, 38, 38, 0.2);
}

/* Transition for list items */
.list-enter-active,
.list-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

/* Modal Enhancements */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.premium-modal {
  width: 100%;
  max-width: 520px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px) saturate(160%);
  border-radius: 32px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.2) inset;
  overflow: hidden;
  animation: modalScale 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modalScale {
  from {
    transform: scale(0.9) translateY(20px);
    opacity: 0;
  }
  to {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

.modal-header-elite {
  padding: 2.5rem 2rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  position: relative;
}

.warning-theme {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(251, 191, 36, 0.05));
}

.danger-theme {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(244, 63, 94, 0.05));
}

.header-icon-ring {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.warning-theme .header-icon-ring {
  background: linear-gradient(135deg, #f59e0b, #fbbf24);
  color: white;
}

.danger-theme .header-icon-ring {
  background: linear-gradient(135deg, #ef4444, #f43f5e);
  color: white;
}

.modal-title-elite {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.02em;
}

.modal-subtitle-elite {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #64748b;
  margin: 0.25rem 0 0;
}

.modal-body-elite {
  padding: 0 2rem 2rem;
}

.override-notice {
  padding: 1.25rem;
  border-radius: 18px;
  margin-bottom: 2rem;
}

.notice-warning {
  background: rgba(245, 158, 11, 0.05);
  border: 1px dashed rgba(245, 158, 11, 0.3);
}

.notice-danger {
  background: rgba(239, 68, 68, 0.05);
  border: 1px dashed rgba(239, 68, 68, 0.3);
}

.notice-content p {
  font-size: 0.9375rem;
  color: #334155;
  margin: 0;
  line-height: 1.5;
}

/* Reset Modal Specifics */
.reset-list {
  margin: 1rem 0;
  padding-left: 1.5rem;
  font-size: 0.875rem;
  color: #475569;
}
.reset-list li {
  margin-bottom: 0.35rem;
}
.danger-highlight {
  font-weight: 800;
  color: #dc2626;
  background: rgba(239, 68, 68, 0.1);
  padding: 0.5rem;
  border-radius: 8px;
  text-align: center;
}
.confirmation-check {
  margin-top: 1.5rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #1e293b;
  text-transform: uppercase;
}
.reset-input {
  width: 100%;
  padding: 0.75rem 1rem;
  background: #f8fafc;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.2em;
  color: #0f172a;
  transition: all 0.2s;
}
.reset-input:focus {
  outline: none;
  border-color: #dc2626;
  background: white;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.1);
}

.reset-processing-step {
  padding: 3rem 0;
  text-align: center;
}
.processing-text {
  margin-top: 1.5rem;
  font-weight: 800;
  font-size: 1.125rem;
  color: #0f172a;
}
.sub-text {
  font-size: 0.8125rem;
  color: #64748b;
}

.reset-success-step {
  padding: 2rem 0;
  text-align: center;
}
.success-icon-box {
  font-size: 3rem;
  margin-bottom: 1rem;
}
.success-title {
  font-size: 1.25rem;
  font-weight: 800;
  color: #059669;
  margin-bottom: 1rem;
}
.success-desc {
  font-size: 0.9375rem;
  color: #475569;
  margin: 0.25rem 0;
}
.w-full {
  width: 100%;
}

.req-id-badge {
  display: inline-block;
  background: #0f172a;
  color: white;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 800;
  padding: 0.35rem 0.75rem;
  border-radius: 8px;
  margin: 0.75rem 0;
  font-size: 1rem;
}

.warning-text {
  color: #b45309;
  font-weight: 500;
  font-size: 0.875rem !important;
}
.danger-text {
  color: #b91c1c;
  font-weight: 500;
  font-size: 0.875rem !important;
}

.reason-group-elite {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.reason-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.textarea-wrapper {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  background: white;
  border: 1px solid #e2e8f0;
  transition: all 0.3s ease;
}

.elite-textarea {
  width: 100%;
  padding: 1rem;
  border: none;
  font-size: 0.9375rem;
  color: #1e293b;
  resize: none;
  background: transparent;
  display: block;
}

.elite-textarea:focus {
  outline: none;
}

.textarea-focus-ring {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border: 2px solid #0ea5e9;
  opacity: 0;
  transition: all 0.3s ease;
}

.elite-textarea:focus + .textarea-focus-ring {
  opacity: 1;
  box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.1);
}

.modal-footer-elite {
  padding: 1.5rem 2rem 2.5rem;
  display: flex;
  gap: 1rem;
}

.btn-cancel-elite {
  flex: 1;
  padding: 1rem;
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: white;
  color: #475569;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel-elite:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.btn-confirm-elite {
  flex: 2;
  padding: 1rem;
  border-radius: 14px;
  border: none;
  color: white;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}

.btn-primary-elite {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
}

.btn-danger-elite {
  background: linear-gradient(135deg, #ef4444, #dc2626);
}

.btn-confirm-elite:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.btn-confirm-elite:active:not(:disabled) {
  transform: translateY(0);
}

.btn-confirm-elite:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: grayscale(1);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10rem 0;
  color: #64748b;
}

.glass-loader {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(14, 165, 233, 0.1);
  border-top-color: #0f172a;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1.5rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.text-right {
  text-align: right;
}
</style>
