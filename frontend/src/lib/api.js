import axios from 'axios';

function resolveApiBaseUrl() {
  const envUrl = (import.meta.env.VITE_API_URL || '').trim();

  if (!envUrl) {
    return 'http://localhost:3001/api';
  }

  const trimmed = envUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true
});

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

export const cafesApi = {
  getAll: (options = {}) => {
    const params = options.includeInactive ? { includeInactive: true } : undefined;
    return api.get('/cafes', { params }).then(r => toArray(r.data));
  },
  getOne: (id) => api.get(`/cafes/${id}`).then(r => r.data),
  create: (data) => api.post('/cafes', data).then(r => r.data),
  update: (id, data) => api.put(`/cafes/${id}`, data).then(r => r.data),
  patch: (id, data) => api.patch(`/cafes/${id}`, data).then(r => r.data),
  delete: (id, options = {}) => {
    const params = options.hard ? { mode: 'hard' } : undefined;
    const headers = options.token ? { 'x-admin-delete-token': options.token } : undefined;
    return api.delete(`/cafes/${id}`, { params, headers }).then(r => r.data);
  },
  setPrepTime: (id, prep_send_time) => api.patch(`/cafes/${id}/prep-time`, { prep_send_time }).then(r => r.data)
};

export const forecastApi = {
  get: (cafeId, date) => api.get(`/cafes/${cafeId}/forecast`, { params: { date } }).then(r => r.data),
  generate: (cafeId, date) => api.post(`/cafes/${cafeId}/forecast/generate`, { date }).then(r => r.data),
  sendEmail: (cafeId, date) => api.post(`/cafes/${cafeId}/send-prep-list`, { date }).then(r => r.data)
};

export const prepListApi = {
  get: (cafeId, date) => api.get(`/cafes/${cafeId}/prep-list`, { params: { date } }).then(r => toArray(r.data)),
  update: (cafeId, prepId, payload = {}) => api.patch(`/cafes/${cafeId}/prep-list/${prepId}`, payload).then(r => r.data),
  toggle: (cafeId, prepId, completed) =>
    api.patch(`/cafes/${cafeId}/prep-list/${prepId}`, { completed }).then(r => r.data)
};

export const prepSummaryApi = {
  get: (cafeId, date) => api.get(`/cafes/${cafeId}/prep-summary`, { params: { date } }).then(r => r.data)
};

export const metricsApi = {
  get: (cafeId) => api.get(`/cafes/${cafeId}/metrics`).then(r => r.data)
};

export const logsApi = {
  get: (cafeId, days) => api.get(`/cafes/${cafeId}/logs`, { params: { days } }).then(r => toArray(r.data)),
  create: (cafeId, data) => api.post(`/cafes/${cafeId}/logs`, data).then(r => r.data)
};

export const itemsApi = {
  get: (cafeId) => api.get(`/cafes/${cafeId}/items`).then(r => toArray(r.data)),
  create: (cafeId, data) => api.post(`/cafes/${cafeId}/items`, data).then(r => r.data),
  update: (cafeId, id, data) => api.put(`/cafes/${cafeId}/items/${id}`, data).then(r => r.data)
};

export const ingredientsApi = {
  get: (cafeId) => api.get(`/cafes/${cafeId}/ingredients`).then(r => toArray(r.data)),
  create: (cafeId, data) => api.post(`/cafes/${cafeId}/ingredients`, data).then(r => r.data)
};

export const recipesApi = {
  get: (cafeId) => api.get(`/cafes/${cafeId}/recipes`).then(r => toArray(r.data)),
  create: (cafeId, data) => api.post(`/cafes/${cafeId}/recipes`, data).then(r => r.data)
};

export const weatherApi = {
  get: (city) => api.get('/weather', { params: { city } }).then(r => r.data)
};

