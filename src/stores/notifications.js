import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { useAuthStore } from './auth'
import {
  COLLECTIONS,
  REQUISITION_STATUS,
  PO_STATUS,
  USER_ROLES,
  CANVASS_STATUS,
  PURCHASE_STATUS,
} from '@/firebase/collections'

export const useNotificationStore = defineStore('notifications', () => {
  const authStore = useAuthStore()
  const notifications = ref([])
  const poNotifications = ref([])
  const loadingRF = ref(false)
  const loadingPO = ref(false)
  const loading = computed(() => loadingRF.value || loadingPO.value)
  let unsubscribeRF = null
  let unsubscribePO = null

  // Combined count across RF and PO pending tasks (de-duplicated)
  const pendingCount = computed(() => allNotifications.value.length)
  // Keep backward-compat alias
  const unreadCount = pendingCount

  // All items merged for the dropdown list with de-duplication
  const allNotifications = computed(() => {
    const rf = notifications.value
    const po = poNotifications.value
    
    // Create a map to de-duplicate items that appear in both RF and PO snapshots
    const mergedMap = new Map()
    
    rf.forEach(item => mergedMap.set(item.id, { ...item, _displayType: 'rf' }))
    po.forEach(item => {
      // If already present, we might want to flag it as both, but for UI simplicity
      // we'll just prioritize the PO type if it exists in both
      mergedMap.set(item.id, { ...item, _displayType: 'po' })
    })
    
    return Array.from(mergedMap.values())
  })

  function initNotificationListener() {
    // Tear down any existing listeners
    if (unsubscribeRF) { unsubscribeRF(); unsubscribeRF = null }
    if (unsubscribePO) { unsubscribePO(); unsubscribePO = null }

    const role = authStore.role
    if (!role) {
      notifications.value = []
      poNotifications.value = []
      return
    }

    loadingRF.value = true
    loadingPO.value = true

    // ── RF (Requisition Form) Listener ─────────────────────────────────────────
    const managerRoles = [
      USER_ROLES.SECTION_HEAD,
      USER_ROLES.DIVISION_HEAD,
      USER_ROLES.DEPARTMENT_HEAD,
    ]
    const isManager = managerRoles.includes(role)

    let rfStatus = null
    if (isManager) {
      rfStatus = REQUISITION_STATUS.PENDING_RECOMMENDATION
    } else if (role === USER_ROLES.WAREHOUSE_HEAD) {
      rfStatus = REQUISITION_STATUS.PENDING_INVENTORY
    } else if (role === USER_ROLES.BUDGET_OFFICER) {
      rfStatus = REQUISITION_STATUS.PENDING_BUDGET
    } else if (role === USER_ROLES.INTERNAL_AUDITOR) {
      rfStatus = REQUISITION_STATUS.PENDING_AUDIT
    } else if (role === USER_ROLES.GENERAL_MANAGER) {
      rfStatus = REQUISITION_STATUS.PENDING_APPROVAL
    } else if (role === USER_ROLES.PURCHASER) {
      // Purchaser Action: Needs Canvassing OR Needs Receiving
      // We'll use a complex list here
      rfStatus = 'PURCHASER_ACTIVE'
    }

    if (rfStatus === 'PURCHASER_ACTIVE') {
      // For Purchaser, we need to listen for two different conditions on the requisitions collection
      // 1. Needs Canvassing
      // 2. Needs Receiving
      // Since Firestore doesn't support OR on different fields easily without indexes, 
      // we'll listen to all APPROVED requisitions and filter client-side for notifications
      const rfQuery = query(
        collection(db, COLLECTIONS.REQUISITIONS),
        where('status', '==', REQUISITION_STATUS.APPROVED),
      )
      unsubscribeRF = onSnapshot(
        rfQuery,
        (snapshot) => {
          let docs = snapshot.docs.map((doc) => ({ id: doc.id, _type: 'rf', ...doc.data() }))
          // Filter for tasks the purchaser needs to DO
          docs = docs.filter((r) => {
            const needsCanvass = (r.canvassStatus === CANVASS_STATUS.PENDING || !r.canvassStatus)
            const needsReceiving = r.purchaseStatus === PURCHASE_STATUS.ORDERED
            return needsCanvass || needsReceiving
          })
          notifications.value = docs
          loadingRF.value = false
        },
        (error) => {
          console.error('[Notifications] Purchaser RF Listener Error:', error)
          loadingRF.value = false
        },
      )
    } else if (rfStatus) {
      const rfQuery = query(
        collection(db, COLLECTIONS.REQUISITIONS),
        where('status', '==', rfStatus),
      )
      unsubscribeRF = onSnapshot(
        rfQuery,
        (snapshot) => {
          let docs = snapshot.docs.map((doc) => ({ id: doc.id, _type: 'rf', ...doc.data() }))
          if (isManager) {
            const userDept = authStore.department?.trim().toUpperCase()
            const userId = authStore.user?.uid
            docs = docs.filter((r) => {
              return (
                r.department?.trim().toUpperCase() === userDept && r.assignedApproverId === userId
              )
            })
          }
          notifications.value = docs
          loadingRF.value = false
        },
        (error) => {
          console.error('[Notifications] RF Listener Error:', error)
          loadingRF.value = false
        },
      )
    } else {
      notifications.value = []
      loadingRF.value = false
    }

    // ── PO Listener ────────────────────────────────────────────────────────────
    // Map each role to the poStatus value they are responsible for
    let poStatus = null
    let extraFilters = []

    if (role === USER_ROLES.BUDGET_OFFICER) {
      poStatus = PO_STATUS.PENDING_BUDGET
    } else if (role === USER_ROLES.INTERNAL_AUDITOR) {
      poStatus = PO_STATUS.PENDING_AUDIT
    } else if (role === USER_ROLES.GENERAL_MANAGER) {
      poStatus = PO_STATUS.PENDING_GM
    } else if (role === USER_ROLES.PURCHASER) {
      // Purchaser Action: PO is Approved, needs to be sent to supplier/ordered
      poStatus = PO_STATUS.APPROVED
    } else if (role === USER_ROLES.BAC_SECRETARY) {
      // BAC Secretary Action Required: Canvass submitted but PO not yet issued
      // Replicates BACListView.vue logic for accuracy
      poStatus = null // poStatus is null when not yet issued
      extraFilters = [
        where('status', '==', REQUISITION_STATUS.APPROVED),
        where('canvassStatus', '==', CANVASS_STATUS.SUBMITTED_TO_BAC)
      ]
    }

    // Determine the base query
    const poBaseQuery = collection(db, COLLECTIONS.REQUISITIONS)
    let poQuery

    if (role === USER_ROLES.BAC_SECRETARY) {
      // Special complex query for BAC PO Issuance
      poQuery = query(
        poBaseQuery,
        where('poStatus', '==', null),
        ...extraFilters
      )
    } else if (poStatus) {
      poQuery = query(
        poBaseQuery,
        where('poStatus', '==', poStatus)
      )
    }

    if (poQuery) {
      unsubscribePO = onSnapshot(
        poQuery,
        (snapshot) => {
          let docs = snapshot.docs.map((doc) => ({
            id: doc.id,
            _type: 'po', // Keep po type for the icon logic
            ...doc.data(),
          }))
          
          // BAC Secretary specific: robustly handle null/undefined poStatus
          if (role === USER_ROLES.BAC_SECRETARY) {
            docs = docs.filter(r => r.poStatus === null || r.poStatus === undefined)
          } else if (role === USER_ROLES.PURCHASER) {
            // Purchaser specific: exclude items already received
            docs = docs.filter(r => r.purchaseStatus !== PURCHASE_STATUS.RECEIVED)
          }
          
          poNotifications.value = docs
          loadingPO.value = false
        },
        (error) => {
          console.error('[Notifications] PO Listener Error:', error)
          loadingPO.value = false
        },
      )
    } else {
      poNotifications.value = []
      loadingPO.value = false
    }
  }

  function stopListener() {
    if (unsubscribeRF) { unsubscribeRF(); unsubscribeRF = null }
    if (unsubscribePO) { unsubscribePO(); unsubscribePO = null }
    notifications.value = []
    poNotifications.value = []
    loadingRF.value = false
    loadingPO.value = false
  }

  return {
    notifications: allNotifications, // expose merged list for the dropdown
    pendingCount,
    unreadCount,
    loading,
    initNotificationListener,
    stopListener,
  }
})
