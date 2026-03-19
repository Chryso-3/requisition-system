<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  subscribeRequisitions,
  loadMoreRequisitions,
  REQUISITION_PAGE_SIZE,
  markRequisitionCanvassed,
  generateCanvassNo,
  upsertRequisitionQuote,
} from '@/services/requisitionService'
import { getDeptAbbreviation } from '@/utils/deptUtils'
import { compressImageToBase64 } from '@/utils/imageUtils'
import { REQUISITION_STATUS, USER_ROLES, CANVASS_STATUS } from '@/firebase/collections'
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
const modalCanvass = ref(null)
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
    currentViewEnd > approvedRequisitions.value.length - 15 &&
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
  router.push({ path: `/requisitions/${id}`, query: { from: 'canvass-orders' } })
}

const canvassNumber = ref('')
const canvassDate = ref('')
const supplier = ref('')
const canvassItems = ref([])
const selectedQuotes = ref([
  { file: null, base64: null, name: '' },
  { file: null, base64: null, name: '' },
  { file: null, base64: null, name: '' },
])

async function openMarkCanvassed(r) {
  modalCanvass.value = r
  if (r.canvassNumber) {
    canvassNumber.value = r.canvassNumber
  } else {
    // Auto-generate if missing
    try {
      canvassNumber.value = 'Loading...'
      const nextNo = await generateCanvassNo()
      canvassNumber.value = nextNo
    } catch (e) {
      console.error('Failed to generate canvass number:', e)
      canvassNumber.value = ''
    }
  }
  canvassDate.value = r.canvassDate
    ? (r.canvassDate?.toDate ? r.canvassDate.toDate() : new Date(r.canvassDate))
        .toISOString()
        .slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  supplier.value = r.supplier || ''
  canvassItems.value = (r.items || []).map((item) => ({ ...item }))
  actionError.value = ''
}
function closeCanvassModal() {
  modalCanvass.value = null
  canvassNumber.value = ''
  actionError.value = ''
  supplier.value = ''
  selectedQuotes.value = [
    { file: null, base64: null, name: '' },
    { file: null, base64: null, name: '' },
    { file: null, base64: null, name: '' },
  ]
}
async function saveMarkCanvassed() {
  if (!modalCanvass.value) return
  if (!hasSignature.value) {
    actionError.value = 'Missing digital signature. Please set it up in your Profile.'
    return
  }

  // Validate 3 quotes
  const quotesCount = selectedQuotes.value.filter((q) => q.file || q.base64).length
  if (quotesCount < 3) {
    actionError.value = 'Please upload all 3 supplier quotes/images before submitting.'
    return
  }

  actionLoading.value = true
  actionError.value = ''
  try {
    const user = authStore.user
    const requisitionId = modalCanvass.value.id

    // 1. Upload/Compress quotes first
    for (let i = 0; i < selectedQuotes.value.length; i++) {
      const q = selectedQuotes.value[i]
      if (q.file && !q.base64) {
        q.base64 = await compressImageToBase64(q.file)
      }
      await upsertRequisitionQuote(requisitionId, i, {
        name: q.name || q.file?.name || `Quote ${i + 1}`,
        base64: q.base64,
      })
    }

    // 2. Mark canvassed
    await markRequisitionCanvassed(requisitionId, {
      canvassNumber: canvassNumber.value.trim() || undefined,
      canvassDate: canvassDate.value ? new Date(canvassDate.value + 'T12:00:00') : new Date(),
      canvassBy: user
        ? { userId: user?.uid, name: authStore?.displayName, email: user?.email }
        : null,
      supplier: supplier.value.trim() || undefined,
      items: canvassItems.value,
      signatureData: authStore?.userProfile?.signatureData,
      hasQuotes: true,
    })
    closeCanvassModal()
  } catch (e) {
    console.error('Save canvass error:', e)
    actionError.value = e?.message || 'Failed to submit canvass to BAC.'
  } finally {
    actionLoading.value = false
  }
}

