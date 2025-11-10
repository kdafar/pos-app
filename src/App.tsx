import { Routes, Route, NavLink } from 'react-router-dom';
import PromosPage from './renderer/pages/PromosPage';
import TablesPage from './renderer/pages/TablesPage';
import PaymentMethodsPage from './renderer/pages/PaymentMethodsPage';
import LocationsPage from './renderer/pages/LocationsPage';
import RecentOrdersPage from './renderer/pages/RecentOrdersPage';

function Sidebar() {
  return (
    <div className="h-screen w-64 bg-gray-800 text-white flex flex-col">
      <div className="p-4 font-bold text-lg">POS App</div>
      <nav className="flex flex-col p-2 space-y-1">
        <div className="px-2 text-xs font-semibold text-gray-400 uppercase">Orders</div>
        <NavLink to="/" className="p-2 rounded-md hover:bg-gray-700">POS Terminal</NavLink>
        <NavLink to="/orders/recent" className="p-2 rounded-md hover:bg-gray-700">Recent Orders</NavLink>
        <NavLink to="/reports/closing" className="p-2 rounded-md hover:bg-gray-700">Closing Report</NavLink>

        <div className="px-2 pt-4 text-xs font-semibold text-gray-400 uppercase">Catalog</div>
        <NavLink to="/catalog/categories" className="p-2 rounded-md hover:bg-gray-700">Categories</NavLink>
        <NavLink to="/catalog/items" className="p-2 rounded-md hover:bg-gray-700">Items</NavLink>
        <NavLink to="/catalog/addons" className="p-2 rounded-md hover:bg-gray-700">Addons</NavLink>
        <NavLink to="/catalog/promos" className="p-2 rounded-md hover:bg-gray-700">Promos</NavLink>

        <div className="px-2 pt-4 text-xs font-semibold text-gray-400 uppercase">Dine-in</div>
        <NavLink to="/dinein/tables" className="p-2 rounded-md hover:bg-gray-700">Tables</NavLink>

        <div className="px-2 pt-4 text-xs font-semibold text-gray-400 uppercase">System</div>
        <NavLink to="/settings" className="p-2 rounded-md hover:bg-gray-700">Settings</NavLink>
        <NavLink to="/system/payment-methods" className="p-2 rounded-md hover:bg-gray-700">Payment Methods</NavLink>
        <NavLink to="/system/locations" className="p-2 rounded-md hover:bg-gray-700">Locations</NavLink>
      </nav>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return <div className="p-4"><h1>{title}</h1></div>;
}

function App() {
  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 h-screen overflow-auto">
        <Routes>
          <Route path="/" element={<Placeholder title="POS Terminal" />} />
          <Route path="/orders/recent" element={<Placeholder title="Recent Orders" />} />
           <Route path="/reports/closing" element={<Placeholder title="Closing Report" />} />
          <Route path="/catalog/categories" element={<Placeholder title="Categories" />} />
          <Route path="/catalog/items" element={<Placeholder title="Items" />} />
          <Route path="/catalog/addons" element={<Placeholder title="Addons" />} />
          <Route path="/catalog/promos" element={<PromosPage />} />
          <Route path="/dinein/tables" element={<Placeholder title="Tables" />} />
          <Route path="/settings" element={<Placeholder title="Settings" />} />
          <Route path="/system/payment-methods" element={<PaymentMethodsPage />} />
          <Route path="/system/locations" element={<LocationsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App; />
        </Routes>
      </main>
    </div>
  );
}

export default App;