<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  subscribeRequisition,
  getRequisitionStatusLog,
  submitRequisition,
  approveRequisition,
  declineRequisition,
  upsertRequisitionSignature,
  subscribeRequisitionSignatures,
  canUserApprove,
  APPROVAL_WORKFLOW,
  updateRequisition,
  deleteRequisition,
} from '@/services/requisitionService'
import { Edit2 } from 'lucide-vue-next'
import { getDeptAbbreviation } from '@/utils/deptUtils'
import { compressImageToBase64 } from '@/utils/imageUtils'
import { REQUISITION_STATUS, USER_ROLES } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import RequisitionForm from '@/components/RequisitionForm.vue'

const printMode = ref('fm-pur-05') // 'fm-pur-05' only
const activeTab = ref('overview')

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const id = computed(() => route.params.id)
const from = computed(() => route.query.from || '')

const requisition = ref(null)
const loading = ref(true)
const error = ref(null)
const editing = ref(false)
const declineModalOpen = ref(false)
const declineRemarks = ref('')
const declineError = ref('')
const actionLoading = ref(false)
const actionLoadingLabel = ref('Processing…')
const confirmApproveOpen = ref(false)
const confirmSubmitOpen = ref(false)
const confirmEditOpen = ref(false)
const confirmDiscardOpen = ref(false)

let unsubscribe = null
let unsubscribeSigs = null

// Signatures loaded from separate collection (prevents 1MB requisition doc).
const sigMap = ref({})

function sigSrcFor(roleKey, fallbackObj) {
  return (
    sigMap.value?.[roleKey]?.signatureData ??
    fallbackObj?.signatureUrl ??
    fallbackObj?.signatureData ??
    null
  )
}

const statusLog = computed(() => getRequisitionStatusLog(requisition.value))

const backLabel = computed(() => {
  if (from.value === 'my-requisitions') return 'Back to My Requisitions'
  if (from.value === 'audit-log') return 'Back to Logs'
  if (from.value === 'archive') return 'Back to Archive'
  if (from.value === 'admin-requisitions') return 'Back to Admin Requisitions'
  return 'Back to list'
})

const backPath = computed(() => {
  if (from.value === 'my-requisitions') return '/my-requisitions'
  if (from.value === 'audit-log') return '/audit-log'
  if (from.value === 'archive') return '/archive'
  if (from.value === 'admin-requisitions') return '/admin/requisitions'
  return '/all-requisitions'
})

const isRequestor = computed(() => {
  const r = requisition.value
  const uid = authStore.user?.uid
  return !!uid && r?.requestedBy?.userId === uid
})

const canEditDraft = computed(() => {
  const r = requisition.value
  return r?.status === REQUISITION_STATUS.DRAFT && isRequestor.value
})

const fromAuditLog = computed(() => from.value === 'audit-log')

const approverRole = computed(() => authStore?.role || authStore.userProfile?.role)

const showApproveDecline = computed(() => {
  const r = requisition.value
  if (!r) return false
  const canApprove = canUserApprove(approverRole.value, r.status)
  console.log('[DEBUG] showApproveDecline:', canApprove, 'Role:', approverRole.value, 'Status:', r.status)
  return canApprove
})

const isFinished = computed(() => requisition.value?.status === REQUISITION_STATUS.APPROVED)

const canPrint = computed(() => {
  // Always allow printing if finished
  if (isFinished.value) return true
  // Also allow if explicitly a procurement role (future proofing)
  if (authStore.role === 'procurement' || authStore.userProfile?.role === 'procurement') return true
  return false
})

const hasSignature = computed(() => !!authStore.userProfile?.signatureData)

const isLongForm = computed(() => {
  const items = requisition.value?.items || []
  // If we have more than 10 items, it's likely too long for 2-copy on 1 page
  return items.length > 10
})




function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString()
}

function formatCurrency(val) {
  if (val === undefined || val === null) return '—'
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(val)
}

function goBack() {
  router.push(backPath.value)
}

function openDeclineModal() {
  declineRemarks.value = ''
  declineError.value = ''
  declineModalOpen.value = true
}

function closeDeclineModal() {
  declineModalOpen.value = false
  declineRemarks.value = ''
  declineError.value = ''
}

function openConfirmApprove() {
  confirmApproveOpen.value = true
}

function openConfirmSubmit() {
  confirmSubmitOpen.value = true
}

function openConfirmEdit() {
  confirmEditOpen.value = true
}

function openConfirmDiscard() {
  confirmDiscardOpen.value = true
}

function closeConfirmApprove() {
  confirmApproveOpen.value = false
}

function closeConfirmSubmit() {
  confirmSubmitOpen.value = false
}

function closeConfirmEdit() {
  confirmEditOpen.value = false
}

function closeConfirmDiscard() {
  confirmDiscardOpen.value = false
}

async function handleSubmit() {
  closeConfirmSubmit()
  if (!requisition.value?.id) return
  if (!hasSignature.value) {
    error.value = 'Missing digital signature. Please set it up in your Profile.'
    return
  }
  actionLoadingLabel.value = 'Submitting…'
  actionLoading.value = true
  error.value = null
  try {
    const updates = {}
    if (isRequestor.value && authStore.user) {
      updates.requestedBy = {
        userId: authStore.user.uid,
        name: authStore?.displayName,
        email: authStore.user.email || '',
        signedAt: new Date().toISOString(),
        // Signature is stored in a separate collection (see upsertRequisitionSignature)
      }
    }
    await submitRequisition(requisition.value.id, updates)

    // Save requestor signature separately (base64).
    if (isRequestor.value && authStore?.userProfile?.signatureData) {
      await upsertRequisitionSignature(requisition.value.id, 'requestedBy', {
        userId: authStore?.user?.uid,
        name: authStore?.displayName,
        title: 'Requestor',
        signedAt: updates.requestedBy?.signedAt ?? new Date().toISOString(),
        signatureData: authStore?.userProfile?.signatureData,
      })
    }
  } catch (e) {
    error.value = e.message || 'Failed to submit.'
  } finally {
    actionLoading.value = false
  }
}

async function handleApprove() {
  closeConfirmApprove()
  if (!requisition.value?.id || !authStore.user) return
  if (!hasSignature.value) {
    error.value = 'Missing digital signature. Please set it up in your Profile.'
    return
  }
  actionLoadingLabel.value = 'Approving…'
  actionLoading.value = true
  error.value = null
  try {
    await approveRequisition(
      requisition.value.id,
      {
        userId: authStore.user.uid,
        name: authStore?.displayName,
        email: authStore.user.email || '',
        signatureData: authStore.userProfile?.signatureData ?? null,
      },
      approverRole.value,
    )
  } catch (e) {
    const msg = e.message || 'Failed to approve.'
    error.value =
      msg.includes('permission') || msg.includes('insufficient')
        ? 'Action blocked: you may not have permission for this step. Please try signing out and back in.'
        : msg
  } finally {
    actionLoading.value = false
  }
}

