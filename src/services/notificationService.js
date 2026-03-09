/**
 * Notification Service
 * Sends email notifications via a 100% Free Google App Script Relay.
 * No Cloud Functions (Blaze Plan) required.
 */

const RELAY_URL =
  'https://script.google.com/macros/s/AKfycbzAFUB6_D5CTA1Mr-DZ1eqXUzsLTiFevyV62u_FIMMTZHLf-bisPVfOIsHsNdHi3r1Dhw/exec'
const SECRET_KEY = 'Leyeco2025Secret' // Symbol-free for URL safety

/**
 * Sends a raw email via the relay
 */
async function sendEmailRelay({ to, subject, htmlBody, body }) {
  if (!RELAY_URL) return console.warn('[Notification] No relay URL configured')

  try {
    console.log(`[Notification] Pinging relay for: ${to} | Subject: ${subject}`)
    // We send as a pure string because 'no-cors' forces headers to be simple.
    // This ensures Google's doPost(e) always sees the data in e.postData.contents.
    const response = await fetch(RELAY_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({
        key: SECRET_KEY,
        to,
        subject,
        htmlBody,
        body: body || 'New notification',
      }),
    })
    console.log('[Notification] Email relay pinged successfully')
    return true
  } catch (error) {
    console.error('[Notification] Relay Error:', error)
    return false
  }
}

/**
 * Notifies the next approver in the Requisition flow
 */
