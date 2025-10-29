export function RecentOrdersPage() {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.cssText = 'margin: 24px; padding: 24px;';
  c.innerHTML = `<h3>Recent Orders</h3>`;
  return c;
}