async function handleDecline() {
  if (!requisition.value?.id || !authStore.user) return
  const remarks = declineRemarks.value.trim()
  if (!remarks) {
    declineError.value = 'Please enter a reason/remarks before declining.'
    return
  }
  actionLoadingLabel.value = 'Declining…'
  actionLoading.value = true
  error.value = null
  try {
    await declineRequisition(
      requisition.value.id,
      {
        userId: authStore.user.uid,
        name: authStore?.displayName,
        email: authStore.user.email || '',
      },
      remarks,
      approverRole.value,
    )
    closeDeclineModal()
  } catch (e) {
    const msg = e.message || 'Failed to decline.'
    error.value =
      msg.includes('permission') || msg.includes('insufficient')
        ? 'Action blocked: you may not have permission for this step. Please try signing out and back in.'
        : msg
  } finally {
    actionLoading.value = false
  }
}

function confirmEdit() {
  closeConfirmEdit()
  editing.value = true
}

function handleUpdated() {
  editing.value = false
}

async function handleDiscardDraft() {
  closeConfirmDiscard()
  if (!requisition.value?.id) return

  actionLoadingLabel.value = 'Discarding…'
  actionLoading.value = true
  error.value = null
  try {
    const parentPath = backPath.value
    // Prevent the real-time listener from throwing "Requisition not found" when it's deleted
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    if (unsubscribeSigs) {
      unsubscribeSigs()
      unsubscribeSigs = null
    }
    await deleteRequisition(requisition.value.id)
    router.push(parentPath)
  } catch (e) {
    error.value = e.message || 'Failed to discard draft.'
  } finally {
    actionLoading.value = false
  }
}

function doPrint() {
  window.print()
}

async function setPrintMode(mode) {
  printMode.value = mode
}

function initSubscriptions() {
  const reqId = id.value
  if (!reqId) {
    loading.value = false
    error.value = 'Missing requisition ID.'
    return
  }

  // Clear previous subscriptions if any
  if (unsubscribe) unsubscribe()
  if (unsubscribeSigs) unsubscribeSigs()

  loading.value = true
  error.value = null
  unsubscribe = subscribeRequisition(reqId, (r) => {
    requisition.value = r
    loading.value = false
    if (!r) {
      error.value = 'Requisition not found.'
      return
    }
  })

  // Subscribe to separate signatures (stored separately to keep the main requisition document lightweight).
  unsubscribeSigs = subscribeRequisitionSignatures(reqId, (map) => {
    sigMap.value = map || {}
  })
}

onMounted(() => {
  initSubscriptions()
})

watch(id, () => {
  initSubscriptions()
})

