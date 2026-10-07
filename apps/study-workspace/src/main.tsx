import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MockTutorCore } from "./adapters/mock-tutor-core.ts";
import { StudyWorkspaceApp } from "./ui/StudyWorkspaceApp.tsx";
import "./ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing application root");

createRoot(root).render(
  <StrictMode>
    <StudyWorkspaceApp tutorCore={new MockTutorCore()} />
  </StrictMode>,
);
