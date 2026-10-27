import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (root === null) throw new Error("no #root element");
// No StrictMode: the live screen's effect opens the camera and creates a session, and must run once.
createRoot(root).render(<App />);
