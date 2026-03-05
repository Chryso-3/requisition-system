<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  subscribeRequisitions,
  loadMoreRequisitions,
  REQUISITION_PAGE_SIZE,
  markRequisitionOrdered,
  markRequisitionReceived,
  markRequisitionCanvassed,
  generatePoNo,
} from '@/services/requisitionService'
import {
  REQUISITION_STATUS,
  USER_ROLES,
  PURCHASE_STATUS,
  CANVASS_STATUS,
  PO_STATUS,
} from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import PaginationComponent from '@/components/PaginationComponent.vue'

const router = useRouter()
const authStore = useAuthStore()
const requisitions = ref([])
const moreRequisitions = ref([])
const lastDoc = ref(null)
const hasMore = ref(false)
const loadingMore = ref(false)
const loading = ref(true)
const error = ref(null)
const filterPurchaseStatus = ref('')
const searchRfControlNo = ref('')
const modalOrdered = ref(null)
const modalReceived = ref(null)
const actionLoading = ref(false)
const actionError = ref('')
const pageSize = ref(10)
const currentPage = ref(1)
const tableContainer = ref(null)
let unsubscribe = null

const isPurchaser = computed(() => authStore?.role === USER_ROLES.PURCHASER)
const hasSignature = computed(() => !!authStore?.userProfile?.signatureData)

const approvedRequisitions = computed(() => [...requisitions.value, ...moreRequisitions.value])

const filteredList = computed(() => {
  let list = approvedRequisitions.value
  const statusFilter = filterPurchaseStatus.value
  const search = (searchRfControlNo.value || '').trim().toLowerCase()
  if (statusFilter) {
    list = list.filter((r) => (r.purchaseStatus || PURCHASE_STATUS.PENDING) === statusFilter)
  }
  if (search) {
    list = list.filter((r) => (r.rfControlNo || '').toLowerCase().includes(search))
  }
  return list
})

const purchaseStatusLabel = {
  [PURCHASE_STATUS.PENDING]: 'Pending',
  [PURCHASE_STATUS.ORDERED]: 'Ordered',
  [PURCHASE_STATUS.RECEIVED]: 'Received',
}

const totalPages = computed(() => Math.ceil(filteredList.value.length / pageSize.value) || 1)

const paginatedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredList.value.slice(start, start + pageSize.value)
})

function handlePageChange(p) {
  currentPage.value = p
  if (tableContainer.value) tableContainer.value.scrollTo({ top: 0, behavior: 'smooth' })
  const currentViewEnd = p * pageSize.value
  if (
    currentViewEnd > approvedRequisitions.value.length - 15 &&
    hasMore.value &&
    !loadingMore.value
  ) {
    loadMore()
  }
}

watch([filterPurchaseStatus, searchRfControlNo, pageSize], () => {
  currentPage.value = 1
})

function purchaseStatusDisplay(r) {
  return r.purchaseStatus || PURCHASE_STATUS.PENDING
}

function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString()
}

function canvassStatusDisplay(r) {
  return r.canvassStatus || CANVASS_STATUS.PENDING
}

function goToDetail(id) {
  router.push({ path: `/requisitions/${id}`, query: { from: 'purchase-list' } })
}
const poNumber = ref('')
const orderedAt = ref('')
const receivedAt = ref('')

