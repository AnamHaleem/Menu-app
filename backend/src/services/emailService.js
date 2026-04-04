const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);
const RESEND_FROM_EMAIL = (process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev').trim();
const RESEND_FROM_NAME = (process.env.RESEND_FROM_NAME || 'Menu').trim();

function getFromAddress() {
  return `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`;
}

async function sendViaResend(payload, contextLabel) {
  const { data, error } = await resend.emails.send(payload);
  if (error) {
    throw new Error(`Resend ${contextLabel} failed: ${error.message || JSON.stringify(error)}`);
  }
  return data || null;
}

async function sendPrepList(cafe, forecast) {
  if (forecast.closed) {
    console.log(`Cafe ${cafe.name} is closed today (${forecast.holiday}). Skipping email.`);
    return;
  }

  const recipient = (cafe.kitchen_lead_email || cafe.email || '').trim();
  if (!recipient) {
    throw new Error(`No recipient email configured for cafe ${cafe.name}`);
  }

  const byStation = {};
  forecast.prepList.forEach(item => {
    if (!byStation[item.station]) byStation[item.station] = [];
    byStation[item.station].push(item);
  });

  const stationBlocks = Object.entries(byStation).map(([station, items]) => {
    const itemLines = items.map(i =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">${i.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right;font-weight:600;">${i.totalNeeded} ${i.unit}</td>
      </tr>`
    ).join('');
    return `
      <div style="margin-bottom:24px;">
        <div style="background:#1F4E79;color:white;padding:8px 12px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;border-radius:4px 4px 0 0;">${station}</div>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:0 0 4px 4px;border:1px solid #e0e0e0;">
          ${itemLines}
        </table>
      </div>
    `;
  }).join('');

  const holidayWarning = forecast.isHoliday && forecast.holidayBehaviour === 'Manual'
    ? `<div style="background:#FFF3CD;border:1px solid #FFD700;border-radius:4px;padding:12px;margin-bottom:20px;font-size:13px;color:#856404;">
        <strong>Public holiday today: ${forecast.holidayName}</strong> — review quantities before prepping.
       </div>`
    : '';

  const aiNotice = forecast.aiDecision?.applied
    ? `<p style="margin:6px 0 0;font-size:12px;color:#6b7280;">AI decision layer applied (${forecast.aiDecision.model || 'model'}).</p>`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8f8f8;padding:20px;">
      <div style="background:#1F4E79;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="color:white;margin:0;font-size:22px;font-weight:600;">Menu</h1>
        <p style="color:#AED6F1;margin:4px 0 0;font-size:13px;">Daily prep list for ${cafe.name}</p>
      </div>
      <div style="background:white;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #f0f0f0;">
          <div>
            <p style="margin:0;font-size:18px;font-weight:600;color:#1F4E79;">${new Date(forecast.date).toLocaleDateString('en-CA', { weekday:'long', month:'long', day:'numeric' })}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#888;">Weather: ${forecast.weather.condition}, ${forecast.weather.temp}°C</p>
            ${aiNotice}
          </div>
        </div>
        ${holidayWarning}
        ${stationBlocks}
        <p style="font-size:11px;color:#aaa;text-align:center;margin-top:24px;">Menu — Powered by PrepCast</p>
      </div>
    </div>
  `;

  const sendResult = await sendViaResend({
    from: getFromAddress(),
    to: recipient,
    subject: `Prep List — ${forecast.weather.condition} ${forecast.weather.temp}°C — ${new Date(forecast.date).toLocaleDateString('en-CA', { weekday: 'long' })}`,
    html
  }, 'prep list');

  console.log(`Prep list sent to ${recipient} (id: ${sendResult?.id || 'n/a'})`);
  return {
    to: recipient,
    from: getFromAddress(),
    messageId: sendResult?.id || null
  };
}

async function sendDailyCheckIn(cafe) {
  const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLScFAtC1mwYRTjRKm3ySIwWvr1OJQ6W_jAs_RhK-UjohC2WOfA/viewform';
  const recipient = (cafe.kitchen_lead_email || cafe.email || '').trim();
  if (!recipient) {
    throw new Error(`No recipient email configured for cafe ${cafe.name}`);
  }

  const sendResult = await sendViaResend({
    from: getFromAddress(),
    to: recipient,
    subject: 'Menu — Daily check-in (2 minutes)',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
        <h2 style="color:#1F4E79;">Two minutes to close out today</h2>
        <p style="color:#555;font-size:14px;">Waste, 86 incidents and covers. That is it.</p>
        <a href="${formUrl}" style="display:inline-block;background:#1F4E79;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">Fill in today's numbers</a>
        <p style="color:#aaa;font-size:11px;margin-top:24px;">Menu by PrepCast</p>
      </div>
    `
  }, 'daily check-in');

  console.log(`Check-in reminder sent to ${recipient} (id: ${sendResult?.id || 'n/a'})`);
  return {
    to: recipient,
    from: getFromAddress(),
    messageId: sendResult?.id || null
  };
}

async function sendOwnerLoginCode({ email, code, cafes = [], expiresMinutes = 10 }) {
  const safeEmail = String(email || '').trim();
  if (!safeEmail) {
    throw new Error('Owner login email is required');
  }

  const cafeListHtml = cafes.length
    ? `<ul style="margin:8px 0 16px 18px;padding:0;color:#374151;font-size:14px;">
         ${cafes.map((cafe) => `<li>${cafe.name} (${cafe.city || 'Toronto'})</li>`).join('')}
       </ul>`
    : '';

  const sendResult = await sendViaResend({
    from: getFromAddress(),
    to: safeEmail,
    subject: 'Menu owner sign-in code',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#1F4E79;margin:0 0 8px;">Your Menu sign-in code</h2>
        <p style="color:#4b5563;font-size:14px;margin:0 0 14px;">
          Use this code to sign in to your cafe owner portal. It expires in ${expiresMinutes} minutes.
        </p>
        <div style="font-size:30px;font-weight:700;letter-spacing:6px;color:#111827;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;display:inline-block;margin:4px 0 14px;">
          ${code}
        </div>
        ${cafeListHtml}
        <p style="color:#9ca3af;font-size:12px;margin-top:16px;">
          If you did not request this, you can safely ignore this email.
        </p>
      </div>
    `
  }, 'owner login code');

  return {
    to: safeEmail,
    from: getFromAddress(),
    messageId: sendResult?.id || null
  };
}

module.exports = { sendPrepList, sendDailyCheckIn, sendOwnerLoginCode };
