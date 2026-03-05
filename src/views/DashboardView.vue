<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  listRequisitionsSimple,
  APPROVAL_WORKFLOW,
  getRequisitionCount,
} from '@/services/requisitionService'
import { REQUISITION_STATUS, USER_ROLES, USER_RULE_LABELS } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const allRequisitions = ref([])
const loading = ref(true)
const error = ref(null)

const isApprover = computed(() => authStore?.role !== USER_ROLES.REQUESTER)
const isRequestor = computed(() => authStore?.role === USER_ROLES.REQUESTER)
const approverWorkflow = computed(() =>
  authStore?.role ? APPROVAL_WORKFLOW[authStore.role] : null,
)

const myRequisitions = computed(() => {
  if (!authStore.user) return []
  return allRequisitions.value.filter((r) => r.requestedBy?.userId === authStore.user.uid)
})

const pendingForApproval = computed(() => {
  if (!isApprover.value || !approverWorkflow.value) return []
  return allRequisitions.value.filter((r) => r.status === approverWorkflow.value.canApproveStatus)
})

const stats = ref({
  total: 0,
  pendingApproval: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
  myPending: 0,
  myApproved: 0,
  myRejected: 0,
})

async function load() {
  loading.value = true
  error.value = null
  try {
    // Load first page of requisitions for the "Recent" list (if we add one) or just basic load
    allRequisitions.value = await listRequisitionsSimple()

    // Fetch accurate counts from server
    const isReq = isRequestor.value
    const uid = authStore.user?.uid

    if (isReq) {
      const pendingStatuses = [
        REQUISITION_STATUS.PENDING_RECOMMENDATION,
        REQUISITION_STATUS.PENDING_INVENTORY,
        REQUISITION_STATUS.PENDING_BUDGET,
        REQUISITION_STATUS.PENDING_AUDIT,
        REQUISITION_STATUS.PENDING_APPROVAL,
      ]
      const [total, pending, approved, rejected] = await Promise.all([
        getRequisitionCount({ requestedBy: uid }),
        getRequisitionCount({ requestedBy: uid, status: pendingStatuses }),
        getRequisitionCount({ requestedBy: uid, status: REQUISITION_STATUS.APPROVED }),
        getRequisitionCount({ requestedBy: uid, status: REQUISITION_STATUS.REJECTED }),
      ])
      stats.value = {
        ...stats.value,
        total,
        myPending: pending,
        myApproved: approved,
        myRejected: rejected,
      }
    } else {
      const pendingStatuses = [
        REQUISITION_STATUS.PENDING_RECOMMENDATION,
        REQUISITION_STATUS.PENDING_INVENTORY,
        REQUISITION_STATUS.PENDING_BUDGET,
        REQUISITION_STATUS.PENDING_AUDIT,
        REQUISITION_STATUS.PENDING_APPROVAL,
      ]
      const workflowStatus = approverWorkflow.value?.canApproveStatus
      const [total, pendingApp, totalPending, approved, rejected] = await Promise.all([
        getRequisitionCount(),
        workflowStatus ? getRequisitionCount({ status: workflowStatus }) : Promise.resolve(0),
        getRequisitionCount({ status: pendingStatuses }),
        getRequisitionCount({ status: REQUISITION_STATUS.APPROVED }),
        getRequisitionCount({ status: REQUISITION_STATUS.REJECTED }),
      ])
      stats.value = {
        total,
        pendingApproval: pendingApp,
        pending: totalPending,
        approved,
        rejected,
      }
    }
  } catch (e) {
    error.value = e.message || 'Failed to load.'
  } finally {
    loading.value = false
  }
}

function goTo(path) {
  router.push(path)
}

onMounted(load)
</script>