export async function notifyNextApprover(requisition, nextRole, nextApproverEmail) {
  if (!nextApproverEmail) return

  const subject = `[Action Required] New Requisition for Review - ${requisition.rfControlNo || 'New'}`
  const appLink = `${window.location.origin}/all-requisitions`

  const htmlBody = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background: linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%); padding: 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: -0.025em; font-weight: 700;">LEYECO III</h1>
        <p style="color: rgba(255, 255, 255, 0.8); margin: 8px 0 0; font-size: 14px;">Requisition Management System</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="color: #1e293b; margin: 0 0 16px; font-size: 20px; font-weight: 600;">Approval Required</h2>
        <p style="color: #475569; line-height: 1.6; margin: 0 0 24px;">Greetings, a new requisition is pending your review for the <strong>${nextRole}</strong> phase.</p>

        <div style="background: #f8fafc; border-radius: 12px; padding: 24px; border: 1px solid #f1f5f9; margin-bottom: 32px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; width: 140px; vertical-align: top;">Control Number</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 600; vertical-align: top;">
                ${requisition.rfControlNo ? `<span style="color: #1e293b;">${requisition.rfControlNo}</span>` : '<span style="color: #64748b; font-style: italic; font-weight: 400; font-size: 13px; background: #e2e8f0; padding: 2px 8px; border-radius: 4px;">Pending Generation</span>'}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; vertical-align: top;">Purpose</td>
              <td style="padding: 8px 0; color: #1e293b; vertical-align: top; line-height: 1.4;">${requisition.purpose}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; vertical-align: top;">Requested By</td>
              <td style="padding: 8px 0; color: #1e293b; vertical-align: top;">${requisition.requestedBy?.name}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${appLink}" style="display: inline-block; background: #b91c1c; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; transition: background 0.2s;">Open Dashboard</a>
        </div>
      </div>
      <div style="background: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 12px; color: #64748b;">This is an automated priority notification. Please do not reply.</p>
      </div>
    </div>
  `

  return sendEmailRelay({ to: nextApproverEmail, subject, htmlBody })
}

/**
 * Notifies the requestor of a status update (Approved/Rejected/Forwarded)
 */
export async function notifyRequestorUpdate(requisition, status, remarks = '', nextRole = '') {
  console.log('[Notification] notifyRequestorUpdate triggered:', {
    id: requisition.id,
    status,
    nextRole,
  })
  const email = requisition.requestedBy?.email
  if (!email) {
    console.warn('[Notification] No requestor email found for requisition:', requisition.id)
    return
  }
  console.log('[Notification] Target email:', email)

  const isApproved = status === 'approved'
  const isRejected = status === 'rejected' || status === 'declined'
  const isStepUpdate = !isApproved && !isRejected

  let subject = `[Update] Requisition ${requisition.rfControlNo} - ${status.toUpperCase()}`
  let headerGradient = 'linear-gradient(135deg, #1e293b 0%, #334155 100%)' // Default Slate
  let statusText = status.toUpperCase()
  let statusColor = '#1e293b'
  let mainTitle = 'Status Update'

  if (isApproved) {
    subject = `[Final Approval] Requisition ${requisition.rfControlNo} is Fully Approved`
    headerGradient = 'linear-gradient(135deg, #065f46 0%, #059669 100%)' // Success Green
    statusColor = '#059669'
    mainTitle = 'Fully Approved'
  } else if (isRejected) {
    subject = `[Action Required] Requisition ${requisition.rfControlNo} was REJECTED`
    headerGradient = 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%)' // Danger Red
    statusColor = '#b91c1c'
    mainTitle = 'Action Required'
  } else if (isStepUpdate) {
    subject = `[Update] Requisition ${requisition.rfControlNo} - Moving Forward`
    headerGradient = 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)' // Info Blue
    statusColor = '#2563eb'
    mainTitle = 'Moving to Next Step'
  }

  const htmlBody = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background: ${headerGradient}; padding: 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: -0.025em; font-weight: 700;">LEYECO III</h1>
        <p style="color: rgba(255, 255, 255, 0.8); margin: 8px 0 0; font-size: 14px;">Requisition Tracking</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="color: #1e293b; margin: 0 0 16px; font-size: 20px; font-weight: 600;">${mainTitle}</h2>

        <p style="color: #475569; line-height: 1.6; margin: 0 0 24px;">
          ${
            isApproved
              ? 'Great news! Your requisition has received final approval from the General Manager.'
              : isRejected
                ? 'Your requisition has been rejected or returned for corrections. Please see the remarks below.'
                : `Your requisition has been approved at the current stage and is now moving to <strong>${nextRole}</strong>.`
          }
        </p>

        <div style="margin-bottom: 24px; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9;">
           <span style="color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: 700; margin-right: 8px;">Status:</span>
           <span style="color: ${statusColor}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 14px;">${statusText}</span>
        </div>

        ${
          remarks
            ? `
        <div style="margin-bottom: 24px; padding: 20px; background: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px;">
          <h4 style="margin: 0 0 8px; color: #9a3412; font-size: 14px; text-transform: uppercase;">Reviewer Remarks</h4>
          <p style="margin: 0; color: #c2410c; font-style: italic;">"${remarks}"</p>
        </div>
        `
            : ''
        }

        <div style="background: #f8fafc; border-radius: 12px; padding: 24px; border: 1px solid #f1f5f9; margin-bottom: 32px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px; text-transform: uppercase; width: 140px; vertical-align: top;">Control Number</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 600; vertical-align: top;">${requisition.rfControlNo}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px; text-transform: uppercase; vertical-align: top;">Purpose</td>
              <td style="padding: 8px 0; color: #1e293b; vertical-align: top; line-height: 1.4;">${requisition.purpose}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${window.location.origin}/my-requisitions" style="display: inline-block; background: #b91c1c; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Open Requisitions</a>
        </div>
      </div>
      <div style="background: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 12px; color: #64748b;">This is a system-generated tracking alert from Leyeco III RMS.</p>
      </div>
    </div>
  `

  return sendEmailRelay({ to: email, subject, htmlBody })
}

/**
 * Notifies the BAC Secretary of a new Canvass submission
 */
