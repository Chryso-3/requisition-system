<script setup>
import { ref, onMounted, computed } from 'vue'
import { getAllUsers, updateUserRole, setUserActive } from '@/services/adminService'
import { USER_ROLES, USER_ROLE_LABELS } from '@/firebase/collections'
import {
  Search,
  UserCog,
  UserMinus,
  UserCheck,
  Trash2,
  Mail,
  Calendar,
  ShieldCheck,
} from 'lucide-vue-next'

const users = ref([])
const loading = ref(true)
const searchQuery = ref('')
const selectedRole = ref('all')
const savingId = ref(null)

const roleOptions = Object.entries(USER_ROLE_LABELS).map(([value, label]) => ({
  value,
  label,
}))

const filteredUsers = computed(() => {
  let result = users.value

  if (selectedRole.value !== 'all') {
    result = result.filter((u) => u.role === selectedRole.value)
  }

  if (!searchQuery.value) return result
  const q = searchQuery.value.toLowerCase()
  return result.filter(
    (u) =>
      u.displayName?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q),
  )
})

async function fetchUsers() {
  loading.value = true
  try {
    users.value = await getAllUsers()
  } catch (err) {
    console.error('Error fetching users:', err)
  } finally {
    loading.value = false
  }
}

async function handleRoleChange(user, newRole) {
  savingId.value = user.uid
  try {
    await updateUserRole(user.uid, newRole)
    user.role = newRole
  } catch (err) {
    console.error('Error updating role:', err)
    alert('Failed to update role. Please check console.')
  } finally {
    savingId.value = null
  }
}

