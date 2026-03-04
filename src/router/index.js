import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSystemStore } from '@/stores/system'
import { USER_ROLES } from '@/firebase/collections'

function defaultPathForRole(role) {
  if (role === USER_ROLES.REQUESTER) return '/my-requisitions'
  if (role === USER_ROLES.PURCHASER) return '/procurement-hub'
  if (role === USER_ROLES.BAC_SECRETARY) return '/bac-dashboard'
  if (role === USER_ROLES.SUPER_ADMIN) return '/admin/users'

  // For other specific approver roles, all-requisitions is the hub
  const approverRoles = [
    USER_ROLES.SECTION_HEAD,
    USER_ROLES.WAREHOUSE_HEAD,
    USER_ROLES.BUDGET_OFFICER,
    USER_ROLES.INTERNAL_AUDITOR,
    USER_ROLES.GENERAL_MANAGER,
  ]
  if (approverRoles.includes(role)) return '/all-requisitions'

  // Safety fallback for unknown roles to prevent loops to restricted pages
  return '/my-requisitions'
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/maintenance',
      name: 'maintenance',
      component: () => import('@/views/MaintenanceView.vue'),
      meta: { public: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/RegisterView.vue'),
      meta: { public: true },
    },
    {
      path: '/deactivated',
      name: 'deactivated',
      component: () => import('@/views/DeactivatedView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
        },
        {
          path: 'requisitions/new',
          name: 'create-requisition',
          component: () => import('@/views/CreateRequisitionView.vue'),
          meta: { roles: [USER_ROLES.REQUESTER] },
        },
        {
          path: 'requisitions/:id',
          name: 'requisition-detail',
          component: () => import('@/views/RequisitionDetailView.vue'),
        },
        {
          path: 'my-requisitions',
          name: 'my-requisitions',
          component: () => import('@/views/MyRequisitionsView.vue'),
        },
        {
          path: 'pending-approvals',
          redirect: '/all-requisitions',
        },
        {
          path: 'all-requisitions',
          name: 'all-requisitions',
          component: () => import('@/views/AllRequisitionsView.vue'),
          meta: {
            roles: [
              USER_ROLES.SECTION_HEAD,
              USER_ROLES.WAREHOUSE_HEAD,
              USER_ROLES.BUDGET_OFFICER,
              USER_ROLES.INTERNAL_AUDITOR,
              USER_ROLES.GENERAL_MANAGER,
            ],
          },
        },
        {
          path: 'audit-log',
          name: 'audit-log',
          component: () => import('@/views/AuditLogView.vue'),
          meta: { roles: [USER_ROLES.INTERNAL_AUDITOR, USER_ROLES.GENERAL_MANAGER] },
        },
        {
          path: 'archive',
          name: 'archive',
          component: () => import('@/views/ArchiveView.vue'),
          meta: { roles: [USER_ROLES.GENERAL_MANAGER] },
        },
        {
          path: 'analytics',
          name: 'analytics',
          component: () => import('@/views/AnalyticsView.vue'),
          meta: { roles: [USER_ROLES.GENERAL_MANAGER] },
        },
        {
          path: 'procurement-hub',
          name: 'procurement-hub',
          component: () => import('@/views/ProcurementHubView.vue'),
          meta: { roles: [USER_ROLES.PURCHASER] },
        },
        {
          path: 'purchase-list',
          name: 'purchase-list',
          component: () => import('@/views/PurchaseListView.vue'),
          meta: { roles: [USER_ROLES.PURCHASER] },
        },
        {
          path: 'canvass-orders',
          name: 'canvass-orders',
          component: () => import('@/views/CanvassListView.vue'),
          meta: { roles: [USER_ROLES.PURCHASER] },
        },
        {
          path: 'po-approvals',
          name: 'po-approvals',
          component: () => import('@/views/POApprovalsView.vue'),
          meta: {
            roles: [
              USER_ROLES.BUDGET_OFFICER,
              USER_ROLES.INTERNAL_AUDITOR,
              USER_ROLES.GENERAL_MANAGER,
              USER_ROLES.PURCHASER,
            ],
          },
        },
        {
          path: 'bac-dashboard',
          name: 'bac-dashboard',
          component: () => import('@/views/BACListView.vue'),
          meta: { roles: [USER_ROLES.BAC_SECRETARY] },
        },
        {
          path: 'profile',
          name: 'profile',
          component: () => import('@/views/ProfileView.vue'),
        },
        // Admin Routes
        {
          path: 'admin/users',
          name: 'admin-users',
          component: () => import('@/views/admin/AdminUsersView.vue'),
          meta: { roles: [USER_ROLES.SUPER_ADMIN] },
        },
        {
          path: 'admin/control-numbers',
          name: 'admin-control-numbers',
          component: () => import('@/views/admin/AdminControlNumbersView.vue'),
          meta: { roles: [USER_ROLES.SUPER_ADMIN] },
        },
        {
          path: 'admin/requisitions',
          name: 'admin-requisitions',
          component: () => import('@/views/admin/AdminRequisitionsView.vue'),
          meta: { roles: [USER_ROLES.SUPER_ADMIN] },
        },
        {
          path: 'admin/reference-data',
          name: 'admin-reference-data',
          component: () => import('@/views/admin/AdminReferenceDataView.vue'),
          meta: { roles: [USER_ROLES.SUPER_ADMIN] },
        },
        {
          path: 'admin/settings',
          name: 'admin-settings',
          component: () => import('@/views/admin/AdminSystemSettingsView.vue'),
          meta: { roles: [USER_ROLES.SUPER_ADMIN] },
        },
      ],
    },
  ],
})

