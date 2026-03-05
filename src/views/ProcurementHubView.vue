<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  subscribeRequisitions,
  loadMoreRequisitions,
  REQUISITION_PAGE_SIZE,
  markRequisitionCanvassed,
  markRequisitionReceived,
  generateCanvassNo,
} from '@/services/requisitionService'
import { getDeptAbbreviation } from '@/utils/deptUtils'
import {
  REQUISITION_STATUS,
  USER_ROLES,
  CANVASS_STATUS,
  PURCHASE_STATUS,
  PO_STATUS,
} from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// State for each category
const canvassingList = ref([])
const poPendingList = ref([])
const receivingList = ref([])

const loading = ref(true)
const activeTab = ref('canvassing') // 'canvassing' | 'approvals' | 'receiving'

const searchRfControlNo = ref('')
const actionLoading = ref(false)
const actionError = ref('')

// Modal state
const modalCanvass = ref(null)
const modalReceived = ref(null)

// Modal inputs
const canvassNumber = ref('')
const canvassDate = ref('')
const supplier = ref('')
const canvassItems = ref([])
const receivedAt = ref('')

let unsubscribes = []

const isPurchaser = computed(() => authStore?.role === USER_ROLES.PURCHASER)
const hasSignature = computed(() => !!authStore?.userProfile?.signatureData)

// Computed list for the active tab
const filteredList = computed(() => {
  let list = []
  if (activeTab.value === 'canvassing') list = canvassingList.value
  else if (activeTab.value === 'approvals') list = poPendingList.value
  else if (activeTab.value === 'receiving') list = receivingList.value

  const search = (searchRfControlNo.value || '').trim().toLowerCase()
  if (search) {
    list = list.filter((r) => (r.rfControlNo || '').toLowerCase().includes(search))
  }
  return list
})

function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString()
}

function goToDetail(id) {
  router.push({
    path: `/requisitions/${id}`,
    query: { from: 'procurement-hub', tab: activeTab.value },
  })
}

// Modal Handlers (Canvass)
async function openMarkCanvassed(r) {
  modalCanvass.value = r
  if (r.canvassNumber) {
    canvassNumber.value = r.canvassNumber
  } else {
    try {
      canvassNumber.value = 'Loading...'
      const nextNo = await generateCanvassNo()
      canvassNumber.value = nextNo
    } catch (e) {
      console.error('Failed to generate canvass number:', e)
      canvassNumber.value = ''
    }
  }
  canvassDate.value = new Date().toISOString().slice(0, 10)
  supplier.value = r.supplier || ''
  canvassItems.value = (r.items || []).map((item) => ({ ...item }))
  actionError.value = ''
}

function closeCanvassModal() {
  modalCanvass.value = null
  actionError.value = ''
}

async function saveMarkCanvassed() {
  if (!modalCanvass.value) return
  if (!hasSignature.value) {
    actionError.value = 'Missing digital signature. Please set it up in your Profile.'
    return
  }
  if (!supplier.value.trim()) {
    actionError.value = 'Please enter the winning supplier.'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    const user = authStore.user
    await markRequisitionCanvassed(modalCanvass.value.id, {
      canvassNumber: canvassNumber.value.trim() || undefined,
      canvassDate: new Date(canvassDate.value + 'T12:00:00'),
      canvassBy: user ? { userId: user.uid, name: authStore.displayName, email: user.email } : null,
      supplier: supplier.value.trim(),
      items: canvassItems.value,
      signatureData: authStore.userProfile?.signatureData,
    })
    closeCanvassModal()
  } catch (e) {
    actionError.value = e?.message || 'Failed to submit canvass.'
  } finally {
    actionLoading.value = false
  }
}

