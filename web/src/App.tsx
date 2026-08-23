import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { SessionProvider } from './lib/session'
import { Dashboard } from './pages/Dashboard'
import { Enrollment } from './pages/Enrollment'
import { Kba } from './pages/Kba'
import { CreditReportPage } from './pages/CreditReport'
import { Alerts } from './pages/Alerts'
import { Playground } from './pages/Playground'
import { Inspector } from './pages/Inspector'

export function App() {
  return (
    <SessionProvider>
      {/* future flags silence the React Router v7 migration warnings */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/enrollment" element={<Enrollment />} />
            <Route path="/kba" element={<Kba />} />
            <Route path="/report" element={<CreditReportPage />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/inspector" element={<Inspector />} />
            <Route path="*" element={<div className="card">Rota não encontrada.</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
