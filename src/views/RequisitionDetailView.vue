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
  markRequisitionOrdered,
  markRequisitionReceived,
  markRequisitionCanvassed,
  getPOStatusLog,
  deleteRequisition,
  generateCanvassNo,
} from '@/services/requisitionService'
import { getDeptAbbreviation } from '@/utils/deptUtils'
import {
  REQUISITION_STATUS,
  USER_ROLES,
  PURCHASE_STATUS,
  CANVASS_STATUS,
  PO_STATUS,
} from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'
import RequisitionForm from '@/components/RequisitionForm.vue'
import PBACForm01 from '@/components/PBACForm01.vue'
import PurchaseOrder from '@/components/PurchaseOrder.vue'

const printMode = ref('fm-pur-05') // 'fm-pur-05', 'pbac-form-01', or 'purchase-order'
const activeTab = ref('overview') // 'overview' or 'documents'

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
const purchaseOrderedModal = ref(false)
const purchaseReceivedModal = ref(false)
const purchasePoNumber = ref('')
const purchaseOrderedAt = ref('')
const purchaseReceivedAt = ref('')
const purchaseActionLoading = ref(false)
const purchaseActionError = ref('')
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
const poStatusLog = computed(() => getPOStatusLog(requisition.value))

const backLabel = computed(() => {
  if (from.value === 'my-requisitions') return 'Back to My Requisitions'
  if (from.value === 'purchase-list') return 'Back to Approved for Purchase'
  if (from.value === 'canvass-orders') return 'Back to Canvass Orders'
  if (from.value === 'bac-dashboard') return 'Back to BAC Dashboard'
  if (from.value === 'audit-log') return 'Back to Logs'
  if (from.value === 'archive') return 'Back to Archive'
  if (from.value === 'po-approvals') return 'Back to PO Approvals'
  if (from.value === 'procurement-hub') return 'Back to Procurement Hub'
  if (from.value === 'admin-requisitions') return 'Back to Admin Requisitions'
  return 'Back to list'
})

