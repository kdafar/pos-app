// src/renderer/App.tsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// layout
import { Layout } from './components/Layout';

// screens you added
import PairScreen  from './screens/PairScreen';
import { LoginScreen } from './screens/LoginScreen';
import { LogoutRoute } from './screens/LogoutRoute';
import { AuthedGate } from './screens/AuthedGate';

// pages
import OrderProcessPage from './pages/OrderProcessPage';
import RecentOrdersPage from './pages/RecentOrdersPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { ItemsPage } from './pages/ItemsPage';
import { AddonsPage } from './pages/AddonsPage';
import PromosPage from './pages/PromosPage';
import TablesPage from './pages/TablesPage';
import { SettingsPage } from './pages/SettingsPage';
import PaymentMethodsPage from './pages/PaymentMethodsPage';
import LocationsPage from './pages/LocationsPage';

function App() {
  return (
    <Routes>
      {/* Public routes (no session required) */}
      <Route path="/pair" element={<PairScreen />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/logout" element={<LogoutRoute />} />

      {/* Protected app */}
      <Route element={<AuthedGate />}>
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
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
