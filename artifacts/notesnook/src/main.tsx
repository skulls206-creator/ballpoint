import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register the service worker for PWA / offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(() => console.info('[SW] Registered successfully'))
      .catch((err) => console.warn('[SW] Registration failed:', err));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