</script>
<template>
  <div class="detail-view">
    <div class="detail-toolbar no-print">
      <div class="toolbar-left">
        <a href="#" class="back-link" @click.prevent="goBack">{{ backLabel }}</a>
      </div>
    </div>

    <div v-if="fromAuditLog" class="audit-banner no-print">
      Navigated from Audit Log. Standard role-based actions are enabled.
    </div>

    <div v-if="error" class="error-message">{{ error }}</div>
    <div v-else-if="loading" class="loading-inline">
      <div class="spinner small"></div>
      <span>Loading requisition…</span>
    </div>

    <template v-else-if="requisition">
      <!-- Edit mode: show form -->
      <div v-if="editing" class="edit-panel no-print">
        <RequisitionForm
          :requisition="requisition"
          @updated="handleUpdated"
          @cancel="editing = false"
        />
      </div>

      <!-- Read-only detail -->
      <div v-else class="detail-container-outer">

        <div class="detail-content">
          <!-- Rejection Alert Banner (Visible on Screen) -->
          <div
            v-if="requisition.status === REQUISITION_STATUS.REJECTED"
            class="rejection-card no-print"
          >
            <div class="rejection-main">
              <div class="rejection-icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div class="rejection-details">
                <h3>Requisition Rejected</h3>
                <p>
                  This request was declined by <strong>{{ requisition.rejectedBy?.name || 'Authorized Personnel' }}</strong>
                  <span v-if="requisition.rejectedBy?.signedAt" class="rejection-time">
                    on {{ formatDate(requisition.rejectedBy?.signedAt) }}
                  </span>
                </p>
              </div>
            </div>
            <div v-if="requisition.rejectedBy?.remarks" class="rejection-reason-callout">
              <div class="reason-label">REASON FOR REJECTION:</div>
              <p class="reason-text">"{{ requisition.rejectedBy?.remarks }}"</p>
            </div>
          </div>

          <template v-if="printMode === 'fm-pur-05'">
            <!-- Requisition Form (FM-PUR-05) always shown when printing -->
            <div class="form-document form-container">
              <div v-for="i in 2" :key="i" class="print-page-wrapper" :class="{ 'print-only-copy': i === 2 }">
                <div class="print-page">
                  <div class="copy-label no-print-screen">COPY {{ i }} ({{ i === 1 ? 'Original' : 'Duplicate' }})</div>
                  <!-- Unified Form Table (Header + Items) -->
                  <table class="form-unified-table">
                    <!-- Header Section -->
                    <thead>
                      <tr>
                        <td colspan="6" class="header-cell">
                          <div class="header-content">
                            <div class="logo-box">
                              <img class="logo" src="@/assets/logos.png" alt="Leyeco III" />
                            </div>
                            <div class="header-text-box">
                              <h2 class="company-name">LEYTE III ELECTRIC COOPERATIVE INC.</h2>
                              <h1 class="form-title">REQUISITION FORM</h1>
                            </div>
                          </div>
                        </td>
                      </tr>
                      <!-- Info Section: Date (Left) and RF Control No (Right) -->
                      <tr>
                        <td colspan="3" class="info-cell">
                          <span class="info-label">Date:</span>
                          <span class="info-val">{{ formatDate(requisition.date) }}</span>
                        </td>
                        <td colspan="3" class="info-cell" style="text-align: right">
                          <span class="info-label">RF Control No.:</span>
                          <span class="info-val">{{ requisition.rfControlNo || '—' }}</span>
                        </td>
                      </tr>
                      <!-- Department Section -->
                      <tr>
                        <td colspan="6" class="dept-cell">
                          <span class="info-label">Department:</span>
                          <span class="info-val">{{ requisition.department || '—' }}</span>
                        </td>
                      </tr>
                      <!-- Item Headers -->
                      <tr class="item-header-row">
                        <th style="width: 50px">QTY</th>
                        <th style="width: 80px">Unit</th>
                        <th>Description/Specifications</th>
                        <th style="width: 100px">Warehouse Inventory</th>
                        <th style="width: 150px">Remarks</th>
                      </tr>
                    </thead>
                    <!-- Item Body -->
                    <tbody>
                      <tr v-for="(item, idx) in requisition.items || []" :key="idx">
                        <td class="item-cell">{{ item.quantity }}</td>
                        <td class="item-cell">{{ item.unit || '—' }}</td>
                        <td class="item-cell">{{ item.description || '—' }}</td>
                        <td class="item-cell"></td>
                        <td class="item-cell">{{ item.remarks || '—' }}</td>
                      </tr>
                      <!-- Only show the actual requisition items, no extra rows -->
                      <!-- Purpose Row -->
                      <tr class="purpose-row">
                        <td colspan="6">
                          <div class="purpose-content">
                            <strong>Purpose:</strong>
                            <span class="purpose-val">{{ requisition.purpose || '—' }}</span>
                          </div>
                        </td>
                      </tr>
                      <!-- Signature Rows -->
                      <tr class="sig-row">
                        <td colspan="2">
                          <div class="sig-label">Requested by:</div>
                          <div class="sig-name-overlay">
                            <span class="sig-name">{{ requisition.requestedBy?.name || '—' }}</span>
                            <div
                              v-if="sigSrcFor('requestedBy', requisition.requestedBy)"
                              class="sig-image-wrap"
                            >
                              <img
                                :src="sigSrcFor('requestedBy', requisition.requestedBy)"
                                alt="Requestor signature"
                                class="sig-image"
                              />
                            </div>
                          </div>
                          <div class="sig-line"></div>
                          <div class="sig-sub">Name & Signature</div>
                        </td>

                        <td colspan="2">
                          <div class="sig-label">Recommending Approval:</div>
                          <div class="sig-name-overlay">
                            <span
                              class="sig-name"
                              :class="{
                                'override-name': sigMap['recommendingApproval']?.isOverride,
                                'assigned-name':
                                  !requisition.recommendingApproval?.name &&
                                  requisition.assignedApproverName,
                              }"
                            >
                              {{
                                requisition.recommendingApproval?.name ||
                                requisition.assignedApproverName ||
                                '—'
                              }}
                            </span>
                            <div
                              v-if="sigMap['recommendingApproval']?.isOverride"
                              class="admin-override-seal"
                            >
                              ADMIN OVERRIDE
                            </div>
                            <div
                              v-else-if="
                                sigSrcFor('recommendingApproval', requisition.recommendingApproval)
                              "
                              class="sig-image-wrap"
                            >
                              <img
                                :src="
                                  sigSrcFor(
                                    'recommendingApproval',
                                    requisition.recommendingApproval,
                                  )
                                "
                                alt="Signature"
                                class="sig-image"
                              />
                            </div>
                          </div>
                          <div class="sig-line"></div>
                          <div class="sig-sub">Section Head / Manager / Supervisor</div>
                        </td>

                        <td colspan="2">
                          <div class="sig-label">Inventory Checked:</div>
                          <div class="sig-name-overlay">
                            <span
                              class="sig-name"
                              :class="{ 'override-name': sigMap['inventoryChecked']?.isOverride }"
                            >
                              {{ requisition.inventoryChecked?.name || '—' }}
                            </span>
                            <div
                              v-if="sigMap['inventoryChecked']?.isOverride"
                              class="admin-override-seal"
                            >
                              ADMIN OVERRIDE
                            </div>
                            <div
                              v-else-if="
                                sigSrcFor('inventoryChecked', requisition.inventoryChecked)
                              "
                              class="sig-image-wrap"
                            >
                              <img
                                :src="sigSrcFor('inventoryChecked', requisition.inventoryChecked)"
                                alt="Signature"
                                class="sig-image"
                              />
                            </div>
                          </div>
                          <div class="sig-line"></div>
                          <div class="sig-sub">Warehouse Section Head</div>
                        </td>
                      </tr>

                      <tr class="sig-row">
                        <td colspan="2">
                          <div class="sig-label">Budget Approved:</div>
                          <div class="sig-name-overlay">
                            <span
                              class="sig-name"
                              :class="{ 'override-name': sigMap['budgetApproved']?.isOverride }"
                            >
                              {{ requisition.budgetApproved?.name || '—' }}
                            </span>
                            <div
                              v-if="sigMap['budgetApproved']?.isOverride"
                              class="admin-override-seal"
                            >
                              ADMIN OVERRIDE
                            </div>
                            <div
                              v-else-if="sigSrcFor('budgetApproved', requisition.budgetApproved)"
                              class="sig-image-wrap"
                            >
                              <img
                                :src="sigSrcFor('budgetApproved', requisition.budgetApproved)"
                                alt="Signature"
                                class="sig-image"
                              />
                            </div>
                          </div>
                          <div class="sig-line"></div>
                          <div class="sig-sub">Acctg. Div. Supervisor / Budget Officer</div>
                        </td>

                        <td colspan="2">
                          <div class="sig-label">Checked by:</div>
                          <div class="sig-name-overlay">
                            <span
                              class="sig-name"
                              :class="{ 'override-name': sigMap['checkedBy']?.isOverride }"
                            >
                              {{ requisition.checkedBy?.name || '—' }}
                            </span>
                            <div v-if="sigMap['checkedBy']?.isOverride" class="admin-override-seal">
                              ADMIN OVERRIDE
                            </div>
                            <div
                              v-else-if="sigSrcFor('checkedBy', requisition.checkedBy)"
                              class="sig-image-wrap"
                            >
                              <img
                                :src="sigSrcFor('checkedBy', requisition.checkedBy)"
                                alt="Signature"
                                class="sig-image"
                              />
                            </div>
                          </div>
                          <div class="sig-line"></div>
                          <div class="sig-sub">Internal Auditor</div>
                        </td>

                        <td colspan="2">
                          <div class="sig-label">Approved By:</div>
                          <div class="sig-name-overlay">
                            <span
                              class="sig-name"
                              :class="{ 'override-name': sigMap['approvedBy']?.isOverride }"
                            >
                              {{ requisition.approvedBy?.name || '—' }}
                            </span>
                            <div
                              v-if="sigMap['approvedBy']?.isOverride"
                              class="admin-override-seal"
                            >
                              ADMIN OVERRIDE
                            </div>
                            <div
                              v-else-if="sigSrcFor('approvedBy', requisition.approvedBy)"
                              class="sig-image-wrap"
                            >
                              <img
                                :src="sigSrcFor('approvedBy', requisition.approvedBy)"
                                alt="Signature"
                                class="sig-image"
                              />
                            </div>
                          </div>
                          <div class="sig-line"></div>
                          <div class="sig-sub">General Manager</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div class="footer">
                    <div
                      class="footer-item"
                      style="font-style: italic; color: #555; font-size: 10px"
                    >
                      Generated: {{ new Date().toLocaleString() }}
                    </div>
                  </div>
                </div>
                <!-- Separator between copies - only if they fit on the same page -->
                <div v-if="i === 1 && !isLongForm" class="print-separator-gap no-print-screen"></div>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="screen-view">
              <header class="detail-header">
                <div class="detail-header-inner">
                  <div class="detail-header-text">
                    <p class="detail-subtitle">Requisition details</p>
                    <h1 class="detail-title">
                      Requisition {{ requisition.rfControlNo || requisition.id }}
                    </h1>
                  </div>
                  <span class="status-badge" :class="requisition.status">{{
                    requisition.status
                  }}</span>
                </div>
              </header>

              <section class="meta-section card-section">
                <h2 class="card-section-title">
                  <span class="card-section-title-text">Details</span>
                </h2>
                <div class="details-grid">
                  <div class="detail-block">
                    <span class="detail-block-label">RF Control No.</span>
                    <span class="detail-block-value">{{ requisition.rfControlNo || '—' }}</span>
                  </div>
                  <div class="detail-block">
                    <span class="detail-block-label">Date</span>
                    <span class="detail-block-value">{{ formatDate(requisition.date) }}</span>
                  </div>
                  <div class="detail-block">
                    <span class="detail-block-label">Department</span>
                    <span class="detail-block-value">{{
                      getDeptAbbreviation(requisition.department)
                    }}</span>
                  </div>
                  <div class="detail-block">
                    <span class="detail-block-label">Target Approver</span>
                    <span class="detail-block-value">{{
                      requisition.assignedApproverName || '—'
                    }}</span>
                  </div>
                </div>
                <div class="detail-block purpose-block">
                  <span class="detail-block-label">Purpose</span>
                  <span class="detail-block-value purpose-value">{{
                    requisition.purpose || '—'
                  }}</span>
                </div>
              </section>


              <section class="items-section card-section">
                <h2 class="card-section-title">
                  <span class="card-section-title-text">Items</span>
                </h2>
                <div class="table-wrap">
                  <table class="items-table">
                    <thead>
                      <tr>
                        <th class="col-num">#</th>
                        <th class="col-qty">Qty</th>
                        <th class="col-unit">Unit</th>
                        <th class="col-desc">Description</th>
                        <th class="col-remarks">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, idx) in requisition.items || []" :key="idx">
                        <td class="col-num">{{ idx + 1 }}</td>
                        <td class="col-qty">{{ item.quantity }}</td>
                        <td class="col-unit">{{ item.unit || '—' }}</td>
                        <td class="col-desc">{{ item.description || '—' }}</td>
                        <td class="col-remarks">{{ item.remarks || '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section class="workflow-section card-section">
                <h2 class="card-section-title">
                  <span class="card-section-title-text">Approval workflow</span>
                </h2>
                <div class="stepper">
                  <div
                    v-for="(entry, idx) in statusLog.entries"
                    :key="idx"
                    class="stepper-item"
                    :class="{
                      done: entry.done && !entry.isRejection,
                      current: entry.current,
                      pending: !entry.done && !entry.current,
                      rejected: entry.isRejection,
                    }"
                  >
                    <div class="stepper-marker">
                      <span class="stepper-dot" aria-hidden="true">
                        <span v-if="entry.done && !entry.isRejection" class="stepper-check">✓</span>
                        <span v-else-if="entry.isRejection" class="stepper-reject">✕</span>
                      </span>
                      <span v-if="idx < statusLog.entries.length - 1" class="stepper-line"></span>
                    </div>
                    <div class="stepper-content">
                      <div class="stepper-step-name">{{ entry.step }}</div>
                      <div class="stepper-step-meta">
                        <template v-if="entry.done">
                          <span class="stepper-by-label">{{
                            entry.isRejection ? 'Rejected by' : 'Approved by'
                          }}</span>
                          <span class="stepper-by">{{ entry.by }}</span>
                          <span v-if="entry.at" class="stepper-at">{{ formatDate(entry.at) }}</span>
                        </template>
                        <template v-else>
                          <span class="stepper-pending-label">Pending</span>
                        </template>
                      </div>
                      <p v-if="entry.remarks" class="stepper-remarks">{{ entry.remarks }}</p>
                    </div>
                  </div>
                </div>
              </section>

              <section
                v-if="(requisition.internalAuditorLog || []).length > 0"
                class="audit-log-section card-section"
              >
                <h2 class="card-section-title">
                  <span class="card-section-title-text">Internal auditor log</span>
                </h2>
                <ul class="audit-log-list">
                  <li
                    v-for="(entry, idx) in requisition.internalAuditorLog"
                    :key="idx"
                    class="audit-log-entry"
                  >
                    <span class="audit-action">{{ entry.action }}</span>
                    <span class="audit-by">{{ entry.name }}</span>
                    <span class="audit-at">{{ formatDate(entry.signedAt) }}</span>
                    <span v-if="entry.remarks" class="audit-remarks">{{ entry.remarks }}</span>
                  </li>
                </ul>
              </section>
            </div>
          </template>


        </div>

        <!-- Actions: sticky bar so button is always visible and clickable -->
        <div
          class="detail-actions no-print"
          v-if="canEditDraft || showApproveDecline || canPrint"
        >

          <template v-if="canEditDraft">
            <button
              type="button"
              class="btn btn-danger"
              :disabled="actionLoading"
              @click="openConfirmDiscard"
              style="display: flex; align-items: center; gap: 8px"
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
                <path d="M3 6h18"></path>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
              </svg>
              Discard Draft
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="actionLoading"
              @click="openConfirmEdit"
            >
              Edit Draft
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="actionLoading"
              @click="openConfirmSubmit"
            >
              Submit for Approval
            </button>
          </template>
          <template v-else-if="showApproveDecline">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="actionLoading"
              @click="openConfirmApprove"
            >
              Approve
            </button>
            <button
              type="button"
              class="btn btn-danger"
              :disabled="actionLoading"
              @click="openDeclineModal"
            >
              Decline
            </button>
          </template>
          <template v-else-if="canPrint">
            <button type="button" class="btn btn-primary btn-print" @click="doPrint">
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
                style="margin-right: 8px"
              >
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              Print / Save as PDF
            </button>
          </template>
        </div>

      </div>
    </template>

    <!-- Loading overlay: spinner + label only, no card -->
    <div v-if="actionLoading" class="loading-overlay" aria-live="polite" aria-busy="true">
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <span class="loading-overlay-text">{{ actionLoadingLabel }}</span>
      </div>
    </div>

    <!-- Confirm: Approve -->
    <div v-if="confirmApproveOpen" class="confirm-overlay" @click.self="closeConfirmApprove">
      <div class="confirm-modal">
        <h3 class="confirm-title">Approve requisition</h3>
        <p class="confirm-message">
          Are you sure you want to approve this requisition? It will move to the next step in the
          workflow.
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
          <button type="button" class="btn btn-secondary" @click="closeConfirmApprove">
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!hasSignature"
            @click="handleApprove"
          >
            Approve
          </button>
        </div>
      </div>
    </div>

    <!-- Confirm: Submit for Approval -->
    <div v-if="confirmSubmitOpen" class="confirm-overlay" @click.self="closeConfirmSubmit">
      <div class="confirm-modal">
        <h3 class="confirm-title">Submit for approval</h3>
        <p class="confirm-message">
          Submit this requisition for approval? It will be sent to Section Head / Manager /
          Supervisor.
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
            <p>You must set up your digital signature in your Profile before submitting.</p>
            <router-link to="/profile" class="profile-link">Go to Profile →</router-link>
          </div>
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary" @click="closeConfirmSubmit">
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!hasSignature"
            @click="handleSubmit"
          >
            Submit
          </button>
        </div>
      </div>
    </div>

    <!-- Confirm: Edit Draft -->
    <div v-if="confirmEditOpen" class="confirm-overlay" @click.self="closeConfirmEdit">
      <div class="confirm-modal">
        <h3 class="confirm-title">Edit draft</h3>
        <p class="confirm-message">
          Switch to edit mode? You can change details and items, then save the draft again.
        </p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary" @click="closeConfirmEdit">Cancel</button>
          <button type="button" class="btn btn-primary" @click="confirmEdit">Edit</button>
        </div>
      </div>
    </div>

    <!-- Confirm: Discard Draft -->
    <div v-if="confirmDiscardOpen" class="confirm-overlay" @click.self="closeConfirmDiscard">
      <div class="confirm-modal">
        <h3 class="confirm-title danger-title">Discard this draft?</h3>
        <p class="confirm-message">
          Are you sure you want to permanently delete this draft? This action cannot be undone and
          all entered information will be lost.
        </p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary" @click="closeConfirmDiscard">
            Go back
          </button>
          <button type="button" class="btn btn-danger" @click="handleDiscardDraft">
            Yes, Discard permanently
          </button>
        </div>
      </div>
    </div>

    <!-- Decline modal -->
    <div v-if="declineModalOpen" class="modal-overlay" @click.self="closeDeclineModal">
      <div class="modal">
        <h3 class="modal-title">Decline Requisition</h3>
        <p class="modal-desc">Provide a reason for declining (required).</p>
        <textarea
          v-model="declineRemarks"
          class="modal-textarea"
          rows="4"
          placeholder="Reason for decline..."
          @input="declineError = ''"
        />
        <p v-if="declineError" class="modal-error">{{ declineError }}</p>
        <div class="modal-actions">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="actionLoading"
            @click="closeDeclineModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-danger"
            :disabled="actionLoading || !declineRemarks.trim()"
            @click="handleDecline"
          >
            Confirm Decline
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.form-unified-table {
  width: 100%;
  border-collapse: collapse;
  border: 1.5px solid #000;
  margin-bottom: 12px;
  font-size: 10.5px; /* Slightly smaller for better fit */
}

.form-unified-table td,
.form-unified-table th {
  border: 1px solid #000;
  padding: 5px;
  vertical-align: middle;
  color: #000; /* Ensure all text is black */
}

/* Header Specifics */
.header-cell {
  padding: 0 !important;
  background: #fff;
  border-bottom: 2px solid #000 !important;
  height: 100%;
}

.header-content {
  display: flex;
  align-items: stretch;
  height: 100%;
  min-height: 55px;
}

.logo-box {
  width: 90px;
  border-right: 3px solid #000;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  flex-shrink: 0;
  height: 100%;
  box-sizing: border-box;
}

.logo {
  max-width: 60px;
  max-height: 50px;
  width: auto;
  height: 50px;
  object-fit: contain;
}

.header-text-box {
  flex: 1;
  text-align: center;
  padding: 3px 5px; /* Further reduced */
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.company-name {
  margin: 0;
  padding-bottom: 1px;
  border-bottom: 1.5px solid #000; /* Replaces divider line for print safety */
  width: 100%;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: #000;
}

/* Removed .divider-line */

.form-title {
  margin: 1px 0 0 0;
  font-size: 16px; /* Slightly smaller title */
  font-weight: 900;
  text-transform: uppercase;
  color: #000;
}

/* Info & Dept Cells */
.info-cell,
.dept-cell {
  padding: 5px 10px !important;
  background: #fff;
}

.info-label {
  font-weight: bold;
  margin-right: 5px;
}

.info-val {
  border-bottom: 1px solid #000;
  padding: 0 5px;
  min-width: 150px;
  display: inline-block;
  font-weight: 700; /* Make header data bold */
  color: #000;
}

/* Item Headers */
/* Item Headers */
.item-header-row th {
  background: #fff; /* Force white background */
  font-weight: 900; /* Extra bold */
  text-align: center;
  padding: 5px;
  color: #000;
  border-bottom: 2px solid #000; /* Distinct header border */
}

.item-cell {
  padding: 5px;
  vertical-align: top;
  font-weight: 600; /* Make data content readable/bolder */
  color: #000;
  font-size: 11px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* Purpose Row */
.purpose-row td {
  padding: 10px !important;
}
.purpose-content {
  display: flex;
  align-items: baseline;
}
.purpose-val {
  flex: 1;
  border-bottom: 1px solid #000;
  margin-left: 5px;
  font-weight: 600; /* Make purpose readable */
  color: #000;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.sig-row td {
  width: 33.33%;
  padding: 4px 8px; /* Further reduced to save vertical space */
  vertical-align: top;
}

.sig-label {
  font-size: 10px;
  font-weight: 700;
  color: #000;
  margin-bottom: 3px;
}

.sig-name {
  font-weight: bold;
  text-align: center;
  color: #000;
  white-space: nowrap;
  font-size: 11px;
}

/* Signature over printed name: name visible, signature overlays it */
.sig-name-overlay {
  position: relative;
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}
.sig-name-overlay .sig-name {
  margin-bottom: 0;
}
.sig-name-overlay .sig-image-wrap {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 28px;
  pointer-events: none;
}
.sig-name-overlay .sig-image {
  max-width: 130px;
  max-height: 40px;
  object-fit: contain;
}

.sig-name.assigned-name {
  color: #64748b;
  font-style: italic;
}

/* 2-Copy Print Styles */
.print-page-wrapper {
  page-break-inside: avoid;
  break-inside: avoid;
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.print-separator-gap {
  height: 0;
  margin: 10mm 0;
  border-top: 2px dashed #94a3b8;
  position: relative;
  width: 100%;
  display: block;
}

.print-separator-gap::after {
  content: '✂ Tear Here';
  position: absolute;
  top: -8px;
  right: 20px;
  background: white;
  padding: 0 10px;
  font-size: 10px;
  color: #94a3b8;
  font-weight: bold;
}

.copy-label {
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 8px;
  text-align: right;
}

.print-separator {
  border-top: 1px dashed #cbd5e1;
  margin: 10px 0;
  width: 100%;
}

@media screen {
  .no-print-screen {
    display: none !important;
  }
}

@media print {
  .no-print {
    display: none !important;
  }
  .print-form-container,
.form-document,
  .form-container {
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    display: block !important;
    background: #fff !important;
  }
}

.sig-line {
  width: 80%;
  margin: 0 auto;
  border-bottom: 1.2px solid #000;
}

.sig-sub {
  font-size: 9px;
  font-style: italic;
  text-align: center;
  color: #444;
  font-weight: 500;
}

/* Print optimization */
@media print {
  .header-wrapper {
    background-color: white;
    box-shadow: none;
  }

  .logo-container {
    box-shadow: none;
  }
}

.detail-view {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 1rem 1.5rem 1.5rem;
  background: #f8fafc;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
}

.detail-toolbar {
  margin-bottom: 1rem;
  flex-shrink: 0;
}

.back-link {
  color: #0369a1;
  text-decoration: none;
  font-size: 0.9375rem;
  font-weight: 500;
}
.back-link:hover {
  text-decoration: underline;
  color: #0c4a6e;
}

.audit-banner {
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.875rem;
  color: #92400e;
}

.error-message {
  padding: 1rem;
  background: #fef2f2;
  border-radius: 8px;
  color: #b91c1c;
}

.loading-state {
  padding: 3rem 2rem;
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
  width: 28px;
  height: 28px;
  border: 3px solid #e2e8f0;
  border-top-color: #0ea5e9;
  border-radius: 50%;
  margin: 0 auto 0.75rem;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.edit-panel {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.detail-content {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.05),
    0 2px 4px -2px rgba(0, 0, 0, 0.05);
  padding: 2rem 2.25rem 2rem;
  flex: 1 1 auto;
  min-height: 0;
}

/* ---- Screen view: workflow / detail (polished) ---- */
.screen-view {
  --detail-accent: #0ea5e9;
  --detail-muted: #64748b;
  --detail-border: #e2e8f0;
  --detail-bg: #f8fafc;
  --detail-card-bg: #ffffff;
}

.detail-header {
  margin-bottom: 1.75rem;
  padding: 1.25rem 1.5rem;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid var(--detail-border);
  border-radius: 12px;
  border-left: 4px solid var(--detail-accent);
}

.detail-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  flex-wrap: wrap;
}

.detail-header-text {
  flex: 1;
  min-width: 0;
}

.detail-subtitle {
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--detail-muted);
}

.detail-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.status-badge {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
  border: 1px solid transparent;
}

.status-badge.draft {
  background: #f1f5f9;
  color: #475569;
  border-color: #e2e8f0;
}
.status-badge.pending_recommendation,
.status-badge.pending_inventory,
.status-badge.pending_budget,
.status-badge.pending_audit,
.status-badge.pending_approval {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}
.status-badge.approved {
  background: #ecfdf5;
  color: #047857;
  border-color: #a7f3d0;
}
.status-badge.rejected {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #fecaca;
}

/* Card sections */
.card-section {
  margin-bottom: 1.5rem;
  padding: 1.5rem 1.75rem;
  background: var(--detail-card-bg);
  border: 1px solid var(--detail-border);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.card-section:last-child {
  margin-bottom: 0;
}

.card-section-title {
  margin: 0 0 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--detail-border);
}

.card-section-title-text {
  font-size: 0.8125rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--detail-muted);
}

/* Details section */
.meta-section {
  padding: 1.5rem 1.75rem;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1.5rem;
}

.detail-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.detail-block-label {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--detail-muted);
}

.detail-block-value {
  font-size: 1rem;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.4;
}

.purpose-block {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--detail-border);
}

