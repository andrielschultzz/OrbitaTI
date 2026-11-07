import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

// Fontes auto-hospedadas (nada de Google Fonts/CDN: a VM pode ter saída restrita e não
// repassamos o IP do usuário a terceiros). Só o subconjunto latino e os pesos usados.
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/montserrat/latin-800.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import './estilos/global.css';

import App from './App.jsx';

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