// Modal Handlers (Receive)
function openMarkReceived(r) {
  modalReceived.value = r
  receivedAt.value = new Date().toISOString().slice(0, 10)
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
    const user = authStore.user
    await markRequisitionReceived(modalReceived.value.id, {
      receivedAt: new Date(receivedAt.value + 'T12:00:00'),
      receivedBy: user
        ? { userId: user.uid, name: authStore.displayName, email: user.email }
        : null,
      signatureData: authStore.userProfile?.signatureData,
    })
    closeReceivedModal()
  } catch (e) {
    actionError.value = e?.message || 'Failed to mark as received.'
  } finally {
    actionLoading.value = false
  }
}

// Categories tracked
const loadedCategories = ref(new Set())
const categoriesToLoad = ['canvassing', 'approvals', 'receiving']

function startSubscriptions() {
  unsubscribes.forEach((u) => u())
  unsubscribes = []
  loading.value = true
  loadedCategories.value.clear()

  // 1. Canvassing: Approved but no canvass
  const unsub1 = subscribeRequisitions(
    { status: REQUISITION_STATUS.APPROVED, canvassStatus: CANVASS_STATUS.PENDING },
    (results) => {
      canvassingList.value = results
      loadedCategories.value.add('canvassing')
      if (loadedCategories.value.size >= categoriesToLoad.length) {
        loading.value = false
      }
    },
    (err) => console.error('Canvassing error:', err),
  )

  // 2. Pending Approval: Submitted to BAC but GM hasn't signed PO
  const unsub2 = subscribeRequisitions(
    { status: REQUISITION_STATUS.APPROVED, canvassStatus: CANVASS_STATUS.SUBMITTED_TO_BAC },
    (results) => {
      // Filter out those already fully approved (poStatus === APPROVED)
      poPendingList.value = results.filter((r) => r.poStatus !== PO_STATUS.APPROVED)
      loadedCategories.value.add('approvals')
      if (loadedCategories.value.size >= categoriesToLoad.length) {
        loading.value = false
      }
    },
    (err) => console.error('Approvals error:', err),
  )

  // 3. Receiving: PO is approved, waiting for items
  const unsub3 = subscribeRequisitions(
    { status: REQUISITION_STATUS.APPROVED, purchaseStatus: PURCHASE_STATUS.ORDERED },
    (results) => {
      receivingList.value = results
      loadedCategories.value.add('receiving')
      if (loadedCategories.value.size >= categoriesToLoad.length) {
        loading.value = false
      }
    },
    (err) => console.error('Receiving error:', err),
  )

  unsubscribes = [unsub1, unsub2, unsub3]
}

// Handle authentication state
watch(
  [() => authStore.loading, () => authStore.user],
  ([loadingAuth, user]) => {
    if (loadingAuth) return
    if (!user) {
      unsubscribes.forEach((u) => u())
      unsubscribes = []
      return
    }
    startSubscriptions()
  },
  { immediate: true },
)

onMounted(() => {
  if (route.query.tab) {
    activeTab.value = route.query.tab
  }
})

onUnmounted(() => {
  unsubscribes.forEach((u) => u())
})

const getPoStatusLabel = (poStatus) => {
  if (!poStatus) return 'Sent to BAC'
  if (poStatus === PO_STATUS.PENDING_BUDGET) return 'Waiting for Budget'
  if (poStatus === PO_STATUS.PENDING_AUDIT) return 'Waiting for Audit'
  if (poStatus === PO_STATUS.PENDING_GM) return 'Waiting for GM'
  return poStatus
}
</script>

