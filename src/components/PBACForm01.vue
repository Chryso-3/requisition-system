<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import isoCert from '@/assets/iso_certification.png'
import { subscribeRequisitionQuotes } from '@/services/requisitionService'

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

const canvassNo = computed(() => props.requisition?.canvassNumber || '—')
const canvassDate = computed(() => formatDate(props.requisition?.canvassDate || new Date()))

function sigSrcFor(roleKey, fallbackObj) {
  return (
    props.signatures?.[roleKey]?.signatureData ??
    fallbackObj?.signatureUrl ??
    fallbackObj?.signatureData ??
    null
  )
}

const isoCertSrc = computed(() => {
  return isoCert
})

const quotes = ref([])
let quotesUnsub = null

onMounted(() => {
  if (props.requisition?.id) {
    quotesUnsub = subscribeRequisitionQuotes(
      props.requisition.id,
      (results) => {
        quotes.value = results
      },
      (err) => console.error('Failed to load quotes:', err)
    )
  }
})

onUnmounted(() => {
  if (quotesUnsub) quotesUnsub()
})
</script>

<template>
  <div class="pbac-form-wrapper">
    <!-- Header Section -->
    <div class="form-header">
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

    <div class="form-id">{{ requisition?.pbacFormNo || 'PBAC FORM 01' }}</div>

    <div class="form-title-row">
      <div class="canvass-no">
        <span class="label">CANVASS FORM NO.</span>
        <span class="value">{{ canvassNo }}</span>
      </div>
      <div class="date-row">
        <span class="label">Date:</span>
        <span class="value">{{ canvassDate }}</span>
      </div>
    </div>

    <!-- Instructions -->
    <div class="instructions">
      <p>
        Sealed Canvass Proposal for furnishing and delivery of the following materials listed below
        will be opened on at the office of the Leyte III Electric Cooperative, Inc. <strong>Canvass Proposal
        must be signed over printed name by the dealers/suppliers enclosed/attached to the quotation
        is a sealed envelope addressed to Leyte III Electric Cooperative, Inc., Real St., Brgy. San
        Roque, Tunga, Leyte.</strong> <strong>Please attach to the Canvass Proposal your official quotation on your
        company's letterhead.</strong> Late proposal will not be entertained.
      </p>
      <p>
        <strong>IMPORTANT:</strong> LEYECO III reserves the right to reject any or all bids without
        offering any reason; waive any defect or required formalities in the bids received, and make
        an award to the bidder whose proposal is most advantageous to the cooperative. LEYECO III
        assumes no obligations for whatever losses that may be incurred by the bidders nor does it
        guarantee that an award will be made.
      </p>
    </div>

    <!-- Items Table -->
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 50px">ITEM</th>
          <th style="width: 60px">RF#</th>
          <th style="width: 60px">QTY</th>
          <th style="width: 120px">UNIT</th>
          <th>PARTICULARS</th>
          <th style="width: 100px">UNIT PRICE</th>
          <th style="width: 100px">BRAND</th>
          <th style="width: 100px">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, idx) in requisition.items || []" :key="idx">
          <td class="text-center">{{ idx + 1 }}</td>
          <td class="text-center">{{ requisition.rfControlNo || '—' }}</td>
          <td class="text-center">{{ item.quantity }}</td>
          <td class="text-center">{{ item.unit || '—' }}</td>
          <td style="overflow-wrap: anywhere; word-break: break-word;">{{ item.description || '—' }}</td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
          <td class="empty-cell"></td>
        </tr>
        <!-- Fill remaining lines if needed to look like the document -->
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
      </tbody>
    </table>

    <!-- Terms and Conditions -->
    <div class="terms-section">
      <div class="terms-label">TERMS AND CONDITIONS:</div>
      <div class="term-row">
        <span class="label">PAYMENT :</span>
        <div class="field-line"></div>
      </div>
      <div class="term-row">
        <span class="label">DELIVERY :</span>
        <div class="field-line"></div>
      </div>
    </div>

    <!-- Leyeco Filled Section -->
    <div class="leyeco-filled-header">TO BE FILLED OUT BY LEYECO III</div>

    <div class="signature-section">
      <div class="canvass-by">
        <div class="label">Canvass by</div>
        <div class="sig-container">
          <div
            class="sig-name"
            :class="{
              'override-name':
                (signatures && signatures['canvassBy']?.isOverride) ||
                requisition.canvassBy?.isOverride,
            }"
          >
            {{ signatures['canvassBy']?.name || requisition.canvassBy?.name || '—' }}
          </div>
          <div
            v-if="
              (signatures && signatures['canvassBy']?.isOverride) ||
              requisition.canvassBy?.isOverride
            "
            class="admin-override-seal"
          >
            ADMIN OVERRIDE
          </div>
          <div v-else-if="sigSrcFor('canvassBy', requisition.canvassBy)" class="sig-img-wrap">
            <img :src="sigSrcFor('canvassBy', requisition.canvassBy)" alt="Signature" />
          </div>
          <div class="sig-line"></div>
          <div class="sig-sub">Signature Over Printed Name of Canvasser</div>
        </div>
      </div>
    </div>

    <!-- Company Details -->
    <div class="company-details">
      <div class="detail-row">
        <span class="label">COMPANY/Name of Firm :</span>
        <div class="field-line"></div>
      </div>
      <div class="detail-row">
        <span class="label">Address :</span>
        <div class="field-line"></div>
      </div>
      <div class="detail-row">
        <span class="label">Mobile# :</span>
        <div class="field-line"></div>
      </div>
      <div class="detail-row">
        <span class="label">Email Add: :</span>
        <div class="field-line"></div>
      </div>
      <div class="detail-row" style="margin-top: 1rem">
        <span class="label">Signature over Printed Name/Date</span>
        <div class="field-line"></div>
      </div>
    </div>


    <!-- Footer -->
    <div class="footer">
      <p>Brgy. San Roque, Tunga, Leyte</p>
      <p>Hotline Nos.: (Globe) 0917-3049794, (Smart) 0998-5487784</p>
      <p class="email">E-mail Address: leyteiii@yahoo.com</p>
    </div>
  </div>
