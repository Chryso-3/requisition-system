<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  subscribeRequisitions,
  loadMoreRequisitions,
  REQUISITION_PAGE_SIZE,
  markRequisitionOrdered,
  generatePoNo,
} from '@/services/requisitionService'
import { getDeptAbbreviation } from '@/utils/deptUtils'
import { REQUISITION_STATUS, USER_ROLES, CANVASS_STATUS, PO_STATUS } from '@/firebase/collections'
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
const searchRfControlNo = ref('')
const modalPO = ref(null)
const actionLoading = ref(false)
const actionError = ref('')
const pageSize = ref(10)
const currentPage = ref(1)
const tableContainer = ref(null)
let unsubscribe = null

const isBACSecretary = computed(() => authStore.role === USER_ROLES.BAC_SECRETARY)
const hasSignature = computed(() => !!authStore.userProfile?.signatureData)

const submittedRequisitions = computed(() => [...requisitions.value, ...moreRequisitions.value])

const filteredList = computed(() => {
  let list = submittedRequisitions.value
  const search = (searchRfControlNo.value || '').trim().toLowerCase()
  if (search) {
    list = list.filter((r) => (r.rfControlNo || '').toLowerCase().includes(search))
  }
  return list
})

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
    currentViewEnd > submittedRequisitions.value.length - 15 &&
    hasMore.value &&
    !loadingMore.value
  ) {
    loadMore()
  }
}

watch([searchRfControlNo, pageSize], () => {
  currentPage.value = 1
})

function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString()
}

function goToDetail(id) {
  router.push({ path: `/requisitions/${id}`, query: { from: 'bac-dashboard' } })
}

const poNumber = ref('')
const orderedAt = ref('')
const supplier = ref('')
const poItems = ref([])