async function handleQuoteFile(e, index) {
  const file = e.target.files[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    actionError.value = 'Please upload image files only (JPG, PNG).'
    return
  }

  actionLoading.value = true
  try {
    // Preview immediately, compress on save to avoid UI lag
    selectedQuotes.value[index].file = file
    selectedQuotes.value[index].name = file.name
    const reader = new FileReader()
    reader.onload = (ev) => {
      selectedQuotes.value[index].base64 = ev.target.result
    }
    reader.readAsDataURL(file)
  } catch (err) {
    actionError.value = 'Failed to process image.'
  } finally {
    actionLoading.value = false
  }
}

function clearQuote(index) {
  selectedQuotes.value[index] = { file: null, base64: null, name: '' }
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
      { status: REQUISITION_STATUS.APPROVED, canvassStatus: CANVASS_STATUS.PENDING },
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
    { status: REQUISITION_STATUS.APPROVED, canvassStatus: CANVASS_STATUS.PENDING },
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
  <div class="canvass-list jinja">
    <div class="page-header">
      <h1 class="page-title">Canvass Orders</h1>
      <p class="page-subtitle">
        Requisitions approved by General Manager awaiting canvass details.
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
                    <th>Status</th>
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
                          : 'No requisitions pending canvass.'
                      }}
                    </td>
                  </tr>
                  <tr v-else v-for="r in paginatedList" :key="r.id" @click="goToDetail(r.id)">
                    <td class="font-medium">{{ r.rfControlNo || '—' }}</td>
                    <td>{{ formatDate(r.date) }}</td>
                    <td>{{ getDeptAbbreviation(r.department) }}</td>
                    <td class="purpose-cell">
                      {{ (r.purpose || '').slice(0, 40)
                      }}{{ (r.purpose || '').length > 40 ? '…' : '' }}
                    </td>
                    <td class="text-center">{{ (r.items || []).length }}</td>
                    <td>
                      <span class="purchase-status-badge pending">Pending Canvass</span>
                    </td>
                    <td class="action-cell" @click.stop>
                      <button type="button" class="btn-view" @click="goToDetail(r.id)">
                        View Detail
                      </button>
                      <button
                        type="button"
                        class="btn-action ordered"
                        :disabled="actionLoading"
                        @click="openMarkCanvassed(r)"
                      >
                        Submit Canvass
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

      <!-- Create Canvass Order modal -->
      <div v-if="modalCanvass" class="purchase-modal-overlay" @click.self="closeCanvassModal">
        <div class="co-modal-card" role="dialog" aria-modal="true" aria-labelledby="co-modal-title">
          <!-- Header -->
          <div class="co-modal-header">
            <div class="co-modal-header-left">
              <div class="co-modal-icon-wrap">
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
                  <rect x="1" y="3" width="15" height="13" />
                  <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                </svg>
              </div>
              <div>
                <h3 id="co-modal-title" class="co-modal-title">Submit Canvass to BAC</h3>
                <span class="co-modal-sub"
                  >RF {{ modalCanvass.rfControlNo || modalCanvass.id }}</span
                >
              </div>
            </div>
            <button class="co-modal-close" @click="closeCanvassModal">&times;</button>
          </div>

          <!-- Body -->
          <div class="co-modal-body">
            <div v-if="actionError" class="co-alert">{{ actionError }}</div>

            <!-- Supplier -->
            <div class="co-field">
              <label class="co-label">Winning Supplier (Optional)</label>
              <input
                v-model="supplier"
                type="text"
                placeholder="BAC will decide if left blank"
                class="co-input"
              />
            </div>

            <!-- Quote Uploads -->
            <div class="co-divider"></div>
            <p class="co-section-title">Supplier Quotes (Required 3) <span class="co-required">*</span></p>
            <div class="co-quote-grid">
              <div v-for="(q, idx) in selectedQuotes" :key="idx" class="co-quote-slot">
                <input
                  :id="'quote-file-' + idx"
                  type="file"
                  accept="image/*"
                  hidden
                  @change="handleQuoteFile($event, idx)"
                />
                <template v-if="!q.base64">
                  <label :for="'quote-file-' + idx" class="co-quote-placeholder">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span>Quote {{ idx + 1 }}</span>
                  </label>
                </template>
                <template v-else>
                  <div class="co-quote-preview-wrap">
                    <img :src="q.base64" alt="Preview" class="co-quote-preview" />
                    <button class="co-quote-remove" @click="clearQuote(idx)">&times;</button>
                    <div class="co-quote-name">{{ q.name }}</div>
                  </div>
                </template>
              </div>
            </div>

            <!-- CO Number + Date -->
            <div class="co-grid-2">
              <div class="co-field">
                <label class="co-label"
                  >Canvass Order No. <span class="co-auto-badge">Auto</span></label
                >
                <input
                  :value="canvassNumber"
                  type="text"
                  class="co-input co-input-readonly"
                  readonly
                />
              </div>
              <div class="co-field">
                <label class="co-label">Canvass Date</label>
                <input v-model="canvassDate" type="date" class="co-input" />
              </div>
            </div>

            <div class="co-divider"></div>
            <p class="co-section-title">Canvass Results — Item Prices & Brands</p>

            <div class="co-table-wrap">
              <table class="co-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style="width: 60px">Qty</th>
                    <th style="width: 130px">Unit Price</th>
                    <th style="width: 140px">Brand / Model</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in canvassItems" :key="idx">
                    <td class="co-td-desc">{{ item.description }}</td>
                    <td class="co-td-center">{{ item.quantity }}</td>
                    <td>
                      <input
                        v-model.number="item.unitPrice"
                        type="number"
                        step="0.01"
                        class="co-cell-input co-text-right"
                        placeholder="0.00"
                      />
                    </td>
                    <td>
                      <input
                        v-model="item.brand"
                        type="text"
                        class="co-cell-input"
                        placeholder="e.g. Samsung"
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
                <p>
                  You must set up your digital signature in your Profile before submitting a
                  canvass.
                </p>
                <router-link to="/profile" class="profile-link">Go to Profile →</router-link>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="co-modal-footer">
            <button type="button" class="co-btn-cancel" @click="closeCanvassModal">Cancel</button>
            <button
              type="button"
              class="co-btn-primary"
              :disabled="actionLoading || !hasSignature"
              @click="saveMarkCanvassed"
            >
              {{ actionLoading ? 'Submitting…' : '✓ Submit to BAC' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ========================
   Premium Canvass Modal
   ======================== */
.co-modal-card {
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.25);
  width: 100%;
  max-width: 640px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: coSlideUp 0.25s ease;
}

@keyframes coSlideUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.co-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: #fff;
  flex-shrink: 0;
}