async function toggleUserStatus(user) {
  savingId.value = user.uid
  const newStatus = user.isActive === false
  try {
    await setUserActive(user.uid, newStatus)
    user.isActive = newStatus
  } catch (err) {
    console.error('Error updating status:', err)
  } finally {
    savingId.value = null
  }
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A'
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

onMounted(fetchUsers)
</script>

<template>
  <div class="admin-page">
    <header class="page-header">
      <div class="header-content">
        <h1 class="page-title">User Management</h1>
        <p class="page-subtitle">Manage system access, roles, and user status</p>
      </div>
      <div class="header-actions">
        <div class="filter-wrapper">
          <select v-model="selectedRole" class="elite-select filter-select">
            <option value="all">All Roles</option>
            <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="search-box">
          <Search :size="18" class="search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search name, email, or role..."
            class="search-input"
          />
        </div>
      </div>
    </header>

    <div v-if="loading" class="loading-state">
      <div class="glass-loader"></div>
      <p>Loading user database...</p>
    </div>

    <div v-else class="glass-container elite-card">
      <div class="table-wrapper custom-scrollbar">
        <table class="user-table elite-table">
          <thead>
            <tr>
              <th class="col-user">User Details</th>
              <th class="col-role">System Role</th>
              <th class="col-status">Status</th>
              <th class="col-date">Registered On</th>
              <th class="col-actions text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="user in filteredUsers"
              :key="user.uid"
              :class="{ 'row-deactivated': user.isActive === false }"
            >
              <td class="col-user">
                <div class="user-cell">
                  <div class="user-avatar-elite">{{ user.displayName?.charAt(0) || 'U' }}</div>
                  <div class="user-info">
                    <span class="user-name">{{ user.displayName }}</span>
                    <span class="user-email">{{ user.email }}</span>
                  </div>
                </div>
              </td>
              <td class="col-role">
                <div class="role-wrapper">
                  <select
                    :value="user.role"
                    @change="handleRoleChange(user, $event.target.value)"
                    :disabled="savingId === user.uid"
                    class="elite-select"
                  >
                    <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
              </td>
              <td class="col-status">
                <span
                  class="elite-badge"
                  :class="user.isActive === false ? 'deactivated' : 'active'"
                >
                  <span class="badge-dot"></span>
                  {{ user.isActive === false ? 'Deactivated' : 'Active' }}
                </span>
              </td>
              <td class="col-date">
                <div class="date-text">
                  {{ formatDate(user.createdAt) }}
                </div>
              </td>
              <td class="col-actions text-left">
                <div class="action-buttons elite-actions justify-start">
                  <button
                    @click="toggleUserStatus(user)"
                    class="btn-elite"
                    :class="user.isActive === false ? 'btn-activate' : 'btn-deactivate'"
                  >
                    <UserCheck v-if="user.isActive === false" :size="16" />
                    <UserMinus v-else :size="16" />
                    <span>{{ user.isActive === false ? 'Enable' : 'Disable' }}</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="filteredUsers.length === 0" class="empty-state">
          <p>No users found matching your search.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-page {
  padding: 0.5rem 2rem 2rem; /* Balanced horizontal padding */
  max-width: 1700px; /* Optimized breadth for symmetry */
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 1.5rem;
  gap: 2rem;
}

.page-title {
  font-size: 2rem;
  font-weight: 800;
  color: #1e293b;
  margin: 0;
  letter-spacing: -0.02em;
}

.page-subtitle {
  color: #64748b;
  margin: 0.25rem 0 0;
}

.header-actions {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.filter-select {
  padding: 0.6rem 2.5rem 0.6rem 1.2rem;
  background-color: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  min-width: 180px;
  font-weight: 500;
}

.search-box {
  position: relative;
  width: 260px; /* Reduced for Compact Elite */
}

.search-icon {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
}

.search-input {
  width: 100%;
  padding: 0.6rem 1rem 0.6rem 2.75rem; /* Tighter padding */
  background: rgba(255, 255, 255, 0.4); /* Glass search */
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  font-size: 0.875rem;
  color: #1e293b;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.search-input:focus {
  outline: none;
  background: rgba(255, 255, 255, 0.8);
  border-color: #0ea5e9;
  box-shadow:
    0 0 0 4px rgba(14, 165, 233, 0.1),
    0 8px 20px rgba(0, 0, 0, 0.05);
}

.glass-container.elite-card {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(25px) saturate(180%);
  -webkit-backdrop-filter: blur(25px) saturate(180%);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  overflow: hidden;
}

.table-wrapper {
  width: 100%;
  max-height: 72vh;
  overflow: auto;
  min-height: 400px;
  position: relative;
}

.elite-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  min-width: 1200px; /* Prevent column collapse */
}

/* Locked Column Widths */
.col-user {
  width: 300px; /* Reduced for better spacing */
}
.col-role {
  width: 300px;
}
.col-status {
  width: 160px;
}
.col-date {
  width: 180px;
}
.col-actions {
  width: 180px; /* Balanced actions width */
  padding-right: 0 !important; /* Force flush right alignment */
}

.elite-table th {
  padding: 1rem 1.25rem;
  text-align: left;
  background: rgba(248, 250, 252, 0.6);
  font-size: 0.75rem;
  font-weight: 800;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 2px solid rgba(226, 232, 240, 0.8);
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(12px);
}

.elite-table td {
  padding: 0.75rem 1.25rem; /* Synced with th horizontal padding */
  border-bottom: 1px solid rgba(226, 232, 240, 0.5);
  vertical-align: middle;
  background: transparent;
  transition: background 0.2s;
}

.elite-table tr:hover td {
  background: rgba(14, 165, 233, 0.04);
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.user-avatar-elite {
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: white;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.9rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.user-name {
  font-weight: 700;
  color: #0f172a;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-email {
  font-size: 0.75rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.elite-select {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  transition: all 0.2s;
}

.elite-select:hover {
  background: white;
  border-color: #0ea5e9;
}

.elite-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.elite-badge.active {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}
.elite-badge.active .badge-dot {
  background: #10b981;
}

.elite-badge.deactivated {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}
.elite-badge.deactivated .badge-dot {
  background: #ef4444;
}

.date-text {
  font-size: 0.8125rem;
  color: #64748b;
  font-weight: 500;
}

.action-buttons {
  display: flex;
  justify-content: flex-start; /* Left align buttons to match header and other columns */
  align-items: center;
  gap: 0.5rem;
}

.btn-elite {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.875rem;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.btn-deactivate {
  background: rgba(239, 68, 68, 0.05);
  color: #dc2626;
}
.btn-deactivate:hover {
  background: #ef4444;
  color: white;
}

.btn-activate {
  background: rgba(16, 185, 129, 0.05);
  color: #059669;
}
.btn-activate:hover {
  background: #10b981;
  color: white;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

/* No list animations — instant filtering for clean table UX */

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8rem;
  color: #64748b;
}

.glass-loader {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(14, 165, 233, 0.1);
  border-top-color: #0f172a;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1.5rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.text-right {
  text-align: right;
}
.justify-end {
  justify-content: flex-end;
}

@media (max-width: 1200px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1.5rem;
  }
  .search-box {
    width: 100%;
  }
}

.empty-state {
  padding: 4rem;
  text-align: center;
  color: #94a3b8;
}

@media (max-width: 1024px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .search-box {
    width: 100%;
  }
}
</style>