const backPath = computed(() => {
  if (from.value === 'my-requisitions') return '/my-requisitions'
  if (from.value === 'purchase-list') return '/purchase-list'
  if (from.value === 'canvass-orders') return '/canvass-orders'
  if (from.value === 'bac-dashboard') return '/bac-dashboard'
  if (from.value === 'audit-log') return '/audit-log'
  if (from.value === 'archive') return '/archive'
  if (from.value === 'po-approvals') return '/po-approvals'
  if (from.value === 'procurement-hub') {
    const tab = route.query.tab
    return tab ? `/procurement-hub?tab=${tab}` : '/procurement-hub'
  }
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

const approverRole = computed(() => authStore?.role)

const showApproveDecline = computed(() => {
  const r = requisition.value
  if (!r) return false
  return canUserApprove(approverRole.value, r.status)
})

const isProcurementStaff = computed(() => {
  return authStore?.role === USER_ROLES.PURCHASER || authStore?.role === USER_ROLES.BAC_SECRETARY
})

const isPurchaser = computed(() => authStore?.role === USER_ROLES.PURCHASER)
const isAdmin = computed(() => authStore?.role === USER_ROLES.SUPER_ADMIN)
const hasSignature = computed(() => !!authStore.userProfile?.signatureData)

const isPOApprover = computed(() => {
  return (
    authStore?.role === USER_ROLES.BUDGET_OFFICER ||
    authStore?.role === USER_ROLES.INTERNAL_AUDITOR ||
    authStore?.role === USER_ROLES.GENERAL_MANAGER
  )
})

const showProcurementDashboard = computed(() => {
  const r = requisition.value
  if (!r || r.status === REQUISITION_STATUS.DRAFT) return false
  return true
})

const canViewCanvass = computed(() => {
  const r = requisition.value
  if (!r || r.status !== REQUISITION_STATUS.APPROVED) return false
  return isProcurementStaff.value || isPOApprover.value || isAdmin.value || isRequestor.value
})

const canViewPO = computed(() => {
  const r = requisition.value
  if (!r || r.status !== REQUISITION_STATUS.APPROVED) return false
  // Procurement, Approvers and Admins can always see it if it exists
  if (isProcurementStaff.value || isPOApprover.value || isAdmin.value) return !!r.poStatus
  // Requestors can only see it when fully approved
  if (isRequestor.value) return r.poStatus === PO_STATUS.APPROVED
  return false
})

const purchaseStatusDisplay = computed(
  () => requisition.value?.purchaseStatus || PURCHASE_STATUS.PENDING,
)

const canvassStatusDisplay = computed(
  () => requisition.value?.canvassStatus || CANVASS_STATUS.PENDING,
)

const purchaseStatusLabel = {
  [PURCHASE_STATUS.PENDING]: 'Pending',
  [PURCHASE_STATUS.ORDERED]: 'Ordered',
  [PURCHASE_STATUS.RECEIVED]: 'Received',
}

const canvassStatusLabel = {
  [CANVASS_STATUS.PENDING]: 'Pending',
  [CANVASS_STATUS.ORDER_CREATED]: 'Order Created',
  [CANVASS_STATUS.SUBMITTED_TO_BAC]: 'Submitted to BAC',
}

const unifiedProcurementStage = computed(() => {
  const r = requisition.value
  if (!r || r.status !== REQUISITION_STATUS.APPROVED)
    return { label: 'Awaiting Hub', class: 'pending' }

  if (r.purchaseStatus === PURCHASE_STATUS.RECEIVED) {
    return { label: 'Complete: Received', class: 'received' }
  }
  if (r.purchaseStatus === PURCHASE_STATUS.ORDERED) {
    return { label: 'Step 3: Items Ordered (For Receiving)', class: 'ordered' }
  }
  if (r.canvassStatus === CANVASS_STATUS.SUBMITTED_TO_BAC) {
    if (r.poStatus === PO_STATUS.REJECTED) {
      return { label: 'Returned for Correction (BAC)', class: 'rejected' }
    }
    return { label: 'Step 2: PO Issued (Pending Approval)', class: 'bac-processing' }
  }
  return { label: 'Step 1: Needs Canvassing', class: 'pending' }
})

/**
 * Smart Break Logic:
 * If the form is "long" (many items or long purpose), the 2nd copy
 * should always start on a new page to avoid awkward splitting.
 */
const isLongForm = computed(() => {
  const r = requisition.value
  if (!r) return false
  const itemsCount = (r.items || []).length
  const purposeLength = (r.purpose || '').length
  // Threshold: > 5 items or significant purpose text
  return itemsCount > 5 || purposeLength > 150
})

const computedPoTotalAmount = computed(() => {
  const r = requisition.value
  if (!r || !r.items) return 0
  const subTotal = r.items.reduce((sum, item) => sum + item.quantity * (item.unitPrice || 0), 0)
  return subTotal * 1.12 // Add 12% VAT to match PurchaseOrder.vue
})

const canvassModalOpen = ref(false)
const canvassNumber = ref('')
const canvassDate = ref('')
const supplier = ref('')
const canvassItems = ref([])
const canvassActionLoading = ref(false)
const canvassActionError = ref('')

const milestones = computed(() => {
  const r = requisition.value
  if (!r) return []

  const isApproved = r.status === REQUISITION_STATUS.APPROVED
  const isCanvassed =
    r.canvassStatus === CANVASS_STATUS.ORDER_CREATED ||
    r.canvassStatus === CANVASS_STATUS.SUBMITTED_TO_BAC
  const isOrdered =
    r.purchaseStatus === PURCHASE_STATUS.ORDERED || r.purchaseStatus === PURCHASE_STATUS.RECEIVED
  const isReceived = r.purchaseStatus === PURCHASE_STATUS.RECEIVED

  // Cumulative logic: if a later step is done, earlier steps are also marked done
  const stepApprovedDone = isApproved || isCanvassed || isOrdered || isReceived
  const stepCanvassedDone = isCanvassed || isOrdered || isReceived
  const stepPoIssuedDone = isOrdered || isReceived
  const stepOrderedDone = stepPoIssuedDone // Alias for clarity in current checks
  const stepReceivedDone = isReceived

  return [
    {
      id: 'approved',
      label: 'Approved',
      done: stepApprovedDone,
      current: stepApprovedDone && !stepCanvassedDone,
    },
    {
      id: 'canvassed',
      label: 'Canvassed',
      done: stepCanvassedDone,
      current: stepCanvassedDone && !stepOrderedDone,
    },
    {
      id: 'po_issued',
      label: 'PO Issued',
      done: isOrdered || isReceived,
      current:
        (isCanvassed && !isOrdered) ||
        (r.canvassStatus === CANVASS_STATUS.SUBMITTED_TO_BAC && !isOrdered),
    },
    {
      id: 'received',
      label: 'Received',
      done: stepReceivedDone,
      current: false, // Final state handled by done
    },
  ]
})

const nextActionPrompt = computed(() => {
  const r = requisition.value
  if (!r || r.status !== REQUISITION_STATUS.APPROVED) return null

  if (r.canvassStatus === CANVASS_STATUS.PENDING) {
    return 'The next step is "Needs Canvassing" in the Procurement Hub. Please log the supplier details below.'
  }
  if (r.purchaseStatus === PURCHASE_STATUS.PENDING) {
    return 'Canvass recorded. Requisition is now in "PO Tracking" at the Procurement Hub while BAC/GM approves the order.'
  }
  if (r.purchaseStatus === PURCHASE_STATUS.ORDERED) {
    return 'The PO has been approved and issued to the supplier! Mark items as received once they arrive.'
  }
  if (r.purchaseStatus === PURCHASE_STATUS.RECEIVED) {
    return 'Complete: All items have been officially received.'
  }
  return null
})

function openCanvassModal() {
  const r = requisition.value
  canvassNumber.value = r?.canvassNumber || ''
  // Auto-generate canvass number if missing
  if (!canvassNumber.value) {
    generateCanvassNo()
      .then((no) => (canvassNumber.value = no))
      .catch(() => (canvassNumber.value = ''))
  }
  canvassDate.value = r?.canvassDate
    ? (r.canvassDate?.toDate ? r.canvassDate.toDate() : new Date(r.canvassDate))
        .toISOString()
        .slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  supplier.value = r?.supplier || ''
  canvassItems.value = (r?.items || []).map((item) => ({ ...item }))
  canvassActionError.value = ''
  canvassModalOpen.value = true
}

function closeCanvassModal() {
  canvassModalOpen.value = false
  canvassActionError.value = ''
}

async function saveCanvassOrder() {
  if (!requisition.value?.id) return
  if (!hasSignature.value) {
    canvassActionError.value = 'Missing digital signature. Please set it up in your Profile.'
    return
  }
  if (!supplier.value.trim()) {
    canvassActionError.value = 'Please enter the winning supplier.'
    return
  }
  canvassActionLoading.value = true
  canvassActionError.value = ''
  try {
    const user = authStore.user
    await markRequisitionCanvassed(requisition.value.id, {
      canvassNumber: canvassNumber.value.trim() || undefined,
      canvassDate: canvassDate.value ? new Date(canvassDate.value + 'T12:00:00') : new Date(),
      canvassBy: user
        ? { userId: user.uid, name: authStore?.displayName, email: user.email }
        : null,
      supplier: supplier.value.trim(),
      items: canvassItems.value,
      signatureData: authStore.userProfile?.signatureData,
    })
    closeCanvassModal()
  } catch (e) {
    canvassActionError.value = e?.message || 'Failed to record canvass order.'
  } finally {
    canvassActionLoading.value = false
  }
}

function openPurchaseOrderedModal() {
  const r = requisition.value
  purchasePoNumber.value = r?.poNumber || ''
  purchaseOrderedAt.value = r?.orderedAt
    ? (r.orderedAt?.toDate ? r.orderedAt.toDate() : new Date(r.orderedAt))
        .toISOString()
        .slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  purchaseActionError.value = ''
  purchaseOrderedModal.value = true
}
function closePurchaseOrderedModal() {
  purchaseOrderedModal.value = false
  purchaseActionError.value = ''
}
async function savePurchaseOrdered() {
  if (!requisition.value?.id) return
  purchaseActionLoading.value = true
  purchaseActionError.value = ''
  try {
    const user = authStore.user
    await markRequisitionOrdered(requisition.value.id, {
      poNumber: purchasePoNumber.value.trim() || undefined,
      orderedAt: purchaseOrderedAt.value
        ? new Date(purchaseOrderedAt.value + 'T12:00:00')
        : new Date(),
      orderedBy: user
        ? { userId: user.uid, name: authStore?.displayName, email: user.email }
        : null,
      signatureData: authStore.userProfile?.signatureData,
    })
    closePurchaseOrderedModal()
  } catch (e) {
    purchaseActionError.value = e?.message || 'Failed to mark as ordered.'
  } finally {
    purchaseActionLoading.value = false
  }
}

function openPurchaseReceivedModal() {
  const r = requisition.value
  purchaseReceivedAt.value = r?.receivedAt
    ? (r.receivedAt?.toDate ? r.receivedAt.toDate() : new Date(r.receivedAt))
        .toISOString()
        .slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  purchaseActionError.value = ''
  purchaseReceivedModal.value = true
}
function closePurchaseReceivedModal() {
  purchaseReceivedModal.value = false
  purchaseActionError.value = ''
}
async function savePurchaseReceived() {
  if (!requisition.value?.id) return
  purchaseActionLoading.value = true
  purchaseActionError.value = ''
  try {
    const user = authStore.user
    await markRequisitionReceived(requisition.value.id, {
      receivedAt: purchaseReceivedAt.value
        ? new Date(purchaseReceivedAt.value + 'T12:00:00')
        : new Date(),
      receivedBy: user
        ? { userId: user.uid, name: authStore?.displayName, email: user.email }
        : null,
      signatureData: authStore.userProfile?.signatureData,
    })
    closePurchaseReceivedModal()
  } catch (e) {
    purchaseActionError.value = e?.message || 'Failed to mark as received.'
  } finally {
    purchaseActionLoading.value = false
  }
}

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

function setPrintMode(mode) {
  if (mode === 'pbac-form-01' && !canViewCanvass.value) return
  if (mode === 'purchase-order' && !canViewPO.value) return
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

    // Contextual Defaults:
    // If we're coming from PO Approvals, default to Overview and PO Print Mode (if permitted)
    if (
      (from.value === 'po-approvals' || (!!r.poStatus && showProcurementDashboard.value)) &&
      canViewPO.value
    ) {
      printMode.value = 'purchase-order'
    } else {
      // Ensure we don't land on a restricted form by default
      printMode.value = 'fm-pur-05'
    }
  })

  // Subscribe to separate signatures (so Purchaser can print without bloating requisition doc).
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

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (unsubscribeSigs) unsubscribeSigs()
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
        <!-- Dashboard Header: Only for approved requisitions processed by Procurement -->
        <div v-if="showProcurementDashboard" class="procurement-dashboard-header no-print">
          <div v-if="!requisition.poStatus" class="procurement-tracker">
            <div
              v-for="(milestone, idx) in milestones"
              :key="milestone.id"
              :class="['milestone', { done: milestone.done, current: milestone.current }]"
            >
              <div class="milestone-marker">
                <span class="milestone-dot">
                  <span v-if="milestone.done">✓</span>
                </span>
                <div v-if="idx < milestones.length - 1" class="milestone-line"></div>
              </div>
              <span class="milestone-label">{{ milestone.label }}</span>
            </div>
          </div>

          <!-- PO Approval Tracker (only when PO exists) -->
          <div v-else class="procurement-tracker po-tracker">
            <div
              v-for="(step, idx) in poStatusLog.entries"
              :key="idx"
              :class="['milestone', { done: step.done, current: step.current }]"
            >
              <div class="milestone-marker">
                <span class="milestone-dot">
                  <span v-if="step.done">✓</span>
                </span>
                <div v-if="idx < poStatusLog.entries.length - 1" class="milestone-line"></div>
              </div>
              <span class="milestone-label">{{ step.step }}</span>
            </div>
          </div>

          <div class="dashboard-controls">
            <div class="dashboard-tabs">
              <button
                type="button"
                :class="['dash-tab', { active: activeTab === 'overview' }]"
                @click="activeTab = 'overview'"
              >
                Overview
              </button>
              <button
                type="button"
                :class="['dash-tab', { active: activeTab === 'documents' }]"
                @click="activeTab = 'documents'"
              >
                Official Documents
              </button>
            </div>

            <!-- Unified Workflow Card -->
            <div class="workflow-card">
              <div class="workflow-status-groups">
                <div class="status-group">
                  <span class="status-group-label">Current Procurement Stage:</span>
                  <span :class="['purchase-status-badge', unifiedProcurementStage.class]">{{
                    unifiedProcurementStage.label
                  }}</span>
                </div>
              </div>

              <div v-if="nextActionPrompt" class="workflow-guidance">
                <span class="guidance-icon">ℹ️</span>
                <span class="guidance-text">{{ nextActionPrompt }}</span>
              </div>

              <div class="workflow-actions">
                <button
                  v-if="canvassStatusDisplay === CANVASS_STATUS.PENDING && isPurchaser"
                  type="button"
                  class="btn-dashboard-action primary"
                  :disabled="purchaseActionLoading"
                  @click="openCanvassModal"
                >
                  Create Canvass Order
                </button>
                <button
                  v-else-if="
                    canvassStatusDisplay === CANVASS_STATUS.ORDER_CREATED &&
                    purchaseStatusDisplay === PURCHASE_STATUS.PENDING &&
                    isPurchaser
                  "
                  type="button"
                  class="btn-dashboard-action primary"
                  :disabled="purchaseActionLoading"
                  @click="openPurchaseOrderedModal"
                >
                  Mark as Ordered
                </button>
                <button
                  v-else-if="purchaseStatusDisplay === PURCHASE_STATUS.ORDERED && isPurchaser"
                  type="button"
                  class="btn-dashboard-action primary"
                  :disabled="purchaseActionLoading"
                  @click="openPurchaseReceivedModal"
                >
                  Mark as Received
                </button>
              </div>
            </div>
          </div>

          <!-- Document Selector (Only if on Documents tab) -->
          <div v-if="activeTab === 'documents'" class="doc-selector-bar">
            <span class="selector-label">Select Form to View/Print:</span>
            <div class="doc-btns">
              <button
                type="button"
                :class="['doc-btn', { active: printMode === 'fm-pur-05' }]"
                @click="setPrintMode('fm-pur-05')"
              >
                Requisition Form
              </button>
              <button
                v-if="canViewCanvass"
                type="button"
                :class="['doc-btn', { active: printMode === 'pbac-form-01' }]"
                @click="setPrintMode('pbac-form-01')"
              >
                PBAC Canvass Form
              </button>
              <button
                v-if="canViewPO"
                type="button"
                :class="['doc-btn', { active: printMode === 'purchase-order' }]"
                @click="setPrintMode('purchase-order')"
              >
                Purchase Order
              </button>
            </div>
          </div>
        </div>

        <div class="detail-content">
          <!-- Documents Tab Content -->
          <template v-if="showProcurementDashboard && activeTab === 'documents'">
            <!-- Document 1: Purchase Order view -->
            <div v-if="printMode === 'purchase-order' && canViewPO" class="print-form-container">
              <PurchaseOrder :requisition="requisition" :signatures="sigMap" />
            </div>

            <!-- Document 2: PBAC Canvass view -->
            <div
              v-else-if="printMode === 'pbac-form-01' && canViewCanvass"
              class="pbac-document form-container"
            >
              <PBACForm01 :requisition="requisition" :signatures="sigMap" />
            </div>

            <!-- Document 3: Default Requisition Form (FM-PUR-05) view -->
            <div v-else class="form-document form-container">
              <div v-for="i in 2" :key="i" class="print-page-wrapper" :class="{ 'print-only-copy': i === 2 }">
                <div class="print-page">
                  <div class="copy-label no-print-screen">COPY {{ i }}</div>
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
                        <th style="width: 120px">Balance for Purchase</th>
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
                        <td class="item-cell"></td>
                        <td class="item-cell">{{ item.remarks || '—' }}</td>
                      </tr>
                      <!-- Empty rows to maintain layout -->
                      <tr
                        v-for="n in Math.max(0, 2 - (requisition.items?.length || 0))"
                        :key="'empty-' + n"
                      >
                        <td class="item-cell">&nbsp;</td>
                        <td class="item-cell"></td>
                        <td class="item-cell"></td>
                        <td class="item-cell"></td>
                        <td class="item-cell"></td>
                        <td class="item-cell"></td>
                      </tr>
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
                          <div class="sig-sub">Section Head / Div. Head / Department Head</div>
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
                <!-- Separator between copies (only if they are on the same page) -->
                <div v-if="i === 1 && !isLongForm" class="print-separator no-print-screen"></div>
              </div>
            </div>
          </template>

          <template v-else-if="!showProcurementDashboard || activeTab === 'overview'">
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

              <!-- Rejection Alert: Shown if PO was rejected -->
              <section
                v-if="requisition.poStatus === PO_STATUS.REJECTED && requisition.poRejectionRemarks"
                class="meta-section card-section rejection-banner"
              >
                <div class="rejection-icon">⚠️</div>
                <div class="rejection-body">
                  <h3 class="rejection-title">Purchase Order Returned</h3>
                  <p class="rejection-text">{{ requisition.poRejectionRemarks }}</p>
                  <p class="rejection-meta">
                    Rejected by <strong>{{ requisition.poRejectedBy?.name }}</strong>
                  </p>
                </div>
              </section>

              <!-- Receiving Info Section: Shown if items are received -->
              <section
                v-if="
                  requisition.purchaseStatus === PURCHASE_STATUS.RECEIVED && requisition.receivedAt
                "
                class="meta-section card-section receiving-info-section"
              >
                <h2 class="card-section-title">
                  <span class="card-section-title-text"
                    >Delivery Confirmation (Finished Product Copy)</span
                  >
                </h2>
                <div class="details-grid">
                  <div class="detail-block">
                    <span class="detail-block-label">Received By</span>
                    <span class="detail-block-value">{{
                      requisition.receivedBy?.name || '—'
                    }}</span>
                  </div>
                  <div class="detail-block">
                    <span class="detail-block-label">Date Received</span>
                    <span class="detail-block-value">{{ formatDate(requisition.receivedAt) }}</span>
                  </div>
                  <div class="detail-block">
                    <span class="detail-block-label">Fulfillment Note</span>
                    <span class="detail-block-value text-success"
                      >Completed & Verified via Procurement Hub</span
                    >
                  </div>
                </div>
              </section>

              <!-- PO Info Section: Only if PO exists and user is in Procurement/Approval flow -->
              <section
                v-if="requisition.poNumber"
                class="meta-section card-section po-info-section"
              >
                <h2 class="card-section-title">
                  <span class="card-section-title-text">Purchase Order Details</span>
                </h2>
                <div class="details-grid">
                  <div class="detail-block">
                    <span class="detail-block-label">PO Number</span>
                    <span class="detail-block-value po-number-badge">{{
                      requisition.poNumber
                    }}</span>
                  </div>
                  <div class="detail-block">
                    <span class="detail-block-label">Supplier</span>
                    <span class="detail-block-value">{{ requisition.supplier || '—' }}</span>
                  </div>
                  <div class="detail-block">
                    <span class="detail-block-label">Total Amount (Inc. VAT)</span>
                    <span class="detail-block-value">{{
                      formatCurrency(computedPoTotalAmount)
                    }}</span>
                  </div>
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

              <section v-if="!requisition.poStatus" class="workflow-section card-section">
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
                v-if="!requisition.poStatus && (requisition.internalAuditorLog || []).length > 0"
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
          v-if="canEditDraft || showApproveDecline || showProcurementDashboard"
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
          <template v-else-if="showProcurementDashboard && activeTab === 'documents'">
            <button type="button" class="btn btn-primary btn-print" @click="doPrint">
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
          Submit this requisition for approval? It will be sent to Section Head / Div. Head /
          Department Head.
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
    <!-- Create Canvass Order modal -->
    <div
      v-if="canvassModalOpen"
      class="purchase-modal-overlay no-print"
      @click.self="closeCanvassModal"
    >
      <div
        class="purchase-modal-card co-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-modal-canvass-title"
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
            </svg>
          </div>
          <div>
            <h3 id="detail-modal-canvass-title" class="purchase-modal-title">
              Submit Canvass to BAC
            </h3>
            <p class="purchase-modal-rf">RF {{ requisition?.rfControlNo || requisition?.id }}</p>
          </div>
        </div>
        <div class="purchase-modal-body">
          <p v-if="canvassActionError" class="purchase-modal-error">
            {{ canvassActionError }}
          </p>
          <div class="purchase-modal-fields">
            <label class="purchase-modal-field">
              <span>Winning Supplier Name <span class="required-star">*</span></span>
              <input
                v-model="supplier"
                type="text"
                placeholder="Enter supplier / company name"
                class="purchase-modal-input"
              />
            </label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem">
              <label class="purchase-modal-field">
                <span>Canvass Order No. <span class="auto-badge">Auto</span></span>
                <input v-model="canvassNumber" type="text" class="purchase-modal-input" />
              </label>
              <label class="purchase-modal-field">
                <span>Canvass Date</span>
                <input v-model="canvassDate" type="date" class="purchase-modal-input" />
              </label>
            </div>
          </div>

          <div class="modal-divider">Item Results (Unit Prices)</div>
          <div class="modal-table-wrap">
            <table class="modal-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th style="width: 80px">Qty</th>
                  <th style="width: 120px">Unit Price</th>
                  <th style="width: 140px">Brand</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, idx) in canvassItems" :key="idx">
                  <td class="td-desc">{{ item.description }}</td>
                  <td class="td-center">{{ item.quantity }}</td>
                  <td>
                    <input
                      v-model.number="item.unitPrice"
                      type="number"
                      step="0.01"
                      class="cell-input text-right"
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <input
                      v-model="item.brand"
                      type="text"
                      class="cell-input"
                      placeholder="e.g. Samsung"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="!hasSignature" class="signature-warning" style="margin-top: 1rem">
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
                You must set up your digital signature in your Profile before submitting a canvass.
              </p>
              <router-link to="/profile" class="profile-link">Go to Profile →</router-link>
            </div>
          </div>
        </div>
        <div class="purchase-modal-actions">
          <button
            type="button"
            class="purchase-modal-btn purchase-modal-btn-cancel"
            @click="closeCanvassModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="purchase-modal-btn purchase-modal-btn-primary"
            :disabled="canvassActionLoading || !hasSignature"
            @click="saveCanvassOrder"
          >
            {{ canvassActionLoading ? 'Submitting…' : '✓ Submit to BAC' }}
          </button>
        </div>
      </div>
    </div>
    <!-- Purchaser modals (no-print) — same professional style as Purchase List -->
    <div
      v-if="purchaseOrderedModal"
      class="purchase-modal-overlay no-print"
      @click.self="closePurchaseOrderedModal"
    >
      <div
        class="purchase-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-modal-ordered-title"
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
            <h3 id="detail-modal-ordered-title" class="purchase-modal-title">Mark as ordered</h3>
            <p class="purchase-modal-rf">RF {{ requisition?.rfControlNo || requisition?.id }}</p>
          </div>
        </div>
        <div class="purchase-modal-body">
          <p v-if="purchaseActionError" class="purchase-modal-error">
            {{ purchaseActionError }}
          </p>
          <div class="purchase-modal-fields">
            <label class="purchase-modal-field">
              <span>PO number (optional)</span>
              <input
                v-model="purchasePoNumber"
                type="text"
                placeholder="e.g. PO-2024-001"
                class="purchase-modal-input"
              />
            </label>
            <label class="purchase-modal-field">
              <span>Order date</span>
              <input v-model="purchaseOrderedAt" type="date" class="purchase-modal-input" />
            </label>
          </div>
        </div>
        <div class="purchase-modal-actions">
          <button
            type="button"
            class="purchase-modal-btn purchase-modal-btn-cancel"
            @click="closePurchaseOrderedModal"
          >
            Cancel
          </button>
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
          <button
            type="button"
            class="purchase-modal-btn purchase-modal-btn-primary"
            :disabled="purchaseActionLoading || !hasSignature"
            @click="savePurchaseOrdered"
          >
            {{ purchaseActionLoading ? 'Saving…' : 'Mark ordered' }}
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="purchaseReceivedModal"
      class="purchase-modal-overlay no-print"
      @click.self="closePurchaseReceivedModal"
    >
      <div
        class="purchase-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-modal-received-title"
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
            <h3 id="detail-modal-received-title" class="purchase-modal-title">Mark as received</h3>
            <p class="purchase-modal-rf">RF {{ requisition?.rfControlNo || requisition?.id }}</p>
          </div>
        </div>
        <div class="purchase-modal-body">
          <p v-if="purchaseActionError" class="purchase-modal-error">
            {{ purchaseActionError }}
          </p>
          <div class="purchase-modal-fields">
            <label class="purchase-modal-field">
              <span>Received date</span>
              <input v-model="purchaseReceivedAt" type="date" class="purchase-modal-input" />
            </label>
          </div>
        </div>
        <div class="purchase-modal-actions">
          <button
            type="button"
            class="purchase-modal-btn purchase-modal-btn-cancel"
            @click="closePurchaseReceivedModal"
          >
            Cancel
          </button>
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
          <button
            type="button"
            class="purchase-modal-btn purchase-modal-btn-primary"
            :disabled="purchaseActionLoading || !hasSignature"
            @click="savePurchaseReceived"
          >
            {{ purchaseActionLoading ? 'Saving…' : 'Mark received' }}
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
  /* If both copies fit on 1 page comfortably, they stay.
     If copy 2 overflows even slightly, it gets pushed entirely to the next page. */
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

