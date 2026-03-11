import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { useAuthStore } from './auth'
import { COLLECTIONS, REQUISITION_STATUS, PO_STATUS, USER_ROLES } from '@/firebase/collections'

export const useNotificationStore = defineStore('notifications', () => {
  const authStore = useAuthStore()
  const notifications = ref([])
  const poNotifications = ref([])
  const loading = ref(false)
  let unsubscribeRF = null
  let unsubscribePO = null

  // Combined count across RF and PO pending tasks
  const pendingCount = computed(() => notifications.value.length + poNotifications.value.length)
  // Keep backward-compat alias
  const unreadCount = pendingCount

  // All items merged for the dropdown list
  const allNotifications = computed(() => [...notifications.value, ...poNotifications.value])

  function initNotificationListener() {
    // Tear down any existing listeners
    if (unsubscribeRF) { unsubscribeRF(); unsubscribeRF = null }
    if (unsubscribePO) { unsubscribePO(); unsubscribePO = null }

    const role = authStore.role
    if (!role) return

    loading.value = true

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
    }

    if (rfStatus) {
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
          loading.value = false
        },
        (error) => {
          console.error('[Notifications] RF Listener Error:', error)
          loading.value = false
        },
      )
    } else {
      notifications.value = []
    }

    // ── PO Listener ────────────────────────────────────────────────────────────
    // Map each role to the poStatus value they are responsible for
    let poStatus = null
    if (role === USER_ROLES.BUDGET_OFFICER) {
      poStatus = PO_STATUS.PENDING_BUDGET
    } else if (role === USER_ROLES.INTERNAL_AUDITOR) {
      poStatus = PO_STATUS.PENDING_AUDIT
    } else if (role === USER_ROLES.GENERAL_MANAGER) {
      poStatus = PO_STATUS.PENDING_GM
    } else if (role === USER_ROLES.BAC_SECRETARY) {
      // BAC Secretary sees POs that have been approved (need to issue / process)
      poStatus = PO_STATUS.APPROVED
    }

    if (poStatus) {
      const poQuery = query(
        collection(db, COLLECTIONS.REQUISITIONS),
        where('poStatus', '==', poStatus),
      )
      unsubscribePO = onSnapshot(
        poQuery,
        (snapshot) => {
          poNotifications.value = snapshot.docs.map((doc) => ({
            id: doc.id,
            _type: 'po',
            ...doc.data(),
          }))
          loading.value = false
        },
        (error) => {
          console.error('[Notifications] PO Listener Error:', error)
          loading.value = false
        },
      )
    } else {
      poNotifications.value = []
    }

    // If neither listener is set, clear loading
    if (!rfStatus && !poStatus) {
      loading.value = false
    }
  }

  function stopListener() {
    if (unsubscribeRF) { unsubscribeRF(); unsubscribeRF = null }
    if (unsubscribePO) { unsubscribePO(); unsubscribePO = null }
    notifications.value = []
    poNotifications.value = []
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
