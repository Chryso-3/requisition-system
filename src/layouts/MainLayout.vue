<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { USER_ROLE_LABELS, USER_ROLES, PURCHASE_STATUS } from '@/firebase/collections'
import { listRequisitionsSimple, APPROVAL_WORKFLOW } from '@/services/requisitionService'
import { useSystemStore } from '@/stores/system'
import { useNotificationStore } from '@/stores/notifications'
import {
  User,
  LogOut,
  ChevronDown,
  Megaphone,
  AlertTriangle,
  Info,
  CheckCircle,
  Bell,
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const systemStore = useSystemStore()
const notificationStore = useNotificationStore()
const showUserMenu = ref(false)
const showNotificationMenu = ref(false)
const pendingPOCount = ref(0) // legacy cleanup?
const pendingCount = computed(() => notificationStore.unreadCount)

// Template Refs for robust click-outside
const userMenuRef = ref(null)
const notifMenuRef = ref(null)

const roleLabel = computed(() =>
  authStore?.role ? USER_ROLE_LABELS[authStore.role] || 'User' : 'Loading...',
)
const isRequestor = computed(() => authStore?.role === USER_ROLES.REQUESTER)
const isApprover = computed(() => authStore?.role && authStore.role !== USER_ROLES.REQUESTER)
const isInternalAuditor = computed(() => authStore?.role === USER_ROLES.INTERNAL_AUDITOR)
const canViewLogs = computed(
  () =>
    authStore?.role === USER_ROLES.INTERNAL_AUDITOR ||
    authStore?.role === USER_ROLES.GENERAL_MANAGER ||
    authStore?.role === USER_ROLES.SUPER_ADMIN,
)
const isGeneralManager = computed(() => authStore?.role === USER_ROLES.GENERAL_MANAGER)
const isPurchaser = computed(() => authStore?.role === USER_ROLES.PURCHASER)
const isBACSecretary = computed(() => authStore?.role === USER_ROLES.BAC_SECRETARY)
const isSuperAdmin = computed(() => authStore?.role === USER_ROLES.SUPER_ADMIN)

function loadPendingCount() {
  if (!isApprover.value) return
  // The store handles both RF and PO listeners in one call
  notificationStore.initNotificationListener()
}

const poApprovalsLabel = computed(() => {
  if (authStore?.role === USER_ROLES.PURCHASER) return 'POs to Order'
  return '2. PO Approvals'
})

async function onSignOut() {
  await authStore.signOut()
  router.replace('/login')
}

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value
}

function goToAnalytics() {
  router.push('/analytics')
}

const userInitials = computed(() => {
  const name = authStore.displayName || 'User'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
})

function closeUserMenu() {
  showUserMenu.value = false
}

// Click outside to close (Improved with Refs)
function handleClickOutside(event) {
  if (showUserMenu.value && userMenuRef.value && !userMenuRef.value.contains(event.target)) {
    closeUserMenu()
  }

  if (showNotificationMenu.value && notifMenuRef.value && !notifMenuRef.value.contains(event.target)) {
    showNotificationMenu.value = false
  }
}

function handleNotificationClick(notif) {
  const role = authStore.role
  const isPOApprover = ['budget_officer', 'internal_auditor', 'general_manager'].includes(role)

  if (role === USER_ROLES.PURCHASER) {
    if (notif._type === 'po') {
      router.push('/po-approvals')
    } else {
      // For RF types, decide based on status
      if (notif.purchaseStatus === PURCHASE_STATUS.ORDERED) {
        router.push({ path: '/procurement-hub', query: { tab: 'receiving' } })
      } else {
        router.push({ path: '/procurement-hub', query: { tab: 'canvassing' } })
      }
    }
  } else if (notif._type === 'po' && isPOApprover) {
    router.push('/po-approvals')
  } else if (role === USER_ROLES.BAC_SECRETARY) {
    // BAC Secretary needs to see the detail page but contextually from their dashboard
    router.push({ path: `/requisitions/${notif.id}`, query: { from: 'bac-dashboard' } })
  } else {
    router.push(`/requisitions/${notif.id}`)
  }
  showNotificationMenu.value = false
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  notificationStore.stopListener()
})