/* Purchase modals (Mark as ordered / Mark as received) — same as Purchase List */
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

/* PROCUREMENT DASHBOARD STYLES */
.procurement-dashboard-header {
  margin-bottom: 2rem;
}

/* PO Info Section */
.po-info-section {
  background: #f0f9ff;
  border: 1px solid #e0f2fe;
  border-left: 4px solid #0369a1;
}

.po-number-badge {
  display: inline-block;
  background: #eff6ff;
  color: #1d4ed8;
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
  font-family: monospace;
  font-weight: 600;
  border: 1px solid #dbeafe;
}

/* Procurement Tracker (Redesigned to match Approval Stepper) */
.procurement-tracker {
  display: flex;
  justify-content: space-between;
  background: white;
  padding: 1.75rem 2.5rem;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  margin-bottom: 2rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.milestone {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  position: relative;
}

.milestone-marker {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: 0.75rem;
}

.milestone-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #f1f5f9;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: #fff;
  z-index: 2;
  transition: all 0.3s ease;
}

.danger-title {
  color: #dc2626 !important;
}

.milestone-line {
  flex: 1;
  height: 2px;
  background: #e2e8f0;
  margin: 0 -12px;
  z-index: 1;
}

.milestone.done .milestone-dot {
  background: #22c55e;
  box-shadow: 0 0 0 1px #22c55e;
  color: white;
}

