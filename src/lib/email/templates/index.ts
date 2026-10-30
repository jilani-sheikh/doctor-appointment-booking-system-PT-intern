import { formatDateTimeIST, formatSlotDateTimeRangeIST } from "@/lib/time";
import { formatINR } from "@/lib/money";
import { getAppUrl } from "@/lib/env";

export function escapeHtml(str?: string | null): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function baseLayout(title: string, bodyContent: string, actionButton?: { text: string; url: string }): { html: string; text: string } {
  const appUrl = getAppUrl();
  const currentYear = new Date().getFullYear();

  const buttonHtml = actionButton
    ? `
      <div style="margin: 28px 0; text-align: center;">
        <a href="${actionButton.url}" style="background-color: #0f766e; color: #ffffff; padding: 12px 28px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block; font-size: 15px; letter-spacing: 0.3px;">
          ${escapeHtml(actionButton.text)}
        </a>
      </div>
    `
    : "";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.6;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f8fafc; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #042f2e; padding: 24px 32px; border-bottom: 3px solid #0d9488;">
              <h1 style="margin: 0; font-size: 24px; color: #ffffff; font-weight: 700; letter-spacing: -0.5px;">
                Medrella Healthcare
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin-top: 0; font-size: 20px; color: #0f172a; font-weight: 600;">${escapeHtml(title)}</h2>
              ${bodyContent}
              ${buttonHtml}
              <p style="margin-top: 32px; margin-bottom: 0; font-size: 13px; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                If you have questions or require support, please contact the clinic or view your dashboard at <a href="${appUrl}" style="color: #0f766e; text-decoration: underline;">${appUrl}</a>.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 32px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0;">
              © ${currentYear} Medrella Healthcare Systems. All times are displayed in Indian Standard Time (IST).
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  // Plain-text alternative
  const textButton = actionButton ? `\n\nLink: ${actionButton.url}` : "";
  const text = `Medrella Healthcare - ${title}\n\n${bodyContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}${textButton}\n\n© ${currentYear} Medrella Healthcare Systems. All times in IST.`;

  return { html, text };
}

// 1. Booking Confirmed
export function renderBookingConfirmedEmail(params: {
  patientName: string;
  doctorName: string;
  specialization: string;
  startTime: Date;
  endTime?: Date;
  arrivalWindow?: string | null;
}) {
  const timeFormatted = `${
    params.endTime
      ? formatSlotDateTimeRangeIST(params.startTime, params.endTime)
      : formatDateTimeIST(params.startTime)
  } IST`;
  const appUrl = getAppUrl();

  const arrivalHtml = params.arrivalWindow
    ? `<div style="background-color: #f0fdfa; border-left: 4px solid #0d9488; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
        <strong style="color: #0f766e;">Designated Arrival Window:</strong> ${escapeHtml(params.arrivalWindow)} (IST)
      </div>`
    : "";

  const content = `
    <p>Dear ${escapeHtml(params.patientName)},</p>
    <p>Your outpatient consultation has been successfully booked and confirmed.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Practitioner</td>
        <td style="padding: 8px 0; font-weight: 600; text-align: right;">Dr. ${escapeHtml(params.doctorName)} (${escapeHtml(params.specialization)})</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Scheduled Time</td>
        <td style="padding: 8px 0; font-weight: 600; text-align: right;">${timeFormatted}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Status</td>
        <td style="padding: 8px 0; font-weight: 600; color: #0f766e; text-align: right;">Confirmed</td>
      </tr>
    </table>
    ${arrivalHtml}
    <p>Please plan to arrive on time. You can check in directly from your patient portal 30 minutes before your consultation begins.</p>
  `;

  return baseLayout("Consultation Booking Confirmed", content, {
    text: "View My Appointments",
    url: `${appUrl}/patient/appointments`,
  });
}

