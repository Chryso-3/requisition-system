<script setup>
import { computed } from 'vue'

const props = defineProps({
  requisition: {
    type: Object,
    required: true,
  },
  signatures: {
    type: Object,
    default: () => ({}),
  },
})

function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

const poNo = computed(() => props.requisition?.poNumber || '—')
const poDate = computed(() => formatDate(props.requisition?.orderedAt || new Date()))
const supplier = computed(() => props.requisition?.supplier || '—')

function sigSrcFor(roleKey, fallbackObj) {
  return (
    props.signatures?.[roleKey]?.signatureData ??
    fallbackObj?.signatureUrl ??
    fallbackObj?.signatureData ??
    null
  )
}

const subTotal = computed(() => {
  return (props.requisition?.items || []).reduce((sum, item) => {
    return sum + item.quantity * (item.unitPrice || 0)
  }, 0)
})

const vatAmount = computed(() => {
  return subTotal.value * 0.12
})

const grandTotal = computed(() => {
  return subTotal.value + vatAmount.value
})

function formatCurrency(val) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(val)
}

const isoCertSrc = computed(() => {
  // Use a string that Vite won't statically analyze as an import
  // If the file exists, the browser will find it; if not, it will trigger @error
  return '/src/assets/iso_certification.png'
})
</script>