.purpose-value {
  font-weight: 500;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* Items section */
.items-section.card-section,
.workflow-section.card-section,
.audit-log-section.card-section {
  margin-bottom: 1.5rem;
}

.table-wrap {
  overflow-x: auto;
  overflow-y: auto;
  border: 1px solid var(--detail-border);
  border-radius: 10px;
  background: var(--detail-bg);
  max-height: 480px;
  scrollbar-gutter: stable;
}

.items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}

.items-table th,
.items-table td {
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid var(--detail-border);
  vertical-align: middle;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.items-table th {
  background: #f1f5f9;
  font-weight: 700;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #475569;
  position: sticky;
  top: 0;
  z-index: 5;
}

.items-table .col-num {
  width: 2.5rem;
  text-align: center;
}
.items-table .col-qty {
  width: 4.5rem;
  text-align: center;
}
.items-table .col-unit {
  width: 8.5rem;
}
.items-table .col-desc {
  min-width: 15rem;
}
.items-table .col-remarks {
  width: 10rem;
}
.items-table tbody tr:hover {
  background: #f8fafc;
}
.items-table tbody tr:last-child td {
  border-bottom: none;
}

/* Stepper workflow - compact and consistent */
.stepper {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.stepper-item {
  display: flex;
  gap: 0;
  align-items: flex-start;
  padding: 0.625rem 0;
  min-height: 0;
}

.stepper-item:last-child .stepper-content {
  padding-bottom: 0;
}

.stepper-item.done {
  border-left: 3px solid #22c55e;
  padding-left: 0.875rem;
}

.stepper-item.current {
  border-left: 3px solid var(--detail-accent);
  padding-left: 0.875rem;
}

.stepper-item.pending {
  border-left: 3px solid #e2e8f0;
  padding-left: 0.875rem;
}

.stepper-marker {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 24px;
  margin-right: 0.875rem;
}

.stepper-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #e2e8f0;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #cbd5e1;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6875rem;
  font-weight: 700;
  color: #fff;
}

.stepper-check {
  line-height: 1;
}

.stepper-item.done .stepper-dot {
  background: #22c55e;
  box-shadow: 0 0 0 1px #22c55e;
}

.stepper-item.current .stepper-dot {
  background: var(--detail-accent);
  box-shadow: 0 0 0 1px var(--detail-accent);
}

.stepper-item.pending .stepper-dot {
  background: #cbd5e1;
  color: transparent;
}

.stepper-line {
  width: 2px;
  flex: 1;
  min-height: 16px;
  margin-top: 4px;
  background: #e2e8f0;
}

.stepper-item.done .stepper-line {
  background: #86efac;
}

.stepper-item.rejected .stepper-dot {
  background: #dc2626;
  box-shadow: 0 0 0 1px #dc2626;
  color: #fff;
}
.stepper-item.rejected .stepper-reject {
  font-size: 0.75rem;
  font-weight: bold;
  line-height: 1;
}
.stepper-item.rejected {
  border-left: 3px solid #dc2626;
  padding-left: 0.875rem;
}

.stepper-content {
  flex: 1;
  padding-bottom: 0;
  min-width: 0;
}

.stepper-step-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: #1e293b;
  margin-bottom: 0.25rem;
  line-height: 1.3;
}