// 2. Payment Receipt
export function renderPaymentReceiptEmail(params: {
  patientName: string;
  doctorName: string;
  amountRupees: number;
  providerOrderId: string;
  providerPaymentId?: string | null;
  paidAt: Date;
  paymentId: string;
}) {
  const timeFormatted = `${formatDateTimeIST(params.paidAt)} IST`;
  const appUrl = getAppUrl();

  const content = `
    <p>Dear ${escapeHtml(params.patientName)},</p>
    <p>Thank you for your payment. Your consultation fee has been processed successfully.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Amount Paid</td>
        <td style="padding: 8px 0; font-weight: 700; color: #0f766e; font-size: 16px; text-align: right;">${formatINR(params.amountRupees)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Practitioner</td>
        <td style="padding: 8px 0; font-weight: 600; text-align: right;">Dr. ${escapeHtml(params.doctorName)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Order Reference</td>
        <td style="padding: 8px 0; font-family: monospace; text-align: right;">${escapeHtml(params.providerOrderId)}</td>
      </tr>
      ${
        params.providerPaymentId
          ? `<tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 8px 0; color: #64748b;">Payment ID</td>
              <td style="padding: 8px 0; font-family: monospace; text-align: right;">${escapeHtml(params.providerPaymentId)}</td>
            </tr>`
          : ""
      }
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Payment Date</td>
        <td style="padding: 8px 0; text-align: right;">${timeFormatted}</td>
      </tr>
    </table>
    <p>A printable receipt is available in your payments dashboard.</p>
  `;

  return baseLayout("Payment Confirmation & Receipt", content, {
    text: "View Printable Receipt",
    url: `${appUrl}/patient/payments/${params.paymentId}`,
  });
}

// 3. Appointment Cancelled
export function renderAppointmentCancelledEmail(params: {
  patientName: string;
  doctorName: string;
  startTime: Date;
  endTime?: Date;
  cancelledBy: string;
  refundSummary?: string | null;
}) {
  const timeFormatted = `${
    params.endTime
      ? formatSlotDateTimeRangeIST(params.startTime, params.endTime)
      : formatDateTimeIST(params.startTime)
  } IST`;
  const appUrl = getAppUrl();

  const refundHtml = params.refundSummary
    ? `<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 20px 0;">
        <strong style="color: #334155;">Refund Information:</strong>
        <p style="margin: 6px 0 0 0; color: #475569; font-size: 14px;">${escapeHtml(params.refundSummary)}</p>
      </div>`
    : "";

  const content = `
    <p>Dear ${escapeHtml(params.patientName)},</p>
    <p>Your appointment with Dr. ${escapeHtml(params.doctorName)} scheduled for <strong>${timeFormatted}</strong> has been cancelled (${escapeHtml(params.cancelledBy)}).</p>
    ${refundHtml}
    <p>If you wish to reschedule or book another consultation, please visit our booking page.</p>
  `;

  return baseLayout("Appointment Cancellation Notice", content, {
    text: "Book a New Appointment",
    url: `${appUrl}/doctors`,
  });
}

// 4. Appointment Rescheduled
export function renderAppointmentRescheduledEmail(params: {
  patientName: string;
  doctorName: string;
  oldStartTime: Date;
  oldEndTime?: Date;
  newStartTime: Date;
  newEndTime?: Date;
}) {
  const oldFormatted = `${
    params.oldEndTime
      ? formatSlotDateTimeRangeIST(params.oldStartTime, params.oldEndTime)
      : formatDateTimeIST(params.oldStartTime)
  } IST`;
  const newFormatted = `${
    params.newEndTime
      ? formatSlotDateTimeRangeIST(params.newStartTime, params.newEndTime)
      : formatDateTimeIST(params.newStartTime)
  } IST`;
  const appUrl = getAppUrl();

  const content = `
    <p>Dear ${escapeHtml(params.patientName)},</p>
    <p>Your consultation with Dr. ${escapeHtml(params.doctorName)} has been successfully rescheduled.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Previous Slot</td>
        <td style="padding: 8px 0; text-decoration: line-through; color: #94a3b8; text-align: right;">${oldFormatted}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">New Consultation Slot</td>
        <td style="padding: 8px 0; font-weight: 700; color: #0f766e; text-align: right;">${newFormatted}</td>
      </tr>
    </table>
    <p>Your previous payment remains attached to this consultation. No additional payment is required.</p>
  `;

  return baseLayout("Appointment Rescheduled", content, {
    text: "View Updated Appointment",
    url: `${appUrl}/patient/appointments`,
  });
}