export async function notifyBACNewCanvass(requisition) {
  const subject = `[New Canvass] Ready for PO Issuance - ${requisition.rfControlNo}`
  // In a real scenario, you'd fetch the BAC Secretary's email from Firestore.
  // For now, we'll assume there's a collective or targeted email.
  const bacEmail = 'bac@leyeco3.com'

  const htmlBody = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background: linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%); padding: 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: -0.025em; font-weight: 700;">LEYECO III</h1>
        <p style="color: rgba(255, 255, 255, 0.8); margin: 8px 0 0; font-size: 14px;">BAC Management Module</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="color: #1e293b; margin: 0 0 16px; font-size: 20px; font-weight: 600;">Canvass Ready for PO</h2>
        <p style="color: #475569; line-height: 1.6; margin: 0 0 24px;">A new canvass has been finalized and is ready for <strong>Purchase Order issuance</strong>.</p>

        <div style="background: #f8fafc; border-radius: 12px; padding: 24px; border: 1px solid #f1f5f9; margin-bottom: 32px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px; text-transform: uppercase; width: 140px; vertical-align: top;">Control Number</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 600; vertical-align: top;">${requisition.rfControlNo}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px; text-transform: uppercase; vertical-align: top;">Supplier</td>
              <td style="padding: 8px 0; color: #1e293b; vertical-align: top;">${requisition.supplier?.name || 'Multiple Suppliers'}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${window.location.origin}/bac-dashboard" style="display: inline-block; background: #b91c1c; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Open BAC Dashboard</a>
        </div>
      </div>
      <div style="background: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 12px; color: #64748b;">This is a system-generated alert for BAC Personnel.</p>
      </div>
    </div>
  `

  return sendEmailRelay({ to: bacEmail, subject, htmlBody })
}

/**
 * Notifies the next PO Approver
 */
export async function notifyPOAction(requisition, nextRole, nextEmail) {
  if (!nextEmail) return

  const subject = `[PO Review] Action Required - ${requisition.rfControlNo}`
  const htmlBody = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background: linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%); padding: 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: -0.025em; font-weight: 700;">LEYECO III</h1>
        <p style="color: rgba(255, 255, 255, 0.8); margin: 8px 0 0; font-size: 14px;">Purchase Order Workflow</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="color: #1e293b; margin: 0 0 16px; font-size: 20px; font-weight: 600;">PO Approval Required</h2>
        <p style="color: #475569; line-height: 1.6; margin: 0 0 24px;">A Purchase Order requires your signature for the <strong>${nextRole}</strong> phase.</p>

        <div style="background: #f8fafc; border-radius: 12px; padding: 24px; border: 1px solid #f1f5f9; margin-bottom: 32px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px; text-transform: uppercase; width: 140px; vertical-align: top;">Control Number</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 600; vertical-align: top;">${requisition.rfControlNo}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px; text-transform: uppercase; vertical-align: top;">Total Amount</td>
              <td style="padding: 8px 0; color: #059669; font-weight: 700; font-size: 18px; vertical-align: top;">₱${requisition.totalAmount?.toLocaleString()}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${window.location.origin}/po-approvals" style="display: inline-block; background: #b91c1c; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Approve PO</a>
        </div>
      </div>
      <div style="background: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 12px; color: #64748b;">This is a high-priority financial notification.</p>
      </div>
    </div>
  `
  return sendEmailRelay({ to: nextEmail, subject, htmlBody })
}

/**
 * Sends a confirmation receipt to the original Requestor
 */
export async function notifySubmissionReceipt(requisition) {
  const email = requisition.requestedBy?.email
  if (!email) return

  const subject = `[Receipt] Requisition Submitted - ${requisition.rfControlNo || 'New'}`
  const htmlBody = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background: #7f1d1d; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 0.05em; font-weight: 700;">LEYECO III</h1>
      </div>
      <div style="padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; background: #ecfdf5; color: #059669; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Submission Receipt</div>
        </div>
        <h2 style="color: #1e293b; margin: 0 0 16px; font-size: 20px; text-align: center;">Document Received</h2>
        <p style="color: #475569; text-align: center; line-height: 1.6; margin: 0 0 32px;">This is a receipt confirming your requisition has been successfully submitted and is now in the <strong>Section Head</strong> review phase.</p>

        <div style="background: #f8fafc; border-radius: 12px; padding: 24px; border: 1px solid #f1f5f9; margin-bottom: 32px;">
          <table style="width: 100%; border-collapse: collapse;">
             <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 11px; text-transform: uppercase; width: 130px; vertical-align: top;">Control Number</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 600; vertical-align: top;">
                ${requisition.rfControlNo ? `<span>${requisition.rfControlNo}</span>` : '<span style="color: #64748b; font-style: italic; font-weight: 400; font-size: 11px; background: #e2e8f0; padding: 2px 8px; border-radius: 4px;">Pending Generation</span>'}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 11px; text-transform: uppercase; vertical-align: top;">Purpose</td>
              <td style="padding: 8px 0; color: #1e293b; vertical-align: top; line-height: 1.4; font-size: 14px;">${requisition.purpose}</td>
            </tr>
          </table>
        </div>

        <p style="font-size: 13px; color: #94a3b8; text-align: center;">You will receive another update once the next level of approval is complete.</p>
      </div>
      <div style="background: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #f1f5f9;">
        <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Official System Confirmation</p>
      </div>
    </div>
  `
  return sendEmailRelay({ to: email, subject, htmlBody })
}