.co-modal-header-left {
  display: flex;
  align-items: center;
  gap: 0.875rem;
}

.co-modal-icon-wrap {
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

.co-modal-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #fff;
}

.co-modal-sub {
  display: inline-block;
  margin-top: 3px;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  font-family: monospace;
}

.co-modal-close {
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
.co-modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.co-modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.co-alert {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  border-radius: 8px;
  padding: 0.625rem 0.875rem;
  font-size: 0.8125rem;
}

.co-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.875rem;
}

.co-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.co-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.co-required {
  color: #ef4444;
}

.co-input {
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
.co-input:focus {
  outline: none;
  border-color: #1d4ed8;
  box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.1);
  background: #fff;
}

.co-input-readonly {
  background: #f1f5f9;
  color: #64748b;
  cursor: not-allowed;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.co-auto-badge {
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

.co-divider {
  border: none;
  border-top: 1px solid #f1f5f9;
}

.co-section-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
}

/* Quote Grid */
.co-quote-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-top: 0.5rem;
}

.co-quote-slot {
  aspect-ratio: 4 / 3;
  border: 2px dashed #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  background: #f8fafc;
  transition: all 0.2s;
}
.co-quote-slot:hover {
  border-color: #1d4ed8;
  background: #f1f5f9;
}