// 5. Refund Status Update
export function renderRefundStatusEmail(params: {
  patientName: string;
  doctorName: string;
  amountRupees: number;
  status: "REQUESTED" | "PENDING" | "SUCCESS" | "FAILED";
  providerRefundId: string;
  failureReason?: string | null;
}) {
  const appUrl = getAppUrl();

  let statusLabel = "Refund Initiated";
  let statusExplanation = "Your refund request has been initiated and submitted to our payment processor.";
  let statusColor = "#d97706"; // Amber

  if (params.status === "SUCCESS") {
    statusLabel = "Refund Processed Successfully";
    statusExplanation = "Your refund has been completed by our payment processor. Depending on your bank, funds typically appear in your original payment method in 3 to 7 business days.";
    statusColor = "#0f766e"; // Teal
  } else if (params.status === "FAILED") {
    statusLabel = "Refund Processing Failed";
    statusExplanation = `Our automatic refund attempt could not be completed: ${params.failureReason || "Gateway failure"}. Our administrative team has been flagged to resolve this promptly.`;
    statusColor = "#dc2626"; // Red
  }

  const content = `
    <p>Dear ${escapeHtml(params.patientName)},</p>
    <p>We are writing to update you regarding your refund for your consultation with Dr. ${escapeHtml(params.doctorName)}.</p>
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: ${statusColor}; font-size: 16px;">${escapeHtml(statusLabel)}</h3>
      <p style="margin: 6px 0 12px 0; color: #475569; font-size: 14px;">${escapeHtml(statusExplanation)}</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr style="border-top: 1px solid #e2e8f0;">
          <td style="padding: 6px 0; color: #64748b;">Refund Amount</td>
          <td style="padding: 6px 0; font-weight: 700; text-align: right;">${formatINR(params.amountRupees)}</td>
        </tr>
        <tr style="border-top: 1px solid #e2e8f0;">
          <td style="padding: 6px 0; color: #64748b;">Refund Tracking ID</td>
          <td style="padding: 6px 0; font-family: monospace; text-align: right;">${escapeHtml(params.providerRefundId)}</td>
        </tr>
      </table>
    </div>
  `;

  return baseLayout("Refund Status Update", content, {
    text: "View Payment History",
    url: `${appUrl}/patient/payments`,
  });
}

// 6. Payment Failed or Expired Hold
export function renderPaymentFailedHoldEmail(params: {
  patientName: string;
  doctorName: string;
  reason: string;
}) {
  const appUrl = getAppUrl();

  const content = `
    <p>Dear ${escapeHtml(params.patientName)},</p>
    <p>Your payment attempt or consultation hold with Dr. ${escapeHtml(params.doctorName)} could not be completed (${escapeHtml(params.reason)}).</p>
    <p>The provisional hold on the consultation slot has been released back to the calendar. No charges were captured.</p>
    <p>You can re-attempt booking or select another consultation slot anytime.</p>
  `;

  return baseLayout("Consultation Hold Expired", content, {
    text: "Explore Available Slots",
    url: `${appUrl}/doctors`,
  });
}

// 7. Appointment Reminder
export function renderAppointmentReminderEmail(params: {
  patientName: string;
  doctorName: string;
  startTime: Date;
  endTime?: Date;
  offsetMinutes: number;
}) {
  const timeFormatted = `${
    params.endTime
      ? formatSlotDateTimeRangeIST(params.startTime, params.endTime)
      : formatDateTimeIST(params.startTime)
  } IST`;
  const appUrl = getAppUrl();

  const reminderTimeline =
    params.offsetMinutes >= 1440
      ? "tomorrow"
      : params.offsetMinutes >= 60
      ? `in ${Math.round(params.offsetMinutes / 60)} hour(s)`
      : `in ${params.offsetMinutes} minutes`;

  const content = `
    <p>Dear ${escapeHtml(params.patientName)},</p>
    <p>This is a friendly reminder that your upcoming consultation with Dr. ${escapeHtml(params.doctorName)} is scheduled for <strong>${reminderTimeline}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Scheduled Time</td>
        <td style="padding: 8px 0; font-weight: 700; color: #0f766e; text-align: right;">${timeFormatted}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 0; color: #64748b;">Practitioner</td>
        <td style="padding: 8px 0; font-weight: 600; text-align: right;">Dr. ${escapeHtml(params.doctorName)}</td>
      </tr>
    </table>
    <p>You can check in online starting 30 minutes before your slot from your patient portal.</p>
  `;

  return baseLayout("Reminder: Upcoming Consultation", content, {
    text: "View Consultation Details",
    url: `${appUrl}/patient/appointments`,
  });
}

// 8. Doctor New Booking Notice
export function renderDoctorNewBookingEmail(params: {
  doctorName: string;
  patientName: string;
  startTime: Date;
  endTime?: Date;
}) {
  const timeFormatted = `${
    params.endTime
      ? formatSlotDateTimeRangeIST(params.startTime, params.endTime)
      : formatDateTimeIST(params.startTime)
  } IST`;
  const appUrl = getAppUrl();

  const content = `
    <p>Dear Dr. ${escapeHtml(params.doctorName)},</p>
    <p>A new confirmed consultation has been scheduled with <strong>${escapeHtml(params.patientName)}</strong> for <strong>${timeFormatted}</strong>.</p>
    <p>The patient has completed online booking. The consultation is visible in your live queue and appointments tab.</p>
  `;

  return baseLayout("New Consultation Booked", content, {
    text: "View Live Queue",
    url: `${appUrl}/doctor/queue`,
  });
}
