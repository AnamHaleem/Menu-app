import React from 'react';
import { HashRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import OwnerPortal from './components/owner/OwnerPortal';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/*" element={<OwnerPortal />} />
      </Routes>
    </Router>
  );
}