async function openIssuePO(r) {
  modalPO.value = r
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
  supplier.value = r.supplier || ''
  poItems.value = (r.items || []).map((item) => ({ ...item }))
  orderedAt.value = new Date().toISOString().slice(0, 10)
  actionError.value = ''
}
function closePOModal() {
  modalPO.value = null
  poNumber.value = ''
  actionError.value = ''
}
async function saveIssuePO() {
  if (!modalPO.value) return
  if (!hasSignature.value) {
    actionError.value = 'Missing digital signature. Please set it up in your Profile.'
    return
  }
  if (!poNumber.value.trim()) {
    actionError.value = 'Please enter a Purchase Order number.'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    const user = authStore.user
    await markRequisitionOrdered(modalPO.value.id, {
      poNumber: poNumber.value.trim(),
      supplier: supplier.value.trim(),
      items: poItems.value,
      orderedAt: orderedAt.value ? new Date(orderedAt.value + 'T12:00:00') : new Date(),
      orderedBy: user
        ? {
            userId: user.uid,
            name: authStore.displayName,
            email: user.email,
            role: authStore.role,
          }
        : null,
      signatureData: authStore.userProfile?.signatureData,
    })
    closePOModal()
  } catch (e) {
    actionError.value = e?.message || 'Failed to issue Purchase Order.'
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
      {
        status: REQUISITION_STATUS.APPROVED,
        canvassStatus: CANVASS_STATUS.SUBMITTED_TO_BAC,
        poStatus: null,
      },
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
  if (!authStore.user) {
    loading.value = false
    return
  }
  unsubscribe = subscribeRequisitions(
    {
      status: REQUISITION_STATUS.APPROVED,
      canvassStatus: CANVASS_STATUS.SUBMITTED_TO_BAC,
      poStatus: [null, PO_STATUS.REJECTED],
    },
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
  <div class="bac-list jinja">
    <div class="page-header">
      <h1 class="page-title">2. Issue Purchase Order</h1>
      <p class="page-subtitle">
        Canvass forms submitted by Purchasers awaiting Purchase Order (PO) creation.
      </p>
    </div>

    <div v-if="!isBACSecretary" class="access-denied">
      <p>This page is only available to the BAC Secretary role.</p>
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
                    <th>Canvass No.</th>
                    <th>Date Submitted</th>
                    <th>Department</th>
                    <th>Purpose</th>
                    <th>Items</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="loading" class="loading-row">
                    <td colspan="7" class="loading-cell">
                      <div class="spinner small"></div>
                      <span>Loading…</span>
                    </td>
                  </tr>
                  <tr v-else-if="filteredList.length === 0" class="empty-row">
                    <td colspan="7" class="empty-cell">
                      {{
                        searchRfControlNo
                          ? 'No requisitions match your search.'
                          : 'No incoming canvasses found.'
                      }}
                    </td>
                  </tr>
                  <tr v-else v-for="r in paginatedList" :key="r.id" @click="goToDetail(r.id)">
                    <td class="font-medium">{{ r.rfControlNo || '—' }}</td>
                    <td>
                      <div class="flex items-center gap-2">
                        <span>{{ r.canvassNumber || '—' }}</span>
                        <span
                          v-if="r.poStatus === PO_STATUS.REJECTED"
                          class="badge badge-error"
                          title="Returned for correction"
                        >
                          Rejected
                        </span>
                      </div>
                    </td>
                    <td>{{ formatDate(r.submittedToBACAt) }}</td>
                    <td>{{ getDeptAbbreviation(r.department) }}</td>
                    <td class="purpose-cell">
                      {{ (r.purpose || '').slice(0, 40)
                      }}{{ (r.purpose || '').length > 40 ? '…' : '' }}
                    </td>
                    <td class="text-center">{{ (r.items || []).length }}</td>
                    <td class="action-cell" @click.stop>
                      <button type="button" class="btn-view" @click="goToDetail(r.id)">View</button>
                      <button
                        type="button"
                        class="btn-action ordered"
                        :disabled="actionLoading"
                        @click="openIssuePO(r)"
                      >
                        Issue PO
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
              :total-items="filteredList.length"
              :loading="loading || loadingMore"
              @page-change="handlePageChange"
            />
          </div>
        </div>
      </div>

      <!-- Issue PO modal (Premium Redesign) -->
      <div v-if="modalPO" class="po-modal-overlay" @click.self="closePOModal">
        <div class="po-modal-card" role="dialog" aria-modal="true" aria-labelledby="po-modal-title">
          <!-- Header -->
          <div class="po-modal-header">
            <div class="po-modal-header-left">
              <div class="po-modal-icon-wrap">
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
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div>
                <h3 id="po-modal-title" class="po-modal-title">Issue Purchase Order</h3>
                <span class="po-modal-sub">RF {{ modalPO.rfControlNo || modalPO.id }}</span>
              </div>
            </div>
            <button class="po-modal-close" @click="closePOModal">&times;</button>
          </div>

          <!-- Body -->
          <div class="po-modal-body">
            <div v-if="actionError" class="po-alert">{{ actionError }}</div>

            <!-- Rejection Remarks Alert -->
            <div
              v-if="modalPO.poStatus === PO_STATUS.REJECTED && modalPO.poRejectionRemarks"
              class="po-rejection-alert"
            >
              <div class="alert-icon">⚠️</div>
              <div class="alert-content">
                <strong>Returned for Correction:</strong>
                <p>{{ modalPO.poRejectionRemarks }}</p>
              </div>
            </div>

            <div class="po-grid-2">
              <div class="po-field">
                <label class="po-label">PO Number <span class="po-auto-badge">Auto</span></label>
                <input :value="poNumber" type="text" class="po-input po-input-readonly" readonly />
              </div>
              <div class="po-field">
                <label class="po-label">Date Issued</label>
                <input v-model="orderedAt" type="date" class="po-input" />
              </div>
            </div>

            <div class="po-field">
              <label class="po-label">Supplier / Company Name</label>
              <input
                v-model="supplier"
                type="text"
                placeholder="Enter winning supplier"
                class="po-input"
              />
            </div>

            <div class="po-divider"></div>
            <p class="po-section-title">Item Canvass Results</p>

            <div class="po-table-wrap">
              <table class="po-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style="width: 80px">Qty</th>
                    <th style="width: 140px">Brand</th>
                    <th style="width: 120px">Unit Price</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in poItems" :key="idx">
                    <td class="po-td-desc">{{ item.description }}</td>
                    <td class="po-td-center">{{ item.quantity }} {{ item.unit }}</td>
                    <td>
                      <input
                        v-model="item.brand"
                        type="text"
                        class="po-cell-input"
                        placeholder="Brand"
                      />
                    </td>
                    <td>
                      <input
                        v-model.number="item.unitPrice"
                        type="number"
                        step="0.01"
                        class="po-cell-input po-text-right"
                        placeholder="0.00"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
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
                <p>You must set up your digital signature in your Profile before issuing a PO.</p>
                <router-link to="/profile" class="profile-link">Go to Profile →</router-link>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="po-modal-footer">
            <button type="button" class="po-btn-cancel" @click="closePOModal">Cancel</button>
            <button
              type="button"
              class="po-btn-primary"
              :disabled="actionLoading || !hasSignature"
              @click="saveIssuePO"
            >
              {{ actionLoading ? 'Issuing…' : '✓ Issue Purchase Order' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ========================
   Premium PO Modal Styles
   ======================== */
.po-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.po-modal-card {
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.25);
  width: 100%;
  max-width: 640px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: poSlideUp 0.25s ease;
}

@keyframes poSlideUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.po-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: #fff;
  flex-shrink: 0;
}

.po-modal-header-left {
  display: flex;
  align-items: center;
  gap: 0.875rem;
}

.po-modal-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}

.po-modal-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #fff;
}

.po-modal-sub {
  display: inline-block;
  margin-top: 3px;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  font-family: monospace;
}

.po-modal-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 1.5rem;
  cursor: pointer;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background 0.15s;
}
.po-modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.po-modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.po-alert {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  border-radius: 8px;
  padding: 0.625rem 0.875rem;
  font-size: 0.8125rem;
}

.po-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.875rem;
}