export const transactionsApi = {
  get: (cafeId, days) => api.get(`/cafes/${cafeId}/transactions`, { params: { days } }).then(r => toArray(r.data)),
  bulkImport: (cafeId, transactions) => api.post(`/cafes/${cafeId}/transactions/bulk`, { transactions }).then(r => r.data)
};

export const ownerAuthApi = {
  getStoredToken: () => readOwnerToken(),
  setStoredToken: (token) => saveOwnerToken(token),
  clearStoredToken: () => saveOwnerToken(''),
  requestCode: (payload) => {
    const body = typeof payload === 'string' ? { email: payload } : payload;
    return api.post('/owner-auth/request-code', body).then(r => r.data);
  },
  verifyCode: async (payloadOrEmail, code, phoneCode = '') => {
    const body = typeof payloadOrEmail === 'string'
      ? { email: payloadOrEmail, email_code: code, phone_code: phoneCode }
      : payloadOrEmail;
    const result = await api.post('/owner-auth/verify-code', body).then(r => r.data);
    if (result?.token) {
      saveOwnerToken(result.token);
    }
    return result;
  },
  me: () => ownerApi.get('/owner-auth/me').then(r => r.data)
};

export const ownerPortalApi = {
  cafes: {
    getAll: () => ownerApi.get('/owner/cafes').then(r => toArray(r.data))
  },
  metrics: {
    get: (cafeId) => ownerApi.get(`/owner/cafes/${cafeId}/metrics`).then(r => r.data)
  },
  logs: {
    get: (cafeId, days) => ownerApi.get(`/owner/cafes/${cafeId}/logs`, { params: { days } }).then(r => toArray(r.data)),
    create: (cafeId, data) => ownerApi.post(`/owner/cafes/${cafeId}/logs`, data).then(r => r.data)
  },
  forecast: {
    get: (cafeId, date) => ownerApi.get(`/owner/cafes/${cafeId}/forecast`, { params: { date } }).then(r => r.data),
    generate: (cafeId, date) => ownerApi.post(`/owner/cafes/${cafeId}/forecast/generate`, { date }).then(r => r.data),
    sendEmail: (cafeId, date) => ownerApi.post(`/owner/cafes/${cafeId}/send-prep-list`, { date }).then(r => r.data)
  },
  prepList: {
    get: (cafeId, date) => ownerApi.get(`/owner/cafes/${cafeId}/prep-list`, { params: { date } }).then(r => toArray(r.data)),
    update: (cafeId, prepId, payload = {}) =>
      ownerApi.patch(`/owner/cafes/${cafeId}/prep-list/${prepId}`, payload).then(r => r.data),
    toggle: (cafeId, prepId, completed) =>
      ownerApi.patch(`/owner/cafes/${cafeId}/prep-list/${prepId}`, { completed }).then(r => r.data)
  },
  prepSummary: {
    get: (cafeId, date) => ownerApi.get(`/owner/cafes/${cafeId}/prep-summary`, { params: { date } }).then(r => r.data)
  }
};

export const adminOwnersApi = {
  list: (options = {}) => {
    const params = {};
    if (options.cafeId) params.cafeId = options.cafeId;
    if (options.includeInactive) params.includeInactive = true;
    return api.get('/admin/owners', { params }).then(r => toArray(r.data));
  },
  create: (data) => api.post('/admin/owners', data).then(r => r.data),
  update: (ownerId, data) => api.patch(`/admin/owners/${ownerId}`, data).then(r => r.data),
  deactivate: (ownerId) => api.delete(`/admin/owners/${ownerId}`).then(r => r.data),
  assignCafe: (ownerId, cafeId) => api.post(`/admin/owners/${ownerId}/cafes`, { cafe_id: cafeId }).then(r => r.data),
  unassignCafe: (ownerId, cafeId) => api.delete(`/admin/owners/${ownerId}/cafes/${cafeId}`).then(r => r.data),
  sendInvite: (ownerId) => api.post(`/admin/owners/${ownerId}/send-invite`).then(r => r.data)
};

export default api;