.co-quote-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  cursor: pointer;
  color: #64748b;
  font-size: 0.75rem;
  font-weight: 600;
}
.co-quote-placeholder svg {
  opacity: 0.5;
}

.co-quote-preview-wrap {
  width: 100%;
  height: 100%;
  position: relative;
}
.co-quote-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.co-quote-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.6);
  color: #fff;
  border: none;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s;
}
.co-quote-remove:hover {
  background: #ef4444;
}
.co-quote-name {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 0.65rem;
  padding: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.co-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.co-table th {
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

.co-table tr:not(:last-child) td {
  border-bottom: 1px solid #f1f5f9;
}
.co-table td {
  padding: 0.45rem 0.625rem;
  vertical-align: middle;
}
.co-td-desc {
  font-weight: 500;
  color: #1e293b;
}
.co-td-center {
  color: #64748b;
  font-size: 0.8rem;
}

.co-cell-input {
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.8125rem;
  background: #f8fafc;
  box-sizing: border-box;
}
.co-cell-input:focus {
  outline: none;
  border-color: #1d4ed8;
  background: #fff;
}
.co-text-right {
  text-align: right;
}

.co-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #f1f5f9;
  background: #fafbfc;
  flex-shrink: 0;
}

.co-btn-cancel {
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
.co-btn-cancel:hover {
  background: #f1f5f9;
}

.co-btn-primary {
  padding: 0.6rem 1.5rem;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(29, 78, 216, 0.3);
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}
.co-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(29, 78, 216, 0.4);
}
.co-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* Page Styles */
.jinja {
  --jinja-bg: #f1f5f9;
  --jinja-surface: #ffffff;
  --jinja-border: #e2e8f0;
  --jinja-text: #0f172a;
  --jinja-muted: #64748b;
}

.canvass-list {
  width: 100%;
  padding: 0.75rem 2rem 1.75rem;
  background: var(--jinja-bg);
  flex: 1; min-height: 0;
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

.purchase-status-badge {
  display: inline-flex;
  padding: 0.25rem 0.625rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
}
.purchase-status-badge.pending {
  background: #e0f2fe;
  color: #0369a1;
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
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
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
  transition: border-color 0.2s;
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
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}
.purchase-modal-btn-cancel {
  background: transparent;
  color: #64748b;
}
.purchase-modal-btn-cancel:hover {
  background: #f1f5f9;
  color: #1e293b;
}
.purchase-modal-btn-primary {
  background: #0ea5e9;
  color: white;
}
.purchase-modal-btn-primary:hover {
  background: #0284c7;
}
/* Modal Specific styles for Canvass Details */
.purchase-modal-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-top: 1rem;
}
.purchase-modal-field.full-width {
  grid-column: span 2;
  margin-bottom: 0.5rem;
}
.canvass-results-section {
  margin-top: 1.5rem;
  border-top: 1px solid #e2e8f0;
  padding-top: 1rem;
}
.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}
.modal-table-container {
  max-height: 250px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.modal-item-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}
.modal-item-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  padding: 0.5rem;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
  color: #64748b;
  font-weight: 600;
  z-index: 1;
}
.modal-item-table td {
  padding: 0.5rem;
  border-bottom: 1px solid #f1f5f9;
  color: #1e293b;
  vertical-align: middle;
}
.table-input {
  width: 100%;
  padding: 0.25rem 0.5rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.8125rem;
}
.table-input:focus {
  outline: none;
  border-color: #0ea5e9;
  box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.1);
}

.purchase-modal-overflow {
  overflow-y: auto;
  max-height: 85vh;
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