<template>
  <div class="dashboard jinja">
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <p class="page-subtitle">
        <template v-if="isRequestor">Overview of your requisitions and quick actions</template>
        <template v-else>Overview and quick access to approvals</template>
      </p>
    </div>

    <div v-if="error" class="error-banner">
      {{ error }}
    </div>

    <!-- Requestor: summary only, no table -->
    <template v-if="isRequestor">
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-value">{{ loading ? '—' : stats.total }}</span>
          <span class="stat-label">Total requisitions</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ loading ? '—' : stats.myPending }}</span>
          <span class="stat-label">In progress</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ loading ? '—' : stats.myApproved }}</span>
          <span class="stat-label">Approved</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ loading ? '—' : stats.myRejected }}</span>
          <span class="stat-label">Rejected</span>
        </div>
      </div>
      <div class="action-cards">
        <button class="action-card primary" @click="goTo('/requisitions/new')">
          <span class="action-icon">+</span>
          <span class="action-title">New requisition</span>
          <span class="action-desc">Submit a new request to Section Head</span>
        </button>
        <router-link to="/my-requisitions" class="action-card">
          <span class="action-icon">📄</span>
          <span class="action-title">My requisitions</span>
          <span class="action-desc">View list, status, and workflow log</span>
        </router-link>
      </div>
    </template>

    <!-- Approver: summary only, no table -->
    <template v-else>
      <div class="stats-grid">
        <div class="stat-card highlight" v-if="!loading && stats.pendingApproval > 0">
          <span class="stat-value">{{ stats.pendingApproval }}</span>
          <span class="stat-label">Pending your approval</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ loading ? '—' : stats.total }}</span>
          <span class="stat-label">Total requisitions</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ loading ? '—' : stats.pending }}</span>
          <span class="stat-label">In progress</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ loading ? '—' : stats.approved }}</span>
          <span class="stat-label">Approved</span>
        </div>
      </div>
      <div class="role-context">
        <span class="role-badge">{{ USER_ROLE_LABELS[authStore.role] }}</span>
      </div>
      <div class="action-cards">
        <router-link to="/pending-approvals" class="action-card primary">
          <span class="action-icon">🔔</span>
          <span class="action-title">Pending approvals</span>
          <span class="action-desc">Requisitions waiting for your review</span>
        </router-link>
        <router-link to="/all-requisitions" class="action-card">
          <span class="action-icon">📊</span>
          <span class="action-title">All requisitions</span>
          <span class="action-desc">View all requisitions in the system</span>
        </router-link>
      </div>
    </template>
  </div>
</template>

<style scoped>
.jinja {
  --jinja-bg: #f8fafc;
  --jinja-surface: #ffffff;
  --jinja-border: #e2e8f0;
  --jinja-text: #0f172a;
  --jinja-muted: #64748b;
  --jinja-accent: #0f172a;
  --jinja-radius: 8px;
}

.dashboard {
  padding: 1.5rem 1.75rem;
  max-width: 900px;
  margin: 0 auto;
  background: var(--jinja-bg);
  min-height: 100%;
}

.page-header {
  margin-bottom: 1.5rem;
}
.page-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--jinja-text);
  letter-spacing: -0.02em;
}
.page-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--jinja-muted);
}

.error-banner {
  padding: 1rem 1.25rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--jinja-radius);
  color: #b91c1c;
  font-size: 0.875rem;
}

.loading-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3rem;
  color: var(--jinja-muted);
  font-size: 0.875rem;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--jinja-border);
  border-top-color: var(--jinja-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.stat-card {
  background: var(--jinja-surface);
  border: 1px solid var(--jinja-border);
  border-radius: var(--jinja-radius);
  padding: 1.25rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.stat-card.highlight {
  border-color: #c2410c;
  background: #fff7ed;
}
.stat-card .stat-value {
  display: block;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--jinja-text);
  line-height: 1.2;
}
.stat-card.highlight .stat-value {
  color: #c2410c;
}
.stat-card .stat-label {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--jinja-muted);
}

.role-context {
  margin-bottom: 1rem;
}
.role-badge {
  font-size: 0.75rem;
  color: var(--jinja-muted);
  background: var(--jinja-surface);
  border: 1px solid var(--jinja-border);
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
}

.action-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
}
.action-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  padding: 1.25rem 1.5rem;
  background: var(--jinja-surface);
  border: 1px solid var(--jinja-border);
  border-radius: var(--jinja-radius);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  text-decoration: none;
  color: inherit;
}
.action-card:hover {
  border-color: #94a3b8;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.action-card.primary {
  border-color: var(--jinja-accent);
  background: var(--jinja-accent);
  color: #fff;
}
.action-card.primary:hover {
  background: #1e293b;
  border-color: #1e293b;
}
.action-icon {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}
.action-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--jinja-text);
}
.action-card.primary .action-title {
  color: #fff;
}
.action-desc {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: var(--jinja-muted);
}
.action-card.primary .action-desc {
  color: rgba(255, 255, 255, 0.8);
}
</style>
