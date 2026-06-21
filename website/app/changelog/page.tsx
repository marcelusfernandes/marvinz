import type { Metadata } from "next";
import "../v2.css";
import { TopBar } from "@/components/TopBar";
import { Footer } from "@/components/Footer";
import { RevealController } from "@/components/RevealController";
import { SheetSection } from "@/components/v2/SheetSection";
import { SheetHeading } from "@/components/v2/SheetHeading";
import { Changelog } from "@/components/v2/Changelog";
import { V2ThemeDefault } from "@/components/v2/V2ThemeDefault";

export const metadata: Metadata = {
  title: "Changelog — Marvinz",
  description:
    "What's shipped, what we're building now, and what's next for Marvinz — the visual workspace for Claude Code & Codex.",
};

export default function ChangelogPage() {
  return (
    <div className="v2Root">
      <V2ThemeDefault />
      <div className="v2Surface">
        <TopBar solid hideToggle />
        <main id="top">
          <SheetSection id="changelog" tone="1" ariaLabel="Changelog">
            <SheetHeading
              eyebrow="Changelog"
              title="What we're building."
              titleId="changelog-title"
              lead="A living look at what's shipped, what we're building now, and what's next for Marvinz. Have an idea? Open an issue — feature requests are issues too."
            />
            <Changelog />
          </SheetSection>
        </main>
        <Footer />
      </div>
      <RevealController />
    </div>
  );
}