<template>
  <div class="purchase-order-wrapper">
    <!-- Received Stamp Overlay -->
    <div v-if="requisition?.purchaseStatus === 'received'" class="received-stamp-overlay">
      <div class="received-stamp">RECEIVED</div>
    </div>

    <!-- Header Section -->
    <div class="header">
      <div class="logo-left">
        <img src="@/assets/logos.png" alt="LEYECO III" class="main-logo" />
        <div class="company-info">
          <h1 class="company-name">LEYECO III</h1>
          <p class="company-subtitle">LEYTE III ELECTRIC COOPERATIVE, INC.</p>
          <p class="company-slogan">Lighting Houses, Lighting Homes, Lighting Hopes</p>
        </div>
      </div>
      <div class="cert-logos">
        <img
          v-if="isoCertSrc"
          :src="isoCertSrc"
          alt="ISO Certification"
          class="iso-cert-img"
          @error="(e) => (e.target.style.display = 'none')"
        />
      </div>
    </div>

    <div class="title-section">
      <h2 class="form-title">
        PURCHASE ORDER NO.: <span style="text-decoration: underline">{{ poNo }}</span>
      </h2>
    </div>

    <div class="info-grid">
      <div class="info-row">
        <div class="info-item">
          <span class="label">TO:</span>
          <span class="value">{{ supplier }}</span>
        </div>
        <div class="info-item date-item text-right">
          <span class="label">Date:</span>
          <span class="value">{{ poDate }}</span>
        </div>
      </div>
    </div>

    <div class="intro-text">
      <p>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Immediately upon your receipt of this ORDER, please
        furnish the following materials/items/services at prices quoted/offered. Be informed further
        to DELIVER the same to LEYECO III Office, Real St.,
        <span class="red-text">Balire, Tunga,</span> Leyte.
      </p>
    </div>

    <!-- Items Table -->
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 50px">ITEM<br />NO.</th>
          <th style="width: 50px">QTY.</th>
          <th style="width: 120px">UNIT</th>
          <th>DESCRIPTION</th>
          <th style="width: 70px">Source<br />of<br />Fund</th>
          <th style="width: 80px">UNIT PRICE</th>
          <th style="width: 80px">BRAND</th>
          <th style="width: 100px">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, idx) in requisition.items || []" :key="idx">
          <td class="text-center">{{ idx + 1 }}</td>
          <td class="text-center">{{ item.quantity }}</td>
          <td class="text-center">{{ item.unit || '—' }}</td>
          <td style="overflow-wrap: anywhere; word-break: break-word;">{{ item.description || '—' }}</td>
          <td class="text-center">{{ item.sourceOfFund || '' }}</td>
          <td class="text-right">{{ formatCurrency(item.unitPrice) }}</td>
          <td class="text-center">{{ item.brand || '—' }}</td>
          <td class="text-right">{{ formatCurrency(item.quantity * (item.unitPrice || 0)) }}</td>
        </tr>

        <!-- Nothing Follows Row -->
        <tr v-if="(requisition.items || []).length > 0">
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="text-center red-text font-bold">- nothing follows -</td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
        </tr>

        <!-- Fill remaining lines -->
        <tr v-for="n in Math.max(0, 2 - (requisition.items?.length || 0))" :key="'empty-' + n">
          <td class="empty-cell">&nbsp;</td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
        </tr>

        <!-- Subtotal Row -->
        <tr class="total-row">
          <td colspan="3" class="yellow-bg"></td>
          <td class="yellow-bg font-bold text-right" style="padding-right: 15px">SUBTOTAL</td>
          <td colspan="4" class="yellow-bg text-right font-bold">
            {{ formatCurrency(subTotal) }}
          </td>
        </tr>

        <!-- VAT Row -->
        <tr class="total-row">
          <td colspan="3" class="yellow-bg"></td>
          <td class="yellow-bg font-bold text-right" style="padding-right: 15px">ADD: 12% VAT</td>
          <td colspan="4" class="yellow-bg text-right font-bold">
            {{ formatCurrency(vatAmount) }}
          </td>
        </tr>

        <!-- Grand Total Row -->
        <tr class="total-row">
          <td colspan="3" class="yellow-bg"></td>
          <td class="yellow-bg font-bold text-right" style="padding-right: 15px">
            GRAND TOTAL DUE
          </td>
          <td
            colspan="4"
            class="yellow-bg text-right font-bold"
            style="font-size: 11pt; border-top: 2px solid #000"
          >
            {{ formatCurrency(grandTotal) }}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Signatories Section -->
    <div class="signatories-grid">
      <div class="sig-col">
        <div class="sig-block">
          <div class="sig-label">Prepared by:</div>
          <div class="sig-content">
            <div
              class="sig-name underline-text"
              :class="{
                'override-name':
                  (signatures && signatures['orderedBy']?.isOverride) ||
                  requisition.orderedBy?.isOverride,
              }"
            >
              {{ signatures['orderedBy']?.name || requisition.orderedBy?.name || '—' }}
            </div>
            <div
              v-if="
                (signatures && signatures['orderedBy']?.isOverride) ||
                requisition.orderedBy?.isOverride
              "
              class="admin-override-seal"
            >
              ADMIN OVERRIDE
            </div>
            <div v-else-if="sigSrcFor('orderedBy', requisition.orderedBy)" class="sig-img-wrap">
              <img :src="sigSrcFor('orderedBy', requisition.orderedBy)" alt="Signature" />
            </div>
            <div class="sig-title">
              {{
                signatures['orderedBy']?.title ||
                (requisition.orderedBy?.role === 'bac_secretary' ? 'BAC Secretary' : 'Purchaser') ||
                'BAC Secretary'
              }}
            </div>
          </div>
        </div>
        <div class="sig-block" style="margin-top: 2rem">
          <div class="sig-label">Pre-Audited by:</div>
          <div class="sig-content">
            <div
              class="sig-name underline-text"
              :class="{
                'override-name':
                  (signatures && signatures['poAuditApproved']?.isOverride) ||
                  requisition.poAuditApproved?.isOverride,
              }"
            >
              {{ signatures['poAuditApproved']?.name || requisition.poAuditApproved?.name || '—' }}
            </div>
            <div
              v-if="
                (signatures && signatures['poAuditApproved']?.isOverride) ||
                requisition.poAuditApproved?.isOverride
              "
              class="admin-override-seal"
            >
              ADMIN OVERRIDE
            </div>
            <div
              v-else-if="sigSrcFor('poAuditApproved', requisition.poAuditApproved)"
              class="sig-img-wrap"
            >
              <img
                :src="sigSrcFor('poAuditApproved', requisition.poAuditApproved)"
                alt="Signature"
              />
            </div>
            <div class="sig-title">
              {{
                signatures['poAuditApproved']?.title ||
                requisition.poAuditApproved?.title ||
                'Internal Audit Dept. Manager'
              }}
            </div>
          </div>
        </div>
        <div class="sig-block" style="margin-top: 2rem">
          <div class="sig-label">Conforme:</div>
          <div class="sig-content" style="margin-top: 30px">
            <div
              class="sig-line"
              style="width: 100%; border-top: 1px solid #000; margin-bottom: 2px"
            ></div>
            <div class="sig-title">Representative/Supplier & Date</div>
          </div>
        </div>
      </div>

      <div class="sig-col">
        <div class="sig-block">
          <div class="sig-label">Funds Availability:</div>
          <div class="sig-content">
            <div
              class="sig-name underline-text"
              :class="{
                'override-name':
                  (signatures && signatures['poBudgetApproved']?.isOverride) ||
                  requisition.poBudgetApproved?.isOverride,
              }"
            >
              {{
                signatures['poBudgetApproved']?.name || requisition.poBudgetApproved?.name || '—'
              }}
            </div>
            <div
              v-if="
                (signatures && signatures['poBudgetApproved']?.isOverride) ||
                requisition.poBudgetApproved?.isOverride
              "
              class="admin-override-seal"
            >
              ADMIN OVERRIDE
            </div>
            <div
              v-else-if="sigSrcFor('poBudgetApproved', requisition.poBudgetApproved)"
              class="sig-img-wrap"
            >
              <img
                :src="sigSrcFor('poBudgetApproved', requisition.poBudgetApproved)"
                alt="Signature"
              />
            </div>
            <div class="sig-title">
              {{
                signatures['poBudgetApproved']?.title ||
                requisition.poBudgetApproved?.title ||
                'Accounting Div. Supervisor/Budget Officer'
              }}
            </div>
          </div>
        </div>
        <div class="sig-block" style="margin-top: 2rem">
          <div class="sig-label">Approved by:</div>
          <div class="sig-content">
            <div
              class="sig-name underline-text"
              :class="{
                'override-name':
                  (signatures && signatures['poGMApproved']?.isOverride) ||
                  requisition.poGMApproved?.isOverride,
              }"
            >
              {{ signatures['poGMApproved']?.name || requisition.poGMApproved?.name || '—' }}
            </div>
            <div
              v-if="
                (signatures && signatures['poGMApproved']?.isOverride) ||
                requisition.poGMApproved?.isOverride
              "
              class="admin-override-seal"
            >
              ADMIN OVERRIDE
            </div>
            <div v-if="sigSrcFor('poGMApproved', requisition.poGMApproved)" class="sig-img-wrap">
              <img :src="sigSrcFor('poGMApproved', requisition.poGMApproved)" alt="Signature" />
            </div>
            <div class="sig-title">
              {{
                signatures['poGMApproved']?.title ||
                requisition.poGMApproved?.title ||
                'General Manager'
              }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.purchase-order-wrapper {
  width: 100%;
  max-width: 850px;
  margin: 0 auto;
  padding: 0.5in 30px 30px;
  background: white;
  color: #000;
  font-family: 'Times New Roman', serif;
  font-size: 10.5pt;
  line-height: 1.3;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.logo-left {
  display: flex;
  align-items: center;
  gap: 15px;
}

.main-logo {
  width: 90px;
  height: auto;
}

.company-name {
  margin: 0;
  font-size: 28pt;
  font-weight: 900;
  color: #000; /* Solid Black */
  letter-spacing: 2px;
}

.company-subtitle {
  margin: 0;
  font-size: 11pt;
  font-weight: bold;
  color: #000; /* Solid Black */
  letter-spacing: 1px;
}

.company-slogan {
  margin: 0;
  font-size: 9pt;
  font-style: italic;
  font-weight: bold;
  color: #0000ff; /* Blue slogan */
  text-decoration: underline;
}

.cert-logos {
  display: flex;
  align-items: center;
  margin-right: -10px; /* Nudge to the edge */
}

.iso-cert-img {
  height: 80px; /* Adjusted size for clarity */
  object-fit: contain;
}

.title-section {
  margin: 15px 0 20px;
  text-align: left;
}

.form-title {
  display: inline-block;
  font-size: 18pt;
  font-weight: bold;
  color: #0000ff; /* Blue title */
  margin: 0;
}

.info-grid {
  margin-bottom: 20px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.info-item {
  display: flex;
  align-items: flex-end;
  font-size: 10pt;
  font-weight: bold;
}

.date-item {
  justify-content: flex-end;
  gap: 15px;
}

.label {
  white-space: nowrap;
}

.value {
  flex: 1;
  padding-left: 5px;
}

.date-item .value {
  flex: 0 1 auto;
  border-bottom: none;
  padding-left: 0;
}

.intro-text {
  font-size: 10.5pt;
  font-weight: bold;
  margin-bottom: 15px;
  text-align: justify;
}

.red-text {
  color: #cc0000;
}

.font-bold {
  font-weight: bold;
}

.items-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 25px;
}

.items-table th,
.items-table td {
  border: 1px solid #000;
  padding: 6px 8px;
}

.items-table th {
  background: #d9d9d9; /* Gray header from screenshot */
  font-size: 8.5pt;
  font-weight: bold;
  text-align: center;
  border: 1px solid #000;
  padding: 8px 4px;
}

.items-table td {
  font-size: 8.5pt;
  font-weight: bold; /* Bold data like screenshot */
  border: 1px solid #000;
  padding: 4px 6px;
}

.text-center {
  text-align: center;
}
.text-right {
  text-align: right;
}

.total-row td {
  font-size: 10pt;
}

.green-bg {
  background-color: #a9d18e; /* Green row from screenshot */
}

.yellow-bg {
  background-color: #ffff00; /* Yellow row from screenshot */
}

.empty-cell {
  height: 25px;
}

.signatories-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  margin-bottom: 30px;
}

.sig-block {
  display: flex;
  flex-direction: column;
}

.sig-label {
  font-weight: normal;
  margin-bottom: 25px;
  font-size: 9pt;
}

.sig-content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 280px;
}