async function openMarkOrdered(r) {
  modalOrdered.value = r
  if (r.poNumber) {
    poNumber.value = r.poNumber
  } else {
    try {
      poNumber.value = 'Loading...'
      const nextNo = await generatePoNo()
      poNumber.value = nextNo
    } catch (e) {
      console.error('Failed to generate PO number:', e)
      poNumber.value = ''
    }
  }
  orderedAt.value = r.orderedAt
    ? (r.orderedAt?.toDate ? r.orderedAt.toDate() : new Date(r.orderedAt))
        .toISOString()
        .slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  actionError.value = ''
}
function closeOrderedModal() {
  modalOrdered.value = null
  poNumber.value = ''
  actionError.value = ''
}
async function saveMarkOrdered() {
  if (!modalOrdered.value) return
  if (!hasSignature.value) {
    actionError.value = 'Missing digital signature. Please set it up in your Profile.'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    const user = authStore?.user
    await markRequisitionOrdered(modalOrdered.value.id, {
      poNumber: poNumber.value.trim() || undefined,
      orderedAt: orderedAt.value ? new Date(orderedAt.value + 'T12:00:00') : new Date(),
      orderedBy: user
        ? { userId: user.uid, name: authStore?.displayName, email: user.email }
        : null,
      signatureData: authStore?.userProfile?.signatureData,
    })
    closeOrderedModal()
  } catch (e) {
    actionError.value = e?.message || 'Failed to mark as ordered.'
  } finally {
    actionLoading.value = false
  }
}

function openMarkReceived(r) {
  modalReceived.value = r
  receivedAt.value = r.receivedAt
    ? (r.receivedAt?.toDate ? r.receivedAt.toDate() : new Date(r.receivedAt))
        .toISOString()
        .slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  actionError.value = ''
}
function closeReceivedModal() {
  modalReceived.value = null
  actionError.value = ''
}
async function saveMarkReceived() {
  if (!modalReceived.value) return
  if (!hasSignature.value) {
    actionError.value = 'Missing digital signature. Please set it up in your Profile.'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    const user = authStore?.user
    await markRequisitionReceived(modalReceived.value.id, {
      receivedAt: receivedAt.value ? new Date(receivedAt.value + 'T12:00:00') : new Date(),
      receivedBy: user
        ? { userId: user.uid, name: authStore?.displayName, email: user.email }
        : null,
      signatureData: authStore?.userProfile?.signatureData,
    })
    closeReceivedModal()
  } catch (e) {
    actionError.value = e?.message || 'Failed to mark as received.'
  } finally {
    actionLoading.value = false
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
    } = await loadMoreRequisitions(
      { poStatus: PO_STATUS.APPROVED },
      lastDoc.value,
      REQUISITION_PAGE_SIZE,
    )
    moreRequisitions.value = [...moreRequisitions.value, ...next]
    lastDoc.value = nextLastDoc
    hasMore.value = nextHasMore
  } catch (e) {
    error.value = e?.message || 'Failed to load more.'
  } finally {
    loadingMore.value = false
  }
}