.stepper-item.current .stepper-step-name {
  color: #0369a1;
  font-weight: 700;
}

.stepper-step-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.875rem;
  font-size: 0.8125rem;
}

.stepper-by-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--detail-muted);
}

.stepper-by {
  font-weight: 500;
  color: #334155;
}

.stepper-pending-label {
  font-size: 0.8125rem;
  color: #94a3b8;
  font-style: italic;
}

.stepper-at {
  color: var(--detail-muted);
  font-size: 0.75rem;
}

.stepper-remarks {
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  color: var(--detail-muted);
  line-height: 1.4;
}

.audit-log-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.audit-log-entry {
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--detail-border);
  font-size: 0.875rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: center;
}

.audit-log-entry:last-child {
  border-bottom: none;
}

.audit-action {
  font-weight: 700;
  text-transform: capitalize;
  color: #1e293b;
}
.audit-by {
  color: #475569;
  font-weight: 500;
}
.audit-at {
  color: var(--detail-muted);
  font-size: 0.8125rem;
}
.audit-remarks {
  color: var(--detail-muted);
  width: 100%;
  font-size: 0.8125rem;
}

.detail-actions {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 1rem 0 0.5rem;
  margin-top: 1rem;
  /* Restored sticky behavior but kept background transparent and no border as requested */
  background: transparent;
  flex-shrink: 0;
  z-index: 5;
  pointer-events: none; /* Allow clicks to pass through empty space */
}
.detail-actions > * {
  pointer-events: auto; /* Re-enable clicks on buttons */
}