router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore()
  const systemStore = useSystemStore()

  // Initialize system config if not yet done
  if (!systemStore.initialized) {
    await systemStore.fetchConfig()
  }

  if (authStore.loading) await authStore.initAuthListener()
  await authStore.waitForAuthReady()

  // Robust super admin check (case-insensitive and checking both sources)
  // Also check for emergency local storage bypass
  const isSuperAdmin =
    authStore.role === USER_ROLES.SUPER_ADMIN ||
    authStore.userProfile?.role === USER_ROLES.SUPER_ADMIN ||
    authStore.userProfile?.role?.toLowerCase() === 'super_admin' ||
    localStorage.getItem('EMERGENCY_ADMIN_BYPASS') === 'true'

  // 1. Maintenance Mode Guard
  const isMaintenance = systemStore.config.maintenanceMode

  if (
    isMaintenance &&
    !isSuperAdmin &&
    to.name !== 'maintenance' &&
    to.name !== 'login' &&
    to.name !== 'deactivated'
  ) {
    next({ name: 'maintenance' })
    return
  }

  // 2. Registration Guard
  if (to.name === 'register' && !systemStore.config.registrationEnabled && !isSuperAdmin) {
    next({ name: 'login' })
    return
  }
  const isPublic = to.meta.public === true
  if (!isPublic && !authStore.isAuthenticated) {
    next({ name: 'login', query: { redirect: to.fullPath } })
    return
  }

  const rolePath = defaultPathForRole(authStore.role)

  if (isPublic && authStore.isAuthenticated && (to.name === 'login' || to.name === 'register')) {
    if (to.path !== rolePath) {
      next(rolePath)
    } else {
      next()
    }
    return
  }

  // 3. Deactivation Guard
  if (
    authStore.isAuthenticated &&
    authStore.userProfile?.isActive === false &&
    to.name !== 'deactivated'
  ) {
    next({ name: 'deactivated' })
    return
  }

  // Root redirect logic
  if (!isPublic && (to.path === '/' || to.name === 'dashboard')) {
    if (to.path !== rolePath) {
      next(rolePath)
    } else {
      next()
    }
    return
  }

  // Role-based guard: redirect if route requires roles and user's role is not allowed
  const allowedRoles = to.meta.roles
  if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
    const role = authStore.role
    const normalizedRole = typeof role === 'string' ? role.toLowerCase().replace(/\s+/g, '_') : ''
    const allowed =
      isSuperAdmin ||
      allowedRoles.includes(role) ||
      (to.name === 'analytics' && normalizedRole === 'general_manager')

    if (!allowed) {
      if (to.path !== rolePath) {
        next(rolePath)
      } else {
        // If we are already at the role path and still not allowed, something is wrong.
        // Redirect to a safe absolute fallback to break the loop.
        next(authStore.role === USER_ROLES.REQUESTER ? '/my-requisitions' : '/login')
      }
      return
    }
  }
  next()
})

router.onError((error, to) => {
  if (
    error.message.includes('Failed to fetch dynamically imported module') ||
    error.message.includes('Importing a module script failed')
  ) {
    if (!to?.query?.reload) {
      window.location = to.fullPath
      window.location.reload()
    }
  }
})

export default router
