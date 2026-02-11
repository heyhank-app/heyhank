import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Screenshot } from "./components/Screenshot";
import { Features } from "./components/Features";
import { HowItWorks } from "./components/HowItWorks";
import { GetStarted } from "./components/GetStarted";
import { Footer } from "./components/Footer";

export function App() {
  return (
    <div className="bg-cc-bg text-cc-fg min-h-screen">
      <Nav />
      <Hero />
      <Screenshot />
      <Features />
      <HowItWorks />
      <GetStarted />
      <Footer />
    </div>
  );
}
