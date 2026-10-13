import { useRef } from "react";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Purpose } from "./components/Purpose";
import { Pillars } from "./components/Pillars";
import { Community } from "./components/Community";
import { Events } from "./components/Events";
import { Membership } from "./components/Membership";
import { Footer } from "./components/Footer";
import { useMotion } from "./hooks/useMotion";

export default function App() {
  const root = useRef<HTMLDivElement>(null);
  useMotion(root);

  return (
    <div ref={root} id="top">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <Purpose />
        <Pillars />
        <Community />
        <Events />
        <Membership />
      </main>
      <Footer />
    </div>
  );
}
