import axios from 'axios';

function resolveApiBaseUrl() {
  const envUrl = (import.meta.env.VITE_API_URL || '').trim();
  if (!envUrl) return 'http://localhost:3001/api';
  const trimmed = envUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

const toArray = (value) => (Array.isArray(value) ? value : []);
const OWNER_TOKEN_STORAGE_KEY = 'menu.ownerAuthToken';

function readOwnerToken() {
  try {
    return (window.localStorage.getItem(OWNER_TOKEN_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function saveOwnerToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(OWNER_TOKEN_STORAGE_KEY, String(token));
    } else {
      window.localStorage.removeItem(OWNER_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore private mode storage issues
  }
}

const publicApi = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true
});

const buildQueryParams = (options = {}) => {
  if (typeof options === 'number') {
    return { days: options };
  }

  const params = {};
  if (options.days !== undefined && options.days !== null && options.days !== '') {
    params.days = options.days;
  }
  if (options.startDate) {
    params.startDate = options.startDate;
  }
  if (options.endDate) {
    params.endDate = options.endDate;
  }

  return Object.keys(params).length ? params : undefined;
};

const ownerApi = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true
});

ownerApi.interceptors.request.use((config) => {
  const token = readOwnerToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const weatherApi = {
  get: (city) => publicApi.get('/weather', { params: { city } }).then((response) => response.data)
};

export const ownerAuthApi = {
  getStoredToken: () => readOwnerToken(),
  setStoredToken: (token) => saveOwnerToken(token),
  clearStoredToken: () => saveOwnerToken(''),
  requestCode: (payload) => {
    const body = typeof payload === 'string' ? { email: payload } : payload;
    return publicApi.post('/owner-auth/request-code', body).then((response) => response.data);
  },
  verifyCode: async (payloadOrEmail, code, phoneCode = '') => {
    const body = typeof payloadOrEmail === 'string'
      ? { email: payloadOrEmail, email_code: code, phone_code: phoneCode }
      : payloadOrEmail;
    const result = await publicApi.post('/owner-auth/verify-code', body).then((response) => response.data);
    if (result?.token) {
      saveOwnerToken(result.token);
    }
    return result;
  },
  me: () => ownerApi.get('/owner-auth/me').then((response) => response.data)
};

export const ownerPortalApi = {
  cafes: {
    getAll: () => ownerApi.get('/owner/cafes').then((response) => toArray(response.data))
  },
  profile: {
    get: () => ownerApi.get('/owner/profile').then((response) => response.data),
    update: (data) => ownerApi.patch('/owner/profile', data).then((response) => response.data)
  },
  team: {
    list: (cafeId) => ownerApi.get(`/owner/cafes/${cafeId}/team`).then((response) => toArray(response.data)),
    create: (cafeId, data) => ownerApi.post(`/owner/cafes/${cafeId}/team`, data).then((response) => response.data),
    update: (cafeId, memberOwnerId, data) =>
      ownerApi.patch(`/owner/cafes/${cafeId}/team/${memberOwnerId}`, data).then((response) => response.data),
    remove: (cafeId, memberOwnerId) =>
      ownerApi.delete(`/owner/cafes/${cafeId}/team/${memberOwnerId}`).then((response) => response.data)
  },
  metrics: {
    get: (cafeId, options = {}) =>
      ownerApi.get(`/owner/cafes/${cafeId}/metrics`, { params: buildQueryParams(options) }).then((response) => response.data)
  },
  logs: {
    get: (cafeId, options = {}) =>
      ownerApi.get(`/owner/cafes/${cafeId}/logs`, { params: buildQueryParams(options) }).then((response) => toArray(response.data)),
    create: (cafeId, data) => ownerApi.post(`/owner/cafes/${cafeId}/logs`, data).then((response) => response.data)
  },
  forecast: {
    get: (cafeId, date) => ownerApi.get(`/owner/cafes/${cafeId}/forecast`, { params: { date } }).then((response) => response.data),
    generate: (cafeId, date) => ownerApi.post(`/owner/cafes/${cafeId}/forecast/generate`, { date }).then((response) => response.data),
    sendEmail: (cafeId, date) => ownerApi.post(`/owner/cafes/${cafeId}/send-prep-list`, { date }).then((response) => response.data)
  },
  prepList: {
    get: (cafeId, date) => ownerApi.get(`/owner/cafes/${cafeId}/prep-list`, { params: { date } }).then((response) => toArray(response.data)),
    update: (cafeId, prepId, payload = {}) =>
      ownerApi.patch(`/owner/cafes/${cafeId}/prep-list/${prepId}`, payload).then((response) => response.data),
    toggle: (cafeId, prepId, completed) =>
      ownerApi.patch(`/owner/cafes/${cafeId}/prep-list/${prepId}`, { completed }).then((response) => response.data)
  },
  prepSummary: {
    get: (cafeId, date) => ownerApi.get(`/owner/cafes/${cafeId}/prep-summary`, { params: { date } }).then((response) => response.data)
  },
  prepAnalytics: {
    get: (cafeId, options = {}) =>
      ownerApi.get(`/owner/cafes/${cafeId}/prep-analytics`, { params: buildQueryParams(options) }).then((response) => response.data)
  },
  weather: weatherApi
};

// Compatibility exports for shared dashboard/kitchen components.
export const metricsApi = ownerPortalApi.metrics;
export const logsApi = ownerPortalApi.logs;
export const forecastApi = ownerPortalApi.forecast;
export const prepListApi = ownerPortalApi.prepList;
export const prepSummaryApi = ownerPortalApi.prepSummary;
export const prepAnalyticsApi = ownerPortalApi.prepAnalytics;

export default publicApi;
