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

export const cafesApi = {
  getAll: () => api.get('/cafes').then(r => r.data),
  getOne: (id) => api.get(`/cafes/${id}`).then(r => r.data),
  create: (data) => api.post('/cafes', data).then(r => r.data),
  update: (id, data) => api.put(`/cafes/${id}`, data).then(r => r.data)
};

export const forecastApi = {
  get: (cafeId, date) => api.get(`/cafes/${cafeId}/forecast`, { params: { date } }).then(r => r.data),
  generate: (cafeId, date) => api.post(`/cafes/${cafeId}/forecast/generate`, { date }).then(r => r.data),
  sendEmail: (cafeId, date) => api.post(`/cafes/${cafeId}/send-prep-list`, { date }).then(r => r.data)
};

export const prepListApi = {
  get: (cafeId, date) => api.get(`/cafes/${cafeId}/prep-list`, { params: { date } }).then(r => r.data),
  toggle: (cafeId, prepId, completed) => api.patch(`/cafes/${cafeId}/prep-list/${prepId}`, { completed }).then(r => r.data)
};

export const metricsApi = {
  get: (cafeId) => api.get(`/cafes/${cafeId}/metrics`).then(r => r.data)
};

export const logsApi = {
  get: (cafeId, days) => api.get(`/cafes/${cafeId}/logs`, { params: { days } }).then(r => r.data),
  create: (cafeId, data) => api.post(`/cafes/${cafeId}/logs`, data).then(r => r.data)
};

export const itemsApi = {
  get: (cafeId) => api.get(`/cafes/${cafeId}/items`).then(r => r.data),
  create: (cafeId, data) => api.post(`/cafes/${cafeId}/items`, data).then(r => r.data),
  update: (cafeId, id, data) => api.put(`/cafes/${cafeId}/items/${id}`, data).then(r => r.data)
};

export const ingredientsApi = {
  get: (cafeId) => api.get(`/cafes/${cafeId}/ingredients`).then(r => r.data),
  create: (cafeId, data) => api.post(`/cafes/${cafeId}/ingredients`, data).then(r => r.data)
};

export const recipesApi = {
  get: (cafeId) => api.get(`/cafes/${cafeId}/recipes`).then(r => r.data),
  create: (cafeId, data) => api.post(`/cafes/${cafeId}/recipes`, data).then(r => r.data)
};

export const weatherApi = {
  get: (city) => api.get('/weather', { params: { city } }).then(r => r.data)
};

export const transactionsApi = {
  get: (cafeId, days) => api.get(`/cafes/${cafeId}/transactions`, { params: { days } }).then(r => r.data),
  bulkImport: (cafeId, transactions) => api.post(`/cafes/${cafeId}/transactions/bulk`, { transactions }).then(r => r.data)
};

export default api;