onMounted(() => {
  loading.value = true
  error.value = null
  if (!authStore?.user) {
    loading.value = false
    return
  }
  unsubscribe = subscribeRequisitions(
    { poStatus: PO_STATUS.APPROVED },
    (results, lastDocSnapshot) => {
      requisitions.value = results
      lastDoc.value = lastDocSnapshot
      hasMore.value = results.length === REQUISITION_PAGE_SIZE
      error.value = null
      loading.value = false
    },
    (err) => {
      error.value = err?.message || 'Failed to load.'
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
  <div class="purchase-list jinja">
    <div class="page-header">
      <h1 class="page-title">3. Track Deliveries</h1>
      <p class="page-subtitle">
        Monitor and record the arrival of goods ordered via Purchase Order (PO).
      </p>
    </div>

    <div v-if="!isPurchaser" class="access-denied">
      <p>This page is only available to the Purchaser role.</p>
    </div>

    <template v-else>
      <div class="panel">
        <div class="toolbar">
          <div class="search-wrap">
            <span class="search-icon" aria-hidden="true">
              <svg
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
                <path d="m21 21-4.35-4.35" />
              </svg>
            </span>
            <input
              v-model="searchRfControlNo"
              type="text"
              class="search-input"
              placeholder="Search RF Control No."
              autocomplete="off"
            />
            <button
              v-if="searchRfControlNo"
              type="button"
              class="search-clear"
              aria-label="Clear search"
              @click="searchRfControlNo = ''"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="status-dropdown-wrap">
            <label class="status-label">Status</label>
            <select v-model="filterPurchaseStatus" class="status-select">
              <option value="">All</option>
              <option v-for="(label, key) in purchaseStatusLabel" :key="key" :value="key">
                {{ label }}
              </option>
            </select>
          </div>
        </div>
        <div class="panel-body">
          <div v-if="error" class="error-message">{{ error }}</div>
          <div v-else class="table-section">
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>RF Control No.</th>
                    <th>Date</th>
                    <th>Department</th>
                    <th>Purpose</th>
                    <th>Items</th>
                    <th>Purchase status</th>
                    <th>Ordered / Received by</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="loading" class="loading-row">
                    <td colspan="8" class="loading-cell">
                      <div class="spinner small"></div>
                      <span>Loading…</span>
                    </td>
                  </tr>
                  <tr v-else-if="filteredList.length === 0" class="empty-row">
                    <td colspan="8" class="empty-cell">
                      {{
                        searchRfControlNo || filterPurchaseStatus
                          ? 'No requisitions match your search or filter.'
                          : 'No approved requisitions yet.'
                      }}
                    </td>
                  </tr>
                  <tr v-else v-for="r in paginatedList" :key="r.id" @click="goToDetail(r.id)">
                    <td class="font-medium">{{ r.rfControlNo || '—' }}</td>
                    <td>{{ formatDate(r.date) }}</td>
                    <td>{{ r.department || '—' }}</td>
                    <td class="purpose-cell">
                      {{ (r.purpose || '').slice(0, 40)
                      }}{{ (r.purpose || '').length > 40 ? '…' : '' }}
                    </td>
                    <td class="text-center">{{ (r.items || []).length }}</td>
                    <td>
                      <span :class="['purchase-status-badge', purchaseStatusDisplay(r)]">
                        {{ purchaseStatusLabel[purchaseStatusDisplay(r)] }}
                      </span>
                    </td>
                    <td class="purchaser-info-cell">
                      <span
                        v-if="
                          canvassStatusDisplay(r) === CANVASS_STATUS.ORDER_CREATED &&
                          r.canvassNumber
                        "
                        class="text-xs font-semibold block mb-1"
                      >
                        CO: {{ r.canvassNumber }}
                      </span>
                      <span v-if="r.orderedBy?.name"
                        >{{ r.orderedBy.name
                        }}<template v-if="r.orderedAt">
                          ({{ formatDate(r.orderedAt) }})</template
                        ></span
                      >
                      <span v-else class="muted">—</span>
                      <template v-if="r.receivedBy?.name">
                        <br /><span class="received-by"
                          >Received: {{ r.receivedBy.name
                          }}<template v-if="r.receivedAt">
                            ({{ formatDate(r.receivedAt) }})</template
                          ></span
                        >
                      </template>
                    </td>
                    <td class="action-cell" @click.stop>
                      <button type="button" class="btn-view" @click="goToDetail(r.id)">
                        View / Print
                      </button>
                      <template v-if="purchaseStatusDisplay(r) === PURCHASE_STATUS.PENDING">
                        <button
                          type="button"
                          class="btn-action ordered"
                          :disabled="actionLoading"
                          @click="openMarkOrdered(r)"
                        >
                          Mark ordered
                        </button>
                      </template>
                      <template v-else-if="purchaseStatusDisplay(r) === PURCHASE_STATUS.ORDERED">
                        <button
                          type="button"
                          class="btn-action received"
                          :disabled="actionLoading"
                          @click="openMarkReceived(r)"
                        >
                          Mark received
                        </button>
                      </template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <PaginationComponent
              :current-page="currentPage"
              :total-pages="totalPages"
              :page-size="pageSize"
              :total-items="filteredList.length"
              :loading="loading || loadingMore"
              @page-change="handlePageChange"
            />
          </div>
        </div>
      </div>

      <!-- Mark as Ordered modal -->
      <div v-if="modalOrdered" class="purchase-modal-overlay" @click.self="closeOrderedModal">
        <div
          class="purchase-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purchase-modal-ordered-title"
        >
          <div class="purchase-modal-header">
            <div class="purchase-modal-icon purchase-modal-icon-ordered" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </div>
            <div>
              <h3 id="purchase-modal-ordered-title" class="purchase-modal-title">
                Mark as ordered
              </h3>
              <p class="purchase-modal-rf">RF {{ modalOrdered.rfControlNo || modalOrdered.id }}</p>
            </div>
          </div>
          <div class="purchase-modal-body">
            <p v-if="actionError" class="purchase-modal-error">{{ actionError }}</p>
            <div class="purchase-modal-fields">
              <label class="purchase-modal-field">
                <span>PO number (optional)</span>
                <input
                  v-model="poNumber"
                  type="text"
                  placeholder="e.g. PO-2024-001"
                  class="purchase-modal-input"
                />
              </label>
              <label class="purchase-modal-field">
                <span>Order date</span>
                <input v-model="orderedAt" type="date" class="purchase-modal-input" />
              </label>
            </div>
            <div v-if="!hasSignature" class="signature-warning">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div class="warning-text">
                <span><strong>Signature Required!</strong></span>
                <p>
                  You must set up your digital signature in your Profile before taking this action.
                </p>
                <router-link to="/profile" class="profile-link">Go to Profile →</router-link>
              </div>
            </div>
          </div>
          <div class="purchase-modal-actions">
            <button
              type="button"
              class="purchase-modal-btn purchase-modal-btn-cancel"
              @click="closeOrderedModal"
            >
              Cancel
            </button>
            <button
              type="button"
              class="purchase-modal-btn purchase-modal-btn-primary"
              :disabled="actionLoading || !hasSignature"
              @click="saveMarkOrdered"
            >
              {{ actionLoading ? 'Saving…' : 'Mark ordered' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Mark as Received modal -->
      <div v-if="modalReceived" class="purchase-modal-overlay" @click.self="closeReceivedModal">
        <div
          class="purchase-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purchase-modal-received-title"
        >
          <div class="purchase-modal-header">
            <div class="purchase-modal-icon purchase-modal-icon-received" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div>
              <h3 id="purchase-modal-received-title" class="purchase-modal-title">
                Mark as received
              </h3>
              <p class="purchase-modal-rf">
                RF {{ modalReceived.rfControlNo || modalReceived.id }}
              </p>
            </div>
          </div>
          <div class="purchase-modal-body">
            <p v-if="actionError" class="purchase-modal-error">{{ actionError }}</p>
            <div class="purchase-modal-fields">
              <label class="purchase-modal-field">
                <span>Received date</span>
                <input v-model="receivedAt" type="date" class="purchase-modal-input" />
              </label>
            </div>
            <div v-if="!hasSignature" class="signature-warning">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div class="warning-text">
                <span><strong>Signature Required!</strong></span>
                <p>
                  You must set up your digital signature in your Profile before taking this action.
                </p>
                <router-link to="/profile" class="profile-link">Go to Profile →</router-link>
              </div>
            </div>
          </div>
          <div class="purchase-modal-actions">
            <button
              type="button"
              class="purchase-modal-btn purchase-modal-btn-cancel"
              @click="closeReceivedModal"
            >
              Cancel
            </button>
            <button
              type="button"
              class="purchase-modal-btn purchase-modal-btn-primary"
              :disabled="actionLoading || !hasSignature"
              @click="saveMarkReceived"
            >
              {{ actionLoading ? 'Saving…' : 'Mark received' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.jinja {
  --jinja-bg: #f1f5f9;
  --jinja-surface: #ffffff;
  --jinja-border: #e2e8f0;
  --jinja-text: #0f172a;
  --jinja-muted: #64748b;
}

.purchase-list {
  width: 100%;
  padding: 0.75rem 2rem 1.75rem;
  background: var(--jinja-bg);
  height: calc(100vh - 64px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.page-header {
  margin-bottom: 1.25rem;
}
.page-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--jinja-text);
}
.page-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--jinja-muted);
}

.access-denied {
  padding: 2rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 10px;
  color: #991b1b;
}

.panel {
  background: var(--jinja-surface);
  border: 1px solid var(--jinja-border);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  flex-wrap: wrap;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--jinja-border);
  background: linear-gradient(to bottom, #fafbfc, #f1f5f9);
}

.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 200px;
  max-width: 320px;
}
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--jinja-muted);
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.search-input {
  width: 100%;
  padding: 0.5rem 2.25rem 0.5rem 2.75rem;
  border: 1px solid var(--jinja-border);
  border-radius: 10px;
  font-size: 0.9375rem;
  background: var(--jinja-surface);
  color: var(--jinja-text);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.search-input::placeholder {
  color: var(--jinja-muted);
}
.search-input:focus {
  outline: none;
  border-color: #0ea5e9;
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);
}
.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--jinja-muted);
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.search-clear:hover {
  color: var(--jinja-text);
  background: rgba(0, 0, 0, 0.06);
}

.status-dropdown-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}
.status-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--jinja-muted);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.status-select {
  padding: 0.5rem 2rem 0.5rem 0.75rem;
  border: 1px solid var(--jinja-border);
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  background: var(--jinja-surface);
  color: var(--jinja-text);
  cursor: pointer;
  min-width: 130px;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.6rem center;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.status-select:hover {
  border-color: #cbd5e1;
}
.status-select:focus {
  outline: none;
  border-color: #0ea5e9;
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);
}
.purchase-status-badge {
  display: inline-block;
  padding: 0.28rem 0.65rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.purchase-status-badge.pending {
  background: #fef3c7;
  color: #b45309;
  border: 1px solid #fcd34d;
}
.purchase-status-badge.ordered {
  background: #e0f2fe;
  color: #0369a1;
  border: 1px solid #7dd3fc;
}
.purchase-status-badge.received {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #86efac;
}
.purchaser-info-cell {
  font-size: 0.8125rem;
  vertical-align: top;
}
.purchaser-info-cell .muted {
  color: var(--jinja-muted);
}
.purchaser-info-cell .received-by {
  color: var(--jinja-muted);
  font-size: 0.75rem;
}
.btn-action {
  margin-left: 0.35rem;
  padding: 0.3rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
}
.btn-action.ordered {
  background: #e0f2fe;
  color: #0369a1;
  border-color: #7dd3fc;
}
.btn-action.ordered:hover:not(:disabled) {
  background: #bae6fd;
}
.btn-action.received {
  background: #dcfce7;
  color: #166534;
  border-color: #86efac;
}
.btn-action.received:hover:not(:disabled) {
  background: #bbf7d0;
}
.btn-action:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* Purchase modals — Mark as ordered / Mark as received */
.purchase-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1.5rem;
}
.purchase-modal-card {
  background: #fff;
  border-radius: 14px;
  padding: 0;
  min-width: 340px;
  max-width: 440px;
  width: 100%;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.25),
    0 0 0 1px rgba(0, 0, 0, 0.05);
  border: 1px solid #e2e8f0;
  overflow: hidden;
}
.purchase-modal-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.5rem 0;
}
.purchase-modal-icon {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
}
.purchase-modal-icon-ordered {
  background: #eff6ff;
  color: #2563eb;
}
.purchase-modal-icon-received {
  background: #ecfdf5;
  color: #059669;
}
.purchase-modal-title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.02em;
  line-height: 1.3;
}
.purchase-modal-rf {
  margin: 0.2rem 0 0;
  font-size: 0.8125rem;
  color: #64748b;
  font-weight: 500;
}
.purchase-modal-body {
  padding: 1.25rem 1.5rem 1.5rem;
}
.purchase-modal-error {
  margin: 0 0 1rem;
  padding: 0.65rem 0.85rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #b91c1c;
  font-size: 0.8125rem;
  line-height: 1.45;
}
.purchase-modal-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.purchase-modal-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.875rem;
}
.purchase-modal-field span {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #475569;
}
.purchase-modal-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.875rem;
  background: #fff;
  color: #0f172a;
}
.purchase-modal-input:focus {
  outline: none;
  border-color: #0ea5e9;
  box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.15);
}
.purchase-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0 1.5rem 1.5rem;
}
.purchase-modal-btn {
  padding: 0.6rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s;
}
.purchase-modal-btn-cancel {
  background: #fff;
  border: 1px solid #e2e8f0;
  color: #475569;
}
.purchase-modal-btn-cancel:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #0f172a;
}
.purchase-modal-btn-primary {
  background: #2563eb;
  border: none;
  color: #fff;
}
.purchase-modal-btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}
.purchase-modal-btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  border: 1px solid var(--jinja-border);
  background: var(--jinja-surface);
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.875rem;
}
.btn-primary {
  padding: 0.5rem 1rem;
  background: #0ea5e9;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
}
.btn-primary:hover:not(:disabled) {
  background: #0284c7;
}
.btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.panel-body {
  flex: 1;
  padding: 0;
  min-height: 0;
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
  -webkit-overflow-scrolling: touch;
}
.load-more-wrap {
  flex-shrink: 0;
  padding: 1rem;
  text-align: center;
  border-top: 1px solid var(--jinja-border);
}
.btn-load-more {
  padding: 0.5rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: #0369a1;
  background: #e0f2fe;
  border: 1px solid #7dd3fc;
  border-radius: 8px;
  cursor: pointer;
}
.btn-load-more:hover:not(:disabled) {
  background: #bae6fd;
}
.btn-load-more:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.data-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8fafc;
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--jinja-muted);
  border-bottom: 1px solid var(--jinja-border);
}
.data-table td {
  padding: 0.75rem 1rem;
  color: #334155;
  border-bottom: 1px solid #f1f5f9;
}
.data-table tbody tr {
  cursor: pointer;
  transition: background 0.15s;
}
.data-table tbody tr:hover {
  background: #f8fafc;
}