// Reactive listener initialization
watch(
  () => authStore.role,
  (newRole) => {
    if (newRole) {
      notificationStore.initNotificationListener()
    } else {
      notificationStore.stopListener()
    }
  },
  { immediate: true },
)

// Real-time maintenance enforcement
watch(
  () => systemStore.config.maintenanceMode,
  (isMaint) => {
    if (isMaint && !isSuperAdmin.value) {
      router.replace('/maintenance')
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="logo-placeholder">
          <img class="logo" src="@/assets/logos.png" alt="Leyeco III logo" />
        </div>
        <div class="brand-text">
          <span class="brand-name">Leyeco III</span>
          <span class="brand-subtitle">Electric Cooperative INC</span>
        </div>
      </div>
      <nav class="sidebar-nav" aria-label="Main navigation">
        <template v-if="isRequestor">
          <router-link to="/my-requisitions" class="nav-item" active-class="active">
            <span class="nav-icon">
              <!-- Realistic Blue Folder Icon -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M4 6C4 4.89543 4.89543 4 6 4H10L12 6H18C19.1046 6 20 6.89543 20 8V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V6Z"
                  fill="#3B82F6"
                />
                <path
                  d="M4 8H20V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V8Z"
                  fill="#60A5FA"
                />
                <path d="M7 10H17V12H7V10Z" fill="white" fill-opacity="0.4" />
                <path d="M7 14H13V16H7V14Z" fill="white" fill-opacity="0.4" />
                <path opacity="0.1" d="M4 8H20V9H4V8Z" fill="black" />
              </svg>
            </span>
            <span>My Requisitions</span>
          </router-link>
        </template>
        <template v-if="isPurchaser">
          <router-link to="/procurement-hub" class="nav-item" active-class="active">
            <span class="nav-icon">
              <!-- Realistic Golden Shopping Bag -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M6 8H18L19 20H5L6 8Z" fill="#F59E0B" />
                <path
                  d="M9 10V6C9 4.34315 10.3431 3 12 3C13.6569 3 15 4.34315 15 6V10"
                  stroke="#D97706"
                  stroke-width="2"
                  stroke-linecap="round"
                />
                <path d="M6 10H18V12H6V10Z" fill="#D97706" fill-opacity="0.2" />
                <circle cx="12" cy="14" r="2" fill="#FEF3C7" fill-opacity="0.5" />
              </svg>
            </span>
            <span>Procurement Hub</span>
          </router-link>
        </template>
        <template v-if="isBACSecretary">
          <router-link to="/bac-dashboard" class="nav-item" active-class="active">
            <span class="nav-icon">
              <!-- Realistic Red Rubber Stamp -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M12 4V10" stroke="#991B1B" stroke-width="4" stroke-linecap="round" />
                <path d="M8 10H16V14H8V10Z" fill="#991B1B" />
                <rect x="6" y="14" width="12" height="4" rx="1" fill="#DC2626" />
                <path
                  d="M7 18H17V20C17 20.5523 16.5523 21 16 21H8C7.44772 21 7 20.5523 7 20V18Z"
                  fill="#B91C1C"
                />
              </svg>
            </span>
            <span>2. Issue Purchase Order</span>
          </router-link>
          <router-link v-if="canViewLogs" to="/audit-log" class="nav-item" active-class="active">
            <span class="nav-icon">
              <!-- Realistic Slate/Blue Clock Icon -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="12" cy="12" r="9" stroke="#64748B" stroke-width="2" />
                <circle cx="12" cy="12" r="7" fill="#F8FAF8" />
                <path
                  d="M12 7V12L15 14"
                  stroke="#D946EF"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <circle cx="12" cy="12" r="1.5" fill="#64748B" />
              </svg>
            </span>
            <span>Logs</span>
          </router-link>
        </template>
        <template v-if="isApprover && !isPurchaser && !isBACSecretary && !isSuperAdmin">
          <router-link to="/all-requisitions" class="nav-item" active-class="active">
            <span class="nav-icon">
              <!-- Realistic Stacked Folders (Indigo/Amber) -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M4 8C4 6.89543 4.89543 6 6 6H10L12 8H18C19.1046 8 20 8.89543 20 10V20C20 21.1046 19.1046 22 18 22H6C4.89543 22 4 21.1046 4 20V8Z"
                  fill="#818CF8"
                />
                <path
                  d="M3 5C3 3.89543 3.89543 3 5 3H8L10 5H17C18.1046 5 19 5.89543 19 7V9H5C3.89543 9 3 8.10457 3 7V5Z"
                  fill="#FBBF24"
                  fill-opacity="0.6"
                />
                <path
                  d="M4 10H20V20C20 21.1046 19.1046 22 18 22H6C4.89543 22 4 21.1046 4 20V10Z"
                  fill="#A5B4FC"
                />
              </svg>
            </span>
            <span class="nav-text">All Requisitions</span>
          </router-link>
          <router-link
            v-if="
              authStore?.role &&
              ['budget_officer', 'internal_auditor', 'general_manager', 'purchaser'].includes(authStore.role)
            "
            to="/po-approvals"
            class="nav-item"
            active-class="active"
          >
            <span class="nav-icon">
              <!-- Realistic Document with Green Check -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="5"
                  y="3"
                  width="14"
                  height="18"
                  rx="2"
                  stroke="#CBD5E1"
                  stroke-width="2"
                  stroke-linecap="round"
                />
                <circle cx="17" cy="17" r="6" fill="#10B981" />
                <path
                  d="M14.5 17L16 18.5L19.5 15"
                  stroke="white"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span class="nav-text">PO Approvals</span>
          </router-link>

          <router-link v-if="canViewLogs" to="/audit-log" class="nav-item" active-class="active">
            <span class="nav-icon">
              <!-- Realistic Slate/Blue Clock Icon -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="12" cy="12" r="9" stroke="#64748B" stroke-width="2" />
                <circle cx="12" cy="12" r="7" fill="#F8FAF8" />
                <path
                  d="M12 7V12L15 14"
                  stroke="#D946EF"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <circle cx="12" cy="12" r="1.5" fill="#64748B" />
              </svg>
            </span>
            <span>Logs</span>
          </router-link>
          <router-link v-if="isGeneralManager" to="/archive" class="nav-item" active-class="active">
            <span class="nav-icon">
              <!-- Realistic Purple Archive Box -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 6V18C3 19.1046 3.89543 20 5 20H19C20.1046 20 21 19.1046 21 18V6H3Z"
                  fill="#A855F7"
                />
                <path
                  d="M3 4C3 3.44772 3.44772 3 4 3H20C20.5523 3 21 3.44772 21 4V7H3V4Z"
                  fill="#C084FC"
                />
                <rect x="10" y="10" width="4" height="2" rx="1" fill="white" fill-opacity="0.4" />
                <path d="M3 7H21V9H3V7Z" fill="black" fill-opacity="0.1" />
              </svg>
            </span>
            <span>Archive</span>
          </router-link>
          <router-link
            v-if="isGeneralManager"
            to="/analytics"
            class="nav-item"
            active-class="active"
          >
            <span class="nav-icon">
              <!-- Realistic Vibrant Business Chart -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="4" y="12" width="4" height="8" rx="1" fill="#FB7185" />
                <rect x="10" y="7" width="4" height="13" rx="1" fill="#10B981" />
                <rect x="16" y="10" width="4" height="10" rx="1" fill="#6366F1" />
                <path d="M3 20H21" stroke="#94A3B8" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </span>
            <span>Analytics</span>
          </router-link>
        </template>

        <!-- Super Admin Section -->
        <template v-if="isSuperAdmin">
          <div class="nav-section-title">ADMINISTRATION</div>

          <router-link to="/admin/users" class="nav-item" active-class="active">
            <span class="nav-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21"
                  stroke="#38BDF8"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M9 11C11.2091 11 13 9.20914 13 7C13 4.79086 11.2091 3 9 3C6.79086 3 5 4.79086 5 7C5 9.20914 6.79086 11 9 11Z"
                  stroke="#38BDF8"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M23 21V19C22.9993 18.1137 22.7044 17.2522 22.1614 16.5523C21.6184 15.8524 20.8581 15.3516 20 15.12"
                  stroke="#38BDF8"
                  stroke-opacity="0.5"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89317 18.7122 8.75608 18.1676 9.45768C17.623 10.1593 16.8604 10.6597 16 10.88"
                  stroke="#38BDF8"
                  stroke-opacity="0.5"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span>User Management</span>
          </router-link>

          <router-link to="/admin/control-numbers" class="nav-item" active-class="active">
            <span class="nav-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" stroke="#FBBF24" stroke-width="2" />
                <path d="M7 8H17" stroke="#FBBF24" stroke-width="2" stroke-linecap="round" />
                <path d="M7 12H17" stroke="#FBBF24" stroke-width="2" stroke-linecap="round" />
                <path d="M7 16H13" stroke="#FBBF24" stroke-width="2" stroke-linecap="round" />
              </svg>
            </span>
            <span>Control Numbers</span>
          </router-link>

          <router-link to="/admin/requisitions" class="nav-item" active-class="active">
            <span class="nav-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
                  fill="#F43F5E"
                  fill-opacity="0.2"
                  stroke="#F43F5E"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M14 2V8H20"
                  stroke="#F43F5E"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M16 13H8"
                  stroke="#F43F5E"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M16 17H8"
                  stroke="#F43F5E"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M10 9H8"
                  stroke="#F43F5E"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span>All Requisitions</span>
          </router-link>

          <router-link to="/admin/reference-data" class="nav-item" active-class="active">
            <span class="nav-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 3V11H11V3H3Z"
                  stroke="#10B981"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M13 3V11H21V3H13Z"
                  stroke="#10B981"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M3 13V21H11V13H3Z"
                  stroke="#10B981"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M13 13V21H21V13H13Z"
                  stroke="#10B981"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span>Reference Data</span>
          </router-link>

          <router-link to="/audit-log" class="nav-item" active-class="active">
            <span class="nav-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="12" cy="12" r="9" stroke="#64748B" stroke-width="2" />
                <circle cx="12" cy="12" r="7" fill="#F8FAF8" />
                <path
                  d="M12 7V12L15 14"
                  stroke="#D946EF"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <circle cx="12" cy="12" r="1.5" fill="#64748B" />
              </svg>
            </span>
            <span>Audit Log</span>
          </router-link>

          <router-link to="/analytics" class="nav-item" active-class="active">
            <span class="nav-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="4" y="12" width="4" height="8" rx="1" fill="#FB7185" />
                <rect x="10" y="7" width="4" height="13" rx="1" fill="#10B981" />
                <rect x="16" y="10" width="4" height="10" rx="1" fill="#6366F1" />
                <path d="M3 20H21" stroke="#94A3B8" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </span>
            <span>Analytics</span>
          </router-link>

          <router-link to="/archive" class="nav-item" active-class="active">
            <span class="nav-icon">
              <!-- Realistic Purple Archive Box -->
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 6V18C3 19.1046 3.89543 20 5 20H19C20.1046 20 21 19.1046 21 18V6H3Z"
                  fill="#A855F7"
                />
                <path
                  d="M3 4C3 3.44772 3.44772 3 4 3H20C20.5523 3 21 3.44772 21 4V7H3V4Z"
                  fill="#C084FC"
                />
                <rect x="10" y="10" width="4" height="2" rx="1" fill="white" fill-opacity="0.4" />
                <path d="M3 7H21V9H3V7Z" fill="black" fill-opacity="0.1" />
              </svg>
            </span>
            <span>Archive</span>
          </router-link>

          <router-link to="/admin/settings" class="nav-item" active-class="active">
            <span class="nav-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                  stroke="#94A3B8"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="3"
                  stroke="#94A3B8"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span>Settings</span>
          </router-link>
        </template>
      </nav>
    </aside>

    <div class="main-content">
      <header class="header">
        <div class="header-left"></div>
        <div class="header-right">
          <router-link
            v-if="isGeneralManager || isSuperAdmin"
            to="/analytics"
            class="header-nav-link"
          >
            Analytics
          </router-link>

          <!-- Notification Bell -->
          <div ref="notifMenuRef" class="notification-wrapper">
            <button
              class="notification-btn"
              :class="{ 'has-unread': pendingCount > 0 }"
              @click="showNotificationMenu = !showNotificationMenu"
            >
              <Bell :size="20" />
              <span v-if="pendingCount > 0" class="notification-badge">{{ pendingCount }}</span>
            </button>

            <Transition name="dropdown-slide">
              <div v-if="showNotificationMenu" class="notification-dropdown">
                <div class="dropdown-header">
                  <span>Notifications</span>
                  <span v-if="pendingCount > 0" class="count-pill">{{ pendingCount }} New</span>
                </div>
                <div class="notification-list">
                  <div v-if="notificationStore.loading" class="notification-empty">
                    <div class="spinner-tiny"></div>
                    <span>Loading...</span>
                  </div>
                  <template v-else-if="notificationStore.notifications.length > 0">
                    <div
                      v-for="notif in notificationStore.notifications"
                      :key="notif.id + (notif._displayType || '')"
                      class="notification-item"
                      @click="handleNotificationClick(notif)"
                    >
                      <div class="notif-icon">{{ notif._displayType === 'po' ? '🧾' : '📄' }}</div>
                      <div class="notif-content">
                        <div class="notif-title">
                          {{ notif.rfControlNo || notif.controlNumber || 'New Requisition' }}
                        </div>
                        <div class="notif-subtitle">
                          {{ notif._displayType === 'po' ? 'PO Pending Approval' : 'From ' + (notif.requestedBy?.name || '—') }}
                        </div>
                      </div>
                    </div>
                  </template>
                  <div v-else class="notification-empty">No pending tasks</div>
                </div>
                <div class="dropdown-footer">
                  <router-link
                    to="/all-requisitions"
                    @click="showNotificationMenu = false"
                    class="view-all"
                  >
                    View Approvals
                  </router-link>
                </div>
              </div>
            </Transition>
          </div>
          <div
            ref="userMenuRef"
            class="user-menu"
            role="button"
            tabindex="0"
            aria-label="Account menu (click to open)"
            title="Account menu"
            :aria-expanded="showUserMenu"
            aria-haspopup="true"
            @click="toggleUserMenu"
            @keydown.enter="toggleUserMenu"
            @keydown.space.prevent="toggleUserMenu"
          >
            <div class="user-avatar-circle">
              {{ userInitials }}
            </div>
            <div class="user-info">
              <span class="user-name">{{ authStore.displayName }}</span>
              <span class="user-role">{{ roleLabel }}</span>
            </div>
            <span class="dropdown-icon" aria-hidden="true">
              <ChevronDown :size="14" />
            </span>
            <Transition name="dropdown-slide">
              <div v-if="showUserMenu" class="user-dropdown">
                <div class="dropdown-header">
                  <div class="dropdown-user-name">{{ authStore.displayName }}</div>
                  <div class="dropdown-user-email">{{ authStore.user?.email }}</div>
                </div>
                <div class="dropdown-divider"></div>
                <router-link
                  to="/profile"
                  class="dropdown-item dropdown-item-link"
                  @click="showUserMenu = false"
                >
                  <span class="dropdown-item-icon" aria-hidden="true">
                    <User :size="18" />
                  </span>
                  Profile
                </router-link>
                <div class="dropdown-divider"></div>
                <button type="button" @click="onSignOut" class="dropdown-item dropdown-item-danger">
                  <span class="dropdown-item-icon" aria-hidden="true">
                    <LogOut :size="18" />
                  </span>
                  Sign out
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </header>
      <main class="main">
        <!-- System Announcement Banner -->
        <Transition name="slide-down">
          <div
            v-if="systemStore.config.announcement?.active"
            class="system-announcement"
            :class="systemStore.config.announcement?.type || 'info'"
          >
            <div class="announcement-content">
              <span class="announcement-icon">
                <Megaphone v-if="systemStore.config.announcement.type === 'info'" :size="16" />
                <AlertTriangle
                  v-else-if="systemStore.config.announcement.type === 'warning'"
                  :size="16"
                />
                <CheckCircle
                  v-else-if="systemStore.config.announcement.type === 'success'"
                  :size="16"
                />
                <Info v-else :size="16" />
              </span>
              <p class="announcement-text">{{ systemStore.config.announcement.text }}</p>
            </div>
          </div>
        </Transition>

        <div class="main-page">
          <router-view v-slot="{ Component, route }">
            <Transition name="page-fade" mode="out-in">
              <component :is="Component" :key="route.fullPath" />
            </Transition>
          </router-view>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #e2e8f0;
}

/* Sidebar */
.sidebar {
  width: 260px;
  background: #1e293b;
  color: #f8fafc;
  display: flex;
  flex-direction: column;
  position: fixed;
  height: 100vh;
  left: 0;
  top: 0;
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.08);
  z-index: 200;
  overflow: hidden;
  pointer-events: auto;
}

.sidebar-brand {
  padding: 1.5rem 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  gap: 0.875rem;
}

.logo-placeholder {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.logo-icon {
  font-size: 1.5rem;
  opacity: 0.95;
}
.logo {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  object-fit: contain;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.brand-name {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
  line-height: 1.2;
  color: #fff;
  letter-spacing: -0.02em;
}
.brand-subtitle {
  font-size: 0.75rem;
  color: #fff;
  font-weight: 600;
  margin-top: 0.1rem;
}

.sidebar-nav {
  flex: 1;
  padding: 1.25rem 0.75rem;
  overflow-y: auto;
  min-height: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  margin-bottom: 0.25rem;
  color: rgba(255, 255, 255, 0.75);
  text-decoration: none;
  border-radius: 8px;
  transition:
    background 0.15s,
    color 0.15s;
  font-size: 0.9375rem;
  cursor: pointer;
  position: relative;
  min-height: 44px;
  box-sizing: border-box;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.nav-item.active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-weight: 600;
  border-left: 3px solid #0ea5e9;
}
.nav-item .nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  filter: saturate(0.8) contrast(0.9);
  opacity: 0.85;
}

.nav-item:hover .nav-icon,
.nav-item.active .nav-icon {
  opacity: 1;
  filter: saturate(1.2) contrast(1.1) drop-shadow(0 4px 6px rgba(0, 0, 0, 0.15));
  transform: translateY(-2px) scale(1.12);
}

.nav-item.active::after {
  content: '';
  position: absolute;
  left: 0;
  top: 15%;
  height: 70%;
  width: 3px;
  background: #0ea5e9;
  border-radius: 0 4px 4px 0;
  box-shadow: 0 0 10px rgba(14, 165, 233, 0.5);
}

.nav-icon svg {
  display: block;
}
.nav-text {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
}

.badge {
  background: #ef4444;
  color: white;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.15rem 0.5rem;
  border-radius: 12px;
  min-width: 20px;
  text-align: center;
}

.nav-section-title {
  padding: 1.25rem 1rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* Main content area */
.main-content {
  flex: 1;
  min-height: 0;
  margin-left: 260px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f1f5f9;
  position: relative;
  z-index: 1;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.header-nav-link {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #0ea5e9;
  text-decoration: none;
  border-radius: 6px;
  transition:
    background 0.2s,
    color 0.2s;
}
.header-nav-link:hover {
  background: #e0f2fe;
  color: #0284c7;
}
.header-nav-link.router-link-active {
  background: #0ea5e9;
  color: #fff;
}

.header {
  background: #fff;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  height: 64px;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.page-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.org-context {
  font-size: 0.8125rem;
  color: #64748b;
  margin-top: 0.15rem;
}

/* User menu - improved */
.user-menu {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.35rem 0.5rem 0.35rem 0.35rem;
  border: 1px solid transparent;
  border-radius: 9999px;
  background: transparent;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s;
}
.user-menu:hover,
.user-menu[aria-expanded='true'] {
  background: #f8fafc;
  border-color: #e2e8f0;
}
.user-avatar-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9rem;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
.user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
}
.user-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: #1e293b;
}
.user-role {
  font-size: 0.7rem;
  color: #64748b;
  font-weight: 500;
}

.dropdown-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  margin-left: 0.25rem;
  transition:
    transform 0.2s,
    color 0.2s;
}
.dropdown-icon svg {
  flex-shrink: 0;
}
.user-menu:hover .dropdown-icon {
  color: #64748b;
}
.user-menu[aria-expanded='true'] .dropdown-icon {
  transform: rotate(180deg);
  color: #0f172a;
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  background: #fff;
  border-radius: 12px;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06);
  border: 1px solid #e2e8f0;
  min-width: 220px;
  z-index: 50;
  overflow: hidden;
  padding: 0.5rem 0;
}

