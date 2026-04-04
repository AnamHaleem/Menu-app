const axios = require('axios');

const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
const TWILIO_FROM_PHONE = String(process.env.TWILIO_FROM_PHONE || '').trim();
const SMS_BYPASS_IN_DEV = ['1', 'true', 'yes'].includes(
  String(process.env.SMS_BYPASS_IN_DEV || '').trim().toLowerCase()
);

function isConfigured() {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_PHONE);
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-***-${digits.slice(-4)}`;
}

async function sendOwnerLoginCode({ phone, code, expiresMinutes = 10 }) {
  const to = String(phone || '').trim();
  if (!to) {
    throw new Error('Owner phone number is required for SMS verification');
  }

  const messageBody = `Menu sign-in code: ${code}. Expires in ${expiresMinutes} minutes.`;

  if (isConfigured()) {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const payload = new URLSearchParams({
      To: to,
      From: TWILIO_FROM_PHONE,
      Body: messageBody
    });

    const response = await axios.post(endpoint, payload.toString(), {
      auth: {
        username: TWILIO_ACCOUNT_SID,
        password: TWILIO_AUTH_TOKEN
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });

    return {
      provider: 'twilio',
      to: to,
      toMasked: maskPhone(to),
      messageId: response?.data?.sid || null
    };
  }

  if (SMS_BYPASS_IN_DEV && process.env.NODE_ENV !== 'production') {
    console.log(`[SMS DEV BYPASS] Sign-in code for ${maskPhone(to)}: ${code}`);
    return {
      provider: 'dev-bypass',
      to: to,
      toMasked: maskPhone(to),
      messageId: null
    };
  }

  throw new Error('SMS provider is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_PHONE.');
}

module.exports = {
  isConfigured,
  sendOwnerLoginCode
};
