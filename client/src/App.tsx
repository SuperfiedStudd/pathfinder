import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { CanopySite } from "./sites/canopy";
import { LedgerlySite } from "./sites/ledgerly";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/canopy/*" element={<CanopySite />} />
        <Route path="/ledgerly/*" element={<LedgerlySite />} />
      </Routes>
    </BrowserRouter>
  );
}
