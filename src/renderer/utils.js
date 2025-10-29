export const fmtMoney = (x) => (Number(x || 0)).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
export const el = (s, r = document) => r.querySelector(s);
export const els = (s, r = document) => Array.from(r.querySelectorAll(s));

export function timeAgo(ts) {
  if (!ts) return 'never';
  const d = Date.now() - Number(ts);
  if (d < 60000) return 'just now';
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.floor(h / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function setActiveRoute(hash) {
  els('nav a[data-route]').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === hash);
  });
}