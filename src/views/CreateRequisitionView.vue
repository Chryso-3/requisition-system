<script setup>
import { useRouter } from 'vue-router'
import RequisitionForm from '@/components/RequisitionForm.vue'

const router = useRouter()

function onCreated(requisition) {
  // Navigate to detail view of the newly created draft
  router.push(`/requisitions/${requisition.id}`)
}

function onCancel() {
  router.push('/')
}
</script>

<template>
  <div class="create-view">
    <div class="create-header">
      <h1 class="create-title">New Requisition</h1>
      
    </div>
    <div class="create-panel">
      <RequisitionForm @created="onCreated" @cancel="onCancel" />
    </div>
  </div>
</template>

<style scoped>
.create-view {
  width: 100%;
  padding: 0.75rem 2rem 1.75rem;
  background: #f1f5f9;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.create-header {
  margin-bottom: 1.5rem;
  margin-top: 0;
  flex-shrink: 0;
}
.create-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.02em;
}
.create-subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.9375rem;
  color: #64748b;
}

.create-panel {
  width: 100%;
  max-width: 1200px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.06), 0 2px 4px -2px rgba(0, 0, 0, 0.04);
  overflow: visible;
  flex-shrink: 0;
}
</style>
