import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import HowItWorks from './HowItWorks';
import Live from './Live';
import './styles.css';

// Zero-dependency hash router: '#/live' → the live demo theater, '#/how-it-works'
// → the deep-dive page, anything else → the landing app. In-page anchors
// (#console, #bureau…) keep working because they don't match the '#/' prefixes.
function Root() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const live = hash.startsWith('#/live');
  const how = hash.startsWith('#/how');
  useEffect(() => { if (live || how) window.scrollTo(0, 0); }, [live, how]);
  return live ? <Live /> : how ? <HowItWorks /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