.dropdown-header {
  padding: 0.75rem 1rem;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 0.25rem;
  margin-top: -0.5rem;
}
.dropdown-user-name {
  font-weight: 600;
  color: #0f172a;
  font-size: 0.9rem;
}
.dropdown-user-email {
  font-size: 0.8rem;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dropdown-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 0.25rem 0;
}

.dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 1rem;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  color: #475569;
  font-size: 0.875rem;
  font-weight: 500;
  transition:
    background 0.15s,
    color 0.15s;
}
.dropdown-item:hover {
  background: #f1f5f9;
  color: #0f172a;
}
.dropdown-item-link {
  text-decoration: none;
  box-sizing: border-box;
}
.dropdown-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  transition: color 0.15s;
}
.dropdown-item:hover .dropdown-item-icon {
  color: #0ea5e9;
}
.dropdown-item-danger:hover {
  background: #fef2f2;
  color: #b91c1c;
}
.dropdown-item-danger:hover .dropdown-item-icon {
  color: #ef4444;
}

.main {
  flex: 1;
  min-height: 0;
  padding: 1rem 0;
  overflow-y: auto; /* Allow scrolling here */
  display: flex;
  flex-direction: column;
}

.main-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto; /* Ensure individual pages can scroll if needed */
  display: flex;
  flex-direction: column;
}