.milestone.done .milestone-line {
  background: #86efac;
}

.milestone.current .milestone-dot {
  background: #3b82f6;
  box-shadow: 0 0 0 1px #3b82f6;
  color: white;
}

.milestone-label {
  font-size: 0.6875rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  transition: color 0.3s;
}

.milestone.done .milestone-label {
  color: #334155;
}

.milestone.current .milestone-label {
  color: #3b82f6;
}

/* Dashboard Controls */
.dashboard-controls {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

.dashboard-tabs {
  display: flex;
  background: #f1f5f9;
  padding: 0.35rem;
  border-radius: 12px;
  gap: 0.25rem;
  height: fit-content;
}

.dash-tab {
  padding: 0.6rem 1.5rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #64748b;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s;
}

.dash-tab.active {
  background: white;
  color: #0f172a;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

/* Workflow Card (Consolidated Status Bars) */
.workflow-card {
  flex: 1;
  background: white;
  padding: 1rem 1.5rem;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.workflow-status-groups {
  display: flex;
  gap: 2.5rem;
}

.status-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.status-group-label {
  font-size: 0.7rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.workflow-guidance {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: #fdf2f8;
  border: 1px solid #fbcfe8;
  border-radius: 8px;
  max-width: 400px;
}

.guidance-icon {
  font-size: 1rem;
}

.guidance-text {
  font-size: 0.8125rem;
  font-weight: 500;
  color: #9d174d;
  line-height: 1.4;
}

.btn-dashboard-action.primary {
  background: #1e293b;
  color: white;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.875rem;
  border: none;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-dashboard-action.primary:hover {
  background: #0f172a;
}

/* Doc Selector Bar */
.doc-selector-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 1.5rem;
  background: #f8fafc;
  border-radius: 10px;
  border: 1px dashed #cbd5e1;
}

.selector-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #64748b;
}

.doc-btns {
  display: flex;
  gap: 0.5rem;
}

.doc-btn {
  padding: 0.45rem 1rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
  background: white;
  border: 1px solid #e2e8f0;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s;
}

.doc-btn:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
}

.doc-btn.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #2563eb;
}

/* Maintain original badge styles but integrated */
.purchase-status-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
}
.purchase-status-badge.pending {
  background: #fef3c7;
  color: #b45309;
}
.purchase-status-badge.ordered {
  background: #e0f2fe;
  color: #0369a1;
}
.purchase-status-badge.received {
  background: #dcfce7;
  color: #166534;
}
.purchase-status-badge.bac-processing {
  background: #e0f2fe;
  color: #1d4ed8;
  border: 1px solid #bae6fd;
}