.btn {
  padding: 0.5rem 1.25rem;
  font-size: 0.9375rem;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.btn-print {
  min-width: 160px;
}

.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-primary {
  background: #0ea5e9;
  color: #fff;
  border-color: #0ea5e9;
}

.btn-primary:hover:not(:disabled) {
  background: #0284c7;
  border-color: #0284c7;
}

.btn-secondary {
  background: #f1f5f9;
  color: #334155;
  border-color: #e2e8f0;
}

.btn-secondary:hover:not(:disabled) {
  background: #e2e8f0;
}

.btn-danger {
  background: #dc2626;
  color: #fff;
  border-color: #dc2626;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
  border-color: #b91c1c;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
  padding: 1.5rem 1.75rem;
  min-width: 320px;
  max-width: 420px;
  border: 1px solid #e2e8f0;
}

.modal-title {
  margin: 0 0 0.5rem;
  font-size: 1.0625rem;
  font-weight: 600;
  color: #0f172a;
}

.modal-desc {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: #64748b;
  line-height: 1.45;
}

.modal-textarea {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-family: inherit;
  margin-bottom: 1rem;
  box-sizing: border-box;
}

.modal-error {
  margin: -0.5rem 0 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #b91c1c;
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

.modal-fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.875rem;
}
.modal-field span {
  color: #64748b;
  font-weight: 500;
}
.modal-input {
  padding: 0.5rem 0.6rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.875rem;
}

/* End of Requisition Detail Styles */

/* Loading overlay: spinner + text only, no white box */
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.875rem;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(14, 165, 233, 0.2);
  border-top-color: #0ea5e9;
  border-radius: 50%;
  animation: loading-spin 0.65s linear infinite;
}

