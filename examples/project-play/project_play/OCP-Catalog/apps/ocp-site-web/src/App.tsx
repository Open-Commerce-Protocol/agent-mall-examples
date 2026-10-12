import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SiteLayout } from './layouts/SiteLayout';
import { HomePage } from './pages/HomePage';
import { ThemeProvider } from './theme/ThemeContext';

const DocsLayout = lazy(() => import('./components/docs/DocsLayout').then((module) => ({ default: module.DocsLayout })));
const DocsLandingPage = lazy(() => import('./pages/DocsLandingPage').then((module) => ({ default: module.DocsLandingPage })));
const UpdatesPage = lazy(() => import('./pages/UpdatesPage').then((module) => ({ default: module.UpdatesPage })));
const UpdateDetailPage = lazy(() => import('./pages/UpdateDetailPage').then((module) => ({ default: module.UpdateDetailPage })));
const ProductsPage = lazy(() => import('./pages/ProductsPage').then((module) => ({ default: module.ProductsPage })));
const ProductOcpCatalogPage = lazy(() =>
  import('./pages/ProductOcpCatalogPage').then((module) => ({ default: module.ProductOcpCatalogPage })),
);
const RoadmapPage = lazy(() => import('./pages/RoadmapPage').then((module) => ({ default: module.RoadmapPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })));
const PageView = lazy(() => import('./pages/PageView').then((module) => ({ default: module.PageView })));

function RouteLoader() {
  return (
    <div className="route-loader" role="status" aria-live="polite" aria-label="Loading route">
      <div className="route-loader-mark" aria-hidden="true">
        <span className="route-loader-line" />
        <span className="route-loader-node route-loader-node-source" />
        <span className="route-loader-node route-loader-node-target" />
      </div>
      <span className="route-loader-label">OCP</span>
    </div>
  );
}

function lazyRoute(element: ReactNode) {
  return <Suspense fallback={<RouteLoader />}>{element}</Suspense>;
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <Routes>
        <Route path="/" element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          <Route path="docs" element={lazyRoute(<DocsLandingPage />)} />
          <Route path="docs/*" element={lazyRoute(<DocsLayout />)}>
            <Route path="*" element={lazyRoute(<PageView />)} />
          </Route>
          <Route path="updates" element={lazyRoute(<UpdatesPage />)} />
          <Route path="updates/:slug" element={lazyRoute(<UpdateDetailPage />)} />
          <Route path="products" element={lazyRoute(<ProductsPage />)} />
          <Route path="products/ocp-catalog" element={lazyRoute(<ProductOcpCatalogPage />)} />
          <Route path="directory" element={<Navigate to="/products/ocp-catalog" replace />} />
          <Route path="roadmap" element={lazyRoute(<RoadmapPage />)} />
          <Route path="*" element={lazyRoute(<NotFoundPage />)} />
        </Route>
        <Route path="/zh" element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          <Route path="docs" element={lazyRoute(<DocsLandingPage />)} />
          <Route path="docs/*" element={lazyRoute(<DocsLayout />)}>
            <Route path="*" element={lazyRoute(<PageView />)} />
          </Route>
          <Route path="updates" element={lazyRoute(<UpdatesPage />)} />
          <Route path="updates/:slug" element={lazyRoute(<UpdateDetailPage />)} />
          <Route path="products" element={lazyRoute(<ProductsPage />)} />
          <Route path="products/ocp-catalog" element={lazyRoute(<ProductOcpCatalogPage />)} />
          <Route path="directory" element={<Navigate to="/zh/products/ocp-catalog" replace />} />
          <Route path="roadmap" element={lazyRoute(<RoadmapPage />)} />
          <Route path="*" element={lazyRoute(<NotFoundPage />)} />
        </Route>
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
