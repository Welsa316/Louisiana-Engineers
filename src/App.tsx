import { useRef } from "react";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Purpose } from "./components/Purpose";
import { Pillars } from "./components/Pillars";
import { Events } from "./components/Events";
import { Board } from "./components/Board";
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
        {/* Sitemap from the content plan: Hero, Mission & About, Events,
            Meet the Board, Get Involved, Footer. The image-led Community
            section is kept in code for the later past-event gallery. */}
        <Purpose />
        <Pillars />
        <Events />
        <Board />
        <Membership />
      </main>
      <Footer />
    </div>
  );
}