.po-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.po-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.po-input {
  padding: 0.625rem 0.875rem;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.9rem;
  color: #0f172a;
  background: #f8fafc;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  width: 100%;
  box-sizing: border-box;
}
.po-input:focus {
  outline: none;
  border-color: #1d4ed8;
  box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.1);
  background: #fff;
}

.po-input-readonly {
  background: #f1f5f9;
  color: #64748b;
  cursor: not-allowed;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.po-auto-badge {
  display: inline-block;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  vertical-align: middle;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-left: 4px;
}

.po-divider {
  border: none;
  border-top: 1px solid #f1f5f9;
}

.po-section-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
}

.po-table-wrap {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  max-height: 230px;
  overflow-y: auto;
}

.po-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.po-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8fafc;
  padding: 0.5rem 0.625rem;
  text-align: left;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  border-bottom: 1px solid #e2e8f0;
}

.po-table tr:not(:last-child) td {
  border-bottom: 1px solid #f1f5f9;
}

.po-table td {
  padding: 0.45rem 0.625rem;
  vertical-align: middle;
}

.po-td-desc {
  font-weight: 500;
  color: #1e293b;
}
.po-td-center {
  color: #64748b;
  font-size: 0.8rem;
}

.po-cell-input {
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.8125rem;
  background: #f8fafc;
  box-sizing: border-box;
}
.po-cell-input:focus {
  outline: none;
  border-color: #1d4ed8;
  background: #fff;
}
.po-text-right {
  text-align: right;
}

.po-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #f1f5f9;
  background: #fafbfc;
  flex-shrink: 0;
}

.po-btn-cancel {
  padding: 0.6rem 1.25rem;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  color: #64748b;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
.po-btn-cancel:hover {
  background: #f1f5f9;
}

.po-btn-primary {
  padding: 0.6rem 1.5rem;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 12px rgba(29, 78, 216, 0.3);
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}
.po-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(29, 78, 216, 0.4);
}
.po-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}
.jinja {
  --jinja-bg: #f1f5f9;
  --jinja-surface: #ffffff;
  --jinja-border: #e2e8f0;
  --jinja-text: #0f172a;
  --jinja-muted: #64748b;
}

.bac-list {
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

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
.search-input:focus {
  outline: none;
  border-color: #0ea5e9;
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);
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
  -webkit-overflow-scrolling: touch;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
}
.data-table th {
  text-align: left;
  padding: 1rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--jinja-muted);
  font-weight: 700;
  border-bottom: 1px solid var(--jinja-border);
  background: #f8fafc;
  position: sticky;
  top: 0;
  z-index: 10;
}
.data-table td {
  padding: 1rem;
  font-size: 0.875rem;
  color: var(--jinja-text);
  border-bottom: 1px solid var(--jinja-border);
}
.data-table tr:hover {
  background-color: #f1f5f9;
  cursor: pointer;
}

.action-cell {
  white-space: nowrap;
  text-align: right;
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
.btn-view,
.btn-action {
  padding: 0.4rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}
.btn-view {
  background: white;
  color: #475569;
  border-color: #cbd5e1;
}
.btn-view:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}
.btn-action.ordered {
  background: #0ea5e9;
  color: white;
}
.btn-action.ordered:hover {
  background: #0284c7;
}

.purchase-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}
.purchase-modal-card {
  background: white;
  width: 100%;
  max-width: 440px;
  border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}
.purchase-modal-header {
  padding: 1.5rem;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  gap: 1rem;
}
.purchase-modal-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.purchase-modal-icon-ordered {
  background: #e0f2fe;
  color: #0ea5e9;
}
.purchase-modal-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: #0f172a;
}
.purchase-modal-rf {
  margin: 0.1rem 0 0;
  font-size: 0.8125rem;
  color: #64748b;
  font-weight: 500;
}
.purchase-modal-body {
  padding: 1.5rem;
}
.purchase-modal-fields {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.purchase-modal-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.purchase-modal-field span {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #475569;
}
.purchase-modal-input {
  padding: 0.625rem;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.9375rem;
}
.purchase-modal-input:focus {
  outline: none;
  border-color: #0ea5e9;
}
.purchase-modal-actions {
  padding: 1.25rem 1.5rem;
  background: #f8fafc;
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}
.purchase-modal-btn {
  padding: 0.625rem 1.25rem;
  border-radius: 8px;
  font-weight: 600;
}
.purchase-modal-btn-cancel {
  background: transparent;
  color: #64748b;
}
.purchase-modal-btn-primary {
  background: #0ea5e9;
  color: white;
}
/* Rejection Alert */
.po-rejection-alert {
  display: flex;
  gap: 1rem;
  background: #fef2f2;
  border-left: 4px solid #ef4444;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}
.alert-icon {
  font-size: 1.25rem;
}
.alert-content strong {
  display: block;
  color: #991b1b;
  margin-bottom: 0.25rem;
}
.alert-content p {
  margin: 0;
  color: #b91c1c;
  font-size: 0.95rem;
  line-height: 1.4;
}

/* Badge styles */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.625rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}
.badge-error {
  background: #fee2e2;
  color: #b91c1c;
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
</style>