</template>

<style scoped>
.pbac-form-wrapper {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 0.5in 20px 20px;
  background: white;
  color: #000;
  font-family: 'Times New Roman', serif;
  font-size: 11pt;
  line-height: 1.2;
}

.form-header {
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
  width: 70px;
  height: auto;
}

.company-name {
  margin: 0;
  font-size: 24pt;
  font-weight: 900;
  color: #000; /* Solid Black */
}

.company-subtitle {
  margin: 0;
  font-size: 10pt;
  font-weight: bold;
  color: #000; /* Solid Black */
}

.company-slogan {
  margin: 0;
  font-size: 8pt;
  font-style: italic;
  color: #666;
}

.cert-logos {
  display: flex;
  align-items: center;
  margin-right: -10px;
}

.iso-cert-img {
  height: 70px;
  object-fit: contain;
}

.form-id {
  font-size: 10pt;
  font-weight: bold;
  margin-top: 5px;
}

.form-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  margin-bottom: 10px;
  font-weight: bold;
}

.instructions {
  font-size: 9pt;
  text-align: justify;
  margin-bottom: 15px;
}

.instructions p {
  margin: 0 0 8px 0;
}

.items-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 15px;
}

.items-table th,
.items-table td {
  border: 1px solid #000;
  padding: 4px 6px;
  font-size: 9pt;
}

.items-table th {
  background: #f59e0b; /* Orange color from image */
  color: #000;
}

.empty-cell {
  height: 20px;
}

.text-center {
  text-align: center;
}

.terms-section {
  margin-bottom: 15px;
}

.terms-label {
  font-weight: bold;
  font-size: 10pt;
  margin-bottom: 5px;
}

.term-row {
  display: flex;
  align-items: flex-end;
  margin-bottom: 4px;
}

.term-row .label {
  min-width: 80px;
  font-size: 9pt;
}

.field-line {
  flex: 1;
  border-bottom: 1px solid #000;
  margin-bottom: 3px;
}

.leyeco-filled-header {
  background: #94a3b8;
  color: #fff;
  text-align: center;
  font-weight: bold;
  padding: 4px;
  font-size: 9pt;
  margin-bottom: 15px;
}

.signature-section {
  margin-bottom: 20px;
}

.canvass-by {
  display: flex;
  flex-direction: column;
}

.sig-container {
  max-width: 300px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-top: 20px;
}

.sig-name {
  font-weight: bold;
  font-size: 11pt;
  text-decoration: underline;
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

.sig-sub {
  font-size: 8pt;
  margin-top: 4px;
}
.sig-line {
  width: 100%;
  border-top: 1px solid #000;
  margin-top: 2px;
}

.sig-img-wrap {
  position: absolute;
  top: -20px; /* Adjust to float better over the name */
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  pointer-events: none;
}

.sig-img-wrap img {
  height: 60px;
  opacity: 0.85; /* For a more realistic stamp/ink feel */
}

.company-details {
  border: 1px solid #000;
  padding: 10px;
  margin-bottom: 20px;
}

.detail-row {
  display: flex;
  align-items: flex-end;
  margin-bottom: 8px;
}

.detail-row .label {
  min-width: 150px;
  font-size: 9pt;
}

.footer {
  text-align: left;
  font-size: 8pt;
  margin-top: 10px;
}

.footer p {
  margin: 2px 0;
}
.footer .email {
  color: blue;
  text-decoration: underline;
}


@media print {
  .pbac-form-wrapper {
    margin: 0;
    padding: 0.5in 0 0;
  }
}
</style>