.sig-name {
  font-weight: bold;
  font-size: 9.5pt;
  z-index: 5;
  position: relative;
}

.admin-override-seal {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -100%) rotate(-12deg);
  border: 2px double #0ea5e9;
  color: #0ea5e9;
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 0.6rem;
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

.underline-text {
  text-decoration: underline;
}

.sig-line {
  border-top: 1px solid #000;
  margin-top: 2px;
}

.sig-title {
  font-size: 7.5pt;
  margin-top: 2px;
}

.sig-img-wrap {
  position: absolute;
  top: -25px; /* Nudged down slightly for better line alignment */
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  pointer-events: none;
}

.sig-img-wrap img {
  height: 60px;
  opacity: 0.85;
}

.conforme {
  justify-content: flex-end;
}

.conforme-wrap {
  margin-top: 40px;
  text-align: center;
}

.conforme-title {
  font-weight: bold;
  text-align: left;
  margin-bottom: 25px;
}

.conforme-line {
  border-top: 1px solid #000;
}

.conforme-sub {
  font-size: 8.5pt;
  margin-top: 4px;
}

.footer {
  border-top: 1px solid #eee;
  padding-top: 10px;
  font-size: 8.5pt;
}

.footer p {
  margin: 2px 0;
}
.footer .email {
  color: blue;
  text-decoration: underline;
}

@media print {
  .purchase-order-wrapper {
    padding: 0.5in 0 0;
    margin: 0;
    max-width: none;
  }
}
/* Received Stamp Overlay */
.received-stamp-overlay {
  position: absolute;
  top: 12rem;
  right: 6rem;
  pointer-events: none;
  z-index: 100;
  display: flex;
  justify-content: center;
  align-items: center;
}

.received-stamp {
  font-family: 'Arial', sans-serif;
  font-weight: 900;
  font-size: 4.5rem;
  color: #dc2626; /* Deep Red */
  border: 10px double #dc2626;
  padding: 0.75rem 2rem;
  text-transform: uppercase;
  transform: rotate(-20deg);
  opacity: 0.7;
  letter-spacing: 6px;
  user-select: none;
}

@media print {
  .received-stamp-overlay {
    top: 60mm;
    right: 35mm;
  }
}
</style>
