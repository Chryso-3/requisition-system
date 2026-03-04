<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  subscribePOApprovals,
  getPOApprovals,
  approvePOBudget,
  approvePOAudit,
  approvePOGM,
  rejectPO,
} from '@/services/requisitionService'
import { useAuthStore } from '@/stores/auth'
import { USER_ROLES, PO_STATUS } from '@/firebase/collections'

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(true)
const poList = ref([])
const actionLoading = ref(false)
const actionError = ref('')
const confirmApproveOpen = ref(false)
const confirmRejectOpen = ref(false)
const selectedPO = ref(null)
const rejectRemarks = ref('')
const rejectError = ref('')

let unsubscribe = null

// Determine which PO_STATUS this role should see
const pendingStatusForRole = computed(() => {
  const r = authStore.role
  if (r === USER_ROLES.BUDGET_OFFICER) return PO_STATUS.PENDING_BUDGET
  if (r === USER_ROLES.INTERNAL_AUDITOR) return PO_STATUS.PENDING_AUDIT
  if (r === USER_ROLES.GENERAL_MANAGER) return PO_STATUS.PENDING_GM
  if (r === USER_ROLES.PURCHASER) return PO_STATUS.APPROVED
  return null
})

const pageTitle = computed(() => {
  const r = authStore.role
  if (r === USER_ROLES.BUDGET_OFFICER) return '2. PO Approval (Budget/Funds)'
  if (r === USER_ROLES.INTERNAL_AUDITOR) return '2. PO Approval (Pre-Audit)'
  if (r === USER_ROLES.GENERAL_MANAGER) return '2. PO Approval (Final)'
  if (r === USER_ROLES.PURCHASER) return '2. Pending PO Approvals'
  return '2. PO Approval'
})

const pageSubtitle = computed(() => {
  if (authStore.role === USER_ROLES.PURCHASER) {
    return 'Purchase Orders ready to be sent to the supplier.'
  }
  return 'Purchase Orders awaiting your review and approval.'
})

