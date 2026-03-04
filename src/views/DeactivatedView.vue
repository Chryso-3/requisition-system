<script setup>
import { ShieldAlert, LogOut } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()

async function handleSignOut() {
  await authStore.signOut()
  router.push('/login')
}
</script>

<template>
  <div class="deactivated-page">
    <div class="glass-container">
      <div class="icon-orb">
        <ShieldAlert :size="48" class="text-rose-500" />
      </div>
      <h1 class="title">Account Deactivated</h1>
      <p class="description">
        We've noticed that your account is no longer active. If you believe this is a mistake,
        please contact your System Administrator or Department Head to restore access.
      </p>

      <div class="divider"></div>

      <div class="actions">
        <button @click="handleSignOut" class="btn-logout">
          <LogOut :size="18" />
          <span>Return to Login</span>
        </button>
      </div>

      <p class="footer">Leyeco III Requisition System</p>
    </div>
  </div>
</template>

<style scoped>
.deactivated-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  padding: 2rem;
  color: #fff;
}

.glass-container {
  max-width: 480px;
  width: 100%;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 2rem;
  padding: 3rem;
  text-align: center;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.icon-orb {
  width: 80px;
  height: 80px;
  background: rgba(244, 63, 94, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 2rem;
  border: 1px solid rgba(244, 63, 94, 0.2);
}

.title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 1rem;
  color: #fff;
}

.description {
  font-size: 1rem;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 2.5rem;
}

.divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  margin-bottom: 2rem;
}

.actions {
  display: flex;
  justify-content: center;
  margin-bottom: 2rem;
}

.btn-logout {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.75rem 1.5rem;
  border-radius: 12px;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-logout:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
}

.footer {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
</style>
