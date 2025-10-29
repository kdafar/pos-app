// src/renderer/App.tsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';

// pages
import OrderProcessPage from './pages/OrderProcessPage';
import RecentOrdersPage from './pages/RecentOrdersPage';
import {CategoriesPage} from './pages/CategoriesPage';
import {ItemsPage }from './pages/ItemsPage';
import {AddonsPage} from './pages/AddonsPage';
import PromosPage from './pages/PromosPage';
import TablesPage from './pages/TablesPage';
import {SettingsPage} from './pages/SettingsPage';
import PaymentMethodsPage from './pages/PaymentMethodsPage';
import LocationsPage from './pages/LocationsPage';

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Orders */}
        <Route index element={<OrderProcessPage />} />
        <Route path="orders" element={<RecentOrdersPage />} />

        {/* Catalog */}
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="addons" element={<AddonsPage />} />
        <Route path="promos" element={<PromosPage />} />

        {/* Dine-in */}
        <Route path="tables" element={<TablesPage />} />

        {/* System */}
        <Route path="payment-methods" element={<PaymentMethodsPage />} />
        <Route path="locations" element={<LocationsPage />} />
        <Route path="settings" element={<SettingsPage />} />

        {/* Catch-all 404 (optional) */}
        {/* <Route path="*" element={<div className="p-4">Not found</div>} /> */}
      </Route>
    </Routes>
  );
}

export default App;