.loading-overlay-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: #475569;
}

@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Confirm modals: clean, minimal */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1050;
  padding: 1rem;
}

.confirm-modal {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
  padding: 1.5rem 1.75rem;
  min-width: 320px;
  max-width: 400px;
  border: 1px solid #e2e8f0;
}

.confirm-title {
  margin: 0 0 0.5rem;
  font-size: 1.0625rem;
  font-weight: 600;
  color: #0f172a;
}

.confirm-message {
  margin: 0 0 1.25rem;
  font-size: 0.875rem;
  color: #64748b;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  flex-wrap: wrap;
}

/* Print form - hidden on screen */
.print-form {
  display: none;
}

/* Requisition Form (FM-PUR-05) layout - Leyeco III official format */
.form-document.form-container {
  font-family: Arial, sans-serif;
  background: #fff;
  max-width: 1000px;
  margin: 0 auto;
}

.form-document .print-page {
  padding: 30px;
  box-sizing: border-box;
}

.form-document .header {
  display: flex;
  align-items: center;
  border-bottom: 2px solid #000;
  padding-bottom: 10px;
  margin-bottom: 20px;
}

.form-document .header .logo {
  width: 80px;
  height: 80px;
  margin-right: 20px;
  flex-shrink: 0;
}

.form-document .header .header-text {
  flex: 1;
  text-align: center;
}

.form-document .header h2 {
  margin: 5px 0;
  font-size: 14px;
  font-weight: normal;
  color: #000;
}

.form-document .header h1 {
  margin: 10px 0;
  font-size: 24px;
  font-weight: bold;
  color: #000;
}

.form-document .form-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0;
  padding: 10px 20px;
  border-bottom: 2px solid #000;
  border-top: 2px solid #000; /* Add top border to connect to header */
  margin-top: -2px; /* Overlap with header border */
  color: #000;
}

.form-document .form-info label {
  font-weight: bold;
  margin-right: 10px;
  color: #000;
}

.form-document .form-info-val {
  border-bottom: 1px solid #000;
  padding: 2px 5px;
  color: #000;
}

.form-document .form-dept {
  margin-bottom: 0;
  padding: 10px 20px;
  border-bottom: 2px solid #000;
  color: #000;
}

.form-document .form-dept label {
  font-weight: bold;
  margin-right: 10px;
  color: #000;
}

.form-document .form-dept-val {
  border-bottom: 1px solid #000;
  padding: 2px 5px;
  display: inline-block;
  min-width: 300px;
  color: #000;
}

/* Removed .form-document .form-items-table as it is replaced by .form-unified-table */

.form-document .form-items-table,
.form-document .form-items-table th,
.form-document .form-items-table td {
  border: 1px solid #000;
}

.form-document .form-items-table th,
.form-document .form-items-table td {
  padding: 8px;
  text-align: left;
  color: #000;
}

.form-document .form-items-table th {
  background: #f0f0f0;
  font-weight: bold;
  font-size: 12px;
  color: #000;
}

.form-document .purpose-row td {
  padding: 8px;
  color: #000;
}

.form-document .purpose-val {
  margin-left: 10px;
  color: #000;
}

.form-document .sig-row td {
  padding: 10px;
  vertical-align: top;
  width: 33.33%;
  color: #000;
}

.form-document .sig-label {
  font-size: 11px;
  margin-bottom: 3px;
  color: #000;
}

.form-document .sig-space {
  height: 20px;
}

.form-document .sig-name {
  font-weight: bold;
  text-align: center;
  color: #000;
}

.form-document .sig-name-overlay {
  position: relative;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.admin-override-seal {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-12deg);
  border: 2px double #0ea5e9;
  color: #0ea5e9;
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 0.65rem;
  padding: 2px 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.9);
  pointer-events: none;
  z-index: 10;
  border-radius: 2px;
}

.override-name {
  color: #64748b !important;
  font-style: italic;
  opacity: 0.7;
}
.form-document .sig-name-overlay .sig-image-wrap {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 28px;
}
.form-document .sig-name-overlay .sig-image {
  max-width: 140px;
  max-height: 32px;
  object-fit: contain;
}

.form-document .sig-title {
  font-size: 10px;
  text-align: center;
  color: #000;
  margin-top: 1px;
}

.form-document .sig-date {
  font-size: 9px;
  text-align: center;
  color: #000;
  margin-top: 1px;
}

.form-document .sig-sub {
  font-size: 10px;
  font-style: italic;
  text-align: center;
  margin-top: 2px;
  color: #000;
}