<template>
  <div class="procurement-hub jinja">
    <div class="page-header">
      <h1 class="page-title">Procurement Hub</h1>
      <p class="page-subtitle">
        Unified workspace for canvassing, tracking PO approvals, and receiving deliveries.
      </p>
    </div>

    <div v-if="!isPurchaser" class="access-denied">
      <p>This page is only available to the Purchaser role.</p>
    </div>

    <template v-else>
      <div class="hub-container">
        <!-- Dashboard Tabs -->
        <div class="hub-tabs">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'canvassing' }"
            @click="activeTab = 'canvassing'"
          >
            <span class="tab-label">Needs Canvassing</span>
            <span class="tab-count" v-if="canvassingList.length > 0">{{
              canvassingList.length
            }}</span>
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'approvals' }"
            @click="activeTab = 'approvals'"
          >
            <span class="tab-label">PO Tracking</span>
            <span class="tab-count secondary" v-if="poPendingList.length > 0">{{
              poPendingList.length
            }}</span>
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'receiving' }"
            @click="activeTab = 'receiving'"
          >
            <span class="tab-label">For Receiving</span>
            <span class="tab-count success" v-if="receivingList.length > 0">{{
              receivingList.length
            }}</span>
          </button>
        </div>

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
            <div class="active-tab-indicator">
              Showing:
              <strong>{{
                activeTab === 'canvassing'
                  ? 'Requests pending canvass'
                  : activeTab === 'approvals'
                    ? 'Purchase Orders in approval'
                    : 'Items ordered & waiting for delivery'
              }}</strong>
            </div>
          </div>

          <div class="panel-body">
            <div v-if="loading" class="loading-state">
              <div class="spinner"></div>
              <span>Updating Hub...</span>
            </div>

            <div v-else class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>RF Control No.</th>
                    <th>Date</th>
                    <th>Department</th>
                    <th>Purpose</th>
                    <th>Items</th>
                    <th v-if="activeTab !== 'canvassing'">Supplier</th>
                    <th v-if="activeTab === 'approvals'">Current Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="filteredList.length === 0" class="empty-row">
                    <td colspan="10" class="empty-cell">
                      <div class="empty-content">
                        <span class="empty-icon">✓</span>
                        <p>No active requisitions in this stage.</p>
                      </div>
                    </td>
                  </tr>
                  <tr
                    v-else
                    v-for="r in filteredList"
                    :key="r.id"
                    class="table-row"
                    @click="goToDetail(r.id)"
                  >
                    <td class="font-medium">{{ r.rfControlNo || '—' }}</td>
                    <td>{{ formatDate(r.date) }}</td>
                    <td>{{ getDeptAbbreviation(r.department) }}</td>
                    <td class="purpose-cell">
                      {{ (r.purpose || '').slice(0, 40)
                      }}{{ (r.purpose || '').length > 40 ? '…' : '' }}
                    </td>
                    <td class="text-center">{{ (r.items || []).length }}</td>
                    <td v-if="activeTab !== 'canvassing'">{{ r.supplier || '—' }}</td>
                    <td v-if="activeTab === 'approvals'">
                      <span class="status-chip">{{ getPoStatusLabel(r.poStatus) }}</span>
                    </td>
                    <td class="action-cell" @click.stop>
                      <button
                        v-if="activeTab === 'canvassing'"
                        class="btn-primary"
                        @click="openMarkCanvassed(r)"
                      >
                        Submit Canvass
                      </button>
                      <button
                        v-if="activeTab === 'receiving'"
                        class="btn-success"
                        @click="openMarkReceived(r)"
                      >
                        Mark Received
                      </button>
                      <button
                        v-if="activeTab === 'approvals'"
                        class="btn-flow"
                        @click="goToDetail(r.id)"
                      >
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
                          <circle cx="12" cy="12" r="3" />
                          <path
                            d="M12 2v3m0 14v3M4.22 4.22l2.12 2.12m11.32 11.32 2.12 2.12M2 12h3m14 0h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"
                          />
                        </svg>
                        Check Flow
                        <svg
                          class="btn-flow-arrow"
                          xmlns="http://www.w3.org/2000/svg"
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Consistently styled Modals (Canvass/Receive) -->
      <!-- [Modal Canvass Snippet] -->
      <div v-if="modalCanvass" class="hub-modal-overlay" @click.self="closeCanvassModal">
        <div class="hub-modal-card">
          <div class="hub-modal-header dark">
            <div class="hub-modal-title-group">
              <span class="hub-modal-icon">📝</span>
              <div>
                <h3>Submit Canvass to BAC</h3>
                <p>RF {{ modalCanvass.rfControlNo }}</p>
              </div>
            </div>
            <button class="close-btn" @click="closeCanvassModal">&times;</button>
          </div>
          <div class="hub-modal-body">
            <div v-if="actionError" class="hub-alert-error">{{ actionError }}</div>
            <div class="form-grid">
              <div class="form-field full">
                <label>Winning Supplier Name</label>
                <input v-model="supplier" type="text" placeholder="e.g. Acme Corp" />
              </div>
              <div class="form-field">
                <label>Canvass No. <span class="badge-auto">Auto</span></label>
                <input v-model="canvassNumber" type="text" readonly />
              </div>
              <div class="form-field">
                <label>Date</label>
                <input v-model="canvassDate" type="date" />
              </div>
            </div>
            <div class="modal-divider">Item Results (Unit Prices)</div>
            <div class="modal-table-wrap">
              <table class="modal-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style="width: 100px">Unit Price</th>
                    <th style="width: 120px">Brand</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in canvassItems" :key="item.description">
                    <td>{{ item.description }}</td>
                    <td><input v-model.number="item.unitPrice" type="number" step="0.01" /></td>
                    <td><input v-model="item.brand" type="text" /></td>
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
                <p>
                  You must set up your digital signature in your Profile before taking this action.
                </p>
                <router-link to="/profile" class="profile-link">Go to Profile →</router-link>
              </div>
            </div>
          </div>
          <div class="hub-modal-footer">
            <button class="btn-cancel" @click="closeCanvassModal">Cancel</button>
            <button
              class="btn-submit"
              :disabled="actionLoading || !hasSignature"
              @click="saveMarkCanvassed"
            >
              {{ actionLoading ? 'Submitting...' : '✓ Submit to BAC' }}
            </button>
          </div>
        </div>
      </div>

      <!-- [Modal Received Snippet] -->
      <div v-if="modalReceived" class="hub-modal-overlay" @click.self="closeReceivedModal">
        <div class="hub-modal-card small">
          <div class="hub-modal-header success">
            <div class="hub-modal-title-group">
              <span class="hub-modal-icon">📦</span>
              <div>
                <h3>Mark as Received</h3>
                <p>Confirm delivery for RF {{ modalReceived.rfControlNo }}</p>
              </div>
            </div>
            <button class="close-btn" @click="closeReceivedModal">&times;</button>
          </div>
          <div class="hub-modal-body">
            <div v-if="actionError" class="hub-alert-error">{{ actionError }}</div>
            <div class="form-field">
              <label>Delivery Receipt Date</label>
              <input v-model="receivedAt" type="date" />
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
          <div class="hub-modal-footer">
            <button class="btn-cancel" @click="closeReceivedModal">Cancel</button>
            <button
              class="btn-submit success"
              :disabled="actionLoading || !hasSignature"
              @click="saveMarkReceived"
            >
              {{ actionLoading ? 'Saving...' : 'Confirm Delivery' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.procurement-hub {
  padding: 1rem 2rem 2rem;
  background: #f1f5f9;
  height: calc(100vh - 64px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.page-header {
  margin-bottom: 1.5rem;
}
.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}
.page-subtitle {
  color: #64748b;
  margin-top: 0.25rem;
  font-size: 0.9375rem;
}

.hub-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.tab-btn {
  background: #fff;
  border: 1px solid #e2e8f0;
  padding: 0.75rem 1.25rem;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
  color: #64748b;
  font-weight: 600;
  font-size: 0.9375rem;
}

.tab-btn:hover {
  border-color: #cbd5e1;
  background: #fafbfc;
}
.tab-btn.active {
  background: #1e293b;
  color: #fff;
  border-color: #1e293b;
  box-shadow: 0 4px 12px rgba(30, 41, 59, 0.2);
}

.tab-count {
  background: #f1f5f9;
  color: #475569;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.75rem;
}
.tab-btn.active .tab-count {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.tab-count.secondary {
  background: #eff6ff;
  color: #2563eb;
}
.tab-count.success {
  background: #dcfce7;
  color: #166534;
}

.hub-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.panel {
  background: #fff;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.panel-body {
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

.data-table th {
  position: sticky;
  top: 0;
  z-index: 5;
}

.toolbar {
  padding: 1.25rem;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.search-wrap {
  position: relative;
  width: 320px;
}
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
}
.search-input {
  width: 100%;
  padding: 0.625rem 1rem 0.625rem 2.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.875rem;
}

.active-tab-indicator {
  font-size: 0.875rem;
  color: #64748b;
}
.active-tab-indicator strong {
  color: #1e293b;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
.data-table th {
  background: #f8fafc;
  padding: 0.875rem 1.25rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  border-bottom: 1px solid #e2e8f0;
}
.data-table td {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #f8fafc;
  font-size: 0.875rem;
}
.table-row:hover {
  background-image: linear-gradient(to right, #f8fafc, #fff);
  cursor: pointer;
}

.status-chip {
  display: inline-block;
  padding: 2px 8px;
  background: #f1f5f9;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #475569;
}

.btn-primary {
  background: #2563eb;
  color: #fff;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: none;
  font-weight: 600;
  cursor: pointer;
}
.btn-success {
  background: #166534;
  color: #fff;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: none;
  font-weight: 600;
  cursor: pointer;
}
.btn-outline {
  background: #fff;
  color: #475569;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  font-weight: 600;
  cursor: pointer;
}

.btn-flow {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.45rem 0.9rem;
  border-radius: 8px;
  border: none;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  color: #fff;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.35);
  transition: all 0.22s ease;
  white-space: nowrap;
}
.btn-flow:hover {
  background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.45);
  transform: translateY(-1px);
}
.btn-flow:hover .btn-flow-arrow {
  transform: translateX(3px);
}
.btn-flow-arrow {
  transition: transform 0.2s ease;
}

/* Modal Styles */
.hub-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.hub-modal-card {
  background: #fff;
  border-radius: 18px;
  width: 100%;
  max-width: 640px;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}
.hub-modal-card.small {
  max-width: 400px;
}

.hub-modal-header {
  padding: 1.25rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #fff;
}
.hub-modal-header.dark {
  background: #1e293b;
}
.hub-modal-header.success {
  background: #166534;
}

.hub-modal-title-group {
  display: flex;
  gap: 1rem;
  align-items: center;
}
.hub-modal-icon {
  font-size: 1.5rem;
}
.hub-modal-title-group h3 {
  margin: 0;
  font-size: 1.1rem;
}
.hub-modal-title-group p {
  margin: 0;
  opacity: 0.7;
  font-size: 0.8rem;
}
.close-btn {
  background: none;
  border: none;
  color: #fff;
  font-size: 1.5rem;
  cursor: pointer;
}

.hub-modal-body {
  padding: 1.5rem;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.form-field.full {
  grid-column: span 2;
}
.form-field label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 0.35rem;
  text-transform: uppercase;
}
.form-field input {
  width: 100%;
  padding: 0.625rem;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.9rem;
}

.modal-divider {
  margin: 1.5rem 0 1rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 0.5rem;
}

.modal-table-wrap {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
}
.modal-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}
.modal-table th {
  background: #f8fafc;
  padding: 0.5rem;
  text-align: left;
}
.modal-table td {
  padding: 0.5rem;
  border-top: 1px solid #f8fafc;
}
.modal-table input {
  width: 100%;
  padding: 0.25rem;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
}

.hub-modal-footer {
  padding: 1.25rem 1.5rem;
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
.btn-cancel {
  padding: 0.5rem 1.25rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}
.btn-submit {
  padding: 0.5rem 1.5rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}
.btn-submit.success {
  background: #166534;
}

.badge-auto {
  background: #dbeafe;
  color: #1e40af;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 0.65rem;
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

.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
