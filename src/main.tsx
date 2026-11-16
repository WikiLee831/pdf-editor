import { createRoot } from 'react-dom/client';
import 'pdfjs-dist/web/pdf_viewer.css';
import './styles.css';
import App from './App';
import { registerCssFonts } from './lib/fonts';

registerCssFonts();
createRoot(document.getElementById('root')!).render(<App />);
