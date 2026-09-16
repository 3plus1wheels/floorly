// Empty string = same-origin. Production never falls back to localhost.
const API_BASE = process.env.REACT_APP_API_BASE_URL
  ?? (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:8000');
export default API_BASE;
