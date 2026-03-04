<script setup>
import { ShieldAlert } from 'lucide-vue-next'
</script>

<template>
  <div class="maintenance-page">
    <div class="glass-container">
      <div class="icon-orb">
        <ShieldAlert :size="48" class="text-amber-500" />
      </div>
      <h1 class="title">System Maintenance</h1>
      <p class="description">
        The Leyeco III Requisition System is currently undergoing scheduled maintenance to improve
        our services. We'll be back online shortly.
      </p>
      <div class="divider"></div>
      <p class="footer">Thank you for your patience.</p>
    </div>
  </div>
</template>

<style>
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>

<style scoped>
.maintenance-page {
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
  background: rgba(245, 158, 11, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 2rem;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 1rem;
}

.description {
  font-size: 1rem;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 2rem;
}

.divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  margin-bottom: 1.5rem;
}

.footer {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2rem;
}

.recovery-action {
  display: flex;
  justify-content: center;
  margin-top: 1rem;
}

.btn-staff-login {
  font-size: 0.75rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.3);
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.5rem 1rem;
  border-radius: 99px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
}

.btn-staff-login:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.2);
}

.debug-info-elite {
  margin: 1.5rem 0;
  padding: 1.25rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 1rem;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
  text-align: left;
  border: 1px dashed rgba(255, 255, 255, 0.1);
}

.debug-info-elite p {
  margin: 0.25rem 0;
}

.role-highlight {
  color: #0ea5e9;
  font-weight: 700;
  text-transform: uppercase;
}

.error-text {
  color: #ef4444;
  font-weight: 600;
  margin-top: 0.5rem !important;
  margin-bottom: 1rem;
}

.btn-repair-account {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: #0ea5e9;
  color: white;
  border: none;
  padding: 0.75rem;
  border-radius: 0.75rem;
  font-weight: 700;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.2);
}

.btn-repair-account:hover:not(:disabled) {
  background: #0284c7;
  transform: translateY(-1px);
}

.btn-repair-account:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