/* Announcement Banner Styles */
.system-announcement {
  padding: 0.75rem 1.5rem;
  margin-bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 10;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.system-announcement.info {
  background: #0ea5e9;
  color: white;
}

.system-announcement.warning {
  background: #f59e0b;
  color: white;
}

.system-announcement.success {
  background: #10b981;
  color: white;
}

.announcement-content {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: 1200px;
  width: 100%;
}

.announcement-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.announcement-text {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

/* Transitions */
.slide-down-enter-active,
.slide-down-leave-active {
  transition:
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.4s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}

/* Page transition */
.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Dropdown Animation */
.dropdown-slide-enter-active,
.dropdown-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.dropdown-slide-enter-from,
.dropdown-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Print styles - hide sidebar and header */
@media print {
  .sidebar,
  .header {
    display: none !important;
  }

  .layout {
    display: block !important;
  }

  .main-content {
    margin-left: 0 !important;
    width: 100% !important;
  }

  .main {
    padding: 0 !important;
  }
}
/* Notifications */
.notification-wrapper {
  position: relative;
  margin-right: 1.5rem;
}

.notification-btn {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  position: relative;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notification-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
}

.notification-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  background: #ef4444;
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 10px;
  border: 2px solid white;
}

.notification-dropdown {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
  width: 320px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
  border: 1px solid #e2e8f0;
  z-index: 1000;
  overflow: hidden;
}

.notification-list {
  max-height: 400px;
  overflow-y: auto;
}

.notification-item {
  padding: 1rem;
  display: flex;
  gap: 1rem;
  align-items: center;
  cursor: pointer;
  transition: background 0.2s;
  border-bottom: 1px solid #f1f5f9;
}

.notification-item:hover {
  background: #f8fafc;
}

.notif-icon {
  width: 40px;
  height: 40px;
  background: #eff6ff;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
}

.notif-title {
  font-weight: 600;
  font-size: 0.875rem;
  color: #1e293b;
}

.notif-subtitle {
  font-size: 0.75rem;
  color: #64748b;
}

.notification-empty {
  padding: 2rem;
  text-align: center;
  color: #94a3b8;
  font-size: 0.875rem;
}

.count-pill {
  background: #eff6ff;
  color: #2563eb;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.view-all {
  display: block;
  text-align: center;
  padding: 0.75rem;
  background: #f8fafc;
  color: #2563eb;
  font-weight: 600;
  font-size: 0.875rem;
  text-decoration: none;
}

.view-all:hover {
  background: #f1f5f9;
}
</style>