.font-medium {
  font-weight: 600;
  color: #0f172a;
}
.purchase-status-badge.pending {
  background: #fef9c3; /* Yellow background */
  color: #854d0e; /* Darker yellow text */
}
.purpose-cell {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text-center {
  text-align: center;
}
.action-cell {
  white-space: nowrap;
}
.btn-view {
  padding: 0.35rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #0369a1;
  background: #e0f2fe;
  border: 1px solid #7dd3fc;
  border-radius: 6px;
  cursor: pointer;
}
.btn-view:hover {
  background: #bae6fd;
}

.error-message {
  padding: 1rem;
  margin: 1rem;
  background: #fef2f2;
  border-radius: 8px;
  color: #b91c1c;
}
.loading-cell,
.empty-cell {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--jinja-muted);
  font-size: 0.875rem;
  vertical-align: middle;
}
.loading-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}
.loading-row:hover,
.empty-row:hover {
  background: transparent;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #e2e8f0;
  border-top-color: #0ea5e9;
  border-radius: 50%;
  margin: 0 auto 0.75rem;
  animation: spin 0.8s linear infinite;
}
.spinner.small {
  width: 20px;
  height: 20px;
  margin: 0;
  border-width: 2px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.signature-warning {
  margin-top: 1rem;
  padding: 1rem;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 12px;
  display: flex;
  gap: 0.875rem;
  color: #92400e;
  text-align: left;
}
.signature-warning .warning-text {
  flex: 1;
}
.signature-warning .warning-text span {
  display: block;
  font-size: 0.875rem;
  margin-bottom: 0.15rem;
}
.signature-warning .warning-text p {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  opacity: 0.9;
}
.signature-warning .profile-link {
  display: inline-block;
  margin-top: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 700;
  text-decoration: underline;
  color: #b45309;
}

.purchase-modal-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
