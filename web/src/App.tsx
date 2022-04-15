import {
  Route,
  Routes
} from "react-router-dom";
// Routes
import Home from "./routes/Home";
import Info from "./routes/Info";

export default function App() {
  return (
    <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/info" element={<Info />} />
    </Routes>
  );
}