.form-document .footer {
  display: flex;
  justify-content: space-between;
  margin-top: 20px;
  font-size: 11px;
  color: #000;
}
.form-document .footer-item {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}
.form-document .footer-label {
  font-size: 10px;
  color: #000;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.detail-toolbar {
  padding: 1.25rem 2rem;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.toolbar-left {
  flex: 1;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.print-toggle {
  display: flex;
  background: #f1f5f9;
  padding: 0.25rem;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
}

.toggle-btn {
  padding: 0.5rem 1rem;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.toggle-btn:hover {
  color: #1e293b;
}

.toggle-btn.active {
  background: white;
  color: #0ea5e9;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.btn-print {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  background: #0ea5e9;
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-print:hover {
  background: #0284c7;
}

.btn-print .icon {
  font-size: 1.125rem;
}

/* Hide the second copy and copy labels on the screen */
.print-only-copy,
.no-print-screen {
  display: none;
}
</style>

<style>
/**
 * GLOBAL PRINT OVERRIDES
 * Moved to non-scoped style to ensure it hits body, html, and container root perfectly.
 */
@media print {
  /* 
     Aggressive Normalization: Remove all heights and overflows 
     to let the browser handle natural paging for the 2-copy logic.
  */
  html,
  body,
  #app,
  .layout,
  .main-content,
  .main,
  .main-page,
  .app-content,
  .detail-view,
  .detail-container-outer,
  .form-container,
  .detail-content {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    display: block !important;
    position: static !important;
    margin: 0 !important;
    padding: 0 !important;
    transform: none !important;
    width: 100% !important;
    background: #ffffff !important;
  }

  /* Force display:block on the wrapper to allow natural stacking */
  .print-page-wrapper {
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    /* Smart avoidance: If the form doesn't fit on the current page, it will jump to the next one */
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }

  .print-only-copy {
    display: block !important;
    margin-top: 2mm !important; /* Extremely tight margin for paper saving */
    border: none !important;
  }

  /* Hide navigation elements from print */
  .sidebar,
  .header {
    display: none !important;
  }

  .form-document .print-page {
    width: 100% !important;
    padding: 3mm 5mm !important;
    margin: 0 !important;
    background: #fff !important;
    box-sizing: border-box !important;
  }

  .no-print-screen {
    display: block !important;
    visibility: visible !important;
  }

  .copy-label {
    color: #444 !important;
    font-weight: 900 !important;
    margin-bottom: 2px !important;
    text-transform: uppercase;
    font-size: 10px;
  }

  @page {
    size: A4;
    margin: 8mm 5mm;
  }
}

.status-badge.bac-processing {
  background: #fef9c3;
  color: #854d0e;
}

.status-badge.rejected {
  background: #fee2e2;
  color: #991b1b;
}

/* Rejection Banner */
/* Rejection Card Premium Styling */
.rejection-card {
  margin-bottom: 2rem;
  background: #fff5f5;
  border: 1px solid #fee2e2;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 10px 15px -3px rgba(220, 38, 38, 0.1);
  animation: slideDown 0.4s ease-out;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.rejection-main {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 1.5rem;
  background: linear-gradient(to right, #fee2e2, #fff5f5);
  border-bottom: 1px solid #fee2e2;
}

.rejection-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  background: #ef4444;
  color: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(239, 68, 68, 0.3);
}

.rejection-details h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 800;
  color: #991b1b;
  letter-spacing: -0.01em;
}

.rejection-details p {
  margin: 0.25rem 0 0 0;
  font-size: 0.9375rem;
  color: #b91c1c;
}

.rejection-time {
  margin-left: 0.5rem;
  font-size: 0.8125rem;
  opacity: 0.8;
}

.rejection-reason-callout {
  padding: 1.25rem 1.5rem;
  background: white;
}

.reason-label {
  font-size: 0.6875rem;
  font-weight: 800;
  color: #ef4444;
  letter-spacing: 0.1em;
  margin-bottom: 0.5rem;
}

.reason-text {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.5;
  font-style: italic;
}

/* Stepper Remarks as Sticky Note */
.stepper-remarks {
  margin-top: 1rem !important;
  padding: 1rem 1.25rem !important;
  background: #fff9c4 !important; /* Yellow Sticky Note */
  border-radius: 2px 2px 15px 2px !important;
  font-size: 0.9375rem !important;
  color: #5d4037 !important;
  position: relative;
  box-shadow: 3px 3px 10px rgba(0,0,0,0.1) !important;
  transform: rotate(-0.5deg);
  display: inline-block;
  max-width: 90%;
  border: 1px solid #fbc02d !important;
}

.stepper-remarks::before {
  content: 'Reason:';
  display: block;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  color: #af8905;
  margin-bottom: 4px;
}

.rejected .stepper-remarks {
  background: #fee2e2 !important; /* Pink for Rejection note */
  border-color: #fecaca !important;
  color: #991b1b !important;
  transform: rotate(0.5deg);
}

.rejected .stepper-remarks::before {
  color: #dc2626;
}

/* Receiving Info Section Styles */
.receiving-info-section {
  background: #f0fdf4;
  border: 1px solid #dcfce7;
  border-left: 5px solid #22c55e;
}

.receiving-info-section .card-section-title-text {
  color: #166534;
}

.receiving-info-section .detail-block-label {
  color: #15803d;
}

.text-success {
  color: #166534;
  font-weight: 700;
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

.confirm-actions .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Form Modal specific */
.co-modal-card {
  max-width: 600px;
}
.required-star {
  color: #ef4444;
}
.auto-badge {
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 0.65rem;
  padding: 1px 4px;
  border-radius: 4px;
  margin-left: 4px;
}
.modal-divider {
  font-size: 0.75rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 1.5rem 0 0.75rem;
}
.modal-table-wrap {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 1rem;
}
.modal-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}
.modal-table th {
  background: #f8fafc;
  padding: 0.625rem;
  text-align: left;
  color: #64748b;
  border-bottom: 1px solid #e2e8f0;
}
.modal-table td {
  padding: 0.5rem 0.625rem;
  border-bottom: 1px solid #f1f5f9;
}
.td-desc {
  font-weight: 500;
  color: #1e293b;
}
.td-center {
  text-align: center;
  color: #64748b;
}
.cell-input {
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.8125rem;
}
.text-right {
  text-align: right;
}

/* Quote Grid for Detail View */
.hub-quote-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin: 1rem 0;
}

.hub-quote-slot {
  aspect-ratio: 4 / 3;
  border: 2px dashed #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  background: #f8fafc;
  transition: all 0.2s;
}
.hub-quote-slot:hover {
  border-color: #2563eb;
  background: #f1f5f9;
}

.hub-quote-placeholder {
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
.hub-quote-placeholder svg {
  opacity: 0.5;
}

.hub-quote-preview-wrap {
  width: 100%;
  height: 100%;
  position: relative;
}
.hub-quote-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hub-quote-remove {
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
.hub-quote-remove:hover {
  background: #ef4444;
}
.hub-quote-name {
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

/* Attached Quotes Styling */
.attached-quotes-section {
  margin: 2rem 0;
  padding: 1.5rem;
  background: white;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
}

.quotes-header {
  margin-bottom: 1.5rem;
}



.text-success {
  color: #10b981;
  font-weight: 600;
}
</style>