/* Purchaser: purchase status bar above form */
.purchase-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.purchase-status-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.purchase-status-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
}
.purchase-status-bar .purchase-status-badge {
  display: inline-block;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
}
.purchase-status-bar .purchase-status-badge.pending {
  background: #fef3c7;
  color: #b45309;
}
.purchase-status-bar .purchase-status-badge.ordered {
  background: #e0f2fe;
  color: #0369a1;
}
.purchase-status-bar .purchase-status-badge.received {
  background: #dcfce7;
  color: #166534;
}
.purchase-status-meta {
  font-size: 0.8125rem;
  color: #64748b;
}
.purchase-status-actions {
  display: flex;
  gap: 0.5rem;
}
.btn-purchase-action {
  padding: 0.5rem 1rem;
  font-size: 0.8125rem;
  font-weight: 600;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
}
.btn-purchase-action.ordered {
  background: #e0f2fe;
  color: #0369a1;
  border-color: #7dd3fc;
}
.btn-purchase-action.ordered:hover:not(:disabled) {
  background: #bae6fd;
}
.btn-purchase-action.received {
  background: #dcfce7;
  color: #166534;
  border-color: #86efac;
}
.btn-purchase-action.received:hover:not(:disabled) {
  background: #bbf7d0;
}
.btn-purchase-action:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

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