onMounted(async () => {
  loading.value = true
  try {
    const status = pendingStatusForRole.value
    if (status) {
      // initial load
      poList.value = await getPOApprovals(status)
      // active subscription
      unsubscribe = subscribePOApprovals(
        status,
        (snap) => {
          poList.value = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        },
        (err) => {
          console.error(err)
        },
      )
    }
  } catch (e) {
    console.error('FIREBASE INDEX ERROR:', e)
    actionError.value = 'FIREBASE ERROR: ' + e.message
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

function goToDetail(id) {
  router.push({ path: `/requisitions/${id}`, query: { from: 'po-approvals' } })
}

function formatDate(dateString) {
  if (!dateString) return '—'
  const d = new Date(dateString)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

// Approval Actions
function handleApprovePO(r) {
  selectedPO.value = r
  confirmApproveOpen.value = true
}

function closeConfirmApprove() {
  confirmApproveOpen.value = false
  selectedPO.value = null
}

const hasSignature = computed(() => !!authStore.userProfile?.signatureData)

async function confirmApprovePO() {
  if (!selectedPO.value) return
  if (!hasSignature.value) {
    actionError.value = 'Missing digital signature. Please set it up in your Profile.'
    return
  }
  const r = selectedPO.value

  actionLoading.value = true
  actionError.value = ''
  try {
    const user = authStore.user
    const role = authStore.role

    const signatureData = authStore.userProfile?.signatureData

    if (role === USER_ROLES.BUDGET_OFFICER) {
      await approvePOBudget(r.id, user, signatureData)
    } else if (role === USER_ROLES.INTERNAL_AUDITOR) {
      await approvePOAudit(r.id, user, signatureData)
    } else if (role === USER_ROLES.GENERAL_MANAGER) {
      await approvePOGM(r.id, user, signatureData)
    }

    closeConfirmApprove()
    // Optimistic UI update
    poList.value = poList.value.filter((item) => item.id !== r.id)
  } catch (e) {
    console.error('Error approving PO:', e)
    actionError.value = e.message || 'Failed to approve PO.'
  } finally {
    actionLoading.value = false
    setTimeout(() => {
      actionError.value = ''
    }, 5000)
  }
}

function handleRejectPO(r) {
  selectedPO.value = r
  rejectRemarks.value = ''
  rejectError.value = ''
  confirmRejectOpen.value = true
}

function closeConfirmReject() {
  confirmRejectOpen.value = false
  selectedPO.value = null
  rejectRemarks.value = ''
  rejectError.value = ''
}

async function confirmRejectPO() {
  if (!rejectRemarks.value.trim()) {
    rejectError.value = 'Please provide a reason for rejection.'
    return
  }
  if (!selectedPO.value) return
  const r = selectedPO.value

  actionLoading.value = true
  rejectError.value = ''
  try {
    const user = authStore.user
    const role = authStore.role
    const stepMap = {
      [USER_ROLES.BUDGET_OFFICER]: 'Budget Officer',
      [USER_ROLES.INTERNAL_AUDITOR]: 'Internal Auditor',
      [USER_ROLES.GENERAL_MANAGER]: 'General Manager',
    }
    await rejectPO(r.id, user, { remarks: rejectRemarks.value, step: stepMap[role] || role })
    closeConfirmReject()
    poList.value = poList.value.filter((item) => item.id !== r.id)
  } catch (e) {
    console.error('Error rejecting PO:', e)
    rejectError.value = e.message || 'Failed to reject PO.'
  } finally {
    actionLoading.value = false
  }
}
</script>

<template>
  <div class="procurement-view pages-wrap">
    <div class="page-header">
      <div class="header-content">
        <h1 class="page-title">{{ pageTitle }}</h1>
        <p class="page-subtitle">{{ pageSubtitle }}</p>
      </div>
    </div>

    <div v-if="actionError" class="flash-error">
      <span class="error-icon">⚠️</span>
      {{ actionError }}
    </div>

    <div class="data-card">
      <div v-if="loading" class="empty-state">
        <div class="loading-spinner"></div>
        <p>Loading Purchase Orders...</p>
      </div>
      <div v-else-if="!pendingStatusForRole" class="permission-denied">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          class="empty-icon"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <p>You do not have permission to view PO Approvals.</p>
      </div>
      <div v-else-if="poList.length === 0" class="empty-state">
        <div class="illustration-box">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            class="empty-icon"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="m9 15 2 2 4-4" />
          </svg>
        </div>
        <h3>Everything is up to date!</h3>
        <p>No Purchase Orders are currently awaiting your action.</p>
      </div>

      <div v-else class="table-container">
        <table class="premium-table">
          <thead>
            <tr>
              <th>PO Identification</th>
              <th>Date Issued</th>
              <th>Supplier / Vendor</th>
              <th>Order Size</th>
              <th style="text-align: center">Quick Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in poList" :key="r.id" class="table-row" @click="goToDetail(r.id)">
              <td>
                <div class="po-id-box">
                  <span class="po-number-badge">{{ r.poNumber || '—' }}</span>
                </div>
              </td>
              <td>
                <span class="issued-date">{{ formatDate(r.orderedAt) }}</span>
              </td>
              <td class="supplier-cell">
                <span class="supplier-name">{{ r.supplier || '—' }}</span>
              </td>
              <td>
                <span class="item-count">{{ r.items?.length || 0 }} item(s)</span>
              </td>
              <td style="text-align: center" @click.stop>
                <div class="actions-group">
                  <button
                    class="btn-icon-action view"
                    title="View Details"
                    @click="goToDetail(r.id)"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <template v-if="authStore.role !== USER_ROLES.PURCHASER">
                    <button
                      class="btn-icon-action reject"
                      title="Reject PO"
                      :disabled="actionLoading"
                      @click="handleRejectPO(r)"
                    >
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
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                    <button
                      class="btn-icon-action approve"
                      title="Approve PO"
                      :disabled="actionLoading"
                      @click="handleApprovePO(r)"
                    >
                      <div v-if="actionLoading" class="spinner-tiny-dark"></div>
                      <svg
                        v-else
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Confirm: Reject PO Modal -->
    <div v-if="confirmRejectOpen" class="confirm-overlay no-print" @click.self="closeConfirmReject">
      <div class="confirm-modal reject-modal">
        <div class="confirm-header">
          <div class="confirm-icon reject">
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
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h3 class="confirm-title">Return / Reject Purchase Order</h3>
        </div>
        <p class="confirm-message">
          You are returning PO
          <strong>{{ selectedPO?.poNumber || selectedPO?.rfControlNo }}</strong
          >. A reason is <strong>required</strong> to proceed.
        </p>
        <div class="reject-remarks-section">
          <label class="reject-label"
            >Reason for Rejection <span class="required-star">*</span></label
          >
          <textarea
            v-model="rejectRemarks"
            class="reject-textarea"
            rows="4"
            placeholder="Explain why this Purchase Order is being returned or rejected..."
            @input="rejectError = ''"
          />
          <p v-if="rejectError" class="reject-error">{{ rejectError }}</p>
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn-cancel" @click="closeConfirmReject">Cancel</button>
          <button
            type="button"
            class="btn-reject-confirm"
            :disabled="actionLoading || !rejectRemarks.trim()"
            @click="confirmRejectPO"
          >
            <div v-if="actionLoading" class="spinner-tiny" style="margin-right: 8px"></div>
            {{ actionLoading ? 'Processing...' : 'Confirm Rejection' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Confirm: Approve PO Modal -->
    <div
      v-if="confirmApproveOpen"
      class="confirm-overlay no-print"
      @click.self="closeConfirmApprove"
    >
      <div class="confirm-modal">
        <div class="confirm-header">
          <div class="confirm-icon">
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
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h3 class="confirm-title">Approve Purchase Order</h3>
        </div>
        <p class="confirm-message">
          Are you sure you want to approve Purchase Order
          <strong>{{ selectedPO?.poNumber || selectedPO?.rfControlNo }}</strong
          >? This will record your digital signature and move the request to the next stage.
        </p>
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
            <p>You must set up your digital signature in your Profile before approving.</p>
            <router-link to="/profile" class="profile-link">Go to Profile →</router-link>
          </div>
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn-cancel" @click="closeConfirmApprove">Cancel</button>
          <button
            type="button"
            class="btn-confirm"
            :disabled="actionLoading || !hasSignature"
            @click="confirmApprovePO"
          >
            <div v-if="actionLoading" class="spinner-tiny" style="margin-right: 8px"></div>
            {{ actionLoading ? 'Processing...' : 'Yes, Approve PO' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.procurement-view {
  --brand-primary: #2563eb;
  --brand-primary-dark: #1e40af;
  --brand-navy: #1e293b;
  --brand-bg: #f8fafc;
  --text-main: #1e293b;
  --text-muted: #64748b;
  --border-light: #e2e8f0;
  --surface-white: #ffffff;
}

.pages-wrap {
  width: 100%;
  padding: 1.5rem 2.5rem 2.5rem;
  background: var(--brand-bg);
  height: calc(100vh - 64px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-header {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid var(--border-light);
}

.page-title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--brand-navy);
  letter-spacing: -0.01em;
}

.page-subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.95rem;
  color: var(--text-muted);
  font-weight: 400;
}

.flash-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  padding: 1rem 1.25rem;
  border-radius: 10px;
  margin-bottom: 1.5rem;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 500;
  box-shadow: 0 2px 4px rgba(185, 28, 28, 0.05);
}

.data-card {
  background: var(--surface-white);
  border: 1px solid var(--border-light);
  border-radius: 16px;
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.04),
    0 4px 6px -2px rgba(0, 0, 0, 0.02);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  margin-bottom: 2rem;
  flex: 1;
  min-height: 0;
}

.table-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
}

.premium-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  text-align: left;
  min-width: 800px;
}

.premium-table th {
  background: #f1f5f9;
  color: var(--brand-navy);
  font-weight: 700;
  padding: 1.25rem 1.5rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-light);
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 10;
}

.premium-table td {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
  color: var(--text-main);
  font-size: 0.9rem;
  transition: background 0.15s ease;
}

.table-row {
  cursor: pointer;
}

.table-row:hover td {
  background: #f0f9ff;
}

.premium-table tr:last-child td {
  border-bottom: none;
}

/* Row elements */
.po-number-badge {
  display: inline-block;
  background: #eff6ff;
  color: var(--brand-primary);
  padding: 0.35rem 0.75rem;
  border-radius: 8px;
  font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
  font-weight: 700;
  font-size: 0.85rem;
  border: 1px solid #dbeafe;
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.05);
}

.issued-date {
  font-weight: 500;
  color: var(--text-muted);
}

.supplier-name {
  font-weight: 600;
  color: var(--text-main);
}

.item-count {
  font-size: 0.85rem;
  color: var(--text-muted);
  background: #f1f5f9;
  padding: 0.25rem 0.65rem;
  border-radius: 20px;
}

.actions-group {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

/* Action Buttons */
.btn-action {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid transparent;
}

.btn-action.view {
  background: #ffffff;
  border-color: var(--border-light);
  color: var(--text-main);
}

.btn-action.view:hover {
  background: #f1f5f9;
  border-color: var(--brand-primary);
  color: var(--brand-primary);
  transform: translateY(-1px);
}

.btn-action.approve {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #ffffff;
  box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);
}

.btn-action.approve:hover:not(:disabled) {
  transform: translateY(-1.5px);
  box-shadow: 0 6px 12px rgba(37, 99, 235, 0.3);
  filter: brightness(1.1);
}

/* OLD text button styles kept for reference but overridden below */

/* Icon-only action buttons */
.actions-group {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  align-items: center;
}

.btn-icon-action {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  position: relative;
}

.btn-icon-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

/* Grey — View Details */
.btn-icon-action.view {
  background: #f1f5f9;
  color: #64748b;
}

.btn-icon-action.view:hover:not(:disabled) {
  background: #e2e8f0;
  color: #1e293b;
  transform: scale(1.1);
}

/* Red — Reject */
.btn-icon-action.reject {
  background: #fef2f2;
  color: #dc2626;
}

.btn-icon-action.reject:hover:not(:disabled) {
  background: #dc2626;
  color: #fff;
  transform: scale(1.1);
  box-shadow: 0 4px 10px rgba(220, 38, 38, 0.35);
}

/* Green — Approve */
.btn-icon-action.approve {
  background: #ecfdf5;
  color: #059669;
}

.btn-icon-action.approve:hover:not(:disabled) {
  background: #059669;
  color: #fff;
  transform: scale(1.1);
  box-shadow: 0 4px 10px rgba(5, 150, 105, 0.35);
}

.spinner-tiny-dark {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(5, 150, 105, 0.3);
  border-top-color: #059669;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

/* Empty States & Loading */
.empty-state,
.permission-denied {
  padding: 5rem 2rem;
  text-align: center;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.empty-state h3 {
  margin: 0;
  font-size: 1.25rem;
  color: var(--text-main);
  font-weight: 600;
}

.empty-state p {
  margin: 0;
  max-width: 300px;
  line-height: 1.5;
}

.illustration-box {
  width: 100px;
  height: 100px;
  background: #eff6ff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-primary);
  margin-bottom: 0.5rem;
}

.empty-icon {
  opacity: 0.7;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #f1f5f9;
  border-top-color: var(--brand-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner-tiny {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .pages-wrap {
    padding: 1rem 1.25rem;
  }
  .actions-group {
    flex-direction: column;
    align-items: stretch;
  }
}

/* Modal Styling - Professional standard */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 1.5rem;
}

.confirm-modal {
  background: #fff;
  border-radius: 16px;
  padding: 1.75rem;
  width: 100%;
  max-width: 420px;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
  animation: modal-pop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

@keyframes modal-pop {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.confirm-icon {
  width: 40px;
  height: 40px;
  background: #ecfdf5;
  color: #059669;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--brand-navy);
  letter-spacing: -0.01em;
}

.confirm-message {
  margin: 0 0 1.75rem;
  font-size: 0.95rem;
  color: var(--text-muted);
  line-height: 1.6;
}

.confirm-message strong {
  color: var(--text-main);
  font-weight: 700;
}

.confirm-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

.btn-cancel {
  padding: 0.65rem 1.25rem;
  background: #fff;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-main);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.btn-confirm {
  padding: 0.65rem 1.5rem;
  background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);
}

.btn-confirm:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: 0 6px 12px rgba(37, 99, 235, 0.3);
}

.btn-action.reject {
  background: #ffffff;
  border-color: #fecaca;
  color: #dc2626;
}

.btn-action.reject:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #dc2626;
  transform: translateY(-1px);
}

.btn-action.reject:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Reject Modal specific styles */
.reject-modal .confirm-icon.reject {
  background: #fef2f2;
  color: #dc2626;
}

.reject-remarks-section {
  margin-bottom: 1.5rem;
}

.reject-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: 0.5rem;
}

.required-star {
  color: #dc2626;
  margin-left: 2px;
}

.reject-textarea {
  width: 100%;
  padding: 0.75rem;
  border: 1.5px solid var(--border-light);
  border-radius: 10px;
  font-size: 0.9rem;
  font-family: inherit;
  color: var(--text-main);
  resize: vertical;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.reject-textarea:focus {
  outline: none;
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
}

.reject-error {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: #dc2626;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.btn-reject-confirm {
  padding: 0.65rem 1.5rem;
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 6px rgba(220, 38, 38, 0.2);
}

.btn-reject-confirm:hover:not(:disabled) {
  filter: brightness(1.05);
  transform: translateY(-1px);
  box-shadow: 0 6px 12px rgba(220, 38, 38, 0.3);
}

.btn-reject-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
.signature-warning {
  margin-top: 1.25rem;
  padding: 1rem;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 12px;
  display: flex;
  gap: 0.875rem;
  color: #92400e;
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