/* FM-PUR-05 form (purchaser view) - Leyeco III official layout */
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
  html,
  body {
    height: auto !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }

  /* Force display:block on all parent containers to unlock page breaks */
  #app,
  .layout,
  .main-content,
  .main,
  .main-page,
  .detail-view,
  .detail-container-outer,
  .detail-content,
  .form-document.form-container,
  .form-document,
  .app-content {
    display: block !important;
    overflow: visible !important;
    height: auto !important;
    min-height: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    max-width: none !important;
    width: 100% !important;
    box-shadow: none !important;
    border: none !important;
    background: #fff !important;
  }

  /* Hide navigation elements from print */
  .sidebar,
  .header {
    display: none !important;
  }

  .print-page-wrapper {
    display: block !important;
    width: 100% !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
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
  }

  /* Force the second copy to show up when printing */
  .print-only-copy {
    display: block !important;
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
.rejection-banner {
  display: flex;
  gap: 1.25rem;
  background: #fef2f2;
  border: 1px solid #fee2e2;
  border-left: 5px solid #ef4444;
  padding: 1.5rem;
  margin-bottom: 2rem;
  border-radius: 12px;
}

.rejection-icon {
  font-size: 1.75rem;
  line-height: 1;
}

.rejection-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: #991b1b;
}

.rejection-text {
  margin: 0 0 0.75rem 0;
  color: #b91c1c;
  line-height: 1.5;
  font-size: 1rem;
}

.rejection-meta {
  margin: 0;
  font-size: 0.875rem;
  color: #ef4444;
  opacity: 0.9;
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

/* Canvass Modal specific */
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
</style>
